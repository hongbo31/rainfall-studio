# 简洁发布中心与配置中心

用户已明确要求直接实现、普通布局不再确认。本次复用0.7.2的原生诊断和原数据根，不启用腾讯正式提交或收费。

常驻文案只保留功能与短状态。说明放可键盘聚焦的tooltip/帮助入口或诊断详情；真实未接通显示“未接通”，不附解释段。重要错误、三年条款及必要权限/费用确认必须在需要时直接显示，不能只放悬浮提示。

## 界面

发布主页面只展示三个步骤：多选歌曲、选目标平台/已配置账号、发布。默认使用作品A音频、已选封面和已有歌词；不自动选择B，不要求反复填写相同材料。下方是简洁的本地任务状态与结果，错误细节折叠。缺配置提供就地说明和对应配置链接，跳转后选择保留。真实未接通能力必须标不可用；本次点击只能形成持久本地检查结果，不能称远端发布成功。

现有已到条款步骤的腾讯任务显示简短“待条款确认·未接受条款”卡，三年非独家原条款可展开；不通过关键词推导法律摘要，没有自动接受按钮。历史/指纹/快照/修订/原生准备执行器移到配置中心的诊断与历史页，默认不展开。

配置中心分为发布平台、模型API、艺人与本地管理、诊断与历史。五个平台分别保存账号选择、艺人、词曲署名、常用专辑、语言/曲风、AI标注与翻唱偏好。账号本地备注、官方页面观察和真正授权状态要区分，默认值不授予发布权。模型API仍使用原安全存储接口；不读取或迁移凭据内容。

## 数据与接口

使用现有SQLite settings表的版本化记录，不改变schema3，不修改旧作品、账号、绑定、API配置、腾讯准备任务或历史。

- `PlatformConfiguration`: `version:1,target,revision,accountId:string|null,artistId:string|null,lyricist,composer,album,language,genre,aiDisclosure:'unknown'|'none'|'assisted'|'generated',isCover:boolean|null`。target为netease/qishui/qqmusic/kugou/douyin。
- `platformConfig.list {}` 返回配置数组；`platformConfig.save {config,expectedRevision}` 返回新配置。config不含revision/version，拒绝协议同意和授权字段。仅可引用对应平台账号（腾讯账号可用于QQ/酷狗）和存在的艺人；本地账号状态不改为已连接。
- `publish.selection.save {workIds:string[],targets:string[],accountOverrides:Record<string,string>}` 保存草稿，可空；不含执行授权。
- `publish.simple {workIds:string[],targets:string[],accountOverrides:Record<string,string>}` 返回 `{requests:SimplePublicationRequest[],reused:boolean}`。后端逐歌曲/目标检查，冻结实际材料与默认值，内容指纹幂等。没有HTTP、原生输入或正式发布调用。生产平台状态为needs_configuration/needs_materials/awaiting_terms_review/unavailable，成功与准备不可混淆；模拟只能明确标simulation，不伪造远端ID。
- `SimplePublicationRequest`: `{id,workId,title,target,accountId,state,summary,issues:string[],createdAt,updatedAt,source:'local'|'simulation',formalSubmission:false,configurationTarget,materialSnapshot}`。材料事实优先于默认值；完整检查保留原素材、权益/歌词匹配、AI/翻唱授权等要求，默认值不补造法律同意。
- snapshot新增`platformConfigurations,publicationRequests,publishSelection,publicationPendingTerms`，原字段完整保留。`publicationPendingTerms`只读投影原官方准备任务及原文/哈希，不猜测本地账号或目标映射。初始化迁移只新增版本化配置与marker，幂等；从唯一合法旧账号/艺人读取默认引用，歧义保持空。任务/草稿重启可恢复，不能因恢复自动执行或重试未知发布。

## 验收

迁移重复运行、旧数据逐行保持、配置CAS、错误跨平台账号、伪造协议字段、空选择/缺配置、多曲多平台、双击/重排幂等、重启恢复、原待条款状态与未接通能力。真实Electron隔离副本验证主页面仅三步、配置跳转保留选择、表单持久化和任务恢复。正常桌面检查原A播放、原库和原生事件；通过后才更新同一快捷方式，并上传两页截图到Library。
