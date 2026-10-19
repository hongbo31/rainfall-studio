import type {Page} from 'playwright-core';
import {z} from 'zod';
export const TME_AI_INTAKE_FIELDS={version:'official-intake-fields-20261018',observedOn:'2026-10-18',route:'https://y.tencentmusic.com/#/user/manage/aiChoose/add',artist:'.mod_top_login .top_login__links .name',title:'input[placeholder="请输入歌曲名称，最多60字"]',genre:'input[placeholder="请选择曲风"]',genreOptions:'.el-select-dropdown:visible .el-select-dropdown__item',album:'input[placeholder="选择已发布专辑"]:visible,input[placeholder="输入专辑名称搜索"]:visible',selectedAlbum:'.album-search:visible .selected:visible .album strong',albumOptions:'.search-result-item:visible',language:'input[placeholder="请选择语种"]',aiTool:'input[placeholder="请选择或填写您的生成工具名称"]',generatedOn:'input[placeholder="请选择生成时间"]',lyrics:'textarea[placeholder^="10-20000字"]',scope:'existing-uploaded-song-fields-only',audioUpload:false,agreementAcceptance:false,formalSubmission:false} as const;
const Input=z.strictObject({title:z.string().trim().min(1).max(60),artistName:z.string().trim().min(1).max(200),genre:z.string().trim().min(1).max(100).optional(),albumTitle:z.string().trim().min(1).max(200).optional(),language:z.string().trim().min(1).max(100).optional(),version:z.literal('完整版').optional(),aiTool:z.string().trim().min(1).max(50).optional(),generatedOn:z.iso.date().optional(),lyrics:z.string().min(10).max(20000).optional(),expectedAudioFileName:z.string().min(1).max(32768).optional(),consent:z.literal(true)});
/** Incremental observed field support. It does not calibrate upload, legal terms,
 * cover cropping, metadata ownership declarations, submission, or receipts. */
export async function fillExistingTmeAiIntakeFields(page:Page,raw:unknown){
 const i=Input.parse(raw),c=TME_AI_INTAKE_FIELDS;
 const guard=async()=>{
  if(page.url()!==c.route||['把晚安留在门口','留一盏灯'].includes(i.title.normalize('NFKC')))throw Error('INTAKE_WORK_SCOPE');
  const a=page.locator(c.artist),t=page.locator(c.title);
  if(await a.count()!==1||await t.count()!==1||(await a.innerText()).trim()!==i.artistName||await t.inputValue()!==i.title)throw Error('INTAKE_WORK_SCOPE');
  const text=await page.locator('body').innerText();if(!text.includes(i.expectedAudioFileName??i.title+'.wav')||!text.includes('上传AI歌曲 ( 1首 )'))throw Error('ONE_EXISTING_AUDIO_REQUIRED');
 };
 await guard();
 if(i.genre){const field=page.locator(c.genre);if(await field.count()!==1)throw Error('INTAKE_FIELD_NOT_UNIQUE');if(await field.inputValue()!==i.genre){
  const options=page.locator(c.genreOptions).filter({hasText:new RegExp('^'+i.genre.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
  if(await options.count()===0){await field.click();await options.first().waitFor({state:'visible',timeout:8000})}
  if(await options.count()!==1)throw Error('INTAKE_OPTION_NOT_UNIQUE');await guard();await options.click();
  await page.waitForFunction(({selector,value})=>(document.querySelector(selector) as HTMLInputElement)?.value===value,{selector:c.genre,value:i.genre},{timeout:8000});
 }}
 // Album selection needs the caller's explicit exact title. Never choose the first
 // suggestion, infer from list order, or invoke the create-album control.
 if(i.albumTitle){const selected=page.locator(c.selectedAlbum);if(await selected.count()>1)throw Error('ALBUM_EXACT_MATCH_REQUIRED');
  if(await selected.count()===1){if((await selected.innerText()).trim()!==i.albumTitle)throw Error('DIFFERENT_ALBUM_SELECTED_REVIEW_REQUIRED')}
  else{const field=page.locator(c.album);if(await field.count()!==1)throw Error('INTAKE_FIELD_NOT_UNIQUE');
  await field.click();const options=page.locator(c.albumOptions).filter({has:page.locator('.album-name').filter({hasText:new RegExp('^'+i.albumTitle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})}).filter({has:page.locator('.singer-name').filter({hasText:new RegExp('^'+i.artistName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})});await options.first().waitFor({state:'visible',timeout:8000});
  if(await options.count()!==1)throw Error('ALBUM_EXACT_MATCH_REQUIRED');await guard();await options.click();
  await selected.waitFor({state:'visible',timeout:8000});if(await selected.count()!==1||(await selected.innerText()).trim()!==i.albumTitle)throw Error('ALBUM_READBACK_REQUIRED');
 }}
 if(i.version){const label=page.locator('label.el-radio').filter({hasText:/^\s*完整版\s*$/});if(await label.count()!==1)throw Error('INTAKE_FIELD_NOT_UNIQUE');if(!await label.locator('input').isChecked()){await guard();await label.click()}if(!await label.locator('input').isChecked())throw Error('VERSION_READBACK_REQUIRED')}
 if(i.language){const field=page.locator(c.language);await field.waitFor({state:'visible',timeout:8000});if(await field.inputValue()!==i.language){await field.click();const option=page.locator(c.genreOptions).filter({hasText:new RegExp('^'+i.language+'$')});await option.first().waitFor({state:'visible',timeout:8000});if(await option.count()!==1)throw Error('INTAKE_OPTION_NOT_UNIQUE');await guard();await option.click()}if(await field.inputValue()!==i.language)throw Error('LANGUAGE_READBACK_REQUIRED')}
 for(const key of ['aiTool','generatedOn','lyrics'] as const){if(!i[key])continue;const field=page.locator(c[key]);if(await field.count()!==1)throw Error('INTAKE_FIELD_NOT_UNIQUE');if(await field.inputValue()!==i[key]){await guard();await field.fill(i[key]);await field.press('Tab')}if(await field.inputValue()!==i[key])throw Error('METADATA_READBACK_REQUIRED')}
 await guard();const values:Record<string,unknown>={};for(const key of ['genre','language','aiTool','generatedOn','lyrics','album'] as const){const field=page.locator(c[key]);values[key]=await field.count()===1?await field.inputValue():null;}
 const selected=page.locator(c.selectedAlbum);if(await selected.count()===1)values.album=(await selected.innerText()).trim();
 return{observedAt:new Date().toISOString(),contractVersion:c.version,title:i.title,artistName:i.artistName,...values,audioUploaded:false,agreementsAccepted:false,formalSubmission:false,completePreparationContractVerified:false};
}
