# 移除艺人封面分辨率提示

`src/renderer/components/LocalArtistCreator.tsx` 已移除「封面分辨率」输入框下方的常驻说明。浏览器版和 Windows 客户端共用这份表单。

表单渲染验证确认提示已移除，现有用例覆盖分辨率默认值、留空、格式校验和保存。无头账号管理测试、TypeScript 检查及同级隔离目录 `artist-cover-hint-ac74a7fe/source` 内的 Windows 构建通过。原生窗口和正式交付尚未验收。

回退时恢复该输入框下方的说明行即可。
