import React, { useEffect, useState } from "react";
import { useStudio } from "../context";
import HelpHint from "./HelpHint";
import {
  apiProviders,
  canStoreApiCredential,
  type ApiProfile,
  type CredentialStatus,
  type ApiConnectionCheck,
} from "../../shared/api-profiles";

const statusNames = {
  absent: "未保存 Key",
  stored_unverified: "已保存 · 未验证",
  unavailable: "安全存储不可用",
};
const connectionNames: Record<ApiConnectionCheck["state"], string> = {
  connected: "认证连接成功 · 生成权限与费用未核验",
  unauthorized: "认证失败 · 请核对 Key",
  forbidden: "请求被拒绝 · 权限未核验",
  credits_required: "平台返回额度不足 · 未创建任务",
  rate_limited: "平台限流 · 未自动重试",
  unavailable: "未能完成连接 · 请稍后手动重试",
  invalid_response: "响应不符合已核验合同 · 连接状态未知",
};

function ProfileCard({
  profile,
  refresh,
  simulation,
}: {
  profile: ApiProfile;
  refresh: () => Promise<void>;
  simulation: boolean;
}) {
  const [label, setLabel] = useState(profile.label);
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<ApiConnectionCheck | null>(null);
  const { call } = useStudio();
  const provider = apiProviders.find((p) => p.id === profile.providerId)!;
  const eligible = canStoreApiCredential(profile);
  useEffect(() => {
    let active = true;
    void window.rainfall
      .apiCredentialStatus({ profileId: profile.id })
      .then((r) => {
        if (active) {
          if (r.ok) setStatus(r.value);
          else setError("无法读取凭据状态，请稍后重试。");
        }
      })
      .catch(() => {
        if (active) setError("无法读取凭据状态，请稍后重试。");
      });
    return () => {
      active = false;
    };
  }, [profile.id, profile.revision, simulation]);
  useEffect(() => {
    setLabel(profile.label);
    setConnection(null);
  }, [profile.id, profile.label, profile.revision, simulation]);
  const action = async (kind: "save" | "clear" | "label") => {
    setBusy(true);
    setError("");
    setConnection(null);
    try {
      if (kind === "label") {
        const { revision, ...metadata } = profile;
        await call("apiProfile.save", {
          profile: { ...metadata, label },
          expectedRevision: revision,
        });
        await refresh();
      } else {
        const identity = {
          profileId: profile.id,
          expectedRevision: profile.revision,
        };
        const inputSecret = secret;
        setSecret("");
        const result =
          kind === "save"
            ? await window.rainfall.writeApiCredential({
                ...identity,
                secret: inputSecret,
              })
            : await window.rainfall.clearApiCredential(identity);
        if (!result.ok) throw Error(result.error.code);
        setStatus(result.value);
      }
    } catch {
      setError("操作未完成，请检查配置版本与安全存储后重试。");
    } finally {
      setBusy(false);
    }
  };
  const checkConnection = async () => {
    setBusy(true);
    setError("");
    setConnection(null);
    try {
      const r = await window.rainfall.checkApiConnection({
        profileId: profile.id,
        expectedRevision: profile.revision,
      });
      if (!r.ok) throw Error("CONNECTION_CHECK_FAILED");
      setConnection(r.value);
    } catch {
      setError("连接检查未完成，请检查配置版本与本机网络。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <article
      className="api-profile"
      data-testid="api-profile-card"
      data-profile-id={profile.id}
      aria-label={profile.label}
    >
      <div className="api-profile-heading">
        <div>
          <span className="api-eyebrow">{provider.name} / 本机配置</span>
          <h3>{profile.label}</h3>
        </div>
        <span
          className={
            "api-status " +
            (status?.state === "stored_unverified" ? "stored" : "")
          }
        >
          {simulation
            ? "模拟工作区 · Key 已禁用"
            : status
              ? statusNames[status.state]
              : "正在读取状态…"}
        </span>
      </div>
      <div className="api-profile-fields">
        <label>
          配置显示名称
          <input
            aria-label="配置显示名称"
            value={label}
            maxLength={100}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button
          disabled={busy || !label.trim() || label.trim() === profile.label}
          onClick={() => void action("label")}
        >
          保存配置名称
        </button>
      </div>
      {eligible && !simulation ? (
        <>
          <div className="api-profile-fields api-secret-row">
            <label>
              新的 API Key
              <input
                aria-label="新的 API Key"
                type="password"
                value={secret}
                disabled={busy}
                autoComplete="new-password"
                spellCheck={false}
                autoCapitalize="none"
                maxLength={100000}
                placeholder={
                  status?.configured
                    ? "输入新 Key 以替换；已有内容不回显"
                    : "仅在本机加密保存"
                }
                onChange={(e) => setSecret(e.target.value)}
              />
            </label>
            <div className="api-actions">
              <button
                className="primary"
                disabled={busy || !secret}
                onClick={() => void action("save")}
              >
                {busy ? "处理中…" : "保存 Key"}
              </button>
              <button
                disabled={busy || !status?.configured}
                onClick={() => void action("clear")}
              >
                清除 Key
              </button>
            </div>
          </div>
          <HelpHint label="凭据存储说明">
            保存后清空输入框。Key 使用 Windows 安全存储加密，不进入备份。保存
            Key 不会联网或创建音乐任务。
          </HelpHint>
          {["yourmusic", "deepseek"].includes(profile.providerId) && (
            <div className="api-connection-check">
              <button
                disabled={busy || !status?.configured}
                onClick={() => void checkConnection()}
              >
                检查连接（只读）
              </button>
              <HelpHint label="连接检查说明">
                {profile.providerId === "deepseek"
                  ? "仅查询官方模型列表，不发送歌词或发起生成。"
                  : "仅查询一页生成历史并丢弃作品内容。官方说明查询不扣积分；不会启用生成或自动重试。"}
              </HelpHint>
              {connection && (
                <p role="status" data-testid="api-connection-result">
                  {connectionNames[connection.state]} · HTTP{" "}
                  {connection.httpStatus ?? "未知"}
                  <br />
                  {connection.failureCode && (
                    <>
                      原因：{connection.failureCode}
                      <br />
                    </>
                  )}
                  检查时间：{connection.checkedAt} · 来源：
                  {connection.providerId === "deepseek"
                    ? "DeepSeek 官方模型列表"
                    : "谱乐 API 历史查询"}
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <HelpHint label="凭据录入说明">
          {simulation
            ? "模拟工作区不读取或保存真实 Key"
            : "接口与模型配置完成后，再开放凭据录入。"}
        </HelpHint>
      )}
      {error && (
        <p role="alert" className="api-error">
          {error}
        </p>
      )}
      <div className="api-profile-foot">
        <span>自动执行：关闭</span>
        <span>余额 / 权限：未核验</span>
        <HelpHint label="配置版本说明">配置版本 {profile.revision}</HelpHint>
      </div>
    </article>
  );
}

export default function ApiSettings({
  compact = false,
}: { compact?: boolean } = {}) {
  const { runtime } = useStudio();
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [providerId, setProviderId] = useState("deepseek");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const simulation = runtime.mode === "simulation";
  const refresh = async () => {
    const r = await window.rainfall.call("apiProfile.list");
    if (!r.ok) throw Error("PROFILE_LIST_FAILED");
    setProfiles(r.value);
  };
  useEffect(() => {
    void refresh().catch(() => setError("无法加载配置，请重新打开账号设置。"));
  }, [runtime.mode]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const provider = apiProviders.find((p) => p.id === providerId)!;
    try {
      const r = await window.rainfall.call("apiProfile.save", {
        profile: {
          id: crypto.randomUUID(),
          kind: provider.kind,
          providerId,
          label: label.trim(),
          modelId: null,
          executionEnabled: false,
        },
        expectedRevision: null,
      });
      if (!r.ok) throw Error("PROFILE_SAVE_FAILED");
      setLabel("");
      await refresh();
    } catch {
      setError("配置未保存，请检查名称后重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel api-settings" aria-labelledby="api-title">
      <div className="section-title">
        <div>
          <h2 id="api-title">API 配置</h2>
        </div>
        <span className="api-status">外部服务尚未联调</span>
      </div>
      <details className="api-service-help">
        <summary>服务说明</summary>
        <div className="api-service-grid">
          <p className="notice">
            Key 保存在本机；保存配置不调用模型。实际调用需另行确认预算。
          </p>
          <div className="api-service-card">
            <span className="api-service-icon">D</span>
            <h3>文本创作</h3>
            <strong>DeepSeek · 官方配置</strong>
            <p>
              模型列表 · 文本调用 · 逐轮预算
            </p>
          </div>
          <div className="api-service-card">
            <span className="api-service-icon">♫</span>
            <h3>音乐生成</h3>
            <strong>谱乐 · 可准备本机 Key</strong>
            <p>
              Suno · API 合同待核验
              <br />
              <span>妙响 · API 接入待确认</span>
            </p>
          </div>
        </div>
      </details>
      <form className="api-create" onSubmit={(e) => void create(e)}>
        <label>
          API 平台
          <select
            aria-label="API 平台"
            disabled={busy}
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          >
            {apiProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {!p.credentialInput ? "（待配置 / 核验）" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          配置名称
          <input
            aria-label="配置名称"
            value={label}
            disabled={busy}
            maxLength={100}
            placeholder="例如：个人音乐创作"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={busy || !label.trim()}
          type="submit"
        >
          创建 API 配置
        </button>
      </form>
      {simulation && <p className="notice">模拟工作区不读取或保存真实 Key</p>}
      {error && (
        <p role="alert" className="api-error">
          {error}
        </p>
      )}
      <div className="api-profiles">
        {profiles.map((p) => (
          <ProfileCard
            key={p.id}
            profile={p}
            refresh={refresh}
            simulation={simulation}
          />
        ))}
      </div>
      {!profiles.length && <p className="api-empty">尚无 API 配置</p>}
    </section>
  );
}
