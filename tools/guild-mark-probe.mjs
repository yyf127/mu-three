/**
 * 战盟标志探针（`CreateGuildMark` + `RenderGuildMarkOnShield`）。
 *
 *   node tools/guild-mark-probe.mjs
 *
 * 验四件事：
 *   A. 纹理合成：32 字节 → 8×8 RGBA，0 号色透明、其余 15 色对得上调色板。
 *   B. 全透明标志不生成 quad（没有着色格就当没有标志，别挂一块空贴图）。
 *   C. 挂点：quad 真的挂到骨骼 26（`Bip01 R UpperArm`）上。
 *   D. 可见性：冻结场景，戴/摘对比像素差，并量出变化区域。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
import { decodePng, diffPng } from './lib/png-diff.mjs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
};

/** 一个显眼的图案：红底(12) + 白边(3) + 中心青(6) */
const PATTERN = (() => {
  const cells = new Array(64).fill(0);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const edge = x === 0 || y === 0 || x === 7 || y === 7;
      cells[y * 8 + x] = edge ? 3 : 12;
    }
  }
  for (let y = 3; y <= 4; y++) for (let x = 3; x <= 4; x++) cells[y * 8 + x] = 6;
  return cells;
})();

/*
 * 走 `/demo` 而不是 `__MU_APP__.offline()`：只有真正走演示入口才会有
 * `currentChar`（角色卡），头顶标签才会生成 —— 离线调试口把 currentChar 置空了，
 * 那条路验不了「名字 + 盟名两行」。
 */
const c = await createClient('guildmark');

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  // 相机是跟随插值的：太早冻结会把镜头留在初始位置（截出来是一片空地）
  await sleep(2500);

  /* ================= A. 纹理 ================= */
  console.log('[A] 32 字节 → 8×8 纹理');
  const tex = JSON.parse(
    await c.ev(`(async () => {
      const g = await import('/src/world/guildMark.ts');
      const n = await import('/src/net/game.ts');
      const cells = ${JSON.stringify(PATTERN)};
      const mark = n.packGuildMark(cells);
      const t = g.guildMarkTexture(mark);
      const d = Array.from(t.image.data);
      // 取几个点：四角(白)、中心(青)、内部(红)
      const px = (x, y) => {
        // 纹理里行是翻过来的：显示的第 y 行 = 数据的第 (7-y) 行
        const o = ((7 - y) * 8 + x) * 4;
        return d.slice(o, o + 4);
      };
      return JSON.stringify({
        w: t.image.width, h: t.image.height, data: d.length,
        corner: px(0, 0), center: px(3, 3), inner: px(1, 1),
        empty: (() => { const t2 = g.guildMarkTexture(new Uint8Array(32)); return Array.from(t2.image.data.slice(0, 4)); })(),
      });
    })()`)
  );
  check('尺寸 8×8', tex.w === 8 && tex.h === 8, `${tex.w}x${tex.h}`);
  check('RGBA 数据 256 字节', tex.data === 256, String(tex.data));
  check('四角 = 白 (255,255,255,255)', tex.corner.join() === '255,255,255,255', tex.corner.join());
  check('中心 = 青 (0,255,255,255)', tex.center.join() === '0,255,255,255', tex.center.join());
  check('内部 = 红 (255,0,0,255)', tex.inner.join() === '255,0,0,255', tex.inner.join());
  check('0 号色全透明（alpha 0）', tex.empty[3] === 0, tex.empty.join());

  /* ================= B. 全透明不挂 ================= */
  console.log('\n[B] 全透明标志');
  const none = await c.ev(`__MU_APP__.guildMark(new Array(64).fill(0))`);
  check('全 0 不生成 quad', none === false, String(none));

  /* ================= C. 挂点 ================= */
  console.log('\n[C] 挂点');
  // 先把盾牌戴上，看标志相对盾的位置
  await c.ev(`__MU_APP__.previewEquip({ cls: 0, weapon: 11, shield: 192 })`);
  const ok = await c.ev(`__MU_APP__.guildMark(${JSON.stringify(PATTERN)})`);
  check('挂上标志', ok === true, String(ok));
  const pose = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.guildMarkPose({}))`));
  console.log(`  bone=${pose.bone} offset=${pose.offset} scale=${pose.scale}`);
  check('挂在 Bip01 R UpperArm 上（骨骼 26）', /UpperArm/.test(pose.bone), pose.bone);

  /* ================= D. 可见性 ================= */
  console.log('\n[D] 可见性（冻结场景，戴/摘对比）');
  await c.ev(`__MU_APP__.face(180)`);
  await c.ev(`__MU_APP__.timeScale(0)`);
  await sleep(400);
  await c.shot('guild-mark-on');
  await c.ev(`__MU_APP__.guildMark(null)`);
  await sleep(300);
  await c.shot('guild-mark-off');
  await c.ev(`__MU_APP__.timeScale(1)`);

  const diff = diffPng(decodePng('shots/guild-mark-on.png'), decodePng('shots/guild-mark-off.png'));
  console.log(
    `  变化 ${(diff.ratio * 100).toFixed(3)}%（${diff.changed} px），区域 ${diff.bbox ? `${diff.bbox.w}×${diff.bbox.h} @ ${diff.bbox.x},${diff.bbox.y}` : '无'}`
  );
  check('画面上确实有变化', diff.changed > 60, `${diff.changed} px`);
  check('变化是一小块而不是整屏（不是渲染错乱）', diff.ratio < 0.05, `${(diff.ratio * 100).toFixed(3)}%`);

  /* ================= E. 头顶盟名 ================= */
  console.log('\n[E] 头顶盟名（第二行）');
  await c.ev(`__MU_APP__.selfGuild('测试战盟')`);
  await sleep(300);
  const withName = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.worldTags())`));
  const selfTag = withName.find(t => t.id === -1);
  check('自己头顶挂上了盟名', selfTag?.guild === '测试战盟', JSON.stringify(selfTag?.guild ?? null));
  // 沙盘没有角色卡，名字行本来就是空的；要验的是「盟名是独立一行，不是拼进名字」
  check('盟名与角色名是两个字段（不覆盖）', !!selfTag && selfTag.guild !== selfTag.name, JSON.stringify({ name: selfTag?.name ?? '', guild: selfTag?.guild ?? '' }));

  await c.ev(`__MU_APP__.selfGuild('')`);
  await sleep(300);
  const without = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.worldTags())`));
  const selfTag2 = without.find(t => t.id === -1);
  check('清空后盟名消失', !selfTag2?.guild, JSON.stringify(selfTag2?.guild ?? null));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
} finally {
  await c.close();
}

process.exit(fail ? 1 : 0);
