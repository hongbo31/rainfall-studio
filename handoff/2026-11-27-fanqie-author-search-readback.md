# 番茄艺人搜索输入读回修复

2026-11-27，第 82 次目录上传在艺人搜索阶段报 `FANQIE_AUTHOR_SEARCH_UNVERIFIED`。

## 原因

- `directory-form.ts` 填入词作者、曲作者或歌手名称后，立即要求搜索框读回值逐字符相同。番茄的受控搜索框在 React 重绘或状态更新期间可能短暂返回空值/旧值，代码因此在候选列表检查前停止。
- 该错误只说明搜索词没有通过输入框读回校验，不代表艺人不存在。第 82 次摘要没有记录具体署名阶段；步骤级 trace 应显示 `credit:<role>:search`。
- 对未传入 `singerArtistId` 的署名字段，当前实现会返回通用搜索错误；带 ID 的歌手分支过去会把同一输入读回问题误分类成 singer ID 错误。

## 修改

- 输入框读回不匹配时先等待。约 1.2 秒后仍不匹配则记录 `credit:<role>:retry-input` 并重填，最多重填 3 次。
- 只有搜索词准确读回后才检查并点击候选项；输入始终不匹配则继续安全停止，不会盲选。
- 统一将输入读回失败映射为 `FANQIE_AUTHOR_SEARCH_UNVERIFIED`，并补充面向用户的提示；已存在的歌手 ID 校验仍在点击候选项后单独执行。

## 验证范围

静态检查输入/候选项顺序、有限重试与执行步骤标记，并运行 `git diff --check`。未运行测试或构建，未访问番茄账号、重跑投稿或更新桌面客户端。当前桌面指针缺失，因此没有读取生产数据根中的第 82 次 trace。

## 回退

回退 `src/main/fanqie/directory-form.ts` 的输入等待与重填、`src/shared/fanqie-downloads.ts` 的提示，并移除此交接条目及 `PROJECT-HANDOFF.md` 的对应索引行。
