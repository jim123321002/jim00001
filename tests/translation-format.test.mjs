import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTranslationEntities, translateText, clearTranslationCache } from '../image-translator/translate.mjs';
const provider = text => async () => ({ ok: true, status: 200, json: async () => ({ responseStatus: 200, responseData: { translatedText: text } }) });

test('provider decimal and hexadecimal entities decode to Unicode text', () => {
  assert.equal(decodeTranslationEntities('Safety first.&#10;It&#39;s safe. &#x1F600;'), "Safety first.\nIt's safe. 😀");
});
test('named entities decode without treating translated text as HTML', () => {
  assert.equal(decodeTranslationEntities('&lt;img onerror=&quot;test&quot;&gt;&nbsp;A &amp; B'), '<img onerror="test"> A & B');
});
test('invalid Unicode and unknown entities remain harmless literal text', () => {
  assert.equal(decodeTranslationEntities('&#999999999999999999; &#xD800; &#0; &unknown;'), '&#999999999999999999; &#xD800; &#0; &unknown;');
});
test('real-service escaped newline regression is cleaned before caching and layout', async () => {
  clearTranslationCache();
  const translated = await translateText('安全第一', 'en', {}, undefined, provider('Safety first.&#10;'));
  assert.equal(translated, 'Safety first.');
  assert.equal(await translateText('安全第一', 'en', {}, undefined, async () => { throw new Error('Cache should be used'); }), translated);
});
test('entity-only empty responses cannot masquerade as successful translations', async () => {
  clearTranslationCache();
  await assert.rejects(translateText('测试', 'en', {}, undefined, provider('&#10;&nbsp;')), /有效译文/);
});
