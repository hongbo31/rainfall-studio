import {mkdir,cp,readFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});await cp('web','dist',{recursive:true});for(const f of ['index.html','app.js','style.css','domain.js']){if(!(await readFile('dist/'+f,'utf8')).length)throw Error(f)}console.log('Build verified: dist/ (local web prototype; not a packaged Windows client)');
