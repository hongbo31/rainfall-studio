# 番茄上传停留首页：预检账号复核

## 原因与证据

用户截图显示番茄浏览器仍在 `/creator/music/home`。对应提供的第 63 次执行 trace 中，目录材料检查和 `catalog:batch-lookup` 已完成；随后在 `catalog:account` 等待精确 UID 文本 15 秒超时（sequence 142），目录轮次随即以 `FANQIE_BROWSER_LOCATOR_TIMEOUT` 结束（sequence 143）。没有 `directory:form` 事件，说明自动化未打开歌曲表单。

批次预检在隐藏的同源页面中读取账号与目录信息，主标签页留在首页是刻意保留当前页面；原逻辑在只读查重后又立即导航回账号资料页读取一次 UID。这个冗余末尾复核失败会让整轮在任何歌曲表单操作之前停止。

## 改动与影响

- `src/main/fanqie/catalog-session.ts`：批次查重和署名预检保留开始前的账号身份校验；跳过只读查询结束后的重复 UID 读取。上传表单在执行任何发布写入前仍会独立核对当前登录 UID 与批次账号；读取提交回执时仍做读后账号复核。目录查询/署名查询的账号复核次数写入 trace 的 `accountIdentityChecks`。
- `src/main/fanqie/directory-trace.ts`：允许安全地记录上述数字诊断字段，不包含 UID、页面文本或路径。
- 不会自动重放已经停止的运行；也不改变歌曲、歌词、素材、作品回执或合同状态。

## 验证状态

- 静态检查：已审阅账号检查调用顺序和提交前的表单账号核对；`git diff --check` 通过。
- 未运行测试、构建或真实官网流程。桌面指针 `verified-desktop.json` 缺失，未确认这张截图与所贴 trace 是否来自同一批运行，也未做 Windows 原生验收。新版需先按桌面交付流程验收后才会进入在用客户端。

## 回退

恢复 `catalog-session.ts` 中预检读后 UID 复核逻辑及原有调用参数，移除 `directory-trace.ts` 的 `accountIdentityChecks` 诊断字段，并删除本交接记录及其在 `handoff/PROJECT-HANDOFF.md` 的索引。
