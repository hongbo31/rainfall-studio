# 番茄目录上传单标签页

线上日志在「发布作品」跳转成功后记录了 `FANQIE_PAGE_SCOPE_CHANGED`。旧版在「成品发行」步骤仍校验创作首页地址。旧版还分别开标签页处理上传表单和账号核对。该批 2 首在页面跳转时暂停，另有 3 首因未匹配到官网艺人而未提交。

## 行为

- 执行时复用番茄工作标签页。登录、UID、艺人和本批作品的只读核对在同页的临时同源内嵌页中完成，核对结束即移除。
- 在创作首页点击「发布作品」后，等待 `/creator/music/publishWorks`。在该页定位 `//span[text()="成品发行"]/../..//span[text()="发布作品"]`。点击后核对上传表单地址，再开始添加歌曲。
- 本批投稿或签约回执核对完成后，已验证的上传标签页可返回首页供下一批使用。用户手动打开的表单保留。合同流程在由本人确认后可能打开官网验证页。

## 涉及文件

- `src/main/fanqie/directory-page.ts` 和 `directory-form.ts` 处理工作标签页、同页核对及两次导航。
- `src/main/fanqie/catalog-session.ts`、`catalog-lookup.ts`、`directory-run.ts`、`authorize-records.ts` 和 `src/shared/fanqie-downloads.ts` 接入账号核对、回执、批次续跑和提示。
- `tests/fanqie-directory-form.test.mjs`、`tests/fanqie-directory-catalog.test.mjs`、`tests/fanqie-native-adapter.test.mjs`、`tests/fanqie-downloads.test.mjs`、`tests/fanqie.test.cjs` 和 `tests/fixtures/fanqie-directory-site.mjs` 覆盖三个同名入口、正确路线、单标签页和异常回执。

## 验证与回退

140 项相关回归、TypeScript 检查、原浏览器入口构建和 Windows Electron 本地桥接通过。用无头浏览器验证了两首歌曲从首页到确认上传全程只有一个标签页，确认时只触发一次提交。匿名官网请求确认同源资料页可在当前标签页加载。Windows 原生窗口及真实账号投稿待验收。

回退可恢复本次改动的源码和测试。保留已有账号、作品库和投稿队列。
