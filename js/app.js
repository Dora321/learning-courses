/* 慢慢学：课程渲染、进度记录与 JSON 备份。进度先写本地，多端同步交给 js/sync.js。
 * 有大纲的课程以「章节勾选」为主输入，进度由勾选数推算；没有大纲的课程沿用滑条与状态按钮。 */
"use strict";

(() => {
  const Sync = window.ProgressSync;
  const STORAGE_KEY = (window.SYNC_CONFIG && window.SYNC_CONFIG.progressKey) || "learning-courses-progress-v1";
  const STATES = { not_started: "待开始", in_progress: "学习中", done: "已完成" };
  const FILTERS = [["all", "全部"], ["in_progress", "学习中"], ["not_started", "待开始"], ["done", "已完成"]];
  const TRACKS = [
    { name: "ESP32主线（MicroPython）", caption: "教学主线：极客侠 + 官方文档 + 物联网" },
    { name: "课堂工具", caption: "Mind+ × Arduino，日常课堂教具" },
    { name: "端侧 AI", caption: "K230 CanMV 视觉与端侧推理" },
    { name: "仿真实验室", caption: "烧板前的浏览器练手场" },
    { name: "老师补强 · 语言与电路基础", caption: "读懂代码，也读懂电路" },
    { name: "老师补强 · STM32嵌入式", caption: "二选一精学，建立外设与中断直觉" },
    { name: "老师补强 · FreeRTOS与网络", caption: "理解任务协作与设备联网" },
    { name: "老师补强 · 硬件与PCB", caption: "并行支线：从器件到自己的小板" }
  ];
  const SYNC_TEXT = {
    off: ["未配置令牌", "粘贴 GitHub 令牌后，手机和电脑共用同一份进度。", "未同步"],
    pending: ["等待同步…", "改动会在 1 秒后推送到 Gist。", "待同步"],
    syncing: ["同步中…", "正在与 GitHub Gist 交换进度。", "同步中"],
    ok: ["已同步", "进度已合并到私有 Gist，其他设备打开页面即自动获取。", "已同步"],
    error: ["同步失败", "", "同步失败"],
    unavailable: ["同步不可用", "", "不可用"]
  };

  let courses = [];
  let tracks = [];
  let records = Object.create(null);
  let filter = "all";
  let pendingImport = null;
  let toastTimer;
  const cards = new Map();
  const filterButtons = new Map();

  const $ = (id) => document.getElementById(id);
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const statusOf = (progress) => (progress === 0 ? "not_started" : progress === 100 ? "done" : "in_progress");
  const stamp = (record) => (record.updatedAt ? Date.parse(record.updatedAt) || 0 : 0);
  const pad = (value) => String(value).padStart(2, "0");
  const clock = (ms) => {
    const date = new Date(ms);
    const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    return date.toDateString() === new Date().toDateString() ? time : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  };
  const outlineOf = (course) => (Array.isArray(course.outline) ? course.outline : []);
  const defaults = () => Object.fromEntries(courses.map((course) => [course.id, toRecord(course, { progress: course.progress || 0, checked: [] })]));

  function notify(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 5000);
  }

  function setSaveState(message, isError = false) {
    $("save-state").textContent = message;
    $("save-state").classList.toggle("error", isError);
  }

  // —— 本地记录 ——

  // 统一生成一门课的记录 { status, progress, checked?, updatedAt? }。
  // 有大纲：checked 只保留大纲内的章节（按大纲顺序），progress = round(已勾选 / 章节数 × 100)，
  // 并保证只有全部勾选才是 100%、勾了任一节至少 1%；旧记录没有 checked 时沿用原进度，直到第一次勾选。
  // 无大纲：沿用旧逻辑，进度就是记录里的百分比。
  function toRecord(course, source) {
    const outline = outlineOf(course);
    let progress = source.progress;
    let checked;
    if (outline.length && Array.isArray(source.checked)) {
      const marks = new Set(source.checked);
      checked = outline.map((item) => String(item.id)).filter((id) => marks.has(id));
      progress = Math.round((checked.length / outline.length) * 100);
      if (checked.length < outline.length) progress = Math.min(99, progress);
      if (checked.length) progress = Math.max(1, progress);
    }
    return {
      status: statusOf(progress),
      progress,
      ...(checked ? { checked } : {}),
      ...(source.updatedAt ? { updatedAt: source.updatedAt } : {})
    };
  }

  // 只把被改动过（带 updatedAt）的课程写入本地与云端，未动过的课程不会覆盖其他设备的进度。
  function progressDoc() {
    const touched = Object.fromEntries(Object.entries(records).filter(([, record]) => record.updatedAt));
    return Sync.normalize({ version: 1, courses: touched });
  }

  function saveProgress(message) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progressDoc()));
      setSaveState(message || "已保存到此浏览器 · " + clock(Date.now()));
      return true;
    } catch {
      setSaveState("本地保存失败，刷新前请导出 JSON 备份", true);
      return false;
    }
  }

  // 把进度文档中属于当前课单的课程写入内存；返回进度或章节勾选发生变化的课程数。
  function applyCourses(courseMap) {
    let changed = 0;
    for (const course of courses) {
      if (!courseMap[course.id]) continue;
      const before = records[course.id];
      const record = toRecord(course, courseMap[course.id]);
      if (before.progress !== record.progress || String(before.checked) !== String(record.checked)) changed += 1;
      records[course.id] = record;
    }
    return changed;
  }

  function loadProgress() {
    records = defaults();
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); }
    catch {
      setSaveState("浏览器禁止本地存储：进度无法保存，请及时导出备份", true);
      return;
    }
    if (!saved) return;
    try {
      applyCourses(Sync.normalize(JSON.parse(saved)).courses);
      setSaveState("已恢复上次的学习进度 · 自动保存已开启");
    } catch {
      setSaveState("无法读取本地记录，请检查浏览器存储或导入备份", true);
      notify("未能读取原有进度，暂显示初始课单。");
    }
  }

  function commit(id, record) {
    records[id] = record;
    updateCard(id);
    updateSummary();
    saveProgress();
    Sync.schedule();
  }

  // 主入口：勾选或取消一个章节，整课记录带上新的 updatedAt，同步时较新的一端整条覆盖。
  function toggleChapter(course, chapterId, done) {
    const marks = new Set(records[course.id].checked);
    if (done) marks.add(chapterId);
    else marks.delete(chapterId);
    commit(course.id, toRecord(course, { checked: [...marks], updatedAt: new Date().toISOString() }));
  }

  // 无大纲课程的旧入口：滑条与状态按钮直接改百分比。
  function changeProgress(id, progress) {
    commit(id, { status: statusOf(progress), progress, updatedAt: new Date().toISOString() });
  }

  function refreshAll() {
    courses.forEach((course) => updateCard(course.id));
    updateSummary();
    applyFilter();
  }

  // —— 总览 ——

  function average(list) {
    return list.length ? Math.round(list.reduce((sum, course) => sum + records[course.id].progress, 0) / list.length) : 0;
  }

  function updateSummary() {
    const overall = average(courses);
    $("overall-value").textContent = overall;
    $("ring-value").style.strokeDashoffset = String(100 - overall);
    $("ring-value").classList.toggle("is-empty", overall === 0);
    $("overall-ring").setAttribute("aria-valuenow", overall);
    const counts = { all: courses.length, not_started: 0, in_progress: 0, done: 0 };
    courses.forEach((course) => { counts[records[course.id].status] += 1; });
    $("done-count").textContent = counts.done;
    $("active-count").textContent = counts.in_progress;
    $("pending-count").textContent = counts.not_started;
    filterButtons.forEach((button, key) => { button.lastChild.textContent = counts[key]; });
    for (const track of tracks) {
      const done = track.courses.filter((course) => records[course.id].status === "done").length;
      const value = average(track.courses);
      track.meter.value.textContent = value + "%";
      track.meter.done.textContent = `${done}/${track.courses.length}`;
      track.meter.bar.style.width = value + "%";
      track.head.stat.textContent = `${done} / ${track.courses.length} 已完成 · ${value}%`;
      track.head.bar.style.width = value + "%";
    }
    renderNext();
  }

  function renderTrackMeters() {
    const list = $("track-meters");
    for (const track of tracks) {
      const item = element("li", "track-meter");
      item.dataset.track = track.key;
      const link = element("a", "track-meter-link");
      link.href = "#track-" + track.key;
      const top = element("div", "track-meter-top");
      const name = element("span", "track-meter-name");
      name.append(element("i", "track-dot"), document.createTextNode(track.name));
      const done = element("span", "track-meter-done");
      const value = element("span", "track-meter-value");
      top.append(name, done, value);
      const bar = element("i");
      const rail = element("span", "bar");
      rail.append(bar);
      link.append(top, rail);
      item.append(link);
      list.append(item);
      track.meter = { done, value, bar };
    }
  }

  // 「接着学」：最近更新的学习中课程；没有则按顺序取第一门待开始的课程。
  function renderNext() {
    const active = courses.filter((course) => records[course.id].status === "in_progress")
      .sort((a, b) => stamp(records[b.id]) - stamp(records[a.id]) || a.order - b.order);
    const course = active[0] || courses.find((item) => records[item.id].status === "not_started");
    $("next-label").textContent = active.length ? "接着学" : course ? "下一门" : "全部完成";
    const body = $("next-body");
    if (!course) {
      body.replaceChildren(element("p", "next-empty", `${courses.length} 门课全部完成，了不起。挑一门再精读一遍吧。`));
      return;
    }
    const record = records[course.id];
    const track = tracks.find((item) => item.name === course.track);
    const wrap = element("div", "next-course");
    wrap.dataset.track = track ? track.key : 1;
    const tag = element("span", "track-tag");
    tag.append(element("i", "track-dot"), document.createTextNode(course.track));
    const outline = outlineOf(course);
    const learned = record.checked || [];
    const meta = element("p", "next-meta", `${course.teacher} · ${record.progress}%` + (outline.length ? ` · 已学 ${learned.length}/${outline.length} 节` : ""));
    const rail = element("span", "bar");
    const fill = element("i");
    fill.style.width = record.progress + "%";
    rail.append(fill);
    const upcoming = outline.find((item) => !learned.includes(String(item.id)));
    const chapter = upcoming ? element("p", "next-chapter") : null;
    if (chapter) chapter.append(element("span", "", "下一节"), document.createTextNode(upcoming.title));
    const actions = element("div", "next-actions");
    const first = safeLinks(course)[0];
    if (first) {
      const open = element("a", "button button-primary button-sm", record.progress ? "继续学习 ↗" : "开始学习 ↗");
      Object.assign(open, { href: first.href, target: "_blank", rel: "noopener noreferrer" });
      actions.append(open);
    }
    const locate = element("a", "button button-quiet button-sm", "查看卡片");
    locate.href = "#course-" + course.id;
    locate.addEventListener("click", (event) => {
      event.preventDefault();
      focusCard(course.id);
    });
    actions.append(locate);
    wrap.append(tag, element("h3", "next-title", course.title), meta, rail, ...(chapter ? [chapter] : []), actions);
    body.replaceChildren(wrap);
  }

  function focusCard(id) {
    if (cards.get(id).card.hidden) setFilter("all");
    const { card } = cards.get(id);
    card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    card.classList.remove("flash");
    void card.offsetWidth;
    card.classList.add("flash");
  }

  // —— 课程卡片 ——

  function safeLinks(course) {
    const links = [];
    for (const link of course.urls || []) {
      try {
        const url = new URL(link.url);
        if (url.protocol === "https:" || url.protocol === "http:") links.push({ label: link.label, href: url.href });
      } catch { /* 跳过无效链接 */ }
    }
    return links;
  }

  function updateCard(id) {
    const parts = cards.get(id);
    const record = records[id];
    parts.card.dataset.status = record.status;
    parts.badge.textContent = record.status === "done" ? "✓ 已完成" : STATES[record.status];
    parts.output.value = record.progress + "%";
    if (parts.boxes) {
      updateOutline(parts, record);
      return;
    }
    parts.radios[record.status].checked = true;
    parts.slider.value = record.progress;
    parts.slider.style.setProperty("--fill", record.progress + "%");
    parts.slider.setAttribute("aria-valuetext", `${record.progress}%，${STATES[record.status]}`);
  }

  function updateOutline({ meter, fill, count, hint, boxes }, record) {
    const marks = new Set(record.checked);
    boxes.forEach((box, id) => { box.checked = marks.has(id); });
    const text = `已学 ${marks.size}/${boxes.size}`;
    count.textContent = text;
    fill.style.width = record.progress + "%";
    meter.setAttribute("aria-valuenow", record.progress);
    meter.setAttribute("aria-valuetext", `${record.progress}%，${text} 节，${STATES[record.status]}`);
    // 旧版只有滑条百分比、没有勾选记录：先保留原进度，并说明下一次勾选会改按大纲重算。
    hint.hidden = Boolean(record.checked) || record.progress === 0;
    hint.textContent = `当前 ${record.progress}% 来自旧版滑条记录，勾选任一章节后改按大纲计算。`;
  }

  function renderOutline(course, parts) {
    const details = element("details", "outline");
    const summary = element("summary");
    const count = element("span", "outline-count");
    summary.append(element("span", "outline-label", "课程大纲"), count);
    const hint = element("p", "outline-hint");
    const list = element("ol", "outline-list");
    list.setAttribute("aria-label", course.title + "：章节勾选");
    const boxes = new Map();
    outlineOf(course).forEach((item, index) => {
      const id = String(item.id);
      const label = element("label", "outline-item");
      const box = element("input");
      box.type = "checkbox";
      box.addEventListener("change", () => toggleChapter(course, id, box.checked));
      label.append(box, element("span", "outline-no", pad(index + 1)), element("span", "outline-title", item.title));
      const row = element("li");
      row.append(label);
      list.append(row);
      boxes.set(id, box);
    });
    details.append(summary, hint, list);
    Object.assign(parts, { count, hint, boxes });
    return details;
  }

  function renderCard(course, index) {
    const card = element("article", "course-card reveal");
    card.id = "course-" + course.id;
    card.style.setProperty("--i", index);
    card.setAttribute("aria-labelledby", "title-" + course.id);
    const head = element("div", "card-head");
    head.append(element("span", "course-index", pad(course.order)), element("span", "status-badge"));
    const title = element("h4", "course-title", course.title);
    title.id = "title-" + course.id;
    const meta = element("p", "course-meta");
    meta.append(element("span", "", course.teacher), element("span", "course-platform", course.platform));
    const links = element("div", "course-links");
    for (const link of safeLinks(course)) {
      const anchor = element("a", "course-link", link.label);
      Object.assign(anchor, { href: link.href, target: "_blank", rel: "noopener noreferrer" });
      anchor.setAttribute("aria-label", `${course.title}：${link.label}（新标签页打开）`);
      links.append(anchor);
    }

    const progress = element("div", "course-progress");
    const row = element("div", "progress-row");
    const output = element("output", "course-value");
    const parts = { card, badge: head.lastChild, output };
    card.append(head, title, meta, element("p", "course-note", course.note), links, progress);
    cards.set(course.id, parts);

    // 有大纲：进度条只读，勾选章节是唯一输入。
    if (outlineOf(course).length) {
      row.append(element("span", "", "学习进度"), output);
      const meter = element("span", "bar course-bar");
      meter.setAttribute("role", "progressbar");
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", "100");
      meter.setAttribute("aria-label", course.title + "：学习进度");
      const fill = element("i");
      meter.append(fill);
      Object.assign(parts, { meter, fill });
      progress.append(row, meter, renderOutline(course, parts));
      updateCard(course.id);
      return card;
    }

    // 无大纲（兜底）：保留旧版滑条与状态按钮。
    const label = element("label", "", "学习进度");
    label.htmlFor = "progress-" + course.id;
    output.htmlFor = label.htmlFor;
    row.append(label, output);
    const slider = element("input", "course-slider");
    Object.assign(slider, { type: "range", min: "0", max: "100", step: "1", id: label.htmlFor });
    slider.addEventListener("input", () => changeProgress(course.id, Number(slider.value)));
    const segmented = element("div", "segmented");
    segmented.setAttribute("role", "radiogroup");
    segmented.setAttribute("aria-label", course.title + "：学习状态");
    const radios = {};
    for (const [value, text] of Object.entries(STATES)) {
      const option = element("label", "segment");
      const radio = element("input");
      Object.assign(radio, { type: "radio", name: "status-" + course.id, value });
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        const current = records[course.id].progress;
        changeProgress(course.id, value === "done" ? 100 : value === "not_started" ? 0 : Math.min(99, Math.max(1, current)));
      });
      option.append(radio, element("span", "", text));
      segmented.append(option);
      radios[value] = radio;
    }
    progress.append(row, slider, segmented);
    Object.assign(parts, { radios, slider });
    updateCard(course.id);
    return card;
  }

  function buildTracks() {
    const names = [...new Set(courses.map((course) => course.track))];
    const known = TRACKS.filter((track) => names.includes(track.name));
    const extra = names.filter((name) => !TRACKS.some((track) => track.name === name)).map((name) => ({ name, caption: "" }));
    return [...known, ...extra].map((track, index) => ({
      ...track,
      key: index + 1,
      courses: courses.filter((course) => course.track === track.name)
    }));
  }

  function renderCourses() {
    const groups = $("course-groups");
    const nav = $("track-nav");
    let index = 0;
    for (const track of tracks) {
      const section = element("section", "track-section");
      section.id = "track-" + track.key;
      section.dataset.track = track.key;
      section.setAttribute("aria-labelledby", "track-title-" + track.key);
      const head = element("header", "track-head");
      const titles = element("div", "track-titles");
      const title = element("h3", "", track.name);
      title.id = "track-title-" + track.key;
      titles.append(element("span", "track-no", "TRACK " + pad(track.key)), title);
      if (track.caption) titles.append(element("p", "track-caption", track.caption));
      const meter = element("div", "track-progress");
      const stat = element("span", "track-stat");
      const rail = element("span", "bar");
      const bar = element("i");
      rail.append(bar);
      meter.append(stat, rail);
      head.append(element("span", "track-bar"), titles, meter);
      const grid = element("div", "cards");
      track.courses.forEach((course) => grid.append(renderCard(course, index++ % 6)));
      section.append(head, grid);
      groups.append(section);
      track.section = section;
      track.head = { stat, bar };

      const chip = element("a", "track-chip");
      chip.href = "#track-" + track.key;
      chip.dataset.track = track.key;
      chip.append(element("i", "track-dot"), document.createTextNode(track.name));
      nav.append(chip);
    }
    $("course-count").textContent = pad(courses.length);
    $("course-total").textContent = courses.length + " 门课程";
  }

  // —— 状态筛选：只在切换筛选、导入或云端合并后重排，勾选章节时不让卡片突然消失 ——

  function renderFilter() {
    const group = $("status-filter");
    for (const [key, text] of FILTERS) {
      const button = element("button", "filter-button");
      button.type = "button";
      button.append(element("span", "", text), element("span", "filter-count", "0"));
      button.addEventListener("click", () => setFilter(key));
      group.append(button);
      filterButtons.set(key, button);
    }
  }

  function setFilter(key) {
    filter = key;
    applyFilter();
  }

  function applyFilter() {
    filterButtons.forEach((button, key) => button.setAttribute("aria-pressed", String(key === filter)));
    let visible = 0;
    for (const track of tracks) {
      let shown = 0;
      for (const course of track.courses) {
        const hide = filter !== "all" && records[course.id].status !== filter;
        cards.get(course.id).card.hidden = hide;
        if (!hide) shown += 1;
      }
      track.section.hidden = shown === 0;
      visible += shown;
    }
    $("empty-state").hidden = visible > 0;
  }

  // —— 学习路线 ——

  function routeTrack(title) {
    if (/STM32/i.test(title)) return 2;
    if (/RTOS|LwIP|网络/i.test(title)) return 3;
    return 1;
  }

  function splitStep(text) {
    const parts = text.split(/\s*\+\s*/).map((part) => {
      const match = part.match(/^(.*?)（(.*)）$/);
      return match ? { title: match[1].trim(), detail: match[2].trim() } : { title: part.trim(), detail: "" };
    });
    return { title: parts.map((part) => part.title).join(" + "), detail: parts.map((part) => part.detail).filter(Boolean).join(" · ") };
  }

  function renderPlan(data) {
    let step = 0;
    for (const line of data.studyPlan.trim().split("\n")) {
      const text = line.trim().replace(/^→\s*/, "");
      if (!text) continue;
      if (text.startsWith("并行支线：")) {
        const flow = $("study-branch");
        text.slice(5).split(/\s*→\s*/).forEach((part, index) => {
          if (index) flow.append(element("span", "branch-arrow", "→"));
          const { title, detail } = splitStep(part);
          const chip = element("span", "branch-step");
          chip.append(element("strong", "", title));
          if (detail) chip.append(element("small", "", detail));
          flow.append(chip);
        });
        continue;
      }
      const { title, detail } = splitStep(text);
      const item = element("li", "route-step reveal");
      item.dataset.track = routeTrack(title);
      item.style.setProperty("--i", step);
      step += 1;
      item.append(element("span", "route-no", pad(step)), element("strong", "", title));
      if (detail) item.append(element("small", "", detail));
      $("study-route").append(item);
    }
    $("study-context").textContent = data.studyContext;
  }

  // —— JSON 备份 ——

  function validateBackup(raw) {
    if (!isObject(raw) || raw.version !== 1 || !isObject(raw.courses)) {
      throw new Error("备份格式不正确，请选择本站导出的版本 1 JSON 文件。");
    }
    const byId = new Map(courses.map((course) => [course.id, course]));
    const valid = Object.create(null);
    let ignored = 0;
    for (const [id, record] of Object.entries(raw.courses)) {
      const course = byId.get(id);
      if (!course) { ignored += 1; continue; }
      if (!isObject(record) || !Object.hasOwn(STATES, record.status) ||
          !Number.isInteger(record.progress) || record.progress < 0 || record.progress > 100) {
        throw new Error("备份中有无效进度：状态须有效，百分比须为 0–100 的整数。原记录未更改。");
      }
      if (record.status !== statusOf(record.progress)) {
        throw new Error("备份中的状态与进度不一致（0% 待开始，100% 已完成）。原记录未更改。");
      }
      if (record.checked !== undefined && (!Array.isArray(record.checked) || !record.checked.every((item) => typeof item === "string"))) {
        throw new Error("备份中有无效的大纲勾选：checked 须为章节 id 字符串数组。原记录未更改。");
      }
      // 带 checked 的记录以勾选为准重新推算进度；旧版备份没有 checked 时沿用其百分比。
      valid[id] = toRecord(course, { progress: record.progress, checked: record.checked });
    }
    if (!Object.keys(valid).length) throw new Error("备份中没有与当前课单匹配的课程。原记录未更改。");
    return { records: valid, ignored };
  }

  function exportProgress() {
    const backup = { version: 1, updatedAt: new Date().toISOString(), courses: records };
    const blob = new Blob([JSON.stringify(backup, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = element("a");
    anchor.href = url;
    anchor.download = `learning-courses-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notify("已发起进度备份下载，请在浏览器下载记录中查看。");
  }

  async function prepareImport(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    pendingImport = null;
    $("import-button").disabled = true;
    try {
      if (file.size > 1024 * 1024) throw new Error("文件超过 1 MB，请选择本站导出的进度 JSON。");
      let raw;
      try { raw = JSON.parse((await file.text()).replace(/^﻿/, "")); }
      catch { throw new Error("无法解析 JSON 文件，原有进度未更改。"); }
      pendingImport = validateBackup(raw);
      const count = Object.keys(pendingImport.records).length;
      $("import-description").textContent = `将用「${file.name}」更新 ${count} 门课程的进度与大纲勾选。` + (pendingImport.ignored ? `另有 ${pendingImport.ignored} 条不匹配记录，将忽略。` : "");
      $("import-dialog").returnValue = "";
      $("import-dialog").showModal();
    } catch (error) {
      notify(error.message);
    } finally {
      $("import-button").disabled = false;
    }
  }

  function finishImport() {
    if ($("import-dialog").returnValue === "confirm" && pendingImport) {
      // 导入是明确的用户操作：以当前时间标记，确保同步时覆盖其他设备的旧记录。
      const now = new Date().toISOString();
      for (const [id, record] of Object.entries(pendingImport.records)) records[id] = { ...record, updatedAt: now };
      refreshAll();
      const saved = saveProgress();
      Sync.schedule();
      notify(saved ? "进度已导入并保存，接着上次的地方继续学吧。" : "进度已导入，但本地保存失败。请导出备份后再关闭页面。");
    }
    pendingImport = null;
  }

  // —— 同步面板 ——

  function renderSyncStatus(status) {
    const [title, detail, short] = SYNC_TEXT[status.phase] || SYNC_TEXT.off;
    let fullTitle = title;
    let fullDetail = status.message || detail;
    let shortText = short;
    if (status.phase === "ok" && status.lastSyncedAt) {
      fullTitle = "已同步 · " + clock(status.lastSyncedAt);
      shortText = "已同步 " + clock(status.lastSyncedAt);
    }
    if (status.phase === "error" && status.lastSyncedAt) fullDetail += ` · 上次成功 ${clock(status.lastSyncedAt)}`;
    document.querySelectorAll("[data-sync]").forEach((node) => { node.dataset.phase = status.phase; });
    document.querySelectorAll("[data-sync-title]").forEach((node) => { node.textContent = fullTitle; });
    document.querySelectorAll("[data-sync-detail]").forEach((node) => { node.textContent = fullDetail; });
    $("sync-short").textContent = shortText;
    $("sync-open").setAttribute("aria-label", "多端同步：" + fullTitle);
    $("sync-now").disabled = status.phase === "syncing";
    renderTokenState();
  }

  function renderTokenState() {
    const hasToken = Sync.hasToken();
    $("token-saved").hidden = !hasToken;
    $("token-mask").textContent = Sync.maskedToken();
    if (!hasToken) $("token-form").hidden = false;
    document.querySelectorAll("[data-open-sync]").forEach((button) => {
      button.textContent = hasToken ? "同步设置" : "设置同步";
    });
  }

  function openSync() {
    $("token-error").hidden = true;
    $("token-form").hidden = Sync.hasToken();
    $("sync-dialog").showModal();
    if (!Sync.hasToken()) $("token-input").focus();
  }

  function setupSync() {
    const dialog = $("sync-dialog");
    $("sync-open").addEventListener("click", openSync);
    document.querySelectorAll("[data-open-sync]").forEach((button) => button.addEventListener("click", openSync));
    $("sync-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    $("token-form").addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        Sync.setToken($("token-input").value);
      } catch (error) {
        $("token-error").textContent = error.message;
        $("token-error").hidden = false;
        return;
      }
      $("token-input").value = "";
      $("token-error").hidden = true;
      $("token-form").hidden = true;
      notify("令牌已保存在此浏览器，正在同步…");
    });
    $("token-replace").addEventListener("click", () => {
      $("token-form").hidden = false;
      $("token-input").focus();
    });
    $("token-clear").addEventListener("click", () => {
      Sync.clearToken();
      $("token-input").focus();
      notify("已清除此浏览器中的令牌，本地进度保留。");
    });
    $("sync-now").addEventListener("click", () => Sync.syncNow());
    Sync.subscribe(renderSyncStatus);
    Sync.start({
      read: progressDoc,
      write(doc) {
        const changed = applyCourses(doc.courses);
        refreshAll();
        saveProgress(changed ? `已合并其他设备的进度 · ${clock(Date.now())}` : undefined);
        if (changed) notify(`已从云端同步 ${changed} 门课程的进度。`);
      }
    });
  }

  function attachEvents() {
    $("export-button").addEventListener("click", exportProgress);
    $("import-button").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", prepareImport);
    $("import-dialog").addEventListener("close", finishImport);
    // 同一浏览器的其他标签页改了进度：直接读取（云端推送由那个标签页负责）。
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try {
        const doc = event.newValue ? Sync.normalize(JSON.parse(event.newValue)) : null;
        records = defaults();
        if (doc) applyCourses(doc.courses);
        refreshAll();
        setSaveState("已同步此浏览器其他标签页的进度");
      } catch { notify("其他标签页的记录格式异常，当前进度保持不变。"); }
    });
  }

  async function init() {
    const data = window.COURSE_DATA;
    if (!data || !Array.isArray(data.courses)) throw new Error("课程数据未加载，请确认 js/courses-data.js 文件完整。");
    if (!Sync) throw new Error("同步模块未加载，请确认 js/sync.js 文件完整。");
    courses = data.courses;
    // 直接打开使用脚本快照；通过 HTTP 部署时以 JSON 为准。
    if (location.protocol === "http:" || location.protocol === "https:") {
      try {
        const response = await fetch("data/courses.json", { cache: "no-cache" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const fetched = await response.json();
        if (!Array.isArray(fetched) || !fetched.length) throw new Error("empty course data");
        courses = fetched;
      } catch {
        notify("暂时无法读取课程 JSON，已使用随页面附带的课单。");
      }
    }
    courses = [...courses].sort((a, b) => a.order - b.order);
    tracks = buildTracks();
    $("today-label").textContent = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
    loadProgress();
    renderPlan(data);
    renderTrackMeters();
    renderFilter();
    renderCourses();
    refreshAll();
    attachEvents();
    setupSync();
  }

  init().catch((error) => {
    $("error-banner").textContent = "页面加载失败：" + error.message;
    $("error-banner").hidden = false;
  });
})();
