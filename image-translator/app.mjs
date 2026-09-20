import { LANGUAGES, clamp, clampRect, safeFilename, validateEndpoint } from './core.mjs';
import { recognizeImage, stopOCR } from './ocr.mjs';
import { translateText, clearTranslationCache } from './translate.mjs';
import { renderImage, inferStyle, canExport, FONT } from './render.mjs';
import { makeZip } from './zip.mjs';
const $ = id => document.getElementById(id);
const state = { items: [], current: null, selected: null, busy: false, loading: false, exporting: false, view: 'compare', controller: null, settings: { provider: 'mymemory' } };
const current = () => state.items.find(i => i.id === state.current);
const selected = () => current()?.regions.find(r => r.id === state.selected);
const languageName = code => LANGUAGES.find(l => l[0] === code)?.[1] || code;
let noticeTimer, editTimer;
function notice(message, kind = '') {
  clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').className = `notice ${kind}`; $('notice').hidden = !message;
}
function progress(label, value) {
  $('progress-area').hidden = false; $('progress-label').textContent = label;
  $('progress').value = clamp(value, 0, 100); $('progress-value').textContent = Math.round(clamp(value, 0, 100)) + '%';
}
function renderButtons() {
  const locked = state.busy || state.loading || state.exporting, item = current();
  for (const id of ['upload', 'empty-upload', 'sample', 'settings', 'language', 'files']) $(id).disabled = locked;
  $('clear').disabled = locked || !state.items.length;
  $('start').disabled = locked || !state.items.length;
  $('start').textContent = state.busy ? '正在处理…' : `开始翻译${state.items.length ? `（${state.items.length} 张）` : ''} →`;
  $('cancel').hidden = !state.busy;
  $('download').disabled = locked || !canExport(item);
  $('download-all').disabled = locked || !state.items.some(canExport);
  $('add-region').disabled = locked || !item;
  for (const element of $('editor').querySelectorAll('input,select,textarea,button')) element.disabled = locked;
}
function renderQueue() {
  $('queue-count').textContent = state.items.length;
  $('queue').replaceChildren();
  for (const item of state.items) {
    const row = document.createElement('button'); row.className = 'queue-row' + (item.id === state.current ? ' selected' : ''); row.setAttribute('aria-label', `查看 ${item.name}`);
    const img = document.createElement('img'); img.src = item.thumbnail; img.alt = ''; img.loading = 'lazy';
    const info = document.createElement('span'); info.className = 'row-info';
    const name = document.createElement('b'); name.textContent = item.name; name.title = item.name;
    const status = document.createElement('small'); status.textContent = item.status; status.className = canExport(item) ? 'done' : item.error ? 'error' : '';
    info.append(name, status); row.append(img, info);
    row.addEventListener('click', () => { state.current = item.id; state.selected = item.regions[0]?.id ?? null; notice(item.error || item.note || ''); showCurrent(); });
    $('queue').append(row);
  }
}
function applyZoom() {
  const value = $('zoom').value, item = current();
  for (const id of ['original-wrap', 'result-wrap']) $(id).style.width = value === 'fit' || !item ? '100%' : `${item.width * +value}px`;
}
function positionBox(el, r, item) {
  el.style.left = `${r.box.x / item.width * 100}%`; el.style.top = `${r.box.y / item.height * 100}%`;
  el.style.width = `${r.box.w / item.width * 100}%`; el.style.height = `${r.box.h / item.height * 100}%`;
}
function drawOverlay() {
  const item = current(), overlay = $('overlay'); overlay.replaceChildren(); overlay.hidden = !$('show-boxes').checked;
  if (!item) return;
  for (const r of item.regions) {
    if (!r.enabled) continue;
    const el = document.createElement('button'); el.className = 'region-box' + (r.id === state.selected ? ' selected' : ''); el.dataset.id = r.id;
    el.setAttribute('aria-label', `编辑文字区域 ${r.id}`); el.title = `区域 ${r.id} · 点击编辑，拖动位置`; positionBox(el, r, item);
    let drag = null;
    el.addEventListener('pointerdown', event => {
      if (state.busy || state.exporting || event.button !== 0) return;
      state.selected = r.id; fillEditor();
      overlay.querySelectorAll('.region-box').forEach(b => b.classList.toggle('selected', b === el));
      drag = { x: event.clientX, y: event.clientY, original: { ...r.box }, width: $('result-wrap').getBoundingClientRect().width };
      el.setPointerCapture(event.pointerId); event.preventDefault();
    });
    el.addEventListener('pointermove', event => {
      if (!drag) return;
      const ratio = item.width / drag.width;
      r.box.x = clamp(drag.original.x + (event.clientX - drag.x) * ratio, 0, item.width - r.box.w);
      r.box.y = clamp(drag.original.y + (event.clientY - drag.y) * ratio, 0, item.height - r.box.h);
      positionBox(el, r, item); drawPreview(true); fillEditor();
    });
    const end = () => { if (drag) { drag = null; drawOverlay(); renderQueue(); } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('click', () => { if (!state.busy) { state.selected = r.id; fillEditor(); drawOverlay(); } });
    overlay.append(el);
  }
}
function updateDiagnostics(item) {
  const diagnostics = item.diagnostics || [], r = selected();
  const missing = item.regions.filter(b => b.enabled && !b.translation.trim()).length;
  const warnings = diagnostics.filter(d => d.fatal).length;
  $('summary').textContent = !item.regions.length ? '等待识别，可手动添加文字框' : `${item.regions.length} 个文字区域 · ${missing ? `${missing} 处待翻译` : warnings ? `${warnings} 处需调整后导出` : '排版边界检查通过'}`;
  if (r) {
    $('actual-size').textContent = r.renderedSize ? `实际字号 ${r.renderedSize.toFixed(1)}px · 按文字框自动缩放` : '填写译文后自动计算实际字号';
    const messages = diagnostics.filter(d => d.id === r.id).map(d => d.message);
    if (r.error) messages.unshift(r.error);
    $('region-warning').textContent = messages.join('\n'); $('region-warning').hidden = !messages.length;
  }
}
function drawPreview(keepOverlay = false) {
  const item = current(); $('empty').hidden = Boolean(item); $('preview-content').hidden = !item;
  if (!item) { $('summary').textContent = '等待上传图片'; $('original-wrap').replaceChildren(); $('result-wrap').querySelector('canvas')?.remove(); $('overlay').replaceChildren(); renderButtons(); return; }
  $('image-name').textContent = item.name; $('image-size').textContent = `${item.width} × ${item.height}`;
  $('result-language').textContent = item.language ? languageName(item.language).split(' · ')[0] : '待翻译';
  const originalWrap = $('original-wrap');
  if (originalWrap.dataset.id !== item.id) {
    const copy = document.createElement('canvas'); copy.width = item.width; copy.height = item.height; copy.getContext('2d').drawImage(item.original, 0, 0); originalWrap.replaceChildren(copy); originalWrap.dataset.id = item.id;
  }
  const result = renderImage(item); item.diagnostics = result.diagnostics;
  const old = $('result-wrap').querySelector('canvas'); if (old) old.replaceWith(result.canvas); else $('result-wrap').prepend(result.canvas);
  result.canvas.setAttribute('aria-label', '翻译后图片预览');
  if (!keepOverlay) drawOverlay();
  updateDiagnostics(item); applyZoom(); renderButtons();
}
function fillEditor() {
  const item = current(); let r = selected();
  if (!r && item?.regions.length) { state.selected = item.regions[0].id; r = selected(); }
  $('editor').hidden = !r; $('editor-empty').hidden = Boolean(r);
  if (!r) return;
  $('region-select').replaceChildren();
  for (const region of item.regions) { const option = document.createElement('option'); option.value = region.id; option.textContent = `${region.id}. ${region.source.replace(/\n/g, ' ').slice(0, 24) || '手动添加的文字'}`; $('region-select').append(option); }
  $('region-select').value = r.id;
  $('region-confidence').textContent = r.manual ? '手动添加的区域' : `识别置信度 ${Math.round(r.confidence)}% · 请核对原文`;
  $('source-text').value = r.source; $('translated-text').value = r.translation; $('translated-text').dir = item.language === 'ar' ? 'rtl' : 'auto';
  for (const k of ['x', 'y', 'w', 'h']) $(`box-${k}`).value = Math.round(r.box[k]);
  $('box-x').max = item.width - 1; $('box-y').max = item.height - 1; $('box-w').max = item.width; $('box-h').max = item.height;
  $('font-size').value = Math.round(r.maxFont); $('alignment').value = r.align; $('text-color').value = r.fg; $('background-color').value = r.bg; $('repair').value = r.repair; $('font-weight').value = r.weight || '500';
  updateDiagnostics(item); renderButtons();
}
function showCurrent() { renderQueue(); drawPreview(); fillEditor(); }
async function decodeFile(file) {
  const head = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  const png = head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71;
  const jpeg = head[0] === 255 && head[1] === 216;
  const webp = String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('仅支持有效的 PNG、JPG、WebP 图片，不支持 SVG、PDF 或 HEIC。');
  if (png && head.length >= 24) { const d = new DataView(head.buffer); if (d.getUint32(16) * d.getUint32(20) > 80000000) throw new Error('图片超过 8000 万像素，请先缩小图片。'); }
  if (typeof createImageBitmap === 'function') return createImageBitmap(file, { imageOrientation: 'from-image' });
  const url = URL.createObjectURL(file), image = new Image();
  try { image.src = url; await image.decode(); return image; } finally { URL.revokeObjectURL(url); }
}
export async function loadFiles(files) {
  if (state.busy || state.loading || state.exporting) return;
  state.loading = true; renderButtons(); const errors = [];
  try {
    for (const file of Array.from(files)) {
      if (state.items.length >= 10) { errors.push('最多同时处理 10 张图片，剩余图片未添加。'); break; }
      if (file.size > 15 * 1024 * 1024) { errors.push(`${file.name}：超过 15 MB。`); continue; }
      let bitmap;
      try {
        bitmap = await decodeFile(file);
        const width = bitmap.width || bitmap.naturalWidth, height = bitmap.height || bitmap.naturalHeight;
        if (!width || !height || width * height > 80000000) throw new Error('图片尺寸无效或超过 8000 万像素。');
        const scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(8000000 / (width * height)));
        const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
        if (state.items.reduce((sum, item) => sum + item.width * item.height, 0) + w * h > 24000000) throw new Error('队列总像素超过 2400 万，请先下载并清空已处理图片。');
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bitmap, 0, 0, w, h);
        const thumb = document.createElement('canvas'); thumb.width = 96; thumb.height = Math.max(1, Math.round(96 * h / w)); thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
        const item = { id: crypto.randomUUID(), name: file.name || '粘贴图片.png', width: w, height: h, original: canvas, thumbnail: thumb.toDataURL('image/jpeg', 0.75), regions: [], diagnostics: [], status: '等待翻译', language: '', recognized: false, error: '', note: scale < 1 ? `大图已等比缩小至 ${w} × ${h}，导出使用此尺寸。` : '' };
        state.items.push(item); state.current = item.id; state.selected = null;
      } catch (error) { errors.push(`${file.name || '图片'}：${error.message || '图片无法解码'}`); }
      finally { bitmap?.close?.(); }
    }
    notice(errors.join('\n') || current()?.note || '', errors.length ? 'error' : '');
  } finally { state.loading = false; showCurrent(); $('files').value = ''; }
}
function abortable(promise, signal, timeout = 150000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); };
    const stop = () => { cleanup(); reject(new DOMException('已停止', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); stopOCR(); reject(new Error('识别超时，请换一张清晰图片或重试。')); }, timeout);
    signal.addEventListener('abort', stop, { once: true });
    promise.then(v => { cleanup(); resolve(v); }, e => { cleanup(); reject(e); });
    if (signal.aborted) stop();
  });
}
function validateSettings() {
  if (state.settings.provider === 'custom') {
    validateEndpoint(state.settings.endpoint);
    if (!state.settings.apiKey?.trim() || !state.settings.model?.trim()) throw new Error('请在翻译设置中填写模型和 API Key。');
  }
}
async function runAll() {
  if (state.busy || !state.items.length) return;
  try { validateSettings(); } catch (error) { notice(error.message, 'error'); return; }
  state.busy = true; state.controller = new AbortController(); const signal = state.controller.signal;
  const target = $('language').value, settings = { ...state.settings }, signature = JSON.stringify([settings.provider, settings.endpoint, settings.model]);
  renderButtons(); notice(''); let stopped = false;
  try {
    for (let i = 0; i < state.items.length; i++) {
      if (signal.aborted) { stopped = true; break; }
      const item = state.items[i]; state.current = item.id; state.selected = item.regions[0]?.id ?? null;
      item.error = ''; item.status = '正在识别'; showCurrent();
      try {
        if (!item.recognized) {
          item.regions = await abortable(recognizeImage(item, (label, value) => progress(`第 ${i + 1}/${state.items.length} 张 · ${label}`, (i + value * 0.45) / state.items.length * 100), signal), signal);
          item.recognized = true;
        }
        if (!item.regions.length) throw new Error('未识别到清晰的中文印刷文字。可点击右侧“添加”手动框选和输入，或换用更清晰的图片。');
        if (item.language !== target || (item.signature && item.signature !== signature)) for (const r of item.regions) { r.translation = ''; r.error = ''; }
        item.language = target; item.signature = signature; state.selected = item.regions[0]?.id ?? null; item.status = '正在翻译'; showCurrent();
        if (settings.provider !== 'manual') {
          for (let n = 0; n < item.regions.length; n++) {
            if (signal.aborted) throw new DOMException('已停止', 'AbortError');
            const r = item.regions[n]; if (!r.enabled || r.translation.trim()) continue;
            progress(`第 ${i + 1}/${state.items.length} 张 · 翻译区域 ${n + 1}/${item.regions.length}`, (i + 0.45 + 0.5 * n / item.regions.length) / state.items.length * 100);
            try { r.translation = await translateText(r.source, target, settings, signal); r.error = ''; }
            catch (error) { if (error.name === 'AbortError') throw error; r.error = error.message || '翻译失败，请检查网络或切换接口。'; item.error = r.error; }
            drawPreview(); fillEditor();
          }
        }
        drawPreview(); item.status = canExport(item) ? '翻译完成' : item.error ? '部分失败 · 可重试' : '待校正 / 填写译文';
      } catch (error) {
        if (error.name === 'AbortError') { item.status = '已停止 · 可继续'; stopped = true; break; }
        item.error = error.message || '处理失败，可重试。'; item.status = '处理失败 · 可重试';
      }
      showCurrent();
    }
    const count = state.items.filter(canExport).length;
    if (stopped || signal.aborted) notice(`已停止，已完成的译文仍然保留。${count} 张图片可下载。`);
    else if (settings.provider === 'manual') notice('本地识别完成。请在右侧逐段填写译文，排版检查通过后即可导出。');
    else if (count === state.items.length) notice(`${count} 张图片翻译完成，排版边界检查通过。请核对译文与背景修复效果。`, 'success');
    else notice(`${count}/${state.items.length} 张可下载。其余图片需校正或重试。${current()?.error ? '\n' + current().error : '\n请检查右侧文字区域中的提示。'}`, 'error');
    progress(stopped ? '处理已停止' : '本轮处理结束', stopped ? $('progress').value : 100);
  } finally { state.busy = false; state.controller = null; showCurrent(); }
}
async function translateRegion() {
  const item = current(), r = selected(); if (!r || state.busy) return;
  if (!r.source.trim()) { notice('请先填写中文原文。', 'error'); return; }
  if (state.settings.provider === 'manual') { notice('当前为手动模式，请直接填写译文，或切换翻译方式。'); return; }
  try { validateSettings(); } catch (error) { notice(error.message, 'error'); return; }
  state.busy = true; state.controller = new AbortController(); renderButtons();
  try {
    const target = item.language || $('language').value;
    r.translation = await translateText(r.source, target, state.settings, state.controller.signal); r.error = ''; item.language = target; item.error = ''; notice('该段译文已更新。', 'success');
  } catch (error) { if (error.name === 'AbortError') notice('已停止，原译文保留。'); else { r.error = error.message || '翻译失败，请检查网络。'; notice(r.error, 'error'); } }
  finally { state.busy = false; state.controller = null; drawPreview(); item.status = canExport(item) ? '翻译完成' : '待校正'; showCurrent(); }
}
function addRegion() {
  const item = current(); if (!item || state.busy) return;
  const box = clampRect({ x: item.width * 0.1, y: item.height * 0.45, w: item.width * 0.65, h: Math.max(30, item.height * 0.12) }, item.width, item.height);
  const r = { id: Math.max(0, ...item.regions.map(b => b.id)) + 1, source: '', translation: '', original: { ...box }, box, confidence: 100, maxFont: Math.min(64, box.h * 0.8), align: 'auto', enabled: true, repair: 'solid', manual: true, weight: '500' };
  Object.assign(r, inferStyle(item.original, r)); item.regions.push(r); item.recognized = true; item.language ||= $('language').value; item.status = '待校正'; state.selected = r.id;
  showCurrent(); $('source-text').focus(); notice('已添加文字框。输入原文与译文；调整位置后，可将该框设为原文擦除区。');
}
function blobOf(canvas) { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片导出失败，可能内存不足。')), 'image/png')); }
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function download(all = false) {
  if (state.busy || state.exporting) return;
  const items = all ? state.items.filter(canExport) : [current()].filter(canExport);
  if (!items.length) return;
  state.exporting = true; renderButtons();
  try {
    const files = [];
    for (const item of items) {
      const result = renderImage(item); item.diagnostics = result.diagnostics;
      if (!canExport(item)) throw new Error('排版发生变化，请先处理重叠、过小字号或缺失译文。');
      const blob = await blobOf(result.canvas); result.canvas.width = 1; result.canvas.height = 1;
      const name = safeFilename(item.name, item.language, state.items.indexOf(item));
      if (!all) downloadBlob(blob, name); else files.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    if (all) downloadBlob(makeZip(files), `yitu-${items.length}-images.zip`);
    notice(all ? `已下载 ${items.length} 张图片的 ZIP。${items.length < state.items.length ? '未完成或排版未通过的图片没有包含在内。' : ''}` : 'PNG 已导出，请在浏览器下载记录中查看。', 'success');
  } catch (error) { notice(error.message || '导出失败，请减少图片数量后重试。', 'error'); }
  finally { state.exporting = false; renderButtons(); }
}
function changed() {
  clearTimeout(editTimer); const item = current(); if (!item) return;
  item.status = '已编辑'; item.error = ''; drawPreview(); renderQueue();
}
function bindEditor() {
  $('region-select').addEventListener('change', () => { state.selected = +$('region-select').value; fillEditor(); drawOverlay(); });
  $('source-text').addEventListener('input', () => { const r = selected(); if (!r) return; r.source = $('source-text').value; r.translation = ''; r.error = ''; $('translated-text').value = ''; changed(); });
  $('translated-text').addEventListener('input', () => { const r = selected(); if (!r) return; r.translation = $('translated-text').value; r.error = ''; clearTimeout(editTimer); editTimer = setTimeout(changed, 120); });
  for (const key of ['x', 'y', 'w', 'h']) $(`box-${key}`).addEventListener('change', () => { const r = selected(), item = current(); if (!r) return; r.box[key] = +$(`box-${key}`).value; r.box = clampRect(r.box, item.width, item.height); changed(); fillEditor(); });
  for (const [id, key] of [['font-size', 'maxFont'], ['alignment', 'align'], ['text-color', 'fg'], ['background-color', 'bg'], ['repair', 'repair'], ['font-weight', 'weight']]) $(id).addEventListener('input', () => { const r = selected(); if (!r) return; r[key] = key === 'maxFont' ? clamp($(id).value, 8, 300) : $(id).value; if (key === 'bg') { r.repair = 'solid'; $('repair').value = 'solid'; } changed(); });
  $('reset-region').addEventListener('click', () => { const r = selected(); if (!r) return; r.box = { ...r.original }; changed(); fillEditor(); });
  $('mask-region').addEventListener('click', () => { const r = selected(); if (!r) return; r.original = { ...r.box }; Object.assign(r, inferStyle(current().original, r)); changed(); fillEditor(); notice('原文擦除区已更新。请核对原图和译图，避免覆盖图案。'); });
  $('delete-region').addEventListener('click', () => { const item = current(), r = selected(); if (!r) return; item.regions = item.regions.filter(b => b.id !== r.id); state.selected = item.regions[0]?.id ?? null; showCurrent(); notice('已移除该区域，其原始图像已恢复。'); });
  $('translate-region').addEventListener('click', translateRegion);
}
export async function makeSample() {
  await document.fonts.ready;
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
  const c = canvas.getContext('2d'); c.fillStyle = '#f3f7f4'; c.fillRect(0, 0, 1200, 800);
  c.fillStyle = '#147d71'; c.fillRect(64, 54, 44, 7); c.font = `500 20px ${FONT}`; c.fillText('PRODUCT INFORMATION', 124, 68);
  c.fillStyle = '#19382d'; c.font = `700 62px ${FONT}`; c.fillText('安全体验培训', 64, 170);
  c.fillStyle = '#647b6e'; c.font = `400 31px ${FONT}`; c.fillText('让安全培训更直观', 66, 230);
  c.fillStyle = '#ffffff'; c.fillRect(64, 291, 1072, 318);
  c.fillStyle = '#213c30'; c.font = `500 33px ${FONT}`;
  c.fillText('产品名称：安全体验设备', 94, 363); c.fillText('适用场景：电力与建筑施工', 94, 451); c.fillText('支持多语言培训', 94, 539);
  c.fillStyle = '#e3eee7'; c.fillRect(795, 332, 285, 226); c.strokeStyle = '#5f9a7c'; c.lineWidth = 6;
  c.strokeRect(860, 380, 155, 92); c.beginPath(); c.moveTo(936, 472); c.lineTo(936, 510); c.moveTo(900, 512); c.lineTo(975, 512); c.stroke();
  c.fillStyle = '#557a62'; c.font = `400 28px ${FONT}`; c.fillText('使用前请仔细阅读操作说明', 66, 707);
  c.fillStyle = '#a6b7aa'; c.font = `400 17px ${FONT}`; c.fillText('DEMO IMAGE  /  1200 × 800', 66, 753);
  const blob = await blobOf(canvas); return new File([blob], '安全培训-示例.png', { type: 'image/png' });
}
function configureProvider() {
  const provider = $('provider').value; $('custom-settings').hidden = provider !== 'custom';
  $('provider-description').textContent = provider === 'manual' ? '仅在浏览器识别文字，不发送翻译请求。请自行填写译文。' : provider === 'custom' ? '使用你自己的兼容接口。密钥不保存到浏览器存储，不会提交到 GitHub。' : '免费服务匿名额度约 5,000 字符/天，可能限流。只发送识别文字，不发送图片。';
}
function init() {
  for (const [code, label] of LANGUAGES) { const option = document.createElement('option'); option.value = code; option.textContent = label; $('language').append(option); }
  for (const id of ['upload', 'empty-upload']) $(id).addEventListener('click', () => $('files').click());
  $('files').addEventListener('change', event => loadFiles(event.target.files));
  $('sample').addEventListener('click', async () => { try { await loadFiles([await makeSample()]); } catch (error) { notice(error.message, 'error'); } });
  $('start').addEventListener('click', runAll);
  $('cancel').addEventListener('click', () => { state.controller?.abort(); stopOCR(); });
  $('download').addEventListener('click', () => download(false)); $('download-all').addEventListener('click', () => download(true));
  $('clear').addEventListener('click', () => { if (state.busy) return; for (const item of state.items) { item.original.width = 1; item.original.height = 1; } state.items = []; state.current = null; state.selected = null; clearTranslationCache(); $('original-wrap').dataset.id = ''; $('progress-area').hidden = true; notice(''); showCurrent(); });
  $('add-region').addEventListener('click', addRegion);
  $('language').addEventListener('change', () => { if (state.items.some(i => i.language)) notice('目标语言已切换。再次点击“开始翻译”后，将重新生成所选语言的译文；当前预览仍标注原结果语言。'); });
  $('zoom').addEventListener('change', applyZoom); $('show-boxes').addEventListener('change', drawOverlay);
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; $('previews').className = `previews ${state.view}`; document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b === button)); }));
  $('settings').addEventListener('click', () => $('settings-dialog').showModal()); $('help').addEventListener('click', () => $('help-dialog').showModal());
  $('provider').addEventListener('change', configureProvider);
  $('save-settings').addEventListener('click', () => {
    const s = { provider: $('provider').value, endpoint: $('endpoint').value.trim(), model: $('model').value.trim(), apiKey: $('api-key').value };
    if (s.provider === 'custom') { try { s.endpoint = validateEndpoint(s.endpoint); if (!s.apiKey.trim() || !s.model) throw new Error('请填写模型名和 API Key。'); } catch (error) { $('provider-description').textContent = error.message; return; } }
    state.settings = s; clearTranslationCache(); $('settings-dialog').close();
    $('privacy').textContent = s.provider === 'manual' ? '当前为本地识别 / 手动翻译模式。图片与文字不会发送给翻译服务。首次识别需要下载模型。' : s.provider === 'custom' ? `当前使用自定义接口：${new URL(s.endpoint).hostname}。开始翻译会将识别文字和密钥发送到该接口，图片不上传。` : '默认使用 MyMemory 免费翻译。点击“开始翻译”会将识别文字发送给该服务，图片不会上传。请勿处理敏感文字。首次识别需加载模型。';
    notice('翻译设置已应用。已有译文保留；再次开始翻译时，更换服务会重新生成。');
  });
  document.addEventListener('dragover', event => { if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return; event.preventDefault(); document.body.classList.add('dragging'); });
  document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('dragging'); });
  document.addEventListener('drop', event => { event.preventDefault(); document.body.classList.remove('dragging'); if (event.dataTransfer?.files.length) loadFiles(event.dataTransfer.files); });
  document.addEventListener('paste', event => { if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return; const files = [...(event.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean); if (files.length) { event.preventDefault(); loadFiles(files); } });
  bindEditor(); showCurrent();
  fetch('./version.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => { if (v) $('version').textContent = `v${v.version} · ${v.commit.slice(0, 7)}`; }).catch(() => {});
}
// Read-only diagnostics make acceptance checks independent of private credentials or source image data.
export function inspect() { return state.items.map(i => ({ name: i.name, width: i.width, height: i.height, language: i.language, status: i.status, exportable: canExport(i), regions: i.regions.map(r => ({ id: r.id, source: r.source, translation: r.translation, box: { ...r.box }, size: r.renderedSize })), diagnostics: i.diagnostics })); }
init();
