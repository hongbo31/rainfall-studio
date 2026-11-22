# 艺人资料的版权证明选项

2026-11-20

账号管理的新增和编辑艺人表单增加「版权证明」，可选择「是」或「否」。新建和缺少该字段的旧资料显示「请选择」。保存后回显所选值，复制艺人和复制上一位艺人时会带入该字段。

## 文件与影响

- `src/renderer/components/LocalArtistCreator.tsx` 提供下拉框和回显，浏览器工作台与 Windows 客户端共用表单。
- `src/shared/schemas.ts` 和 `src/core/account-local-artists.ts` 校验并保存可选的 `hasCopyrightProof` 布尔字段。旧调用省略此字段时保留已保存的值。数据库无需迁移。
- `tests/account-artists-ui.test.mjs` 覆盖空值、新增保存「否」、编辑保存「是」、回显及两种复制操作。

## 验证与回退

- 12 项定向测试通过，包括无头 Chromium 的艺人表单验证。TypeScript 检查通过。`scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 完成浏览器预览及 Windows Main、预加载、Core 和共用渲染层构建。
- Windows 原生窗口待验收。测试使用隔离库。
- 回退时撤回本轮表单、字段和回归改动，再用原入口重建。桌面切换沿用现行验收流程。
