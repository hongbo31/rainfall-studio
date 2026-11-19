# Current Windows delivery scope (2026-11-12)

The user has explicitly resumed development and desktop acceptance on their Windows host. Preserve the existing production library and configuration; resolve paths from the current verified-desktop.json, never from CLOUD_USER placeholders. Update the same desktop entry only after acceptance. CLOUD-HANDOFF.md is a historical export record, not the current execution restriction. Do not replay songs already submitted to review. Contract acceptance remains a user confirmation boundary.

# Rainfall Studio 项目约定

新会话先读 [项目交接](handoff/PROJECT-HANDOFF.md)，核对 Git、桌面指针和当前任务后接手。

- 本机 Rainfall Studio 的日常源码和 Git 操作统一在 `H:\CodexData\Workspace\Rainfall-Studio\source` 管理。
- 本机新增的构建、解包、验证库、测试日志和依赖下载缓存统一放到 H 盘的 `H:\CodexData\Workspace\Rainfall-Studio`。正式打包用 `Build-Latest.ps1`，本机默认使用其中的 `build` 目录。执行前核对成品、临时目录和各工具缓存的实际路径；仍写相对输出路径的工具须在 H 盘的隔离检出中执行。H 盘不可用时停在构建前。不要在两个已迁移项目的 C 盘原路径重新创建 `out`。
- 只有新包通过压缩包清单、文件哈希和随包运行组件的隔离验证，且成品及校验文件写入成功，才清理被替代的工具管理产物。更新桌面版时先用 `-DeferCleanup`，验收并切换桌面入口后用 `-CleanupInstalled`。清理范围为有构建记录的旧包、已结束的隔离运行目录（临时解包、测试数据、日志）和可重建的工具缓存（依赖、运行时下载）。构建或验证失败时保留最近可用包。
- 清理前核对绝对路径、目录归属、桌面与回退指针、在用进程。保护源码、未提交改动、正式作品、素材、账号库、在用版本和回退版本。归属不明、有外部链接或真实账号数据的历史目录保留。2026-10-15 目录不在本任务清理范围内。
- Windows 命令使用 PowerShell 7，不切换旧版 Windows PowerShell。
- 遵守用户的长期桌面交付要求：后续新版验收通过后，更新同一个 `Rainfall Studio 音乐客户端.lnk`，保留作品、音频、封面、配置和可回退旧版；未验收候选不得自动覆盖。
- 桌面交付的当前版本/数据目录以 `C:\Users\CLOUD_USER\AppData\Local\RainfallStudioLauncher\verified-desktop.json` 为准。新版本必须显式复用其中的 dataRoot，不能落到新包的空 candidate-data。详细流程见 `docs/release/desktop-delivery-policy.md`。
- 禁止清理当前交付指针引用的数据根、运行包和回退备份，即使其路径位于 out 或 output。
- Gmail 封面通知及两入口改版在2026-10-16被用户暂停；除非用户后续明确恢复，不继续该功能，不发信或配置凭据。
- 界面以直接操作为主：只常驻显示功能标签、按钮、必要字段、简短状态和可操作错误。说明放键盘可聚焦的tooltip/帮助或折叠诊断；不堆放长段解释、实现语义、免责声明式文案。必要法律/权限/付费确认在实际步骤短提示，不仅藏在悬浮提示中。此为用户2026-10-17明确的长期界面偏好，也适用于后续项目设计。
- 用户2026-10-17要求开发测试后台进行：不启动可见客户端/浏览器/终端，不弹窗、抢焦点或操作桌面输入，不自动重启现有客户端。可使用真正headless测试；交付只更新已验证文件和入口，不自动启动。原生窗口验收未做时必须说明，不能用无头演示截图冒充。
- 用户2026-10-17 06:44 UTC明确授权本次0.8.1原生验收可以打开客户端；这次范围内可检查本项目窗口、真实试听、单实例和桌面交付。该授权不取消后续开发默认后台进行的偏好，不包含收费生成、正式发布、协议接受或其他应用操作。
- 随后的0.8.2文案修复轮次重新限定仅后台修改和无头检查，不弹窗、不抢桌面、不重启正在使用的客户端；上一轮打开窗口授权已结束。保留0.8.1桌面入口，新的可见验收需另行获得明确许可。
- 用户2026-10-17 07:34 UTC在被问及新版验收与更新入口后明确回复“打开最新的客户端”，授权本次0.8.2打开、原生验收和同一桌面入口更新；该次操作后仍恢复默认后台开发偏好，不包含收费生成、正式发布或接受腾讯条款。
