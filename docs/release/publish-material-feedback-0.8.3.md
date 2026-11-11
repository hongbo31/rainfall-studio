# 发布材料反馈修复：0.8.3-preview.1

用户在已安装的 0.8.2 选择《示例作品B》A 和 QQ 账号后，点击发布仅看到“已显示已有检查”。原因是 Core 按内容指纹直接返回旧检查，页面只更新提示；匹配任务留在下方历史列表，材料和阻塞没有显示在操作旁。源码基于尚未交付的 `36ab2df` 安全提交前检查增量，因此本次候选也包含该增量，但不会自动执行原生上传或接受条款。

## 现在的行为

- 发布按钮立即锁定，收集当前歌曲、平台、账号的材料快照，并将本次返回的任务显示、聚焦到按钮下方；复用旧指纹也显示正确的任务 ID。
- 自动带入已验证的音频 A、清理后的发布歌词、封面、保存的艺人/词曲作者/专辑默认值和 AI 来源。只有明确关联到 A 且校验通过的 WAV 可以替代绑定的非 WAV；不会用 B 补位。
- 缺失项提供补音频、补歌词、补封面、补署名或核对权属等入口。展示“暂不能提交：QQ音乐上传未接通”，不将本地检查称为正式发布成功。
- 每次点击重新校验；相同材料不新增重复任务。材料、账号授权状态或官方身份变化会使旧检查失效；后台刷新也更新操作旁的过期标记，支持重新检查。官方身份只保存非凭据哈希。
- 历史记录在同一次同步快照内共享当前检查及文件校验；每次新快照重新验证文件字节，显式发布检查不使用跨快照缓存。21 个同源历史请求的合成探针只需 2 次资产校验，而不是按历史条数放大。
- 异步准备或选择保存失败会就近显示错误并可重试；不会因重试发起原生平台操作。

## 实际新作只读验收

使用当前生产 SQLite 的只读连接，将允许范围的数据复制到内存，运行真实 Core 函数和 React 页面；所有检查记录只写内存。未构造生产 Studio、恢复任务或修改实际库。

- 作品 `00000000-0000-4000-8000-000000000001`，revision 6。
- A：官方导出 WAV，PCM 16-bit / 44.1 kHz / 双声道，174.813515 秒；SHA256 `3889aea19b1641ca58e724381696b8b13bd38a6cb21b4f15cac3659e4fc0372b`。
- 封面 1254 × 1254 PNG；SHA256 `857b051f81851af34558c0b7816e7669a0428a3cfbe573947349f51e7f59385d`。
- 发布歌词已去除结构标记，AI 生成及来源说明已带入；完整试听匹配和权属仍待人工确认。
- 当前本机保存的艺人是“我的艺人”，词作者、曲作者和专辑为空。页面如实显示“补署名”，不会根据账号昵称猜填。
- 生产写入、原生动作、第三方请求均为 0。

## 验证和证据

新增 Core 测试先失败后修复；独立审查的三个 P2 发现也各有 RED/GREEN 证据。最终结果：默认测试 3/3，完整 Core 201/201（包括本次 7 项），发布材料针对性 Core 27/27，真实页面无头交互 10/10，原 UI 42/42，安全提交 16/16，TypeScript 与桌面构建通过。Vite 仍提示既有的大于 500 kB chunk，未阻塞构建。

证据均在 `output/publish-material-feedback/`：

- `targeted-final.log`、`core-regression-final.log`、`ui-regression.log`、`safe-submission-regression.log`、`default-final.log`、`typecheck-final.log`、`build-final.log`。
- `independent-review.md`、`review-red.log`、`review-ui-red.log`、`review-green.log`、`review-fixed-evidence.json`。
- `actual-new-song-verification.json`、`actual-new-song-materials-headless.png`；截图为无头真实页面验收，不是原生桌面验收。
- `installed-source-difference.json`、`candidate-delivery.json` 保存已安装版本与候选路径、来源和文件哈希。

复验：`npm run test:publish-materials`；完整 Core：`node scripts/test-headless.mjs`；构建：`npm run desktop:build`。均复用现有依赖，无安装、无远端推送。

## 交付边界与后续启动

本轮只后台构建可移交 Windows 便携候选，不启动窗口、不重启当前客户端、不改桌面快捷方式或已验证指针。已安装版本仍是 0.8.2-preview.1 / `2d065bd9183a0dd317d8d7f9d1415aa170b29273`。候选尚未通过原生点击、窗口视觉与原入口验收。

经用户后续明确允许可见验收后，按 `desktop-delivery-policy.md` 完成备份、复用已验证指针的原 dataRoot、原生验收和同一快捷方式更新。候选 EXE 默认指向自己的空 candidate-data，不能直接当作原作品库升级入口；最终绝对路径见 `candidate-delivery.json`。目前不应运行它替换现有会话。

QQ 正式上传仍未接通，其余平台能力按现有能力矩阵保留标记。无真实上传、协议接受、付费音乐生成/导出、账号绑定；Gmail 暂停工作保持原样。
