const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const w=require(process.env.RAINFALL_INBOX_BUNDLE);
test('acceptance: explicit isolated data root takes precedence over packaged preview default',()=>{
 assert.equal(typeof w.resolveDataRoot,'function');
 assert.equal(w.resolveDataRoot('C:/QA/separate','C:/AppData/Preview','C:/AppData'),path.resolve('C:/QA/separate'));
 assert.equal(w.resolveDataRoot(undefined,'C:/AppData/Preview','C:/AppData'),path.resolve('C:/AppData/Preview'));
 assert.equal(w.resolveDataRoot(undefined,undefined,'C:/AppData'),path.resolve('C:/AppData/RainfallStudio'));
});
