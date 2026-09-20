const root = process.argv[2];
if (!root?.startsWith('https://')) throw new Error('Expected HTTPS Pages URL');
const app = new URL('image-translator/', root).href;
let success = false;
for (let i = 0; i < 18; i++) {
  try {
    const response = await fetch(`${app}version.json?commit=${process.env.GITHUB_SHA}&attempt=${i}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      const data = await response.json();
      if (data.commit === process.env.GITHUB_SHA) { console.log('PUBLIC_VERSION_VERIFIED', JSON.stringify(data)); success = true; break; }
    }
  } catch (error) { console.log('Propagation check:', error.message); }
  await new Promise(r => setTimeout(r, 10000));
}
if (!success) throw new Error('Public Pages revision did not match the tested commit');
for (const url of [root, app, `${app}vendor/worker.min.js`, `${app}vendor/lang/chi_sim.traineddata.gz`]) {
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
  console.log('PUBLIC_HTTP', res.status, url); if (!res.ok) throw new Error(`Public asset unavailable: ${url}`);
}
const original = await (await fetch(root)).text(); if (!original.includes('霓虹贪吃蛇')) throw new Error('Legacy game missing on deployed site');
console.log('ACCEPTANCE_URL', app);
