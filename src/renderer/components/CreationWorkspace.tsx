import React, { useEffect, useRef, useState } from "react";
import { imageApiModel, type ApiProfile } from "../../shared/api-profiles";
import type { GenerationRouting } from "../../shared/generation-config";
import { artistSongType, type SongType } from "../../shared/local-artist";
import { maxPublicationWorks } from "../../shared/platform-config";
import { workVersionCover, workVersionTitle, type WorkVersion, type WorkVersionSlot } from "../../shared/work-versions";
import type { CreationTaskSummary } from "../../shared/plan-center";
import { studioMediaUrl } from "../browser-studio";
import { localMusicians, useStudio } from "../context";
import { defaultRoutes } from "./GenerationRoutes";
import "../creation-workspace.css";

export type CreationEditor = {
  title: string;
  alternateTitle?: string;
  lyrics: string;
  style: string;
  artistId: string | null;
  songType: SongType | null;
  vocalGender: "" | "male" | "female" | null;
  cover: boolean;
  music: boolean;
  routing: GenerationRouting;
  musicConsent: string;
};

export const emptyCreationEditor: CreationEditor = {
  title: "", lyrics: "", style: "", artistId: null, songType: null, vocalGender: null,
  cover: true, music: true, routing: defaultRoutes, musicConsent: "",
};

const creationErrors: Record<string, string> = {
  CREATION_MUSIC_LIMIT: "谱乐 AI 支持歌名最多 80 字、风格描述 1000 字、歌词 5000 字。请精简后重试。",
  LYRICS_REQUIRED: "请输入歌词。",
  MUSIC_GRANT_REQUIRED: "请选择谱乐 AI 配置并确认扣费授权。",
  MUSIC_ROUTE_CONFIRMATION_MISMATCH: "音乐模型配置已变化，请重新打开创作中心并确认扣费授权。",
  IMAGE_ROUTE_REQUIRED: "请选择封面图片 API 或外部导入配置。",
  IMAGE_ADAPTER_UNAVAILABLE: "请选择已接入的封面图片 API 或外部导入配置。",
  DOWNLOAD_ROOT_REQUIRED: "请先在配置中心设置下载目录。",
  DOWNLOAD_ROOT_CHANGED: "下载目录已被替换，请在配置中心重新选择。",
  DOWNLOAD_FOLDER_UNAVAILABLE: "无法写入任务下载目录，请核对目录权限。",
  NOT_FOUND: "所选艺人已不可用，请重新选择。",
};

