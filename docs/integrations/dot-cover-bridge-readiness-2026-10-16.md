# 当前dot封面任务桥接调查及最小设计（待触发机制确认）

范围：SOURCE_WINDOWS_HOST上现有独立Rainfall项目，只读调查本地桥接，未启动新CLI任务、创建定时任务、配置外部连接或向其他应用发消息。父会话另行核查平台侧自动化与通知能力。以下是本地已有实现的事实，不能据此宣称所有Codex产品都不存在相关能力。

## 本地现状

|能力|证据|结论|
|本地文字收件|src/core/inbox/controller.ts、receiver.ts、service.ts、src/shared/inbox.ts|单向本地目录扫描；incoming/processed/rejected/receipts，事务去重、身份别名范围、回执恢复均已有；包只支持CreativeDraft文字，不能直接放PNG|
|运行时扫描|src/core/studio.ts的scanInbox和tick，src/core/index.ts|启动扫描，此后运行时每5秒扫描；退出后无扫描，下次正常启动可补收。只是客户端收件，不是唤醒dot|
|当前库配置|只读production/library.sqlite的inbox-channel和dailyPlans|inbox未配置、未启用，revision0；dailyPlans为0。本次没有改变配置|
|父端投递|src/renderer/components/TextCandidates.tsx|明确写着父dot调度与投递需单独接线、尚未验收，没有已落地的反向唤醒|
|封面交接|src/core/cover-handoff.ts|已持久化requestId/contextHash；receiveFile校验manifest和实际图片、回执幂等。没有自动图片收件扫描器或消费者领取队列|
|每日候选|src/core/workflow/daily.ts、text.ts|DailyScheduler.enable直接DAILY_EXECUTION_DISABLED；TextProviderRegistry没有默认provider，不会自动调用dot|
|本地命名管道|src/main/session-runtime.ts|acquireWorkspaceLease接到socket立即destroy，只有独占工作区锁功能，没有任务RPC或唤醒能力|
|Renderer/Main IPC|src/main/bootstrap.ts及preload|只面向受信本应用窗口，不是可外部调用的当前dot接口|
|Codex CLI|Get-Command只确认codex.ps1已安装|未发现项目调用CLI/app-server的实现；安装CLI不证明它能唤醒当前订阅dot或拥有当前会话image_gen。未启动CLI验证，更未把它作为替代计费服务|

代码检索未发现客户端出站调用Codex任务/通知API、通用HTTP webhook、向当前dot发送消息的桥接或可消费封面任务的本地代理。浏览器CDP仅属于原有腾讯适配，与dot无关。不要复用、猜测内部助手工具URL或令牌，不使用模拟键盘输入给聊天发消息，也不通过邮件/Slack发触发消息绕路。

## 最小产品设计（尚未实施）

封面主区只保留“生成图片”和“导入图片”两个主入口，配作品选择、画面要求、预览和任务状态。JSON、manifest、requestId与工程诊断放到后台或高级诊断，不要求用户手工导出再导入。

生成点击后先保存不可变作品上下文和唯一requestId，同一未完成请求重复点击只返回原任务。后台队列状态为待连接/排队/已领取/生成中/接收校验中/完成/失败/结果待核对。只有真实桥接确认领取后才显示生成中。发送前持久化领取与派发记录；不确定是否生成成功时不自动重发出图，优先取回同一requestId结果；明确失败且确认未发送才允许原任务重试。用户主动重新生成才新建请求并保留旧版本。

消费者按经批准的真实通道读取队列并调用当前dot出图，结果按requestId、workId、workspaceRef和contextHash匹配；本地原子落盘后校验实际SHA256、格式、宽高、体积和上下文，再复用现有CoverHandoff.receiveFile导入。结果回放幂等，跨作品/过期上下文拒收；保留原件、来源声明和派生关系。客户端关闭期间结果可待下次启动导入，不能把客户端退出说成后台还在执行。

## 真正触发层缺口

必须先确认一个官方支持且授权的通道，能够定位当前dot、让它读取此本机队列、使用该会话的图像工具，并把真实字节交回当前库。仅有本地文件队列不能唤醒会话，助手内部cloud_threads能力不能作为产品公共API。桌面通知也不等于dot已领取任务。

若仅有用户批准的定时检查可行，需要明确它是延迟轮询而非即时唤醒，并确认该执行环境可以访问90VC队列及图像工具；由父会话与用户确定频率、运行条件及授权后才能创建。本次没有创建任何轮询或自动化。若要求即时，则仍缺受支持事件桥接/本地代理及其与当前dot的身份关联，不能只改按钮名称交付假一键。

当前可继续承诺的是已有真实图片的本地导入与派生闭环；一键生成应在桥接完成端到端验收后启用。在桥接未配置时应显示明确原因，不能把保存任务显示成已经启动生成。
