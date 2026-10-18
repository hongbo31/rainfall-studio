# 桌面架构阅读入口

本目录保留通用设计合同；历史方案中的阶段性描述不能代替当前代码与实际接入状态。

- `src/main`：Electron 生命周期、受控 IPC、加密凭据与数据根。
- `src/preload`、`src/shared`：边界接口、schema 与能力合同。
- `src/core`：SQLite、媒体、创作/质量/队列/收件箱/预算服务。
- `src/renderer`：React 中文工作台。
- `src/updater`、`launcher`：本机验收包交付、快照迁移和稳定入口；无在线更新源。

细节见 [存储迁移](storage-migration.md)、[接入能力](adapters-capabilities.md)、[批量发布](batch-publishing.md)、[安全与 UI](security-ui-acceptance.md)、[接口合同](contracts.md)、[艺人与计划](artist-planning-controls.md)。

Windows 安装、构建、隔离数据与媒体前提以 [根 README](../../README.md) 为准。此快照不包含原设备的现场验收记录、个人路径或运行数据。
