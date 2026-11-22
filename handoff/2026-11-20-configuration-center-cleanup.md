# 配置中心移除两个模块

2026-11-20

## 改动与影响

- 用户要求移除「发布平台」和「艺人与预算」。配置中心删除这两个标签、对应页面和旧导航状态，进入配置中心时默认打开「模型 API」。提示词管理、下载目录、诊断与历史和外观继续从各自标签打开。
- 发布记录的账号和署名入口跳转到账号管理。艺人资料继续在对应账号下编辑。番茄发布任务需要的上传授权在对应番茄账号下展开，包含备用署名、签约偏好和上传许可。合同由本人确认。旧版逐艺人署名覆盖随既有授权保存。
- 沿用原作品库格式、平台默认值、预算记录和发布队列。已有任务继续使用原配置快照。

## 涉及文件

- 页面和导航涉及 `src/renderer/main.tsx`、`context.tsx`、`pages/ConfigurationCenter.tsx`、`pages/PlatformAccounts.tsx`、`pages/PublishCenter.tsx` 和 `pages/BrowserPublishWorkbench.tsx`。删除 `pages/Accounts.tsx` 以及 `components/PlatformConfigurationPanel.tsx`、`components/FanqieConfigurationPanel.tsx`，移除相应样式。
- 新增 `components/FanqieUploadAuthorization.tsx`。同步调整发布中心材料与进度入口、计划和发布任务的番茄提示，以及配置页验收脚本和打包说明。
- 回归覆盖位于 `tests/configuration-ui.test.mjs`、`tests/account-artists-ui.test.mjs`、`tests/publication-scope-ui.test.mjs` 及对应夹具。

## 验证和回退

- 浏览器入口 `Start-Rainfall-Browser.bat -BuildOnly` 构建成功。用该构建启动本地浏览器服务，在隔离的模拟库和无头浏览器中验证五个配置标签、默认选中「模型 API」和进入账号管理。
- Windows 共用的 Main、预加载、Core 和渲染产物构建成功，类型检查和 41 项定向测试通过。无头测试验证按账号保存番茄授权、旧署名保留，以及发布进度跳转到对应平台的账号管理。
- 待验收范围包括 Windows 原生窗口、正式桌面包和实际平台上传。当前测试使用隔离库和模拟账号。
- 回退时撤回本轮界面、导航和测试改动即可。旧版界面可以继续读取现有数据和已保存的番茄授权。
