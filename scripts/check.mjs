import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = [];
async function walk(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = `${dir}/${entry.name}`; if (entry.isDirectory()) await walk(path); else files.push(path); } }
for (const dir of ['image-translator', 'scripts', 'tests']) await walk(dir);
for (const path of files.filter(f => f.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (result.status) throw new Error(`${path}\n${result.stderr}`);
}
for (const path of files) {
  const source = await readFile(path, 'utf8');
  if (/ghp_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{25,}/.test(source)) throw new Error(`Potential embedded secret in ${path}`);
}
const legacy = await readFile('index.html', 'utf8');
if (!legacy.includes('霓虹贪吃蛇') || !legacy.includes('function step')) throw new Error('Existing Snake game must remain intact');
console.log(`PASS: syntax and embedded-secret checks (${files.length} files); existing game preserved.`);