const taskLabels: Record<CreationTaskSummary["state"], string> = {
  pending: "待执行", scheduled: "已定时", running: "生成中", awaiting_cover: "等待封面",
  completed: "成功", failed: "失败", blocked: "需处理", unknown: "待对账",
  stopping: "正在停止", stopped: "已停止",
};
const taskMessages: Record<string, string> = {
  CREDENTIAL_REQUIRED: "请检查模型 API 的 Key。",
  SUBMISSION_OUTCOME_UNKNOWN: "未收到谱乐回执，正在查找原任务。",
  SUBMISSION_NOT_PROVEN_UNCHARGED: "谱乐提交结果不明，正在查找原任务。",
  HTTP_REQUEST_FAILED: "服务连接中断，请查看任务状态。",
  MUSIC_REQUEST_FAILED: "谱乐请求失败，请检查连接。",
  MUSIC_SUBMISSION_TIMEOUT: "等待回执超时，正在查找原任务。",
  MUSIC_RECEIPT_INVALID: "回执缺少可用的歌曲 ID，正在查找原任务。",
  MUSIC_HISTORY_CHECK_REQUESTED: "正在核对谱乐历史。",
  MUSIC_HISTORY_NOT_FOUND: "谱乐历史暂无匹配结果，请核对原任务及积分记录。",
  MUSIC_HISTORY_AMBIGUOUS: "找到多条可能的结果，请核对谱乐历史。",
  MUSIC_HISTORY_UNAVAILABLE: "谱乐历史暂不可读，请检查连接和 Key 后重新核对。",
  MUSIC_REQUEST_REJECTED: "谱乐拒绝了生成参数，请核对模型及内容。",
  MUSIC_CONTENT_REJECTED: "谱乐拒绝了创作内容。",
  MUSIC_CREDITS_INSUFFICIENT: "谱乐积分不足。",
  MUSIC_RATE_LIMITED: "谱乐请求过于频繁，请稍后再试。",
  MUSIC_PERMISSION_DENIED: "此 API Key 无权生成音乐。",
  COVER_REQUIRED: "音频已入库，等待封面。",
  IMAGE_OUTCOME_UNKNOWN: "音频已入库，封面未收到回执。可打开作品导入封面。",
  IMAGE_DOWNLOAD_FAILED: "音频已入库，封面下载失败。可打开作品导入封面。",
  IMAGE_DOWNLOAD_URL_REJECTED: "音频已入库，封面下载地址校验失败。",
  IMAGE_RESPONSE_INVALID: "音频已入库，封面响应格式异常。",
  HTTP_TIMEOUT: "服务请求超时，请查看任务状态。",
  IMAGE_HTTP_401: "智谱 API Key 校验失败，可打开作品导入封面。",
  IMAGE_HTTP_429: "智谱请求受限，可打开作品导入封面。",
  ORIGINAL_ASSETS_PENDING: "等待谱乐返回音频。",
  MUSIC_GRANT_REQUIRED: "请核对音乐模型与授权。",
  ROUTE_PROFILE_CHANGED: "模型配置已更新，请核对任务。",
  DOWNLOAD_ACCOUNT_REQUIRED: "请选择已关联有效音乐人账号的艺人信息。",
  DOWNLOAD_ROOT_UNAVAILABLE: "下载目录不可用，请核对目录配置。",
  DOWNLOAD_WRITE_FAILED: "归档写入失败，请查看任务详情。",
};

type CreationWork = WorkVersion & { id: string; prompt?: string; story?: string };
export type CreationWorkSelection = { workId: string; slot?: WorkVersionSlot };
const recordingSlots = ["audio_A", "audio_B"] as const;

function workArtwork(cover?: string) {
  return cover
    ? <img src={studioMediaUrl(`media://asset/${cover}`)} alt="" loading="lazy" />
    : <span className="creation-work-icon" aria-hidden="true">♫</span>;
}

