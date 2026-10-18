import React, { useState } from "react";
import HelpNote from "./HelpNote";
import { useStudio, date } from "../context";
import {
  TmeObservationInputSchema,
  tmeObservationStatusNames,
  type TmeObservation,
  type TmeObservationInput,
} from "../../shared/tme-observations";

export default function TmeObservationReport({
  accountId,
}: {
  accountId: string;
}) {
  const { data, selected, call } = useStudio();
  const [workId, setWorkId] = useState(selected[0] || "");
  const [visibleAccount, setVisibleAccount] = useState("");
  const [status, setStatus] =
    useState<TmeObservationInput["status"]>("unknown");
  const [remoteId, setRemoteId] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [observedAt, setObservedAt] = useState(() => new Date().toISOString());
  const [summary, setSummary] = useState("");
  const [reference, setReference] = useState("");
  const [evidenceSha, setEvidenceSha] = useState("");
  const [pcmSha, setPcmSha] = useState("");
  const [derivationNote, setDerivationNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState<TmeObservation[]>([]);
  const work = (data.works || []).find((item: any) => item.id === workId);
  const sourceASha = (data.assets || []).find(
    (asset: any) => asset.id === work?.assets?.audio_A,
  )?.sha256;
  const records = [
    ...new Map<string, TmeObservation>(
      [...(data.tmeObservations || []), ...saved].map(
        (item: TmeObservation) => [item.id, item] as [string, TmeObservation],
      ),
    ).values(),
  ]
    .filter(
      (item) =>
        item.accountId === accountId && (!workId || item.workId === workId),
    )
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  return (
    <section className="panel" data-testid="tme-official-observations">
      <h2>官方页面观察回执</h2>
      <HelpNote label="观察证据说明">
        保存官方页面的实际状态和证据，未经过 API
        核实，不代表客户端提交。昵称和本地账户备注不能证明唯一腾讯账户，也不能验证同一录音。
      </HelpNote>
      <details>
        <summary>登记一次页面观察</summary>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setMessage("");
            try {
              const input = TmeObservationInputSchema.parse({
                workId,
                accountId,
                visibleAccount,
                status,
                remoteId: remoteId.trim() || null,
                officialUrl,
                observedAt,
                evidence: {
                  summary,
                  reference,
                  sha256: evidenceSha.trim().toLowerCase(),
                },
                ...(pcmSha.trim()
                  ? {
                      audioEvidence: {
                        sourceASha256: sourceASha,
                        pcmSha256: pcmSha.trim().toLowerCase(),
                        derivation: "pcm_format_compatibility",
                        note: derivationNote,
                      },
                    }
                  : {}),
              });
              const result = await call("tme.observations.record", input);
              setSaved((items) => [
                ...items.filter((item) => item.id !== result.id),
                result,
              ]);
              setMessage(
                "观察已保存为用户录入证据；没有发起平台提交。相同证据重复保存只保留一条。",
              );
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "观察保存失败",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              本地作品
              <select
                required
                value={workId}
                onChange={(event) => {
                  setWorkId(event.target.value);
                  setPcmSha("");
                  setDerivationNote("");
                }}
              >
                <option value="">选择对应作品</option>
                {(data.works || []).map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              页面可见账户名称
              <input
                required
                maxLength={200}
                value={visibleAccount}
                onChange={(event) => setVisibleAccount(event.target.value)}
              />
            </label>
            <label>
              页面实际状态
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as TmeObservationInput["status"])
                }
              >
                {Object.entries(tmeObservationStatusNames).map(
                  ([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              远端歌曲或提交 ID（页面未显示则留空）
              <input
                maxLength={300}
                value={remoteId}
                onChange={(event) => setRemoteId(event.target.value)}
              />
            </label>
            <label>
              实际官方页面 HTTPS 地址
              <input
                required
                type="url"
                value={officialUrl}
                onChange={(event) => setOfficialUrl(event.target.value)}
                placeholder="https://y.tencentmusic.com/#/..."
              />
            </label>
            <label>
              观察时间（ISO UTC，带 Z）
              <input
                required
                value={observedAt}
                onChange={(event) => setObservedAt(event.target.value)}
              />
            </label>
          </div>
          <label>
            实际看到的证据与状态（至少 10 字）
            <textarea
              required
              minLength={10}
              maxLength={4000}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          <label>
            证据文件路径或引用
            <input
              required
              maxLength={2000}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
          <label>
            证据 SHA-256
            <input
              required
              pattern="[a-fA-F0-9]{64}"
              value={evidenceSha}
              onChange={(event) => setEvidenceSha(event.target.value)}
            />
          </label>
          <HelpNote label="证据文件说明">
            请保留原始截图或记录文件。这里保存引用和录入的摘要，不复制证据文件，也不替代文件核验。准备完成、提交成功、审核中和已发行应分别按页面事实登记。
          </HelpNote>
          <details>
            <summary>原 A → PCM 格式兼容文件（可选音源证据）</summary>
            <p>原 A SHA-256：{sourceASha || "本地作品未提供音源摘要"}</p>
            <label>
              PCM WAV SHA-256
              <input
                disabled={!sourceASha}
                pattern="[a-fA-F0-9]{64}"
                value={pcmSha}
                onChange={(event) => setPcmSha(event.target.value)}
              />
            </label>
            <label>
              转换过程说明
              <textarea
                required={!!pcmSha.trim()}
                minLength={5}
                maxLength={2000}
                value={derivationNote}
                onChange={(event) => setDerivationNote(event.target.value)}
              />
            </label>
            <HelpNote label="音源关系说明">
              该记录声明文件派生关系，不证明原生无损质量，也不自动确认远端是同一录音。
            </HelpNote>
          </details>
          <button
            type="submit"
            disabled={
              busy || data.mode !== "production" || !workId || !accountId
            }
          >
            {busy ? "正在保存观察…" : "保存观察证据"}
          </button>
          {!accountId && <p>先选择本地腾讯账户备注，以便关联证据。</p>}
          {message && <p role="status">{message}</p>}
        </form>
      </details>
      {records.map((record) => (
        <article className="account-card" key={record.id}>
          <strong>
            {record.title} · {tmeObservationStatusNames[record.status]}
          </strong>
          <p>
            {record.remoteId || "未显示远端 ID"} · {date(record.observedAt)} ·
            用户录入的官方页面观察
          </p>
          <p>{record.evidence.summary}</p>
          <small>
            {record.evidence.reference} · 证据 SHA-256 {record.evidence.sha256}
          </small>
          {record.audioEvidence && (
            <p>
              原 A → PCM：{record.audioEvidence.sourceASha256} →{" "}
              {record.audioEvidence.pcmSha256}
            </p>
          )}
          <p>用户观察 · 录音未核实</p>
        </article>
      ))}
    </section>
  );
}
