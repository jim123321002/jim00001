import { collectRegions } from './core.mjs';
import { inferStyle } from './render.mjs';
let worker, creating, progress = () => {};
export async function stopOCR() {
  const current = worker; worker = null;
  if (current) await current.terminate().catch(() => {});
}
async function getWorker(onProgress) {
  progress = onProgress;
  if (worker) return worker;
  if (!creating) {
    creating = (async () => {
      if (!globalThis.Tesseract) throw new Error('识别组件尚未加载，请检查网络后刷新。');
      const base = new URL('./vendor/', import.meta.url).href;
      const w = await Tesseract.createWorker(['chi_sim', 'eng'], 1, {
        workerPath: base + 'worker.min.js', corePath: base + 'core/', langPath: base + 'lang', gzip: true,
        logger: m => progress(m.status === 'recognizing text' ? '正在识别中文文字' : '首次加载本地识别模型', m.progress || 0),
        errorHandler: () => {}
      });
      await w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '150' });
      worker = w; return w;
    })().finally(() => { creating = null; });
  }
  return creating;
}
export async function recognizeImage(item, onProgress = () => {}, signal) {
  let w;
  try {
    w = await getWorker(onProgress);
    if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
    const source = item.original;
    // Upscale smaller originals for OCR only; all coordinates are mapped back to output pixels.
    const scale = Math.min(2, Math.max(1, 1500 / Math.max(source.width, source.height)));
    const input = document.createElement('canvas'); input.width = Math.round(source.width * scale); input.height = Math.round(source.height * scale);
    const ctx = input.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, input.width, input.height); ctx.drawImage(source, 0, 0, input.width, input.height);
    let result;
    try { result = await w.recognize(input, {}, { text: true, blocks: true }); }
    finally { input.width = 1; input.height = 1; }
    if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
    const regions = collectRegions(result.data, item.width, item.height, scale);
    for (const region of regions) Object.assign(region, inferStyle(item.original, region));
    return regions;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
    await stopOCR();
    throw new Error(`中文识别失败：${error.message || '请检查网络或换一张清晰的图片'}。可使用“添加文字框”手动输入。`);
  }
}
