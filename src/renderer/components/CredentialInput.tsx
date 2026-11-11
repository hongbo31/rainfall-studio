import React, {useState} from 'react';
/** Shows only the new, ephemeral input. It has no stored-credential read interface. */
export default function CredentialInput({value,onChange,disabled,configured,initialVisible=false}:{value:string;onChange:(value:string)=>void;disabled:boolean;configured:boolean;initialVisible?:boolean}){
  const [visible,setVisible]=useState(initialVisible);
  return <div className="credential-input">
    <label>新的 API Key
      <input aria-label="新的 API Key" type={visible?'text':'password'} value={value}
        disabled={disabled} autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={100000}
        placeholder={configured?'输入新 Key 以替换；已有内容不回显':'仅在本机加密保存'} onChange={e=>onChange(e.target.value)} />
    </label>
    <button type="button" aria-pressed={visible} disabled={disabled} onClick={()=>setVisible(v=>!v)}>{visible?'隐藏输入':'显示输入'}</button>
  </div>;
}
