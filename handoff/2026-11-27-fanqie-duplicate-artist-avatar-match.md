# 番茄同名艺人按头像匹配

## 改动原因

用户提供了番茄上传下拉候选和“艺人信息”页面 DOM。同一署名会出现多个候选；附件证明候选头像与账号艺人列表头像的图片资源路径可以对应，CDN 主机名、缩放后缀和签名查询参数会变化。此前目录上传遇到同名候选直接停止，无法自动识别已配置艺人。

## 实现

- `src/main/fanqie/directory-form.ts` 仅在精确同名候选多于一个时，用当前上传页内的隐藏同源 iframe 读取账号 UID 并确认仍是本批账号，然后打开“艺人信息”搜索署名并读取唯一头像。不会把上传编辑页导航离开。
- 头像标识只保留 ByteDance 图片 URL 的资源路径，去掉 CDN 主机、`~tplv...` 缩放尾缀和查询签名。表单候选中必须有且只有一个头像匹配；匹配后在点详情箭头前再次读回候选与头像。若是歌手，原有官网 `artist_id` 请求校验仍须通过。
- 同一运行内缓存账号、署名和歌手 ID 对应的头像读回，避免每首歌重复访问艺人页。
- 头像读回失败或结果不唯一时安全停止，分别返回 `FANQIE_AUTHOR_AVATAR_UNVERIFIED` 与 `FANQIE_AUTHOR_AVATAR_AMBIGUOUS`。
- `directory-trace.ts` 记录角色、阶段、艺人页同名行数、ID 匹配行数、候选数、头像匹配数和唯一匹配结果；不记录头像 URL、资源路径、签名或艺人 ID。用户可从执行记录定位到歌曲与署名角色。
- `src/shared/fanqie-downloads.ts` 增加头像读回失败和头像歧义的简短中文提示。

## 影响与兼容

单一同名候选保持原流程，不增加艺人页读取。重复名称在唯一头像匹配后沿用既有艺人详情确认及表单标签回读。目录上传共享 Main 自动化代码，浏览器入口和 Windows 客户端均使用同一逻辑，无数据格式迁移。当前修改不会追溯改变已阻塞运行，也未重放已投稿歌曲。

## 验证与未验证

- 对照用户提供的 DOM：艺人页 `.artist-item` / `.artist-avatar`，上传候选 `.artist-autocomplete-item-left` 下的头像；确认附件中一个候选路径与配置头像资源路径一致，另一个同名候选为不同资源路径。
- `git diff --check` 通过。直接调用本地 `node_modules/.bin/tsc.cmd --noEmit` 时，本次改动的 `directory-form.ts`、`directory-trace.ts` 和 `fanqie-downloads.ts` 无类型错误；全仓类型检查仍被其他文件中的现有诊断和缺失依赖阻断（`directory-run.ts`、`native-upload.ts`、`suno-cn-browser-page.ts`、`plan-execution-labels.ts`、`reflect-metadata`、`@peculiar/x509`、`qrcode-generator`）。
- 未运行测试、真实番茄账号流程、投稿、构建或 Windows 原生验收。浏览器与桌面入口均未启动/更新。
- 后续可在隔离账号和未投稿歌曲上验收：同名头像唯一匹配、头像缺失、头像均不匹配、多候选头像重复、搜索延迟，以及歌手 ID 与头像配置不一致时均停止。

## 回退

回退本次在 `directory-form.ts` 的隐藏 iframe 头像读取/匹配、`directory-trace.ts` 的头像诊断字段和 `fanqie-downloads.ts` 的两个头像错误提示，并移除此交接条目及 `PROJECT-HANDOFF.md` 对应索引行。保留本工作区中此前已有的其他改动。
