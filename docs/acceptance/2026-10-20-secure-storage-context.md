# 安全存储上下文诊断：事实与未决项

未导出、复制、打印或重建密钥；未从聊天读取密钥，未禁用加密或修改安全设置。仅通过既有 Main ApiCredentials/ CredentialVault 接口尝试只读认证，生成、充值及凭据写入口在诊断进程不可用。

## 已确认事实

- 默认工具 Windows 身份为 `DESKTOP-90VCPDC\CodexSandboxOffline`，与原客户端用户不同。这解释了默认沙箱不能代表原用户上下文。
- 主机执行实际身份为 `DESKTOP-90VCPDC\31559`。同一只读 Main 检查仍在 main_authentication_check 阶段返回 SECURE_STORAGE_DECRYPT_FAILED，没有 HTTP 认证结果。
- 无密钥读取的 context-only 检查确认：主机 Electron 为 44.7.2；userData 与 bootstrap 的 `dataRoot/runtime` 一致；encryptionAvailable=true。独立进程 appName=Electron、isPackaged=false，使用开发依赖中的 electron.exe。
- 已安装 preview.5 包的 name 为 rainfall-studio-tme-candidate，productName 为 Rainfall Studio · 独立联调候选，使用已验证桌面指针指向的 RainfallStudioCandidate.exe。数据根以 verified-desktop.json 为准，没有复制凭据或 Local State 来匹配独立进程。
- Windows 用户、目录和版本相同后仍失败，故不能仅归因于沙箱用户差异。独立进程与安装包应用身份不同也只是差异，尚不能将它断言为 Windows DPAPI 失败原因。

Electron 官方文档说明同步 safeStorage 在 Windows 使用 DPAPI；isEncryptionAvailable 在 ready 后为 true，不等于某份旧密文可成功解密：https://www.electronjs.org/docs/latest/api/safe-storage 。因此没有把 encryptionAvailable=true 当作凭据有效证明。

## 保护边界与不确定性

没有直接读取 runtime/Local State 内容或凭据密文，也未恢复、迁移或替换它们。诊断使用了正常 Main 加密上下文，因此独立 Electron 启动可能更新运行时元数据；不能将它称为整棵 runtime 绝对只读。观察到 Local State 的 LastWriteTimeUtc 为 2026-10-20T05:10:11Z，凭据文件 LastWriteTimeUtc 仍为 2026-10-16T11:37:28Z。仅凭时间不能判断内部加密材料是否变化，故停止进一步启动/解密尝试，没有自动回退或重建。

仍未确认：已安装客户端本身能否解密当前凭据、独立进程失败是否由会话/运行时加密上下文或既有数据状态导致。不能因此宣称 API Key 已失效、密文损坏或必须重新保存。

## 为什么没有启动客户端

主机只读进程检查未发现运行中的 RainfallStudio/RainfallStudioCandidate。源码启动会启用 productionFlow/unifiedPublish/providerText 的定时 pump，Core 每秒 tick，并有目录/收件箱处理。未找到受支持的只读/安全启动开关，故不能保证启动客户端只做连接测试，不自动生成/发布或修改生产队列；没有启动它。

## 已核实的最小正常界面操作

当用户已有安全暂停自动化的正常客户端会话时，可在“配置中心 → 模型 API → 音乐生成 → 谱乐 AI · 个人音乐创作”点击 **“检查连接（只读）”**。该控件由 ApiSettings.tsx 调用正常 Main `checkApiConnection`，只读取一页谱乐生成历史，不发起生成。它是判断正常客户端凭据是否可用的下一步，不是要求登录谱乐网页。

若正常客户端也无法解密，再由用户在该卡片的 **“新的 API Key”** 密码输入框自行录入，点击 **“保存 Key”**，随后 **“检查连接（只读）”**。不要在聊天发送 Key。本轮尚未证明必须执行重存，也未创建这种新的持久授权。

## 20 积分执行保障

本机已验证适配器及保留官方 GenerateCustomDto 没有已支持的只读计费估算/服务端预算参数；历史 chirp-v6 成功回执 actualCost=null，未证明固定单次消耗。本地预算和旧 385 上限不能替代供应商扣费保障。没有根据未知接口名试探，也没有用付费请求验证费用。

最近一次浏览器审批涉及公开 OpenAPI 文档的 Page.getFrameTree，只读返回 origin/url/frame 元信息，现已完成。它不是恢复安全存储所必需的步骤，不再追加该方向的 CDP 调用。

当前待解决的是正常客户端凭据可用性和可执行的累计 20 积分约束；并非缺少用户的生成授权。未发出生成 POST，没有新任务或扣费。
