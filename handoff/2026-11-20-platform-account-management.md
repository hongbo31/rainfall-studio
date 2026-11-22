# 平台账号列表与登录状态

2026-11-20

账号管理左侧列表统一使用「平台账号」。添加账号按钮和备注表单移到列表内，每行提供删除按钮和登录状态圆点。绿色表示登录已核实，红色表示需要重新登录，灰色表示当前状态待核对。鼠标悬停和辅助技术可读取状态文本。打开或同步账号后会更新对应行，列表会定时刷新各账号状态。

在账号行确认删除后，账号从可选账号中移除，关联艺人转为未关联，使用该账号的默认发布和下载归档设置一并清除。保存历史作品、投稿回执和原账号记录。旧的番茄任务在使用该账号前会复核账号是否仍可用。使用已删除账号的计划需重新选择账号和核对计划配置。

## 涉及文件

- `src/renderer/pages/PlatformAccounts.tsx`、`src/renderer/account-style.css` 和 `src/renderer/account-session.ts` 提供列表布局、账号作用域内的状态和删除确认。浏览器和 Windows 客户端共用该页面。
- `src/core/platform-accounts.ts`、`src/core/account-local-artists.ts`、`src/core/database.ts`、`src/core/studio.ts` 和 `src/shared/schemas.ts` 提供经确认的本地删除和事务更新，同时维护已有数据引用。旧版番茄迁移识别已删除的本地记录。
- `src/main/bootstrap.ts`、`src/main/browser-accounts.ts`、`src/main/fanqie/catalog-session.ts`、`src/main/fanqie/plan-publisher.ts` 和 `src/shared/platform-accounts.ts` 连接运行时状态和账号检查。番茄仅在有已打开会话时读取官网 UID 或识别登录响应，核对使用后台标签页。谱乐和汽水沿用已有会话探针。只有取得明确状态时才标示绿色或红色。番茄已有身份绑定和投稿去重依据继续留档。
- 回归更新在 `tests/account-artists-ui.test.mjs`、`tests/fanqie.test.cjs` 和 `tests/plan-fanqie.test.cjs`。

## 验证与回退

- 42 项账号管理、平台管理、下载归档、计划及浏览器工作台测试通过。番茄 91 项离线测试、13 项无头浏览器测试和 16 项计划番茄测试通过。需要写相对输出的测试在源码同级构建目录中的隔离检出执行。
- TypeScript 检查和 `scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 通过。完成浏览器渲染层及 Windows Main、预加载、Core 和共用页面构建。真实官网登录和 Windows 原生窗口待验收。测试使用隔离账号和库，未修改正式库或提交作品。
- 数据表结构沿用现行版本。若需回退界面，撤回本轮源码和回归修改后重建。旧版会把带删除标记的账号重新视为可选，已实际删除账号的库应先用删除前备份做隔离回退验证，再按桌面交付策略切换。
