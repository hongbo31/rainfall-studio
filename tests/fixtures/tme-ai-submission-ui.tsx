import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TmeAiSubmissionPanel} from '../../src/renderer/components/TmeAiSubmissionWorkspace';
export function renderSubmissionPanel(){
 const result={ready:false,reasons:['AUDIO_REQUIRED','COVER_REQUIRED','PREPARATION_REQUIRED'],capability:{available:false,reasons:['NATIVE_AI_SUBMIT_CONTRACT_UNVERIFIED','OFFICIAL_RECEIPT_CONTRACT_UNVERIFIED']}};
 return renderToStaticMarkup(<TmeAiSubmissionPanel works={[{id:'new-work',title:'尚无音频的新歌'}]} workId="new-work" busy={false} consent={false} rightsConfirmed={false} error="" result={result} onSelect={()=>{}} onCheck={()=>{}} onConsent={()=>{}} onRights={()=>{}} onSubmit={()=>{}}/>);
}
