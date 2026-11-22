import React, { useEffect, useId, useRef, useState } from "react";
import { imageApiModels, manualCoverPrices, paidCoverModelId } from "../../shared/api-profiles";
import {
  artistSongType, baseArtistDefaults, type ArtistMusicType, type ArtistProfile, type ArtistSongAttribute,
  type SecondSinger, type SongType,
} from "../../shared/local-artist";
import { COVER_RESOLUTION_MIN, COVER_RESOLUTION_MAX, coverResolutionInputSchema } from "../../shared/cover-handoff";
import { fanqieArtistAvatarVoice, type FanqieArtistCreationResult } from "../../shared/fanqie-artist";
import type { AccountProvider, PlatformAccount } from "../../shared/platform-accounts";
import { imageApiProviders, platformImageFailure, type ImageSelection } from "../../shared/platform-image";
import type { ArtistDefaults } from "../../shared/schemas";
import { useStudio } from "../context";
import { useImageCredential } from "../image-credential";
import ArtistProfileFields, { ArtistPromptSelect, formatCoverResolution, profileDraft, readProfile } from "./ArtistProfileFields";

export type LocalArtist = {
  id: string;
  name: string;
  revision: number;
  accountId?: string;
  defaults?: ArtistDefaults;
  musicType?: ArtistMusicType;
  songAttribute?: ArtistSongAttribute;
  originalSinger?: string | null;
  originalWorkId?: string | null;
  isAiWork?: boolean;
  hasCopyrightProof?: boolean;
  profile?: ArtistProfile;
  secondSinger?: SecondSinger;
  promptTemplateId?: string | null;
};

const fanqieCoverResolution = 1440;
const avatarModelGroups = imageApiProviders.map(provider => ({ ...provider, models: imageApiModels(provider.id) }));

type Editor = "new" | "link" | LocalArtist;

function FanqieArtistCreationDialog({ artist, accountName, onCancel, onConfirm }: {
  artist: LocalArtist; accountName: string; onCancel: () => void; onConfirm: (image: ImageSelection) => void;
}) {
  const titleId = useId();
  const [modelId, setModelId] = useState("");
  const provider = avatarModelGroups.find(group => group.models.some(model => model.id === modelId));
  const { profile, status, checking, error, disabled } = useImageCredential(provider?.id);
  const avatarVoice = fanqieArtistAvatarVoice(artist);
  const image = provider && profile && status?.configured && !disabled
    ? { profileId: profile.id, expectedRevision: profile.revision, providerId: provider.id, modelId } : undefined;
  const price = paidCoverModelId(modelId);

  return <div className="plan-modal-backdrop">
    <section className="plan-confirm" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => { if (event.key === "Escape") onCancel(); }}>
      <h2 id={titleId}>番茄艺人创建</h2>
      <p>{accountName}</p>
      <p>A 版 · {artist.profile?.singer || "未填写歌手"}</p>
      {artist.secondSinger && <p>B 版 · {artist.secondSinger.name}</p>}
      <p>{avatarVoice ? <>头像类型 · <strong>{avatarVoice === "male" ? "男性头像" : "女性头像"}</strong></>
        : "请在艺人信息里设置男或女，以匹配头像。"}</p>
      <label>图像模型
        <select aria-label="图像模型" value={modelId} onChange={event => setModelId(event.target.value)}>
          <option value="">选择图像模型</option>
          {avatarModelGroups.map(group => <optgroup key={group.id} label={group.name}>
            {group.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
          </optgroup>)}
        </select>
      </label>
      {provider && !image && <p className="muted" role="status">{disabled ? "请在真实本地库创建艺人。"
        : checking ? "正在读取 API Key 状态…"
        : error ?? (status?.failureCode ? platformImageFailure(status.failureCode).message
          : "请在配置中心保存该提供商的 API Key。")}</p>}
      <p className="muted">
        {price ? `缺失艺人的头像生成费用 ${manualCoverPrices[price]}。`
          : provider?.id === "openai_image" ? "缺失艺人的头像生成使用 OpenAI API 额度。" : "缺失艺人的头像按所选模型计费。"}
        番茄艺人资料提交后无法修改。
      </p>
      <div className="plan-editor-footer">
        <button type="button" autoFocus onClick={onCancel}>取消</button>
        <button type="button" className="primary" disabled={!artist.profile?.singer || !avatarVoice || !image}
          onClick={() => { if (avatarVoice && image) onConfirm(image); }}>确认创建</button>
      </div>
    </section>
  </div>;
}

