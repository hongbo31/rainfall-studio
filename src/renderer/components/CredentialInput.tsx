import React, { useRef, useState } from "react";

export default function CredentialInput({ value, onChange, disabled, configured, initialVisible = false,
  label = "新的 API Key", masked }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  configured: boolean;
  initialVisible?: boolean;
  label?: string;
  masked?: { value: string; onReplace: () => void };
}) {
  const [visible, setVisible] = useState(initialVisible);
  const input = useRef<HTMLInputElement>(null);
  return <div className="credential-input">
    <label>{label}
      <input ref={input} aria-label={label} type={masked || visible ? "text" : "password"}
        value={masked?.value ?? value} readOnly={!!masked} disabled={disabled}
        autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={100000}
        placeholder={configured ? "输入新 Key 以替换" : "仅在本机加密保存"}
        onChange={masked ? undefined : event => onChange(event.target.value)} />
    </label>
    {masked ? <button type="button" disabled={disabled} onClick={() => {
      setVisible(false);
      masked.onReplace();
      input.current?.focus();
    }}>更换 Key</button> : <button type="button" aria-pressed={visible} disabled={disabled}
      onClick={() => setVisible(value => !value)}>{visible ? "隐藏输入" : "显示输入"}</button>}
  </div>;
}
