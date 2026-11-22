import React from "react";
import { fanqieDownloadBatchLimit } from "../../shared/fanqie-downloads";

export type FanqieBatchDraft = { limit: string; signContract: boolean };

export default function FanqieBatchFields({ value, valid, disabled, onChange }: {
  value: FanqieBatchDraft;
  valid: boolean;
  disabled?: boolean;
  onChange: (changes: Partial<FanqieBatchDraft>) => void;
}) {
  return <>
    <div className="form-grid">
      <label>每批上传上限<input type="number" required min={1} max={fanqieDownloadBatchLimit} step={1} value={value.limit}
        aria-invalid={!valid} disabled={disabled} onChange={event => onChange({ limit: event.target.value })} /></label>
      <label>是否签约<select value={String(value.signContract)} disabled={disabled}
        onChange={event => onChange({ signContract: event.target.value === "true" })}>
        <option value="true">是，签署后继续</option>
        <option value="false">否，合同生成后继续</option>
      </select></label>
    </div>
    {!valid && <p className="notice" role="alert">每批上传上限须为 1–{fanqieDownloadBatchLimit} 的整数。</p>}
  </>;
}
