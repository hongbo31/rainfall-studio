import React, { useState } from "react";
import type { ApiConnectionCheck, ApiProfile } from "../../shared/api-profiles";
import { credentialFailureText } from "../../shared/credential-errors";
import { imageApiProviders, type ImageApiProviderId } from "../../shared/platform-image";
import { useStudio } from "../context";
import { useImageCredential } from "../image-credential";
import CredentialInput from "./CredentialInput";

const connectionMessages: Record<ApiConnectionCheck["state"], string> = {
  connected: "API Key 已通过认证",
  unauthorized: "API Key 认证失败，请核对密钥",
  forbidden: "查询请求被拒绝，请核对 Key 的权限",
  credits_required: "平台返回额度不足，请核对账号额度",
  rate_limited: "查询限流，请稍后重试",
  unavailable: "连接失败，请检查网络后重试",
  invalid_response: "服务响应异常，请稍后重试",
};

export default function ImageCredentialSettings() {
  const { refresh } = useStudio();
  const [providerId, setProviderId] = useState(imageApiProviders[0].id);
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState<"save" | "clear" | "check" | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [connection, setConnection] = useState<ApiConnectionCheck | null>(null);
  const [error, setError] = useState("");
  const credential = useImageCredential(providerId, true);
  const { profile, status } = credential;
  const blocked = !!pending || credential.disabled || credential.checking;
  const configured = !!status?.configured;
  const storageError = credential.error ?? (status?.failureCode ? credentialFailureText(status.failureCode) : "");
  const currentConnection = !replacing && configured && connection?.profileId === profile?.id ? connection : null;
  let feedback = configured ? "已保存 Key" : "未保存 Key";
  if (credential.disabled) feedback = "请在真实本地库管理 API Key";
  else if (pending === "check") feedback = "正在检查连接…";
  else if (pending) feedback = "正在更新 Key…";
  else if (credential.checking) feedback = "正在读取 Key 状态…";
  else if (storageError) feedback = storageError;
  else if (currentConnection) feedback = connectionMessages[currentConnection.state];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (blocked || !secret.trim()) return;
    setSecret("");
    setError("");
    setConnection(null);
    setPending("save");
    try {
      let target: ApiProfile | undefined = profile;
      if (!target) {
        const response = await window.rainfall.call("platformImage.prepareCredential", { providerId });
        if (!response.ok) throw Error(response.error.code);
        target = response.value as ApiProfile;
      }
      const identity = { profileId: target.id, expectedRevision: target.revision };
      const saved = await window.rainfall.writeApiCredential({ ...identity, secret: secret.trim() });
      if (!saved.ok) throw Error(saved.error.code);
      setReplacing(false);
      if (!credential.defaultProfileId && target.modelId) {
        const selected = await window.rainfall.call("platformImage.setDefault", {
          ...identity, providerId, modelId: target.modelId, onlyIfUnset: true,
        }).catch(() => undefined);
        if (!selected?.ok) setError("API Key 已保存，工作流默认模型可在平台管理设置。");
      }
    } catch (error) {
      setError(credentialFailureText(error));
    } finally {
      await refresh().catch(() => undefined);
      credential.reload();
      setPending(null);
    }
  }

  async function clear() {
    if (blocked || !profile || !configured) return;
    setSecret("");
    setError("");
    setConnection(null);
    setPending("clear");
    try {
      const response = await window.rainfall.clearApiCredential({ profileId: profile.id, expectedRevision: profile.revision });
      if (!response.ok) throw Error(response.error.code);
      setReplacing(false);
    } catch (error) {
      setError(credentialFailureText(error));
    } finally {
      credential.reload();
      setPending(null);
    }
  }

  const canCheck = !blocked && !replacing && !!profile && configured && !secret.trim();
  async function check() {
    if (!canCheck || !profile) return;
    setError("");
    setConnection(null);
    setPending("check");
    try {
      const response = await window.rainfall.checkApiConnection({ profileId: profile.id, expectedRevision: profile.revision });
      if (!response.ok) throw Error(response.error.code);
      setConnection(response.value);
    } catch (error) {
      setError(credentialFailureText(error));
    } finally {
      setPending(null);
    }
  }

  return <form className="image-credential-settings" aria-label="封面 API" onSubmit={save}>
    <label>提供商 / 渠道
      <select aria-label="提供商 / 渠道" value={providerId} disabled={!!pending} onChange={event => {
        setProviderId(event.target.value as ImageApiProviderId);
        setSecret("");
        setError("");
        setReplacing(false);
        setConnection(null);
      }}>
        {imageApiProviders.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
      </select>
    </label>
    <CredentialInput key={providerId} label="API Key" value={secret} onChange={setSecret}
      disabled={blocked} configured={configured}
      masked={!replacing && status?.maskedKey ? { value: status.maskedKey, onReplace: () => setReplacing(true) } : undefined} />
    <div className="api-actions">
      <button type="submit" className="primary" disabled={blocked || !secret.trim()}>保存 Key</button>
      <button type="button" disabled={!canCheck} onClick={() => void check()}>检查连接</button>
      <button type="button" disabled={blocked || !configured} onClick={() => void clear()}>清除 Key</button>
      {replacing && status?.maskedKey && <button type="button" disabled={blocked} onClick={() => {
        setSecret("");
        setReplacing(false);
      }}>取消更换</button>}
    </div>
    <p className="muted" role="status">{feedback}</p>
    {error && <p className="api-error" role="alert">{error}</p>}
  </form>;
}
