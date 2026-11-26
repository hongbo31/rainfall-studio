# 番茄歌词校验错误定位

日期：2026-11-25（北京时间）

## 原因与改动

番茄批量上传表单点击“下一步”后，官网将歌词内容不规范作为页面级提示返回（例如 `《风往北吹》歌词内容不符合规范`）。旧逻辑只等待确认弹窗或表单内联错误，因此页面提示会落成通用上传错误，日志不一定能指出哪首歌曲。

`src/main/fanqie/directory-form.ts` 现在把页面级错误纳入等待目标，从提示中提取歌名并与当前批次歌曲标题精确匹配。唯一匹配时记录 `first-step:validation:lyrics-content` 错误事件、歌曲序号、歌名和 `FANQIE_LYRICS_CONTENT_REJECTED`，然后暂停当前批次。无法唯一匹配时记录 `FANQIE_LYRICS_CONTENT_REJECTED_UNMAPPED` 并暂停。`src/main/fanqie/catalog-session.ts` 与 `src/shared/fanqie-downloads.ts` 增加对应的简短用户提示。

自动化不会删除歌词附件、生成占位内容或替换原文件。用户应修订真实歌词，替换该歌曲附件后再重新核对。

## 影响范围

- 后续批量番茄上传可以在执行日志中按歌名和歌曲序号定位歌词拒绝。
- 只在官网提示同时可见且未进入确认弹窗时分类；其他页面错误保留原通用处理。
- 不影响既有批次和生产作品，不会自动重放或提交作品。

## 验证与未验证

- 已静态检查修改位置和相关 trace/错误映射。
- 未运行测试、构建、官网上传或 Windows 原生验收。
- 官网 toast 的实际 DOM 保持时长及未来执行日志显示效果仍需后续验证。

## 回退

还原本次 `directory-form.ts`、`catalog-session.ts` 和 `fanqie-downloads.ts` 的歌词拒绝分类/提示，再移除本交接文档及 `PROJECT-HANDOFF.md` 中对应条目。
