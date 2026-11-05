// 进度模型的单元测试：node --test tests/
// js/model.js 是普通脚本（浏览器里直接 <script> 引入），这里执行一遍后从 globalThis 取出。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

vm.runInThisContext(readFileSync(new URL("../js/model.js", import.meta.url), "utf8"), { filename: "js/model.js" });
const M = globalThis.ProgressModel;

const T = (minute) => new Date(Date.UTC(2026, 10, 6, 12, minute)).toISOString();
const doc = (courses, plan = {}) => M.normalize({ version: 2, courses, plan });
const ch = (state, minute) => ({ state, at: T(minute) });

test("按章节合并：两台设备勾了同一门课的不同章节，都保留", () => {
  const windows = doc({ jx: { chapters: { a: ch("done", 1) } } });
  const mac = doc({ jx: { chapters: { b: ch("done", 2) } } });
  const merged = M.merge(mac, windows);
  assert.equal(merged.courses.jx.chapters.a.state, "done");
  assert.equal(merged.courses.jx.chapters.b.state, "done");
});

test("取消勾选也会同步：较新的 none 覆盖较旧的 done", () => {
  const a = doc({ c: { chapters: { x: ch("done", 1) } } });
  const b = doc({ c: { chapters: { x: ch("none", 5) } } });
  assert.equal(M.merge(a, b).courses.c.chapters.x.state, "none");
  assert.equal(M.merge(b, a).courses.c.chapters.x.state, "none");
});

test("时间戳相同时两端合并结果一致", () => {
  const a = doc({ c: { chapters: { x: ch("done", 3) } } });
  const b = doc({ c: { chapters: { x: ch("skipped", 3) } } });
  assert.ok(M.same(M.merge(a, b), M.merge(b, a)));
});

test("v1 记录按 legacyIds 升级，滑条百分比记入 dropped", () => {
  M.configure({ legacy: { c: { "01": "c-intro", "02": "c-calc" } } });
  const upgraded = M.normalize({
    version: 1,
    courses: {
      c: { status: "in_progress", progress: 20, checked: ["01", "02", "99"], updatedAt: T(0) },
      old: { status: "in_progress", progress: 40, updatedAt: T(0) }
    }
  });
  assert.equal(upgraded.upgradedFrom, 1);
  assert.deepEqual(Object.keys(upgraded.courses.c.chapters).sort(), ["c-calc", "c-intro"]);
  assert.deepEqual(upgraded.dropped, ["old"]);
  M.configure({});
});

test("严格模式拒绝无效备份", () => {
  assert.throws(() => M.normalize({ version: 2, courses: { c: { chapters: { x: { state: "half", at: T(0) } } } } }, { strict: true }));
  assert.throws(() => M.normalize("nope", { strict: true }));
});

const course = {
  id: "c",
  role: "core",
  outline: [
    { id: "a", minutes: 60 },
    { id: "b", minutes: 30 },
    { id: "c", minutes: 10 },
    { id: "opt", minutes: 500, optional: true },
    { id: "t", kind: "teach" }
  ]
};

test("课程进度按分钟加权；选读、跳过、教学产出不计入", () => {
  let s = M.courseStats(course, {});
  assert.equal(s.pct, 0);
  assert.equal(s.totalMinutes, 100);
  assert.equal(s.next.id, "a");

  s = M.courseStats(course, { a: ch("done", 1) });
  assert.equal(s.pct, 60);
  assert.equal(s.status, "in_progress");
  assert.equal(s.next.id, "b");

  s = M.courseStats(course, { a: ch("done", 1), b: ch("done", 2), c: ch("skipped", 3) });
  assert.equal(s.pct, 100);
  assert.equal(s.totalMinutes, 90);
  assert.equal(s.status, "done");
  assert.equal(s.teachTotal, 1);
  assert.equal(s.teachDone, 0);

  // 没学完最多 99%，学了一点至少 1%
  s = M.courseStats({ id: "x", outline: [{ id: "big", minutes: 1000 }, { id: "tiny", minutes: 1 }] }, { big: ch("done", 1) });
  assert.equal(s.pct, 99);
  s = M.courseStats({ id: "x", outline: [{ id: "big", minutes: 1000 }, { id: "tiny", minutes: 1 }] }, { tiny: ch("done", 1) });
  assert.equal(s.pct, 1);
});

