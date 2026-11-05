# 慢慢学 · 个人课程学习站

单人自用的嵌入式与硬件课程清单。按四条学习线展示 9 门课程和全部 23 个外链，记录学习状态与进度，并支持 JSON 备份迁移。课单及学习建议来自 [SOURCE_COURSES.md](SOURCE_COURSES.md)，保留来源中的讲师归属提醒、备用入口与按需学习建议。

纯 HTML、CSS、JavaScript，无构建工具、npm 包、账户系统、服务器或密钥。页面无远程字体与第三方脚本，只有打开课程入口时才访问外部站点。

## 本地打开

直接双击根目录的 **index.html** 即可使用。也可以在项目目录启动静态服务：

```sh
cd /Users/claw/Projects/learning-courses
python3 -m http.server 8080
```

访问 <http://localhost:8080>，按 `Ctrl+C` 停止服务。推荐日常使用固定的 HTTP 地址；`file://` 存储行为因浏览器而异，移动文件路径、切换浏览器或端口可能进入新的存储空间，迁移前请导出备份。

## 记录与迁移进度

- 拖动课程滑条即可自动保存。0% 对应「待开始」，1–99% 对应「学习中」，100% 对应「已完成」。也可以直接改状态；选择「学习中」会将 0% 调为 1%、100% 调为 99%。
- 总进度为全部 9 门课程百分比的算术平均值，四舍五入；即使 STM32 建议二选一，统计仍按完整课单计算。
- 进度存储键：`learning-courses-progress-v1`。同源的多个标签页会同步更新；跨设备、浏览器或网址不会自动同步。无痕会话结束或清理站点数据可能移除记录。
- 点击「导出 JSON」下载全部进度。新设备打开本站，点击「导入 JSON」，选择备份，核对课程数量后确认。只更新匹配的课程，未包含的课程保持原状；可取消导入。
- 导入会校验版本、课程 ID、状态、整数百分比和状态一致性；未知 ID 忽略，错误文件整份拒绝，不会部分覆盖。最大文件大小为 1 MB。
- 浏览器禁用存储或空间不足时，会提示保存失败；当前页仍可编辑和导出，关闭前请备份。

备份格式示例（课程可只包含一部分）：

```json
{
  "version": 1,
  "updatedAt": "2026-11-05T12:00:00.000Z",
  "courses": {
    "c-wengkai": { "status": "in_progress", "progress": 35 }
  }
}
```

## GitHub Pages 部署

建议仓库名为 `Dora321/learning-courses`，直接从根目录发布；所有资源使用相对路径，支持仓库子路径。本站尚未执行建仓或部署。

1. 将本项目文件提交到 GitHub 仓库的 `main` 分支（免费账户可使用公开仓库）。
2. 打开仓库 **Settings → Pages → Build and deployment**。
3. Source 选择 **Deploy from a branch**，分支选择 **main**，目录选择 **/(root)**，点击 **Save**。
4. 等待 Pages 部署完成，访问 `https://dora321.github.io/learning-courses/`。

也可使用 `docs/`：将 `index.html`、`css/`、`js/`、`data/`、`SOURCE_COURSES.md` 与 `.nojekyll` 一起复制到 `docs/`，然后在 Pages 中选择 `main` 的 `/docs`。以后更新源文件也要同步这份副本，因此本项目优先推荐根目录。

发布方式参考 [GitHub 官方 Pages 配置文档](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。`.nojekyll` 用于按原样发布静态文件。

## 修改课程

以 `SOURCE_COURSES.md` 为来源。修改后，在根目录执行：

```sh
python3 scripts/sync_courses.py
```

该脚本使用 Python 标准库，生成 `data/courses.json` 及 `js/courses-data.js`。HTTP/Pages 优先读取 JSON；直接打开本地文件时读取内容一致的 JS 快照，避免浏览器阻止 `file://` 下的 JSON 请求。两份生成文件请一起提交。无需在打开或部署时运行脚本。

脚本按当前 9 门课的序号映射稳定 ID 和入口标签；新增课程或增删链接时，请同时调整脚本中的映射与页面统计说明。课程 ID 与本地记录关联，应保持稳定。状态初始为 `not_started`，进度为 `0`；更新课单不会主动清除已保存的个人进度。

## 文件结构

```text
index.html               页面结构与导入确认框
css/style.css            纸感布局与手机样式
js/app.js                渲染、状态联动、本地保存与备份迁移
js/courses-data.js       自动生成的本地直开数据快照与学习路线
data/courses.json        解析后的 9 门课程，包含全部入口
scripts/sync_courses.py  来源解析与数据同步工具（仅维护时使用）
SOURCE_COURSES.md        原始课单
DEPLOY.md               部署交接说明
.nojekyll               静态发布标记
```

课程链接按来源保留，不保证第三方站点永久可访问。B 站反爬、登录要求或课程上下架可能影响外链，本站的课单与进度功能不受影响。