export default function LocalArtistCreator({ account, artists, unassigned }: {
  account: PlatformAccount; artists: LocalArtist[]; unassigned: LocalArtist[];
}) {
  const { data, call, notify } = useStudio();
  const drawerId = useId();
  const drawer = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const copyRequest = useRef<{ id: string; revision: number; requestId: string } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LocalArtist | null>(null);
  const [creationTarget, setCreationTarget] = useState<LocalArtist | null>(null);
  const [creating, setCreating] = useState(false);
  const [creationResult, setCreationResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editingId = typeof editor === "object" ? editor?.id : undefined;
  const pendingDelete = artists.some(artist => artist.id === deleteTarget?.id) ? deleteTarget : null;
  const listLocked = !!editor || !!pendingDelete || !!creationTarget || busy;

  useEffect(() => {
    if (editor) drawer.current?.querySelector("button")?.focus({ preventScroll: true });
    else {
      opener.current?.focus({ preventScroll: true });
      opener.current = null;
    }
  }, [editor]);

  const openEditor = (next: Editor, trigger: HTMLButtonElement) => {
    opener.current = trigger;
    setError("");
    setEditor(next);
  };

  const mutate = async (action: () => Promise<void>, fallback: string, reportError = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setCreationResult("");
    try {
      await action();
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      setError(code === "REVISION_CONFLICT" ? "艺人资料已有更新，请核对后重试。"
        : code === "ARTIST_ACCOUNT_MISMATCH" ? "该艺人已关联其他账号。"
        : reportError && error instanceof Error ? error.message : fallback);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const copy = (artist: LocalArtist) => mutate(async () => {
    if (copyRequest.current?.id !== artist.id || copyRequest.current.revision !== artist.revision) {
      copyRequest.current = { id: artist.id, revision: artist.revision, requestId: crypto.randomUUID() };
    }
    const saved = await call("accountLocalArtist.copy", {
      id: artist.id, expected: artist.revision, accountId: account.id, requestId: copyRequest.current.requestId,
    });
    copyRequest.current = null;
    notify("已复制 " + saved.name);
  }, "复制艺人失败，请重试。");

  const createOnFanqie = async (artist: LocalArtist, avatarImage: ImageSelection) => {
    setCreationTarget(null);
    setCreating(true);
    try {
      await mutate(async () => {
        const result: FanqieArtistCreationResult = await call("fanqie.artistCreate", {
          accountId: account.id, artistId: artist.id, expectedRevision: artist.revision, confirmed: true, avatarImage,
        });
        setCreationResult(result.artists.map(row => row.version + " 版" +
          (row.status === "created" ? "已创建" : "已存在")).join(" · "));
      }, "番茄艺人创建未完成，请查看专属窗口。", true);
    } finally {
      setCreating(false);
    }
  };

  const assign = (artist: LocalArtist) => mutate(async () => {
    await call("accountLocalArtist.assign", { id: artist.id, expected: artist.revision, accountId: account.id });
    setEditor(null);
    notify("已关联 " + artist.name);
  }, "关联艺人失败，请重试。");

  const remove = async (artist: LocalArtist) => {
    await mutate(async () => {
      await call("accountLocalArtist.delete", { id: artist.id, expected: artist.revision, confirmed: true });
      notify("已删除 " + artist.name);
    }, "删除艺人失败，请重试。");
    setDeleteTarget(null);
  };

  return (
    <>
    <section className="panel local-artist-creator" aria-label="艺人信息">
      <div className="section-title">
        <h2>艺人信息</h2>
        <div className="account-actions">
          {!!unassigned.length && <button type="button" disabled={listLocked}
            aria-expanded={editor === "link"} aria-controls={editor === "link" ? drawerId : undefined}
            onClick={event => openEditor("link", event.currentTarget)}>关联已有艺人</button>}
          <button type="button" disabled={listLocked}
            aria-expanded={editor === "new"} aria-controls={editor === "new" ? drawerId : undefined}
            onClick={event => openEditor("new", event.currentTarget)}>＋ 新增艺人</button>
        </div>
      </div>
      {editor !== "link" && error && <p role="alert">{error}</p>}
      {(creating || creationResult) && <p role="status">{creating ? "正在查重并创建番茄艺人…" : creationResult}</p>}
      {artists.length ? (
        <ul className="local-artist-list">
          {artists.map(artist => (
            <li className="row" key={artist.id}>
              <div>
                <strong>{artist.name}</strong>
                {artist.secondSinger && <small>A 版 {artist.profile?.singer} · B 版 {artist.secondSinger.name}</small>}
              </div>
              {pendingDelete?.id === artist.id ? (
                <div className="button-row" role="group" aria-label={`删除 ${artist.name}`}>
                  <span>确认删除？</span>
                  <button type="button" disabled={busy} onClick={() => void remove(pendingDelete)}>确认删除</button>
                  <button type="button" disabled={busy} onClick={() => setDeleteTarget(null)}>取消</button>
                </div>
              ) : (
                <div className="button-row">
                  <button type="button" disabled={listLocked} aria-label={`复制 ${artist.name}`} onClick={() => void copy(artist)}>复制</button>
                  {account.provider === "fanqie" && <button type="button" disabled={listLocked || data.mode !== "production"}
                    aria-label={`艺人创建 ${artist.name}`} onClick={() => {
                      setError("");
                      setCreationResult("");
                      setCreationTarget(artist);
                    }}>艺人创建</button>}
                  <button type="button" disabled={listLocked} aria-label={`编辑 ${artist.name}`}
                    aria-expanded={editingId === artist.id} aria-controls={editingId === artist.id ? drawerId : undefined}
                    onClick={event => openEditor(artist, event.currentTarget)}>编辑</button>
                  <button type="button" disabled={listLocked} aria-label={`删除 ${artist.name}`} onClick={() => { setError(""); setDeleteTarget(artist); }}>删除</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="muted">此账号暂无艺人</p>}
    </section>
    {creationTarget && <FanqieArtistCreationDialog artist={creationTarget} accountName={account.name}
      onCancel={() => setCreationTarget(null)} onConfirm={image => void createOnFanqie(creationTarget, image)} />}
    {editor && <section className="artist-editor-drawer" id={drawerId} ref={drawer} tabIndex={-1} aria-label="艺人编辑">
      {editor === "link" ? (
        <div onKeyDown={event => {
          if (event.key === "Escape" && !inFlight.current) setEditor(null);
        }}>
          <div className="artist-editor-heading">
            <h3>关联已有艺人 · {account.name}</h3>
            <button type="button" disabled={busy} onClick={() => setEditor(null)}>关闭</button>
          </div>
          <ul className="local-artist-list">
            {unassigned.map(artist => <li className="row" key={artist.id}>
              <strong>{artist.name}</strong>
              <button type="button" aria-label={`关联 ${artist.name}`} disabled={busy} onClick={() => void assign(artist)}>关联</button>
            </li>)}
          </ul>
          {error && <p role="alert">{error}</p>}
        </div>
      ) : (
        <LocalArtistForm provider={account.provider} accountId={account.id} accountName={account.name}
          artist={editor === "new" ? undefined : editor} previous={editor === "new" ? artists.at(-1) : undefined}
          onClose={() => setEditor(null)} />
      )}
    </section>}
    </>
  );
}

export function LocalArtistForm({ provider, accountId, accountName, artist, previous, onClose }: {
  provider: AccountProvider; accountId?: string; accountName?: string; artist?: LocalArtist; previous?: LocalArtist; onClose: () => void;
}) {
  const { call, notify } = useStudio();
  const inFlight = useRef(false);
  const [defaults, setDefaults] = useState<ArtistDefaults>(() => ({ ...baseArtistDefaults, genre: "", ...artist?.defaults }));
  const [coverResolutionText, setCoverResolutionText] = useState(() => formatCoverResolution(
    artist ? artist.defaults?.coverResolution : provider === "fanqie" ? fanqieCoverResolution : undefined,
  ));
  const [songType, setSongType] = useState(() => artistSongType(artist?.defaults));
  const [musicType, setMusicType] = useState<ArtistMusicType>(artist?.musicType ?? "original");
  const [songAttribute, setSongAttribute] = useState<ArtistSongAttribute | "">(artist?.songAttribute ?? "");
  const [originalSinger, setOriginalSinger] = useState(artist?.originalSinger ?? "");
  const [originalWorkId, setOriginalWorkId] = useState(artist?.originalWorkId ?? "");
  const [isAiWork, setIsAiWork] = useState(artist?.isAiWork);
  const [hasCopyrightProof, setHasCopyrightProof] = useState(artist?.hasCopyrightProof);
  const [profile, setProfile] = useState(() => profileDraft(artist?.profile, artist?.secondSinger));
  const [promptTemplateId, setPromptTemplateId] = useState(artist?.promptTemplateId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const copyPrevious = () => {
    if (!previous) return;
    setDefaults({ ...baseArtistDefaults, genre: "", ...previous.defaults });
    setCoverResolutionText(formatCoverResolution(previous.defaults?.coverResolution));
    setSongType(artistSongType(previous.defaults));
    setMusicType(previous.musicType ?? "original");
    setSongAttribute(previous.songAttribute ?? "");
    setOriginalSinger(previous.originalSinger ?? "");
    setOriginalWorkId(previous.originalWorkId ?? "");
    setIsAiWork(previous.isAiWork);
    setHasCopyrightProof(previous.hasCopyrightProof);
    setProfile(profileDraft(previous.profile, previous.secondSinger));
    setPromptTemplateId(previous.promptTemplateId ?? "");
    setError("");
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = readProfile(profile);
    if (!parsed.success) {
      setError("请填写词作者、曲作者、所配置的歌手和签约模式。");
      return;
    }
    const coverResolution = coverResolutionInputSchema.safeParse(coverResolutionText);
    if (!coverResolution.success) {
      setError(`请输入方形封面的分辨率，边长须为 ${COVER_RESOLUTION_MIN}–${COVER_RESOLUTION_MAX} 像素。`);
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    const voice = songType === "instrumental" ? "instrumental" : defaults.voice === "instrumental"
      ? (parsed.data.gender === "male" ? "male" : baseArtistDefaults.voice) : defaults.voice;
    const { secondSinger, ...credits } = parsed.data;
    try {
      const saved = await call("accountLocalArtist.save", {
        ...(artist ? { id: artist.id, expected: artist.revision } : {}),
        ...(accountId ? { accountId } : {}),
        defaults: { ...defaults, genre: defaults.genre.trim(), voice, coverResolution: coverResolution.data },
        musicType,
        songAttribute: songAttribute || undefined,
        ...(provider === "fanqie" ? {
          originalSinger: musicType === "cover" ? originalSinger.trim() || null : null,
          originalWorkId: songAttribute === "multi_version" ? originalWorkId.trim() || null : null,
        } : {}),
        isAiWork,
        hasCopyrightProof,
        profile: credits, secondSinger,
        promptTemplateId: promptTemplateId || null,
      });
      onClose();
      notify((artist ? "已保存 " : "已新增 ") + saved.name);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const messages: Record<string, string> = {
        ARTIST_PROMPT_NOT_FOUND: "所选提示词已删除，请重新选择或取消关联。",
        ARTIST_ACCOUNT_MISMATCH: "该艺人已关联其他账号。",
        REVISION_CONFLICT: "艺人资料已有更新，请重新打开后再编辑。",
        NOT_FOUND: "该艺人已删除。",
      };
      setError(messages[code ?? ""] ?? (error instanceof Error ? error.message : "艺人信息保存失败，请重试。"));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const title = artist ? `编辑艺人信息 · ${artist.name}` : "新增艺人信息";
  return (
    <form className="local-artist-form" aria-label={title} onSubmit={event => void save(event)} onKeyDown={event => {
      if (event.key === "Escape" && !inFlight.current) onClose();
    }}>
      <div className="artist-editor-heading">
        <div><h3>{title}</h3>{accountName && <small className="muted">{accountName}</small>}</div>
        <button type="button" disabled={saving} onClick={onClose}>关闭</button>
      </div>
      {previous && <button type="button" disabled={saving} onClick={copyPrevious}>复制上一位艺人</button>}
      <fieldset disabled={saving} className="form-grid artist-profile-fields">
        <div className="artist-prompt-field"><ArtistPromptSelect value={promptTemplateId} onChange={setPromptTemplateId} /></div>
        <label>创作类型<select value={songType} onChange={event => setSongType(event.target.value as SongType)}>
          <option value="vocal">带歌词</option>
          <option value="instrumental">纯音乐</option>
        </select></label>
        <label>音乐类型<select value={musicType} onChange={event => setMusicType(event.target.value as ArtistMusicType)}>
          <option value="original">原创</option>
          <option value="cover">翻唱</option>
        </select></label>
        {provider === "fanqie" && musicType === "cover" && <label>原唱
          <input maxLength={40} value={originalSinger} onChange={event => setOriginalSinger(event.target.value)} />
        </label>}
        <label>歌曲属性<select value={songAttribute} onChange={event => setSongAttribute(event.target.value as ArtistSongAttribute)}>
          <option value="" disabled>请选择</option>
          <option value="original">原版歌曲</option>
          <option value="multi_version">多版本歌曲</option>
        </select></label>
        {provider === "fanqie" && songAttribute === "multi_version" && <label>关联原作品 ID
          <input inputMode="numeric" pattern="[1-9][0-9]{4,24}" maxLength={25} value={originalWorkId}
            onChange={event => setOriginalWorkId(event.target.value)} />
        </label>}
        <label>是否为 AI 作品<select value={isAiWork === undefined ? "" : String(isAiWork)}
          onChange={event => setIsAiWork(event.target.value === "true")}>
          <option value="" disabled>请选择</option>
          <option value="true">是</option>
          <option value="false">否</option>
        </select></label>
        <label>
          风格
          <input maxLength={200} value={defaults.genre} onChange={(event) => {
            const genre = event.target.value;
            setDefaults((old) => ({ ...old, genre }));
          }} />
        </label>
        <label>
          封面分辨率
          <input placeholder={provider === "fanqie" ? `例如 ${formatCoverResolution(fanqieCoverResolution)}` : "例如 2048 × 2048"}
            value={coverResolutionText} onChange={event => setCoverResolutionText(event.target.value)} />
        </label>
        <ArtistProfileFields value={profile} onChange={setProfile} required />
        <label>版权证明<select value={hasCopyrightProof === undefined ? "" : String(hasCopyrightProof)}
          onChange={event => setHasCopyrightProof(event.target.value === "true")}>
          <option value="" disabled>请选择</option>
          <option value="true">是</option>
          <option value="false">否</option>
        </select></label>
      </fieldset>
      <div className="button-row">
        <button type="submit" className="primary" disabled={saving}>{saving ? "正在保存…" : "保存艺人信息"}</button>
        <button type="button" disabled={saving} onClick={onClose}>取消</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
