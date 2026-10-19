import React, { useEffect, useState } from "react";
import { useStudio, Badge } from "../context";
import { TME_ISSUES, type TmeDraft, type TmeMetadata } from "../../shared/tme";
import { cleanLyricText } from "../../shared/tme-lyrics";
import TmeLiveStudio from "./TmeLiveStudio";
import HelpNote from "./HelpNote";
const initial: TmeMetadata = {
  lyricist: "",
  composer: "",
  ownLyricist: null,
  ownComposer: null,
  aiMusic: "unknown",
  aiTool: "",
  generatedOn: "",
  statement: "",
  proofAssetId: "",
  existingRemoteId: "",
  authorizationMode: "",
  lyrics: "",
};
const stateNames: Record<string, string> = {
  BLOCKED: "需要处理",
  AWAITING_ACCOUNT: "预检通过 · 待核对真实账号",
  CHECKING: "核对远端",
  FILLING: "填写资料",
  UPLOADING: "上传附件",
  SAVING: "保存草稿",
  RECONCILE_REQUIRED: "结果待核对 · 禁止盲目重试",
  DRAFT_SAVED: "草稿已回读确认",
  REMOTE_SUBMITTED: "远端已提交审核",
  REMOTE_REJECTED: "远端审核驳回",
  REMOTE_PUBLISHED: "远端已发布",
};
const reasons: Record<string, string> = {
  BROWSER_CONNECTION_REQUIRED:
    "尚未连接用户已授权的浏览器会话；不会自动启用调试端口或重启浏览器。",
  PAGE_CONTRACT_UNVERIFIED:
    "真实页面映射待校准；当前只支持本地预检，不会真实上传。",
  ACCOUNT_CHANGED: "浏览器账号已变化，操作已停止。",
  AUTHORIZATION_MODE_USER_ACTION:
    "请由用户在官网核对并选择授权模式，本应用不会代为确认。",
  EXISTING_UNSAVED_DRAFT: "页面含已有未保存内容，不会覆盖。",
  REMOTE_STATE_UNKNOWN: "远端结果尚不明确，请先核对，暂不重传。",
  INTERRUPTED_CHECK_REMOTE_FIRST: "上次操作中断，需要先回读远端。",
  DRAFT_READBACK_UNVERIFIED: "保存结果未回读确认，不能标记成功。",
  RESTORED_REQUIRES_ACCOUNT_REVIEW: "备份恢复后需重新核对账号和远端状态。",
};
export default function TmeDraftStudio() {
  const { data, selected, call, notify, go, importAsset } = useStudio();
  const [workId, setWorkId] = useState(
      selected.length === 1 ? selected[0] : "",
    ),
    [accountId, setAccountId] = useState("");
  const [metadata, setMetadata] = useState<TmeMetadata>(initial),
    [preview, setPreview] = useState<any>(null),
    [drafts, setDrafts] = useState<TmeDraft[]>([]),
    [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState({
      rights: false,
      authors: false,
      ai: false,
      lyrics: false,
      audio: false,
    }),
    [connection, setConnection] = useState<any>(null),
    [port, setPort] = useState(""),
    [allowConnection, setAllowConnection] = useState(false);
  const [remoteConsent, setRemoteConsent] = useState(false);
  const work = data.works.find((w: any) => w.id === workId),
    clean = cleanLyricText(work?.lyrics || "");
  const invalidate = () => {
    setPreview(null);
    setConfirmed({
      rights: false,
      authors: false,
      ai: false,
      lyrics: false,
      audio: false,
    });
    setRemoteConsent(false);
  };
  useEffect(() => {
    setMetadata({
      ...initial,
      lyrics: cleanLyricText(work?.lyrics || "").cleaned,
    });
    invalidate();
  }, [workId]);
  useEffect(() => {
    setPreview(null);
    setConfirmed({
      rights: false,
      authors: false,
      ai: false,
      lyrics: false,
      audio: false,
    });
  }, [
    work?.revision,
    work?.assets.audio_A,
    work?.assets.cover,
    work?.assets.rights,
  ]);
  const load = () =>
    call("tme.list")
      .then(setDrafts)
      .catch((e: any) => notify(e.message));
  useEffect(() => {
    void load();
  }, []);
  const update = (key: keyof TmeMetadata, value: any) => {
    setMetadata({ ...metadata, [key]: value });
    invalidate();
  };
  const input = () => ({ workId, accountId, metadata, confirmations: {} });
  const perform = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const inspect = () =>
    perform(async () => {
      const result = await window.rainfall.tmeInspect(
        port ? { port: Number(port), allowConnection } : {},
      );
      if (!result.ok) throw Error(result.error.message);
      setConnection(result.value);
      setRemoteConsent(false);
    });
  return (
    <div className="tme-studio" data-testid="tme-draft-studio">
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>腾讯作品资料</h2>
          </div>
          <Badge>上传未启用</Badge>
        </div>
        <HelpNote label="上传状态说明">
          已登录、资料完整与审核通过分别记录。现有专辑通道保留共享封面，逐首上传填写后暂停；授权和提交审核分别确认。实平台本轮只完成只读校准，写入流程仍需后续获准试传验收。
        </HelpNote>
        <div className="form-grid">
          <label>
            目标封面策略
            <select
              aria-label="腾讯封面策略"
              value={metadata.coverPolicy || "local_cover"}
              onChange={(e) => update("coverPolicy", e.target.value)}
            >
              <option value="local_cover">本地材料 / 旧草稿通道</option>
              <option value="preserve_album">
                添加至现有专辑 · 保留共享封面
              </option>
            </select>
          </label>
          <label>
            现有专辑 ID
            <input
              aria-label="腾讯目标专辑ID"
              value={metadata.albumId || ""}
              onChange={(e) => update("albumId", e.target.value)}
              placeholder="从官网专辑详情地址核对，不是歌曲 ID"
            />
          </label>
          <label>
            歌曲版本
            <select
              aria-label="腾讯歌曲版本"
              value={metadata.version || "完整版"}
              onChange={(e) => update("version", e.target.value)}
            >
              {["完整版", "Live", "Remix", "伴奏", "Demo", "其他"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            曲风
            <input
              aria-label="腾讯曲风"
              value={metadata.genre ?? "流行"}
              onChange={(e) => update("genre", e.target.value)}
            />
          </label>
          <label>
            语种
            <input
              aria-label="腾讯语种"
              value={metadata.language ?? "国语"}
              onChange={(e) => update("language", e.target.value)}
            />
          </label>
          <label>
            允许被翻唱
            <select
              aria-label="腾讯允许被翻唱"
              value={String(metadata.allowCover ?? false)}
              onChange={(e) => update("allowCover", e.target.value === "true")}
            >
              <option value="false">不允许</option>
              <option value="true">允许 · 需核对官网说明</option>
            </select>
          </label>
          <label>
            试传作品
            <select
              aria-label="腾讯试传作品"
              value={workId}
              onChange={(e) => setWorkId(e.target.value)}
            >
              <option value="">明确选择一首作品</option>
              {data.works.map((w: any) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            腾讯账号备注
            <select
              aria-label="腾讯账号备注"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                invalidate();
              }}
            >
              <option value="">选择备注 · 仍需核对浏览器真实身份</option>
              {data.accounts
                .filter((a: any) =>
                  ["tme", "qqmusic", "kugou"].includes(a.provider),
                )
                .map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="button-row">
          <button onClick={() => go("library")}>管理作品与素材</button>
          <button onClick={() => go("accounts")}>管理本地账号备注</button>
        </div>
        {work && (
          <>
            <p>
              音频 A：{work.assets.audio_A ? "已选择" : "未选择"} ·
              封面：{work.assets.cover ? "已选择" : "未选择"}
            </p>
            <div className="button-row">
              <button onClick={() => importAsset("audio_A", workId)}>
                选择 / 导入音频
              </button>
              <button onClick={() => importAsset("cover", workId)}>
                选择 / 导入封面
              </button>
              <button onClick={() => importAsset("rights", workId)}>
                导入已有创作证明
              </button>
            </div>
          </>
        )}
      </section>
      <section className="panel">
        <div className="section-title">
          <h2>资料预检 · 确认当前版本</h2>
          <Badge>本地保存 · 尚未上传</Badge>
        </div>
        <div className="form-grid">
          <label>
            作词署名
            <input
              aria-label="腾讯作词署名"
              value={metadata.lyricist}
              onChange={(e) => update("lyricist", e.target.value)}
            />
          </label>
          <label>
            作曲署名
            <input
              aria-label="腾讯作曲署名"
              value={metadata.composer}
              onChange={(e) => update("composer", e.target.value)}
            />
          </label>
          {(["ownLyricist", "ownComposer"] as const).map((key, i) => (
            <label key={key}>
              {i ? "本人是否作曲人" : "本人是否作词人"}
              <select
                aria-label={i ? "本人是否作曲人" : "本人是否作词人"}
                value={metadata[key] === null ? "" : String(metadata[key])}
                onChange={(e) =>
                  update(
                    key,
                    e.target.value === "" ? null : e.target.value === "true",
                  )
                }
              >
                <option value="">未确认</option>
                <option value="true">是 · 本人确认</option>
                <option value="false">否 · 已核对署名及授权</option>
              </select>
            </label>
          ))}
          <label>
            是否 AI 音乐
            <select
              aria-label="腾讯是否AI音乐"
              value={metadata.aiMusic}
              onChange={(e) => update("aiMusic", e.target.value)}
            >
              <option value="unknown">未确认</option>
              <option value="yes">是</option>
              <option value="no">否 · 用户确认</option>
            </select>
          </label>
          <label>
            实际 AI 工具
            <input
              aria-label="腾讯AI工具"
              placeholder="例如 Suno，由用户确认"
              value={metadata.aiTool}
              onChange={(e) => update("aiTool", e.target.value)}
            />
          </label>
          <label>
            生成日期
            <input
              type="date"
              aria-label="腾讯生成日期"
              value={metadata.generatedOn}
              onChange={(e) => update("generatedOn", e.target.value)}
            />
          </label>
          <label>
            已有创作证明 · 现有专辑可选
            <select
              aria-label="腾讯创作证明"
              value={metadata.proofAssetId}
              onChange={(e) => update("proofAssetId", e.target.value)}
            >
              <option value="">无材料留空，不生成证明；附件需在官网核对</option>
              {data.assets
                .filter(
                  (a: any) =>
                    a.kind === "document" || a.id === work?.assets.rights,
                )
                .map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.label || a.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <label>
          音乐人说 · 可选5–300字
          <textarea
            aria-label="腾讯音乐人说"
            value={metadata.statement}
            onChange={(e) => update("statement", e.target.value)}
            rows={2}
          />
        </label>
        <div className="tme-lyric-grid">
          <label>
            原始歌词 · 只读保留
            <textarea
              aria-label="腾讯原始歌词"
              readOnly
              value={work?.lyrics || ""}
              rows={10}
            />
          </label>
          <label>
            正式歌词 · 清理后预览
            <textarea
              aria-label="腾讯正式歌词"
              value={metadata.lyrics}
              onChange={(e) => update("lyrics", e.target.value)}
              rows={10}
            />
            <small>
              {[...metadata.lyrics].length} / 20000 字
            </small>
          </label>
        </div>
        <HelpNote label="歌词清理记录">
          仅删除独占一行的已知生成标签：
          {clean.removed.length
            ? clean.removed.map((x) => x.text).join("、")
            : "无"}
          ；未知括号与正文中的标签均保留。不会改写实际歌词。
        </HelpNote>
        {clean.warnings.length > 0 && (
          <div className="notice">{clean.warnings.join("；")}</div>
        )}
        <details>
          <summary>关联原作品 / 授权模式</summary>
          <label>
            已存在的腾讯原作品 ID
            <input
              aria-label="腾讯原作品ID"
              value={metadata.existingRemoteId}
              onChange={(e) => update("existingRemoteId", e.target.value)}
            />
          </label>
          <p>
            已提交、驳回和草稿分别回读。已有作品只读关联；改名后沿用原
            ID，不盲目新建或重提。“确认授权模式”始终由用户在官网核对，本应用不会自动选择协议。
          </p>
        </details>
        <div className="button-row">
          <button
            className="primary"
            disabled={busy || !workId || !accountId}
            onClick={() =>
              perform(async () => {
                const p = await call("tme.preview", input());
                setPreview(p);
                setConfirmed({
                  rights: false,
                  authors: false,
                  ai: false,
                  lyrics: false,
                  audio: false,
                });
              })
            }
          >
            运行本地预检
          </button>
        </div>
        {preview && (
          <div className="tme-review">
            <h3>预检结果 · 确认只适用于当前资料</h3>
            {preview.issues.map((code: string) => (
              <p className="error" key={code}>
                {TME_ISSUES[code] || code}
              </p>
            ))}
            {(
              [
                ["rights", "作品权利及已有证明真实有效"],
                ["authors", "作词 / 作曲署名及本人身份已核实"],
                ["ai", "AI 音乐声明、工具和日期已核实"],
                ["lyrics", "已检查原稿与正式歌词清理差异"],
                ["audio", "已试听选定音频，正式歌词逐行与音频一致"],
              ] as const
            ).map(([key, text]) => (
              <label key={key} className="inline-check">
                <input
                  type="checkbox"
                  aria-label={text}
                  checked={confirmed[key]}
                  onChange={(e) =>
                    setConfirmed({ ...confirmed, [key]: e.target.checked })
                  }
                />
                {text}
              </label>
            ))}
            <button
              className="primary"
              disabled={
                busy ||
                preview.issues.length > 0 ||
                !Object.values(confirmed).every(Boolean)
              }
              onClick={() =>
                perform(async () => {
                  await call("tme.prepare", {
                    ...input(),
                    confirmations: {
                      rights: confirmed.rights,
                      authors: confirmed.authors,
                      ai: confirmed.ai,
                      lyricsHash: confirmed.lyrics
                        ? preview.lyricsHash
                        : undefined,
                      recordingHash: confirmed.audio
                        ? preview.audio?.sha256
                        : undefined,
                      reviewHash: preview.reviewHash,
                    },
                  });
                  await load();
                  notify("本地资料已保存，尚未上传腾讯。");
                })
              }
            >
              保存本地待核对任务
            </button>
          </div>
        )}
      </section>
      <TmeLiveStudio
        accountId={accountId}
        title={work?.title || ""}
        albumId={metadata.albumId || ""}
      />
      <details>
        <summary>旧草稿适配器诊断 · 真实页面待校准</summary>
        <section className="panel">
          <div className="section-title">
            <h2>旧浏览器连接诊断</h2>
            <Badge>
              {connection?.connected ? "客户端已建立连接" : "客户端尚未连接"}
            </Badge>
          </div>
          <p>
            本地资料：可保存并预检。真实页面：
            {connection?.contractVerified ? "映射已核验" : "映射待校准"}
            。账号身份：
            {connection?.identity ? "已回读，仍需核对本次范围" : "尚未核实"}。
          </p>
          <div className="notice">
            外部工具能操作
            Chrome，不代表本客户端已连接。官网已登录、本地账号备注与客户端执行许可分别核对。
          </div>
          <p>
            仅使用本机用户明确授权的浏览器。当前真实页面映射待校准；不会提取
            Cookie、token，也不会打开调试端口或更改安全设置。
          </p>
          <button disabled={busy} onClick={inspect}>
            只读检查浏览器连接
          </button>
          <details>
            <summary>已有授权连接 · 可选诊断</summary>
            <p>
              仅用于用户已经允许连接的本机浏览器；没有现成连接时保持为空。此项不会启动或重启浏览器。
            </p>
            <label>
              已有本机会话端口
              <input
                aria-label="腾讯已有会话端口"
                type="number"
                value={port}
                onChange={(e) => {
                  setPort(e.target.value);
                  setConnection(null);
                }}
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={allowConnection}
                onChange={(e) => setAllowConnection(e.target.checked)}
              />
              我已允许此现成会话进行只读检查
            </label>
          </details>
          {connection && (
            <div className="notice">
              {reasons[connection.reason] ||
                connection.reason ||
                "请核对可见账号身份"}
              {connection.identity && (
                <p>
                  {connection.identity.displayName} ·{" "}
                  {connection.identity.subject} ·{" "}
                  {connection.identity.source === "fixture"
                    ? "模拟身份，不能授权真实上传"
                    : "浏览器可见身份"}
                </p>
              )}
            </div>
          )}
          <label className="inline-check">
            <input
              type="checkbox"
              disabled={!connection?.authorizationNonce}
              checked={remoteConsent}
              onChange={(e) => setRemoteConsent(e.target.checked)}
            />
            已核对当前真实账号、选定作品和附件，仅允许保存草稿
          </label>
        </section>
        <section className="panel">
          <div className="section-title">
            <h2>草稿任务与状态回读</h2>
            <button onClick={load}>刷新本地状态</button>
          </div>
          {!drafts.length && (
            <div className="empty">
              尚无任务。先明确选择作品、资料和证明，完成本地预检。
            </div>
          )}
          {drafts.map((d) => (
            <article className="account-card" key={d.id}>
              <div className="section-title">
                <h3>{d.title}</h3>
                <Badge>
                  {d.source === "fixture" ? "模拟 · " : ""}
                  {stateNames[d.state] || d.state}
                </Badge>
              </div>
              <p>
                资料 v{d.revision} · 音频{" "}
                {d.assets.audio?.sha256.slice(0, 12) || "缺失"} ·{" "}
                {d.source === "fixture" ? "模拟证据" : "本地任务，尚非平台回执"}
              </p>
              <p>
                附件检查点：音频 {d.uploads.audio ? "已确认" : "未确认"} / 封面{" "}
                {d.uploads.cover ? "已确认" : "未确认"} / 证明{" "}
                {d.uploads.proof ? "已确认" : "未确认"}
              </p>
              {d.reason && (
                <div className="notice">{reasons[d.reason] || d.reason}</div>
              )}
              {d.remote && (
                <p>
                  原作品 / 草稿 ID：{d.remote.id} · 状态：{d.remote.status} ·
                  原始驳回原因：{d.remote.reason || "无"} · 来源：
                  {d.remote.source === "fixture" ? "模拟" : "浏览器页面"}
                </p>
              )}
              <button
                disabled={
                  busy ||
                  !connection?.authorizationNonce ||
                  !remoteConsent ||
                  d.issues.length > 0 ||
                  d.source === "fixture"
                }
                onClick={() =>
                  perform(async () => {
                    const r = await window.rainfall.tmeSaveDraft({
                      id: d.id,
                      authorizationNonce: connection.authorizationNonce,
                      reviewHash: d.reviewHash,
                      confirmed: true,
                    });
                    if (!r.ok) throw Error(r.error.message);
                    setRemoteConsent(false);
                    setConnection(null);
                    await load();
                  })
                }
              >
                {d.state === "RECONCILE_REQUIRED"
                  ? "先核对远端，再恢复草稿"
                  : "仅上传并保存草稿"}
              </button>
            </article>
          ))}
          <p>
            本轮不提供提交审核操作。保存成功必须有草稿 ID
            与资料/附件回读证据；超时先核对，不能当成成功或直接重传。
          </p>
        </section>
      </details>
    </div>
  );
}
