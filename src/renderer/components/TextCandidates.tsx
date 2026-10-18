import HelpNote from "./HelpNote";
import React, { useEffect, useState } from "react";
import { useStudio, Badge } from "../context";
import MusicCandidates from "./MusicCandidates";
export default function TextCandidates() {
  const { data, call, notify } = useStudio();
  const [status, setStatus] = useState<any>({
    configured: false,
    active: false,
    revision: 0,
  });
  const [rows, setRows] = useState<any>({ candidates: [], drafts: [] });
  const [artistId, setArtist] = useState(data.artists[0]?.id ?? "");
  const [workspaceRef, setWorkspace] = useState("rainfall-personal"),
    [artistRef, setArtistRef] = useState("creator");
  const [seriesId, setSeries] = useState(""),
    [seriesRef, setSeriesRef] = useState("");
  const [filter, setFilter] = useState("current"),
    [query, setQuery] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    const [s, r] = await Promise.all([
      call("inbox.status"),
      call("inbox.listCandidates"),
    ]);
    setStatus(s);
    setRows(r);
  };
  useEffect(() => {
    void refresh().catch(() => setError("无法读取收件状态。"));
    const timer = setInterval(
      () => void refresh().catch(() => setError("无法读取收件状态。")),
      5000,
    );
    return () => clearInterval(timer);
  }, []);
  const setup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const mapping = status.channel;
      await call("inbox.configure", {
        workspaceRef: mapping?.workspaceRef ?? workspaceRef,
        artistId: mapping ? Object.values(mapping.artistRefs)[0] : artistId,
        artistRef: mapping ? Object.keys(mapping.artistRefs)[0] : artistRef,
        seriesId: mapping
          ? (Object.values(mapping.seriesRefs)[0] ?? null)
          : seriesId || null,
        seriesRef: mapping
          ? (Object.keys(mapping.seriesRefs)[0] ?? null)
          : seriesRef || null,
        expectedRevision: status.revision,
      });
      await refresh();
      notify("本地收件通道已配置；父 dot 调度与投递仍需单独接线");
    } catch {
      setError(
        "配置未保存，请检查别名、所属身份和版本。已建立通道的身份映射不能直接更换。",
      );
    } finally {
      setBusy(false);
    }
  };
  const visible = rows.candidates.filter((c: any) => {
    const d = rows.drafts.find((d: any) => d.id === c.draftId)?.draft;
    return (
      (filter === "all" || c.isCurrent) &&
      (!query || `${d?.title ?? ""} ${c.externalItemId}`.includes(query))
    );
  });
  return (
    <section className="panel" aria-label="自动收件箱">
      <div className="section-title">
        <h2>文本收件箱</h2>
        <span>
          {status.active
            ? "本地自动收件已配置"
            : status.configured
              ? "已暂停收件"
              : "通道未配置"}
        </span>
      </div>
      <HelpNote label="收件方式">
        通过授权本地通道接收歌词、风格与音乐提示词。客户端运行时自动扫描；退出后待下次正常启动入库。父
        dot 离线待交付与补交需父端配置，尚未验收。
      </HelpNote>
      <Badge>来源待核实</Badge>
      <HelpNote label="收件检查范围">
        导入只做本地检查，完整质量评分显示“待模型评分”；不会启动
        CLI、收费生成或发布。生产者自称 dot 不代表身份认证。
      </HelpNote>
      <form onSubmit={(e) => void setup(e)}>
        <div className="form-grid">
          <label>
            工作区别名
            <input
              required
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,79}"
              value={status.channel?.workspaceRef ?? workspaceRef}
              disabled={status.configured}
              onChange={(e) => setWorkspace(e.target.value)}
            />
          </label>
          <label>
            艺人别名
            <input
              required
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,79}"
              value={
                status.channel
                  ? Object.keys(status.channel.artistRefs)[0]
                  : artistRef
              }
              disabled={status.configured}
              onChange={(e) => setArtistRef(e.target.value)}
            />
          </label>
          <label>
            接收艺人
            <select
              value={
                status.channel
                  ? (Object.values(status.channel.artistRefs)[0] as string)
                  : artistId
              }
              disabled={status.configured}
              onChange={(e) => {
                setArtist(e.target.value);
                setSeries("");
              }}
            >
              {data.artists.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            系列（可选）
            <select
              value={
                status.channel
                  ? ((Object.values(status.channel.seriesRefs)[0] as string) ??
                    "")
                  : seriesId
              }
              disabled={status.configured}
              onChange={(e) => {
                setSeries(e.target.value);
                if (!e.target.value) setSeriesRef("");
              }}
            >
              <option value="">不指定</option>
              {data.series
                .filter((s: any) => s.artistId === artistId)
                .map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
            </select>
          </label>
          {seriesId && !status.configured && (
            <label>
              系列别名
              <input
                required
                value={seriesRef}
                pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,79}"
                onChange={(e) => setSeriesRef(e.target.value)}
              />
            </label>
          )}
        </div>
        <button disabled={busy || (!status.configured && !artistId)}>
          {status.configured ? "恢复本地收件" : "配置本地收件通道"}
        </button>
        {status.active && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await call("inbox.pause");
                await refresh();
              } catch {
                setError("暂停失败，请重试。");
              } finally {
                setBusy(false);
              }
            }}
          >
            暂停收件
          </button>
        )}
      </form>
      {status.root && (
        <p>
          固定目录：<code>{status.root}</code> ·{" "}
          {status.lastScanAt ? `最近扫描 ${status.lastScanAt}` : "尚无扫描记录"}
        </p>
      )}
      {status.configured && (
        <details>
          <summary>父端投递所需通道信息</summary>
          <pre>{JSON.stringify(status.channel, null, 2)}</pre>
          <p>
            incoming 接收完整 JSON；receipts
            读取匹配内容哈希的回执。不得把文件写入成功当成已入库。
          </p>
        </details>
      )}
      {status.packageDelivery && (
        <details>
          <summary>歌词与封面包收件 · 本地通道</summary>
          <p>云端同步链路尚未验收；本地回执写入不代表云端已收到。</p>
          <button
            type="button"
            disabled={busy || !status.configured}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await call("inbox.bridge.chooseDirectory");
                await refresh();
              } catch {
                setError(
                  "同步目录未保存。请选择包含 incoming 和 receipts 的专用项目目录，并确认目录可用。",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {status.bridge?.configured
              ? "更换可信同步目录"
              : "选择可信同步目录"}
          </button>
          {!status.configured && <p>先配置本地收件通道，再选择同步目录。</p>}
          {status.bridge?.configured ? (
            <>
              <p>
                同步项目：<code>{status.bridge.projectRoot}</code> ·{" "}
                {status.bridge.enabled && status.active
                  ? "文件桥接已启用"
                  : "文件桥接已暂停"}
              </p>
              <p>
                只读 incoming 中的投递包；只向 receipts
                写入本地数据库已确认的回执。
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await call(
                      status.bridge.enabled
                        ? "inbox.bridge.pause"
                        : "inbox.bridge.resume",
                      { expectedRevision: status.bridge.revision },
                    );
                    await refresh();
                  } catch {
                    setError("桥接状态未变更，请检查目录及配置版本后重试。");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {status.bridge.enabled ? "暂停文件桥接" : "恢复文件桥接"}
              </button>
              {status.bridge.states.map((s: any) => (
                <p key={s.deliveryId}>
                  {s.deliveryId} ·{" "}
                  {s.state === "acknowledged"
                    ? "回执已写入同步目录（未核实云端）"
                    : s.state === "staged"
                      ? "文件已校验，等待私有收件入库"
                      : s.state === "receipt_waiting"
                        ? "回执等待写回同步目录"
                        : s.state === "waiting"
                          ? "等待文件同步或目录恢复"
                          : "桥接已拒收"}
                  {s.reason && ` · ${s.reason}`}
                </p>
              ))}
              {status.bridge.lastError && (
                <p role="alert">文件桥接：{status.bridge.lastError}</p>
              )}
            </>
          ) : (
            <p>同步路径未配置；等待登录 Google Drive 后选择实际项目目录。</p>
          )}
          <p>
            包目录：<code>{status.packageDelivery.root}</code>
          </p>
          <p>
            回执目录：<code>{status.packageDelivery.receiptsRoot}</code>
          </p>
          <p>
            每个投递目录包含
            text.json、封面、manifest.json、READY.json；必须通过哈希和图片解码校验，才会显示入库成功。收件不触发音乐生成、扣费或发布。
          </p>
          {!status.packageDelivery.states.length && <p>暂无封面包收件记录</p>}
          {status.packageDelivery.states.map((s: any) => (
            <p key={s.deliveryId}>
              {s.deliveryId} ·{" "}
              {s.state === "imported"
                ? "已入库 · 待模型评估"
                : s.state === "waiting"
                  ? "等待文件完整同步 / 稍后重试"
                  : "已拒收"}
              {s.reason && ` · ${s.reason}`}
              {s.nextAttemptAt && ` · 下次检查 ${s.nextAttemptAt}`}
            </p>
          ))}
          {status.packageDelivery.lastError && (
            <p role="alert">封面包收件：{status.packageDelivery.lastError}</p>
          )}
        </details>
      )}
      {(error || status.lastError) && (
        <p role="alert">{error || `收件异常：${status.lastError}`}</p>
      )}
      <div className="form-grid">
        <label>
          版本筛选
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="current">当前版本</option>
            <option value="all">所有版本</option>
          </select>
        </label>
        <label>
          搜索歌名 / 外部 ID
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      {!visible.length && <p>暂无文本候选</p>}
      {visible.map((c: any) => {
        const d = rows.drafts.find((d: any) => d.id === c.draftId)?.draft;
        return (
          <details className="panel" key={c.id}>
            <summary>
              {d?.title ?? c.externalItemId} · v{c.externalRevision} ·
              待模型评分
            </summary>
            <details>
              <summary>来源与接收记录</summary>
              <p>
                {c.externalItemId} · {c.isCurrent ? "当前版本" : "历史版本"} ·{" "}
                {c.importedAt}
              </p>
              <p>
                来源：本地通道 {c.source.channelId}；生产者声明{" "}
                {c.source.producerClaim}（未单独认证）
              </p>
            </details>
            <p>
              本地检查：
              {c.localCheck.status === "failed"
                ? "发现问题"
                : c.localCheck.status === "pending"
                  ? "需核实平台能力"
                  : "检查通过"}{" "}
              ·{" "}
              {c.lineageState === "lineage_pending"
                ? "等待父版本补交"
                : "版本关联完整"}
            </p>
            <p>
              {d?.language} · {d?.style} · {d?.storyBeat}
            </p>
            {c.cover && (
              <p>
                封面已接收 · v{c.cover.revision} · SHA256{" "}
                <code>{c.cover.sha256.slice(0, 12)}</code>
              </p>
            )}
            <pre>{d?.sections.flatMap((s: any) => s.lines).join("\n")}</pre>
            <h3>音乐提示词</h3>
            <p>{d?.musicPrompts.yourmusic.positiveStyle}</p>
            <button
              disabled={
                busy ||
                !c.isCurrent ||
                c.lineageState !== "complete" ||
                c.localCheck.status === "failed"
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await call("inbox.selectMusicInput", {
                    candidateId: c.id,
                    confirmed: true,
                  });
                  await refresh();
                  notify("已人工选入音乐输入；尚未模型评分，未提交音乐生成。");
                } catch {
                  setError("未能选入音乐输入，请检查候选版本和本地检查结果。");
                } finally {
                  setBusy(false);
                }
              }}
            >
              人工选入音乐输入（不生成）
            </button>
            <Badge>文本候选 · 无音频</Badge>
          </details>
        );
      })}
      {rows.musicInput && (
        <section className="panel" aria-label="已人工选入的音乐输入">
          <h3>{rows.musicInput.draft.title} · 已人工选入</h3>
          <details>
            <summary>来源与版本</summary>
            <p>
              来源：本地收件；外部版本{" "}
              {rows.musicInput.inputSelection.externalRevision}
              。来源模型声明尚未独立验证，尚未模型评分，生成仍受质量与预算限制。
            </p>
          </details>
          <pre>{rows.musicInput.pair.lyrics}</pre>
          <p>{rows.musicInput.pair.musicPrompt}</p>
          <MusicCandidates draft={rows.musicInput} />
        </section>
      )}
    </section>
  );
}
