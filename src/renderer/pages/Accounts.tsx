import React, { useState } from "react";
import { useStudio, PageHead } from "../context";
import ApiSettings from "../components/ApiSettings";
import HelpHint from "../components/HelpHint";
import ChoiceButtons from "../components/ChoiceButtons";
import MusicStylePicker from "../components/MusicStylePicker";
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
      {!compact && <PageHead title="艺人与预算" />}
      {showApi && <ApiSettings compact={compact} />}
      <section className="panel">
        <h2>艺人资料与创作默认值</h2>
        <ChoiceButtons
          label="本地艺人"
          value={artistId}
          onChange={choose}
          choices={[
            ...data.artists.map((a: any) => ({ value: a.id, label: a.name })),
            { value: "", label: "＋ 新建艺人" },
          ]}
        />
        <label>
          艺名
          <input
            aria-label="艺名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <MusicStylePicker
          value={defaults.genre ?? ""}
          onChange={(genre) => setDefaults({ ...defaults, genre })}
        />
        <div className="form-grid">
          {[
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
                value={defaults[key] ?? ""}
                onChange={(e) =>
                  setDefaults({ ...defaults, [key]: e.target.value })
                }
              />
            </label>
          ))}
          <div>
            <span>默认人声</span>
            <ChoiceButtons
              label="默认人声"
              value={defaults.voice}
              onChange={(voice) => setDefaults({ ...defaults, voice })}
              choices={[
                { value: "female", label: "女声" },
                { value: "male", label: "男声" },
                { value: "duet", label: "对唱" },
                { value: "instrumental", label: "纯音乐" },
              ]}
            />
          </div>
          {[
            ["bpmMin", "BPM 下限"],
            ["bpmMax", "BPM 上限"],
            ["duration", "时长参考（秒）"],
          ].map(([key, title]) => (
            <label key={key}>
              {title}
              <input
                type="number"
                value={defaults[key] ?? ""}
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
              ...(artistId ? { id: artistId, expected: initial.revision } : {}),
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
