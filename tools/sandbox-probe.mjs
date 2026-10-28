/**
 * 离线演示「角色 / 装备」面板探针。
 *
 * 断言三件事，任何一件不对都说明面板不是真的由 item.bmd 驱动：
 *   ① 面板结构对得上参考图（三张卡片：Character / Equipment / Skill，8 个部位下拉）
 *   ② 每个下拉里的装备名，和**探针自己独立解出来的 item.bmd** 完全一致
 *      （不是「数量差不多」，是逐个字符串比对；模型不存在的要一起排除）
 *   ③ 点了真的会变：换职业 → 职业默认身体换套；选装备 → 网格换成该装备模型
 *
 *   node tools/sandbox-probe.mjs
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const DATA = 'D:/Project/H5_mu/muonlinejs-master/public/Data';
const KEY = [0xfc, 0xcf, 0xab];

/* ------------------------------------------------------------------ */
/* 独立实现一份 item.bmd 解码（故意不复用 src/，用来交叉验证）           */
/* ------------------------------------------------------------------ */
function readItemBmd() {
  const raw = readFileSync(`${DATA}/Local/item.bmd`);
  const dec = Buffer.from(raw.subarray(0, 512 * 64));
  // 每条记录各自从 key[0] 重新开始（ItemEditor.cs 对每条单独 BuxConvert）
  for (let i = 0; i < dec.length; i++) dec[i] ^= KEY[i % 64 % 3];
  const u8 = (o, p) => dec[o + p] ?? 0;
  const rows = [];
  for (let t = 0; t < 512; t++) {
    const o = t * 64;
    let name = '';
    for (let i = 0; i < 30 && dec[o + i]; i++) name += String.fromCharCode(dec[o + i]);
    rows.push({ type: t, name, cls: [u8(o, 56), u8(o, 57), u8(o, 58), u8(o, 59)] });
  }
  return rows;
}

const SLOT_OF = t => {
  const g = Math.floor(t / 32);
  const i = t % 32;
  if (g <= 5) return 0;
  if (g === 6) return 1;
  if (g >= 7 && g <= 11) return g - 5;
  if (g === 12 && i <= 6) return 7;
  return -1;
};

const BODY = cls => (cls === 2 ? 'Elf' : 'Male');
const WEAPON_PREFIX = ['Sword', 'Axe', 'Mace', 'Spear', 'Bow', 'Staff', 'Shield'];
const ARMOR_PREFIX = ['Helm', 'Armor', 'Pant', 'Glove', 'Boot'];
const pad2 = n => String(n).padStart(2, '0');
/** item.bmd 里箭矢/弩矢不是装备（和 src/data/equipCatalog.ts 的 AMMO 对齐） */
const AMMO = new Set([135, 143]);

/**
 * type → 模型文件路径，规则照抄 `src/world/items.ts::itemModelPath`：
 * 弓组 4 是三段（Bow 1..7 / Arrows / CrossBow 1..7 / Arrows2 / CrossBow17 / Bow18 / Bow19），
 * 翅膀 12 只有 1..7，防具 7..11 的序号跟穿戴者体型拼 Male / Elf。
 */
function modelPath(type, cls) {
  const g = Math.floor(type / 32);
  const i = type % 32;
  if (g === 4) {
    if (i <= 6) return `Item/Bow${pad2(i + 1)}.bmd`;
    if (i === 7) return 'Item/Arrows01.bmd';
    if (i >= 8 && i <= 14) return `Item/CrossBow${pad2(i - 7)}.bmd`;
    if (i === 15) return 'Item/Arrows02.bmd';
    if (i === 16) return 'Item/CrossBow17.bmd';
    if (i === 17) return 'Item/Bow18.bmd';
    if (i === 18) return 'Item/Bow19.bmd';
    return null;
  }
  if (g >= 0 && g <= 6) return `Item/${WEAPON_PREFIX[g]}${pad2(i + 1)}.bmd`;
  if (g >= 7 && g <= 11) {
    // 精灵装压缩过一次：index 10..14 → *Elf01..05（见 items.ts::bodyFileIndex）
    const n = BODY(cls) === 'Elf' ? i - 9 : i + 1;
    return n >= 1 ? `Player/${ARMOR_PREFIX[g - 7]}${BODY(cls)}${pad2(n)}.bmd` : null;
  }
  if (g === 12) return i <= 6 ? `Item/Wing${pad2(i + 1)}.bmd` : null;
  return null;
}

/**
 * 大小写敏感的存在性检查。
 * Windows 的 existsSync 不区分大小写，但开发服务器（和真实静态托管）是按 URL 找文件的：
 * 目录里是 `shield16.bmd`，客户端请求 `Shield16.bmd` 就会 404 —— 所以这里逐段精确比对。
 */
