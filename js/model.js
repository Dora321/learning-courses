/* 慢慢学：进度模型。纯函数，不碰 DOM，app.js 与 sync.js 共用，tests/model.test.mjs 可直接在 Node 里测。
 *
 * 进度文档 v2（localStorage 与 Gist 共用）：
 * {
 *   version: 2, updatedAt,
 *   courses: { [courseId]: { chapters: { [chapterId]: { state: "done" | "skipped" | "none", at } } } },
 *   plan:    { ["courseId/chapterId"]: { course, chapter, week: "2026-W45", day: 0–6 | null, at, removed? } },
 *   device:  { id, name, at }            // 最后一次推送的设备，用于同步历史
 * }
 * 合并：每个章节、每条课表各自按 at 取较新；at 相同时按固定顺序决胜，两端结果一致。
 * 取消勾选也会留下 { state: "none", at }，所以「取消」同样能同步到其他设备。 */
"use strict";

(() => {
  const VERSION = 2;
  const STATES = ["none", "skipped", "done"];
  const DEFAULT_MINUTES = 30;
  const DAY_MS = 86400000;
  let legacy = Object.create(null);

  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const time = (value) => {
    const parsed = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const iso = (ms) => new Date(ms).toISOString();

  // 本地改动的时间戳：至少比上一次记录晚 1 毫秒，本机时钟偏慢时也能覆盖自己刚同步来的旧状态。
  const stampAfter = (previous, now = Date.now()) => iso(Math.max(now, time(previous) + 1));

  // v1 → v2 升级用的旧章节 id 映射：{ courseId: { "01": "gk-start" } }，由 app.js 从课程数据注入。
  function configure(options = {}) {
    legacy = Object.create(null);
    for (const [id, map] of Object.entries(options.legacy || {})) legacy[id] = { ...map };
  }

  function emptyDoc() {
    return { version: VERSION, updatedAt: null, courses: {}, plan: {} };
  }

  function invalid(strict, message) {
    if (strict) throw new Error(message);
  }

  // —— 规范化：任意来源（v1、v2、损坏的 JSON 对象）→ v2 ——
  // strict 用于导入备份：遇到无效记录直接报错，整份拒绝；同步与本地读取用宽松模式，丢弃无效项。
  function normalize(raw, options = {}) {
    const strict = Boolean(options.strict);
    const doc = emptyDoc();
    if (!isObject(raw)) {
      invalid(strict, "文件内容不是进度备份。");
      return doc;
    }
    if (raw.version === 1) return upgrade(raw, strict);
    if (raw.version !== VERSION) {
      if (Number.isInteger(raw.version) && raw.version > VERSION) doc.newer = raw.version;
      invalid(strict, `不认识的备份版本：${raw.version}。`);
      return doc;
    }
    for (const [courseId, course] of Object.entries(isObject(raw.courses) ? raw.courses : {})) {
      if (!isObject(course) || !isObject(course.chapters)) { invalid(strict, `课程 ${courseId} 的记录格式不对。`); continue; }
      const chapters = {};
      for (const [chapterId, entry] of Object.entries(course.chapters)) {
        if (!isObject(entry) || !STATES.includes(entry.state) || !time(entry.at)) {
          invalid(strict, `章节 ${courseId}/${chapterId} 的状态或时间无效。`);
          continue;
        }
        chapters[chapterId] = { state: entry.state, at: iso(time(entry.at)) };
      }
      if (Object.keys(chapters).length) doc.courses[courseId] = { chapters };
    }
    for (const [key, item] of Object.entries(isObject(raw.plan) ? raw.plan : {})) {
      const clean = cleanPlanItem(item);
      if (!clean || key !== planKey(clean.course, clean.chapter)) { invalid(strict, `课表条目 ${key} 无效。`); continue; }
      doc.plan[key] = clean;
    }
    if (isObject(raw.device) && typeof raw.device.id === "string" && time(raw.device.at)) {
      doc.device = { id: raw.device.id.slice(0, 64), name: String(raw.device.name || "").slice(0, 40), at: iso(time(raw.device.at)) };
    }
    doc.updatedAt = latest(doc);
    return doc;
  }

  function cleanPlanItem(item) {
    if (!isObject(item) || typeof item.course !== "string" || typeof item.chapter !== "string") return null;
    if (typeof item.week !== "string" || !/^\d{4}-W\d{2}$/.test(item.week) || !time(item.at)) return null;
    const day = Number.isInteger(item.day) && item.day >= 0 && item.day <= 6 ? item.day : null;
    return { course: item.course, chapter: item.chapter, week: item.week, day, at: iso(time(item.at)), ...(item.removed ? { removed: true } : {}) };
  }

  // v1：{ version: 1, courses: { id: { status, progress, checked?: ["01", …], updatedAt } } }
  // 勾选按 legacyIds 映射到新章节；映射不了的（含旧版滑条百分比）记入 dropped，由页面提示并保留原始备份。
  function upgrade(raw, strict) {
    const doc = emptyDoc();
    doc.upgradedFrom = 1;
    doc.dropped = [];
    const fallback = time(raw.updatedAt) || 1;
    for (const [courseId, record] of Object.entries(isObject(raw.courses) ? raw.courses : {})) {
      if (!isObject(record)) { invalid(strict, `课程 ${courseId} 的记录格式不对。`); continue; }
      if (record.checked !== undefined && (!Array.isArray(record.checked) || !record.checked.every((id) => typeof id === "string"))) {
        invalid(strict, `课程 ${courseId} 的 checked 须为章节 id 数组。`);
        continue;
      }
      const at = iso(time(record.updatedAt) || fallback);
      const map = legacy[courseId] || {};
      const chapters = {};
      for (const oldId of record.checked || []) {
        const next = map[oldId];
        if (next) chapters[next] = { state: "done", at };
      }
      if (Object.keys(chapters).length) doc.courses[courseId] = { chapters };
      else if (Number(record.progress) > 0) doc.dropped.push(courseId);
    }
    doc.updatedAt = latest(doc);
    return doc;
  }

  function latest(doc) {
    let max = 0;
    for (const course of Object.values(doc.courses)) {
      for (const entry of Object.values(course.chapters)) max = Math.max(max, time(entry.at));
    }
    for (const item of Object.values(doc.plan)) max = Math.max(max, time(item.at));
    return max ? iso(max) : null;
  }

  // —— 合并 ——

  const chapterRank = (entry) => STATES.indexOf(entry.state);
  const planRank = (item) => JSON.stringify(item);

  function newer(a, b, rank) {
    if (!a) return b;
    if (!b) return a;
    const ta = time(a.at);
    const tb = time(b.at);
    if (ta !== tb) return ta > tb ? a : b;
    return rank(a) >= rank(b) ? a : b;
  }

  function merge(local, remote) {
    const doc = emptyDoc();
    const courseIds = new Set([...Object.keys(local.courses), ...Object.keys(remote.courses)]);
    for (const courseId of courseIds) {
      const mine = (local.courses[courseId] || {}).chapters || {};
      const theirs = (remote.courses[courseId] || {}).chapters || {};
      const chapters = {};
      for (const chapterId of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
        chapters[chapterId] = { ...newer(mine[chapterId], theirs[chapterId], chapterRank) };
      }
      doc.courses[courseId] = { chapters };
    }
    for (const key of new Set([...Object.keys(local.plan), ...Object.keys(remote.plan)])) {
      doc.plan[key] = { ...newer(local.plan[key], remote.plan[key], planRank) };
    }
    const device = newer(local.device, remote.device, (item) => item.id);
    if (device) doc.device = { ...device };
    doc.updatedAt = latest(doc);
    return doc;
  }

  // 只比较章节与课表（忽略 device 与 updatedAt），用来判断要不要写回本地或推送。
  function fingerprint(doc) {
    const parts = [];
    for (const courseId of Object.keys(doc.courses).sort()) {
      const chapters = doc.courses[courseId].chapters;
      for (const chapterId of Object.keys(chapters).sort()) {
        const entry = chapters[chapterId];
        parts.push(`c|${courseId}|${chapterId}|${entry.state}|${time(entry.at)}`);
      }
    }
    for (const key of Object.keys(doc.plan).sort()) {
      const item = doc.plan[key];
      parts.push(`p|${key}|${item.week}|${item.day}|${item.removed ? 1 : 0}|${time(item.at)}`);
    }
    return parts.join("\n");
  }

  const same = (a, b) => fingerprint(a) === fingerprint(b);

  // 两份文档之间「看得见」的差别：状态不同的章节数、课表里（在不在表、哪周、星期几）不同的条数。
  // 没有记录等同于 none / 不在课表，只差时间戳的不算。catalog（courseId → Set<chapterId>）可选，用来只数当前课单里的章节。
  function changes(before, after, catalog) {
    const stateIn = (doc, courseId, chapterId) => ((((doc.courses[courseId] || {}).chapters || {})[chapterId]) || {}).state || "none";
    const planIn = (doc, key) => {
      const item = doc.plan[key];
      return item && !item.removed ? `${item.week}|${item.day}` : "";
    };
    let chapters = 0;
    let plan = 0;
    for (const courseId of new Set([...Object.keys(before.courses), ...Object.keys(after.courses)])) {
      const known = catalog ? catalog.get(courseId) : null;
      if (catalog && !known) continue;
      const ids = new Set([
        ...Object.keys((before.courses[courseId] || {}).chapters || {}),
        ...Object.keys((after.courses[courseId] || {}).chapters || {})
      ]);
      for (const chapterId of ids) {
        if (known && !known.has(chapterId)) continue;
        if (stateIn(before, courseId, chapterId) !== stateIn(after, courseId, chapterId)) chapters += 1;
      }
    }
    for (const key of new Set([...Object.keys(before.plan), ...Object.keys(after.plan)])) {
      if (planIn(before, key) !== planIn(after, key)) plan += 1;
    }
    return { chapters, plan };
  }

  // —— 恢复与导入 ——

  // 恢复到某个历史版本：所有出现过的章节与课表改回目标状态，并打上新的时间戳，
  // 这样恢复本身就是一次普通改动，会正常同步到其他设备，之后也能再恢复回来。
  function restore(local, target, now = Date.now()) {
    const doc = merge(local, emptyDoc());
    const courseIds = new Set([...Object.keys(local.courses), ...Object.keys(target.courses)]);
    for (const courseId of courseIds) {
      const mine = (local.courses[courseId] || {}).chapters || {};
      const goal = (target.courses[courseId] || {}).chapters || {};
      const chapters = {};
      for (const chapterId of new Set([...Object.keys(mine), ...Object.keys(goal)])) {
        const state = goal[chapterId] ? goal[chapterId].state : "none";
        const previous = mine[chapterId];
        chapters[chapterId] = previous && previous.state === state ? { ...previous } : { state, at: stampAfter(previous && previous.at, now) };
      }
      doc.courses[courseId] = { chapters };
    }
    for (const key of new Set([...Object.keys(local.plan), ...Object.keys(target.plan)])) {
      const previous = local.plan[key];
      const goal = target.plan[key];
      const wanted = goal ? { ...goal } : previous ? { ...previous, removed: true } : null;
      if (!wanted) continue;
      const unchanged = previous && planRank({ ...previous, at: "" }) === planRank({ ...wanted, at: "" });
      doc.plan[key] = unchanged ? { ...previous } : { ...wanted, at: stampAfter(previous && previous.at, now) };
    }
    doc.updatedAt = latest(doc);
    return doc;
  }

  // 导入备份：只写入当前课单里存在的课程与章节；导入是明确的用户操作，统一打上新时间戳以覆盖其他设备。
  function importDoc(local, incoming, catalog, now = Date.now()) {
    const doc = merge(local, emptyDoc());
    const result = { doc, courses: 0, chapters: 0, plan: 0, ignored: 0 };
    for (const [courseId, course] of Object.entries(incoming.courses)) {
      const known = catalog.get(courseId);
      if (!known) { result.ignored += Object.keys(course.chapters).length; continue; }
      let touched = 0;
      for (const [chapterId, entry] of Object.entries(course.chapters)) {
        if (!known.has(chapterId)) { result.ignored += 1; continue; }
        const target = doc.courses[courseId] || (doc.courses[courseId] = { chapters: {} });
        const previous = target.chapters[chapterId];
        target.chapters[chapterId] = { state: entry.state, at: stampAfter(previous && previous.at, now) };
        touched += 1;
      }
      if (touched) { result.courses += 1; result.chapters += touched; }
    }
    for (const [key, item] of Object.entries(incoming.plan)) {
      const known = catalog.get(item.course);
      if (!known || !known.has(item.chapter)) { result.ignored += 1; continue; }
      const previous = doc.plan[key];
      doc.plan[key] = { ...item, at: stampAfter(previous && previous.at, now) };
      result.plan += 1;
    }
    doc.updatedAt = latest(doc);
    return result;
  }

  // —— 进度口径 ——
  // 课程进度 = 已完成的计入章节分钟 ÷ 计入章节总分钟。
  // 不计入：kind 为 teach 的教学产出（单独统计）、optional 选读、被标记 skipped 的章节。没有分钟数的章节按 30 分钟计。
  // 只要还有计入章节没完成，最多 99%；完成了任意一节，至少 1%。

  const chapterMinutes = (chapter) => (Number.isFinite(chapter.minutes) && chapter.minutes > 0 ? chapter.minutes : DEFAULT_MINUTES);
  const counts = (course) => (course.role || "core") === "core";

  function percent(done, total, fallbackDone) {
    if (!total) return fallbackDone ? 100 : 0;
    let value = Math.round((done / total) * 100);
    if (done < total) value = Math.min(99, value);
    if (done > 0) value = Math.max(1, value);
    return value;
  }

  function courseStats(course, chapters = {}) {
    const stats = {
      pct: 0, status: "not_started", doneMinutes: 0, totalMinutes: 0,
      learnDone: 0, learnTotal: 0, teachDone: 0, teachTotal: 0, skipped: 0, optionalDone: 0,
      lastAt: 0, next: null, nextTeach: null, anyDone: false
    };
    for (const chapter of course.outline || []) {
      const entry = chapters[chapter.id];
      const state = entry ? entry.state : "none";
      if (state === "done") {
        stats.anyDone = true;
        stats.lastAt = Math.max(stats.lastAt, time(entry.at));
      }
      if (chapter.kind === "teach") {
        stats.teachTotal += 1;
        if (state === "done") stats.teachDone += 1;
        else if (!stats.nextTeach) stats.nextTeach = chapter;
        continue;
      }
      if (chapter.optional) {
        if (state === "done") stats.optionalDone += 1;
        continue;
      }
      if (state === "skipped") { stats.skipped += 1; continue; }
      const minutes = chapterMinutes(chapter);
      stats.totalMinutes += minutes;
      stats.learnTotal += 1;
      if (state === "done") {
        stats.doneMinutes += minutes;
        stats.learnDone += 1;
      } else if (!stats.next) {
        stats.next = chapter;
      }
    }
    stats.pct = percent(stats.doneMinutes, stats.totalMinutes, stats.skipped > 0);
    stats.status = stats.pct === 100 ? "done" : stats.pct > 0 || stats.anyDone ? "in_progress" : "not_started";
    return stats;
  }

  // 一组课程的加权进度：只算 role 为 core 的课程（备选、选学、按需不计入），按分钟求和后相除。
  function groupStats(courses, statsOf) {
    let done = 0;
    let total = 0;
    let skippedAll = false;
    for (const course of courses) {
      if (!counts(course)) continue;
      const stats = statsOf(course.id);
      done += stats.doneMinutes;
      total += stats.totalMinutes;
      if (!stats.totalMinutes && stats.skipped) skippedAll = true;
    }
    return { pct: percent(done, total, skippedAll), doneMinutes: done, totalMinutes: total };
  }

  // —— 日期：按本地时间，周一为一周第一天，周编号用 ISO 8601 ——

  function startOfDay(date) {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    return day;
  }

  function weekStart(date) {
    const day = startOfDay(date);
    day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
    return day;
  }

  function weekId(date) {
    const thursday = weekStart(date);
    thursday.setDate(thursday.getDate() + 3);
    const year = thursday.getFullYear();
    const firstThursday = weekStart(new Date(year, 0, 4));
    firstThursday.setDate(firstThursday.getDate() + 3);
    const week = 1 + Math.round((thursday - firstThursday) / (7 * DAY_MS));
    return `${year}-W${String(week).padStart(2, "0")}`;
  }

  // 两个时刻相隔几个日历日（本地时间；跨夏令时用 round 吸收 23/25 小时的日子）。
  const daysBetween = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);

  const dayKey = (date) => {
    const day = new Date(date);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  };

  // —— 学习记录 ——

  // 完成记录：每个 done 章节一条，时间取它最后一次被勾上的时刻。
  function doneEvents(doc, courses) {
    const events = [];
    for (const course of courses) {
      const chapters = (doc.courses[course.id] || {}).chapters || {};
      for (const chapter of course.outline || []) {
        const entry = chapters[chapter.id];
        if (entry && entry.state === "done") events.push({ course, chapter, at: time(entry.at), minutes: chapter.kind === "teach" ? 0 : chapterMinutes(chapter) });
      }
    }
    return events.sort((a, b) => b.at - a.at);
  }

  // 近 weeks 周的热力图：返回按周排列的格子，每格 { key, date, count, future }。
  function heatmap(events, today = new Date(), weeks = 12) {
    const perDay = new Map();
    for (const event of events) {
      const key = dayKey(event.at);
      perDay.set(key, (perDay.get(key) || 0) + 1);
    }
    const first = weekStart(today);
    first.setDate(first.getDate() - (weeks - 1) * 7);
    const end = startOfDay(today).getTime();
    const columns = [];
    for (let w = 0; w < weeks; w += 1) {
      const days = [];
      for (let d = 0; d < 7; d += 1) {
        const date = new Date(first);
        date.setDate(first.getDate() + w * 7 + d);
        const key = dayKey(date);
        days.push({ key, date, count: perDay.get(key) || 0, future: date.getTime() > end });
      }
      columns.push(days);
    }
    return columns;
  }

  function summarizeWeek(events, today = new Date()) {
    const current = weekId(today);
    const thisWeek = events.filter((event) => weekId(event.at) === current);
    return {
      count: thisWeek.length,
      minutes: thisWeek.reduce((sum, event) => sum + event.minutes, 0),
      lastAt: events.length ? events[0].at : 0,
      totalCount: events.length,
      totalMinutes: events.reduce((sum, event) => sum + event.minutes, 0)
    };
  }

  // —— 课表 ——

  const planKey = (course, chapter) => `${course}/${chapter}`;

  // 本周课表：本周排的条目 + 以前排了但还没完成的（顺延）；移出的不显示。
  function weekPlan(doc, current, isDone) {
    return Object.entries(doc.plan)
      .filter(([, item]) => !item.removed && (item.week === current || (item.week < current && !isDone(item))))
      .map(([key, item]) => ({ key, ...item, carried: item.week !== current }));
  }

  // —— 日历导出（RFC 5545）：每节一个全天事件；没选星期几的放在周日，标「本周内」 ——

  function icsEscape(text) {
    return String(text).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  // 按 UTF-8 字节折行：每行不超过 75 字节，续行以一个空格开头，不拆开多字节字符。
  function icsFold(line) {
    const encoder = new TextEncoder();
    const out = [];
    let current = "";
    let size = 0;
    for (const char of line) {
      const bytes = encoder.encode(char).length;
      if (size + bytes > (out.length ? 74 : 75)) {
        out.push(current);
        current = "";
        size = 0;
      }
      current += char;
      size += bytes;
    }
    out.push(current);
    return out.join("\r\n ");
  }

  const icsDate = (date) => dayKey(date).replace(/-/g, "");
  const icsStamp = (ms) => iso(ms).replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  function buildIcs(events, options = {}) {
    const now = options.now || Date.now();
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//manmanxue//learning-courses//ZH",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${icsEscape(options.name || "慢慢学")}`
    ];
    for (const event of events) {
      const end = new Date(event.date);
      end.setDate(end.getDate() + 1);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${event.uid}`,
        `DTSTAMP:${icsStamp(now)}`,
        `DTSTART;VALUE=DATE:${icsDate(event.date)}`,
        `DTEND;VALUE=DATE:${icsDate(end)}`,
        `SUMMARY:${icsEscape(event.summary)}`,
        ...(event.description ? [`DESCRIPTION:${icsEscape(event.description)}`] : []),
        ...(event.url ? [`URL:${event.url}`] : []),
        "TRANSP:TRANSPARENT",
        "END:VEVENT"
      );
    }
    lines.push("END:VCALENDAR");
    return lines.map(icsFold).join("\r\n") + "\r\n";
  }

  // 浏览器里 globalThis 就是 window；Node 测试里直接挂在 globalThis 上。
  globalThis.ProgressModel = {
    VERSION,
    STATES,
    DEFAULT_MINUTES,
    configure,
    emptyDoc,
    normalize,
    merge,
    same,
    changes,
    restore,
    importDoc,
    stampAfter,
    time,
    counts,
    chapterMinutes,
    courseStats,
    groupStats,
    weekStart,
    weekId,
    daysBetween,
    dayKey,
    doneEvents,
    heatmap,
    summarizeWeek,
    planKey,
    weekPlan,
    buildIcs
  };
})();
