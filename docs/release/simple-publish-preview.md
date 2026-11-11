# 简化发布候选交付说明

实施：发布页内直接多选音乐 → 勾选平台 → 点击主按钮。唯一有效艺人绑定自动带入；账号失效、歧义与录音范围在页面内处理；账号覆盖、腾讯逐首工具及批次高级操作折叠。人工回执和模拟确认使用内联表单。

所选 A/B 分别冻结音频、歌词匹配状态及由该录音/封面生成的视频；不更改作品库 A/B。重复请求复用批次，重复录音有投稿 claim 防护，未知回执不能重新提交。一次主操作仅在整批均可执行时启动**本地模拟**；真实工作区保持接入阻塞，不伪造作者、版权、登录身份、协议或成功回执。

## 后台验证

`node scripts/test-quick-publish.mjs`：61/61通过，覆盖新流程、录音/视频错配、表单身份、原发布防重、歌词封面和腾讯草稿回归。`npm run typecheck` 和 `npm run desktop:build` 通过。一次独立只读代码审查的2个 Important 均完成 RED→GREEN 修复。

证据：`output/quick-publish-regression.log`、`output/quick-publish-review-red.log`、`output/simple-publish-production-readonly-check.log`。后者核对原真实 A/B、两版封面、其他作品、计划和发布单元保持一致。

## 尚未交付桌面

用户最新要求不弹窗口。因此本轮只后台构建/打包，没有启动新客户端或浏览器，没有焦点操作，没有桌面截图/点击验收，没有替换桌面入口。现有已验收桌面指针与作品库保留；待允许实际运行后才能完成视觉、点击、数据复用和统一桌面交付验收。

候选打包命令为 `node scripts/package-tme-candidate.mjs --simple-publish`，只复用本地已安装 Electron 和依赖，不下载/安装。候选 `accepted:false`、`launched:false`；输出清单将保存在 `output/simple-publish-package.json`。候选默认独立测试库不得被当成现有正式作品库；正式交付须遵循桌面交付规范、显式复用当前 verified-desktop.json 的 dataRoot。

## 本曲后续操作边界

《示例作品A》仅 A 已获用户范围确认。用户优先原 A 最高实际质量，不限定 MP3；[素材路线说明](leave-a-light-source-quality.md)记录了官方 WAV 转换接口、费用未核实和原生母带证据不足。未新生成、调用收费转换或访问密钥；未创建在线草稿、上传、接受协议或提交。

仍待：具体 WAV/新生成收费确认；素材质量/平台格式核验；商业发行授权、作者及腾讯新表单/协议和唯一账号身份核验。Gmail封面工作保持暂停。