function existsExact(relPath) {
  let dir = DATA;
  for (const seg of relPath.split('/')) {
    if (!existsSync(dir)) return false;
    const hit = readdirSync(dir).find(n => n === seg);
    if (!hit) return false;
    dir = `${dir}/${hit}`;
  }
  return true;
}

function modelOk(type, cls) {
  const p = modelPath(type, cls);
  return !!p && existsExact(p);
}

/** 某职业某槽位「应该出现在下拉里」的名字列表（按名字排序） */
function expectedNames(rows, cls, slot) {
  return rows
    .filter(
      r =>
        r.name &&
        !AMMO.has(r.type) &&
        SLOT_OF(r.type) === slot &&
        (r.cls[cls] ?? 0) > 0 &&
        modelOk(r.type, cls)
    )
    .map(r => r.name)
    .sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ */
/* 浏览器侧                                                            */
/* ------------------------------------------------------------------ */
const c = await createClient('sandbox');
const fail = [];
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) fail.push(label);
};

async function shotClip(name, sel) {
  const box = JSON.parse(
    await c.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height }); })()`)
  );
  const r = await c.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...box, scale: 2 },
  });
  writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
}

const report = async () => JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.sandbox())`));
const meshes = async () =>
  JSON.parse(await c.ev(`JSON.stringify((__MU_APP__.playerActor()?.meshes ?? []).map(m => m.name.split(':')[0]))`));

