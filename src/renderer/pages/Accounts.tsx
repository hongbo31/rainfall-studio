import React, { useState } from "react";
import { useStudio, PageHead, Badge, names, label } from "../context";
import ApiSettings from "../components/ApiSettings";
import HelpHint from "../components/HelpHint";
const blank = {
  genre: "流行",
  voice: "female",
  lyricTone: "细腻叙事",
  bpmMin: 72,
  bpmMax: 96,
  coverStyle: "暖紫雨夜",
  language: "中文",
  mood: "温柔",
  duration: 180,
  instruments: "钢琴、弦乐",
  seriesStory: "",
};
export default function Accounts({
  showApi = true,
  compact = false,
}: { showApi?: boolean; compact?: boolean } = {}) {
  const { data, call, importAsset, exportArtifact, runtime, notify } =
    useStudio();
  const [artistId, setArtistId] = useState(data.artists[0]?.id || "");
  const initial = data.artists.find((a: any) => a.id === artistId);
  const [name, setName] = useState(initial?.name || ""),
    [defaults, setDefaults] = useState(initial?.defaults || blank);
  const [provider, setProvider] = useState("suno"),
    [accountName, setAccountName] = useState(""),
    [limit, setLimit] = useState(3),
    [bindArtist, setBindArtist] = useState(data.artists[0]?.id || ""),
    [bindAccount, setBindAccount] = useState("");
  const [cost, setCost] = useState(data.budget.costLimit / 100),
    [candidates, setCandidates] = useState(data.budget.candidateLimit);
  const choose = (id: string) => {
    setArtistId(id);
    const a = data.artists.find((a: any) => a.id === id);
    setName(a?.name || "");
    setDefaults(a?.defaults || blank);
  };
  return (
    <>
      {!compact && <PageHead title="账号与艺人" />}
      {showApi && <ApiSettings compact={compact} />}
      <div className="split">
        <section className="panel">
          <h2>艺人资料与创作默认值</h2>
          <label>
            选择艺人
            <select value={artistId} onChange={(e) => choose(e.target.value)}>
              {data.artists.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="">＋ 新建艺人</option>
            </select>
          </label>
          <label>
            艺名
            <input
              aria-label="艺名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="form-grid">
            {[
              ["genre", "曲风"],
              ["lyricTone", "歌词语气"],
              ["language", "语言"],
              ["mood", "情绪"],
              ["coverStyle", "封面风格"],
              ["instruments", "主要乐器"],
              ["seriesStory", "系列长期故事线"],
            ].map(([key, title]) => (
              <label key={key}>
                {title}
                <input
                  value={defaults[key]??""}
                  onChange={(e) =>
                    setDefaults({ ...defaults, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <label>
              默认人声
              <select
                value={defaults.voice}
                onChange={(e) =>
                  setDefaults({ ...defaults, voice: e.target.value })
                }
              >
                <option value="female">女声</option>
                <option value="male">男声</option>
                <option value="duet">对唱</option>
                <option value="instrumental">纯音乐</option>
              </select>
            </label>
            {[
              ["bpmMin", "BPM 下限"],
              ["bpmMax", "BPM 上限"],
              ["duration", "时长参考（秒）"],
            ].map(([key, title]) => (
              <label key={key}>
                {title}
                <input
                  type="number"
                  value={defaults[key]??""}
                  onChange={(e) =>
                    setDefaults({ ...defaults, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <button
            className="primary"
            disabled={!name}
            onClick={async () => {
              const a = await call("artist.save", {
                ...(artistId
                  ? { id: artistId, expected: initial.revision }
                  : {}),
                name,
                defaults,
              });
              setArtistId(a.id);
              notify("已保存艺人配置；已有任务的冻结配置不变。");
            }}
          >
            保存艺人配置
          </button>
        </section>
        <div>
          <section className="panel">
            <h2>添加账号资料</h2>
            <HelpHint label="本地账号说明">
              仅保存身份与本地配额配置，不会登录、绑定真实账号或伪造授权。账号隔离用于防串号，不规避平台限制。
            </HelpHint>
            <label>
              平台
              <select
                aria-label="平台"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {Object.entries(names).map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              账号备注名
              <input
                aria-label="账号备注名"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="例如：个人发行账号"
              />
            </label>
            <label>
              每日提交本地上限
              <input
                type="number"
                min="0"
                max="10000"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </label>
            <button
              disabled={!accountName}
              onClick={async () => {
                await call("account.save", {
                  provider,
                  name: accountName,
                  dailyLimit: limit,
                });
                setAccountName("");
              }}
            >
              保存本地账号资料
            </button>
            <HelpHint label="本地上限说明">
              这个上限是你的本地设置，不代表官方平台配额或许可。
            </HelpHint>
          </section>
          <section className="panel">
            <h2>艺人与账号绑定</h2>
            <div className="form-grid">
              <label>
                艺人
                <select
                  value={bindArtist}
                  onChange={(e) => setBindArtist(e.target.value)}
                >
                  {data.artists.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                平台账号
                <select
                  aria-label="平台账号"
                  value={bindAccount}
                  onChange={(e) => setBindAccount(e.target.value)}
                >
                  <option value="">选择账号</option>
                  {data.accounts.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {names[a.provider]} · {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              disabled={!bindAccount || !bindArtist}
              onClick={() => {
                const a = data.accounts.find((a: any) => a.id === bindAccount);
                void call("binding.save", {
                  artistId: bindArtist,
                  accountId: bindAccount,
                  targets:
                    a.provider === "tme" ? ["qqmusic", "kugou"] : [a.provider],
                });
              }}
            >
              建立本地绑定
            </button>
            <HelpHint label="绑定说明">
              生效能力仍取平台资格、账号权限、绑定和本次确认范围的交集。
            </HelpHint>
          </section>
        </div>
      </div>
      <section className="panel">
        <h2>账号身份与授权状态</h2>
        {data.accounts.map((a: any) => (
          <div className="account-card" key={a.id}>
            <div className="section-title">
              <div>
                <h3>
                  {names[a.provider]} · {a.name}
                </h3>
                <p>平台余额：未知 · 发布权限：未接入 · 数据权限：未接入</p>
              </div>
              <Badge>{label(a.authStatus)}</Badge>
            </div>
            {data.bindings
              .filter((b: any) => b.accountId === a.id)
              .map((b: any) => (
                <div className="row" key={b.id}>
                  <div>
                    {data.artists.find((x: any) => x.id === b.artistId)?.name}
                    <small>
                      目标 {b.targets.map((x: string) => names[x]).join(" / ")}{" "}
                      ·{" "}
                      {b.status === "revoked" ? "已撤销" : "仅本地准备 / 演练"}
                    </small>
                  </div>
                  <button
                    disabled={b.status === "revoked"}
                    onClick={() => call("binding.revoke", { id: b.id })}
                  >
                    撤销绑定
                  </button>
                </div>
              ))}
            <button onClick={() => window.rainfall.openOfficial(a.provider)}>
              打开官方页面 ↗
            </button>
          </div>
        ))}
        {!data.accounts.length && (
          <p>暂无账号资料</p>
        )}
      </section>
      <section className="panel">
        <h2>预算与配额</h2>
        <div className="form-grid">
          <label>
            每日生成成本本地上限（元）
            <input
              type="number"
              min="0"
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
            />
          </label>
          <label>
            每日候选版本上限
            <input
              type="number"
              min="0"
              value={candidates}
              onChange={(e) => setCandidates(Number(e.target.value))}
            />
          </label>
        </div>
        <button
          onClick={() =>
            call("budget.save", {
              costLimit: Math.round(cost * 100),
              candidateLimit: candidates,
            })
          }
        >
          保存本地预算
        </button>
        <HelpHint label="预算说明">
          成本与候选上限、计划成品目标、每平台账号提交配额分别计数。未知消耗保留预占；审核驳回不退已提交次数。保存本地预算不会授予扣费权；生成任务单独核对提供商价格与本次授权。
        </HelpHint>
        {data.resources.submissions.map((r: any) => (
          <div className="row" key={r.id}>
            <span>
              {r.kind === "submission_route" ? "路线请求" : "目标提交"} ·{" "}
              {r.date}
              <small>{r.scope}</small>
            </span>
            <span>
              已用 {r.spent} / 预占 {r.reserved} / 上限 {r.limit}
            </span>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>备份、迁移与本地诊断</h2>
        <div className="button-row">
          <button onClick={() => exportArtifact("backup")}>导出完整备份</button>
          <button
            onClick={() => {
              if (
                confirm(
                  "恢复会替换当前工作区，旧库保留。计划暂停、发布确认失效、账号需重新授权。继续选择备份？",
                )
              )
                void importAsset("backup");
            }}
          >
            从备份恢复
          </button>
          <button onClick={() => importAsset("legacy")}>导入原型 JSON</button>
          <button onClick={() => exportArtifact("diagnostics")}>
            导出脱敏诊断
          </button>
        </div>
        <HelpHint label="恢复与迁移说明">
          恢复只接受同模式备份；不恢复可执行授权、不自动重发。原型 JSON
          导入请切换模拟工作区，旧音频 blob 需要重新导入。
        </HelpHint>
        <label>
          实际素材与数据库目录
          <input readOnly value={runtime.root} />
        </label>
        <details>
          <summary>运行环境</summary>
          <p>
            Electron {runtime.versions?.electron} · Node{" "}
            {runtime.versions?.node} ·{" "}
            {runtime.packaged ? "打包运行" : "开发运行"} · FFmpeg{" "}
            {data.tools.ffmpeg ? "已检测" : "缺失，仅视频包装受阻"}
          </p>
        </details>
      </section>
    </>
  );
}
