#!/usr/bin/env python3
"""由唯一来源 data/courses.source.json 生成 js/courses-data.js。仅用标准库。

用法：
  python3 scripts/build_data.py            校验来源并生成（B 站时长读缓存，缺的 BV 才联网拉取）
  python3 scripts/build_data.py --refresh  重新拉取全部 B 站分 P，提示 P 数或时长变化
  python3 scripts/build_data.py --check    只校验：生成结果与仓库里的 js/courses-data.js 不一致时退出码 1

B 站分 P 缓存在 data/bilibili-pages.json（提交进仓库，离线也能构建）。
需要代理时设置 HTTPS_PROXY，例如 HTTPS_PROXY=http://127.0.0.1:7897。
"""
import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data/courses.source.json"
CACHE = ROOT / "data/bilibili-pages.json"
OUTPUT = ROOT / "js/courses-data.js"

ROLES = {"core", "elective", "alternative"}
KINDS = {"learn", "practice", "teach"}
LINK_KINDS = {"official", "video", "docs", "tool"}
COLORS = {"violet", "blue", "teal", "orange", "pink", "amber", "cyan", "green"}
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"


class DataError(Exception):
    pass


def fail(message):
    raise DataError(message)


def bili_get(url):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.bilibili.com/"})
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.load(response)
    if payload.get("code") != 0:
        raise RuntimeError(f"B 站接口返回 code={payload.get('code')}：{payload.get('message')}")
    return payload["data"]


def fetch_video(bv):
    view = bili_get(f"https://api.bilibili.com/x/web-interface/view?bvid={bv}")
    pages = bili_get(f"https://api.bilibili.com/x/player/pagelist?bvid={bv}")
    return {
        "title": view.get("title", ""),
        "owner": (view.get("owner") or {}).get("name", ""),
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "pages": [[page["page"], page["duration"], page["part"]] for page in pages],
    }


def referenced_bvs(source):
    found = set()
    for course in source["courses"]:
        for link in course.get("links", []):
            if link.get("bv"):
                found.add(link["bv"])
        for chapter in course.get("outline", []):
            bv = (chapter.get("ref") or {}).get("bv")
            if bv:
                found.add(bv)
    return sorted(found)


