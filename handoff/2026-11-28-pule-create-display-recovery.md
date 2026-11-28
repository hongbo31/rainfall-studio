# 谱乐 AI 创作页显示异常恢复

## 问题与定位

用户截图显示 `https://app.yourmusic.fun/create` 只剩一个放大的蓝色首页图标。只读检查同一站点及使用本机 Chrome 的隔离无头会话，创作表单可完整显示；JS 页面异常和资源请求失败均未出现，只有未登录接口按预期返回 401。由此可排除站点整体不可用和 Rainfall 当前页面启动参数导致的普遍故障，更可能是谱乐专属持久浏览器资料中的站点缩放或缓存状态。账户页与生成任务页都可能打开该路由，因此显示恢复被提取为共享 helper。

`%LOCALAPPDATA%\RainfallStudioLauncher\verified-desktop.json` 当前缺失，因此没有读取、清理或修改账号浏览器资料，也没有更新客户端。

## 修改与影响

- `src/main/pule-page-recovery.ts`：在打开谱乐 `/create` 时重置该页缩放到 100%，并等待页面出现创作区、自定义模式标签和交互控件。账户页和生成任务页共用。
- 等待最多 4 秒识别页面是否正常。健康页面不重载，保留未提交表单。
- 如果页面仍只有图标或空内容，临时绕过浏览器缓存和 Service Worker 并忽略缓存重载一次；保留 Cookie、Local Storage 和其他站点资料，完成后恢复网络设置。
- 若重载后页面仍未恢复，不循环重载，浏览器保留在现场供用户查看。

## 验证与限制

- 只读站点检查和隔离无头 Chrome 观察到创作表单正常、JS 无异常、静态资源无请求失败；该操作不是项目自动化测试。
- `git diff --check` 通过。全仓 TypeScript 检查报告 12 条其他文件诊断，未报告本次修改文件；自动化测试、构建和原生客户端验收未运行。桌面指针缺失，安装客户端未更新；请在后续客户端更新后检查真实账号窗口。

## 回退

删除 `src/main/pule-page-recovery.ts`、`src/main/browser-accounts.ts` 和 `src/main/pule-browser-page.ts` 中对此 helper 的 import/call，并移除本文件和 `PROJECT-HANDOFF.md` 对应条目。
