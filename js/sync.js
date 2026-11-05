/* 多端进度同步：以私有 GitHub Gist 为云端存储，令牌只保存在当前浏览器。
 * 本文件不操作页面 DOM；app.js 通过 ProgressSync.start(adapter) 接入，并订阅状态变化。 */
"use strict";

(() => {
  const config = window.SYNC_CONFIG || {};
  const API = "https://api.github.com/gists/";
  const DEBOUNCE_MS = 1000;
  const RETRY_MS = 30000;
  const RESYNC_ON_FOCUS_MS = 15000;
  const STATES = ["not_started", "in_progress", "done"];

  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const time = (value) => {
    const parsed = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
  const statusOf = (progress) => (progress === 0 ? "not_started" : progress === 100 ? "done" : "in_progress");

  // —— 进度文档：{ version: 1, updatedAt, courses: { id: { status, progress, updatedAt } } } ——

  // 规范化任意来源的进度文档：丢弃无效记录；课程缺少时间戳时沿用文档时间戳（兼容旧版只有整体 updatedAt 的记录）。
  function normalize(raw) {
    const doc = { version: 1, updatedAt: null, courses: {} };
    if (!isObject(raw) || !isObject(raw.courses)) return doc;
    const fallback = time(raw.updatedAt);
    for (const [id, record] of Object.entries(raw.courses)) {
      if (!isObject(record) || !STATES.includes(record.status)) continue;
      if (!Number.isInteger(record.progress) || record.progress < 0 || record.progress > 100) continue;
      const stamp = time(record.updatedAt) || fallback;
      doc.courses[id] = { status: statusOf(record.progress), progress: record.progress };
      if (stamp) doc.courses[id].updatedAt = iso(stamp);
    }
    doc.updatedAt = latest(doc.courses);
    return doc;
  }

  function latest(courseMap) {
    return iso(Math.max(0, ...Object.values(courseMap).map((record) => time(record.updatedAt))));
  }

  // 按课程 id 合并：同一门课取 updatedAt 较新的一方；相同时保留本地。
  function merge(local, remote) {
    const courses = {};
    const ids = new Set([...Object.keys(local.courses), ...Object.keys(remote.courses)]);
    for (const id of ids) {
      const mine = local.courses[id];
      const theirs = remote.courses[id];
      courses[id] = !theirs ? mine : !mine ? theirs : time(theirs.updatedAt) > time(mine.updatedAt) ? theirs : mine;
    }
    return { version: 1, updatedAt: latest(courses), courses };
  }

  function sameCourses(a, b) {
    const ids = Object.keys(a.courses);
    if (ids.length !== Object.keys(b.courses).length) return false;
    return ids.every((id) => {
      const x = a.courses[id];
      const y = b.courses[id];
      return y && x.progress === y.progress && time(x.updatedAt) === time(y.updatedAt);
    });
  }

  // —— 令牌 ——

  function readToken() {
    try { return (localStorage.getItem(config.storageTokenKey) || "").trim(); } catch { return ""; }
  }

  function setToken(value) {
    const token = String(value || "").trim();
    if (!token) throw new Error("请先粘贴令牌。");
    if (/\s/.test(token)) throw new Error("令牌中不应包含空格或换行，请重新复制。");
    try { localStorage.setItem(config.storageTokenKey, token); }
    catch { throw new Error("浏览器禁止本地存储，无法保存令牌。"); }
    tokenChanged();
  }

  function clearToken() {
    try { localStorage.removeItem(config.storageTokenKey); } catch { /* 存储不可用时也视为已清除 */ }
    tokenChanged();
  }

  function maskedToken() {
    const token = readToken();
    if (!token) return "";
    return token.length <= 12 ? "••••" + token.slice(-2) : token.slice(0, 4) + "••••" + token.slice(-4);
  }

  // —— 网络 ——

  class SyncError extends Error {
    constructor(message, retry = false) {
      super(message);
      this.retry = retry;
    }
  }

  function describe(response) {
    const code = response.status;
    if (code === 401) return new SyncError("令牌无效或已过期，请重新粘贴（401）");
    if (code === 429 || (code === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
      return new SyncError("GitHub 请求过于频繁，稍后自动重试", true);
    }
    if (code === 403) return new SyncError("令牌没有 Gist 读写权限（403）");
    if (code === 404) return new SyncError("找不到 Gist：令牌需属于 Gist 所有者并有读写权限（404）");
    if (code >= 500) return new SyncError(`GitHub 暂时不可用（${code}），稍后自动重试`, true);
    return new SyncError(`GitHub 拒绝了请求（HTTP ${code}）`);
  }

  async function request(method, body) {
    let response;
    try {
      response = await fetch(API + encodeURIComponent(config.gistId), {
        method,
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + readToken(),
          ...(body ? { "Content-Type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new SyncError(navigator.onLine === false ? "当前离线，联网后自动同步" : "无法连接 GitHub，稍后自动重试", true);
    }
    if (!response.ok) throw describe(response);
    return response.json();
  }

  function readRemote(gist) {
    const file = gist && gist.files && gist.files[config.filename];
    if (!file) return normalize(null);
    if (file.truncated) throw new SyncError("云端进度文件过大，已暂停同步");
    const text = (file.content || "").trim();
    if (!text) return normalize(null);
    try { return normalize(JSON.parse(text)); }
    catch { throw new SyncError(`云端 ${config.filename} 不是有效 JSON，为免覆盖已暂停同步`); }
  }

  // 一次完整同步：拉取 → 合并 → 必要时写回本地 → 必要时推送。推送前总是先拉取，避免覆盖其他设备的新进度。
  async function syncOnce() {
    const remote = readRemote(await request("GET"));
    const local = normalize(adapter.read());
    const merged = merge(local, remote);
    if (!sameCourses(merged, local)) adapter.write(merged);
    if (!sameCourses(merged, remote)) {
      await request("PATCH", { files: { [config.filename]: { content: JSON.stringify(merged, null, 2) + "\n" } } });
    }
  }

  // —— 调度与状态 ——

  let adapter = null;
  let debounceTimer = 0;
  let retryTimer = 0;
  let running = null;
  let queued = false;
  let generation = 0;
  let lastAttempt = 0;
  const listeners = new Set();
  const state = { phase: "off", message: "", lastSyncedAt: null };

  const available = () => Boolean(config.gistId && config.filename && config.storageTokenKey);
  const ready = () => Boolean(adapter && available() && readToken());

  function setStatus(patch) {
    Object.assign(state, patch);
    listeners.forEach((listener) => listener({ ...state }));
  }

  function idleStatus() {
    if (!available()) return { phase: "unavailable", message: "缺少 js/sync-config.js 中的 Gist 配置" };
    if (!readToken()) return { phase: "off", message: "" };
    return state.lastSyncedAt ? { phase: "ok", message: "" } : { phase: "pending", message: "" };
  }

  function stopTimers() {
    clearTimeout(debounceTimer);
    clearTimeout(retryTimer);
    debounceTimer = retryTimer = 0;
  }

  // 本地进度变化后调用：1 秒内的连续改动合并为一次推送。
  function schedule() {
    if (!ready()) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, DEBOUNCE_MS);
    if (!running) setStatus({ phase: "pending", message: "" });
  }

  function run() {
    stopTimers();
    if (!ready()) return Promise.resolve(false);
    if (running) {
      queued = true;
      return running;
    }
    const current = generation;
    lastAttempt = Date.now();
    setStatus({ phase: "syncing", message: "" });
    running = syncOnce()
      .then(() => {
        if (current !== generation) return false;
        setStatus({ phase: "ok", message: "", lastSyncedAt: Date.now() });
        return true;
      }, (error) => {
        if (current !== generation) return false;
        const failure = error instanceof SyncError ? error : new SyncError("同步出错：" + (error && error.message ? error.message : "未知原因"));
        setStatus({ phase: "error", message: failure.message });
        if (failure.retry) retryTimer = setTimeout(run, RETRY_MS);
        return false;
      })
      .finally(() => {
        running = null;
        if (queued) {
          queued = false;
          run();
        }
      });
    return running;
  }

  function tokenChanged() {
    generation += 1;
    stopTimers();
    queued = false;
    state.lastSyncedAt = null;
    setStatus(idleStatus());
    if (ready()) run();
  }

  // adapter = { read(): 本地进度文档, write(合并后的文档): 写回本地并刷新界面 }
  function start(nextAdapter) {
    adapter = nextAdapter;
    setStatus(idleStatus());
    if (ready()) run();
    document.addEventListener("visibilitychange", () => {
      if (!ready()) return;
      if (document.visibilityState === "hidden") {
        if (debounceTimer) run();
      } else if (Date.now() - lastAttempt > RESYNC_ON_FOCUS_MS) {
        run();
      }
    });
    window.addEventListener("online", () => { if (ready()) run(); });
    window.addEventListener("storage", (event) => {
      if (event.key === config.storageTokenKey || event.key === null) tokenChanged();
    });
  }

  window.ProgressSync = {
    normalize,
    merge,
    sameCourses,
    start,
    schedule,
    syncNow: run,
    setToken,
    clearToken,
    hasToken: () => Boolean(readToken()),
    maskedToken,
    available,
    status: () => ({ ...state }),
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => listeners.delete(listener);
    }
  };
})();
