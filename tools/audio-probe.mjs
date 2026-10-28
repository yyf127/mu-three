/**
 * 声音系统探针。
 *
 *   node tools/audio-probe.mjs
 *   node tools/audio-probe.mjs 账号 密码
 *
 * 四层：
 *
 *   1. **表**：`Sound_LoadGameSamples`（客户端 `Model_Gates.cpp`）抄过来的 91 条，
 *      每个文件名都要在 `Data/Sound/` 下真的存在（HTTP 200），id 不重复且在 0..419。
 *   2. **技能映射**：`SKILL_SOUND` 里每个音效号都必须能在表里找到（写错就是静音）。
 *   3. **播放语义**：解码 → `played` 计数；通道上限（`channels`）会丢第三次；
 *      静音后 `sfx` 直接返回 false；`dropped` 会记这笔。
 *   4. **场景切换**：洛兰 = Lorencia.mp3 + 风(0)；地下城 = Dungeon.mp3 + 地牢(3)；
 *      塔卡 = 没有 BGM（0.97 就只有 6 首）+ 沙漠(7)；回登录 = Lorencia.mp3。
 *
 * 注意：**探针验不了「有没有声音」** —— headless 里 AudioContext 是 suspended，
 * 只能验「有没有走到播放」和「选中的文件对不对」。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const account = process.argv[2] || '1234';
const password = process.argv[3] || '1234';

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

const c = await createClient('audio');

try {
  /* ================= A. 表与磁盘文件 ================= */
  console.log('[A] 音效表 / 文件存在性');
  const table = JSON.parse(await c.ev('__MU_APP__.audioTable().then(t => JSON.stringify(t))'));
  console.log(`  ${table.length} 条`);
  check('条数 = 91（和 Sound_LoadGameSamples 一致）', table.length === 91, String(table.length));
  check('id 不重复', new Set(table.map(s => s.id)).size === table.length);
  check('id 都在 0..419（g_lpDSBuffer[420]）', table.every(s => s.id >= 0 && s.id < 420));

  // 抽查关键 id（脚步/打击/挥砍/物品/技能）
  const need = {
    0x08: 'pWalk(Soil).wav',
    0x09: 'pWalk(Grass).wav',
    0x0a: 'pWalk(Snow).wav',
    0x1d: 'pGetItem.wav',
    0x1e: 'pDropItem.wav',
    0x20: 'pDrink.wav',
    0x28: 'eSwingWeapon1.wav',
    0x32: 'eShortBlow1.wav',
    0x38: 'eBlow4.wav',
    0x4e: 'pMaleDie.wav',
    0x55: 'sKnightSkill4.wav',
    0x56: 'sTornado.wav',
    0x61: 'eSwellLife.wav',
    0x65: 'eIceArrow.wav',
  };
  for (const [id, file] of Object.entries(need)) {
    const row = table.find(s => s.id === Number(id));
    check(`0x${Number(id).toString(16)} = ${file}`, row?.file === file, row?.file ?? 'MISSING');
  }

  // 每个文件都要 200（名字大小写错就是静默无声，这是最容易漏的坑）
  const missing = [];
  for (const s of table) {
    const url = `http://127.0.0.1:5180/Data/Sound/${encodeURIComponent(s.file)}`;
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) missing.push(`${s.id}:${s.file}`);
  }
  check('全部文件 HTTP 200', missing.length === 0, missing.join(', ') || '91/91');

  /* ================= B. 技能 → 音效 ================= */
  console.log('\n[B] 技能号 → 音效号');
  const skillSound = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.audioSkillSound())'));
  const ids = new Set(table.map(s => s.id));
  const bad = Object.entries(skillSound).filter(([, sid]) => !ids.has(Number(sid)));
  check('每个技能音效号都在表里', bad.length === 0, JSON.stringify(bad));
  check('41 霹雳回旋斩 = 0x55（돌려치기 回旋）', skillSound['41'] === 0x55, String(skillSound['41']));
  check('48 生命之光 = 0x61 eSwellLife', skillSound['48'] === 0x61, String(skillSound['48']));

  /* ================= C. 播放语义 ================= */
  console.log('\n[C] 播放 / 通道上限 / 静音');
  check('解锁 AudioContext', (await c.ev('__MU_APP__.audioUnlock()')) !== 'none', await c.ev('__MU_APP__.audio().contextState'));

  await c.ev('__MU_APP__.audioReset()');
  await c.ev(`__MU_APP__.audioSfx(${0x1d})`);
  // 解码是异步的，等计数涨上来
  let a = null;
  for (let i = 0; i < 40; i++) {
    a = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.audio())'));
    if (a.played > 0) break;
    await sleep(100);
  }
  check('0x1d 拾取音播出去了', a.played >= 1, JSON.stringify({ played: a.played, failed: a.failed }));
  check('缓冲解码成功（failed = 0）', a.failed === 0, String(a.failed));
  check('最近一次是 0x1d', a.lastId === 0x1d, `lastId=${a.lastId}`);

  /*
   * 通道上限：0x1d 的 channels = 1，连发三次应当只过一条。
   * 要等上一声真的「过期」—— 通道存活窗口是 2.5 秒（按最长音效估的），
   * 所以这里必须等满 2.6 秒，不然三次都会被上一声挡掉。
   */
  await sleep(2600);
  await c.ev('__MU_APP__.audioReset()');
  await c.ev(`[__MU_APP__.audioSfx(${0x1d}), __MU_APP__.audioSfx(${0x1d}), __MU_APP__.audioSfx(${0x1d})]`);
  await sleep(600);
  a = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.audio())'));
  check('同一 tick 连发 3 声 → 只过 1 声（channels = 1）', a.played === 1 && a.dropped === 2, JSON.stringify({ played: a.played, dropped: a.dropped }));

  // 2 通道的（挥砍）能过 2 条
  await sleep(600);
  await c.ev('__MU_APP__.audioReset()');
  await c.ev(`[__MU_APP__.audioSfx(${0x28}), __MU_APP__.audioSfx(${0x28}), __MU_APP__.audioSfx(${0x28})]`);
  await sleep(600);
  a = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.audio())'));
  check('2 通道的音效同 tick 连发 3 声 → 过 2 丢 1', a.played === 2 && a.dropped === 1, JSON.stringify({ played: a.played, dropped: a.dropped }));

  // 静音
  await sleep(500);
  await c.ev('__MU_APP__.audioReset()');
  check('静音开关返回 true', (await c.ev('__MU_APP__.audioMute(true)')) === true);
  const muted1 = await c.ev(`__MU_APP__.audioSfx(${0x1d})`);
  check('静音时 sfx 返回 false', muted1 === false, String(muted1));
  check('静音状态写进 localStorage', (await c.ev(`localStorage.getItem('mu.muted')`)) === '1');
  check('取消静音', (await c.ev('__MU_APP__.audioMute(false)')) === false);

  /* ================= D. 场景音频 ================= */
  console.log('\n[D] 地图 → BGM + 环境音');
  /**
   * 切地图并等环境音**解码完**（aWind/desert 都是一兆多的 wav，
   * headless 里偶尔要一秒多才 decode 完，不能只 sleep 固定时间）。
   */
  const scene = async (mapId, wantAmbient) => {
    await c.ev(`__MU_APP__.audioScene(${mapId === null ? 'null' : mapId})`);
    for (let i = 0; i < 50; i++) {
      const st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.audio())'));
      if (st.ambient === wantAmbient) return st;
      await sleep(100);
    }
    return JSON.parse(await c.ev('JSON.stringify(__MU_APP__.audio())'));
  };
  let s = await scene(0, 0x00);
  check('洛兰：Lorencia.mp3 + 风(0x00)', s.bgm === 'Lorencia.mp3' && s.ambient === 0x00, JSON.stringify({ bgm: s.bgm, ambient: s.ambient }));
  s = await scene(1, 0x03);
  check('地下城：Dungeon.mp3 + 地牢(0x03)', s.bgm === 'Dungeon.mp3' && s.ambient === 0x03, JSON.stringify({ bgm: s.bgm, ambient: s.ambient }));
  s = await scene(8, 0x07);
  check('塔卡：0.97 没有这首 BGM（null）+ 沙漠(0x07)', s.bgm === null && s.ambient === 0x07, JSON.stringify({ bgm: s.bgm, ambient: s.ambient }));
  s = await scene(10, 0x14);
  check('天空之城：无 BGM + 天堂(0x14)', s.bgm === null && s.ambient === 0x14, JSON.stringify({ bgm: s.bgm, ambient: s.ambient }));
  s = await scene(null, -1);
  check('回登录：MuTheme = Lorencia.mp3、环境音停掉', s.bgm === 'Lorencia.mp3' && s.ambient === -1, JSON.stringify({ bgm: s.bgm, ambient: s.ambient }));

  /* ================= E. 真机（进图后自动接上） ================= */
  console.log('\n[E] 真服务端进图后的场景音');
  const who = await loginAs(c, account, password);
  await sleep(3000);
  s = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.audio())'));
  const st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
  check(`进 ${st.mapName} 后 BGM / 环境音按地图接上`, s.bgm !== null || st.mapId !== 0, JSON.stringify({ map: st.mapId, bgm: s.bgm, ambient: s.ambient }));
  if (st.mapId === 0) check('洛兰地图 = Lorencia.mp3 + 风', s.bgm === 'Lorencia.mp3' && s.ambient === 0x00, JSON.stringify(s.bgm));

  /*
   * 走两步 → 有脚步声。
   *
   * 点地面走位的落点可能是墙/树（洛兰城里 NPC 和房子不少），走不动就没有脚步，
   * 所以四个方向依次试，直到角色真的移动超过 1 格为止。
   */
  await c.ev('__MU_APP__.audioReset()');
  const p0 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state().player)'));
  let moved = 0;
  for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
    await c.ev(`__MU_APP__.walk(${Math.floor(p0.x) + dx}, ${Math.floor(p0.y) + dy})`);
    await sleep(1800);
    const p1 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state().player)'));
    moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (moved > 1) break;
  }
  a = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.audio())'));
  check('角色真的走动了（否则后面的脚步断言没意义）', moved > 1, `位移 ${moved.toFixed(2)} 格`);
  check('走路有脚步声（0x08/0x09/0x0a）', a.played > 0, `played=${a.played}`);

  console.log(`截图：${await c.shot('audio')}`);
} finally {
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await c.close();
  process.exit(fail === 0 ? 0 : 1);
}
