import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {planCatalog}=require(process.env.RAINFALL_PLAN_CATALOG_BUNDLE);
const repo={all:table=>table==='accounts'?[{id:'account',provider:'tme',label:'Local',authStatus:'reauth_required',secret:'NEVER_EXPORT'}]:table==='settings'?[{id:'api-profile:11111111-1111-4111-8111-111111111111',kind:'music',providerId:'yourmusic',modelId:'chirp-v6',revision:1,label:'Saved',executionEnabled:false}]:[],maybe:()=>undefined};
test('Installed third-party/Pule adapter models show contract support without inventing live availability',()=>{
 const c=planCatalog(repo);assert.equal(c.routes.find(r=>r.id==='yourmusic').operator,'third_party');assert.match(c.routes.find(r=>r.id==='yourmusic').label,/第三方/);assert.equal(c.routes.find(r=>r.id==='suno_official').executionAvailable,false);assert.equal(c.routes.find(r=>r.id==='pule').providerId,'yourmusic');assert.equal(c.routes.find(r=>r.id==='yourmusic').executionAvailable,true);assert.equal(c.routes.find(r=>r.id==='manual').executionAvailable,true);assert.equal(c.routes.find(r=>r.id==='yourmusic').models[0].verified,false);assert.equal(c.routes.find(r=>r.id==='yourmusic').models.length,3);assert.equal(c.routes.find(r=>r.id==='yourmusic').models[0].contractStatus,'contract-supported');assert.equal(c.routes.find(r=>r.id==='yourmusic').models[0].currentAvailability,'unknown');assert(!JSON.stringify(c).includes('NEVER_EXPORT'));
});
test('real platform album catalogs are unavailable instead of populated with fixtures or manual IDs',()=>{
 const c=planCatalog(repo);assert.equal(c.platforms.length,5);for(const p of c.platforms){assert.equal(p.catalog.available,false);assert.deepEqual(p.catalog.albums,[]);assert.equal(p.albumCreate.available,false);assert.equal(p.albumAppend.available,false)}assert.equal(c.platforms.find(p=>p.id==='douyin').delivery,'video');
});
