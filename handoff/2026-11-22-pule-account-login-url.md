# 谱乐 AI 专属登录地址

2026-11-22

## 改动与影响

按用户要求，把账号管理中谱乐 AI 的「打开专属登录窗口」接到指定的邀请地址。浏览器版和 Windows 客户端共用 `accountSession.open`。[新登录地址](https://app.yourmusic.fun/?inviteCode=FJVMEINAXD)

- `src/shared/pule-browser.ts` 定义专属登录地址。平台页面和自动化制作沿用 `/create`。
- `src/shared/platform-directory.ts` 和 `src/main/bootstrap.ts` 为谱乐的账号会话选择新登录地址。其他平台从各自的官方入口打开账号会话。
- `src/main/browser-accounts.ts` 在同一账号的专属窗口中打开登录页，保留原有官网标签。官网在登录后移除邀请参数或跳转到同源页面时，重复点击会复用登录标签。
- `tests/pule-browser.test.mjs` 使用本地拦截验证首次导航带完整邀请参数、已有官网标签可保留、重复点击复用登录标签、账号会话隔离及创作流程。

## 验证

在源码同级 `rainfall-studio-build/pule-account-login-11d1c809` 隔离验证。谱乐登录与创作回归 4 项通过，账号管理和浏览器桥接 2 项通过，基础 3 项通过。原浏览器启动脚本的 `-BuildOnly`、TypeScript 和 Main、preload、Core 语法检查通过。Windows Electron 运行时的专属登录回归通过。正式网站的真实登录和 Windows 原生窗口仍待验收，桌面入口未切换。

## 生效与回退

浏览器版从原 `Start-Rainfall-Browser.bat` 入口重新启动后加载新地址。回退时撤回本轮列出的源码和测试改动并重新构建。账号档案和登录数据无需迁移。
