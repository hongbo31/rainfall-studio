# 艺人资料的歌曲属性与 AI 标记

2026-11-20

账号管理的新增、编辑艺人表单增加两个下拉字段。「歌曲属性」可选「原版歌曲」或「多版本歌曲」。「是否为 AI 作品」可选「是」或「否」。新建和缺少字段的旧资料显示「请选择」。已保存的选择在编辑时回显，复制艺人及复制上一位艺人时一并带入。

## 文件与影响

- `src/renderer/components/LocalArtistCreator.tsx` 在「创作类型」和「音乐类型」下一行显示两个字段，浏览器工作台与 Windows 客户端共用表单。
- `src/shared/local-artist.ts` 和 `src/shared/schemas.ts` 定义、校验可选的 `songAttribute` 和 `isAiWork`。
- `src/core/account-local-artists.ts` 保存并复制字段，保留「否」的布尔值 `false`。旧调用省略字段时保留已保存的选择。数据库无需迁移。
- `tests/account-artists-ui.test.mjs` 覆盖旧资料、两个字段的全部选项、新增和编辑保存、回显与两种复制操作。

## 验证与回退

- 12 项定向测试通过，覆盖无头 Chromium、艺人资料和浏览器桥接。TypeScript 检查通过。`scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 完成浏览器预览及 Windows Main、预加载、Core 和共用渲染层构建。
- Windows 原生窗口待验收。验证使用隔离库。
- 回退时撤回本轮表单、数据字段和回归改动，再用原入口重建。桌面切换沿用现行验收流程。
