import { clampRect, fitText, intersects } from './core.mjs';
export const FONT = 'Arial, "Noto Sans", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;
const color = a => '#' + a.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
function pixel(data, x, y) { const i = (Math.round(y) * data.width + Math.round(x)) * 4; return [...data.data.slice(i, i + 3)]; }
export function inferStyle(canvas, region) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true }), r = region.original;
  const outer = clampRect({ x: Math.max(0, Math.floor(r.x - 4)), y: Math.max(0, Math.floor(r.y - 4)), w: Math.ceil(r.w + 8), h: Math.ceil(r.h + 8) }, canvas.width, canvas.height);
  const d = ctx.getImageData(outer.x, outer.y, Math.max(1, Math.floor(outer.w)), Math.max(1, Math.floor(outer.h)));
  const edges = [];
  for (let x = 0; x < d.width; x += Math.max(1, Math.floor(d.width / 80))) { edges.push(pixel(d, x, 0), pixel(d, x, d.height - 1)); }
  for (let y = 0; y < d.height; y += Math.max(1, Math.floor(d.height / 40))) { edges.push(pixel(d, 0, y), pixel(d, d.width - 1, y)); }
  const bg = [0, 1, 2].map(c => median(edges.map(p => p[c])));
  const variance = edges.reduce((s, p) => s + Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]), 0) / (edges.length * 3);
  const bins = new Map();
  for (let y = 3; y < d.height - 3; y += 2) for (let x = 3; x < d.width - 3; x += 2) {
    const p = pixel(d, x, y);
    if (p.reduce((s, v, i) => s + Math.abs(v - bg[i]), 0) < 160) continue;
    const k = p.map(v => Math.round(v / 32) * 32).join(',');
    const bin = bins.get(k) || { count: 0, total: [0, 0, 0] }; bin.count++; p.forEach((v, i) => { bin.total[i] += v; }); bins.set(k, bin);
  }
  const best = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  const fg = best ? best.total.map(v => v / best.count) : (bg.reduce((a, b) => a + b) > 380 ? [24, 31, 43] : [255, 255, 255]);
  return { fg: color(fg), bg: color(bg), textured: variance > 24 };
}
function erase(ctx, original, region) {
  const r = region.original, p = Math.max(1, Math.min(4, r.h * 0.06));
  const area = clampRect({ x: Math.max(0, r.x - p), y: Math.max(0, r.y - p), w: r.w + 2 * p, h: r.h + 2 * p }, original.width, original.height);
  ctx.fillStyle = region.bg;
  if (region.repair === 'auto' && region.textured) {
    // Conservative border interpolation, not generative inpainting. Complex textures are flagged.
    const source = original.getContext('2d', { willReadFrequently: true });
    const sample = (x, y) => {
      const d = source.getImageData(Math.max(0, Math.min(original.width - 1, Math.floor(x))), Math.max(0, Math.min(original.height - 1, Math.floor(y))), 1, 1).data;
      return `rgb(${d[0]},${d[1]},${d[2]})`;
    };
    const gradient = ctx.createLinearGradient(0, area.y, 0, area.y + area.h);
    gradient.addColorStop(0, sample(area.x + area.w / 2, area.y)); gradient.addColorStop(1, sample(area.x + area.w / 2, area.y + area.h));
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(Math.floor(area.x), Math.floor(area.y), Math.ceil(area.w), Math.ceil(area.h));
}
export function renderImage(item) {
  const canvas = document.createElement('canvas'); canvas.width = item.width; canvas.height = item.height;
  const ctx = canvas.getContext('2d'); ctx.drawImage(item.original, 0, 0);
  const regions = item.regions.filter(r => r.enabled && r.translation.trim());
  const diagnostics = []; const plans = [];
  for (const r of regions) {
    r.box = clampRect(r.box, item.width, item.height);
    const measure = (text, size) => {
      ctx.font = `${r.weight || '500'} ${size}px ${FONT}`;
      const m = ctx.measureText(text);
      return { width: Math.max(m.width, (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0)), ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
    };
    const layout = fitText(r.translation, r.box, measure, r.maxFont, item.language || 'en');
    r.renderedSize = layout.size;
    r.layoutWarning = layout.warning;
    if (layout.warning) diagnostics.push({ id: r.id, message: layout.warning, fatal: true });
    if (!layout.fits) continue;
    if (r.confidence < 65) diagnostics.push({ id: r.id, message: '识别置信度较低，请校正原文。', fatal: false });
    if (r.textured && r.repair === 'auto') diagnostics.push({ id: r.id, message: '复杂背景使用边缘补色，请检查修复效果。', fatal: false });
    plans.push({ r, layout });
  }
  for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) if (intersects(regions[i].box, regions[j].box, 1)) {
    diagnostics.push({ id: regions[i].id, message: `与区域 ${regions[j].id} 的文字框重叠，请调整位置。`, fatal: true });
    diagnostics.push({ id: regions[j].id, message: `与区域 ${regions[i].id} 的文字框重叠，请调整位置。`, fatal: true });
  }
  for (const { r } of plans) erase(ctx, item.original, r);
  for (const { r, layout } of plans) {
    const box = r.box, rtl = item.language === 'ar';
    const align = r.align === 'auto' ? (rtl ? 'right' : 'left') : r.align;
    ctx.save();
    // Final safety boundary; fitText independently proves every line fits without truncation.
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    ctx.font = `${r.weight || '500'} ${layout.size}px ${FONT}`;
    ctx.fillStyle = r.fg; ctx.textBaseline = 'alphabetic'; ctx.textAlign = align; ctx.direction = rtl ? 'rtl' : 'ltr';
    const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w - layout.padding : box.x + layout.padding;
    const firstBaseline = box.y + (box.h - layout.totalHeight) / 2 + layout.ascent;
    layout.lines.forEach((line, i) => ctx.fillText(line, x, firstBaseline + i * layout.lineHeight));
    ctx.restore();
  }
  return { canvas, diagnostics };
}
export function canExport(item) {
  return Boolean(item?.regions.length && item.regions.every(r => !r.enabled || r.translation.trim()) && !item.diagnostics?.some(d => d.fatal));
}
