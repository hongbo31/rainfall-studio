> 本文保留当时的阶段记录；0.12.0-preview.3 已实现三类路由、艺人/故事冻结与身份状态核心。最新结果与真实绑定阻塞见 [generation-routing-native](2026-10-19-generation-routing-native.md)。

# 0.12.0-preview.2 原生验收

构建源码 ec7b5fedbc3d697070f326f5c24aa7a4f915d15a。候选 out/unified-plan-center-ec7b5fedbc3d-1792400989142，未推送、未替换正式指针。后续文档提交不改变本候选构建来源。

- 双主题：3 次实际 Windows Electron 进程，21 张原生窗口截图，九页与计划弹窗；原主题/白色主题分别在完整关闭重开后恢复。旧隔离艺人、计划、目录路径、暂停和队列记录保持。output/native-theme-1792401016739/report.json。
- 新用户目录：3 次实际进程、两次真实系统选择器动作；计划内选目录后保存暂停，稳定文件、格式重写幂等、修订排队、缺目录提示与恢复、停止后不接收、重开恢复、立即执行/停止/再执行通过。无 dot/Drive/Key/价格/付费授权；真实受阻而非模拟模型成功。output/native-provider-directory-20261019/run-1792401121244/report.json。
- 旧作品升级：2 次实际进程，保留已隔离的两首旧作品、歌词与封面，4 次本地 A/B 音频解码和 unmuted/audible 指示；准备发布选择预览、不点击发布，重开选择保留。output/native-media-012-1792401344873/report.json。原始截图含旧作品内容，仅留本地，不放入共享包。
- 14 项打包程序哈希、SQLite ABI、独立 Core 持久化、便携相对数据根通过。主题 14 项配色对比度合同通过，其他 CSS 中颜色字面量为 0；不声称全站完整 WCAG 认证。
- 本轮真实网络/收费模型/平台写入为 0。客户端/主题/数据库恢复不等于平台登录长期有效，外部浏览器会话重启、通用绑定和真实提审均未验收。

当前手动作品详情仍明确使用 A 发布，B 选择在计划流程中；不能将 A/B 试听认作自动切换发布版本。新增三角色模型默认路由、艺人/故事快照、通用远端身份绑定是未实现范围，见 012-scope-checkpoint、account-session-recovery 与 platform-capability-matrix 文档。

补充：此前无头诊断素材工作区在本候选原生窗口中读回 B 选取与准确材料绑定，关闭重开后保持，2 次进程/2 张截图；这是诊断素材的选择恢复检查，不是新模型生成验收。output/native-selection-b-1792401455212/report.json。
