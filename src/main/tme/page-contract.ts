export type TmePageContract={
 version:string;verified:boolean;source:'browser'|'fixture';origin:string;
 subject:string;displayName:string;draftId:string;status:string;reason:string;
 uploads:Record<'audio'|'cover'|'proof',string>;
};
// No guessed selectors may authorize a production mutation. Live calibration is required.
export const TME_PAGE_CONTRACT:TmePageContract={
 version:'tme-unverified-2026-10-16',verified:false,source:'browser',origin:'https://y.tencentmusic.com',
 subject:'',displayName:'',draftId:'',status:'',reason:'',uploads:{audio:'',cover:'',proof:''},
};
export const TME_FORM_LABELS={title:'歌曲名称',lyricist:'作词',composer:'作曲',aiMusic:'是否AI音乐',aiTool:'AI工具',generatedOn:'生成日期',lyrics:'歌词',statement:'音乐人说'} as const;
