/**
 * 技能「撞击/落地」连拍 —— 用来验「落地之后到底有没有东西」。
 *
 *   node tools/skill-impact-shots.mjs 2          # 陨石，连拍 8 帧
 *   node tools/skill-impact-shots.mjs 10 10      # 地狱火，连拍 10 帧
 *
 * 为什么是连拍而不是「第 N 秒截一张」：
 * 点在页面上跑 `castSkill` 这一步的 CDP 往返在软渲染（SwiftShader）下要
 * 0.1~0.7 s 不等，`睡到第 N 秒` 会被这个抖动整段带偏 —— 实测「+0.15 s」
 * 拍到的东西其实是 +0.5 s 的状态。所以这里**只管尽快连拍**，
 * 每帧记下相对 cast 返回的**真实毫秒数**，事后按时间挑帧。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const id = Number(process.argv[2]);
const frames = Number(process.argv[3] ?? 8);
/**
 * 取景方式：
 *   crop（默认）= 只截靶子周围 520×460；
 *   full       = 整帧。**对账时优先用这个** —— `__MU_DEBUG__.project()` 返回的
 *                是 `innerWidth/innerHeight` 空间的坐标，而 `snap()` 裁的是
 *                canvas 像素，两者在 DPR / CSS 缩放下不一定一致，
 *                用 crop 会截到「不是你想看的那个位置」。
 */
const mode = process.argv[4] ?? 'crop';
/**
 * `freeze` = 等特效出来就**冻住时间**再拍。
 * 短命的件（电弧 0.5 s、爆闪 0.55 s）在软渲染下一次 `snap()` 就要 2~3 s，
 * 不冻住永远拍不到。冻住后各帧内容相同，但日志里的件数/年龄是准的。
 */
const freeze = mode === 'freeze';

if (!Number.isFinite(id)) {
  console.error('用法: node tools/skill-impact-shots.mjs <技能号> [帧数]');
  process.exit(1);
}

const c = await createClient('skillimpact');

/** 靶子投影 → 取景框（等相机稳定） */
async function clip(w = 520, h = 460, lift = 1.2) {
  let prev = null;
  let same = 0;
  for (let i = 0; i < 40; i++) {
    const cur = await c.ev(
      `(() => { const t = __MU_APP__.skillTarget(); if (!t || !window.__MU_DEBUG__) return '';
        const p = __MU_DEBUG__.project(t.x, t.y, t.z + ${lift});
        return JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) }); })()`
    );
    if (cur && cur === prev) {
      if (++same >= 4) break;
    } else {
      same = 0;
      prev = cur;
    }
    await sleep(200);
  }
  const p = JSON.parse(prev);
  // 给页面内截图用的 CSS 像素框（`__MU_APP__.snap` 的入参）
  return {
    x: Math.max(0, Math.round(p.x - w / 2)),
    y: Math.max(0, Math.round(p.y - h * 0.62)),
    w,
    h,
  };
}

