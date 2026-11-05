#!/usr/bin/env python3
"""从来源生成课程 JSON 和支持 file:// 的浏览器数据快照。仅用标准库。"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
source = (ROOT / "SOURCE_COURSES.md").read_text(encoding="utf-8")
tracks = ["语言与电路基础", "STM32嵌入式", "FreeRTOS与网络", "硬件与PCB"]
ids = ["c-wengkai", "analog-zheng", "circuits-shiqun", "stm32-tietou", "stm32-jiangxie", "freertos-wei", "lwip-alientek", "hardware-online", "pcb-fanyi"]
labels = [
    ["中国大学 MOOC", "B 站完整版", "B 站另一套"],
    ["B 站 4K 版", "B 站 1080P 版"],
    ["网易公开课 · 80 集", "B 站完整版", "B 站 4K 修复版"],
    ["B 站新版合集", "B 站第 4 版"],
    ["B 站 2023 版", "江协官网", "配套资料"],
    ["B 站课程", "百问网专栏"],
    ["官方新版资料", "B 站官方空间", "原子哥平台", "B 站旧版合集"],
    ["B 站 · 125 讲"],
    ["B 站 AD22/23 入门", "B 站两层板实战", "凡亿课堂"],
]

def plain(text):
    return re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text).replace("**", "").replace("`", "").strip()

courses = []
sections = re.findall(r"^## [一二三四]、[^\n]+\n(.*?)(?=^## |\Z)", source, re.M | re.S)
assert len(sections) == 4, "来源需包含四条学习线"
for track, section in zip(tracks, sections):
    for match in re.finditer(r"^### (\d+)\. ([^\n]+)\n(.*?)(?=^### |\Z)", section, re.M | re.S):
        number, title, body = match.groups()
        i = int(number) - 1
        teacher_full = re.search(r"^- 讲师(?: / 机构)?：(.+)$", body, re.M).group(1)
        teacher = plain(teacher_full.split("（")[0]).replace("B 站 UP「", "").replace("」", "")
        note = plain(re.search(r"^- 说明：(.+)$", body, re.M).group(1))
        if i == 2:
            note += " 讲师学校归属未确认；勿与于歆杰《电路原理》混淆。"
        found_urls = re.findall(r"\[[^\]]+\]\((https?://[^)]+)\)", body)
        assert len(found_urls) == len(labels[i]), f"课程 {i + 1} 链接数量变化，请同步入口标签"
        platforms = []
        for domain, name in [("icourse163.org", "中国大学 MOOC"), ("bilibili.com", "哔哩哔哩"), ("open.163.com", "网易公开课"), ("jiangxiekeji.com", "江协科技"), ("100ask.net", "百问网"), ("openedv.com", "正点原子官网"), ("yuanzige.com", "原子哥"), ("fanyedu.com", "凡亿课堂")]:
            if any(domain in url for url in found_urls):
                platforms.append(name)
        courses.append(dict(id=ids[i], track=track, title=plain(title.split(" · ", 1)[-1]), teacher=teacher, platform=" / ".join(platforms), urls=[dict(label=label, url=url) for label, url in zip(labels[i], found_urls)], note=note, status="not_started", progress=0, order=i + 1))

assert len(courses) == 9 and len({c["id"] for c in courses}) == 9
plan_section = source.split("## 建议学习顺序", 1)[1].split("\n---", 1)[0]
plan = re.search(r"```\n(.*?)\n```", plan_section, re.S).group(1)
context = plain(plan_section.split("```", 2)[-1])
(ROOT / "data").mkdir(exist_ok=True)
(ROOT / "js").mkdir(exist_ok=True)
json_text = json.dumps(courses, ensure_ascii=False, indent=2)
(ROOT / "data/courses.json").write_text(json_text + "\n", encoding="utf-8")
payload = json.dumps(dict(courses=courses, studyPlan=plan, studyContext=context), ensure_ascii=False, indent=2)
(ROOT / "js/courses-data.js").write_text("// 自动生成：python3 scripts/sync_courses.py，请勿单独修改。\nwindow.COURSE_DATA = " + payload + ";\n", encoding="utf-8")
print(f"已生成 data/courses.json、js/courses-data.js：{len(courses)} 门课程，{sum(len(c['urls']) for c in courses)} 个链接。")
