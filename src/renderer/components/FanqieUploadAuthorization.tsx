import React, { useEffect, useState } from "react";
import type { FanqieAuthorizationPreference } from "../../shared/fanqie";
import { defaultFanqieDirectoryPreferences, fanqieDirectoryPreferencesSchema, fanqieDownloadBatchLimit,
  type FanqieDirectoryPreferences } from "../../shared/fanqie-downloads";
import { fanqieScope } from "../fanqie-accounts";

const blank = { lyricist: "", composer: "", singer: "" };
type Authors = typeof blank;
type SavedConfiguration = {
  authors: Authors;
  artistAuthors?: Record<string, Authors>;
  authorizationPreference?: FanqieAuthorizationPreference;
  directoryPreferences?: FanqieDirectoryPreferences;
  publicationConsent: boolean;
};

const defaultPreference: FanqieAuthorizationPreference = {
  mode: "exclusive",
  platforms: ["fanqie_music", "fanqie_audio"],
  confirmContractManually: true,
};

export default function FanqieUploadAuthorization({ accountId, artistCredits }: { accountId: string; artistCredits?: Authors }) {
  const [configuration, setConfiguration] = useState<SavedConfiguration | null>();
  const [authors, setAuthors] = useState<Authors>(blank);
  const [preference, setPreference] = useState(defaultPreference);
  const [limit, setLimit] = useState(String(defaultFanqieDirectoryPreferences.limit));
  const [signContract, setSignContract] = useState(defaultFanqieDirectoryPreferences.signContract);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void window.rainfall.fanqieUpload("configuration", fanqieScope(accountId)).then(result => {
      if (!active) return;
      if (!result.ok) throw Error(result.error.message);
      const saved: SavedConfiguration | null = result.value.configuration;
      setConfiguration(saved);
      const { lyricist, composer, singer } = saved?.authors ?? artistCredits ?? result.value.suggestedAuthors ?? blank;
      setAuthors({ lyricist, composer, singer });
      setPreference(saved?.authorizationPreference ?? defaultPreference);
      setLimit(String(saved?.directoryPreferences?.limit ?? defaultFanqieDirectoryPreferences.limit));
      setSignContract(saved?.directoryPreferences?.signContract ?? defaultFanqieDirectoryPreferences.signContract);
      setConsent(!!saved?.publicationConsent);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : "无法读取番茄上传授权。");
    });
    return () => { active = false; };
  }, [accountId, artistCredits?.lyricist, artistCredits?.composer, artistCredits?.singer]);

  const directory = fanqieDirectoryPreferencesSchema.safeParse({ limit: Number(limit), signContract });
  const canSave = configuration !== undefined && directory.success && consent && Object.values(authors).every(value => value.trim());
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !canSave || !directory.success) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const result = await window.rainfall.fanqieUpload("saveConfiguration", {
        ...fanqieScope(accountId),
        version: 1,
        authors,
        ...(configuration?.artistAuthors ? { artistAuthors: configuration.artistAuthors } : {}),
        useWorkMaterials: true,
        publicationConsent: true,
        authorizationPreference: preference,
        directoryPreferences: directory.data,
      });
      if (!result.ok) throw Error(result.error.message);
      setConfiguration(result.value.configuration);
      setStatus("已保存上传授权");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存未完成");
    } finally {
      setBusy(false);
    }
  };

  return <form onSubmit={event => void save(event)}>
    <fieldset disabled={busy || configuration === undefined}>
      <div className="form-grid">
        {([ ["lyricist", "备用词作者"], ["composer", "备用曲作者"], ["singer", "备用歌手"] ] as const).map(([key, label]) =>
          <label key={key}>{label}<input required maxLength={40} value={authors[key]}
            onChange={event => setAuthors({ ...authors, [key]: event.target.value })} /></label>)}
        <label>账号签约偏好<select value={preference.mode} onChange={event =>
          setPreference({ ...preference, mode: event.target.value === "exclusive" ? "exclusive" : "nonexclusive" })}>
          <option value="exclusive">独家签约</option><option value="nonexclusive">非独家签约</option>
        </select></label>
        <label>目录上传每批上限<input type="number" required min={1} max={fanqieDownloadBatchLimit} step={1}
          value={limit} onChange={event => setLimit(event.target.value)} /></label>
        <label>目录上传默认签约<select value={String(signContract)} onChange={event => setSignContract(event.target.value === "true")}>
          <option value="true">是，签署后继续</option><option value="false">否，合同生成后继续</option>
        </select></label>
      </div>
      <label className="inline-check"><input type="checkbox" checked={preference.platforms.includes("fanqie_audio")}
        onChange={event => setPreference({ ...preference, platforms: event.target.checked ? ["fanqie_music", "fanqie_audio"] : ["fanqie_music"] })} />同时发布到番茄畅听</label>
      <label className="inline-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />允许上传已核对且有权发布的作品。合同由本人确认。</label>
      <button type="submit" disabled={busy || !canSave}>{busy ? "保存中…" : "保存上传授权"}</button>
    </fieldset>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