/** 把一个世界点投影到取景框内的相对坐标，用来对账「东西到底在哪」 */
const inBox = (box, expr) => `(() => {
  const pts = ${expr};
  if (!pts || !pts.length) return [];
  return pts.map(p => {
    const q = __MU_DEBUG__.project(p[0], p[1], p[2]);
    return [Math.round(q.x - ${box.x}), Math.round(q.y - ${box.y})];
  });
})()`;

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor('!!__MU_APP__.skillTarget()', 30000, '靶子');
  await sleep(2500);

  const all = await c.ev(`__MU_APP__.skills()`);
  const sk = all.find(s => s.id === id);
  if (!sk) throw new Error(`没有技能 ${id}`);

  // 先放一发把角色送到靶子旁、相机跟到位（这一发不拍）
  // 等久一点：新贴图的着色器在第一次渲染时要编译（SwiftShader 下几秒），
  // 提前 fxClear 会让第二发再编译一遍，帧间隔直接崩到 8 s
  await c.ev(`__MU_APP__.castSkill(${id})`);
  await sleep(4000);
  const box = mode === 'full' || freeze ? null : await clip();
  {
    // 靶子在不在、离施法者多远 —— 追踪类技能全靠这个，缺了就只能原地放
    const info = await c.ev(`(() => {
      const t = __MU_APP__.skillTarget();
      const st = __MU_APP__.state();
      const p = st.player || {};
      if (!t) return JSON.stringify({ t: null, player: [p.x, p.y, p.z] });
      return JSON.stringify({ t: [t.x, t.y, t.z], player: [p.x, p.y, p.z] });
    })()`);
    console.log('靶子/玩家 ' + info);
  }
  if (box) {
    const t = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.skillTarget())`));
    const pb = await c.ev(inBox(box, `[[${t.x},${t.y},${t.z + 1.2}]]`));
    console.log(
      `取景框 ${box.w}×${box.h} @(${box.x},${box.y})  目标世界(${t.x.toFixed(1)},${t.y.toFixed(1)}) → 框内(${pb[0]})`
    );
  }
  await c.ev(`__MU_APP__.fxClear()`);
  await sleep(400);

  const t0 = Date.now();
  await c.ev(`__MU_APP__.castSkill(${id})`);
  const tCast = Date.now() - t0;

  /*
   * 特效不是同步生成的：`castSkill` 里是 `window.setTimeout(...)` 按动作帧
   * 延后放（实测 1 s 上下）。以前直接开拍，前几帧全是空场景，
   * 等拍到东西时已经错过出生瞬间。这里先**等场上真的有件**再拍第一帧。
   */
  await c.waitFor(
    '(__MU_APP__.fx().length + __MU_APP__.fxSprites().length + (__MU_APP__.fxBeams?.().length ?? 0)) > 0',
    8000,
    '特效出现'
  );
  if (freeze) {
    /*
     * 先等 `freezeDelay` 毫秒再冻。
     *
     * 原因：`delay` 那批件走的是 `window.setTimeout`（**真实时间**），
     * 不受 `timeScale` 控制 —— 一冻住它们照样到点生成，然后以一个
     * 年龄几乎为 0 的状态挂在那里（透明、拍不到）。
     * 想拍「闪光正盛」就等到那批件出来之后再冻。
     */
    const wait = Number(process.argv[5] ?? 0);
    if (wait > 0) await sleep(wait);
    // 冻住（不是 0，见 `dbgTimeScale` 的注释）
    await c.ev(`__MU_APP__.timeScale(0.0008)`);
  }

  for (let i = 0; i < frames; i++) {
    const at = Date.now() - t0;
    // 页面内截图（同一次求值里 render + toDataURL），CDP 只负责搬字符串
    const url = await c.ev(
      box ? `__MU_APP__.snap(${JSON.stringify(box)})` : `__MU_APP__.snap()`
    );
    const at2 = Date.now() - t0;
    const name = `impact-${String(id).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    if (url && url.startsWith('data:image/png')) {
      writeFileSync(`shots/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
    }

    const m = await c.ev(`__MU_APP__.fx()`);
    const s = await c.ev(`__MU_APP__.fxSprites()`);
    // 光束层不在这两个接口里（袭风刺/关节类全靠它），单独读
    const b = await c.ev(`__MU_APP__.fxBeams ? __MU_APP__.fxBeams() : []`);
    const sp = box && s.length
      ? await c.ev(inBox(box, JSON.stringify(s.map(x => x.pos))))
      : [];
    console.log(
      `shots/${name}.png  +${at}~${at2}ms  ` +
        `模型[${m.map(x => `${x.file.replace(/\.bmd$/i, '')}@${x.age}s`).join(',')}]  ` +
        `贴图[${s
          .map((x, i) => `${x.file.split('/').pop()}@${x.age}s${box ? '@' + sp[i] : ''}`)
          .join(',')}]  ` +
        `光束[${b.map(x => `${(x.file || '').split('/').pop()}@${x.age}s`).join(',')}]`
    );
    await sleep(60);
  }
  if (freeze) await c.ev(`__MU_APP__.timeScale(1)`);
  console.log(`（cast 往返 ${tCast}ms —— 每帧的 +Nms 都是从 cast 返回开始算的真实时间）`);
} finally {
  await c.close?.();
}
