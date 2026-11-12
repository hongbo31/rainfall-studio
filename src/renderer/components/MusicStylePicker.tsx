import React, { useState } from "react";

const genres = [
  "华语流行",
  "民谣",
  "R&B",
  "City Pop",
  "爵士",
  "摇滚",
  "电子",
  "国风",
  "乡村",
];
const moods = ["温暖", "浪漫", "欢快", "治愈", "复古", "忧郁"];
const arrangement = ["木吉他", "钢琴", "弦乐", "合成器", "强节奏", "轻鼓组"];
const key = (value: string) => value.normalize("NFKC").toLowerCase();

function tagsOf(value: string) {
  const tags = new Map<string, string>();
  for (const part of value.split(/[,，、；;\r\n]+/u)) {
    const tag = part.trim();
    if (tag && !tags.has(key(tag))) tags.set(key(tag), tag);
  }
  return [...tags.values()];
}

export default function MusicStylePicker({
  label = "风格混搭",
  value,
  onChange,
  inherited,
  maxLength = 200,
  disabled = false,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  inherited?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const selected = tagsOf(value);
  const selectedKeys = new Set(selected.map(key));
  const change = (tags: string[]) => {
    const next = tags.join("、");
    if (next.length > maxLength) {
      setError(`风格描述最多 ${maxLength} 字，请精简后再添加。`);
      return false;
    }
    setError("");
    onChange(next);
    return true;
  };
  const addCustom = () => {
    if (change(tagsOf([value, custom].join("、")))) setCustom("");
  };
  const choices = (tags: string[], group: string) => (
    <div className="choice-buttons" role="group" aria-label={group}>
      {tags.map((tag) => {
        const chosen = selectedKeys.has(key(tag));
        return (
          <button
            key={tag}
            type="button"
            className="choice-button"
            aria-pressed={chosen}
            onClick={() =>
              change(
                chosen
                  ? selected.filter((item) => key(item) !== key(tag))
                  : [...selected, tag],
              )
            }
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
  return (
    <fieldset className="music-style-picker" disabled={disabled}>
      <legend>{label}</legend>
      <div
        className="choice-buttons style-selection"
        role="group"
        aria-label="已选风格"
      >
        {selected.map((tag) => (
          <button
            type="button"
            key={key(tag)}
            className="choice-button selected-tag"
            aria-label={"移除 " + tag}
            onClick={() =>
              change(selected.filter((item) => key(item) !== key(tag)))
            }
          >
            {tag}
            <span aria-hidden="true">×</span>
          </button>
        ))}
        {!selected.length && inherited && <small>默认 {inherited}</small>}
      </div>
      {choices(genres, "常用曲风")}
      <details>
        <summary>情绪与编曲</summary>
        {choices(moods, "情绪")}
        {choices(arrangement, "编曲")}
      </details>
      <div className="style-custom">
        <input
          aria-label="自定义风格"
          placeholder="添加自定义风格"
          value={custom}
          maxLength={maxLength}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (custom.trim()) addCustom();
            }
          }}
        />
        <button type="button" disabled={!custom.trim()} onClick={addCustom}>
          添加
        </button>
      </div>
      <details>
        <summary>编辑完整描述</summary>
        <textarea
          aria-label={label}
          rows={2}
          maxLength={maxLength}
          value={value}
          onChange={(event) => {
            setError("");
            onChange(event.target.value);
          }}
        />
      </details>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
