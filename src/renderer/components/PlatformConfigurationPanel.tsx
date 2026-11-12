import React, { useRef, useState } from "react";
import { useStudio, names } from "../context";
import ChoiceButtons from "./ChoiceButtons";
import HelpHint from "./HelpHint";
import type {
  PlatformTarget,
  PlatformConfiguration,
  PlatformConfigurationInput,
} from "../../shared/platform-config";

export default function PlatformConfigurationPanel({
  target,
}: {
  target: PlatformTarget;
}) {
  const { data, call, notify } = useStudio();
  const saved: PlatformConfiguration | undefined = (
    data.platformConfigurations ?? []
  ).find((item: PlatformConfiguration) => item.target === target);
  const initial: PlatformConfigurationInput = {
    target,
    accountId: saved?.accountId ?? null,
    artistId: saved?.artistId ?? null,
    lyricist: saved?.lyricist ?? "",
    composer: saved?.composer ?? "",
    album: saved?.album ?? "",
    language: saved?.language ?? "",
    genre: saved?.genre ?? "",
    aiDisclosure: saved?.aiDisclosure ?? "unknown",
    isCover: saved?.isCover ?? null,
  };
  const [draft, setDraft] = useState(initial),
    [revision, setRevision] = useState(saved?.revision ?? 0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const saving = useRef(false);
  const edit = (patch: Partial<PlatformConfigurationInput>) => {
    setDraft({ ...draft, ...patch });
    setError("");
    setStatus("");
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result: PlatformConfiguration = await call("platformConfig.save", {
        config: draft,
        expectedRevision: revision,
      });
      setRevision(result.revision);
      setStatus("已保存配置");
      notify("已保存" + names[target] + "配置");
    } catch (e: any) {
      setError(e.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      className="panel platform-configuration"
      aria-label={names[target] + "配置"}
    >
      <div className="section-title">
        <h2>{names[target]}配置</h2>
        <HelpHint label="平台说明">
          发布时自动带入此处保存的默认资料。
        </HelpHint>
      </div>
      <form onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy} className="platform-fields">
          <div className="form-grid">
            <div>
              <span>默认艺人</span>
              <ChoiceButtons label="默认艺人" value={draft.artistId ?? ""} onChange={value => edit({ artistId: value || null })}
                choices={[
                  { value: "", label: "用作品艺人" },
                  ...data.artists.map((artist: any) => ({ value: artist.id, label: artist.name })),
                ]}/>
            </div>
            {(
              [
                ["lyricist", "词作者", 500],
                ["composer", "曲作者", 500],
                ["album", "常用专辑", 500],
                ["language", "语言", 100],
                ["genre", "曲风", 200],
              ] as const
            ).map(([key, title, max]) => (
              <label key={key}>
                {title}
                <input
                  aria-label={title}
                  value={draft[key]}
                  maxLength={max}
                  onChange={(event) => edit({ [key]: event.target.value })}
                />
              </label>
            ))}
            <label>
              AI 标注
              <select
                aria-label="AI 标注"
                value={draft.aiDisclosure}
                onChange={(event) =>
                  edit({
                    aiDisclosure: event.target
                      .value as PlatformConfigurationInput["aiDisclosure"],
                  })
                }
              >
                <option value="unknown">未设置</option>
                <option value="none">未使用 AI</option>
                <option value="assisted">AI 辅助</option>
                <option value="generated">AI 生成</option>
              </select>
            </label>
            <label>
              翻唱偏好
              <select
                aria-label="翻唱偏好"
                value={
                  draft.isCover === null ? "unknown" : String(draft.isCover)
                }
                onChange={(event) =>
                  edit({
                    isCover:
                      event.target.value === "unknown"
                        ? null
                        : event.target.value === "true",
                  })
                }
              >
                <option value="unknown">未设置</option>
                <option value="false">原创</option>
                <option value="true">翻唱</option>
              </select>
            </label>
          </div>
        </fieldset>
        <div className="button-row">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "保存中…" : "保存配置"}
          </button>
          {status && <span role="status">{status}</span>}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
