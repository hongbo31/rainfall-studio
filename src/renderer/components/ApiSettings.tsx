import React, { useEffect, useState } from "react";
import { useStudio } from "../context";
import {
  apiProviders,
  canStoreApiCredential,
  type ApiProfile,
  type CredentialStatus,
} from "../../shared/api-profiles";

const statusNames = {
  absent: "未保存 Key",
  stored_unverified: "已保存 · 未验证",
  unavailable: "安全存储不可用",
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
  }, [profile.label]);
  const action = async (kind: "save" | "clear" | "label") => {
    setBusy(true);
    setError("");
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
          <p className="api-help">
            保存后清空输入框。Key 使用 Windows
            安全存储加密，不进入备份；当前不会发起连接检测或生成请求。
          </p>
        </>
      ) : (
        <p className="api-help">
          {simulation
            ? "模拟工作区不读取或保存真实 Key"
            : "接口与模型配置完成后，再开放凭据录入。"}
        </p>
      )}
      {error && (
        <p role="alert" className="api-error">
          {error}
        </p>
      )}
      <div className="api-profile-foot">
        <span>自动执行：关闭</span>
        <span>余额 / 权限：未核验</span>
        <span>配置版本 {profile.revision}</span>
      </div>
    </article>
  );
}

export default function ApiSettings() {
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
          <span className="api-eyebrow">CREATIVE CONNECTIONS</span>
          <h2 id="api-title">API 配置</h2>
          <p>为创作服务准备本机配置，随时掌握接入状态。</p>
        </div>
        <span className="api-status">外部服务尚未联调</span>
      </div>
      <div className="api-service-grid">
        <p className="notice">
          默认文本服务：DeepSeek 官方 API。Key
          在本机设置中填写；保存后为未验证状态，不联网、不启用执行。Codex CLI /
          SDK、Claude Code / SDK 为独立可选项，尚未配置，不读取登录 token
          或借用订阅作为 API。
        </p>
        <div className="api-service-card">
          <span className="api-service-icon">D</span>
          <h3>文本创作</h3>
          <strong>DeepSeek · 官方配置</strong>
          <p>可保存用户 API Key 与模型元数据；真实生成和模型评分尚未启用。</p>
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
      {!profiles.length && (
        <p className="api-empty">
          尚无 API 配置。先添加一个本机配置；准备资料不会触发生成或扣费。
        </p>
      )}
    </section>
  );
}