try {
  const rows = readItemBmd();

  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图');
  await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, '角色创建');
  // 面板跟着 HUD 一起出现（loadWorld 末尾才 showScreens({hud})）
  await c.waitFor(`!document.querySelector('#sandbox').classList.contains('hidden')`, 60000, '面板出现');

  /* ---- ① 结构 ---- */
  const dom = JSON.parse(
    await c.ev(`(() => {
      const cards = [...document.querySelectorAll('#sandbox .sb-card')];
      return JSON.stringify({
        visible: !document.querySelector('#sandbox').classList.contains('hidden'),
        cards: cards.length,
        titles: cards.map(c => c.querySelector('.sb-title').textContent),
        labels: [...document.querySelectorAll('#sandbox .sb-label')].map(e => e.textContent),
        classOptions: [...document.querySelectorAll('#sandbox .sb-field select')][0].options.length,
      });
    })()`)
  );
  check('面板已显示', dom.visible);
  check('三张卡片（新增 Skill）', dom.cards === 3, JSON.stringify(dom.titles));
  const wantLabels = ['Class', 'Helm', 'Armor', 'Pants', 'Gloves', 'Boots', 'Left Hand', 'Right Hand', 'Wings', 'Skill'];
  check('字段与参考图一致', JSON.stringify(dom.labels) === JSON.stringify(wantLabels), JSON.stringify(dom.labels));
  check('Class 有 4 个职业', dom.classOptions === 4);

  /* ---- ② 选项 == item.bmd ---- */
  const state0 = await report();
  check('默认职业 Dark Wizard', state0.cls === 0, `cls=${state0.cls}`);
  check('默认全部 None', Object.values(state0.slots).every(v => v === undefined));

  for (const [cls, clsName] of [
    [0, 'Dark Wizard'],
    [1, 'Dark Knight'],
    [2, 'Fairy Elf'],
    [3, 'Magic Gladiator'],
  ]) {
    await c.ev(`__MU_APP__.sandboxClass(${cls})`);
    await c.waitFor(`__MU_APP__.sandbox().cls === ${cls}`, 20000, `切到 ${clsName}`);
    await sleep(600); // 等目录里的 HEAD 探测跑完并回填 option
    const rendered = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.sandboxOptions())`));
    const slots = { Helm: 2, Armor: 3, Pants: 4, Gloves: 5, Boots: 6, 'Left Hand': 1, 'Right Hand': 0, Wings: 7 };
    for (const [label, slot] of Object.entries(slots)) {
      const want = expectedNames(rows, cls, slot);
      const got = (rendered[label] ?? []).slice().sort((a, b) => a.localeCompare(b));
      const same = JSON.stringify(want) === JSON.stringify(got);
      check(
        `${clsName} / ${label}（${want.length} 项）与 item.bmd 一致`,
        same,
        same ? '' : `期望 ${JSON.stringify(want)} 实际 ${JSON.stringify(got)}`
      );
    }
  }

  /* ---- ③ 换职业真的换身体 ---- */
  await c.ev(`__MU_APP__.sandboxClass(3)`); // 魔剑士
  await c.waitFor(`__MU_APP__.sandbox().cls === 3`, 20000, '回到 MG');
  await c.waitFor(`__MU_APP__.playerActor().meshes.some(m => m.name.includes('Class04'))`, 30000, 'MG 身体');
  const mg = await meshes();
  check('魔剑士用 *Class04 身体', mg.every(n => n.includes('Class04')), JSON.stringify([...new Set(mg)]));

  await c.ev(`__MU_APP__.sandboxClass(2)`); // 精灵
  await c.waitFor(`__MU_APP__.playerActor().meshes.some(m => m.name.includes('Class03'))`, 30000, '精灵身体');
  const elf = await meshes();
  check('精灵用 *Class03 身体', elf.every(n => n.includes('Class03')), JSON.stringify([...new Set(elf)]));

  /* ---- ④ 选装备真的换模型（精灵 → 用 *Elf 前缀 + 压缩过的序号） ---- */
  const elfHelmType = rows.find(r => r.name === 'Vine Helm');
  check('Vine Helm 存在于 item.bmd', !!elfHelmType, `type=${elfHelmType?.type}`);
  await c.ev(`__MU_APP__.sandboxPick('helm', ${elfHelmType.type})`);
  await c.waitFor(`__MU_APP__.playerActor().meshes.some(m => m.name.includes('HelmElf'))`, 30000, '精灵头盔');
  const elfHelm = await meshes();
  check('精灵戴 Vine Helm → HelmElf01', elfHelm.some(n => n.startsWith('HelmElf01')), JSON.stringify([...new Set(elfHelm)]));

  /* ---- ⑤ 换回男职业 + 穿整套 ---- */
  await c.ev(`__MU_APP__.sandboxClass(1)`); // 黑骑士
  await c.waitFor(`__MU_APP__.playerActor().meshes.some(m => m.name.includes('Class02'))`, 30000, 'DK 身体');

  const pick = name => rows.find(r => r.name === name)?.type;
  const full = {
    helm: 'Bronze Helm',
    armor: 'Bronze Armor',
    pants: 'Bronze Pants',
    gloves: 'Bronze Gloves',
    boots: 'Bronze Boots',
    shield: 'Kite Shield',
    weapon: 'Katana',
  };
  for (const [key, name] of Object.entries(full)) {
    const t = pick(name);
    if (t === undefined) throw new Error(`item.bmd 里没有 ${name}`);
    await c.ev(`__MU_APP__.sandboxPick(${JSON.stringify(key)}, ${t})`);
  }
  await c.waitFor(
    `(() => { const a = __MU_APP__.playerActor();
      const n = a.meshes.map(m => m.name.split(':')[0]);
      return n.filter(x => /^(Helm|Armor|Pant|Glove|Boot)Male\\d+/.test(x)).length >= 5 && a.props.length >= 2; })()`,
    40000,
    '整套上身'
  );
  const dressed = await meshes();
  const heldNow = JSON.parse(
    await c.ev(`JSON.stringify(__MU_APP__.playerActor().props.map(g => g.name + '@' + (g.parent ? g.parent.name : '?')))`)
  );
  console.log('   身体:', JSON.stringify([...new Set(dressed)].filter(n => /Male/.test(n))));
  console.log('   手持:', JSON.stringify(heldNow));
  check('装备全部换成 Male 系模型', dressed.every(n => !/Class/.test(n)));
  check('武器/盾挂上了骨骼', heldNow.length >= 2, JSON.stringify(heldNow));

  await shotClip('sandbox-panel', '#sandbox');
  await shotClip('sandbox-player', '#stage');

  /* ---- ⑥ 回 None ---- */
  for (const key of Object.keys(full)) await c.ev(`__MU_APP__.sandboxPick(${JSON.stringify(key)}, null)`);
  await c.waitFor(
    `(() => { const n = __MU_APP__.playerActor().meshes.map(m => m.name.split(':')[0]);
      return n.length === 5 && n.every(x => /Class\\d+\\.bmd$/.test(x)) && __MU_APP__.playerActor().props.length === 0; })()`,
    40000,
    '清空回职业默认'
  );
  check('清空后回职业默认身体', true, JSON.stringify([...new Set(await meshes())]));

  const errs = c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]'));
  console.log('控制台错误:', errs.length, errs.slice(0, 3));
  check('无控制台错误', errs.length === 0);
} finally {
  await c.close();
}

console.log(fail.length ? `\n失败 ${fail.length} 项：\n  - ${fail.join('\n  - ')}` : '\n全部通过');
process.exitCode = fail.length ? 1 : 0;
