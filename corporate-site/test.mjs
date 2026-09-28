import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

test('core sections exist', () => {
  for (const id of ['solutions','cases','process','contact']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
});

test('responsive and reduced-motion support exist', () => {
  assert.match(html, /name="viewport"/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /@media\(max-width:820px\)/);
});

test('brand and CTA copy exist', () => {
  assert.match(html, /安邦致远/);
  assert.match(html, /让工业安全培训/);
  assert.match(html, /获取方案/);
});
