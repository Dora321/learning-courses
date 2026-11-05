// 冒烟测试：用本机 Chrome 无头模式打开页面，在桌面 1440 与手机 390、浅色与深色下走一遍关键路径并截图。
// 用法：node tests/smoke.mjs [截图目录，默认 /tmp/manmanxue-smoke]
// 不依赖 npm 包：静态服务用 python3 -m http.server，浏览器通过 DevTools 协议（Node 自带 WebSocket）驱动。
// 不会访问 GitHub：同步只测弹窗与界面，不配置令牌。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = process.argv[2] || join(tmpdir(), "manmanxue-smoke");
const PORT = 8700 + Math.floor(Math.random() * 200);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].find((path) => existsSync(path));
const KEY = "learning-courses-progress-v1";
const UI_KEY = "learning-courses-ui";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
};

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${!ok && detail !== "" ? ` —— ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures += 1;
};

// —— 极简 DevTools 协议客户端 ——
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }
  async open() {
    await new Promise((ok, fail) => { this.ws.onopen = ok; this.ws.onerror = fail; });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) waiter.fail(new Error(message.error.message));
        else waiter.ok(message.result);
      } else {
        this.listeners.forEach((listener) => listener(message));
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  on(listener) { this.listeners.add(listener); }
}

class Page {
  constructor(cdp, session) {
    this.cdp = cdp;
    this.session = session;
    this.errors = [];
    cdp.on((message) => {
      if (message.sessionId !== session) return;
      if (message.method === "Runtime.exceptionThrown") this.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") this.errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") this.errors.push(message.params.entry.text + " " + (message.params.entry.url || ""));
    });
  }
  static async create(cdp, url = "about:blank") {
    const { targetId } = await cdp.send("Target.createTarget", { url });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(cdp, sessionId);
    await page.send("Runtime.enable");
    await page.send("Log.enable");
    await page.send("Page.enable");
    return page;
  }
  send(method, params) { return this.cdp.send(method, params, this.session); }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async until(expression, timeout = 8000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.eval(expression).catch(() => false)) return true;
      await sleep(80);
    }
    return false;
  }
  async open(path = "/") {
    await this.send("Page.navigate", { url: ORIGIN + path });
    await this.until(`document.readyState === "complete" && (document.querySelectorAll(".course-card").length > 0 || !document.getElementById("error-banner").hidden)`);
    await sleep(150);
  }
  async view(name) {
    await this.send("Emulation.setDeviceMetricsOverride", VIEWPORTS[name]);
    await this.send("Emulation.setTouchEmulationEnabled", { enabled: VIEWPORTS[name].mobile, maxTouchPoints: 5 });
  }
  async scheme(value) {
    await this.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
  }
  async shot(file, selector) {
    if (selector) await this.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "start", behavior: "instant" }); scrollBy(0, -12)`);
    else await this.eval(`scrollTo(0, 0)`);
    await sleep(700);
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(SHOTS, file), Buffer.from(data, "base64"));
  }
}

const doc = (page) => page.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || "null")`);
const click = (page, selector) => page.eval(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error("找不到 " + ${JSON.stringify(selector)}); node.click(); return true; })()`);

async function freshStart(page) {
  await page.open("/");
  await page.eval(`localStorage.clear()`);
  await page.open("/");
}

