import { mkdir, cp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const output = '_site/image-translator';
await rm('_site', { recursive: true, force: true }); await mkdir(output, { recursive: true });
await cp('index.html', '_site/index.html');
await cp('pelican-coast.html', '_site/pelican-coast.html');
await cp('image-translator', output, { recursive: true });
await writeFile('_site/.nojekyll', '');
await mkdir(`${output}/vendor/core`, { recursive: true }); await mkdir(`${output}/vendor/lang`, { recursive: true });
for (const name of ['tesseract.min.js', 'worker.min.js']) await cp(`node_modules/tesseract.js/dist/${name}`, `${output}/vendor/${name}`);
for (const name of await readdir('node_modules/tesseract.js-core')) if (/^tesseract-core.*\.(?:js|wasm)$/.test(name)) await cp(`node_modules/tesseract.js-core/${name}`, `${output}/vendor/core/${name}`);
await cp('node_modules/tesseract.js/LICENSE.md', `${output}/vendor/TESSERACT-LICENSE.md`).catch(async () => cp('node_modules/tesseract.js/LICENSE', `${output}/vendor/TESSERACT-LICENSE`));
async function get(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`); return Buffer.from(await response.arrayBuffer()); }
    catch (error) { last = error; if (i < 2) await new Promise(r => setTimeout(r, 1500)); }
  }
  throw last;
}
const models = {};
for (const language of ['chi_sim', 'chi_sim_vert', 'eng']) {
  const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/${language}.traineddata`;
  const data = await get(url); if (data.length < 100000) throw new Error(`Invalid model: ${language}`);
  models[language] = { source: url, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length };
  await writeFile(`${output}/vendor/lang/${language}.traineddata.gz`, gzipSync(data, { level: 9 }));
}
await writeFile(`${output}/vendor/lang/LICENSE`, await get('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/LICENSE'));
await writeFile(`${output}/vendor/models.json`, JSON.stringify(models, null, 2));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(`${output}/version.json`, JSON.stringify({ version: pkg.version, commit: process.env.GITHUB_SHA || 'local-development', builtAt: new Date().toISOString() }, null, 2));
console.log('Built _site: original Snake game + pelican-coast.html + /image-translator/ with same-origin OCR runtime and models.');
console.log(JSON.stringify(models, null, 2));
