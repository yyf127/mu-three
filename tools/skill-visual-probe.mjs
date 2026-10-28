/**
 * 全技能视觉盘点（离线沙盘）—— 45 个技能逐个施法，看「到底生成了哪些特效层」。
 *
 *   node tools/skill-visual-probe.mjs           # 全部技能
 *   node tools/skill-visual-probe.mjs 4 19 22  # 只测这几个
 *
 * 为什么不看「像素差分」：沙盘的相机会跟着角色贴过去（`castSkill` 里
 * `muCamera.setTarget + update(1.5)`），角色一动整屏都在位移，差分动辄 60%，
 * 和「有没有特效」完全无关。而角色自己的挥砍动作也有 7~12% 的差异 ——
 * 两条都会把「无特效」判成「有」。
 *
 * 所以判据换成**结构侧**：施法后 0.5s / 0.9s 各读一次六个特效层的存活数量
 *
 *   model  `Data/Skill/*.bmd`（`effects`）
 *   sprite `Data/Effect/*.ozj|ozt` 序列帧 / 光斑（`spriteLayer`）
 *   beam   `Joint_Create` 两点光束（`beamLayer`）
 *   trail  武器拖尾（`trailLayer`）
 *   wheel  武器旋转（源码 238，`wheelLayer`）
 *   slam   武器砸地（源码 244，`slamLayer`）
 *
 * 六层全 0 = 画面上什么都没有（只有动作），这才是「特效缺失」。
 * 顺便把角色和靶子藏起来截一张图存档，方便人工核对落点。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const only = process.argv.slice(2).map(Number).filter(n => n > 0);
mkdirSync('shots/skills', { recursive: true });

const c = await createClient('skillvis');

/*
 * 注意 `fxWheels()` / `fxSlam()` 返回的是**实例数组**（可能同时有多个），
 * 不是 `{active}` 对象 —— 早先按 `.active` 读，41 号「霹雳回旋斩」明明在转
 * 却被判成「无视觉」，就是这一处读错了字段。
 */
const LAYERS = `JSON.stringify({
  model: __MU_APP__.fx().length,
  sprite: __MU_APP__.fxSprites().length,
  beam: __MU_APP__.fxBeams().length,
  trail: __MU_APP__.fxTrail().live ? 1 : 0,
  wheel: __MU_APP__.fxWheels().length,
  slam: __MU_APP__.fxSlam().length,
  // 箭矢（源码 CreateArrows）：多重箭 3 支、冰封箭/穿透箭各 1 支
  arrow: __MU_APP__.fxArrows().length,
})`;

/** 靶子附近的取景框（相机稳定后算一次） */
const computeClip = async () => {
  let prev = null;
  let same = 0;
  for (let i = 0; i < 50; i++) {
    const raw = await c.ev(`(() => {
      const t = __MU_APP__.skillTarget();
      if (!t || !window.__MU_DEBUG__) return '';
      const p = __MU_DEBUG__.project(t.x, t.y, t.z + 1.2);
      return JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) });
    })()`);
    if (raw) {
      if (raw === prev) {
        if (++same >= 4) break;
      } else {
        same = 0;
        prev = raw;
      }
    }
    await sleep(250);
  }
  if (!prev) return null;
  const p = JSON.parse(prev);
  return {
    x: Math.max(0, p.x - 240),
    y: Math.max(0, p.y - 260),
    width: 480,
    height: 420,
    scale: 1,
  };
};

try {
  // 进离线沙盘（和 tools/skill-probe.mjs 同一个入口）
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 120000, '离线沙盘就绪');
  await c.waitFor(`!!__MU_APP__.skillTarget()`, 40000, '技能靶子');

  // 先施法一次让相机贴到靶子面前，再等投影稳定
  await c.ev(`(async () => await __MU_APP__.castSkill(4))()`);
  await sleep(2400);
  await c.ev('__MU_APP__.fxClear()');

  const clip = await computeClip();
  if (!clip) throw new Error('拿不到靶子投影');

  const all = JSON.parse(await c.ev('(async () => JSON.stringify(await __MU_APP__.skills()))()'));
  const list = only.length ? all.filter(s => only.includes(s.id)) : all;
  console.log(`盘点 ${list.length} 个技能\n`);
  console.log(' id  名称            动作  来源    模型 贴图 光束 拖尾 旋转 砸地  箭  结论');

  const rows = [];
  for (const s of list) {
    await c.ev('__MU_APP__.fxClear()');
    await sleep(220);

    const t0 = Date.now();
    await c.ev(`(async () => await __MU_APP__.castSkill(${s.id}))()`);

    /*
     * 轮询 2 秒取峰值，**不固定采样点**：
     * 特效的 `delay` 从 0 到 0.68 s 不等、寿命 0.3~1 s 不等，固定两个时间点
     * 会随机器负载忽快忽慢地漏采（同一技能上一轮测到 10 件、下一轮 0 件）。
     * BMD 首次加载还会额外拖几百毫秒。
     */
    let peak = { model: 0, sprite: 0, beam: 0, trail: 0, wheel: 0, slam: 0, arrow: 0 };
    for (let i = 0; i < 16; i++) {
      await sleep(130);
      const now = JSON.parse(await c.ev(LAYERS));
      for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], now[k] || 0);
    }
    const cost = Date.now() - t0;

    const total =
      peak.model + peak.sprite + peak.beam + peak.trail + peak.wheel + peak.slam + peak.arrow;
    const verdict = total > 0 ? '有' : '无';
    rows.push({ id: s.id, name: s.name, action: s.action, source: s.source, ...peak, total, verdict, cost });

    console.log(
      `${String(s.id).padStart(3)}  ${s.name.padEnd(14, '　')} ${String(s.action).padStart(4)}  ` +
        `${String(s.source).padEnd(8)} ${String(peak.model).padStart(4)} ${String(peak.sprite).padStart(4)} ` +
        `${String(peak.beam).padStart(4)} ${String(peak.trail).padStart(4)} ${String(peak.wheel).padStart(4)} ` +
        `${String(peak.slam).padStart(4)} ${String(peak.arrow).padStart(3)}  ${verdict}`
    );

    // 没有视觉的技能单独留一张图（藏掉角色/靶子，只剩特效层）
    if (total === 0 && clip) {
      await c.ev('__MU_APP__.setActorsVisible(false, false)');
      await sleep(120);
      const r = await c.send('Page.captureScreenshot', { format: 'png', clip });
      writeFileSync(`shots/skills/none-${s.id}.png`, Buffer.from(r.data, 'base64'));
      await c.ev('__MU_APP__.setActorsVisible(true, true)');
    }
  }

  await c.ev('__MU_APP__.fxClear()');

  const none = rows.filter(r => r.verdict === '无');
  const bySource = rows.reduce((m, r) => ((m[r.source] = (m[r.source] || 0) + 1), m), {});
  console.log(
    `\n合计 ${rows.length}：有视觉 ${rows.length - none.length}，无视觉 ${none.length}` +
      `（来源：${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(' / ')}）`
  );
  if (none.length) console.log('无视觉：' + none.map(r => `${r.id}:${r.name}(${r.source})`).join(', '));

  writeFileSync('shots/skill-visual.json', JSON.stringify(rows, null, 1));
  console.log('明细：shots/skill-visual.json');
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-15).join('\n'));
} finally {
  await c.close();
}