// —— 关键路径 ——
async function functional(page, name, downloads) {
  console.log(`\n[${name}] 关键路径`);
  await freshStart(page);
  page.errors.length = 0;

  const layout = await page.eval(`({
    banner: !document.getElementById("error-banner").hidden,
    cards: document.querySelectorAll(".course-card").length,
    steps: document.querySelectorAll("#study-route .route-step").length,
    branches: document.querySelectorAll(".route-branch").length,
    emptyBranch: [...document.querySelectorAll(".branch-flow")].some((node) => !node.textContent.trim()),
    cells: document.querySelectorAll("#heatmap .heat-cell").length,
    tiers: ["tier-main", "teaching", "tier-extend", "tier-upskill"].every((id) => document.getElementById(id)),
    order: [...document.querySelectorAll("#course-groups > section")].map((node) => node.id).join(","),
    overall: document.getElementById("overall-value").textContent,
    nextLabel: document.getElementById("next-label").textContent,
    nextTitle: (document.querySelector("#next-body .next-title") || {}).textContent,
    openGroups: [...document.querySelectorAll(".track-group")].filter((node) => node.open).length,
    noTrackColor: [...document.querySelectorAll("[data-color]")].filter((node) => !getComputedStyle(node).getPropertyValue("--track").trim()).length,
    teachItems: document.querySelectorAll("#teaching .teach-item").length,
    overflow: document.documentElement.scrollWidth - innerWidth,
    scopeNote: document.getElementById("scope-note").textContent
  })`);
  check(!layout.banner, "页面加载无错误横幅");
  check(layout.cards === 17, "渲染 17 门课程卡", layout.cards);
  check(layout.steps === 4 && layout.branches === 2 && !layout.emptyBranch, "路线 4 步 + 2 条分支，无空框", layout);
  check(layout.cells === 84, "热力图 12 周 × 7 天", layout.cells);
  check(layout.tiers && layout.order === "tier-main,teaching,tier-extend,tier-upskill", "三层 + 「我正在教」在主线下方", layout.order);
  check(layout.overall === "0" && layout.nextLabel === "从这里开始" && /ESP32 \+ MicroPython/.test(layout.nextTitle), "空状态引导指向 ESP32 第一节", layout);
  check(layout.openGroups === 0, "老师补强默认全部折叠", layout.openGroups);
  check(layout.noTrackColor === 0, "所有学习线都有颜色", layout.noTrackColor);
  check(layout.teachItems >= 10, "「我正在教」列出教学产出", layout.teachItems);
  check(layout.overflow <= 0, "没有横向溢出", layout.overflow);
  check(/主线 3 门/.test(layout.scopeNote) && /江协/.test(layout.scopeNote), "进度环下有口径说明", layout.scopeNote);

  // 勾掉第一节
  await click(page, "#next-body .next-actions .button-primary");
  await sleep(150);
  let saved = await doc(page);
  const afterFirst = await page.eval(`({
    overall: Number(document.getElementById("overall-value").textContent),
    label: document.getElementById("next-label").textContent,
    week: document.getElementById("record-week").textContent,
    last: document.getElementById("record-last").textContent,
    today: (document.querySelector(".heat-cell.is-today") || {}).dataset?.level,
    status: document.getElementById("course-esp32-geeksman-mpy").dataset.status,
    outlineOpen: document.querySelector("#course-esp32-geeksman-mpy details.outline").open
  })`);
  check(saved && saved.version === 2 && saved.courses["esp32-geeksman-mpy"].chapters["gk-start"].state === "done", "勾选写入 v2 文档（按章节 + 时间戳）", saved);
  check(afterFirst.overall >= 1 && afterFirst.label === "接着学", "主线进度环亮起，「接着学」接上", afterFirst);
  check(/^1 节/.test(afterFirst.week) && afterFirst.last === "今天" && afterFirst.today === "1", "学习记录：本周 1 节 · 今天 · 热力图今天一格", afterFirst);
  check(afterFirst.status === "in_progress" && afterFirst.outlineOpen, "课程变为学习中，大纲默认展开", afterFirst);

  // 放进本周课表，再在课表里勾掉
  await click(page, `#next-body [data-focus="next:plan"]`);
  await sleep(120);
  const plan = await page.eval(`({
    items: document.querySelectorAll("#plan-list .plan-item").length,
    ics: document.getElementById("plan-ics").disabled,
    pressed: document.querySelector('#next-body [data-focus="next:plan"]').getAttribute("aria-pressed")
  })`);
  check(plan.items === 1 && !plan.ics && plan.pressed === "true", "「＋ 本周」加入课表，.ics 可导出", plan);
  await click(page, "#plan-list .plan-item input[type=checkbox]");
  await sleep(120);
  const crossed = await page.eval(`({ done: document.querySelector("#plan-list .plan-item").dataset.done, hint: document.getElementById("plan-hint").textContent })`);
  check(crossed.done === "true" && /本周 1\/1 节/.test(crossed.hint), "课表里勾掉后自动划掉", crossed);
  saved = await doc(page);
  check(Object.keys(saved.plan).length === 1 && saved.plan["esp32-geeksman-mpy/gk-gpio-out"], "课表写进进度文档（随 Gist 同步）", saved.plan);

  // 跳过一节：不计入分母
  const before = await page.eval(`document.querySelector("#course-esp32-geeksman-mpy .course-value").value`);
  await page.eval(`[...document.querySelectorAll("#course-esp32-geeksman-mpy .outline-item")].find((row) => /数码管/.test(row.textContent)).querySelector(".skip-button").click()`);
  await sleep(120);
  const skipped = await page.eval(`(() => {
    const row = [...document.querySelectorAll("#course-esp32-geeksman-mpy .outline-item")].find((item) => /数码管/.test(item.textContent));
    return { state: row.dataset.state, label: row.querySelector(".skip-button").textContent, pct: document.querySelector("#course-esp32-geeksman-mpy .course-value").value };
  })()`);
  check(skipped.state === "skipped" && skipped.label === "已跳过" && parseInt(skipped.pct) > parseInt(before), "跳过的章节不计入分母", { before, ...skipped });

  // .ics 导出
  for (const file of readdirSync(downloads)) rmSync(join(downloads, file));
  await click(page, "#plan-ics");
  let ics = "";
  for (let i = 0; i < 40 && !ics; i += 1) {
    await sleep(100);
    const file = readdirSync(downloads).find((item) => item.endsWith(".ics"));
    if (file) ics = readFileSync(join(downloads, file), "utf8");
  }
  check(ics.startsWith("BEGIN:VCALENDAR\r\n") && /BEGIN:VEVENT/.test(ics) && /SUMMARY:学：/.test(ics), "导出 .ics 文件", ics.slice(0, 80));

  // 折叠偏好：手动展开 STM32 会记住；筛选造成的开合不会被记住
  await page.eval(`document.querySelector("#track-stm32 > summary").click()`);
  await sleep(150);
  await page.eval(`[...document.querySelectorAll(".filter-button")].find((node) => node.textContent.startsWith("学习中")).click()`);
  await sleep(150);
  const filtered = await page.eval(`({
    visible: [...document.querySelectorAll(".course-card")].filter((node) => node.offsetParent).length,
    upskillHidden: document.getElementById("tier-upskill").hidden
  })`);
  check(filtered.visible === 1 && filtered.upskillHidden, "筛选「学习中」只剩 1 门", filtered);
  await page.eval(`[...document.querySelectorAll(".filter-button")].find((node) => node.textContent.startsWith("全部")).click()`);
  await sleep(150);
  const restored = await page.eval(`({
    visible: [...document.querySelectorAll(".course-card")].filter((node) => !node.hidden).length,
    stm32: document.getElementById("track-stm32").open,
    others: [...document.querySelectorAll(".track-group")].filter((node) => node.open).length,
    ui: JSON.parse(localStorage.getItem(${JSON.stringify(UI_KEY)}) || "{}").groups
  })`);
  check(restored.visible === 17 && restored.stm32 && restored.others === 1, "回到「全部」恢复原来的折叠状态", restored);
  check(JSON.stringify(restored.ui) === JSON.stringify({ stm32: true }), "只记住手动开合，筛选没有污染偏好", restored.ui);

  // 挑课弹窗与同步弹窗
  await click(page, "#plan-pick");
  await sleep(150);
  const picker = await page.eval(`({ open: document.getElementById("plan-dialog").open, groups: document.querySelectorAll("#plan-picker .picker-course").length })`);
  check(picker.open && picker.groups >= 5, "「挑几节」弹窗列出各课下一节", picker);
  if (name.startsWith("desktop")) await page.shot(`${name}-plan-dialog.png`);
  await click(page, "#plan-done");
  await click(page, "#sync-open");
  await sleep(150);
  const sync = await page.eval(`({ open: document.getElementById("sync-dialog").open, form: !document.getElementById("token-form").hidden, history: document.getElementById("sync-history").hidden, secret: /secret Gist/.test(document.getElementById("sync-dialog").textContent) })`);
  check(sync.open && sync.form && sync.history && sync.secret, "同步弹窗：未配置令牌时显示表单，文案为 secret Gist", sync);
  await page.shot(`${name}-sync-dialog.png`);
  await click(page, "#sync-close");

  // 刷新后进度还在
  await page.open("/");
  const reloaded = await page.eval(`({ overall: Number(document.getElementById("overall-value").textContent), skipped: [...document.querySelectorAll("#course-esp32-geeksman-mpy .outline-item")].filter((row) => row.dataset.state === "skipped").length })`);
  check(reloaded.overall >= 1 && reloaded.skipped === 1, "刷新后进度保留", reloaded);

  // 同一浏览器的另一个标签页改了进度：按章节合并进来
  const other = await Page.create(page.cdp, ORIGIN + "/");
  await other.until(`document.querySelectorAll(".course-card").length > 0`);
  await other.eval(`document.querySelector("#course-c-wengkai .outline-item input[type=checkbox]").click()`);
  await sleep(300);
  const merged = await page.eval(`({ c: document.querySelector("#course-c-wengkai .course-value").value, mine: document.querySelector("#course-esp32-geeksman-mpy .course-value").value })`);
  check(merged.c !== "0%" && merged.mine !== "0%", "其他标签页的勾选合并进来，本页勾选不丢", merged);
  await page.cdp.send("Target.closeTarget", { targetId: (await other.send("Target.getTargetInfo")).targetInfo.targetId });

  // 旧版（v1）记录自动升级
  await page.eval(`localStorage.clear(); localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ version: 1, courses: { "c-wengkai": { status: "in_progress", progress: 29, checked: ["01", "02"], updatedAt: "2026-11-05T12:00:00.000Z" } } }))`);
  await page.open("/");
  saved = await doc(page);
  const backup = await page.eval(`Boolean(localStorage.getItem(${JSON.stringify(KEY + "-backup-v1")}))`);
  const chapters = saved && saved.courses["c-wengkai"] ? Object.keys(saved.courses["c-wengkai"].chapters).sort().join(",") : "";
  check(saved && saved.version === 2 && chapters === "c-intro,c-types" && backup, "v1 记录按 legacyIds 升级并留原始备份", { chapters, backup });

  check(page.errors.length === 0, "控制台没有报错", page.errors);
}

