import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Context } from "../../src/renderer/context";
import CoverStudio from "../../src/renderer/pages/CoverStudio";
import { LyricsPublicationPanel } from "../../src/renderer/components/LyricsPublicationPanel";
export function renderLyrics() {
  function SeededLyrics(){
    const internals=(React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,previous=internals.H;
    let index=0;const values=[{raw:'原创演唱文本',cleaned:'原创演唱文本',source:{kind:'manual'},removed:[],warnings:[],audioHash:'audio-hash',versionId:'version-1',plainHash:'plain-hash',versions:[],alignmentConfirmed:false},false,false];
    internals.H={...previous,useState:()=>[values[index++],()=>{}]};
    try{return LyricsPublicationPanel({workId:'fixture-work',beforeAction:async()=>{},onChanged:async()=>{}})}finally{internals.H=previous}
  }
  return renderToStaticMarkup(
    <Context.Provider
      value={
        {
          data: { works: [{ id: "fixture-work", assets: {} }] },
          call: async () => {},
          importAsset: async () => {},
          notify: () => {},
        } as any
      }
    >
      <SeededLyrics />
    </Context.Provider>,
  );
}
export function renderCover(hasImage = false) {
  const work = {
    id: "fixture-work",
    title: "隔离测试",
    story: "测试故事",
    lyrics: "测试歌词",
    config: { genre: "民谣", mood: "温柔" },
    assets: hasImage ? {cover:'fixture-cover'} : {},
    assetHistory: [],
  };
  return renderToStaticMarkup(
    <Context.Provider
      value={
        {
          data: { works: [work], assets: hasImage ? [{id:'fixture-cover',kind:'image',parentId:'fixture-original',metadata:{width:3000,height:3000}}] : [], artists: [{name:'我的艺人'}] },
          call: async () => ({ requests: [], receipts: [] }),
          importAsset: async () => {},
          exportArtifact: async () => {},
        } as any
      }
    >
      <CoverStudio initialId={work.id} />
    </Context.Provider>,
  );
}
