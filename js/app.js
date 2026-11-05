/* 慢慢学：页面渲染与交互。进度规则在 js/model.js，多端同步在 js/sync.js，课程数据在 js/courses-data.js（由脚本生成）。
 * 章节勾选是唯一输入：每次改动记录 { state, at }，进度按分钟加权推算；本地先保存，再交给同步模块推送。 */
"use strict";

(() => {
  const Sync = window.ProgressSync;
  const Model = window.ProgressModel;
  const config = window.SYNC_CONFIG || {};
  const STORAGE_KEY = config.progressKey || "learning-courses-progress-v1";
  const BACKUP_KEY = STORAGE_KEY + "-backup-v1";
  const UI_KEY = "learning-courses-ui";
  const STATES = { not_started: "待开始", in_progress: "学习中", done: "已完成" };
  const FILTERS = [["all", "全部"], ["in_progress", "学习中"], ["not_started", "待开始"], ["done", "已完成"]];
  const ROLE_NAMES = { elective: "选学", alternative: "备选" };
  const LINK_KINDS = [["official", "官方"], ["video", "视频"], ["docs", "文档"], ["tool", "工具"]];
  const OUTLINE_SOURCES = { bilibili: "对齐 B 站目录", series: "对齐文档系列", custom: "自定义大纲" };
  const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const SYNC_TEXT = {
    off: ["未配置令牌", "粘贴 GitHub 令牌后，Mac 和 Windows 共用同一份进度。", "未同步"],
    pending: ["等待同步…", "改动会在 1 秒后推送到 Gist。", "待同步"],
    syncing: ["同步中…", "正在与 GitHub Gist 交换进度。", "同步中"],
    ok: ["已同步", "已按章节合并到 secret Gist，其他设备打开页面即自动获取。", "已同步"],
    error: ["同步失败", "", "同步失败"],
    unavailable: ["同步不可用", "", "不可用"]
  };

  let courses = [];
  let tiers = [];
  let tracks = [];
  let route = null;
  let doc = null;
  let filter = "all";
  let ui = { open: {}, groups: {} };
  let pendingImport = null;
  let toastTimer;
  const byId = new Map();
  const stats = new Map();
  const catalog = new Map();
  const cards = new Map();
  const chapterNodes = new Map();
  const tierParts = new Map();
  const filterButtons = new Map();

  const $ = (id) => document.getElementById(id);
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const pad = (value) => String(value).padStart(2, "0");
  const trim = (value) => value.toFixed(1).replace(/\.0$/, "");
  const duration = (minutes) => (minutes < 60 ? `${Math.round(minutes)} 分钟` : `${trim(minutes / 60)} 小时`);
  const hoursOf = (minutes) => trim(minutes / 60);
  const clock = (ms) => {
    const date = new Date(ms);
    const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    return date.toDateString() === new Date().toDateString() ? time : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  };
  const shortDate = (date) => `${date.getMonth() + 1}月${date.getDate()}日`;
  const thisWeek = () => Model.weekId(new Date());
  const trackOf = (course) => tracks.find((track) => track.id === course.track);
  const tierOf = (course) => tiers.find((tier) => tier.id === course.tier);
  const chapterOf = (courseId, chapterId) => (byId.get(courseId) || { outline: [] }).outline.find((chapter) => chapter.id === chapterId);
  const chaptersOf = (courseId) => (doc.courses[courseId] || {}).chapters || {};
  const stateOf = (courseId, chapterId) => (chaptersOf(courseId)[chapterId] || {}).state || "none";
  const statsOf = (id) => stats.get(id);
  const roleText = (course) => (course.role === "core" ? "" : `${course.roleLabel || ROLE_NAMES[course.role]} · 不计入`);

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch { return null; }
  }

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

  // 重绘一块区域时保住键盘焦点：按 data-focus 找回同一个按钮。
  function keepFocus(container, render) {
    const active = document.activeElement;
    const key = active && container.contains(active) ? active.dataset.focus : null;
    render();
    if (key) {
      const again = container.querySelector(`[data-focus="${CSS.escape(key)}"]`);
      if (again) again.focus();
    }
  }

  // 由代码展开 / 收起 <details>：toggle 事件是异步派发的，先记下「这次是代码改的」，
  // 由事件处理函数自己认领并清掉，这样不会把筛选、定位造成的开合误存成用户偏好。
  function setOpen(details, open) {
    if (details.open === open) return;
    details.dataset.auto = String(open);
    details.open = open;
  }

  function isAutoToggle(details) {
    if (details.dataset.auto === undefined) return false;
    const expected = details.dataset.auto === "true";
    delete details.dataset.auto;
    return details.open === expected;
  }

  // —— 本地记录 ——

  function readUi() {
    try {
      const saved = JSON.parse(localStorage.getItem(UI_KEY) || "null");
      if (saved && typeof saved === "object") ui = { open: saved.open || {}, groups: saved.groups || {} };
    } catch { /* 界面偏好丢了无所谓 */ }
  }

  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* 忽略 */ }
  }

  function parseStored(text) {
    const raw = JSON.parse(text);
    const parsed = Model.normalize(raw);
    return { raw, parsed };
  }

  function loadProgress() {
    doc = Model.emptyDoc();
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); }
    catch {
      setSaveState("浏览器禁止本地存储：进度无法保存，请及时导出备份", true);
      return;
    }
    if (!saved) return;
    try {
      const { raw, parsed } = parseStored(saved);
      doc = parsed;
      if (parsed.upgradedFrom === 1) {
        // 旧版（v1）记录：原样备份一份，再按新章节 id 升级；映射不了的课程给出提示。
        try { if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, JSON.stringify(raw)); } catch { /* 备份失败不影响升级 */ }
        delete doc.upgradedFrom;
        const dropped = doc.dropped || [];
        delete doc.dropped;
        saveProgress("已把旧版记录升级为按章节记录 · 自动保存已开启");
        if (dropped.length) notify(`旧版有 ${dropped.length} 门课的进度对不上新大纲，已备份在浏览器存储「${BACKUP_KEY}」里，请重新勾选。`);
        return;
      }
      setSaveState("已恢复上次的学习进度 · 自动保存已开启");
    } catch {
      setSaveState("无法读取本地记录，请检查浏览器存储或导入备份", true);
      notify("未能读取原有进度，暂显示初始课单。");
    }
  }

  function saveProgress(message) {
    try {
      const { newer, ...clean } = doc;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
      setSaveState(message || "已保存到此浏览器 · " + clock(Date.now()));
      return true;
    } catch {
      setSaveState("本地保存失败，刷新前请导出 JSON 备份", true);
      return false;
    }
  }

  function recompute() {
    for (const course of courses) stats.set(course.id, Model.courseStats(course, chaptersOf(course.id)));
  }

  function commit(message) {
    doc.updatedAt = new Date().toISOString();
    refreshAll();
    saveProgress(message);
    Sync.schedule();
  }

  // 主入口：把一节改成 done / skipped / none，时间戳至少比上一次晚 1 毫秒。
  function setChapter(courseId, chapterId, state) {
    const previous = chaptersOf(courseId)[chapterId];
    if ((previous ? previous.state : "none") === state) return;
    const course = doc.courses[courseId] || (doc.courses[courseId] = { chapters: {} });
    course.chapters[chapterId] = { state, at: Model.stampAfter(previous && previous.at) };
    commit();
  }

  function refreshAll() {
    recompute();
    courses.forEach((course) => updateCard(course.id));
    updateChapterNodes();
    updateTiers();
    updateTeaching();
    renderDashboard();
    updateRoute();
  }

  // —— 链接与动作 ——

  function primaryLink(course) {
    const link = course.links.find((item) => item.primary) || course.links[0];
    return link ? safeUrl(link.url) : null;
  }

  // 一节的直达链接：B 站深链到第一 P；文档类到对应文章；都没有就用课程的主入口。
  function chapterLink(course, chapter) {
    const ref = (chapter && chapter.ref) || {};
    if (ref.bv) {
      const href = safeUrl(`https://www.bilibili.com/video/${ref.bv}/` + (ref.start ? `?p=${ref.start}` : ""));
      return href && { href, label: ref.start ? `打开 P${ref.start}` : "打开视频" };
    }
    if (ref.url) {
      const href = safeUrl(ref.url);
      return href && { href, label: "打开" + (ref.label || "") };
    }
    const href = primaryLink(course);
    return href && { href, label: "打开课程" };
  }

  function chapterMeta(chapter) {
    const parts = [];
    const ref = chapter.ref || {};
    if (ref.label) parts.push(ref.label);
    if (chapter.kind !== "teach") parts.push((chapter.exact ? "" : "≈") + duration(Model.chapterMinutes(chapter)));
    if (chapter.kind === "practice") parts.push("动手");
    if (chapter.optional) parts.push("选读");
    if (chapter.custom) parts.push("自定义");
    return parts.join(" · ");
  }

  function isPlanned(courseId, chapterId) {
    const item = doc.plan[Model.planKey(courseId, chapterId)];
    if (!item || item.removed) return false;
    return item.week === thisWeek() || (item.week < thisWeek() && stateOf(courseId, chapterId) !== "done");
  }

  function setPlan(courseId, chapterId, on, day = null) {
    const key = Model.planKey(courseId, chapterId);
    const previous = doc.plan[key];
    const at = Model.stampAfter(previous && previous.at);
    if (on) doc.plan[key] = { course: courseId, chapter: chapterId, week: thisWeek(), day, at };
    else if (previous) doc.plan[key] = { ...previous, removed: true, at };
    commit();
    if (on && planItems().length > 5) notify("本周已经超过 5 节了，排少一点更容易坚持。");
  }

  function setPlanDay(key, day) {
    const previous = doc.plan[key];
    if (!previous) return;
    doc.plan[key] = { ...previous, week: thisWeek(), day, at: Model.stampAfter(previous.at) };
    commit();
  }

  // 「下一节」的一排快捷按钮：学完 / 打开 / 加入本周。卡片与「接着学」共用。
  function nextActions(course, chapter, scope) {
    const row = element("div", "next-actions");
    const done = element("button", "button button-primary button-sm", "✓ 学完这节");
    done.type = "button";
    done.dataset.focus = `${scope}:done`;
    done.setAttribute("aria-label", `学完：${chapter.title}`);
    done.addEventListener("click", () => setChapter(course.id, chapter.id, "done"));
    row.append(done);
    const link = chapterLink(course, chapter);
    if (link) {
      const open = element("a", "button button-quiet button-sm", `▶ ${link.label} ↗`);
      Object.assign(open, { href: link.href, target: "_blank", rel: "noopener noreferrer" });
      open.dataset.focus = `${scope}:open`;
      row.append(open);
    }
    const planned = isPlanned(course.id, chapter.id);
    const plan = element("button", "button button-quiet button-sm plan-toggle", planned ? "✓ 已在本周" : "＋ 本周");
    plan.type = "button";
    plan.dataset.focus = `${scope}:plan`;
    plan.setAttribute("aria-pressed", String(planned));
    plan.addEventListener("click", () => setPlan(course.id, chapter.id, !isPlanned(course.id, chapter.id)));
    row.append(plan);
    return row;
  }

  // —— 总览 ——

  function tierStats(tierId) {
    return Model.groupStats(courses.filter((course) => course.tier === tierId), statsOf);
  }

  function renderDashboard() {
    const main = tiers.find((tier) => tier.countsAs === "main") || tiers[0];
    const mainStats = tierStats(main.id);
    $("overall-value").textContent = mainStats.pct;
    $("ring-value").style.strokeDashoffset = String(100 - mainStats.pct);
    $("ring-value").classList.toggle("is-empty", mainStats.pct === 0);
    $("overall-ring").setAttribute("aria-valuenow", mainStats.pct);
    $("overall-ring").setAttribute("aria-valuetext", `${mainStats.pct}%，已学 ${hoursOf(mainStats.doneMinutes)} / ${hoursOf(mainStats.totalMinutes)} 小时`);
    $("main-hours").textContent = `已学 ${hoursOf(mainStats.doneMinutes)} / ${hoursOf(mainStats.totalMinutes)} 小时`;

    // 小字：补强进度排第一，其余分区按数据顺序跟在后面。
    const figures = $("tier-figures");
    figures.replaceChildren();
    const figureRank = (tier) => (tier.countsAs === "upskill" ? 0 : 1);
    const others = tiers.filter((item) => item !== main).map((tier, index) => ({ tier, index }))
      .sort((a, b) => figureRank(a.tier) - figureRank(b.tier) || a.index - b.index);
    for (const { tier } of others) {
      const value = tierStats(tier.id);
      const item = element("li", "tier-figure");
      item.dataset.tier = tier.id;
      const top = element("div", "tier-figure-top");
      top.append(element("span", "tier-figure-name", tier.countsAs === "upskill" ? "补强进度" : tier.name), element("strong", "tier-figure-value", value.pct + "%"));
      const rail = element("span", "bar");
      const fill = element("i");
      fill.style.width = value.pct + "%";
      rail.append(fill);
      item.append(top, rail, element("small", "", `${hoursOf(value.doneMinutes)} / ${hoursOf(value.totalMinutes)} 小时`));
      figures.append(item);
    }

    const counted = courses.filter((course) => course.tier === main.id && Model.counts(course)).map((course) => course.short);
    const excluded = courses.filter((course) => !Model.counts(course)).map((course) => `${course.short}（${course.roleLabel || ROLE_NAMES[course.role]}）`);
    $("scope-note").textContent = `大字只算主线 ${counted.length} 门（${counted.join("、")}），按课程时长加权。选读、跳过的章节和教学产出不计入；不计入的课程：${excluded.join("、")}。`;

    const counts = { not_started: 0, in_progress: 0, done: 0 };
    courses.forEach((course) => { counts[statsOf(course.id).status] += 1; });
    $("done-count").textContent = counts.done;
    $("active-count").textContent = counts.in_progress;
    $("pending-count").textContent = counts.not_started;
    filterButtons.forEach((button, key) => { button.lastChild.textContent = key === "all" ? courses.length : counts[key]; });

    renderNext();
    renderWeek();
    renderRecord();
  }

  // 「接着学」：最近学过的在学课程；一节都没学时给出第一节的引导（空状态）。
  function pickNext() {
    const active = courses.filter((course) => statsOf(course.id).status === "in_progress" && statsOf(course.id).next)
      .sort((a, b) => statsOf(b.id).lastAt - statsOf(a.id).lastAt || a.order - b.order);
    if (active.length) return { course: active[0], mode: "continue" };
    const fresh = !courses.some((course) => statsOf(course.id).anyDone);
    const mainTier = (tiers.find((tier) => tier.countsAs === "main") || tiers[0]).id;
    const candidates = [
      ...courses.filter((course) => course.tier === mainTier && Model.counts(course)),
      ...courses.filter((course) => Model.counts(course))
    ];
    const course = candidates.find((item) => statsOf(item.id).next);
    return course ? { course, mode: fresh ? "fresh" : "start" } : null;
  }

  function renderNext() {
    const body = $("next-body");
    const picked = pickNext();
    $("next-label").textContent = !picked ? "全部完成" : picked.mode === "fresh" ? "从这里开始" : picked.mode === "continue" ? "接着学" : "下一门";
    $("next-hint").textContent = picked && picked.mode === "fresh" ? "勾掉第一节，进度环就会亮起来" : "";
    keepFocus(body, () => {
      if (!picked) {
        body.replaceChildren(element("p", "next-empty", "计入的课程都学完了，了不起。挑一门备选或选读再精读一遍吧。"));
        return;
      }
      const { course } = picked;
      const value = statsOf(course.id);
      const chapter = value.next;
      const wrap = element("div", "next-course");
      wrap.dataset.color = trackOf(course).color;
      const tag = element("span", "track-tag");
      tag.append(element("i", "track-dot"), document.createTextNode(trackOf(course).name));
      const meta = element("p", "next-meta", `${course.teacher} · ${value.pct}% · 已学 ${value.learnDone}/${value.learnTotal} 节 · 还剩 ${duration(value.totalMinutes - value.doneMinutes)}`);
      const rail = element("span", "bar");
      const fill = element("i");
      fill.style.width = value.pct + "%";
      rail.append(fill);
      const line = element("div", "next-chapter");
      line.append(element("span", "next-chapter-tag", picked.mode === "fresh" ? "第一节" : "下一节"), element("strong", "", chapter.title));
      const sub = chapterMeta(chapter);
      if (sub) line.append(element("small", "", sub));
      const actions = nextActions(course, chapter, "next");
      if (picked.mode === "fresh") actions.firstChild.textContent = "✓ 勾掉第一节";
      const locate = element("a", "button button-ghost button-sm", "查看卡片");
      locate.href = "#course-" + course.id;
      locate.dataset.focus = "next:locate";
      locate.addEventListener("click", (event) => {
        event.preventDefault();
        focusCard(course.id);
      });
      actions.append(locate);
      wrap.append(tag, element("h3", "next-title", course.title), meta, rail, line, actions);
      body.replaceChildren(wrap);
    });
  }

  function planItems() {
    const current = thisWeek();
    return Model.weekPlan(doc, current, (item) => stateOf(item.course, item.chapter) === "done")
      .filter((item) => byId.has(item.course) && chapterOf(item.course, item.chapter))
      .sort((a, b) => (a.day ?? 7) - (b.day ?? 7) || byId.get(a.course).order - byId.get(b.course).order);
  }

  function renderWeek() {
    const start = Model.weekStart(new Date());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    $("week-range").textContent = `${shortDate(start)} – ${shortDate(end)}`;
    const items = planItems();
    const list = $("plan-list");
    keepFocus(list, () => {
      list.replaceChildren();
      for (const item of items) {
        const course = byId.get(item.course);
        const chapter = chapterOf(item.course, item.chapter);
        const done = stateOf(item.course, item.chapter) === "done";
        const row = element("li", "plan-item");
        row.dataset.color = trackOf(course).color;
        row.dataset.done = String(done);
        const label = element("label", "plan-check");
        const box = element("input");
        box.type = "checkbox";
        box.checked = done;
        box.dataset.focus = `plan:${item.key}:box`;
        box.addEventListener("change", () => setChapter(item.course, item.chapter, box.checked ? "done" : "none"));
        const text = element("span", "plan-text");
        text.append(element("span", "plan-title", chapter.title), element("span", "plan-meta", [course.short, chapterMeta(chapter)].filter(Boolean).join(" · ")));
        label.append(box, text);
        const tools = element("div", "plan-tools");
        if (item.carried) tools.append(element("span", "plan-carried", "上周顺延"));
        const day = element("select", "plan-day");
        day.dataset.focus = `plan:${item.key}:day`;
        day.setAttribute("aria-label", `${chapter.title}：安排在哪天`);
        day.append(new Option("本周内", ""));
        WEEKDAYS.forEach((name, index) => {
          const date = new Date(start);
          date.setDate(start.getDate() + index);
          day.append(new Option(`${name} ${date.getMonth() + 1}/${date.getDate()}`, String(index)));
        });
        day.value = item.carried || item.day === null ? "" : String(item.day);
        day.addEventListener("change", () => setPlanDay(item.key, day.value === "" ? null : Number(day.value)));
        const remove = element("button", "icon-button icon-button-sm", "✕");
        remove.type = "button";
        remove.dataset.focus = `plan:${item.key}:remove`;
        remove.setAttribute("aria-label", `移出本周：${chapter.title}`);
        remove.addEventListener("click", () => setPlan(item.course, item.chapter, false));
        tools.append(day, remove);
        row.append(label, tools);
        list.append(row);
      }
    });
    $("plan-empty").hidden = items.length > 0;
    const doneCount = items.filter((item) => stateOf(item.course, item.chapter) === "done").length;
    $("plan-hint").hidden = !items.length;
    $("plan-hint").textContent = items.length ? `本周 ${doneCount}/${items.length} 节 · 约 ${duration(items.reduce((sum, item) => sum + Model.chapterMinutes(chapterOf(item.course, item.chapter)), 0))}` : "";
    $("plan-ics").disabled = !items.length;
  }

  function renderRecord() {
    const events = Model.doneEvents(doc, courses);
    const today = new Date();
    const columns = Model.heatmap(events, today, 12);
    const map = $("heatmap");
    map.replaceChildren();
    const todayKey = Model.dayKey(today);
    for (const week of columns) {
      for (const day of week) {
        const cell = element("i", "heat-cell");
        const level = day.count === 0 ? 0 : day.count === 1 ? 1 : day.count === 2 ? 2 : day.count <= 4 ? 3 : 4;
        cell.dataset.level = String(level);
        if (day.future) cell.classList.add("is-future");
        if (day.key === todayKey) cell.classList.add("is-today");
        cell.title = `${shortDate(day.date)} ${WEEKDAYS[(day.date.getDay() + 6) % 7]} · ${day.future ? "还没到" : day.count ? `完成 ${day.count} 节` : "没有记录"}`;
        map.append(cell);
      }
    }
    const summary = Model.summarizeWeek(events, today);
    const active = columns.flat().filter((day) => day.count).length;
    map.setAttribute("aria-label", `近 12 周有 ${active} 天学习，共完成 ${columns.flat().reduce((sum, day) => sum + day.count, 0)} 节`);
    $("record-week").textContent = summary.count ? `${summary.count} 节 · ${duration(summary.minutes)}` : "0 节";
    $("record-total").textContent = summary.totalCount ? `${summary.totalCount} 节 · ${duration(summary.totalMinutes)}` : "0 节";
    if (!summary.lastAt) $("record-last").textContent = "还没有记录";
    else {
      const days = Model.daysBetween(summary.lastAt, today);
      $("record-last").textContent = days <= 0 ? "今天" : days === 1 ? "昨天" : `${days} 天前`;
    }
  }

  function focusCard(id, highlightNext = true) {
    const parts = cards.get(id);
    if (parts.card.hidden) setFilter("all");
    if (parts.group) setOpen(parts.group, true);
    if (parts.outline) setOpen(parts.outline, true);
    parts.card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    parts.card.classList.remove("flash");
    void parts.card.offsetWidth;
    parts.card.classList.add("flash");
    const next = statsOf(id).next;
    if (highlightNext && next) {
      const node = [...(chapterNodes.get(Model.planKey(id, next.id)) || [])].find((item) => parts.card.contains(item.row));
      if (node) {
        node.row.classList.remove("flash");
        void node.row.offsetWidth;
        node.row.classList.add("flash");
      }
    }
  }

  // —— 学习路线（结构化数据） ——

  function routeLink(courseId, text) {
    const course = byId.get(courseId);
    const link = element("a", "route-link", text || course.short);
    link.href = "#course-" + courseId;
    link.dataset.color = trackOf(course).color;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      focusCard(courseId, false);
    });
    return link;
  }

  const routePct = [];

  function renderRoute() {
    const list = $("study-route");
    list.style.setProperty("--steps", route.steps.length);
    route.steps.forEach((step, index) => {
      const course = byId.get(step.courses[0]);
      const item = element("li", "route-step reveal");
      item.dataset.color = trackOf(course).color;
      if (step.optional) item.dataset.optional = "true";
      item.style.setProperty("--i", index);
      const head = element("div", "route-head");
      head.append(element("span", "route-no", pad(index + 1)));
      if (step.optional) head.append(element("span", "route-flag", "选学"));
      const pct = element("span", "route-pct");
      head.append(pct);
      routePct.push({ node: pct, ids: step.courses });
      const title = element("strong");
      title.append(routeLink(course.id, step.label));
      item.append(head, title);
      if (step.detail) item.append(element("small", "", step.detail));
      list.append(item);
    });
    const branches = $("route-branches");
    for (const branch of route.branches) {
      const box = element("div", "route-branch");
      box.dataset.flow = branch.flow;
      box.append(element("span", "branch-tag", branch.label));
      const flow = element("p", "branch-flow");
      branch.groups.forEach((group, index) => {
        if (index) flow.append(element("span", "branch-sep", branch.flow === "sequence" ? "→" : "·"));
        const chip = element("span", "branch-step");
        group.forEach((id, inner) => {
          if (inner) chip.append(element("span", "branch-or", "/"));
          chip.append(routeLink(id));
        });
        flow.append(chip);
      });
      box.append(flow);
      if (branch.note) box.append(element("small", "branch-note", branch.note));
      branches.append(box);
    }
    $("route-tip").textContent = route.tip || "";
    $("study-context").textContent = route.context || "";
  }

  function updateRoute() {
    for (const { node, ids } of routePct) node.textContent = statsOf(ids[0]).pct + "%";
  }

  // —— 课程卡片 ——

  function renderLinks(course) {
    const box = element("div", "course-links");
    for (const [kind, name] of LINK_KINDS) {
      const links = course.links.filter((link) => link.kind === kind && safeUrl(link.url));
      if (!links.length) continue;
      const group = element("div", "link-group");
      group.append(element("span", "link-kind", name));
      for (const link of links) {
        const anchor = element("a", "course-link" + (link.primary ? " is-primary" : ""));
        anchor.append(document.createTextNode(link.label));
        if (link.meta) anchor.append(element("small", "", link.meta));
        Object.assign(anchor, { href: safeUrl(link.url), target: "_blank", rel: "noopener noreferrer" });
        anchor.setAttribute("aria-label", `${course.title}：${link.label}${link.meta ? "，" + link.meta : ""}（新标签页打开）`);
        group.append(anchor);
      }
      box.append(group);
    }
    return box;
  }

  function registerChapter(courseId, chapterId, node) {
    const key = Model.planKey(courseId, chapterId);
    if (!chapterNodes.has(key)) chapterNodes.set(key, new Set());
    chapterNodes.get(key).add(node);
  }

  function updateChapterNodes() {
    chapterNodes.forEach((nodes, key) => {
      const [courseId, chapterId] = key.split("/");
      const state = stateOf(courseId, chapterId);
      nodes.forEach(({ row, box, skip }) => {
        row.dataset.state = state;
        box.checked = state === "done";
        if (skip) {
          skip.setAttribute("aria-pressed", String(state === "skipped"));
          skip.textContent = state === "skipped" ? "已跳过" : "跳过";
        }
      });
    });
  }

  function outlineRow(course, chapter, number) {
    const row = element("li", "outline-item");
    if (chapter.optional) row.dataset.optional = "true";
    row.dataset.kind = chapter.kind;
    const label = element("label", "outline-check");
    const box = element("input");
    box.type = "checkbox";
    box.addEventListener("change", () => setChapter(course.id, chapter.id, box.checked ? "done" : "none"));
    const text = element("span", "outline-text");
    text.append(element("span", "outline-title", chapter.title));
    const meta = chapterMeta(chapter);
    if (meta) text.append(element("span", "outline-meta", meta));
    label.append(box, element("span", "outline-no", number), text);
    row.append(label);
    const link = chapter.ref && chapterLink(course, chapter);
    if (link) {
      const open = element("a", "outline-open", "↗");
      Object.assign(open, { href: link.href, target: "_blank", rel: "noopener noreferrer", title: link.label });
      open.setAttribute("aria-label", `${link.label}：${chapter.title}（新标签页）`);
      row.append(open);
    }
    let skip = null;
    if (chapter.kind !== "teach" && !chapter.optional) {
      skip = element("button", "skip-button", "跳过");
      skip.type = "button";
      skip.title = "跳过这一节：不计入进度";
      skip.setAttribute("aria-label", `跳过（不计入进度）：${chapter.title}`);
      skip.addEventListener("click", () => setChapter(course.id, chapter.id, stateOf(course.id, chapter.id) === "skipped" ? "none" : "skipped"));
      row.append(skip);
    }
    registerChapter(course.id, chapter.id, { row, box, skip });
    return row;
  }

  function renderOutline(course, parts) {
    const details = element("details", "outline");
    const summary = element("summary");
    const count = element("span", "outline-count");
    summary.append(element("span", "outline-label", "课程大纲"), count);
    const note = element("p", "outline-note", `${course.outlineNote || OUTLINE_SOURCES[course.outlineSource] || ""}。选读、跳过、教学产出不计入进度。`);
    const learn = element("ol", "outline-list");
    learn.setAttribute("aria-label", course.title + "：章节勾选");
    const teach = element("ol", "outline-list outline-teach");
    teach.setAttribute("aria-label", course.title + "：教学产出");
    let n = 0;
    let t = 0;
    for (const chapter of course.outline) {
      if (chapter.kind === "teach") teach.append(outlineRow(course, chapter, "T" + (++t)));
      else learn.append(outlineRow(course, chapter, pad(++n)));
    }
    details.append(summary, note, learn);
    if (t) details.append(element("p", "outline-group", "教学产出 · 不计入课程进度"), teach);
    const fallback = () => statsOf(course.id).status === "in_progress";
    setOpen(details, ui.open[course.id] ?? fallback());
    details.addEventListener("toggle", () => {
      if (isAutoToggle(details)) return;
      if (ui.open[course.id] === undefined && details.open === fallback()) return;
      ui.open[course.id] = details.open;
      saveUi();
    });
    Object.assign(parts, { outline: details, count });
    return details;
  }

  function renderCard(course, index, showTrack) {
    const track = trackOf(course);
    const card = element("article", "course-card reveal");
    card.id = "course-" + course.id;
    card.dataset.color = track.color;
    card.dataset.role = course.role;
    card.style.setProperty("--i", index % 6);
    card.setAttribute("aria-labelledby", "title-" + course.id);
    const head = element("div", "card-head");
    head.append(element("span", "course-index", pad(course.order)));
    if (course.role !== "core") head.append(element("span", "role-badge", roleText(course)));
    const badge = element("span", "status-badge");
    head.append(badge);
    card.append(head);
    if (showTrack) {
      const tag = element("span", "track-tag track-tag-sm");
      tag.append(element("i", "track-dot"), document.createTextNode(track.name));
      card.append(tag);
    }
    const title = element("h4", "course-title", course.title);
    title.id = "title-" + course.id;
    const meta = element("p", "course-meta");
    meta.append(element("span", "", course.teacher), element("span", "course-platform", course.platform));
    const facts = element("p", "course-facts");
    card.append(title, meta, facts, element("p", "course-note", course.note), renderLinks(course));

    const progress = element("div", "course-progress");
    const row = element("div", "progress-row");
    const output = element("output", "course-value");
    row.append(element("span", "", "学习进度"), output);
    const meter = element("span", "bar course-bar");
    meter.setAttribute("role", "progressbar");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    meter.setAttribute("aria-label", course.title + "：学习进度");
    const fill = element("i");
    meter.append(fill);
    const summary = element("p", "progress-facts");
    const next = element("div", "card-next");
    const parts = { card, badge, output, meter, fill, summary, next, facts };
    progress.append(row, meter, summary, next, renderOutline(course, parts));
    card.append(progress);
    cards.set(course.id, parts);
    return card;
  }

  function updateCard(id) {
    const parts = cards.get(id);
    if (!parts) return;
    const course = byId.get(id);
    const value = statsOf(id);
    parts.card.dataset.status = value.status;
    // 刚开始学的课：没有手动开合过就自动展开大纲（只开不关，免得勾完最后一节时列表突然收起）。
    if (value.status === "in_progress" && ui.open[id] === undefined) setOpen(parts.outline, true);
    parts.badge.textContent = value.status === "done" ? "✓ 已完成" : STATES[value.status];
    parts.output.value = value.pct + "%";
    parts.fill.style.width = value.pct + "%";
    const text = `已学 ${value.learnDone}/${value.learnTotal} 节`;
    parts.meter.setAttribute("aria-valuenow", value.pct);
    parts.meter.setAttribute("aria-valuetext", `${value.pct}%，${text}，${STATES[value.status]}`);
    parts.count.textContent = `${value.learnDone}/${value.learnTotal}`;
    const bits = [text, `${hoursOf(value.doneMinutes)} / ${hoursOf(value.totalMinutes)} 小时`];
    if (value.skipped) bits.push(`跳过 ${value.skipped}`);
    if (value.optionalDone) bits.push(`选读 ${value.optionalDone}`);
    if (value.teachTotal) bits.push(`教学产出 ${value.teachDone}/${value.teachTotal}`);
    parts.summary.textContent = bits.join(" · ");

    const facts = [`≈ ${hoursOf(course.requiredMinutes)} 小时`, `${course.outline.filter((ch) => ch.kind !== "teach").length} 节`, OUTLINE_SOURCES[course.outlineSource]];
    for (const pre of course.prereq || []) {
      const other = byId.get(pre);
      if (other) facts.push(statsOf(pre).status === "done" ? `前置：${other.short} ✓` : `建议先学 ${other.short}（${statsOf(pre).pct}%）`);
    }
    parts.facts.textContent = facts.join(" · ");

    keepFocus(parts.next, () => {
      parts.next.replaceChildren();
      if (!value.next) {
        if (value.status === "done") parts.next.append(element("p", "card-next-done", value.teachDone < value.teachTotal ? "课程章节已学完，还剩教学产出可以做。" : "这门课全部完成。"));
        return;
      }
      const line = element("p", "card-next-line");
      line.append(element("span", "next-chapter-tag", "下一节"), element("span", "card-next-title", value.next.title));
      parts.next.append(line, nextActions(course, value.next, "card-" + id));
    });
  }

  // —— 三层信息架构：主线 /（我正在教）/ 课堂与拓展 / 老师补强 ——

  function tierHead(no, title, caption, eyebrow) {
    const head = element("header", "tier-head");
    const titles = element("div", "tier-titles");
    titles.append(element("span", "tier-no", eyebrow ? `${no} · ${eyebrow}` : no), element("h3", "", title));
    if (caption) titles.append(element("p", "tier-caption", caption));
    const meter = element("div", "tier-progress");
    const stat = element("span", "tier-stat");
    const rail = element("span", "bar");
    const bar = element("i");
    rail.append(bar);
    meter.append(stat, rail);
    head.append(titles, meter);
    return { head, stat, bar };
  }

  function renderLibrary() {
    const groups = $("course-groups");
    const nav = $("tier-nav");
    let index = 0;
    tiers.forEach((tier, tierIndex) => {
      const section = element("section", "tier");
      section.id = "tier-" + tier.id;
      section.dataset.tier = tier.id;
      section.setAttribute("aria-label", tier.title);
      const { head, stat, bar } = tierHead(pad(tierIndex + 1), tier.title, tier.caption, tier.name);
      section.append(head);
      const tierCourses = courses.filter((course) => course.tier === tier.id);
      const groupsInTier = [];
      if (tier.layout === "tracks") {
        for (const track of tracks.filter((item) => item.tier === tier.id)) {
          const members = tierCourses.filter((course) => course.track === track.id);
          if (!members.length) continue;
          const group = element("details", "track-group");
          group.dataset.color = track.color;
          group.id = "track-" + track.id;
          const summary = element("summary");
          const name = element("span", "track-group-name");
          name.append(element("i", "track-dot"), element("strong", "", track.name));
          const caption = element("span", "track-group-caption", track.caption || "");
          const groupStat = element("span", "track-group-stat");
          summary.append(name, caption, groupStat);
          const grid = element("div", "cards");
          members.forEach((course) => {
            grid.append(renderCard(course, index++, false));
            cards.get(course.id).group = group;
          });
          group.append(summary, grid);
          const fallback = () => members.some((course) => statsOf(course.id).status === "in_progress");
          setOpen(group, ui.groups[track.id] ?? fallback());
          group.addEventListener("toggle", () => {
            // 筛选视图里的开合是临时的：只有在「全部」视图下手动开合才记住。
            if (isAutoToggle(group) || filter !== "all") return;
            if (ui.groups[track.id] === undefined && group.open === fallback()) return;
            ui.groups[track.id] = group.open;
            saveUi();
          });
          section.append(group);
          groupsInTier.push({ group, members, stat: groupStat, track, fallback });
        }
      } else {
        const grid = element("div", "cards");
        const mixed = new Set(tierCourses.map((course) => course.track)).size > 1;
        tierCourses.forEach((course) => grid.append(renderCard(course, index++, mixed)));
        section.append(grid);
      }
      groups.append(section);
      tierParts.set(tier.id, { section, stat, bar, courses: tierCourses, groups: groupsInTier });
      const chip = element("a", "track-chip", tier.name);
      chip.href = "#tier-" + tier.id;
      chip.dataset.tier = tier.id;
      nav.append(chip);
      if (tier.countsAs === "main") {
        groups.append(renderTeaching());
        const teach = element("a", "track-chip", "我正在教");
        teach.href = "#teaching";
        nav.append(teach);
      }
    });
    $("course-count").textContent = pad(courses.length);
  }

  function updateTiers() {
    tierParts.forEach((parts, tierId) => {
      const value = tierStats(tierId);
      const counted = parts.courses.filter((course) => Model.counts(course));
      const done = counted.filter((course) => statsOf(course.id).status === "done").length;
      parts.stat.textContent = `${done}/${counted.length} 门完成 · ${value.pct}% · ${hoursOf(value.doneMinutes)} / ${hoursOf(value.totalMinutes)} 小时`;
      parts.bar.style.width = value.pct + "%";
      for (const { group, members, stat, track, fallback } of parts.groups) {
        const groupValue = Model.groupStats(members, statsOf);
        stat.textContent = `${groupValue.pct}%`;
        if (filter === "all" && ui.groups[track.id] === undefined && fallback()) setOpen(group, true);
      }
    });
  }

  // —— 我正在教（轻量版）：讲义编号 + 教学产出清单 ——

  let teachingStat = null;

  function teachItem(course, chapter, withCourse) {
    const row = element("li", "teach-item");
    const label = element("label", "outline-check");
    const box = element("input");
    box.type = "checkbox";
    box.addEventListener("change", () => setChapter(course.id, chapter.id, box.checked ? "done" : "none"));
    const text = element("span", "outline-text");
    text.append(element("span", "outline-title", chapter.title));
    if (withCourse) text.append(element("span", "outline-meta", course.short));
    label.append(box, text);
    row.append(label);
    registerChapter(course.id, chapter.id, { row, box, skip: null });
    return row;
  }

  function renderTeaching() {
    const section = element("section", "tier teaching");
    section.id = "teaching";
    section.setAttribute("aria-label", "我正在教");
    const { head, stat, bar } = tierHead("★", "讲义关联与教学产出", "轻量版：每门课的讲义编号和要做的教学产出放在一起。勾选和课程大纲里的「教学产出」是同一份记录，不计入课程进度。", "我正在教");
    teachingStat = { stat, bar };
    section.append(head);
    const grid = element("div", "teach-grid");
    const featured = courses.filter((course) => course.teaching);
    for (const course of featured) {
      const card = element("article", "teach-card");
      card.dataset.color = trackOf(course).color;
      const top = element("header", "teach-head");
      if (course.teaching.lessons) top.append(element("span", "lesson-badge", "讲义 " + course.teaching.lessons));
      const name = element("a", "teach-course", course.title);
      name.href = "#course-" + course.id;
      name.addEventListener("click", (event) => {
        event.preventDefault();
        focusCard(course.id, false);
      });
      top.append(name);
      card.append(top);
      if (course.teaching.note) card.append(element("p", "teach-note", course.teaching.note));
      const list = element("ul", "teach-list");
      course.outline.filter((chapter) => chapter.kind === "teach").forEach((chapter) => list.append(teachItem(course, chapter, false)));
      card.append(list);
      grid.append(card);
    }
    const rest = courses.filter((course) => !course.teaching && course.outline.some((chapter) => chapter.kind === "teach"));
    if (rest.length) {
      const card = element("article", "teach-card teach-card-wide");
      card.append(element("header", "teach-head", "其他课程的教学产出"));
      const list = element("ul", "teach-list teach-list-columns");
      for (const course of rest) {
        course.outline.filter((chapter) => chapter.kind === "teach").forEach((chapter) => list.append(teachItem(course, chapter, true)));
      }
      card.append(list);
      grid.append(card);
    }
    section.append(grid);
    return section;
  }

  function updateTeaching() {
    if (!teachingStat) return;
    let done = 0;
    let total = 0;
    for (const course of courses) {
      done += statsOf(course.id).teachDone;
      total += statsOf(course.id).teachTotal;
    }
    teachingStat.stat.textContent = `教学产出 ${done}/${total}`;
    teachingStat.bar.style.width = (total ? Math.round((done / total) * 100) : 0) + "%";
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
    const show = (course) => filter === "all" || statsOf(course.id).status === filter;
    tierParts.forEach((parts) => {
      let shown = 0;
      for (const course of parts.courses) {
        const hide = !show(course);
        cards.get(course.id).card.hidden = hide;
        if (!hide) shown += 1;
      }
      for (const item of parts.groups) {
        const count = item.members.filter(show).length;
        item.group.hidden = count === 0;
        // 筛选时临时展开有结果的分组；回到「全部」时恢复原来的折叠状态。
        setOpen(item.group, filter === "all" ? ui.groups[item.track.id] ?? item.fallback() : count > 0);
      }
      parts.section.hidden = shown === 0;
      visible += shown;
    });
    $("empty-state").hidden = visible > 0;
  }

  // —— 本周课表：挑选与日历导出 ——

  function openPlanPicker() {
    const picker = $("plan-picker");
    picker.replaceChildren();
    $("plan-dialog-week").textContent = `${thisWeek()} · ${$("week-range").textContent}`;
    const ordered = [
      ...courses.filter((course) => statsOf(course.id).status === "in_progress"),
      ...courses.filter((course) => statsOf(course.id).status === "not_started" && Model.counts(course)),
      ...courses.filter((course) => statsOf(course.id).status === "not_started" && !Model.counts(course))
    ];
    for (const course of ordered) {
      const remaining = course.outline.filter((chapter) => chapter.kind !== "teach" && !chapter.optional && stateOf(course.id, chapter.id) === "none");
      if (!remaining.length) continue;
      const take = statsOf(course.id).status === "in_progress" ? 3 : 1;
      const group = element("section", "picker-course");
      group.dataset.color = trackOf(course).color;
      const head = element("header", "picker-head");
      head.append(element("i", "track-dot"), element("strong", "", course.short), element("span", "", `${statsOf(course.id).pct}%` + (Model.counts(course) ? "" : " · 不计入")));
      const list = element("ul", "picker-list");
      for (const chapter of remaining.slice(0, take)) {
        const row = element("li");
        const label = element("label", "outline-check");
        const box = element("input");
        box.type = "checkbox";
        box.checked = isPlanned(course.id, chapter.id);
        box.addEventListener("change", () => setPlan(course.id, chapter.id, box.checked));
        const text = element("span", "outline-text");
        text.append(element("span", "outline-title", chapter.title), element("span", "outline-meta", chapterMeta(chapter)));
        label.append(box, text);
        row.append(label);
        list.append(row);
      }
      group.append(head, list);
      picker.append(group);
    }
    $("plan-dialog").showModal();
  }

  function exportIcs() {
    const items = planItems();
    if (!items.length) return;
    const start = Model.weekStart(new Date());
    const week = thisWeek();
    const events = items.map((item) => {
      const course = byId.get(item.course);
      const chapter = chapterOf(item.course, item.chapter);
      const date = new Date(start);
      date.setDate(start.getDate() + (item.carried || item.day === null ? 6 : item.day));
      const link = chapterLink(course, chapter);
      const when = item.carried || item.day === null ? "（本周内）" : "";
      return {
        uid: `${item.course}.${item.chapter}.${week}@learning-courses`,
        date,
        summary: `学：${course.short} · ${chapter.title}${when}`,
        description: [course.title, chapterMeta(chapter), link ? link.href : ""].filter(Boolean).join("\n"),
        url: link ? link.href : ""
      };
    });
    const text = Model.buildIcs(events, { name: `慢慢学 · ${week}` });
    download(new Blob([text], { type: "text/calendar;charset=utf-8" }), `manmanxue-${week}.ics`);
    notify("已导出本周课表：双击 .ics 即可加入 Mac 日历或 Outlook。");
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = element("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // —— JSON 备份 ——

  function exportProgress() {
    const backup = { version: Model.VERSION, exportedAt: new Date().toISOString(), courses: doc.courses, plan: doc.plan };
    download(new Blob([JSON.stringify(backup, null, 2) + "\n"], { type: "application/json;charset=utf-8" }), `learning-courses-progress-${new Date().toISOString().slice(0, 10)}.json`);
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
      let incoming;
      try { incoming = Model.normalize(raw, { strict: true }); }
      catch (error) { throw new Error(`备份无效：${error.message}原有进度未更改。`); }
      const preview = Model.importDoc(doc, incoming, catalog);
      if (!preview.chapters && !preview.plan) {
        throw new Error(incoming.dropped && incoming.dropped.length ? "这份旧版备份只有滑条百分比，对不上新的章节大纲，无法导入。" : "备份中没有与当前课单匹配的章节。原记录未更改。");
      }
      pendingImport = incoming;
      $("import-description").textContent = `将用「${file.name}」更新 ${preview.courses} 门课程的 ${preview.chapters} 个章节` +
        (preview.plan ? `和 ${preview.plan} 条课表` : "") + "。" + (preview.ignored ? `另有 ${preview.ignored} 条不在当前课单里，将忽略。` : "") +
        (incoming.upgradedFrom === 1 ? "这是旧版（v1）备份，已按新章节自动换算。" : "");
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
      doc = Model.importDoc(doc, pendingImport, catalog).doc;
      refreshAll();
      applyFilter();
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
    $("sync-history").hidden = !hasToken;
    if (!hasToken) $("token-form").hidden = false;
    document.querySelectorAll("[data-open-sync]").forEach((button) => {
      button.textContent = hasToken ? "同步设置" : "设置同步";
    });
  }

  function openSync() {
    $("token-error").hidden = true;
    $("token-form").hidden = Sync.hasToken();
    $("device-name").value = Sync.device().name;
    $("sync-dialog").showModal();
    if (!Sync.hasToken()) $("token-input").focus();
  }

  async function loadHistory() {
    const list = $("history-list");
    list.replaceChildren(element("li", "history-empty", "正在读取 GitHub 上的版本记录…"));
    $("history-load").disabled = true;
    try {
      const items = await Sync.history(5);
      list.replaceChildren();
      if (!items.length) list.append(element("li", "history-empty", "云端还没有版本记录。"));
      items.forEach((item, index) => {
        const row = element("li", "history-item");
        const text = element("div", "history-text");
        text.append(element("strong", "", clock(Date.parse(item.committedAt))));
        const who = item.problem ? item.problem : `${item.device || "旧版页面"} · 已完成 ${item.done} 节`;
        text.append(element("span", "", who));
        row.append(text);
        if (index === 0) row.append(element("span", "history-current", "最新"));
        else if (item.doc) {
          const button = element("button", "button button-quiet button-sm", "恢复到此");
          button.type = "button";
          let armed = 0;
          button.addEventListener("click", () => {
            if (!armed) {
              armed = setTimeout(() => { armed = 0; button.textContent = "恢复到此"; button.classList.remove("button-danger"); }, 5000);
              button.textContent = "再点一次确认";
              button.classList.add("button-danger");
              return;
            }
            clearTimeout(armed);
            doc = Model.restore(doc, item.doc);
            commit(`已恢复到 ${clock(Date.parse(item.committedAt))} 的同步 · ${clock(Date.now())}`);
            applyFilter();
            Sync.syncNow().then(loadHistory);
            notify(`已恢复到 ${clock(Date.parse(item.committedAt))} 那次同步的状态，正在推送…`);
          });
          row.append(button);
        }
        list.append(row);
      });
    } catch (error) {
      list.replaceChildren(element("li", "history-empty", error.message || "读取失败"));
    } finally {
      $("history-load").disabled = false;
    }
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
    $("device-form").addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const saved = Sync.setDeviceName($("device-name").value);
        $("device-name").value = saved.name;
        notify(`这台设备叫「${saved.name}」，下次推送时写进同步记录。`);
      } catch (error) { notify(error.message); }
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
    $("sync-history").addEventListener("toggle", () => { if ($("sync-history").open) loadHistory(); });
    $("history-load").addEventListener("click", loadHistory);
    Sync.subscribe(renderSyncStatus);
    Sync.start({
      read: () => doc,
      write(merged) {
        // 再和当前文档合并一次（而不是直接替换），万一读写之间本地又有改动也不会丢。
        const next = Model.merge(doc, merged);
        const changed = Model.changes(doc, next, catalog);
        doc = next;
        refreshAll();
        applyFilter();
        const parts = [];
        if (changed.chapters) parts.push(`${changed.chapters} 个章节`);
        if (changed.plan) parts.push(`${changed.plan} 条课表`);
        saveProgress(parts.length ? `已合并其他设备的进度 · ${clock(Date.now())}` : undefined);
        if (parts.length) notify(`已从云端同步 ${parts.join("、")}的变化。`);
      }
    });
  }

  function attachEvents() {
    $("export-button").addEventListener("click", exportProgress);
    $("import-button").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", prepareImport);
    $("import-dialog").addEventListener("close", finishImport);
    $("plan-pick").addEventListener("click", openPlanPicker);
    $("plan-ics").addEventListener("click", exportIcs);
    $("plan-close").addEventListener("click", () => $("plan-dialog").close());
    $("plan-done").addEventListener("click", () => $("plan-dialog").close());
    $("plan-dialog").addEventListener("click", (event) => { if (event.target === $("plan-dialog")) $("plan-dialog").close(); });
    // 同一浏览器的其他标签页改了进度：直接读取（云端推送由那个标签页负责）。
    // 按章节合并而不是整份替换；存储被清空（newValue 为 null）时保留当前页面里的进度。
    window.addEventListener("storage", (event) => {
      if ((event.key !== STORAGE_KEY && event.key !== null) || !event.newValue) return;
      try {
        doc = Model.merge(doc, Model.normalize(JSON.parse(event.newValue)));
        refreshAll();
        applyFilter();
        setSaveState("已同步此浏览器其他标签页的进度");
      } catch { notify("其他标签页的记录格式异常，当前进度保持不变。"); }
    });
  }

  function init() {
    const data = window.COURSE_DATA;
    if (!data || data.schema !== 2 || !Array.isArray(data.courses)) throw new Error("课程数据未加载，请确认 js/courses-data.js 文件完整（运行 python3 scripts/build_data.py 重新生成）。");
    if (!Model) throw new Error("进度模块未加载，请确认 js/model.js 文件完整。");
    if (!Sync) throw new Error("同步模块未加载，请确认 js/sync.js 文件完整。");
    courses = [...data.courses].sort((a, b) => a.order - b.order);
    tiers = data.tiers;
    tracks = data.tracks;
    route = data.route;
    for (const course of courses) {
      byId.set(course.id, course);
      catalog.set(course.id, new Set(course.outline.map((chapter) => chapter.id)));
    }
    Model.configure({ legacy: Object.fromEntries(courses.filter((course) => course.legacyIds).map((course) => [course.id, course.legacyIds])) });
    $("today-label").textContent = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
    readUi();
    loadProgress();
    recompute();
    renderRoute();
    renderFilter();
    renderLibrary();
    refreshAll();
    applyFilter();
    attachEvents();
    setupSync();
  }

  try { init(); }
  catch (error) {
    $("error-banner").textContent = "页面加载失败：" + error.message;
    $("error-banner").hidden = false;
  }
})();
