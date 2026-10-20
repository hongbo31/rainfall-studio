import fs from 'node:fs';import path from 'node:path';import {ZipArchive} from 'archiver';
const root=path.resolve('templates/material-import'),destination=path.resolve('out/Material-Import-Template.zip');fs.mkdirSync(path.dirname(destination),{recursive:true});
await new Promise((resolve,reject)=>{const out=fs.createWriteStream(destination),zip=new ZipArchive({zlib:{level:6}});out.on('close',resolve);out.on('error',reject);zip.on('error',reject);zip.pipe(out);zip.directory(root,'Material-Import-Template');zip.finalize().catch(reject);});console.log(destination);
