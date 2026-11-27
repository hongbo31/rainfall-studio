# 番茄授权页批次核对耗时与失败诊断

## 现象与证据

用户提供的第 84 次左右上传执行记录显示，45 首歌曲已完成第一步上传及授权信息回读。进入授权页后，`authorization:mode`、`authorization:identity-open` 和 `authorization:identity-personal` 每个表单动作前都会重新调用 `session.inspect()`，按标题逐首读取整批目录。日志中每次 `catalog:batch-lookup` 耗时约 19–20 秒；最后一次在 `authorization:platform-open` 之前失败，因此平台下拉框实际上还没有被点击。

最终错误来自只读目录接口核对，不是签约页元素超时。旧 trace 只记录 `FANQIE_CATALOG_LOOKUP_UNVERIFIED`，无法区分响应结构无效、分页结果不一致、ID 不匹配或重复作品状态冲突；这份日志不足以断定本次具体是哪一种。

## 修改

- `src/main/fanqie/authorize-records.ts`：签约列表选择、签约模式、身份和平台面板等仅改变页面草稿的操作不再重复扫描整批目录；仍在打开既有作品、进入合同预览和确认平台同步前重新核对。直接生成合同的路径沿用生成前的目录核对，避免在下一步和生成前重复查询。跳过远程读取时仍调用任务与工作区 guard。
- `src/main/fanqie/catalog-lookup.ts`：只读标题查询遇到未验证响应时，等待 350 毫秒后最多重试一次；仍失败时 trace cause 会记录脱敏诊断类别、查询序号/总数及重试次数。可识别 JSON/Schema 错误、分页总数或条目数变化、重复 ID、ID/标题不匹配和同作品状态冲突。不会记录接口原始响应、账号 ID 或作品标题。

## 影响与验证

签约表单的本地校验和官网确认步骤不变。批量上传 45 首时，签约模式/身份/平台草稿操作前不再各自等待约 20 秒的全批查询；关键预览与同步边界仍有目录核对，单次关键核对仍可能随批次规模耗时。

静态核对了日志顺序和调用边界，`git diff --check` 对本轮两个源码文件未报告空白问题；仓库其他已有改动存在差异检查警告。未运行测试、类型检查、构建或真实官网流程，未进行 Windows 原生验收；当前 `verified-desktop.json` 缺失，客户端未更新。

## 回退与后续

如需回退，仅撤销本记录提到的 `authorize-records.ts` 和 `catalog-lookup.ts` 本轮改动，保留其他工作区修改。下一次运行优先查看 `catalog:batch-lookup` 的 `failure.message` 中 `query-N-of-M` 及诊断类别；若仍失败，可据此针对官网响应分支处理，不需要把原始响应写入日志。