test("分区进度只算 role=core 的课程（备选、选学不计入）", () => {
  const core = { id: "core", role: "core", outline: [{ id: "k1", minutes: 100 }] };
  const alt = { id: "alt", role: "alternative", outline: [{ id: "k2", minutes: 100 }] };
  const stats = new Map([
    ["core", M.courseStats(core, {})],
    ["alt", M.courseStats(alt, { k2: ch("done", 1) })]
  ]);
  const group = M.groupStats([core, alt], (id) => stats.get(id));
  assert.equal(group.pct, 0);
  assert.equal(group.totalMinutes, 100);
});

test("changes 只数看得见的变化：状态与课表，不数时间戳", () => {
  const before = doc({ c: { chapters: { a: ch("done", 1), b: ch("none", 1) } } });
  const after = doc(
    { c: { chapters: { a: ch("done", 9), b: ch("done", 9), z: ch("none", 9) } } },
    { "c/b": { course: "c", chapter: "b", week: "2026-W45", day: null, at: T(9) } }
  );
  assert.deepEqual(M.changes(before, after), { chapters: 1, plan: 1 });
  const catalog = new Map([["c", new Set(["a"])]]);
  assert.deepEqual(M.changes(before, after, catalog), { chapters: 0, plan: 1 });
});

test("恢复历史版本：状态改回目标，并打上新时间戳", () => {
  const now = Date.UTC(2026, 10, 7);
  const local = doc({ c: { chapters: { a: ch("done", 5), b: ch("done", 6) } } });
  const target = doc({ c: { chapters: { a: ch("done", 1) } } });
  const restored = M.restore(local, target, now);
  assert.equal(restored.courses.c.chapters.a.state, "done");
  assert.equal(restored.courses.c.chapters.a.at, T(5));
  assert.equal(restored.courses.c.chapters.b.state, "none");
  assert.ok(Date.parse(restored.courses.c.chapters.b.at) >= now);
});

test("导入只写入当前课单里的章节", () => {
  const catalog = new Map([["c", new Set(["a"])]]);
  const incoming = doc({ c: { chapters: { a: ch("done", 1), ghost: ch("done", 1) } }, nope: { chapters: { q: ch("done", 1) } } });
  const result = M.importDoc(M.emptyDoc(), incoming, catalog);
  assert.equal(result.chapters, 1);
  assert.equal(result.ignored, 2);
  assert.equal(result.doc.courses.c.chapters.a.state, "done");
});

test("ISO 周编号与日历日间隔", () => {
  assert.equal(M.weekId(new Date(2026, 10, 6)), "2026-W45");
  assert.equal(M.weekId(new Date(2021, 0, 3)), "2020-W53");
  assert.equal(M.weekId(new Date(2024, 11, 30)), "2025-W01");
  assert.equal(M.daysBetween(new Date(2026, 10, 5, 23, 50), new Date(2026, 10, 6, 0, 10)), 1);
  assert.equal(M.daysBetween(new Date(2026, 10, 6, 8), new Date(2026, 10, 6, 22)), 0);
  assert.equal(M.daysBetween(new Date(2026, 2, 1), new Date(2026, 3, 1)), 31);
});

test("本周课表：上周没学完的顺延，学完或移出的不显示", () => {
  const d = doc({}, {
    "c/a": { course: "c", chapter: "a", week: "2026-W44", day: 1, at: T(1) },
    "c/b": { course: "c", chapter: "b", week: "2026-W44", day: 1, at: T(1) },
    "c/c": { course: "c", chapter: "c", week: "2026-W45", day: null, at: T(1) },
    "c/d": { course: "c", chapter: "d", week: "2026-W45", day: 2, at: T(1), removed: true }
  });
  const items = M.weekPlan(d, "2026-W45", (item) => item.chapter === "b");
  assert.deepEqual(items.map((item) => [item.chapter, item.carried]), [["a", true], ["c", false]]);
});

test(".ics：CRLF、全天事件、转义、按字节折行", () => {
  const text = M.buildIcs([{
    uid: "c.a.2026-W45@learning-courses",
    date: new Date(2026, 10, 8),
    summary: "学：STM32（铁头山羊）· 9 定时器：输出比较呼吸灯、输入捕获超声波、PWM 测量; 还有逗号, 和分号",
    url: "https://www.bilibili.com/video/BV11X4y1j7si/?p=40"
  }], { now: Date.UTC(2026, 10, 6) });
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.match(text, /DTSTART;VALUE=DATE:20261108\r\n/);
  assert.match(text, /DTEND;VALUE=DATE:20261109\r\n/);
  assert.match(text, /\\, 和分号/);
  for (const line of text.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const unfolded = text.replace(/\r\n /g, "");
  assert.match(unfolded, /SUMMARY:学：STM32（铁头山羊）· 9 定时器：输出比较呼吸灯、输入捕获超声波、PWM 测量\\; 还有逗号\\, 和分号/);
});
