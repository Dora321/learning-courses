# 慢慢学 · 个人课程学习站

单人自用的 ESP32 + 端侧 AI 教学学习站。17 门课分三层：

- **主线**：ESP32 + MicroPython、巴法 MQTT、asyncio；Python 入门是选学前置
- **课堂与拓展**：Mind+、K230 视觉、ESP32-S3 AI 语音、Wokwi 仿真
- **老师补强**：C、电路、模电、STM32、FreeRTOS、LwIP、硬件入门、PCB

课单共 183 个章节、50 个外链。站点按章节勾选记进度，有「本周课表」并能导出 `.ics`，还有近 12 周的学习记录，可以通过 GitHub Gist 在多台设备间同步。补强课单来自 [SOURCE_COURSES.md](SOURCE_COURSES.md)，主线和课堂拓展是自己定的。

站点只用 HTML、CSS 和 JavaScript，没有构建步骤，也没有 npm 包、账户系统或服务器。页面不加载远程字体和第三方脚本。只有两种情况会访问外部站点：打开课程链接，以及配置同步后访问 `api.github.com`。

## 本地打开

直接双击根目录的 **index.html** 即可。也可以起一个静态服务：

```sh
cd /Users/claw/Projects/learning-courses
python3 -m http.server 8080
```

然后访问 <http://localhost:8080>。日常建议固定用同一个 HTTP 地址，因为进度存在浏览器的 localStorage 里，换了地址、端口或浏览器就是另一份存储。

## 进度怎么算

- **章节勾选是唯一输入。** 展开课程卡的「课程大纲」，学完一节勾一节；也可以直接点卡片上「下一节」的「✓ 学完这节」。
- **课程进度 = 已完成章节的分钟数 ÷ 计入章节的总分钟数。**
  - 时长来自 B 站分 P，没有视频的章节用手填的预估值。
  - 下面三类不计入分母：标「选读」的章节、你点了「跳过」的章节、「教学产出」。
  - 学了任意一节至少显示 1%；还有计入的章节没学完，最多显示 99%。
- **首屏大字只算主线**（ESP32 主线 3 门，按工时加权）。补强、课堂与拓展各自单独用小字显示。
- **不计入的课程**仍然可以勾选，卡片上标「不计入」：
  - Python 入门：选学前置
  - Wokwi 仿真：选学
  - STM32 江协：备选。STM32 二选一只计铁头山羊。
  - LwIP：按需
- **石群《电路》只挑 1–9 章。** 10–18 章预设为选读，所以这门课的 100% 表示「挑讲的章节学完」。
- **「教学产出」单独统计**（例如「整理 C ↔ MicroPython 对照表」），汇总在「我正在教」分区。

## 本周课表与学习记录

- 点「＋ 挑几节」，从各门课的「下一节」里挑 1–5 节放进本周，也可以在卡片上点「＋ 本周」。每节可以指定星期几。
- 学完的会在课表里划掉。上周没学完的自动顺延，标「上周顺延」。
- 「导出 .ics」会把本周课表导出成全天事件，Mac 日历和 Outlook 双击即可导入。没指定星期几的放在周日，标「本周内」。
- 「学习记录」根据每节的完成时间，显示近 12 周的热力图、本周完成的节数和时长、上次学习是几天前。这里不做连续打卡。

## 多端同步（Mac / Windows）

进度默认只存在本机浏览器。配置同步后，进度会写进你 GitHub 账号下的一个 **secret Gist**，也就是 `js/sync-config.js` 里的 `gistId`。

> secret Gist 不会出现在你的 Gist 列表和搜索结果里，但它**不是私有的**：拿到地址的人不用登录就能查看。Gist 地址写在本仓库公开的 `sync-config.js` 里，所以请把它当作「半公开」，只放学习进度。

配置步骤：

