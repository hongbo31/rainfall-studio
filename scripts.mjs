import {mkdir,cp,readFile} from 'node:fs/promises';
import path from 'node:path';

const output = path.join(import.meta.dirname, 'dist');
await mkdir(output, { recursive: true });
await cp(path.join(import.meta.dirname, 'web'), output, { recursive: true });
for (const file of ['index.html', 'app.js', 'style.css', 'domain.js']) {
  if (!(await readFile(path.join(output, file), 'utf8')).length) throw Error(file);
}
console.log('Build verified: dist/ (local web prototype; not a packaged Windows client)');
