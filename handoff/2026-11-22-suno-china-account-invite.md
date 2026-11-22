# 苏诺之音账号与登录地址

2026-11-22

账号管理新增独立平台「苏诺之音」。新增账号可从账号管理打开专属登录窗口，也可在平台管理的「歌曲生成」区域打开页面。两个入口共用用户指定的地址，保留 `#/?from=invite&invite_id=11619989`。苏诺之音和 Suno 分别使用各自的平台账号及浏览器会话。[苏诺之音入口](https://11619989.share.suno.cn/home/#/?from=invite&invite_id=11619989)

## 涉及文件

- `src/shared/platform-accounts.ts` 注册 `suno_cn`，供账号保存校验和账号列表使用。`src/renderer/context.tsx` 提供中文名称。
- `src/shared/platform-directory.ts` 保存登录地址，浏览器工作台和 Windows 客户端的打开页面及专属登录入口共用该配置。
- `src/renderer/pages/PlatformManagement.tsx` 提供「苏诺之音」网页创作卡片、账号选择和管理账号入口。
- `src/renderer/components/PuleBrowserGeneration.tsx` 按发布平台的账号能力优先挑选默认艺人。
- `tests/platform-management-ui.test.mjs` 覆盖添加账号和两个页面入口。`tests/publish-workbench.test.mjs` 核对首次打开时传入的完整地址，并验证独立账号会话。

## 验证与回退

- TypeScript 检查、`scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 构建和 3 项回归通过。使用无头 Chromium 检查浏览器界面，并使用模拟导航核对 Windows 专属登录会话的目标地址及两平台的浏览器配置目录。
- 邀请地址与卡片集成后，在同级构建目录 `verification/suno-cn-platform-a5fa430a-current` 复测 44 项账号、平台管理、计划及浏览器会话用例，全部通过。已核对构建快照与测试源码及 Windows 共用的 Main、Core、预加载和渲染层产物。
- 网站实际跳转、账号登录与 Windows 原生窗口待验收。桌面入口未更新。
- 如需回退地址，将 `platformPageUrls.suno_cn` 恢复为原站点首页并同步调整导航断言。已有账号和会话目录可以继续保留。
