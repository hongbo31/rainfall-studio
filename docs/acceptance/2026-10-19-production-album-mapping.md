# 2026-10-19 生产专辑表单与选中状态只读核对

基线：`91aa54160c11d2ed9a121dd37c4a6f397ccdd1bd`，package `0.11.1-preview.1`。本轮明确只读授权覆盖旧 handoff 的浏览器停止条款，其余限制保留。

## 实际执行与证据

执行 `node scripts/inspect-album-production-readonly.mjs`。复用现有 `127.0.0.1:9222` 登录会话，仅通过 `Target.createTarget({background:true})` 创建临时后台页，导航 AI 入口，读取 DOM、Vue 状态及该页面已加载官方脚本响应；关闭自己的临时页。没有 activate、输入、选择、创建、上传、协议接受或提交。脚本没有直接构造远端业务 API 请求。

脱敏证据：[production-album-mapping-proof.json](./2026-10-19-production-album-mapping-proof.json)，采集时间 `2026-10-19T07:01:54.529Z`—`07:01:58.766Z`。保留原主页面 URL 与页集合；表单动作、上传、协议接受、提交计数均为 0。页面本身会发送 GET、POST 查询和埋点；不把“只读”误写成“所有请求都是 GET”。观察路径中没有 draftAlbumInfoV2、submitAlbumInfo、saveSongInfo 或上传请求。报告不含账号、标题、专辑 ID、Cookie、请求参数或页面原文。

| 观察面 | 实际证据 | 可得结论 |
| --- | --- | --- |
| AI 入口 `#/user/manage/aiChoose/add` | `.album-search` 共 2 个，真正可见 1 个；可见 `.selected .album strong` 为 0；`$data.selected === null` | 本次没有选中专辑；不能声称已线上验证阳性 albumId |
| `/ystatic/1420.d8a8271d.js` | SHA256 `ae59bdaaecf8a813f615e03b741a05485c1d1b08b6e99b37d0e1fce07254c0fc` | 官方 SelectAlbum 的 `handleSelect(e)` 写 `selected=e`、emit `onChange(e)`；父卡片把记录传播为 `albumInfo`，缺省 `mode='exit'`；可见标题来自 `selected.name`，真正 ID 来自 `selected.id` |
| 同一官方模块 | `onCreateAlbum` 组织 `mode='create'`、歌手与预填数据，emit 到父表单 | “创建新专辑”是创建表单模式，不能等同远端专辑创建成功 |
| `/ystatic/8213.e5594efc.js` | SHA256 `d3b3d3cc5547541e05aa1b7f44b037bedd5ed7f4b9cfc73d86debec395c4b9e1` | `handleAutoSaveSubmit` 的草稿写路径为 POST `/openapi/musician/transmit/v2/v2/album/draftAlbumInfoV2`；回调把 `data.albumId` 写 `albumId`、`form.id`，并置 `showStatus=5`、`mode='create'` |
| 同一官方模块 | `submitSignInfo` 在新建模式选择 `/v2/v2/album/submitAlbumInfo`，已有专辑使用 `/v2/v2/song/saveSongInfo` | 正式提交与草稿保存是不同写操作；此次均未执行 |

已加载专辑表单脚本还给出专辑名称、封面、歌手、类型、流派、语种、发布时间、介绍等字段提示；新建模式未打开，必填性、实际控件可见性、保存按钮和服务端回执尚未完成阳性校准。两个相关模块没有 `idempotencyKey` 字面量；这仅是本次已加载模块范围的观察，不宣称整个平台不存在任何关联字段。

## 最小修复

- 新增 `readOfficialSelectedAlbum`：要求入口路径、唯一可见选择器、官方组件 `$el`、`mode='origin'`，交叉核对可见标题、`$data.selected.id/name` 和 `$props.albumInfo.id/name`；必须是已选 `mode='exit'`。ID 为严格正整数字符串或安全整数。隐藏/重复/新建/预填/标题或 ID 冲突全部拒绝；真实空选择返回 null。不会调用 Vue 方法、改变状态或发送请求。
- 真实 `album-browser.select` 在点击后的标题核对后，再读上述状态，返回实际 `remoteAlbumId`；existing-album 的生产观察分支接入同一读取器。生产 append/preparation 的写能力仍关闭，未以静态脚本核对冒充完整写流程验收。
- 创建合同不再强制要求平台存在本地 `idempotencyKey` 输入/回显。该键仍用于本地耐久去重；仅有标题或缺少原操作关联证据时返回 `unknown / ALBUM_ORIGINAL_OPERATION_EVIDENCE_REQUIRED`，交给既有人工复核流程。既有 fixture 关联回显仅保持兼容，不作为生产平台能力。`TME_ALBUM_PRODUCTION_CREATE_CONTRACT` 仍为 null，生产创建门禁未开放。

## 验证

先加入测试并观察到新增读取器缺失、无幂等表单合同被旧逻辑拒绝的红灯，再实现。

- `node --test tests/official-selected-album.test.mjs tests/album-browser.test.mjs`：19/19，通过。
- `node --test tests/ai-existing-album-browser.test.mjs tests/official-browser-read.test.mjs`：36/36，通过。
- `npm test`：3/3，通过。
- `npm run typecheck`、`git diff --check`：通过。
- 生产只读脚本：通过；选中状态为 none；主页面与页集合保持；没有写流程阳性验证。

## 剩余缺口与最小可见原生验收

1. 用户在可见官方入口自行选定一张目标专辑后，只读执行同一读取器，对照可见标题及官方目录中该记录的 albumId。只读脚本本轮不会替用户切换选项。需要覆盖两张同标题专辑与隐藏副本的情况。
2. 新建专辑的后续验收需单独明确写授权及全新测试作品，先完成必填字段/封面/保存控件校准；禁止重放历史歌曲。原次保存应记录实际草稿响应 `data.albumId`，再与当前 `form.id` 及官方远端记录核对。若发送不确定且缺失原次响应或其他可唯一关联证据，目录出现同标题、仅新增一条、或标题+歌手匹配都不足以归属原操作，继续 unknown/manual_review，不重发。
3. 当前没有可见原生窗口操作与正式提交验收；后台 DOM/脚本和离线 fixture 不能替代这些阳性验收。
