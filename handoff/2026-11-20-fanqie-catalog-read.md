# 番茄作品目录读取修复

「素素」账号在 20:23:16 的日志记录 `FANQIE_CATALOG_ROW_UNVERIFIED`。错误发生在上传查重阶段，账号目录下没有本批上传或合同记录。旧日志把作品 ID 格式和状态识别归到同一错误码，无法确认这次具体触发的字段。

## 改动与影响

- `src/main/fanqie/catalog.ts` 和 `src/shared/fanqie-catalog.ts` 优先按官网作品单元格内的歌名和 ID 节点读取，适配来源脚本 `FQ.yaml` 所用结构、额外标签、空格和全角数字。ID 仍按字符串保存。完整分页和作品身份校验继续用于查重。
- 有明确歌名和唯一 ID 的历史作品参与查重。遇到新状态时保留官网文案，将状态标为待核对。`src/main/fanqie/authorize-records.ts` 复用同一套作品读取规则，核对待授权记录后才准备合同。
- `src/main/fanqie/upload-broker.ts`、`batch.ts` 和 `plan-publisher.ts` 防止把未知状态记作已确认回执或已完成授权。目录批次仍可核对已知官网 ID。
- `src/main/fanqie/catalog-session.ts` 和 `src/shared/fanqie-downloads.ts` 提供歌名、ID 和状态的对应提示。无法核对歌名或 ID 时记录页码和行号，诊断日志仅记录位置与错误码。

## 验证

- 隔离检出通过 TypeScript 检查、94 项离线回归及 33 项无头浏览器和目录回归。覆盖历史作品含未知状态、附加标签与全角 ID、第二页同名拦截、等待延迟状态、读取新作品回执及合同预览。
- 计划回归有 12 项通过。另有 4 项封面测试报 `DOWNLOAD_ROOT_REQUIRED`，改动前的隔离副本复现相同失败。
- `Start-Rainfall-Browser.ps1 -BuildOnly` 构建成功。使用隔离数据运行 Windows 应用的浏览器桥接，验证原入口的目录预览。真实番茄账号、真实上传和原生窗口尚待验收。

## 生效与回退

通过现有 `Start-Rainfall-Browser.bat` 下次启动时加载修复。如需回退，恢复本轮代码并保留作品库、账号配置及上传回执。诊断位置在账号状态目录的 `diagnostics/fanqie-operation.json`，旧版默认账号沿用数据根内的 `diagnostics/fanqie-operation.json`。
