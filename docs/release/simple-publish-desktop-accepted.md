# 0.5.3 桌面验收与本曲发布预检

2026-10-16 用户明确恢复GUI调试。已验收源码 `f47d6d7e2bcb96e2ff293179b282db6cd428a3b6` / `0.5.3-simple-publish.1`，未改产品代码。

## 实际通过

已打包候选在独立测试库完成可见音乐多选、A录音选择、平台选择、唯一账号带入、一次模拟排队、防重复点击、提交/审核/上线分别展示及内联回执切换重置。真实原库的SQLite一致性副本与素材用于原 A 播放和真实模式阻塞验证。0渲染错误、0外部HTTP请求。之前61项后台回归、类型检查、构建保持有效。

同一桌面 `Rainfall Studio 音乐客户端.lnk` 已更新图标和验证指针；旧客户端正常退出。实际新PID10196，从该.lnk启动，使用原数据根 `out/tme-readiness-f98b20328ab4-1792145753240/candidate-data`，没有改用新包空库。原1首真实作品、A/B音频和2版封面、3首隔离演练示例均保留；原A播放进度推进，媒体哈希及其他作品、计划、发布单元未变。

回退备份：`output/desktop-upgrade-simple-publish-1792162446433`，含原指针、快捷方式、启动记录、两个SQLite一致性快照、媒体及安全白名单表单备份。未读/复制凭据。恢复旧指针和快捷方式即可回退运行包；继续使用原库，不删除新版数据。

证据：`output/simple-publish-gui-verification.json`、`simple-publish-desktop-final-identity.json`、`simple-publish-upgraded-library-verification.json`、`simple-publish-desktop-repeat-verification.json`。截图：`output/simple-publish-desktop-A-playback.png`、`output/simple-publish-desktop-publish-A.png`；隔离全流程截图路径在GUI验收JSON内。

测试夹具曾把两首测试曲指向同一音频，按设计触发DUPLICATE_RECORDING；随后改用不同隔离音调。回执测试曾错误期待第二单元为空，已修正为其已有模拟回执。均未改动产品防重或回执逻辑。

## 原A最高实际质量

匿名GET重新读取供应商公开OpenAPI和dashboard成功，OpenAPI与此前保存版本字节哈希相同。原A WAV路线仍为认证POST `/v1/music/generations/wav`，描述为转换，列有402响应。公开dashboard没有WAV定价说明；确定收费、原生无损母带来源及平台规格符合性仍未核实。未发WAV/转换/新生成请求，未扣新积分，不把Opus转WAV称为原始无损。证据：`output/leave-a-light-resumed-quality-conclusion.json`。

## 腾讯只读预检与必要决定

本轮仍见登录昵称“云端测试艺人”，现有专辑6437318共2首（示例作品C、从今天起）。当前个人主页没有找到足以作程序提交保护的唯一账号主体。没有据此声称本曲全平台无重复。

已读取当前[平台协议](https://y.tencentmusic.com/#/help/agreement)，要求对上传内容拥有完整权利或合法授权；未点击接受、签署或提交。

当前[AI入驻权限说明](https://y.tencentmusic.com/#/help/AI%20Singer)表示AI入驻账号可继续发歌，但有Logo和签约权限限制。[AI歌曲签约/结算指引](https://y.tencentmusic.com/#/help/AI%20Song)将AI生成词/曲/录音列为AI作品，建议走AI作品通道或主动申报，并说明目前AI作品不支持签约和结算。不能把本曲申报为纯人工原创，也不能承诺版税收入。官方正文已保存为 `output/tme-resumed-ai-account-policy.json`、`tme-resumed-ai-royalty-policy.json`。

本曲仍缺可核实的商业发行授权证据及正确词曲署名；用户须理解AI通道/签约结算限制，正式授权条款仍须逐项披露确认。尚未上传原A、创建远端草稿、接受新协议或提交。新表单AI字段没有通过上传强行打开，材料与权限缺项仍明确阻塞。

## 云端歌词交接

完整747字符、9段歌词与已保存生成请求一致，无逐句时间戳。Library `libfile_b28655a3a2f881918e11d47809380d91` / `file_00000000d2a881f588c5f20d78a030bb`。未做ASR、本机MV或新音乐生成，Gmail保持暂停。
