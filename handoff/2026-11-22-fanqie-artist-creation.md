# 番茄音乐艺人创建

2026-11-22

## 操作与流程

1. 在账号管理选择番茄音乐账号，在艺人行的「复制」旁点击「艺人创建」。确认框显示 A、B 版歌手名及头像类型。用户从平台管理同一份清单中选择图像模型，核对费用和官网提交限制后确认创建。
2. 使用所选账号的专属浏览器打开番茄邀请登录页，等待已登录会话返回创作平台。悬停左下角的账号区，点击「艺人信息」。同一页面上的菜单操作超时时，进入官网艺人列表地址。等「请输入艺人名」搜索框出现，再核对官网账号绑定。登录失效时保留登录页供本人登录。
3. 在官网默认的「合作艺人」列表按歌手名搜索。读取本次筛选的成功结果并逐页核对同名。找到同名艺人就记为「已存在」。B 版留空时只检查 A 版，两版同名时共用一个艺人。
4. 缺少该艺人时，从页头打开「新增艺人」。用本次选择的模型和该提供商已保存的密钥生成男性或女性头肩肖像。A、B 版共用艺人档案的声线。按艺人资料的封面分辨率输出方形 JPEG，留空时用 1440 × 1440。番茄头像至少为 1024 × 1024，大小上限为 5 MB。
5. 开始上传头像，填写本版歌手名，依次点击「词曲作者」「制作人」「歌手」。等待上传完成和远程图片加载。提交前再次核对登录账号、艺人资料、完整姓名、三个角色及头像，然后点击「确认添加」，以该次提交回执和新查询结果确认。
6. A、B 版都核对完毕后等待 10 秒，关闭本次自动化使用的页面。界面显示各版的创建结果。

搜索、登录、头像上传或表单核对失败时保留当前页面。提交结果不明时，在账号专属的 `artist-creation` 目录记录一份待核对标记，内容为时间戳，文件名按绑定账号和艺人名取哈希。下次尝试先在官网查重。核对到艺人后清除标记。平台明确拒绝的提交可按表单提示修正后重试。

## 涉及文件

- `src/renderer/components/LocalArtistCreator.tsx` 提供按钮、确认和状态。 `src/shared/fanqie-artist.ts` 与 `src/shared/schemas.ts` 定义输入和结果。
- `src/core/fanqie-artist.ts` 与 `src/core/index.ts` 读取已保存的歌手、声线和分辨率，并核对所选账号、图像模型与资料版本。
- `src/main/bootstrap.ts`、`src/main/fanqie/catalog-session.ts` 与 `upload-broker.ts` 复用专属浏览器、账号绑定和会话互斥。 `src/main/fanqie/artist-creation.ts` 负责查重、头像、表单、回执和窗口生命周期。

## 验证与回退

- 在同级构建目录 `rainfall-studio-build/fanqie-artist-creation-20261122` 通过 160 项隔离测试。 `tests/account-artists-ui.test.mjs` 验证按钮、两版歌手预览和提交范围。 `tests/fanqie-artist-creation.test.mjs` 使用无头番茄夹具验证同名匹配、分页、A/B 建档、头像像素及性别、角色、异常回执和关页。
- 初版验证时，旧短信入口及构建脚本仍引用缺失的短信组件、桥接方法和 APK 构建模块。初版隔离副本临时移除这些引用后，TypeScript、Windows Main、预加载、Core 和共用渲染构建通过。浏览器桥接和账号界面通过无头验证。原生 Windows 窗口、真实番茄账号建档及图片 API 扣费待验收。
- 回退时保留账号浏览器数据、待核对标记和已有官网回执，撤回本轮源码及测试后重建。已添加的官网艺人按番茄平台的资料规则处理。

## 首页导航修复