1. 新建令牌。推荐用 [fine-grained token](https://github.com/settings/personal-access-tokens/new)，在 Account permissions 里把 `Gists` 设为 Read and write。也可以用 classic token，只勾 `gist`。
2. 打开学习站，点右上角的同步按钮，粘贴令牌并保存。令牌只存在当前浏览器，不会写进仓库。**不要在教室或公用电脑上粘贴令牌。**
3. Mac 和 Windows 各粘贴一次。之后：
   - 每次改动后约 1 秒自动推送。
   - 切回标签页、恢复联网时会自动拉取合并。

合并和历史：

- **按章节合并。** 每个章节记录 `{ state, at }`，合并时每个章节各自取较新的一端，课表条目也一样。所以两台电脑勾了同一门课的不同章节，都会保留。取消勾选也带时间戳，同样会同步过去。
- **同步历史与撤销。** 同步弹窗里能看到最近 5 次同步，包括时间、设备名和完成节数，可以「恢复到此」。恢复本身也算一次新的改动，之后还能再恢复回来。设备名可以在同步弹窗里修改。

## 备份与迁移

- 「导出 JSON」会下载完整进度，包括章节勾选、完成时间和课表。
- 在新设备上点「导入 JSON」并确认即可恢复。
  - 导入只更新文件里出现、且在当前课单里存在的章节，其他章节保持原样。
  - 无效文件会被整份拒绝。文件上限 1 MB。
- 旧版（v1）备份和旧版本地记录会被自动升级：
  - 勾选按 `legacyIds` 映射到新章节。
  - 原始的本地记录另存一份在 `learning-courses-progress-v1-backup-v1`。

进度文档 v2 的格式如下（localStorage、Gist、JSON 备份共用）：

```json
{
  "version": 2,
  "courses": {
    "stm32-tietou": { "chapters": { "tt-gpio": { "state": "done", "at": "2026-11-06T12:00:00.000Z" } } }
  },
  "plan": {
    "stm32-tietou/tt-uart": { "course": "stm32-tietou", "chapter": "tt-uart", "week": "2026-W45", "day": 2, "at": "2026-11-06T12:00:00.000Z" }
  }
}
```

其中 `state` 取 `done`、`skipped` 或 `none`；`day` 为 0–6，0 表示周一，`null` 表示「本周内」。

## 修改课程

唯一的数据来源是 **`data/courses.source.json`**，里面包括分层、学习线、课程、章节、链接和路线。改完之后运行：

```sh
python3 scripts/build_data.py            # 校验并生成 js/courses-data.js
python3 scripts/build_data.py --check    # 只校验；生成结果和仓库里的不一致时退出码为 1
HTTPS_PROXY=http://127.0.0.1:7897 python3 scripts/build_data.py --refresh   # 重新拉取 B 站分 P，提示 P 数或时长的变化
```

脚本只用 Python 标准库。B 站分 P 缓存在 `data/bilibili-pages.json`，所以离线也能构建。它会校验以下内容：

- 章节 id 全站唯一
- `order` 连续
- 二选一分组里只有一门 `role: "core"`
- P 范围不越界
- 前置课程和路线里引用的课程存在
- 每门课都有一个 `primary` 链接

章节 id 是语义化的（如 `tt-gpio`），和你的勾选记录绑定，**改名会让旧勾选对不上**。确实要改名时，在课程的 `legacyIds` 里写上旧 id 到新 id 的映射。

## 测试

```sh
node --test tests/model.test.mjs   # 进度模型：合并、升级、口径、周编号、.ics
node tests/smoke.mjs               # 本机 Chrome 无头冒烟
```

冒烟测试会在桌面 1440、手机 390 以及浅色、深色下走一遍关键路径，并截图到 `/tmp/manmanxue-smoke`。它不需要 npm 包，也不会访问 GitHub。

## GitHub Pages 部署

所有资源都用相对路径，可以直接从仓库根目录发布：

1. 打开 **Settings → Pages → Build and deployment**。
2. Source 选 **Deploy from a branch**，分支选 `main`，目录选 `/(root)`。

`.nojekyll` 用来让 Pages 按原样发布静态文件。

## 文件结构

```text
index.html                 页面结构与弹窗
css/style.css              样式：中性底色 + 单一强调色，明暗自适应
js/model.js                进度模型（纯函数）：v2 文档、按章节合并、加权口径、课表、热力图、.ics
js/sync.js                 GitHub Gist 同步：拉取 → 合并 → 推送，同步历史
js/app.js                  渲染与交互
js/sync-config.js          Gist 配置（gistId 不要改）
js/courses-data.js         由 scripts/build_data.py 生成，请勿手改
data/courses.source.json   课程数据唯一来源
data/bilibili-pages.json   B 站分 P 缓存
scripts/build_data.py      校验与生成脚本
tests/                     单元测试与冒烟测试
SOURCE_COURSES.md          补强课单原文
EVALUATION.md              评估报告与路线图
IMPLEMENTATION.md          P0 / P1 落地说明
```

课程链接会尽量保留原来源，但不保证第三方站点永久可访问。课程上下架不会影响本站的课单和进度功能。
