const {randomUUID}=require('node:crypto');
module.exports=function fixture(s,api,title='Final lyrics cover recovery'){
 const center=s.planCenterService(),artistId=s.all('artists')[0].id;
 const plan=center.save({plan:{id:randomUUID(),artistId,title,schedule:{kind:'daily',localTime:'09:00'},material:{source:'dot',channel:'isolated',identity:'author'},text:{profileId:randomUUID(),profileRevision:1,modelId:'deepseek-flash',budgetMicros:10000,consent:true},authorization:{text:true,music:false,publish:false},music:{route:'manual'},outputs:{lyrics:true,cover:true,music:false}},expectedRevision:null});
 const preview=center.preview({id:plan.id}),run=center.run({id:plan.id,expectedRevision:plan.revision,summaryHash:preview.summaryHash,requestId:randomUUID(),source:'manual'}),item=center.list().items.find(i=>i.runId===run.id),candidateId=randomUUID();
 s.save('textCandidates',{id:candidateId});
 center.acceptDotCandidate({itemId:item.id,evidenceId:'isolated-inbox',candidate:{candidateId,artistId,channel:'isolated',identity:'author',externalItemId:item.expectedExternalItemId,title:'Original',lyrics:'Original lyrics'}});
 const score=center.claim({runId:run.id,itemId:item.id,stage:'text_score'}),evaluationRunId=randomUUID(),draft=require('./workflow.cjs').draft();draft.title='Final revised lyrics';draft.sections[0].lines=['Final revised first line','Final revised second line'];
 const candidate=api.flowCandidate({id:evaluationRunId,plan:{theme:'isolated'},revisionCount:1},draft,'deepseek-api',{providerModel:'deepseek-flash'});
 const assessment={revisionId:candidate.id,dimensions:{lyrics:85,style:85,coherence:85},overall:85,findings:['Specific isolated final revision assessment'],threshold:75,passed:true,source:'model-scored',calibration:'not_human_calibrated'};
 s.save('settings',{id:'production-flow:run:'+evaluationRunId,value:{id:evaluationRunId,state:'completed',artistId,inboxCandidateId:candidateId,plan:{managedByPlanCenter:true,managedOwnerKey:score.id},candidate,score:assessment,revisionCount:1}});
 s.save('drafts',{id:candidate.id,artistId,source:'inbox-evaluation',evaluationRunId,draft,pair:candidate.pair});
 center.record({attemptId:score.id,status:'succeeded',evidenceId:'isolated-model-evidence',result:{source:'model',score:85,candidateId,evaluationRunId,evaluatedDraftId:candidate.id,assessment,rewriteCount:1}});
 return{center,run,item:()=>center.list().items.find(i=>i.id===item.id),input:{itemId:item.id,expectedFinalDraftId:candidate.id,expectedFinalPairHash:candidate.pairHash}};
};
