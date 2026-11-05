/* 多端进度同步：云端是你 GitHub 账号下的一个 secret Gist，令牌只保存在当前浏览器。
 * secret Gist 不会出现在你的 Gist 列表和搜索里，但不是私有的：拿到地址的人都能查看内容。
 * 本文件不操作页面 DOM；app.js 通过 ProgressSync.start(adapter) 接入，并订阅状态变化。
 * 合并规则在 js/model.js：按章节各自取较新的一端，两台设备勾了不同章节不会互相覆盖。 */
"use strict";

(() => {
  const config = window.SYNC_CONFIG || {};
  const Model = window.ProgressModel;
  const API = "https://api.github.com/gists/";
  const DEVICE_KEY = config.deviceKey || "learning-courses-device";
  const DEBOUNCE_MS = 1000;
  const RETRY_MS = 30000;
  const RESYNC_ON_FOCUS_MS = 15000;

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

  // —— 设备名：只存在本浏览器，推送时写进进度文档，同步历史里据此显示「哪台设备」 ——

  function guessName() {
    const agent = navigator.userAgent || "";
    if (/iPhone|iPad/.test(agent)) return "iPhone / iPad";
    if (/Android/.test(agent)) return "Android";
    if (/Mac/.test(agent)) return "Mac";
    if (/Windows/.test(agent)) return "Windows";
    return "这台设备";
  }

  function device() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(DEVICE_KEY) || "null"); } catch { saved = null; }
    if (saved && typeof saved.id === "string" && typeof saved.name === "string") return saved;
    const fresh = { id: Math.random().toString(36).slice(2, 10), name: guessName() };
    try { localStorage.setItem(DEVICE_KEY, JSON.stringify(fresh)); } catch { /* 存不下就每次临时生成 */ }
    return fresh;
  }

  function setDeviceName(name) {
    const clean = String(name || "").trim().slice(0, 40);
    if (!clean) throw new Error("设备名不能为空。");
    const next = { ...device(), name: clean };
    try { localStorage.setItem(DEVICE_KEY, JSON.stringify(next)); }
    catch { throw new Error("浏览器禁止本地存储，无法保存设备名。"); }
    return next;
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

  async function request(method, body, path = "") {
    let response;
    try {
      response = await fetch(API + encodeURIComponent(config.gistId) + path, {
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

  // 读取云端文件：返回 { doc, version }。文件缺失或为空视为空文档；无效 JSON 或来自更新版本的页面时暂停同步，避免覆盖。
  function readRemote(gist) {
    const file = gist && gist.files && gist.files[config.filename];
    if (!file) return { doc: Model.emptyDoc(), version: 0 };
    if (file.truncated) throw new SyncError("云端进度文件过大，已暂停同步");
    const text = (file.content || "").trim();
    if (!text) return { doc: Model.emptyDoc(), version: 0 };
    let raw;
    try { raw = JSON.parse(text); }
    catch { throw new SyncError(`云端 ${config.filename} 不是有效 JSON，为免覆盖已暂停同步`); }
    const doc = Model.normalize(raw);
    if (doc.newer) throw new SyncError(`云端进度来自更新版本的页面（v${doc.newer}），请刷新本页后再同步`);
    return { doc, version: raw && raw.version };
  }

  // 一次完整同步：拉取 → 合并 → 必要时写回本地 → 必要时推送。推送前总是先拉取，避免覆盖其他设备的新进度。
  async function syncOnce() {
    const remote = readRemote(await request("GET"));
    const local = Model.normalize(adapter.read());
    const merged = Model.merge(local, remote.doc);
    if (!Model.same(merged, local)) adapter.write(merged);
    // 云端还是 v1 时也推送一次，把文件升级成 v2。
    if (!Model.same(merged, remote.doc) || remote.version !== Model.VERSION) {
      const me = device();
      const payload = { ...merged, device: { id: me.id, name: me.name, at: new Date().toISOString() } };
      await request("PATCH", { files: { [config.filename]: { content: JSON.stringify(payload, null, 1) + "\n" } } });
    }
  }

  // —— 同步历史：Gist 自带版本记录，取最近几次，读出每次的设备名与完成数 ——

  const revisions = new Map();

  async function revision(version) {
    if (!revisions.has(version)) {
      const gist = await request("GET", null, "/" + encodeURIComponent(version));
      revisions.set(version, readRemote(gist).doc);
    }
    return revisions.get(version);
  }

  async function history(limit = 5) {
    if (!ready()) throw new SyncError("请先设置令牌");
    const gist = await request("GET");
    const entries = (gist.history || []).slice(0, limit);
    const out = [];
    for (const entry of entries) {
      let doc = null;
      let problem = "";
      try { doc = await revision(entry.version); }
      catch (error) { problem = error.message || "读取失败"; }
      let done = 0;
      if (doc) {
        for (const course of Object.values(doc.courses)) {
          for (const item of Object.values(course.chapters)) if (item.state === "done") done += 1;
        }
      }
      out.push({
        version: entry.version,
        committedAt: entry.committed_at,
        device: doc && doc.device ? doc.device.name : "",
        done,
        doc,
        problem
      });
    }
    return out;
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

  const available = () => Boolean(Model && config.gistId && config.filename && config.storageTokenKey);
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
    revisions.clear();
    state.lastSyncedAt = null;
    setStatus(idleStatus());
    if (ready()) run();
  }

  // adapter = { read(): 本地进度文档（v2）, write(合并后的文档): 写回本地并刷新界面 }
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
    start,
    schedule,
    syncNow: run,
    history,
    setToken,
    clearToken,
    hasToken: () => Boolean(readToken()),
    maskedToken,
    device,
    setDeviceName,
    available,
    status: () => ({ ...state }),
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => listeners.delete(listener);
    }
  };
})();
