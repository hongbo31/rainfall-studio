# 0.8.0-preview.1 简洁发布与配置中心

2026-10-17，Windows 便携客户端已更新到原桌面入口。产品源码 `94da5036f474a575358d938026b20cf24ed3a930`，没有推送远端或安装软件。

## 已交付

- 发布中心：多选歌曲 → 选择平台/已有账号 → 发布，下面显示本地任务状态。实际平台仍标记“未接通”，不会把本地检查称为发布成功。
- 配置中心：五个平台各自保存默认账号、艺人、词曲署名、专辑、语言、曲风、AI 标注与翻唱偏好；模型 API 独立分类，原账号、预算、备份及旧工具仍可访问。
- 选择、配置及本地检查结果持久保存；内容幂等，重复点击和排序变化不会创建重复检查。默认资料不能授予账号权限或接受条款。
- 主界面保留操作标签、字段、短状态和可操作错误；说明移入键盘可聚焦帮助或折叠诊断。关闭的诊断区不挂载旧工具，分类往返回归已补齐。
- 原腾讯条款任务仍为 `awaiting_terms_review`、revision20，原文保留，未接受、未正式提交。

## 实际入口和数据

- 快捷方式：`C:\Users\CLOUD_USER\Desktop\Rainfall Studio 音乐客户端.lnk`
- EXE：`out/simple-publishing-94da5036f474-1792207712423/RainfallStudioCandidate.exe`，必须保留整个包目录。
- 权威指针：`C:\Users\CLOUD_USER\AppData\Local\RainfallStudioLauncher\verified-desktop.json`，最终后台 `-ValidateOnly` 校验通过。
- 继续使用原数据根：`out/tme-readiness-f98b20328ab4-1792145753240/candidate-data`。
- 升级前一致性备份：`output/simple-publishing-delivery-backup-1792207607897`，保留上一程序、指针和快捷方式，可回退。

原真实库的1首作品、4个素材及其 SHA256、7条操作、2个每日运行记录保持。schema仍为3；真实库仅新增6条配置/迁移 settings。演示库未在交付窗口打开，因此尚未触发惰性迁移，原14行完整保持；真实/演示副本两次迁移演练均通过。没有读取或复制凭据，没有新增扣费、真实生成、平台通信或正式投稿。

## 验证证据

- UI 34/34、后端专项20/20、完整集成194/194、基础测试3/3；类型检查和桌面构建通过。构建只有已有的前端包体积提示。
- 最终便携包14项交互检查通过，包含表单、缺配置、多曲多平台、重复检查、重启恢复、原A真实播放、键盘帮助、诊断分类往返与布局。两次隔离进程退出0，无渲染或新增原生异常；外部HTTP和原生平台输入计数均0。
- 同桌面入口实际启动、重复点击复用、原A试听通过；本轮3次启动/退出记录均无新增原生异常。独立审查发现的诊断生命周期P2已修复并通过限定复审，无剩余重要发现。
- 总证据：`output/simple-publishing/final-verification.json`；GUI：`output/simple-publishing-gui-verification.json`；数据：`output/simple-publishing/data-verification.json`；审查：`output/simple-publishing/final-review.md`。

## 截图

截图为最新“不弹窗”指令到达前拍摄的实际0.8客户端，均已上传Library；不是离屏渲染。只展示原作品和默认空配置，无凭据或个人平台身份。

| 页面 | 本地文件 | Library ID |
| --- | --- | --- |
| 发布中心 | `output/simple-publishing-publish-center.png` | `libfile_9c353565b1ac8191b28809af2ecf12b4` |
| 配置中心 | `output/simple-publishing-configuration-center.png` | `libfile_32f7a932624c8191ae76ab3bf119a0a5` |

完整上传结果与文件身份见 `output/simple-publishing/library-upload.json`；Library返回的版本EA已写入原截图并用Windows `queryEA`读回。

## 最新后台约束

收到“不弹窗、不抢焦点、不自动重启”后立即中止桌面脚本，之后只读取后台数据/日志并上传既有截图。第三次验收窗口已正常退出，当前客户端未运行；没有自动打开第四次窗口。新版文件和原快捷方式已就位，后续启动由用户决定。本次不再进行任何可见窗口验收。

自动全平台发布、真实账号授权与真实模型接入仍未完成，界面明确展示接入状态。本轮不接受三年条款，不重复未知腾讯操作，不恢复用户暂停的Gmail任务。