def load_cache(source, refresh):
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    changed = False
    for bv in referenced_bvs(source):
        if bv in cache and not refresh:
            continue
        try:
            fresh = fetch_video(bv)
        except Exception as error:  # 网络失败时沿用缓存，没有缓存才报错
            if bv in cache:
                print(f"! {bv} 拉取失败，沿用缓存：{error}", file=sys.stderr)
                continue
            fail(f"{bv} 没有缓存且拉取失败：{error}")
        old = cache.get(bv)
        if old and (len(old["pages"]) != len(fresh["pages"]) or sum(p[1] for p in old["pages"]) != sum(p[1] for p in fresh["pages"])):
            print(f"! {bv} 有变化：{len(old['pages'])}P → {len(fresh['pages'])}P，请复核大纲的 P 范围", file=sys.stderr)
        elif not old:
            print(f"+ {bv} {len(fresh['pages'])}P · {fresh['title'][:40]}")
        cache[bv] = fresh
        changed = True
        time.sleep(0.3)
    if changed:
        CACHE.write_text(json.dumps(dict(sorted(cache.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return cache


def ranges_of(ref):
    """ref.p 支持 [a, b] 或 [[a, b], [c, d]]；没有 p 表示整条视频。"""
    p = ref.get("p")
    if p is None:
        return None
    if len(p) == 2 and all(isinstance(x, int) for x in p):
        return [p]
    return p


def hours(seconds):
    return f"{seconds / 3600:.1f}h"


def build(source, cache):
    tiers = {tier["id"]: tier for tier in source["tiers"]}
    tracks = {}
    for track in source["tracks"]:
        if track["tier"] not in tiers:
            fail(f"学习线 {track['id']} 的 tier 不存在：{track['tier']}")
        if track["color"] not in COLORS:
            fail(f"学习线 {track['id']} 的颜色未定义：{track['color']}（可选 {sorted(COLORS)}）")
        tracks[track["id"]] = track

    courses = []
    course_ids = set()
    chapter_ids = set()
    orders = []
    groups = {}
    for raw in source["courses"]:
        course = json.loads(json.dumps(raw))
        cid = course["id"]
        if cid in course_ids:
            fail(f"课程 id 重复：{cid}")
        course_ids.add(cid)
        if course["track"] not in tracks:
            fail(f"{cid} 的学习线不存在：{course['track']}")
        course["tier"] = tracks[course["track"]]["tier"]
        if course.get("role", "core") not in ROLES:
            fail(f"{cid} 的 role 无效：{course.get('role')}")
        course.setdefault("role", "core")
        orders.append(course["order"])
        if course.get("choiceGroup"):
            groups.setdefault(course["choiceGroup"], []).append(course)
        if not any(link.get("primary") for link in course["links"]):
            fail(f"{cid} 需要一个 primary 链接（「接着学」的兜底入口）")
        for link in course["links"]:
            if link.get("kind") not in LINK_KINDS:
                fail(f"{cid} 的链接 kind 无效：{link}")
            if not link["url"].startswith("https://"):
                fail(f"{cid} 的链接须为 https：{link['url']}")
            if link.get("bv") and not link.get("meta"):
                pages = cache[link["bv"]]["pages"]
                link["meta"] = f"{len(pages)}P · {hours(sum(p[1] for p in pages))}"
            link.pop("bv", None)

        local = set()
        total = 0
        for chapter in course["outline"]:
            chid = chapter["id"]
            if chid in local or chid in chapter_ids:
                fail(f"章节 id 重复：{cid}/{chid}（章节 id 须全站唯一）")
            local.add(chid)
            chapter_ids.add(chid)
            chapter.setdefault("kind", "learn")
            if chapter["kind"] not in KINDS:
                fail(f"{cid}/{chid} 的 kind 无效：{chapter['kind']}")
            ref = chapter.get("ref") or {}
            if ref.get("bv"):
                pages = cache[ref["bv"]]["pages"]
                spans = ranges_of(ref)
                if spans is None:
                    picked = pages
                else:
                    picked = []
                    for start, end in spans:
                        if not (1 <= start <= end <= len(pages)):
                            fail(f"{cid}/{chid} 的 P 范围 {start}–{end} 超出 {ref['bv']} 的 {len(pages)}P")
                        picked.extend(pages[start - 1:end])
                    ref["label"] = "P" + "、".join(f"{a}" if a == b else f"{a}–{b}" for a, b in spans)
                    ref["start"] = spans[0][0]
                seconds = sum(page[1] for page in picked)
                if "minutes" not in chapter:
                    chapter["minutes"] = max(1, round(seconds / 60))
                    chapter["exact"] = True
                ref["videoMinutes"] = max(1, round(seconds / 60))
            elif chapter["kind"] != "teach" and "minutes" not in chapter:
                fail(f"{cid}/{chid} 没有 B 站引用，需要手填 minutes（预估）")
            if chapter["kind"] != "teach" and not chapter.get("optional"):
                total += chapter.get("minutes", 0)
        if not any(ch["kind"] != "teach" and not ch.get("optional") for ch in course["outline"]):
            fail(f"{cid} 至少需要一个计入进度的章节")
        for old, new in (course.get("legacyIds") or {}).items():
            if new not in local:
                fail(f"{cid} 的 legacyIds 指向不存在的章节：{old} → {new}")
        course["requiredMinutes"] = total
        courses.append(course)

    if sorted(orders) != list(range(1, len(orders) + 1)):
        fail(f"order 须从 1 连续编号，当前：{sorted(orders)}")
    for name, members in groups.items():
        cores = [course["id"] for course in members if course["role"] == "core"]
        if len(cores) != 1:
            fail(f"二选一分组 {name} 须恰好有一门 role=core，当前：{cores}")
    for course in courses:
        for pre in course.get("prereq", []):
            if pre not in course_ids:
                fail(f"{course['id']} 的前置课程不存在：{pre}")
    route = source["route"]
    for step in route["steps"]:
        for cid in step["courses"]:
            if cid not in course_ids:
                fail(f"路线引用了不存在的课程：{cid}")
    for branch in route["branches"]:
        for group in branch["groups"]:
            for cid in group:
                if cid not in course_ids:
                    fail(f"路线引用了不存在的课程：{cid}")

    courses.sort(key=lambda course: course["order"])
    return {
        "schema": 2,
        "sources": source["meta"]["sources"],
        "tiers": source["tiers"],
        "tracks": source["tracks"],
        "courses": courses,
        "route": route,
    }


def render(data):
    payload = json.dumps(data, ensure_ascii=False, indent=1)
    return ("// 自动生成：python3 scripts/build_data.py（来源 data/courses.source.json），请勿手改。\n"
            "window.COURSE_DATA = " + payload + ";\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--refresh", action="store_true", help="重新拉取全部 B 站分 P")
    parser.add_argument("--check", action="store_true", help="只校验，不写文件")
    args = parser.parse_args()
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    if source.get("schema") != 2:
        fail("data/courses.source.json 须为 schema 2")
    cache = load_cache(source, args.refresh and not args.check)
    text = render(build(source, cache))
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != text:
            print("js/courses-data.js 与来源不一致，请运行 python3 scripts/build_data.py", file=sys.stderr)
            return 1
        print("数据校验通过，js/courses-data.js 与来源一致。")
        return 0
    OUTPUT.write_text(text, encoding="utf-8")
    data = json.loads(text[text.index("{"):text.rindex("}") + 1])
    courses = data["courses"]
    chapters = sum(len(course["outline"]) for course in courses)
    links = sum(len(course["links"]) for course in courses)
    print(f"已生成 js/courses-data.js：{len(courses)} 门课程，{chapters} 个章节，{links} 个链接。")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except DataError as error:
        print("数据错误：" + str(error), file=sys.stderr)
        sys.exit(2)
