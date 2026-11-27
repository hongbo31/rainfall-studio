# Suno Google 登录浏览器修复

## 原因

账号管理的“打开专属登录窗口”原先通过 Playwright 启动持久化浏览器。用户是在窗口里手动操作，但浏览器进程仍受自动化控制；Google 因而提示“此浏览器或应用可能不安全”。

## 修改

- src/main/browser-accounts.ts：Suno 账号沿用现有按钮，在 Windows 上启动已安装的 Chrome（未安装时使用 Edge），以该账号现有 browser-sessions/accounts/<accountId> 目录作为浏览器资料目录。手动网页登录不经 Playwright、不传自动化/远程调试参数；其他平台的登录窗口保持原行为。
- 启动普通浏览器前关闭 Rainfall 持有的该账号自动化上下文，并写入仅含账号 ID 和平台名的待接续标记。后续自动化成功取得同一资料目录后清除标记；如果浏览器仍锁定资料目录，则返回“先完全关闭 Chrome 或 Edge”的提示。
- src/renderer/account-session.ts：账号状态在标记存在时显示“普通浏览器登录待接续”。
- src/main/fanqie/catalog-session.ts：为缺少系统浏览器、启动失败、资料目录仍被占用和账号忙碌增加可读中文提示。

## 验证与未验证

- 已静态审阅 Suno 账号按钮到 Main 会话入口、账号隔离资料路径、系统浏览器启动参数、标记清理与错误提示映射。
- 未运行测试、类型检查、构建、真实 Google 登录或 Windows 原生验收；没有启动可见客户端或浏览器。当前桌面客户端未更新。
- 是否能在用户的 Google/Suno 账号环境中完成授权并由后续自动化复用登录态，仍需在新版桌面候选上验证。

## 回退

恢复 src/main/browser-accounts.ts、src/renderer/account-session.ts 和 src/main/fanqie/catalog-session.ts 本轮变更，并删除本交接文件及 handoff/PROJECT-HANDOFF.md 的对应记录；保留这些文件此前已有的其他改动。
