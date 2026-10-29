/**
 * 守护 / 宠物（Helper01..04）渲染探针。
 *
 * 原版 `Render_PlayerHelper` 只画 `helper == 817`（Helper02 = 小恶魔 Imp），
 * 这里把 416..419 四个都试一遍，确认模型能加载、骨架/动画正常。
 *
 *   node tools/helper-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
import { decodePng, diffPng } from './lib/png-diff.mjs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  ok ? (pass++, console.log(`  ✓ ${label}${detail ? '  ' + detail : ''}`)) : (fail++, console.log(`  ✗ ${label}${detail ? '  ' + detail : ''}`));
};

/**
 * 416..419 = Helper01..Helper04。
 *
 * 只有 416/417 会画：它们是自带 8 骨 7 帧循环的「跟飞宠物」。
 * 418/419 是**骑乘坐骑**（只有 2 骨 1 帧的静态模型），原版 `Render_PlayerHelper`
 * 第一行就 `if (helper != 817) return`，也不画 —— 这里改成断言「不渲染」。
 */
const RENDERED = [
  { type: 416, name: 'Helper01', tag: '精灵' },
  { type: 417, name: 'Helper02', tag: '小恶魔' },
];
const SKIPPED = [
  { type: 418, name: 'Helper03', tag: '独角兽' },
  { type: 419, name: 'Helper04', tag: '恐龙' },
];

const c = await createClient('helper');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 120000, '进图');
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(1200);

  for (const cs of RENDERED) {
    const out = await c.ev(`__MU_APP__.previewEquip({ cls: 0, weapon: 11, helper: ${cs.type} })`);
    if (!out || out.error) {
      check(`${cs.tag}(${cs.type}) 换装`, false, JSON.stringify(out));
      continue;
    }
    const h = out.helper;
    check(
      `${cs.tag}(${cs.type}) 模型加载`,
      !!h && h.name.includes(cs.name),
      h ? `${h.name} · ${h.bones} 骨 / ${h.keys} 帧` : 'null'
    );
    await sleep(400);
    await c.shot(`helper-${cs.type}`);
  }

  // 坐骑（418/419）不渲染：原版也只有 Helper02 那条分支
  for (const cs of SKIPPED) {
    const out = await c.ev(`__MU_APP__.previewEquip({ cls: 0, weapon: 11, helper: ${cs.type} })`);
    check(`${cs.tag}(${cs.type}) 坐骑不渲染`, out && !out.helper, JSON.stringify(out?.helper ?? null));
  }

  // 摘掉
  const none = await c.ev(`__MU_APP__.previewEquip({ cls: 0, weapon: 11 })`);
  check('不戴守护时 helper 为 null', !none.helper, JSON.stringify(none.helper));

  /*
   * 「加载了」不等于「看得见」：冻结场景后拍两张，用像素差确认它真的画在角色旁边。
   * 变化区应该是个几十像素的小块（宠物个头就那么点），而不是整屏或完全没有。
   */
  await c.ev(`__MU_APP__.timeScale(0)`);
  await sleep(700);
  await c.ev(`__MU_APP__.previewEquip({ cls: 0, weapon: 11 })`);
  await sleep(500);
  await c.shot('helper-off');
  await c.ev(`__MU_APP__.previewEquip({ cls: 0, weapon: 11, helper: 417 })`);
  await sleep(500);
  await c.shot('helper-on');
  await c.ev(`__MU_APP__.timeScale(1)`);

  const d = diffPng(decodePng('shots/helper-off.png'), decodePng('shots/helper-on.png'));
  console.log(
    `\n可见性：变化 ${(d.ratio * 100).toFixed(3)}%` +
      `（${d.changed} 像素）` +
      `，区域 ${d.bbox ? `${d.bbox.w}×${d.bbox.h} @ ${d.bbox.x},${d.bbox.y}` : '无'}`
  );
  check('守护真的画在画面上（像素有变化）', d.changed > 100, `${d.changed} px`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
