/**
 * 怪物音效 / 界面音效探针。
 *
 *   node tools/monster-sound-probe.mjs
 *
 * 验四件事：
 *
 *   1. **表覆盖**：`src/data/monsterSounds.ts` 由 `tools/gen-monster-sounds.mjs`
 *      从 `Monster_Data.cpp` 生成，每个文件名都必须真的落在 `Data/Sound/` 下。
 *   2. **界面音效 7 条**（另一张表：`Scene_AssetLoad.cpp`）在 `SOUND_BY_ID` 里。
 *   3. **按文件名播放**能走通（`sfxFile`）—— 怪物音效没有固定 id，
 *      这条是新加的路径，原来的 `sfx(id)` 走不到它。
 *   4. **通道上限**：怪物音 `channels = 2`，第三次要按 `dropped` 丢掉。
 *
 * headless 里 AudioContext 是 suspended，验不了「真的响了」，
 * 只能验「走到播放 + 选中的文件对」。
 */
import { createClient } from './lib/edge-client.mjs';

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

const c = await createClient('monsound');

try {
  /* ================= A. 表 ================= */
  console.log('[A] 怪物音效表');
  const info = JSON.parse(
    await c.ev(`(async () => {
      const m = await import('/src/data/monsterSounds.ts');
      const t = m.MONSTER_SOUNDS;
      const files = new Set();
      let withDie = 0, withAttack = 0;
      for (const k of Object.keys(t)) {
        const s = t[k];
        if (s.die) withDie++;
        if (s.attack.length) withAttack++;
        for (const f of [...s.idle, ...s.attack, ...(s.die ? [s.die] : [])]) files.add(f);
      }
      return JSON.stringify({
        types: Object.keys(t).length,
        keys: Object.keys(t).map(Number).sort((a, b) => a - b),
        files: [...files],
        withDie, withAttack,
      });
    })()`)
  );
  console.log(`  ${info.types} 个 type，${info.files.length} 个不同文件`);
  check('覆盖 47 个 type', info.types === 47, String(info.types));
  check('type 范围 0..59', info.keys[0] === 0 && info.keys.at(-1) === 59, `${info.keys[0]}..${info.keys.at(-1)}`);
  check('大多数有死亡音', info.withDie >= 39, `${info.withDie}/47`);

  /* 文件真的在（同一个 HTTP 服务下 HEAD） */
  const missing = JSON.parse(
    await c.ev(`(async () => {
      const list = ${JSON.stringify(info.files)};
      const bad = [];
      for (const f of list) {
        const r = await fetch('/Data/Sound/' + f, { method: 'HEAD' });
        if (!r.ok) bad.push(f);
      }
      return JSON.stringify(bad);
    })()`)
  );
  check('全部文件 HTTP 200', missing.length === 0, missing.slice(0, 5).join(', ') || `${info.files.length}/${info.files.length}`);

  /* 抽查语义：0 号是 Bull、3 号是 DarkKnight（和 Monster_Data.cpp 的 case 对齐） */
  const sample = JSON.parse(
    await c.ev(`(async () => {
      const m = await import('/src/data/monsterSounds.ts');
      return JSON.stringify({ bull: m.MONSTER_SOUNDS[0], dk: m.MONSTER_SOUNDS[3], none: m.monsterSoundSet(999) });
    })()`)
  );
  check('type 0 = Bull', /mBullDie/.test(sample.bull?.die ?? ''), JSON.stringify(sample.bull));
  check('type 3 = DarkKnight', /mDarkKnightAttack/.test((sample.dk?.attack ?? []).join(',')), '');
  check('未登记 type 返回 null', sample.none === null, JSON.stringify(sample.none));

  /* ================= B. 界面音效 ================= */
  console.log('\n[B] 界面音效（第二张表 7 条）');
  const ui = JSON.parse(
    await c.ev(`(async () => {
      const m = await import('/src/data/sounds.ts');
      const need = [0x04, 0x19, 0x1a, 0x1b, 0x1c, 0x25, 0x26];
      const out = {};
      for (const id of need) out[id] = m.SOUND_BY_ID.get(id)?.file ?? null;
      return JSON.stringify({ table: m.SOUNDS.length, out });
    })()`)
  );
  console.log(`  表长 ${ui.table}`);
  check('表 = 98 条', ui.table === 98, String(ui.table));
  check('0x19 = iButtonClick', ui.out['25'] === 'iButtonClick.wav', ui.out['25'] ?? 'null');
  check('0x26 = iWhisper', ui.out['38'] === 'iWhisper.wav', ui.out['38'] ?? 'null');
  check('0x1c = iCreateWindow', ui.out['28'] === 'iCreateWindow.wav', ui.out['28'] ?? 'null');
  check('0x25 = iRepair', ui.out['37'] === 'iRepair.wav', ui.out['37'] ?? 'null');
  check('0x04 = iTitle', ui.out['4'] === 'iTitle.wav', ui.out['4'] ?? 'null');

  /* ================= C. 播放路径 ================= */
  console.log('\n[C] 播放（sfxFile 按文件名 / sfx 按 id）');
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  /*
   * 注意：页面里 `import('/src/audio/sound.ts')` 和 `main.ts` 的 `./audio/sound`
   * 在 Vite 下是**两个模块实例**（各自一份 ctx / 计数器），所以这里必须在
   * 同一个实例上解锁 + 播放 + 读计数，不能借 `__MU_APP__.audioUnlock()`。
   */
  await c.ev(`(async () => {
    const s = await import('/src/audio/sound.ts');
    s.unlockAudio();
    s.setMuted(false);
    s.resetAudioDebug();
    return 1;
  })()`);

  const played = JSON.parse(
    await c.ev(`(async () => {
      const s = await import('/src/audio/sound.ts');
      s.unlockAudio();
      s.setMuted(false);
      s.resetAudioDebug();
      s.setListener(0, 0, 0);
      const a = s.sfxFile('mBullDie.wav', { x: 1, y: 0 });
      const b = s.sfx(0x26, { volume: 0.7 });
      await new Promise(r => setTimeout(r, 400));
      const d = s.audioDebug();
      return JSON.stringify({ a, b, played: d.played, active: Object.keys(d.active), lastId: d.lastId });
    })()`)
  );
  console.log(`  played=${played.played} lastId=${played.lastId} active=${played.active.join(',')}`);
  check('sfxFile 返回 true', played.a === true);
  check('sfx(0x26) 返回 true', played.b === true);
  check('真的走到播放（played ≥ 2）', played.played >= 2, String(played.played));
  check('通道键带文件名', played.active.some(k => k === 'mBullDie.wav'), played.active.join(','));
  check('通道键带 #38（悄悄话）', played.active.some(k => k === '#38'), played.active.join(','));

  /* ================= D. 通道上限 ================= */
  console.log('\n[D] 通道上限（怪物音 channels=2）');
  const cap = JSON.parse(
    await c.ev(`(async () => {
      const s = await import('/src/audio/sound.ts');
      s.unlockAudio();
      s.setMuted(false);
      s.resetAudioDebug();
      const r = [];
      for (let i = 0; i < 3; i++) r.push(s.sfxFile('mHound1.wav', { x: 1, y: 0 }));
      await new Promise(r2 => setTimeout(r2, 300));
      const d = s.audioDebug();
      return JSON.stringify({ r, played: d.played, dropped: d.dropped });
    })()`)
  );
  check('前两次通过、第三次被丢', cap.r[0] && cap.r[1] && !cap.r[2], JSON.stringify(cap.r));
  check('dropped ≥ 1', cap.dropped >= 1, String(cap.dropped));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
} finally {
  await c.close();
}

process.exit(fail ? 1 : 0);
