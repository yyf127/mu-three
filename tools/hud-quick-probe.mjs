/**
 * 底栏「球数值 / AG 竖槽 / 药水快捷槽」探针。要连服务端（数量来自真实背包）。
 *
 *   node tools/hud-quick-probe.mjs
 *
 * 断言：
 *   1. HP/MP 球上的当前值（原版 RenderNumber2D(100|540, 467, cur, 9, 10)）
 *   2. AG 竖槽：15×36 @ (551,437)，贴图 Menu03_new_ag，液面随 bp/maxBp 从顶部裁
 *   3. Q/W/E 三个槽的物品种类、数量，图标是否真的渲染出内容
 *   4. 三段悬停提示：Health / Mana / Stamina（RenderTipText 的 419 那一行）
 *
 * 药水类型的选取规则照抄 `SeedQuickPotionTypesFromInventory`：
 *   Q=449..451（退 448）、W=452..454、E={468,457,456} 优先（456=Antidote）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient, loginAs } from './lib/edge-client.mjs';

const c = await createClient('hudquick');
try {
  await loginAs(c, '1234', '1234');
  await sleep(1500);

  const snap = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.hudValues())`));
  console.log(`HP ${snap.hp?.text}  MP ${snap.mp?.text}  AG ${snap.stamina?.text}（clip ${snap.agClip}）`);
  console.log('药水槽:', snap.quicks.map(q => `type=${q.type} × ${q.count}`).join(' | '));

  const geo = JSON.parse(
    await c.ev(`(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const k = stage.width / 640;
      const L = e => { const b = e.getBoundingClientRect();
        return [(b.x - stage.x) / k, (b.y - stage.y) / k, b.width / k, b.height / k].map(v => Math.round(v * 10) / 10); };
      const img = document.querySelector('.hv-ag-img');
      return JSON.stringify({
        agBox: document.querySelector('.hv-ag') ? L(document.querySelector('.hv-ag')) : null,
        agNat: img ? [img.naturalWidth, img.naturalHeight] : null,
        nums: [...document.querySelectorAll('.bm-num')].map(n => ({ t: n.textContent, box: L(n) })),
      });
    })()`)
  );
  console.log('AG 几何:', JSON.stringify(geo));

  const icons = JSON.parse(
    await c.ev(`(async () => {
      const out = [];
      for (const img of document.querySelectorAll('.hv-quick-icon')) {
        if (!img.src) { out.push(null); continue; }
        const im = new Image(); im.src = img.src; await im.decode();
        const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
        const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
        const d = g.getImageData(0, 0, im.width, im.height).data;
        let opaque = 0;
        for (let k = 3; k < d.length; k += 4) if (d[k] > 20) opaque++;
        out.push({ w: im.width, opaque });
      }
      return JSON.stringify(out);
    })()`)
  );
  console.log('图标:', icons.map(i => (i ? `${i.w}px/${i.opaque}px` : '空')).join(' '));

  // 三段悬停提示
  for (const sel of ['.hv-orb', '.hv-ag']) {
    const n = sel === '.hv-orb' ? 1 : 0;
    const tip = JSON.parse(
      await c.ev(`(() => {
        const el = document.querySelectorAll('${sel}')[${n}];
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        const t = document.querySelector('.hv-tip');
        return JSON.stringify({ text: t.textContent, left: t.style.left, top: t.style.top });
      })()`)
    );
    console.log(`提示 ${sel}[${n}]:`, tip.text, '@', tip.left, tip.top);
  }

  // 液面：把 AG 打到 25% 再对比槽内亮度分布（顶部该变暗）
  const rect = JSON.parse(
    await c.ev(`(() => { const r = document.querySelector('#stage').getBoundingClientRect();
      return JSON.stringify({ x: r.left, y: r.top, width: r.width, height: r.height }); })()`)
  );
  const k = rect.width / 640;
  const agClip = {
    x: rect.x + 551 * k,
    y: rect.y + 437 * k,
    width: 15 * k,
    height: 36 * k,
    scale: 1,
  };
  const bands = async () => {
    const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: agClip });
    return JSON.parse(
      await c.ev(`(async () => {
        const img = new Image(); img.src = 'data:image/png;base64,${shot.data}'; await img.decode();
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
        const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        const out = [];
        for (let band = 0; band < 4; band++) {
          let sum = 0, n = 0;
          for (let y = Math.floor(band * cv.height / 4); y < Math.floor((band + 1) * cv.height / 4); y++)
            for (let x = 0; x < cv.width; x++) { const i = (y * cv.width + x) * 4; sum += (d[i] + d[i+1] + d[i+2]) / 3; n++; }
          out.push(Math.round(sum / n));
        }
        return JSON.stringify(out);
      })()`)
    );
  };
  console.log('AG 满槽四段亮度:', await bands());
  await c.ev(`__MU_APP__.hudPreview({ bp: 412, maxBp: 1648 })`);
  await sleep(300);
  console.log('AG 25% clip:', await c.ev(`JSON.stringify(__MU_APP__.hudValues().agClip)`));
  console.log('AG 25% 四段亮度:', await bands());

  // AG 特写：25%（正在被裁）与满槽各一张，方便肉眼对照
  const crop = { x: rect.x + 540 * k, y: rect.y + 425 * k, width: 60 * k, height: 58 * k, scale: 4 };
  const snapAg = await c.send('Page.captureScreenshot', { format: 'png', clip: crop });
  writeFileSync('shots/ag-25.png', Buffer.from(snapAg.data, 'base64'));

  await c.ev(`__MU_APP__.hudPreview({ bp: ${snap.stamina?.cur ?? 1648}, maxBp: ${snap.stamina?.max ?? 1648} })`);
  await sleep(300);
  const snapFull = await c.send('Page.captureScreenshot', { format: 'png', clip: crop });
  writeFileSync('shots/ag-full.png', Buffer.from(snapFull.data, 'base64'));
  console.log('saved shots/ag-25.png / shots/ag-full.png');

  // 底栏特写（逻辑 0,395 → 640×85）
  const shot = await c.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect.x, y: rect.y + 395 * k, width: 640 * k, height: 85 * k, scale: 1 },
  });
  writeFileSync('shots/hud-quick.png', Buffer.from(shot.data, 'base64'));
  console.log('saved shots/hud-quick.png');

  const errs = c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]'));
  console.log('控制台错误:', errs.length);
  for (const e of errs.slice(0, 4)) console.log('  ' + e);
} finally {
  await c.close();
}
