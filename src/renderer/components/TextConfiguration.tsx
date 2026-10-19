import React, { useEffect, useState } from "react";
import { useStudio } from "../context";
import { apiProviders } from "../../shared/api-profiles";
import HelpNote from "./HelpNote";
export default function TextConfiguration() {
  const { call, notify } = useStudio();
  const [profiles, setProfiles] = useState<any[]>([]),
    [configs, setConfigs] = useState<any[]>([]);
  const [profileId, setProfile] = useState(""),
    [modelId, setModel] = useState("");
  const [limit, setLimit] = useState(""),
    [tokens, setTokens] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void Promise.all([call("apiProfile.list"), call("textConfig.list")])
      .then(([p, c]) => {
        setProfiles(p.filter((v: any) => v.kind === "text"));
        setConfigs(c);
      })
      .catch(() => setError("无法读取配置，请重新打开页面。"));
  }, []);
  const profile = profiles.find((p) => p.id === profileId);
  const provider = apiProviders.find((p) => p.id === profile?.providerId);
  const readyConfig =
    profile &&
    ["deepseek", "codex_cli", "claude_code"].includes(profile.providerId);
  const choose = (id: string) => {
    setProfile(id);
    const c = configs.find((c) => c.profileId === id);
    setModel(c?.modelId ?? "");
    setLimit(c?.maxInputCharacters?.toString() ?? "");
    setTokens(c?.maxOutputTokens?.toString() ?? "");
  };
  return (
    <details className="panel">
      <summary>文本服务配置</summary>
      <HelpNote label="文本配置说明">
        先在账号设置创建 DeepSeek 配置并自行填写 API
        Key。这里保存模型及输入输出上限；保存不验证、不发起调用。具体模型、价格和调用预算待确认。
      </HelpNote>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const previous = configs.find((c) => c.profileId === profileId);
            const config = {
              profileId,
              revision: (previous?.revision ?? 0) + 1,
              adapterId: profile.providerId,
              endpoint:
                profile.providerId === "deepseek"
                  ? "https://api.deepseek.com"
                  : null,
              modelId: modelId.trim() || null,
              maxInputCharacters: limit ? Number(limit) : null,
              maxOutputTokens: tokens ? Number(tokens) : null,
              evidence: null,
              executionEnabled: false,
            };
            const saved = await call("textConfig.save", {
              config,
              expectedRevision: previous?.revision ?? 0,
            });
            setConfigs([
              ...configs.filter((c) => c.profileId !== profileId),
              saved,
            ]);
            notify("已保存未验证配置；真实调用保持关闭");
          } catch {
            setError(
              "保存未完成，请检查字段和配置版本。Key 仅在账号设置填写。",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          文本配置
          <select
            required
            value={profileId}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">请选择</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <p>{profile ? "配置未验证" : "未选择配置"}</p>
        {profile?.providerId === "deepseek" ? (
          <label>
            官方服务地址
            <input readOnly value="https://api.deepseek.com" />
          </label>
        ) : (
          profile&&<p>CLI 适配器未接入</p>
        )}
        <label>
          模型 ID
          <input
            value={modelId}
            maxLength={200}
            placeholder="待用户选择，不推定账号权限"
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            输入字符上限
            <input
              type="number"
              min="1"
              max="200000"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </label>
          <label>
            输出 token 上限
            <input
              type="number"
              min="1"
              max="100000"
              value={tokens}
              onChange={(e) => setTokens(e.target.value)}
            />
          </label>
        </div>
        <button disabled={!readyConfig || busy}>保存未验证配置</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
