/** Public allowlist only; never render platform/native exception text or secret values. */
export const credentialFailureMessages = {
  SECURE_STORAGE_UNAVAILABLE: '本机安全存储当前不可用',
  CREDENTIAL_ENCRYPT_FAILED: '新 Key 加密失败，原凭据未替换',
  CREDENTIAL_SAVE_FAILED: '新 Key 写入失败，请检查本机存储权限',
  CREDENTIAL_READ_FAILED: '无法读取已保存的凭据文件',
  CREDENTIAL_DECRYPT_FAILED: '已保存凭据无法解密，请在当前正常客户端检查安全存储',
  CREDENTIAL_DATA_INVALID: '已保存凭据格式无效',
  CREDENTIAL_IDENTITY_MISMATCH: '凭据与当前配置不匹配',
  CREDENTIAL_READBACK_FAILED: '新 Key 未通过加密回读验证',
  CREDENTIAL_NOT_CONFIGURED: '当前配置尚未保存可用 Key',
  PROFILE_NOT_FOUND: '当前 API 配置不存在',
  REVISION_CONFLICT: '配置版本已改变，请刷新后重试',
  WORKSPACE_CHANGED: '工作区已改变，请在当前工作区重试',
  SIMULATION_CREDENTIALS_DISABLED: '模拟工作区不使用真实 Key',
  PROVIDER_NOT_CONFIGURED: '当前渠道配置不支持此操作',
  CONNECTION_CHECK_UNSUPPORTED: '当前渠道尚无受支持的连接测试',
  CONNECTION_CHECK_UNAVAILABLE: '连接测试服务当前不可用',
  CREDENTIAL_REQUEST_REJECTED: '凭据操作未完成，请检查当前配置',
} as const;
export type CredentialFailureCode = keyof typeof credentialFailureMessages;
export function credentialFailureCode(error: unknown): CredentialFailureCode {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return Object.prototype.hasOwnProperty.call(credentialFailureMessages, code) ? code as CredentialFailureCode : 'CREDENTIAL_REQUEST_REJECTED';
}
export function credentialFailureText(error: unknown) {
  const code = credentialFailureCode(error);
  return `${credentialFailureMessages[code]}（${code}）`;
}
