import { studioMediaUrl } from "./browser-studio";
import React, { createContext, useCallback, useContext } from "react";
import HelpHint from "./components/HelpHint";
import type { PublishSelection } from "../shared/platform-config";
import { workVersionCover, workVersionTitle, type WorkVersionSlot } from "../shared/work-versions";
import { workRecordingSinger } from "../shared/local-artist";
export type Data = Record<string, any>;
export type StudioCallOptions = { refreshSnapshot?: boolean };
export interface StudioContext {
  data: Data;
  runtime: Data;
  call: (method: string, input?: any, options?: StudioCallOptions) => Promise<any>;
  refresh: () => Promise<void>;
  notify: (text: string) => void;
  go: (page: string, id?: string) => void;
  play: (work: any, slot?: WorkVersionSlot) => void;
  selected: string[];
  setSelected: (ids: string[]) => void;
  publishSelection?: PublishSelection;
  setPublishSelection?: (selection: PublishSelection) => Promise<unknown>;
  flushPublishSelection?: () => Promise<unknown>;
  importAsset: (
    role: string,
    workId?: string,
    requestId?: string,
  ) => Promise<void>;
  exportArtifact: (kind: string, input?: any) => Promise<void>;
}
export const Context = createContext<StudioContext>(null!);
export const useStudio = () => useContext(Context);
export function useStudioRequest() {
  const { call } = useStudio();
  return useCallback((method: string, input?: unknown) => call(method, input, { refreshSnapshot: false }), [call]);
}
export function localMusicians(data: Data, selectedId?: string) {
  const artists: any[] = data.accountLocalArtists ?? data.artists ?? [];
  const historical = selectedId && !artists.some(artist => artist.id === selectedId)
    ? data.artists?.find((artist: any) => artist.id === selectedId)
    : undefined;
  return historical ? [...artists, historical] : artists;
}
export const names: Record<string, string> = {
  fanqie: "番茄音乐",
  netease: "网易云音乐",
  qishui: "汽水音乐",
  qqmusic: "QQ 音乐",
  kugou: "酷狗音乐",
  douyin: "抖音视频",
  suno: "Suno",
  suno_cn: "苏诺之音",
  yourmusic: "谱乐 AI",
  tme: "腾讯音乐发行",
};
export const statusNames: Record<string, string> = {
  DRAFT: "草稿",
  PRECHECKED: "已预检",
  READY: "待开始",
  BLOCKED: "需处理",
  PREPARING: "准备材料",
  UPLOADING: "模拟上传",
  UPLOADED: "模拟上传完成",
  COMMITTING: "模拟提交中",
  SUBMISSION_UNKNOWN: "提交结果待核对",
  SUBMITTED: "已提交",
  RETRY_WAIT: "等待安全重试",
  PAUSED: "已暂停",
  CANCELLED: "已取消",
  RUNNING: "处理中",
  NEEDS_ACTION: "需处理",
  NEEDS_RECONCILIATION: "待核对",
  unknown: "未知",
  pending: "待审核",
  approved: "审核通过",
  rejected: "已驳回",
  live: "已上线",
  not_connected: "未连接",
  local_only: "仅本地配置",
  simulation: "模拟身份",
  reauth_required: "需重新授权",
  waiting_external: "等待官方生成后导入",
  waiting_confirmation: "等待确认",
  succeeded: "已完成",
  GENERATION_MANUAL_IMPORT: "音频待生成后导入",
  SUBMISSION_UNKNOWN_REMOTE: "提交结果待核对",
  NETWORK_SAFE_RETRY: "安全网络失败",
  REVIEW_REJECTED: "审核驳回",
};
export const label = (value: string) => statusNames[value] || value;
export const date = (v: string) =>
  v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "—";
export function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function PageHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="page-title">
          <h1>{title}</h1>
          {sub && <HelpHint label={title + "说明"}>{sub}</HelpHint>}
        </div>
      </div>
      {action}
    </div>
  );
}
export function Cover({ work, large = false, slot }: { work: any; large?: boolean; slot?: WorkVersionSlot }) {
  const { data } = useStudio();
  const artist = data.artists.find((a: any) => a.id === work.artistId);
  const title = slot ? workVersionTitle(work, slot) : work.title;
  const image = slot ? workVersionCover(work, slot) : work.assets?.cover;
  const performer = slot ? workRecordingSinger(work, artist, slot === "audio_B" ? "B" : "A") : artist?.name;
  return (
    <div
      className={
        "cover " +
        (large ? "large" : "") +
        (!image ? " tone" + (data.works.indexOf(work) % 3) : "")
      }
    >
      {image ? (
        <img
          alt={title + " 封面"}
          src={studioMediaUrl("media://asset/" + image)}
        />
      ) : (
        <>
          <div className="rain-lines" />
          <small>本地原创占位 · 未生成图像</small>
        </>
      )}
      <strong>{title}</strong>
      <span>{performer || "艺人"}</span>
    </div>
  );
}
export function WorkCard({ work }: { work: any }) {
  const { go, play } = useStudio();
  return (
    <article className="work-card">
      <div
        role="button"
        tabIndex={0}
        onClick={() => go("track", work.id)}
        onKeyDown={(e) => e.key === "Enter" && go("track", work.id)}
      >
        <Cover work={work} />
        <h3>{work.title}</h3>
        <p>
          {work.config.genre} ·{" "}
          {work.config.voice === "duet"
            ? "对唱"
            : work.config.voice === "male"
              ? "男声"
              : work.config.voice === "female"
                ? "女声"
                : "纯音乐"}
        </p>
      </div>
      <div className="card-meta">
        <small>
          {work.assets.audio_A ? "受管音频 · 可试听" : "缺少音频 · 等待导入"}
        </small>
        <button
          aria-label={"试听 " + work.title}
          disabled={!work.assets.audio_A}
          onClick={() => play(work)}
        >
          ▷
        </button>
      </div>
    </article>
  );
}
export function SelectArtist({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data } = useStudio();
  const choices = localMusicians(data, value);
  return (
    <label>
      艺人
      <select
        aria-label="艺人"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {!value && <option value="">{choices.length ? "请选择艺人" : "请在账号管理添加艺人信息"}</option>}
        {choices.map((a: any) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}