async function screenshots(page, name) {
  await freshStart(page);
  // 勾几节，让进度、热力图和课表都有内容
  await page.eval(`(async () => {
    const wait = () => new Promise((ok) => setTimeout(ok, 60));
    for (let i = 0; i < 3; i += 1) { document.querySelector("#next-body .next-actions .button-primary").click(); await wait(); }
    document.querySelector('#next-body [data-focus="next:plan"]').click(); await wait();
    document.querySelector("#course-c-wengkai .outline-item input[type=checkbox]").click(); await wait();
    document.querySelector('#course-c-wengkai [data-focus="card-c-wengkai:plan"]').click(); await wait();
  })()`);
  await sleep(200);
  const opened = await page.eval(`({ group: document.getElementById("track-basics").open, outline: document.querySelector("#course-c-wengkai details.outline").open })`);
  check(opened.group && opened.outline, `[${name}] 开始学的补强课：分组与大纲自动展开`, opened);
  const overflow = await page.eval(`document.documentElement.scrollWidth - innerWidth`);
  check(overflow <= 0, `[${name}] 没有横向溢出`, overflow);
  await page.shot(`${name}-1-dashboard.png`);
  await page.shot(`${name}-2-roadmap.png`, "#roadmap");
  await page.shot(`${name}-3-courses.png`, "#courses");
  await page.shot(`${name}-4-teaching.png`, "#teaching");
  await page.shot(`${name}-5-upskill.png`, "#tier-upskill");
  await page.shot(`${name}-6-backup.png`, "#backup");
}

