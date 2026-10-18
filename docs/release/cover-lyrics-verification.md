# 封面交接与歌词发布增量验证

日期：2026-10-16；主机 SOURCE_WINDOWS_HOST。独立源码目录 `C:\Users\CLOUD_USER\Documents\Codex\2026-10-15\task\rainfall-studio-tme-mvp`，分支 `feature/cover-lyrics-handoff`，基线 `9d7fa76`。本轮只提交本地源码，不推送、不制作或替换 EXE、不更新用户日用库。

## 交付与运行

Electron Main/preload、React 界面、Core/SQLite 与受管素材分层。已装环境 Node24.14.0 / Electron44.7.2 / PowerShell7.6.5；没有新增软件、插件、凭据或账号绑定。

```powershell
Set-Location 'C:\Users\CLOUD_USER\Documents\Codex\2026-10-15\task\rainfall-studio-tme-mvp'
$env:RAINFALL_DATA_ROOT = Join-Path $PWD 'output\manual-cover-lyrics'
$env:RAINFALL_MODE = 'production'
npm.cmd run desktop:dev
```

此命令运行源码桌面应用；保持相同数据根可重启持久化。它不会更新已安装的0.5.1。不要把测试目录设为日用库，也不要同时打开同一个库。

封面工作室：选择作品 → 保存封面方向/提示词 → 创建请求 → 导出请求JSON → 在支持出图的会话人工生成 → 选中对应请求，导入图片或相邻图片清单 → 选为歌曲封面。创建请求只进入等待状态。直接图片导入标为用户导入，外部清单仅是来源声明，不冒充生成证明。图像 API 未配置，应用不会调用当前 dot 聊天。

作品详情：保留歌词原稿与不可变来源版本 → 导入UTF-8 TXT或编辑 → 发布预览只清理已知独占行标签 → 人工试听后显式确认所选音频。修改歌词或每次主音频重选/导入都会撤销确认。材料ZIP包含原稿、纯文本与统一载荷；腾讯手改歌词另存manual/publication_edit版本，保留原版本，不冒充服务商返回内容。

## 实际素材与隔离桌面结果

用户提供唯一音频 `C:\Users\CLOUD_USER\Music\从今天起.wav`：44,542,482字节，231.920秒，48kHz/16bit/双声道PCM。父会话生成并获用户认可的1254×1254 PNG已落地 `output/user-materials/from-today-cover-original.png`，2,630,891字节。原音频与原图SHA256在隔离验收前后完全相同。无字原图未改写，截图中的“我的艺人”为隔离本地预览默认排版，未确认为正式艺名，也未输出或上传此排版。

用户歌词原文保留，已清理21行明确结构/人声提示；对话、重复副歌和换行保留。没有音频逐行听校，没有虚构同步时间戳，匹配确认保持false。

最终 Electron 证据目录：

`output/playwright/cover-lyrics-454e2ccd-5339-43e6-8965-05f85b368156`

- `report.json`：7项主流程检查通过；独立data根；真实提供方调用0、平台上传0、审核提交0；renderer错误及观察到的Electron HTTP/HTTPS请求均为空。
- `cover-handoff.png`、`lyrics-preview.png`：已实际查看。深色暖紫界面，真实封面、请求/版本、双栏歌词与未勾选匹配确认清晰可辨；截图为页面滚动后的功能区域。
- `cover-request.json`、`publication-payload.json`：请求范围与选中素材/歌词来源载荷。

按钮→preload→Main文件选择→Core真实素材导入、显式选封面、重复导入幂等、重生成请求保留旧选择、歌词TXT、恢复后旧文件对话框拒绝、重启持久化均已验证。原生文件选择器仅在该隔离QA中替换为明确素材路径；这验证客户端文件导入链路，不代表腾讯上传链路。

## 测试与审查

| 检查 | 修复后实际结果 | 本地证据 |
|---|---|---|
| `npm run typecheck` | 通过 | `output-cover-lyrics-typecheck-final.log` |
| `npm run desktop:build` | Main/preload/Core/renderer构建通过 | `output-cover-lyrics-build-final.log` |
| `node scripts/test-cover-lyrics.mjs` | 15/15通过（13 Core、2 SSR） | 终端及对应测试源码 |
| `node scripts/test-headless.mjs` | 145/145通过 | `output-cover-lyrics-core-final.log` |
| `node scripts/test-tme.mjs` | 32/32通过 | `output-cover-lyrics-tme-final.log` |
| `node scripts/test-inbox-unit.mjs --regression` | 42/42通过 | `output-cover-lyrics-inbox-final.log` |
| `npm test` | 3/3通过 | `output-cover-lyrics-base-final.log` |
| `node scripts/cover-lyrics-desktop-qa.mjs`，指定实际素材 | 7项检查通过，退出0 | 上述report及截图 |

一次独立Astra代码审查：无Critical，4项Important和1项Minor。统一修复，未重复启动审查。

1. 主音频重选A、A→B→A及相同文件重新导入均清除旧确认。
2. 相同封面清单重复导入仍重新解码、核对相邻源图片哈希/尺寸，再返回旧回执。
3. 备份恢复使先前文件对话框失效，独立importEpoch与Core进程代际分开；UI收到工作区变化提示。
4. 腾讯手工改词使用独立不可变手改版本，保留原来源，最终警告与确认一致。
5. 歌曲切换后丢弃旧封面异步响应，界面按当前歌曲过滤请求/回执。

前三个Core反例及腾讯来源反例在修复前实际失败；恢复对话框用例在真实隔离Electron中先复现错误写入，再在修复后确认被拒绝且原稿不变。Minor通过作用域检查修复；未另做慢响应浏览器自动化竞态注入。审查没有评价腾讯实站、YourMusic未知字段或原始素材权利事实。

## 现场腾讯与软件接入分开验收

| 项目 | 现场正常UIA脚本 | Rainfall Studio客户端 |
|---|---|---|
| 已登录页面读取 | 读取腾讯Document、当前可见身份、发布/未发布列表；当时均为空 | Playwright Page适配层及本地检查点已有；当前日常浏览器桥仍未接通 |
| 《从今天起》音频 | 打开正常文件选择器；文件名/打开控件无Value/Invoke Pattern，暂停并取消；回读仍为“未选择任何文件”，下一步禁用 | 没有UIA transport；生产表单verified:false，真实上传仍禁用 |
| 草稿/审核 | 音频ID、草稿ID均未知；上传0、保存0、审核0 | 仅本地草稿与fixture验收，不能算实站成功 |

现场检查点 `output/tme-observation/from-today-upload-checkpoint.json` 和 `live-from-today-paused-20261016.json/.png` 只保留在本地。没有新选授权模式、签约、付款或审核，没有操作原被驳回作品。账号可见昵称不等于正式艺名；作者、AI工具/日期、权利与证明均未推断。后续封面规格未知，1254原图是否符合腾讯要求未验收。

最小后续软件工作：实现TmeBrowserPort的受支持现有窗口传输、Main桥接、所属窗口/域名/身份复核、真实表单契约与持久结果回读，再从客户端按钮验收。现场脚本成功也不能替代这一步。其他平台上传/统计、Codex图像API和音乐实际歌词未知字段仍未真实接入；不宣称全平台自动发布。

后续素材无需重发已有音频、图片或歌词。需要用户确定正式艺名、真实作者与AI/权利事实，并核实发行后台当前图片及草稿规则；同步歌词还需真实时间标注来源。