export default function CreationWorkspace({ draft, update, selection, onOpenWork }: {
  draft: CreationEditor;
  update: (fields: Partial<CreationEditor>) => void;
  selection: CreationWorkSelection | null;
  onOpenWork: (work: CreationWorkSelection, trigger: HTMLButtonElement) => void;
}) {
  const { data, call, go, notify, play, importAsset, selected, setSelected, publishSelection, setPublishSelection } = useStudio();
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [defaults, setDefaults] = useState<{ image: string | null; music: string | null }>();
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectingWorks, setSelectingWorks] = useState(false);
  const [openingPublish, setOpeningPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<CreationTaskSummary[]>([]);
  const [taskLoadFailed, setTaskLoadFailed] = useState(false);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const submitting = useRef(false);
  const taskListVersion = useRef(0);
  const workList = useRef<HTMLDivElement>(null);
  const artists = localMusicians(data);
  const artist = artists.find(item => item.id === (draft.artistId ?? artists[0]?.id));
  const preferredSongType = artistSongType(artist?.defaults);
  const songType = draft.songType ?? preferredSongType;
  const instrumental = songType === "instrumental";
  const savedGender: unknown = artist?.profile?.gender;
  const vocalGender = draft.vocalGender ?? (savedGender === "male" || savedGender === "female" || savedGender === "other" ? savedGender : "");
  const generationGender = !instrumental && (vocalGender === "male" || vocalGender === "female") ? vocalGender : undefined;
  const usesMusic = draft.music || instrumental;
  const chosenProfile = (role: "image" | "music") => profiles.find(item => item.id === (
    draft.routing[role].source === "default" ? defaults?.[role] : draft.routing[role].profileId
  ));
  const musicProfile = chosenProfile("music");
  const imageProvider = chosenProfile("image")?.providerId;
  const imageReady = !!imageProvider && (!!imageApiModel(imageProvider) || ["local_image", "dot_image"].includes(imageProvider));
  const musicScope = musicProfile?.providerId === "yourmusic" && musicProfile.modelId
    ? `${musicProfile.id}:${musicProfile.revision}:${musicProfile.modelId}` : "";
  const musicAuthorized = !!musicScope && draft.musicConsent === musicScope;
  const works: CreationWork[] = data.works ?? [];
  const worksById = new Map(works.map(work => [work.id, work]));
  const selectedIds = (selected ?? []).filter(id => worksById.has(id));
  const selectedSet = new Set(selectedIds);
  const linkedWorkIds = new Set(tasks.map(task => task.workId));
  const query = search.trim().toLowerCase();
  const matchesSearch = (...fields: (string | null | undefined)[]) => fields.join("\n").toLowerCase().includes(query);
  const taskRows = tasks.map(task => ({ task, work: task.workId ? worksById.get(task.workId) : undefined }));
  const sources: { task?: CreationTaskSummary; work?: CreationWork }[] = [
    ...taskRows, ...works.filter(work => !linkedWorkIds.has(work.id)).map(work => ({ work })),
  ];
  const recordings = sources.flatMap(({ task, work }) => {
    if (!work) return [];
    const style = work.prompt ?? task?.style;
    return recordingSlots.filter(slot => work.assets?.[slot] && matchesSearch(workVersionTitle(work, slot), style, work.story))
      .map((slot, index) => ({ work, slot, style, task, showReceipt: index === 0 }));
  });
  const waitingRows = sources.filter(({ task, work }) => !recordingSlots.some(slot => work?.assets?.[slot]) &&
    matchesSearch(work?.title ?? task?.title, work?.alternateTitle, work?.prompt ?? task?.style, work?.story));
  const visibleIds = [...new Set([...recordings.map(({ work }) => work.id),
    ...waitingRows.flatMap(({ work }) => work ? [work.id] : [])])];
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedSet.has(id));

  const updateSelection = (ids: string[]) => {
    if (ids.length <= maxPublicationWorks) setSelected(ids);
    else notify(`单次最多选择 ${maxPublicationWorks} 首。`);
  };
  const toggleWork = (workId: string) => updateSelection(selectedSet.has(workId)
    ? selectedIds.filter(id => id !== workId) : [...selectedIds, workId]);
  const selectWork = (work: CreationWork) => selectingWorks && <input type="checkbox"
    aria-label={`选择 ${work.title}`} checked={selectedSet.has(work.id)} disabled={openingPublish}
    onChange={() => toggleWork(work.id)} />;
  const openPublish = async () => {
    setOpeningPublish(true);
    try {
      await setPublishSelection?.({ workIds: selectedIds, targets: [], accountOverrides: publishSelection?.accountOverrides ?? {} });
      go("accounts", "diagnostics");
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法保存所选作品");
    } finally {
      setOpeningPublish(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    void Promise.all([call("apiProfile.list"), call("generationConfig.read")]).then(([items, config]) => {
      if (mounted) { setProfiles(items); setDefaults(config.roles); }
    }).catch(() => { if (mounted) setError("无法读取模型 API 配置，请重新打开创作中心。"); });
    return () => { mounted = false; };
  }, [call]);

  useEffect(() => {
    if (data.mode !== "production") return;
    let mounted = true;
    let reading = false;
    const syncTasks = async () => {
      if (reading) return;
      reading = true;
      const version = taskListVersion.current;
      try {
        const result = await window.rainfall.call("creationTasks.taskStatus");
        if (!mounted || taskListVersion.current !== version) return;
        if (!result.ok) throw Error(result.error.code);
        setTasks(result.value as CreationTaskSummary[]);
        setTaskLoadFailed(false);
      } catch {
        if (mounted && taskListVersion.current === version) setTaskLoadFailed(true);
      } finally { reading = false; }
    };
    void syncTasks();
    const timer = setInterval(() => void syncTasks(), 4000);
    return () => { mounted = false; clearInterval(timer); };
  }, [data.mode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || !artist || data.mode !== "production" || !draft.title.trim() || !draft.style.trim()) return;
    if (!instrumental && !draft.lyrics.trim()) { setError(creationErrors.LYRICS_REQUIRED); return; }
    if (usesMusic && !musicAuthorized) { setError(creationErrors.MUSIC_GRANT_REQUIRED); return; }
    setError("");
    setBusy(true);
    submitting.current = true;
    const payload = {
      artistId: artist.id, songType,
      draft: {
        title: draft.title, style: draft.style, lyrics: instrumental ? "" : draft.lyrics, vocalGender: generationGender,
        ...(draft.alternateTitle?.trim() ? { alternateTitle: draft.alternateTitle.trim() } : {}),
      },
      outputs: { cover: draft.cover, music: usesMusic }, routing: draft.routing,
      music: usesMusic && musicProfile ? { consent: true, profileId: musicProfile.id, profileRevision: musicProfile.revision, modelId: musicProfile.modelId }
        : { consent: false },
    };
    const serialized = JSON.stringify(payload);
    if (request.current?.payload !== serialized) request.current = { payload: serialized, id: crypto.randomUUID() };
    try {
      const task: CreationTaskSummary = await call("creationTasks.start", { requestId: request.current.id, ...payload });
      request.current = null;
      taskListVersion.current++;
      setTasks(previous => previous.some(row => row.planId === task.planId) ? previous : [task, ...previous]);
      setSearch("");
      if (workList.current) workList.current.scrollTop = 0;
      notify("创作任务已启动");
    } catch (cause) {
      const code = (cause as { code?: string })?.code ?? "";
      setError(creationErrors[code] ?? taskMessages[code] ?? "创建任务失败，请检查输入和模型配置后重试。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const checkReceipt = async (task: CreationTaskSummary) => {
    if (!task.runId) return;
    try {
      await call("creationTasks.checkReceipt", { id: task.runId });
      setTasks(current => current.map(row => row.runId === task.runId && row.state === "unknown"
        ? { ...row, reason: "MUSIC_HISTORY_CHECK_REQUESTED" } : row));
    } catch { notify("任务状态可能已更新，请查看刷新后的结果。"); }
  };

  const routePicker = (role: "image" | "music", label: string) => (
    <label>{label}<select value={draft.routing[role].profileId ?? "default"} disabled={busy || !defaults} onChange={event => {
      const value = event.target.value;
      update({ routing: { ...draft.routing, [role]: value === "default" ? { source: "default" } : { source: "override", profileId: value } },
        ...(role === "music" ? { musicConsent: "" } : {}) });
    }}>
      <option value="default">默认 · {profiles.find(item => item.id === defaults?.[role])?.label ?? "未配置"}</option>
      {profiles.filter(item => item.kind === role).map(item => <option value={item.id} key={item.id}>{item.label} · {item.modelId ?? "外部导入"}</option>)}
    </select></label>
  );

  const workButton = (work: CreationWorkSelection, content: React.ReactNode, label?: string) => {
    const expanded = selection?.workId === work.workId && selection.slot === work.slot;
    return (
      <button className="creation-work-row" type="button" aria-label={label} aria-expanded={expanded}
        aria-controls={expanded ? "creation-work-detail" : undefined}
        onClick={event => onOpenWork(work, event.currentTarget)}>
        {content}
      </button>
    );
  };

  const taskStatus = (task: CreationTaskSummary) => (
    <span className="creation-task-status" data-state={task.state}>{taskLabels[task.state]}</span>
  );
  const taskNote = (task?: CreationTaskSummary) => task?.reason && taskMessages[task.reason] && <small>{taskMessages[task.reason]}</small>;
  const receiptAction = (task?: CreationTaskSummary) => task?.state === "unknown" && task.runId && (
    <button className="creation-check-receipt" type="button" aria-label={`核对原任务 ${task.title}`}
      disabled={task.reason === "MUSIC_HISTORY_CHECK_REQUESTED"} onClick={() => void checkReceipt(task)}>核对原任务</button>
  );

  return <div className="creation-workbench">
    <form className="panel creation-editor" onSubmit={submit} aria-label="歌曲编辑器">
      <label>{draft.alternateTitle === undefined ? "歌名" : "A 版歌名"}<input required maxLength={200} value={draft.title}
        placeholder="输入歌曲标题" onChange={e => update({ title: e.target.value })} /></label>
      {draft.alternateTitle !== undefined && <label>B 版歌名<input maxLength={200} value={draft.alternateTitle}
        placeholder="留空时使用 A 版歌名" onChange={e => update({ alternateTitle: e.target.value })} /></label>}
      <div className="creation-field-heading"><span>{instrumental ? "创作类型" : "歌词"}</span><label className="inline-check"><input type="checkbox" checked={instrumental}
        onChange={e => {
          const type = e.target.checked ? "instrumental" : "vocal";
          update({ songType: type === preferredSongType ? null : type, musicConsent: "" });
        }} />纯音乐</label></div>
      {!instrumental && <textarea aria-label="歌词" rows={10} required maxLength={20000} placeholder="输入歌词，可用 [主歌]、[副歌] 标记段落" value={draft.lyrics} onChange={e => update({ lyrics: e.target.value })} />}
      <label>风格描述<textarea required rows={4} maxLength={4000} value={draft.style} placeholder="例如：温暖的民谣，轻鼓组和木吉他" onChange={e => update({ style: e.target.value })} /></label>
      <div className="form-grid">
        <label>艺人信息<select required value={artist?.id ?? ""} onChange={e => update({ artistId: e.target.value, songType: null, vocalGender: null, musicConsent: "" })}>
          <option value="" disabled>请选择艺人</option>
          {artists.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {!instrumental && <label>歌手性别<select value={vocalGender} onChange={e => {
          const gender = e.target.value;
          update({ vocalGender: gender === "other" ? null : gender as NonNullable<CreationEditor["vocalGender"]> });
        }}>
          <option value="">不限</option><option value="male">男声</option><option value="female">女声</option>
          {savedGender === "other" && <option value="other">其他（不限声线）</option>}
        </select></label>}
      </div>
      {!artists.length && <button type="button" onClick={() => go("platform-accounts")}>添加艺人信息</button>}
      <div className="creation-outputs">
        <label className="inline-check"><input type="checkbox" checked={draft.cover} onChange={e => update({ cover: e.target.checked })} />封面图片创作</label>
        <label className="inline-check"><input type="checkbox" checked={usesMusic} disabled={instrumental} onChange={e => update({ music: e.target.checked, musicConsent: "" })} />音乐生成</label>
      </div>
      {draft.cover && <>{routePicker("image", "封面图片配置")}
        {imageProvider && imageApiModel(imageProvider) && <p className="muted">{usesMusic ? "有 A、B 两个音频时分别生成封面，按两次出图计费。" : "创建任务后调用所选封面 API，按服务计费。"}</p>}
        {!imageReady && <button className="link-button" type="button" onClick={() => go("accounts", "models")}>配置封面图片来源</button>}
      </>}
      {usesMusic && <>{routePicker("music", "音乐生成配置")}
        {musicScope ? <label className="inline-check"><input type="checkbox" checked={musicAuthorized} onChange={e => update({ musicConsent: e.target.checked ? musicScope : "" })} />
          创建任务后立即使用谱乐 AI 现有积分，实际扣费以平台为准</label>
          : <p><button className="link-button" type="button" onClick={() => go("accounts", "models")}>配置谱乐 AI 模型</button></p>}
      </>}
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary creation-submit" type="submit" disabled={busy || !artist || data.mode !== "production"}>{busy ? "正在启动…" : "创建任务"}</button>
    </form>
    <section className="panel creation-works" aria-label="作品列表">
      <div className="section-title"><h2>作品</h2>{works.length > 0 && <button type="button" aria-pressed={selectingWorks}
        disabled={openingPublish} onClick={() => setSelectingWorks(value => !value)}>多选</button>}</div>
      <label>搜索作品<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="歌名、风格或故事" /></label>
      {selectingWorks && <div className="creation-work-selection">
        <label className="inline-check"><input type="checkbox" checked={allVisibleSelected} disabled={!visibleIds.length || openingPublish}
          onChange={() => updateSelection(allVisibleSelected ? selectedIds.filter(id => !visibleIds.includes(id))
            : [...new Set([...selectedIds, ...visibleIds])])} />选择当前筛选的作品</label>
        <span aria-live="polite">已选 {selectedIds.length} 首</span>
        {selectedIds.length > 0 && <button type="button" disabled={openingPublish} onClick={() => setSelected([])}>清空</button>}
        <button type="button" disabled={!selectedIds.length || openingPublish} onClick={() => void openPublish()}>批量发布</button>
      </div>}
      {taskLoadFailed && <p className="muted" role="status">任务状态暂时无法刷新。</p>}
      <div className="creation-work-items" ref={workList}>
        {!!recordings.length && <ul aria-label="歌曲版本">
          {recordings.map(({ work, slot, style, task, showReceipt }) => {
            const version = slot === "audio_A" ? "A" : "B";
            const title = workVersionTitle(work, slot);
            const cover = workVersionCover(work, slot);
            const coverAction = cover ? "更换封面" : "导入封面";
            const name = `${version} 版 ${title}`;
            return <li key={`${work.id}:${slot}`} className="creation-recording" data-work-id={work.id}>
              {showReceipt && selectWork(work)}
              {workButton({ workId: work.id, slot }, <>
                {workArtwork(cover)}
                <span className="creation-work-copy">
                  <span className="creation-recording-title"><span>{version} 版</span><strong title={title}>{title}</strong></span>
                  {style && <small>{style}</small>}
                  {taskNote(task)}
                </span>
                {task && taskStatus(task)}
              </>, `查看 ${name}`)}
              <div className="creation-recording-actions">
                {showReceipt && receiptAction(task)}
                <button type="button" aria-label={`试听 ${name}`} onClick={() => play(work, slot)}>试听</button>
                <button type="button" aria-label={`${coverAction} ${name}`}
                  onClick={() => void importAsset(slot === "audio_A" ? "cover" : "cover_B", work.id)}>{coverAction}</button>
              </div>
            </li>;
          })}
        </ul>}
        {!!waitingRows.length && <section className="creation-pending" aria-labelledby="creation-pending-title">
          <h3 id="creation-pending-title">待生成和无音频作品</h3>
          <ul>{waitingRows.map(({ task, work }) => {
            const content = <>
              {workArtwork(work?.assets?.cover)}
              <span className="creation-work-copy">
                <strong>{work?.title ?? task?.title}</strong>
                <small>{work?.prompt ?? task?.style}</small>
                {task?.schedule && <small>{task.schedule.date} {task.schedule.localTime} · 北京时间</small>}
                {taskNote(task)}
              </span>
              {task && taskStatus(task)}
            </>;
            return <li key={task?.planId ?? work?.id} className="creation-recording" data-work-id={work?.id}>
              {work && selectWork(work)}
              {work
                ? workButton({ workId: work.id }, content, `查看 ${work.title}`)
                : <div className="creation-work-row" role="status">{content}</div>}
              {receiptAction(task)}
            </li>;
          })}</ul>
        </section>}
        {!recordings.length && !waitingRows.length && <p className="muted">{query ? "没有匹配的作品或任务" : "暂无作品"}</p>}
      </div>
    </section>
  </div>;
}
