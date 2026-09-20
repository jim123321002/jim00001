# 译图 · 图片翻译工作台

验收入口：https://jim123321002.github.io/jim00001/image-translator/

原有霓虹贪吃蛇仍保留在仓库根页面，原有文件和测试未删除。

## 已实现

- 上传、拖入或粘贴 PNG / JPEG / WebP；最多 10 张、单张 15 MB。大图等比限制在最长边 4096px / 800 万像素，队列总像素不超过 2400 万。透明区域铺白。
- 浏览器本地 Tesseract.js 中文 OCR，模型、Worker、WASM 均随 Pages 构建自托管。英文原有标识不作为中文翻译区域覆盖。
- 英语、越南语、印尼语、菲律宾语、阿拉伯语、日语、韩语、泰语、法语、德语、西班牙语、俄语、葡萄牙语、马来语共 14 个目标语言。
- 默认 MyMemory 免费接口，无需密钥；也支持用户自备兼容 chat/completions 的 HTTPS 接口，或仅本地识别后手工填译文。
- Unicode 分词换行、长词拆分、字体实际宽度及升部/降部测量、二分自适应字号、阿拉伯语 RTL、原图坐标边界约束。
- 可编辑原文与译文、拖动文字框、数值调整位置/大小、字体大小上限、颜色、对齐、字重、补充漏识别区域、调整原文擦除区。
- 不以静默省略或裁切文字解决长译文。字号小于 8px、文字框重叠、无法完整容纳或缺失译文时阻止成品导出，提示用户校正。
- 原图/译图/对照视图，放大检查，单张 PNG 和批量 UTF-8 ZIP 下载。批量失败可重试，停止后保留已完成内容。

## 隐私与真实限制

图片不上传。默认会将**识别文字**发送到 MyMemory；其匿名使用额度约 5,000 字符/天，按服务方实际规则执行。第三方服务可能限流、断网或返回不准确译文。不会把原中文或错误消息冒充翻译成功。

自定义接口的密钥仅在本次页面内存/表单中存在，刷新即清空，不写入 localStorage、sessionStorage、GitHub 或网站服务器。文字和密钥仅发送到用户主动填写的 HTTPS 服务；接口必须支持 CORS，建议使用专用低额度密钥。静态前端不能安全托管共享的付费服务密钥。

面向清晰、水平排版的中文印刷文字。OCR 不能保证识别所有艺术字、倾斜字、手写字、竖排或模糊文字。背景采用纯色或边缘渐变重建，不是生成式无痕修复；照片、纹理背景需复核。**不声称任意图片都能自动达到人工设计稿的精度。** 自动验证几何边界不等于验证翻译语义和漏识别情况。

## 开发与验收

Node.js 22 或更新版本。依赖首层版本固定，CI 生成的完整 lockfile 保留在测试产物中；存在提交的 lockfile 时 CI 强制使用 npm ci。

```sh
npm install --ignore-scripts
npm run check
npm test
npm run build
npx playwright install --with-deps chromium
# Linux 测试示例图需要中文字体，例如 fonts-noto-cjk
npm run test:browser
npm run test:live
npm run serve
```

访问 http://127.0.0.1:8080/image-translator/ 。构建时需要从 npm 和 tesseract-ocr 官方数据仓库下载公开依赖。构建输出在 `_site/`。

工作流 `.github/workflows/image-translator.yml` 执行语法/敏感信息检查、核心单元测试、构建、桌面与 Android Chromium 自动化、真实中文 OCR + 实际 MyMemory 联调、Pages 部署、公开站点 Commit/HTTP 校验，再在公开站点运行真实翻译测试。测试或真实服务联调失败会使工作流失败，不会把成功提交代码视为已完成。

自动化 UI 测试中明确命名为 mocked provider 的场景用于确定性验证成功/失败/重试；`tests/live.spec.mjs` 不拦截翻译接口，测试真实服务。Actions 产物 `image-translator-test-evidence` 包含报告、截图、失败 Trace 和依赖锁；`image-translator-website` 是可部署静态站点。

## 关键文件

`core.mjs`：坐标、分组、Unicode 换行和字号计算。`ocr.mjs`：本地 OCR。`translate.mjs`：接口、超时、错误与会话缓存。`render.mjs`：补色、Canvas 排版及导出门禁。`app.mjs`：工作台交互。`zip.mjs`：无需外部服务的 PNG 批量打包。

## 上游与许可说明

- Tesseract.js（Apache-2.0）：https://github.com/naptha/tesseract.js
- Tesseract.js-core（Apache-2.0）：https://github.com/naptha/tesseract.js-core
- tessdata_fast 4.1.0（Apache-2.0）：https://github.com/tesseract-ocr/tessdata_fast
- Playwright（Apache-2.0，仅开发测试）：https://github.com/microsoft/playwright
- MyMemory 接口规范：https://mymemory.translated.net/doc/spec.php
- MyMemory 额度说明：https://mymemory.translated.net/doc/usagelimits.php

构建保留 OCR 许可文件及模型来源 / SHA-256 清单。应用不包含收费 API 密钥，没有分析追踪脚本。
