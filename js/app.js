/* 无依赖静态应用；所有用户进度只保存在当前浏览器。 */
"use strict";

(() => {
  const STORAGE_KEY = "learning-courses-progress-v1";
  const STATES = { not_started: "待开始", in_progress: "学习中", done: "已完成" };
  const TRACKS = [
    { name: "语言与电路基础", caption: "读懂代码，也读懂电路" },
    { name: "STM32嵌入式", caption: "二选一精学，建立外设与中断直觉" },
    { name: "FreeRTOS与网络", caption: "理解任务协作与设备联网" },
    { name: "硬件与PCB", caption: "并行支线：从器件到自己的小板" }
  ];
  let courses = [];
  let records = Object.create(null);
  let pendingImport = null;
  let toastTimer;
  const cards = new Map();
  const $ = (id) => document.getElementById(id);
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const defaults = () => Object.fromEntries(courses.map((course) => [course.id, { status: course.status, progress: course.progress }]));

  function notify(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 5500);
  }

  function storageWarning(message) {
    $("save-state").textContent = message;
    $("save-state").classList.add("error");
  }

  function validateBackup(raw) {
    if (!isObject(raw) || raw.version !== 1 || !isObject(raw.courses)) {
      throw new Error("备份格式不正确，请选择本站导出的版本 1 JSON 文件。");
    }
    const knownIds = new Set(courses.map((course) => course.id));
    const valid = Object.create(null);
    let ignored = 0;
    for (const [id, record] of Object.entries(raw.courses)) {
      if (!knownIds.has(id)) { ignored += 1; continue; }
      if (!isObject(record) || !Object.hasOwn(STATES, record.status) ||
          !Number.isInteger(record.progress) || record.progress < 0 || record.progress > 100) {
        throw new Error("备份中有无效进度：状态须有效，百分比须为 0–100 的整数。原记录未更改。");
      }
      const expected = record.progress === 0 ? "not_started" : record.progress === 100 ? "done" : "in_progress";
      if (record.status !== expected) {
        throw new Error("备份中的状态与进度不一致（0% 待开始，100% 已完成）。原记录未更改。");
      }
      valid[id] = { status: record.status, progress: record.progress };
    }
    if (!Object.keys(valid).length) throw new Error("备份中没有与当前课单匹配的课程。原记录未更改。");
    return { records: valid, ignored };
  }

  function loadProgress() {
    records = defaults();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        Object.assign(records, validateBackup(JSON.parse(saved)).records);
        $("save-state").textContent = "已恢复上次的学习进度 · 自动保存已开启";
      }
    } catch (error) {
      storageWarning("无法读取本地记录，请检查浏览器存储或导入备份");
      notify("未能读取原有进度，暂显示初始课单。原存储未被覆盖。");
    }
  }

  function backup() {
    return { version: 1, updatedAt: new Date().toISOString(), courses: records };
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(backup()));
      $("save-state").textContent = "已自动保存 · " + new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      $("save-state").classList.remove("error");
      return true;
    } catch (error) {
      storageWarning("本地保存失败，刷新前请导出 JSON 备份");
      return false;
    }
  }

  function updateSummary() {
    const values = Object.values(records);
    const average = Math.round(values.reduce((sum, record) => sum + record.progress, 0) / courses.length);
    $("overall-value").textContent = average;
    $("overall-progress").value = average;
    $("overall-progress").textContent = average + "%";
    $("done-count").replaceChildren(document.createTextNode(values.filter((record) => record.status === "done").length), element("span", "", " / " + courses.length));
    $("active-count").textContent = values.filter((record) => record.status === "in_progress").length;
    $("pending-count").textContent = values.filter((record) => record.status === "not_started").length;
    TRACKS.forEach((track, index) => {
      const group = courses.filter((course) => course.track === track.name);
      const completed = group.filter((course) => records[course.id].status === "done").length;
      $("track-completion-" + index).textContent = `${completed} / ${group.length} 已完成`;
    });
  }

  function updateCard(id) {
    const { card, select, slider, output } = cards.get(id);
    const record = records[id];
    card.dataset.status = record.status;
    select.value = record.status;
    slider.value = record.progress;
    slider.style.setProperty("--fill", record.progress + "%");
    slider.setAttribute("aria-valuetext", `${record.progress}%，${STATES[record.status]}`);
    output.value = record.progress + "%";
  }

  function changeProgress(id, progress) {
    records[id] = { progress, status: progress === 0 ? "not_started" : progress === 100 ? "done" : "in_progress" };
    updateCard(id);
    updateSummary();
    saveProgress();
  }

  function renderCard(course) {
    const card = element("article", "course-card");
    card.setAttribute("aria-labelledby", "title-" + course.id);
    const top = element("div", "card-top");
    top.append(element("span", "course-index", "课程 " + String(course.order).padStart(2, "0")));
    const select = element("select", "status-select");
    select.setAttribute("aria-label", course.title + "：学习状态");
    Object.entries(STATES).forEach(([value, label]) => {
      const option = element("option", "", label);
      option.value = value;
      select.append(option);
    });
    select.addEventListener("change", () => {
      const current = records[course.id].progress;
      changeProgress(course.id, select.value === "done" ? 100 : select.value === "not_started" ? 0 : Math.min(99, Math.max(1, current)));
    });
    top.append(select);
    const title = element("h4", "course-title", course.title);
    title.id = "title-" + course.id;
    const links = element("div", "course-links");
    for (const link of course.urls) {
      const anchor = element("a", "course-link", link.label);
      const url = new URL(link.url);
      if (!["https:", "http:"].includes(url.protocol)) continue;
      anchor.href = url.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.setAttribute("aria-label", `${course.title}：${link.label}（新标签页打开）`);
      links.append(anchor);
    }
    const progress = element("div", "course-progress");
    const heading = element("div", "course-progress-heading");
    const label = element("label", "", "学习进度");
    label.htmlFor = "progress-" + course.id;
    const output = element("output", "course-value");
    output.htmlFor = label.htmlFor;
    heading.append(label, output);
    const slider = element("input", "course-slider");
    Object.assign(slider, { type: "range", min: "0", max: "100", step: "1", id: label.htmlFor });
    slider.setAttribute("aria-label", course.title + "：学习进度");
    slider.addEventListener("input", () => changeProgress(course.id, Number(slider.value)));
    progress.append(heading, slider);
    card.append(top, title, element("p", "teacher", course.teacher), element("p", "platform", course.platform), links, element("p", "course-note", course.note), progress);
    cards.set(course.id, { card, select, slider, output });
    updateCard(course.id);
    return card;
  }

  function renderCourses() {
    const groups = $("course-groups");
    TRACKS.forEach((track, index) => {
      const section = element("section", "track-section");
      section.id = "track-" + (index + 1);
      section.setAttribute("aria-labelledby", "track-title-" + index);
      const heading = element("div", "track-heading");
      const title = element("h3", "", track.name);
      title.id = "track-title-" + index;
      const completion = element("span", "track-completion");
      completion.id = "track-completion-" + index;
      heading.append(element("span", "track-number", String(index + 1).padStart(2, "0")), title, element("span", "track-caption", track.caption), completion);
      const grid = element("div", "cards");
      courses.filter((course) => course.track === track.name).forEach((course) => grid.append(renderCard(course)));
      section.append(heading, grid);
      groups.append(section);
    });
    updateSummary();
  }

  function renderPlan(data) {
    const lines = data.studyPlan.trim().split("\n");
    lines.forEach((line) => {
      const text = line.trim().replace(/^→\s*/, "");
      if (text.startsWith("并行支线：")) {
        $("study-branch").textContent = text;
        return;
      }
      const item = element("li");
      const firstParenthesis = text.indexOf("（");
      const title = firstParenthesis === -1 ? text : text.slice(0, firstParenthesis);
      const detail = firstParenthesis === -1 ? "" : text.slice(firstParenthesis);
      item.append(element("strong", "", title), element("small", "", detail));
      $("study-route").append(item);
    });
    $("study-context").textContent = data.studyContext;
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify(backup(), null, 2) + "\n"], { type: "application/json;charset=utf-8" });
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
      try { raw = JSON.parse((await file.text()).replace(/^\uFEFF/, "")); }
      catch { throw new Error("无法解析 JSON 文件，原有进度未更改。"); }
      pendingImport = validateBackup(raw);
      const count = Object.keys(pendingImport.records).length;
      $("import-description").textContent = `将用「${file.name}」更新 ${count} 门课程的状态与进度。` + (pendingImport.ignored ? `另有 ${pendingImport.ignored} 条不匹配记录，将忽略。` : "");
      $("import-dialog").returnValue = "";
      $("import-dialog").showModal();
    } catch (error) {
      notify(error.message);
    } finally {
      $("import-button").disabled = false;
    }
  }

  function attachEvents() {
    $("export-button").addEventListener("click", exportProgress);
    $("backup-button").addEventListener("click", exportProgress);
    $("import-button").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", prepareImport);
    $("import-dialog").addEventListener("close", () => {
      if ($("import-dialog").returnValue === "confirm" && pendingImport) {
        Object.assign(records, pendingImport.records);
        courses.forEach((course) => updateCard(course.id));
        updateSummary();
        const saved = saveProgress();
        notify(saved ? "进度已导入并保存，接着上次的地方继续学吧。" : "进度已导入，但本地保存失败。请导出备份后再关闭页面。");
      }
      pendingImport = null;
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try {
        records = event.newValue ? { ...defaults(), ...validateBackup(JSON.parse(event.newValue)).records } : defaults();
        courses.forEach((course) => updateCard(course.id));
        updateSummary();
        $("save-state").textContent = "已同步此浏览器其他标签页的进度";
        $("save-state").classList.remove("error");
      } catch { notify("其他标签页的记录格式异常，当前进度保持不变。"); }
    });
  }

  async function init() {
    const data = window.COURSE_DATA;
    if (!data || !Array.isArray(data.courses)) throw new Error("课程数据未加载，请确认 js/courses-data.js 文件完整。");
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
    loadProgress();
    renderPlan(data);
    renderCourses();
    attachEvents();
  }

  init().catch((error) => {
    $("error-banner").textContent = "页面加载失败：" + error.message;
    $("error-banner").hidden = false;
  });
})();
