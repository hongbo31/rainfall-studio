import React, { useEffect, useState } from "react";
import {
  artistProfileSchema,
  artistWeightRange,
  secondSingerSchema,
  type ArtistProfile,
  type SecondSinger,
} from "../../shared/local-artist";
import type { PromptSummary } from "../../shared/prompt-library";
import { useStudio } from "../context";

export type ArtistProfileDraft = Pick<ArtistProfile, "lyricist" | "composer" | "singer"> & {
  gender: NonNullable<ArtistProfile["gender"]> | "";
  voicePersona: string;
  timbreWeight: string;
  styleWeight: string;
  contractMode: ArtistProfile["contractMode"] | "";
  secondSinger: SecondSinger | null;
};

export const emptyProfile: ArtistProfileDraft = {
  lyricist: "", composer: "", singer: "", contractMode: "", gender: "", voicePersona: "",
  timbreWeight: "", styleWeight: "", secondSinger: null,
};
const editorProfileSchema = artistProfileSchema.extend({ secondSinger: secondSingerSchema.nullable() });
const weightFields = [
  ["timbreWeight", "音色权重"],
  ["styleWeight", "风格权重"],
] as const;

export function formatCoverResolution(size?: number) {
  return size === undefined ? "" : size + " × " + size;
}

export function profileDraft(profile?: ArtistProfile, secondSinger?: SecondSinger): ArtistProfileDraft {
  return {
    ...emptyProfile,
    ...profile,
    gender: profile?.gender ?? "",
    voicePersona: profile?.voicePersona ?? "",
    timbreWeight: profile?.timbreWeight?.toString() ?? "",
    styleWeight: profile?.styleWeight?.toString() ?? "",
    secondSinger: secondSinger ? { name: secondSinger.name } : null,
  };
}

export function readProfile(draft: ArtistProfileDraft) {
  const { gender, voicePersona, timbreWeight, styleWeight, secondSinger, ...required } = draft;
  const timbre = voicePersona.trim();
  return editorProfileSchema.safeParse({
    ...required,
    ...(gender ? { gender } : {}),
    ...(timbre ? { voicePersona: timbre } : {}),
    ...(timbreWeight !== "" ? { timbreWeight: Number(timbreWeight) } : {}),
    ...(styleWeight !== "" ? { styleWeight: Number(styleWeight) } : {}),
    secondSinger,
  });
}

export function ArtistPromptSelect({ value, onChange, disabled }: {
  value: string;
  onChange?: (id: string) => void;
  disabled?: boolean;
}) {
  const { call, data } = useStudio();
  const [prompts, setPrompts] = useState<PromptSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setPrompts(null);
    setFailed(false);
    void call("promptLibrary.list").then((items: PromptSummary[]) => {
      if (active) setPrompts(items);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [call, data.mode, attempt]);

  return (
    <div>
      <label>
        提示词引擎
        <select value={value} disabled={disabled || !onChange || (!prompts && !failed)} onChange={event => onChange?.(event.target.value)}>
          <option value="">{!prompts && !failed ? "正在读取…" : "未关联"}</option>
          {value && !prompts?.some(prompt => prompt.id === value) && (
            <option value={value} disabled>{prompts ? "提示词已删除" : "已关联提示词"}</option>
          )}
          {prompts?.map(prompt => <option key={prompt.id} value={prompt.id}>{prompt.name}</option>)}
        </select>
      </label>
      {prompts?.length === 0 && <p className="muted">请在配置中心的「提示词管理」中添加提示词。</p>}
      {failed && <button type="button" disabled={disabled} onClick={() => setAttempt(attempt + 1)}>重新读取提示词</button>}
    </div>
  );
}

export default function ArtistProfileFields({
  value,
  onChange,
  required = false,
}: {
  value: ArtistProfileDraft;
  onChange?: (profile: ArtistProfileDraft) => void;
  required?: boolean;
}) {
  const readOnly = !onChange;
  return (
    <>
      {([
        ["lyricist", "默认词作者"],
        ["composer", "默认曲作者"],
      ] as const).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            required={required}
            readOnly={readOnly}
            maxLength={500}
            value={value[key]}
            onChange={(event) => onChange?.({ ...value, [key]: event.target.value })}
          />
        </label>
      ))}
      <label>
        签约模式
        <select
          required={required}
          disabled={readOnly}
          value={value.contractMode}
          onChange={(event) => onChange?.({
            ...value,
            contractMode: event.target.value as ArtistProfileDraft["contractMode"],
          })}
        >
          <option value="">请选择</option>
          <option value="exclusive">独家签约</option>
          <option value="non_exclusive">非独家签约</option>
        </select>
      </label>
      <label>
        歌手数量
        <select disabled={readOnly} value={value.secondSinger ? "2" : "1"} onChange={(event) => onChange?.({
          ...value,
          secondSinger: event.target.value === "2" ? { name: "" } : null,
        })}>
          <option value="1">1 位</option>
          <option value="2">2 位</option>
        </select>
      </label>
      <div className="artist-singer-fields">
        <label>
          {value.secondSinger ? "A 版歌手" : "默认歌手"}
          <input required={required} readOnly={readOnly} maxLength={500} value={value.singer}
            onChange={event => onChange?.({ ...value, singer: event.target.value })} />
        </label>
        {value.secondSinger && <label>
          B 版歌手
          <input required={required} readOnly={readOnly} maxLength={500} value={value.secondSinger.name}
            onChange={event => onChange?.({ ...value, secondSinger: { name: event.target.value } })} />
        </label>}
      </div>
      <label>
        性别
        <select disabled={readOnly} value={value.gender} onChange={event => onChange?.({
          ...value, gender: event.target.value as ArtistProfileDraft["gender"],
        })}>
          <option value="">未设置</option>
          <option value="female">女</option>
          <option value="male">男</option>
          <option value="other">其他</option>
        </select>
      </label>
      <label>
        音色
        <textarea className="artist-voice-persona" readOnly={readOnly} rows={1} maxLength={500} value={value.voicePersona}
          onChange={event => onChange?.({ ...value, voicePersona: event.target.value })} />
      </label>
      {weightFields.filter(([key]) => !readOnly || value[key] !== "").map(([key, label]) => (
        <label key={key}>
          {label}
          <input type="number" {...artistWeightRange} step="any" readOnly={readOnly} value={value[key]}
            placeholder={`${artistWeightRange.min}–${artistWeightRange.max}%`}
            onChange={event => onChange?.({ ...value, [key]: event.target.value })} />
        </label>
      ))}
    </>
  );
}