async function main() {
  if (!CHROME) {
    console.log("没有找到 Chrome，跳过冒烟测试（可用环境变量 CHROME 指定路径）。");
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "manmanxue-chrome-"));
  const downloads = mkdtempSync(join(tmpdir(), "manmanxue-dl-"));
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", ROOT], { stdio: "ignore" });
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--disable-extensions", "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const wsUrl = await new Promise((ok, fail) => {
      let buffer = "";
      chrome.stderr.on("data", (chunk) => {
        buffer += chunk;
        const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) ok(match[1]);
      });
      setTimeout(() => fail(new Error("Chrome 启动超时")), 15000);
    });
    for (let i = 0; i < 50; i += 1) {
      try { if ((await fetch(ORIGIN + "/index.html")).ok) break; } catch { /* 服务还没起来 */ }
      await sleep(100);
    }
    const cdp = new Cdp(wsUrl);
    await cdp.open();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
    const page = await Page.create(cdp);

    for (const view of ["desktop", "mobile"]) {
      await page.view(view);
      await page.scheme("light");
      await functional(page, `${view}-light`, downloads);
    }
    console.log("\n截图");
    for (const view of ["desktop", "mobile"]) {
      for (const scheme of ["light", "dark"]) {
        await page.view(view);
        await page.scheme(scheme);
        await screenshots(page, `${view}-${scheme}`);
      }
    }
    console.log(`\n截图保存在 ${SHOTS}`);
  } finally {
    chrome.kill();
    server.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
    rmSync(downloads, { recursive: true, force: true });
  }
  console.log(failures ? `\n冒烟测试失败：${failures} 项` : "\n冒烟测试全部通过");
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
