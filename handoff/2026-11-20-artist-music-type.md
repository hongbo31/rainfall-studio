# 艺人资料的音乐类型

2026-11-20

账号管理的「新增艺人信息」和「编辑艺人信息」在创作类型旁新增「音乐类型」下拉框，提供「原创」和「翻唱」。新建表单及旧资料缺少该字段时默认显示「原创」。保存和重新打开会显示所选类型，复制艺人和复制上一位艺人也会带入该字段。

## 涉及文件

- `src/renderer/components/LocalArtistCreator.tsx` 和 `src/renderer/account-style.css` 实现表单、布局和回显。浏览器工作台与 Windows 客户端共用表单。
- `src/shared/local-artist.ts`、`src/shared/schemas.ts` 和 `src/core/account-local-artists.ts` 校验并保存艺人资料的可选 `musicType` 字段。旧记录可直接读取，旧调用省略该字段时会保留已有选择。数据库无需迁移。
- `tests/account-artists-ui.test.mjs` 覆盖旧记录默认值、新建选择、编辑回显和两种复制操作。

## 验证与回退

- 12 项定向测试通过，含无头 Chromium 的新增、编辑和保存回读。TypeScript 检查通过。`scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 完成浏览器预览及 Windows Main、预加载、Core 和共用渲染层构建。
- Windows 原生窗口待验收。测试使用隔离库。
- 回退时撤回本次表单、字段校验和回归改动，再用现有预览入口重建。桌面切换沿用现行验收流程。
