export const LANGUAGES = [
  ['en', '英语 · English', 'English'], ['vi', '越南语 · Tiếng Việt', 'Vietnamese'],
  ['id', '印尼语 · Indonesia', 'Indonesian'], ['tl', '菲律宾语 · Filipino', 'Filipino'],
  ['ar', '阿拉伯语 · العربية', 'Arabic'], ['ja', '日语 · 日本語', 'Japanese'],
  ['ko', '韩语 · 한국어', 'Korean'], ['th', '泰语 · ไทย', 'Thai'],
  ['fr', '法语 · Français', 'French'], ['de', '德语 · Deutsch', 'German'],
  ['es', '西班牙语 · Español', 'Spanish'], ['ru', '俄语 · Русский', 'Russian'],
  ['pt', '葡萄牙语 · Português', 'Portuguese'], ['ms', '马来语 · Melayu', 'Malay']
];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));
export function normalizeText(text) {
  return String(text || '').normalize('NFC').replace(/[\t\r]+/g, ' ').replace(/(?<=\p{Script=Han}) +(?=\p{Script=Han})/gu, '').replace(/ +([，。！？：；])/g, '$1').trim();
}
export function clampRect(r, width, height) {
  const x = clamp(r.x, 0, Math.max(0, width - 1));
  const y = clamp(r.y, 0, Math.max(0, height - 1));
  return { x, y, w: clamp(r.w, 1, width - x), h: clamp(r.h, 1, height - y) };
}
export function intersects(a, b, tolerance = 0.5) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > tolerance && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > tolerance;
}
export function collectRegions(data, width, height, scale = 1) {
  const lines = [];
  for (const block of data.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) {
    const text = normalizeText(line.text || (line.words || []).map(w => w.text).join(' '));
    const b = line.bbox;
    if (!b || !/\p{Script=Han}/u.test(text) || (line.confidence ?? 100) < 20) continue;
    const rect = clampRect({ x: b.x0 / scale, y: b.y0 / scale, w: (b.x1 - b.x0) / scale, h: (b.y1 - b.y0) / scale }, width, height);
    if (rect.w < 3 || rect.h < 3) continue;
    lines.push({ source: text, original: rect, confidence: line.confidence ?? 70 });
  }
  lines.sort((a, b) => a.original.y - b.original.y || a.original.x - b.original.x);
  const groups = [];
  for (const line of lines) {
    const r = line.original;
    const prior = [...groups].reverse().find(g => {
      const p = g.original, gap = r.y - (p.y + p.h);
      return gap >= -1 && gap < g.lineHeight * 0.8 && Math.abs(r.x - p.x) < g.lineHeight * 0.55 && Math.abs(r.h - g.lineHeight) < g.lineHeight * 0.3 && p.h < height * 0.25;
    });
    if (prior) {
      prior.source += '\n' + line.source;
      prior.original.w = Math.max(prior.original.x + prior.original.w, r.x + r.w) - prior.original.x;
      prior.original.h = r.y + r.h - prior.original.y;
      prior.confidence = Math.min(prior.confidence, line.confidence);
    } else groups.push({ ...line, lineHeight: r.h });
  }
  return groups.map((g, i) => {
    const p = Math.max(2, g.lineHeight * 0.18), r = g.original;
    let box = clampRect({ x: Math.max(0, r.x - p), y: Math.max(0, r.y - p), w: r.w + 2 * p, h: r.h + 2 * p }, width, height);
    // Do not expand through another detected text block.
    for (const other of groups) {
      if (other === g || !intersects(box, other.original, 0)) continue;
      const o = other.original;
      if (o.y >= r.y + r.h) box.h = Math.max(1, o.y - box.y - 1);
      if (o.x >= r.x + r.w) box.w = Math.max(1, o.x - box.x - 1);
    }
    const centered = Math.abs(r.x + r.w / 2 - width / 2) < width * 0.07;
    return { id: i + 1, source: g.source, translation: '', original: { ...r }, box, confidence: g.confidence, maxFont: Math.min(140, g.lineHeight * 1.45), align: centered ? 'center' : 'auto', enabled: true, repair: 'auto', weight: g.lineHeight > 38 ? '700' : '500' };
  });
}
function segments(text, locale, granularity) {
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(locale, { granularity }).segment(text)].map(x => x.segment);
  return granularity === 'word' ? text.split(/(\s+)/) : Array.from(text);
}
function metric(measure, text, size) {
  const m = measure(text, size);
  return typeof m === 'number' ? { width: m, ascent: size * 0.82, descent: size * 0.22 } : m;
}
export function wrapText(text, maxWidth, size, measure, locale = 'en') {
  const result = [];
  for (const paragraph of String(text).replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const token of segments(paragraph, locale, 'word')) {
      const candidate = (line + token).trimStart();
      if (metric(measure, candidate, size).width <= maxWidth) { line = candidate; continue; }
      if (line.trim()) result.push(line.trimEnd());
      line = '';
      if (!token.trim()) continue;
      if (metric(measure, token, size).width <= maxWidth) { line = token.trimStart(); continue; }
      for (const char of segments(token, locale, 'grapheme')) {
        if (line && metric(measure, line + char, size).width > maxWidth) { result.push(line); line = ''; }
        line += char;
      }
    }
    result.push(line.trimEnd());
  }
  return result;
}
export function fitText(text, box, measure, maxFont = 48, locale = 'en') {
  const padding = Math.min(4, Math.min(box.w, box.h) * 0.06);
  const w = Math.max(0.1, box.w - padding * 2), h = Math.max(0.1, box.h - padding * 2);
  function at(size) {
    const lines = wrapText(text, w, size, measure, locale);
    const metrics = lines.map(line => metric(measure, line || 'Mg', size));
    const ascent = Math.max(size * 0.78, ...metrics.map(m => m.ascent || 0));
    const descent = Math.max(size * 0.2, ...metrics.map(m => m.descent || 0));
    const lineHeight = Math.max(size * 1.28, ascent + descent + size * 0.12);
    const totalHeight = Math.max(0, lines.length - 1) * lineHeight + ascent + descent;
    return { lines, size, ascent, descent, lineHeight, totalHeight, padding, fits: totalHeight <= h + 0.001 && metrics.every(m => m.width <= w + 0.001) };
  }
  let lo = 0.25, hi = clamp(maxFont, 0.25, 300);
  if (!at(lo).fits) return { ...at(lo), fits: false, warning: '文字过多，无法完整排入。请放大文字框或缩短译文。' };
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (at(mid).fits) lo = mid; else hi = mid; }
  const result = at(Math.max(0.25, Math.floor(lo * 100) / 100));
  return { ...result, warning: result.size < 8 ? '字号小于 8px，请放大文字框或精简译文后再导出。' : '' };
}
export function splitUtf8(text, maxBytes = 450) {
  if (maxBytes < 4) throw new Error('maxBytes must be at least 4');
  const encoder = new TextEncoder(), out = []; let part = '', size = 0;
  for (const c of String(text)) {
    const n = encoder.encode(c).length;
    if (size + n > maxBytes) { out.push(part); part = ''; size = 0; }
    part += c; size += n;
  }
  if (part) out.push(part);
  return out;
}
export function safeFilename(name, language, index = 0) {
  const clean = String(name).replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 90) || 'image';
  return `${String(index + 1).padStart(2, '0')}-${clean}-${language}.png`;
}
export function validateEndpoint(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('请输入完整的 HTTPS 接口地址。'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.search) throw new Error('接口必须使用 HTTPS，不能在网址中包含密码、密钥或查询参数。');
  return u.href.replace(/\/$/, '').replace(/(?:\/chat\/completions)?$/, '/chat/completions');
}
