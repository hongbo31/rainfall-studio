# 0.8.1-preview.1 原生验收与桌面交付

2026-10-17。用户06:44 UTC明确授权“开始验收吧，可以打开客户端了”，仅本次客户端验收可操作原生窗口。交付主机SOURCE_WINDOWS_HOST，产品源码 `51ee699231dc5a5e36472e89f561ca0a15e73fab`；没有修改产品代码或重新构建另一个版本。

桌面仍使用 `C:\Users\CLOUD_USER\Desktop\Rainfall Studio 音乐客户端.lnk`，通过原稳定Launch-Verified.ps1启动。权威指针已切到 **0.8.1-preview.1**，运行包为 `out/ui-consistency-51ee699231dc-1792215103235/RainfallStudioCandidate.exe`；原库仍为 `out/tme-readiness-f98b20328ab4-1792145753240/candidate-data`。最终从该快捷方式重开，PID42612，停留作品库，未继续播放声音。

## 原生清单与证据

| 验收项 | 实测结果 |
| --- | --- |
| 真正原生进程 | 使用打包EXE、WinSta0/Default真实桌面；24项原生检查通过，fixtureBridge=false。 |
| 当前版本 | 真实runtime返回packaged=true、appVersion=0.8.1-preview.1、原production root；UIA读到v0.8.1-preview.1，与包内元数据相同。 |
| 八个主菜单与详情 | 总览、本地模板、作品库、封面工作室、发布中心、数据看板、配置中心、AI聊天均可打开；作品详情也已检查，未出现横向溢出或renderer异常。 |
| 红框顶栏 | 状态、切库、备份三项原生实测均36px/13px，同一y；列表筛选40px及统一规则已由包内无头回归覆盖。 |
| 配置与精简文字 | 五个平台标签与四个分类可打开；抖音视频与音频平台明确区分。紧凑标题、必要状态与待条款确认保留。 |
| 小窗口 | 1280×800、1000×700实际原生内容区域，底部版本可见且位于播放器上方，导航可滚动。 |
| 原素材 | 原封面本地加载；真实A/B音频均解码、播放时间超过1.2秒、时长有效、error=null，并通过原生audio键盘暂停。这是播放功能验证，不是人工听感评价。 |
| 桌面入口试听 | 切换后从同一个快捷方式打开，再通过Windows UIA点击原歌、试听A、暂停，并截取带Windows窗框的真实窗口。 |
| 单实例 | 重复快捷方式复用PID33472；直接重复启动EXE的PID46956退出0，原PID/启动时间未变，仅一个可见本项目主窗口，生命周期记录second-instance。 |
| 正常退出和重开 | 原生QA及交付第一轮均正常关闭，quit exitCode=0；交付第一轮无Windows原生异常/本地生命周期失败。第二轮从快捷方式重新打开并核验ready，留窗口供用户查看。 |
| 原资料保留 | 两库37张表比对：作品/素材/账号/艺人/配置/任务/费用/协议数据保持；仅现有调度器clock.checkedAt心跳按既有逻辑推进。生产1首/4素材SHA256一致；演示库3首保持。 |
| 条款及外部行为 | 腾讯原任务仍awaiting_terms_review、revision20，submissionByClient=false、remoteId=null；未接受协议、收费生成、正式提交或推远程Git。 |

首几次QA在可见等待时序、平台标签及原生audio控件定位上修正了测试假设，全部记录保留；未改动产品程序。最终完整原生检查一次24项通过。库比对起初要求整个settings字节不变，定位为既有生产流水线的checkedAt心跳，仅对这一字段做显式允许比较，其余所有列/行仍严格相同。

主要证据：`output/ui-consistency-native/native-verification.json`、`repeat-verification.json`、`desktop-cycle-1.json`、`desktop-cycle-2.json`、`data-preservation.json`、`final-verification.json`。可重复原生QA为 `node scripts/ui-consistency-native-qa.mjs`，必须有用户允许打开窗口，并在真实Windows桌面运行；脚本不调用生成/发布或改变业务表单。

## 回滚

入口/稳定启动脚本、旧指针、两库一致性备份与四个素材副本位于 `output/ui-consistency-native-delivery-backup-1792219550842`。旧0.8.0运行包 `out/simple-publishing-94da5036f474-1792207712423` 完整保留。正常关闭本项目客户端后，可恢复该备份的verified-desktop.json和desktop-before.lnk到原位置；不删除原库，不把候选空库替换成原库，不覆盖本次之后新增作品。

## 真实截图（另存Library）

以下均来自真实原生客户端和原库，不是演示bridge或无头截图。前两张带实际Windows窗框，其余为原生Electron内容区域。

| 截图 | 本地文件（output/ui-consistency-native） | Library ID | file_id |
| --- | --- | --- | --- |
| 原桌面入口作品库 | desktop-library.png | libfile_2a7e78932f148191b8ed9f78fb1b1aa6 | file_00000000f29881fda20d2314d8aa30f0 |
| 原桌面入口A试听 | desktop-A-playing.png | libfile_d657805d666c81918c350148ced9943d | file_00000000bffc81fdb5e86ba9b7e21a5e |
| 配置中心 | 配置中心-native.png | libfile_2f902ecfbca88191909ac5077fa245ec | file_000000007b7c81fd9a700a1091055d33 |
| 封面工作室 | 封面工作室-native.png | libfile_bd5ca4571b688191bd2116a6b555e1f5 | file_00000000199881f896b5943abf999d76 |
| 发布状态与原条款 | publish-real-terms-native.png | libfile_e822bf905de881919ab07486695f2487 | file_0000000051ec81fd933a0aa71f34cbb9 |

当前仍是离线便携开发交付包，未安装/配置在线更新；不会因此获得第三方生成、图片API、跨平台发布或实时统计权限。未接通的平台与封面图片接口继续显示现有实际状态，不能承诺无人值守全平台发布。完整无bridge Web页面仍不在桌面验收范围内。
