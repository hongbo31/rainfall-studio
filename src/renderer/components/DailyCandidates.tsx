import HelpNote from "./HelpNote";
import React, { useEffect, useState } from "react";
import { useStudio, SelectArtist, Badge, localMusicians } from "../context";
import { workflowLabel } from "../workflow-labels";
export default function DailyCandidates() {
  const { data, call, notify } = useStudio();
  const [rows, setRows] = useState<any>({ plans: [], occurrences: [] }),
    [artistId, setArtist] = useState(localMusicians(data)[0]?.id ?? ""),
    [seriesId, setSeries] = useState(""),
    [time, setTime] = useState(""),
    [zone, setZone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [count, setCount] = useState(""),
    [textBudget, setTextBudget] = useState(""),
    [musicBudget, setMusicBudget] = useState(""),
    [missed, setMissed] = useState("skip"),
    [hours, setHours] = useState(""),
    [maxCatch, setMaxCatch] = useState("");
  const refresh = async () => setRows(await call("dailyPlan.list"));
  useEffect(() => {
    void refresh();
  }, []);
  const number = (s: string) => (s === "" ? null : Number(s));
  return (
    <section className="panel">
      <h2>候选计划</h2>
      <Badge>草稿 · 未启用</Badge>
      <HelpNote label="计划草稿说明">
        时间、候选上限与预算未填写时保持为空。保存只创建草稿，不启用日程、不注册登录启动或系统任务。关机、睡眠、注销期间不会运行。
      </HelpNote>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await call("dailyPlan.save", {
            expectedRevision: null,
            plan: {
              id: crypto.randomUUID(),
              artistId,
              seriesId: seriesId || null,
              timezone: zone,
              localTime: time || null,
              candidateLimit: number(count),
              textBudget: number(textBudget),
              musicBudget: number(musicBudget),
              textProfileId: null,
              musicProfileId: null,
              missedPolicy: missed,
              catchUpHours: number(hours),
              maxCatchUpPerDay: number(maxCatch),
              enabled: false,
              authorizationRevision: null,
            },
          });
          notify("已保存禁用的计划草稿");
          await refresh();
        }}
      >
        <SelectArtist value={artistId} onChange={setArtist} />
        <label>
          系列
          <select value={seriesId} onChange={(e) => setSeries(e.target.value)}>
            <option value="">独立创作</option>
            {data.series.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            每日当地时间
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <label>
            IANA 时区
            <input
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              required
            />
          </label>
          <label>
            每轮候选上限
            <input
              type="number"
              min="0"
              max="100"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              placeholder="待确认"
            />
          </label>
          <label>
            文本预算上限
            <input
              type="number"
              min="0"
              value={textBudget}
              onChange={(e) => setTextBudget(e.target.value)}
              placeholder="待确认单位与金额"
            />
          </label>
          <label>
            音乐预算上限
            <input
              type="number"
              min="0"
              value={musicBudget}
              onChange={(e) => setMusicBudget(e.target.value)}
              placeholder="待确认单位与金额"
            />
          </label>
        </div>
        <HelpNote label="候选预算说明">
          本地草稿数值只供预览；实际货币/credits、费率上界、工作区总额与账户证据未确认前不能授权收费。模拟内部测试使用独立
          fixture credit。
        </HelpNote>
        <label>
          漏跑策略
          <select value={missed} onChange={(e) => setMissed(e.target.value)}>
            <option value="skip">跳过历史日期</option>
            <option value="bounded_catch_up">有界补跑（需填写范围）</option>
          </select>
        </label>
        {missed === "bounded_catch_up" && (
          <div className="form-grid">
            <label>
              最多回看小时
              <input
                type="number"
                min="1"
                max="168"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </label>
            <label>
              每天最多补跑次数
              <input
                type="number"
                min="1"
                max="5"
                value={maxCatch}
                onChange={(e) => setMaxCatch(e.target.value)}
              />
            </label>
          </div>
        )}
        <button disabled={!artistId}>保存计划草稿</button>
      </form>
      {rows.plans.map((p: any) => (
        <article className="panel" key={p.id}>
          <h3>
            {p.localTime ?? "时间待确认"} · {p.timezone}
          </h3>
          <Badge>草稿 · 未启用</Badge>
          <p>候选上限 {p.candidateLimit ?? "待确认"}</p>
          <ul>
            {p.preview.next.map((n: any) => (
              <li key={n.utc}>
                {n.localDate} {n.localTime} · UTC {n.utc} · offset {n.offset}
              </li>
            ))}
          </ul>
          <details>
            <summary>启用阻塞原因</summary>
            {p.preview.reasons.map((r: string) => (
              <p key={r}>{workflowLabel(r)}</p>
            ))}
          </details>
          <button disabled>自动执行未开放</button>
        </article>
      ))}
      {rows.occurrences.length > 0 && (
        <p>
          已记录 {rows.occurrences.length}{" "}
          次到期/漏跑事件
        </p>
      )}
    </section>
  );
}
