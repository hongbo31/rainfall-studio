import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {planCatalog}=require(process.env.RAINFALL_PLAN_CATALOG_BUNDLE);
const repo={all:table=>table==='accounts'?[{id:'account',provider:'tme',label:'Local',authStatus:'reauth_required',secret:'NEVER_EXPORT'}]:table==='settings'?[{id:'api-profile:profile',kind:'music',providerId:'yourmusic',modelId:'chirp-v6',revision:1,label:'Saved',executionEnabled:false}]:[],maybe:()=>undefined};
test('Suno official, unknown Pule URL and third-party route remain distinct and do not invent live models',()=>{
 const c=planCatalog(repo);assert.equal(c.routes.find(r=>r.id==='yourmusic').operator,'third_party');assert.match(c.routes.find(r=>r.id==='yourmusic').label,/第三方/);assert.equal(c.routes.find(r=>r.id==='suno_official').executionAvailable,false);assert.equal(c.routes.find(r=>r.id==='pule').url,null);assert.equal(c.routes.find(r=>r.id==='yourmusic').models[0].verified,false);assert.equal(c.routes.find(r=>r.id==='yourmusic').models[0].evidence,'saved_profile');assert(!JSON.stringify(c).includes('NEVER_EXPORT'));
});
test('real platform album catalogs are unavailable instead of populated with fixtures or manual IDs',()=>{
 const c=planCatalog(repo);assert.equal(c.platforms.length,5);for(const p of c.platforms){assert.equal(p.catalog.available,false);assert.deepEqual(p.catalog.albums,[]);assert.equal(p.albumCreate.available,false);assert.equal(p.albumAppend.available,false)}assert.equal(c.platforms.find(p=>p.id==='douyin').delivery,'video');
});
