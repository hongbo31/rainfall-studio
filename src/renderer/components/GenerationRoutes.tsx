import React, { useEffect, useState } from "react";
import { useStudio } from "../context";
import { apiProviders, type ApiProfile } from "../../shared/api-profiles";
import type {
  GenerationRouting,
  GenerationRole,
} from "../../shared/generation-config";
export const defaultRoutes: GenerationRouting = {
  text: { source: "default" },
  image: { source: "default" },
  music: { source: "default" },
};
export const generationRoleNames = {
  text: "歌词与提示词",
  image: "封面图片",
  music: "音乐生成",
};
export default function GenerationRoutes({
  value,
  onChange,
  disabled = false,
}: {
  value: GenerationRouting;
  onChange: (
    value: GenerationRouting,
    profiles: ApiProfile[],
    defaults: any,
  ) => void;
  disabled?: boolean;
}) {
  const { call, go } = useStudio(),
    [profiles, setProfiles] = useState<ApiProfile[]>([]),
    [defaults, setDefaults] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([call("apiProfile.list"), call("generationConfig.read")])
      .then(([p, d]) => {
        if (active) {
          setProfiles(p);
          setDefaults(d);
        }
      })
      .catch(() => {
        if (active) setError("配置读取失败，请重新打开。");
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <fieldset aria-label="三类生成路由">
      <legend>生成配置</legend>
      <div className="form-grid">
        {(["text", "image", "music"] as GenerationRole[]).map((role) => {
          const selection = value[role],
            id =
              selection.source === "default"
                ? defaults?.roles[role]
                : selection.profileId,
            p = profiles.find((p) => p.id === id);
          return (
            <label key={role}>
              {generationRoleNames[role]}
              <select
                aria-label={generationRoleNames[role] + "路由"}
                disabled={disabled || !defaults}
                value={
                  selection.source === "default"
                    ? "default"
                    : (selection.profileId ?? "")
                }
                onChange={(e) =>
                  onChange(
                    {
                      ...value,
                      [role]:
                        e.target.value === "default"
                          ? { source: "default" }
                          : { source: "override", profileId: e.target.value },
                    },
                    profiles,
                    defaults,
                  )
                }
              >
                <option value="default">使用默认配置</option>
                {profiles
                  .filter((p) => p.kind === role)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
              <small>
                {p
                  ? `${apiProviders.find((v) => v.id === p.providerId)?.name} · ${p.modelId ?? (role === "image" ? "外部出图后导入" : "模型待配置")} · 配置 v${p.revision}${p.kind === "text" ? " · " + (p.textPricing?.currency ?? "价格未配置") : ""}`
                  : role==='image'?"未配置 · 可导入图片":"尚未配置"}
              </small>
            </label>
          );
        })}
      </div>
      <p className="muted">
        任务创建后使用已保存的配置。
      </p>
      <button
        type="button"
        className="link-button"
        onClick={() => go("accounts")}
      >
        管理三类默认配置 →
      </button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
