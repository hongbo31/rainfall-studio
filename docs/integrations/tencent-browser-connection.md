# 腾讯音乐人现有浏览器连接：现场结论与待完成路径

2026-10-16，SOURCE_WINDOWS_HOST。以下原始观察保留为历史；最新现场与软件能力区分如下。未向腾讯发送音频、保存草稿或提交审核。

## 后续现场进展与当前阻塞

后续正常 UIA 已读取当前腾讯 Document、作品管理及原创上传首屏；发布与未发布列表当时均为空。用户授权唯一《从今天起》音频上传与保存草稿，因此打开了正常文件选择器。文件名/打开控件只暴露为无 Value/Invoke Pattern 的 Pane，按约束暂停，未使用盲坐标、未选中文件、未开始上传。远端音频 ID、草稿 ID 均未知；本地检查点和截图留在被 Git 忽略的 output/tme-observation。无需重发已有音频或封面。

**现场 UIA 脚本不属于 Rainfall Studio 发布按钮路径。** 当前客户端适配器仍以 Playwright Page 为接口、生产契约 verified:false；没有 UIA transport，也没有实站自动上传验收。现场即使以后上传成功也不能算软件接通。最小产品接入工作包括实现 TmeBrowserPort 的正常可访问性传输、Main 桥接与所属窗口/域名/身份/状态复核、持久检查点与结果回读，再验证真实按钮主流程。无需读取 cookie、开放调试端口或虚构公开 API。

页面首屏观察到 mp3/wav/m4a、文件小于200M、时长至少60秒及“音质 >320KBps”提示。后续封面/作者/AI/签约字段及草稿语义尚未核实。1254px 原图不能直接宣称满足未知平台封面规格，当前昵称也不能自动当正式艺名。

## 已取得的现场证据

用户登录后，Chrome 窗口标题为“腾讯音乐人 - Google Chrome”。Windows 原生窗口截图可见腾讯音乐人个人首页及入驻卡片“审核未通过”。这不是特定作品的驳回详情，也不足以证明上传权限。没有点击、滚动、切换标签、导航或修改表单。截图只保存在被 Git 忽略的本地 output 目录，未收入源码。

该 Chrome 没有已启用的远程调试端口。Windows UI Automation 能读到浏览器窗口及工具栏，但本次未暴露网页 Document/表单树。检查扩展 manifest 的名称和描述时未发现匹配 Playwright/OpenAI/ChatGPT/Codex 的扩展；未读取 Cookies、token、Preferences 或 storageState。这不足以排除采用本地化名称的其他扩展。

当前会话可调用工具中没有浏览器/IAB/电脑交互 MCP 路由；唯一屏幕上下文工具限活动语音会话使用，本次文本任务未调用。终端可执行正常 Windows 只读窗口截图，因此不能把缺少 MCP 路由描述成整台电脑无法访问。暂未取得能可靠选中现有标签并读取网页表单的受支持连接。

## 当前代码实际能力

Main 层有适配器接口，且能附着到**用户明确授权、事先已经启用**的本机 loopback CDP 端点。使用 `noDefaults: true` 避免 Playwright 修改日常浏览器的默认行为。程序不启动/重启用户浏览器，不启用调试端口，不读取浏览器凭据。检查按钮不提供端口时仅返回未连接，不尝试扫描端口。

这个诊断入口不能替普通用户建立首次连接。客户端目前没有安装 Chrome 扩展、配置 MCP bridge 或实现扩展传输，也不能自动选中当前腾讯标签。生产表单契约保持 `verified: false`，上传和保存操作因此被阻止。fixture 中的附件标记、草稿 ID 和状态属性仅是测试约定，尚未映射腾讯真实页面。

## 建议下一步：官方现有标签扩展路线（尚未安装或实现）

微软官方 Playwright 扩展支持连接正在运行的 Chrome 标签。需要用户批准新增软件/配置后，才能执行以下最少步骤：

1. 从官方说明指向的 [Chrome 商店 Playwright extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm) 安装扩展。
2. 为获准使用的客户端/宿主配置官方 Playwright MCP bridge，以 `--extension` 模式连接。Rainfall Studio 仍需补齐此传输适配与连接 UI；当前代码没有实现这一段。
3. 保持腾讯音乐人现有标签打开。在扩展的正常连接审批中，由用户选择该标签并允许本次连接。保留每次审批；不要求 token、不跳过审批。
4. 在用户确认没有未保存内容后，只读校准身份标识、完整上传表单、授权模式步骤、附件格式和回读状态。用户选择首个正式试传作品并逐项确认权利、作者、AI 信息、授权模式与资料后，才另行执行保存草稿验收。

这条路线不要求关闭现有浏览器、重登、改安全配置或启动调试浏览器。扩展安装和客户端 bridge 开发尚未完成，不能据此声称目前已经接通。

官方依据：[Playwright 扩展使用说明](https://github.com/microsoft/playwright/blob/main/packages/extension/README.md)、[Playwright MCP](https://github.com/microsoft/playwright-mcp)、[connectOverCDP / noDefaults](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)。

## 作品保护

用户原《那天刚好下雨》已有人工提交及题名相似驳回记录，正在人工改名。本次没有打开、覆盖、改名或重提此作品，没有猜测新标题。原始作品 ID、驳回原因须保留；草稿、已提交、驳回、已发布分别展示。遇到非草稿远端状态时仅记录状态，禁止写入。授权模式必须用户手动选择。
