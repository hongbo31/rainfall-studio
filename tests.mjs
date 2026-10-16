import test from 'node:test';import assert from 'node:assert/strict';import {seed,enqueue,validateBackup,promptFor} from './web/domain.js';
test('seed originals and validation',()=>{const s=seed();assert.equal(s.works.length,3);assert.ok(validateBackup(s));assert.ok(!validateBackup({schema:1}));});
test('queue deduplication and retry identity',()=>{const s=seed(),w=s.works[0];assert.ok(enqueue(s,w,'Suno'));assert.equal(enqueue(s,w,'Suno'),false);s.tasks[0].status='模拟失败';assert.equal(enqueue(s,w,'Suno'),false);w.lyrics+='新版本';assert.ok(enqueue(s,w,'Suno'));assert.equal(s.tasks.length,2);assert.ok(s.tasks.every(t=>t.cost===0));});
test('prompt preserves choices and story',()=>{const w=seed().works[0];for(const v of [w.story,w.voice,w.language,w.style])assert.ok(promptFor(w).includes(v));});