官网账号区使用悬停菜单。初版测试将其模拟为点击菜单。加入遮挡账号区的首页引导层后，旧流程在点击账号区时超时，停留在首页。[番茄创作平台](https://www.novelfm.com/creator/music/home) · [Arco Popover 源码](https://raw.githubusercontent.com/arco-design/arco-design/main/components/Popover/index.tsx)

- `src/main/fanqie/artist-creation.ts` 等待登录跳转、悬停账号区并点击菜单。菜单超时时，仅在自动化页面仍位于原官网地址时按官网列表地址继续。列表打开后等待搜索框并核对账号，再进入 A、B 版查重。
- `src/main/fanqie/directory-page.ts` 与 `src/main/fanqie/catalog-session.ts` 共用官网艺人列表地址。列表无法加载时给出单独错误，跳回登录时提示在当前专属窗口登录。
- `tests/fanqie-artist-creation.test.mjs` 验证官网菜单的悬停交互、首页遮挡、延迟登录跳转、A、B 版查重、缺失艺人建档及关页。登录失效的用例核对流程停在登录页且没有发起搜索、生成头像或提交表单。

隔离验证目录位于同级的 `rainfall-studio-build/fanqie-artist-navigation-20261122`。本轮通过 160 项测试，包含艺人创建与界面 6 项、番茄自动化与发布 123 项、目录和下载 31 项。当前源码通过 TypeScript 检查及 Windows Main、预加载、Core 和共用界面构建。浏览器端检查共用账号界面和桥接，Windows 端检查实际编译产物及无头 Playwright 自动化。两端共用修复，兼容原有账号、艺人资料和待核对标记。

当前 Windows 用户的 `verified-desktop.json` 缺失，正式数据根与原生桌面验收待核对。官网登录态、本人的实际艺人建档及付费头像生成待验收。若需回退本轮导航修复，撤回本节涉及的三个源码文件和测试变更后重建，保留已有官网回执与待核对标记。

## 风景头像与表单确认

番茄的角色控件使用可见标签及宽高为零的原生复选框。旧流程直接点击复选框，在无头复现中于「词曲作者」超时。上传组件先回显本地图片，上传成功后才换为服务器图片。 [番茄艺人信息](https://www.novelfm.com/creator/music/account/artist) · [Arco 复选框样式](https://raw.githubusercontent.com/arco-design/arco-design/main/components/Checkbox/style/index.less)

- `src/main/fanqie/artist-creation.ts` 用远山、湖面与薄雾的方形风景摄影提示词生成头像。上传开始后填写姓名并点击三个角色的可见标签，读取实际勾选状态。远程图片成功加载及上传遮罩消失后，核对名称、三个角色、头像和提交按钮。字段变更或上传失败时保留当前窗口。
- `src/core/fanqie-artist.ts` 与 `src/shared/fanqie-artist.ts` 移除头像生成对性别的依赖，兼容既有艺人资料。`src/main/fanqie/catalog-session.ts` 更新表单核对错误。`src/renderer/components/LocalArtistCreator.tsx` 在确认框注明风景头像计费。
- `tests/fanqie-artist-creation.test.mjs` 模拟番茄的隐藏复选框、头像上传遮罩、相对地址和延迟图片响应，记录「确认添加」点击时的完整表单。额外覆盖上传失败、账号核对时角色取消以及保留页面。`tests/account-artists-ui.test.mjs` 检查名称预览、风景头像提示和确认请求。

本轮在同级目录 `rainfall-studio-build/fanqie-artist-form-20261122` 使用临时数据验证。160 项测试通过，其中艺人创建与界面 6 项、番茄自动化及发布 123 项、目录与下载 31 项。浏览器端检查共用界面和调用桥接，Windows 端完成 TypeScript 检查及 Main、预加载、Core 和共用界面构建，并用无头 Playwright 运行实际建档代码。

真实账号建档、付费图片 API 出图质量和 Windows 原生窗口待验收。当前用户缺少桌面验收指针，桌面入口切换需核对正式数据根。回退时撤回本节涉及的源码、界面和测试变更后重建，保留原有账号数据、官网回执和待核对标记。

## 手动选模型与声线头像

- `src/renderer/components/LocalArtistCreator.tsx` 在确认框按提供商列出平台管理中的图像模型。用户选择后，`src/renderer/image-credential.ts` 读取该渠道当前凭据状态。确认请求携带配置 ID、版本、渠道与模型 ID。
- `src/shared/fanqie-artist.ts` 与 `src/core/fanqie-artist.ts` 校验选择并读取保存的艺人声线。优先使用艺人档案的「性别」。旧档案未设置性别时读取保存的男声或女声。声线无法确定时提示补齐资料。`src/core/platform-image.ts` 共用图像配置归属、版本和模型校验。
- `src/main/fanqie/artist-creation.ts` 按男声或女声生成单人头肩肖像，并保留现有查重、头像尺寸、上传及回执流程。`src/main/fanqie/catalog-session.ts` 返回所选渠道的出图及凭据错误。单次选择保存在该次请求，工作流默认配置继续供原有任务使用。
- `tests/account-artists-ui.test.mjs` 和 `tests/fanqie-artist-creation.test.mjs` 覆盖手动选择、缺少密钥、指定模型与默认模型不同时的请求、旧记录兼容、男女头像提示词以及 A、B 版查重和回执。回退可撤回本节源码和测试改动后重建，已有番茄艺人、账号数据及待核对标记继续保留。

在同级构建目录 `rainfall-studio-build/fanqie-artist-avatar-c6b9b1f6` 完成 TypeScript 检查和 271 项隔离测试。其中账号管理、艺人创建、平台模型和音乐渠道 93 项，番茄自动化及发布 123 项，番茄目录与浏览器桥接 55 项。无头浏览器运行共用账号界面和番茄自动化夹具，`Start-Rainfall-Browser.ps1 -BuildOnly` 验证 Windows Main、预加载、Core 和共用界面的编译。真实账号建档、图片 API 实际出图和 Windows 原生窗口待验收。
