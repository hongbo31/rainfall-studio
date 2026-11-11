# Rainfall Studio 弹窗与引导稳定性候选

## 结果与启用边界

本轮新增有界弹层策略、基于真实首页观察的四条DOM规则，以及已校准Playwright端口的观察前防护。离线回归149/149通过，TypeScript检查与desktop:build通过。仍为0.8.3-preview.2候选，未安装、发布或推送远端。

默认生产manager使用verified:false，仍在进入guard前拒绝未校准契约。本轮没有将Windows AI原生链接入DOM处理；不能称当前实机上传已经自动解决所有弹窗。真实浏览器只由另一只读任务观察并手动关闭首页四类提示；本轮新代码没有在真实浏览器执行。

## 设计

- 只允许精确容器、固定标题、可见且唯一的安全关闭控件。禁止通用X、确定、下一步、探索、绑定、同意。
- 已知登录、验证码、协议/授权、权限、未保存退出、删除及未知阻塞优先暂停；普通正文同名不会成为关闭目标。
- 每次关闭前后重新读取路由、账号、绑定与表单/素材指纹，SPA或素材变化暂停。仅对已校准字段作指纹，不能证明远端字节。
- 最多4次关闭、10秒动作预算；同一规则重复、关闭失败、目标变化都暂停。失败与已尝试规则跨run锁存，不因再次observe而自动重试。
- 悬挂observe/click保持busy直到真实Promise结束。预算到期禁止下一动作；并非所有底层DOM读取都有可取消硬超时，因此底层悬挂可使锁超过10秒保持。没有Promise.race解锁或全局kill。
- native浏览器dialog不接受/关闭；发现后持续暂停。恢复须人工复核后的新guard/会话；本轮不提供自动重置。

## 真实观察与路由

2026-10-18云浏览器只读/普通提示处理记录：

首页 https://y.tencentmusic.com/#/user/musician/index ：
1. 音乐人指数全新改版，.el-dialog[aria-modal=true]，专用.upgrade-dialog__content--arrow关闭；关闭后出现导览。
2. #driver-popover-content，个人资料&资产，使用可见“跳过引导”；隐藏Close不使用。
3. .ai-ast__bubble--intro，固定AI助手介绍，专用span.ai-ast__bubble-close。
4. .wechat-video-bind-float--right，绑定视频号推荐，使用“稍后再说”，不进行绑定。

规则仅允许上述首页完整URL。原创入口 /#/user/manage/add 与原生AI入口 /#/user/manage/aiChoose/add 是不同页面，不能复用首页观察当作上传页校准。真实原创页只观察到音频输入、已发布专辑选择及下一步按钮；未上传，未观察后续歌词/封面字段。

## 本轮文件

- src/main/tme/overlay-policy.ts：纯策略和暂停错误。
- src/main/tme/page-overlays.ts：规则、DOM只读扫描、执行前复核、跨run锁存。
- src/main/tme/browser-port.ts：已校准browser契约observe接入，账号/材料指纹。
- tests/tme-overlay-policy.test.mjs：32项策略测试。
- tests/tme-page-overlays.test.mjs：19项分类与模拟Page适配器测试。
- scripts/test-tme-cover-cloud.mjs：加入新测试及现有UI端口6项。

## 验证与未验证

已通过：node scripts/test-tme-cover-cloud.mjs，共149项（基础3、prepare30、broker22、submission16、UI9、cover-readback12、overlay-policy32、page-overlays19、UI-port6）。npm run typecheck、npm run desktop:build、git diff --check通过。构建仅有既有chunk-size建议。

新回归覆盖重复出现、关闭失败、关闭后新导览、同名正文、隐藏Close、未知及无role modal、登录/协议/验证码/权限/未保存/删除、SPA/账号/素材变化、native dialog、跨run重试、悬挂点击busy、最终scope读取耗尽预算零click。

环境阻断/未执行：真实浏览器执行新DOM提取和点击代码、Windows UIA/PowerShell、腾讯上传/保存/提交端到端。模拟Page测试提供归一化DOM行，不等价于真实DOM选择器验证。DOM规则的来源是人工观察证据。

广域失败沿用上一轮已实际运行的170/202结果，本轮未重新运行该广域套件：21项Windows ffprobe路径；9项Windows ffmpeg/离线fixture；1项workflow-client同路径导入；1项socket EPERM掩盖预期errno。详见随包CLOUD-FAILURE-CLASSIFICATION.md。不得将其写成149项定向回归内的失败。本轮149项无失败。

既有封面候选边界继续保留：native kill后Promise完成未独立证明进程已退出；稳定封面回显不证明远端字节、保存或提交。用户已手动提交作品不得重放。

## 使用与回滚

增量forward.patch/rollback.patch以此前已交付的cloud-cover候选源码为基线，不以原始ec39d74为基线。包含上一轮封面候选的完整源码也随包保存，但本轮增量补丁只涉及以上6文件。应用前git apply --check，保留用户未提交更改；回滚前同样检查，不执行reset --hard。
