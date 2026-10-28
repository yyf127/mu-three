/**
 * 把 MuServer 的服务端配置表（`MuServer/Data/*.txt`）编成一份 JSON：
 * `server/data/game.json`。
 *
 *   node tools/build-game-config.mjs
 *
 * 为什么是 JSON 不是 SQLite：
 *   配置全量才 2000 行（159 怪 / 1490 刷怪点 / 45 技能），演示服是**只读、全量、本地**，
 *   SQL 的并发/事务/索引一个都用不上；而 sql.js 要多背 670KB wasm + 60ms 初始化。
 *   用一张表就能解决的事，不必引入数据库。
 *
 * txt 格式（0.97 服务端，tab 分隔；`//` 是注释；字段之间垫了对齐用的空 tab，
 * 服务端解析器会跳过空字段，这里同样处理）：
 *
 *   Monster/Monster.txt        159 行：等级 / MaxLife / 攻防 / 掉落率 / 金钱 …
 *   Monster/MonsterSetBase.txt 1490 行：每张图的刷怪点（Mob Map Range X Y Dir）
 *   Skill/Skill.txt            45 行：伤害 / 耗蓝 / 范围
 *   Item/Item.txt              393 行：只取「掉落判定」要的三列（等级 / 可掉 / 组·索引）
 *
 * 输出是**派生数据**：本地跑、结果入库（`server/data/game.json`），CI 不跑
 * （CI 里没有 MuServer）。
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = 'D:/Project/H5_mu/MuServer/Data';
const OUT = join(ROOT, 'server/data/game.json');

/** 读一个 txt：去注释/空行，按 tab 切列并跳过空字段 */
function readTable(file) {
  const text = readFileSync(join(SRC, file), 'utf8');
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const cells = line
      .split('\t')
      .map(c => c.trim().replace(/^"(.*)"$/, '$1'))
      .filter(c => c !== '');
    if (cells.length) rows.push(cells);
  }
  return rows;
}

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/* ------------------------------------------------------------------ */
/* 解析                                                                */
/* ------------------------------------------------------------------ */

/** Monster.txt：Index Rate Name Level MaxLife …（去掉对齐空列后 27 列） */
function parseMonsters() {
  const out = {};
  for (const r of readTable('Monster/Monster.txt')) {
    if (r.length < 21 || !Number.isFinite(Number(r[0]))) continue;
    const cls = num(r[0]);
    out[cls] = {
      cls,
      name: r[2] ?? '',
      level: num(r[3]),
      maxHp: num(r[4]),
      maxMana: num(r[5]),
      dmgMin: num(r[6]),
      dmgMax: num(r[7]),
      defense: num(r[8]),
      mgcDef: num(r[9]),
      atkRate: num(r[10]),
      defRate: num(r[11]),
      atkRange: num(r[13]),
      view: num(r[14]),
      moveSpeed: num(r[15]),
      atkSpeed: num(r[16]),
      itemRate: num(r[19]),
      money: num(r[20]),
      minItemLevel: num(r[21]),
    };
  }
  return out;
}

/**
 * MonsterSetBase.txt：服务端的刷怪表。
 *
 *   //Mob  MapNum  Range  PosX  PosY  Direct  //Name
 *   255    0       0      123   135   1       // Lumen the Barmaid
 *   end
 *
 * 段首单独一行数字 = 地图号；`end` 结束。`Range > 0` 表示「在半径内刷一群」。
 */
function parseSpawns() {
  const out = {};
  let map = 0;
  for (const r of readTable('Monster/MonsterSetBase.txt')) {
    if (r.length === 1) {
      if (Number.isFinite(Number(r[0]))) map = num(r[0]);
      continue;
    }
    if (r.length < 6) continue;
    const mob = num(r[0], -1);
    if (mob < 0) continue;
    const m = Number.isFinite(Number(r[1])) ? num(r[1]) : map;
    (out[m] ??= []).push({ mob, x: num(r[3]), y: num(r[4]), dir: num(r[5]), range: num(r[2]) });
  }
  return out;
}

/** Skill.txt：Index Name Damage MP BP Range … */
function parseSkills() {
  const out = [];
  for (const r of readTable('Skill/Skill.txt')) {
    if (r.length < 11 || !Number.isFinite(Number(r[0]))) continue;
    out.push({
      idx: num(r[0]),
      name: r[1] ?? '',
      damage: num(r[2]),
      mana: num(r[3]),
      range: num(r[5]),
      effect: num(r[9]),
      reqLevel: num(r[10]),
    });
  }
  return out;
}

/**
 * Item.txt：只取掉落判定要用的列。
 *
 * 服务端 `CMonsterManager::InsertMonsterItem` 的语义是：
 *   「怪物等级 L 的掉落池 = 所有 `Drop != 0` 且 `Level ∈ [L-2, L+4]` 的物品」
 * 所以这里存 `[type, level, drop]` 就够 —— 物品名/模型客户端自己有
 * （`itemDisplayName` / `item.bmd`），不必重复塞进 JSON。
 *
 * 注意：这张表**不能**用 `readTable()`（它会丢掉空字段）。Item.txt 的行长不固定
 * —— 名字后面有 5 个对齐用的空 tab、行尾的 0 又常被省略，丢空字段后同一列会漂移。
 * 所以这里按 tab 硬切、按固定下标取：`[0]=Index [7]=Drop [14]=Level`。
 *
 * 组号是单独一行数字（`0` / `1` / … ，`end` 收尾），type = group * 32 + index。
 */
function parseItems() {
  const text = readFileSync(join(SRC, 'Item/Item.txt'), 'utf8');
  const out = [];
  let group = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const cols = line.split('\t');
    // 组标记 / end：整行只有一列
    if (cols.length === 1) {
      if (/^end$/i.test(cols[0].trim())) continue;
      const g = Number(cols[0].trim());
      if (Number.isFinite(g)) group = g;
      continue;
    }
    const index = num(cols[0]);
    // Level 是「物品等级」（不是需求等级），服务端用它决定掉落池
    const level = num(cols[14], -1);
    const drop = num(cols[7]);
    out.push([group * 32 + index, level, drop]);
  }
  return out;
}

/**
 * 商店：`ShopManager.txt` 给出「NPC 职业 → 商店号」，`Shop/NNN - 名字.txt` 是货架。
 *
 *   ShopManager:  0 <tab> 251 <tab> //Hanzo the Blacksmith
 *   Shop/000:     14,001 <tab> 0 <tab> 255 <tab> 0 <tab> 0 <tab> 0 <tab> 0 <tab> * <tab> *  // 小治疗药水
 *                 └ 物品 = group,index（type = group*32+index）、Level、Dur、Skill、Luck、Opt、Exc
 *
 * 同一个文件里会有多段重复药水（不同耐久档，服务端按 `Interface.state` 挑一段），
 * 演示只留第一段，按 `type+level` 去重。
 */
function parseShops() {
  const manager = readTable('ShopManager.txt');
  const files = readdirSync(join(SRC, 'Shop'));
  const out = {};
  for (const r of manager) {
    const shopNo = num(r[0], -1);
    const cls = num(r[1], -1);
    if (shopNo < 0 || cls < 0) continue;
    const file = files.find(f => f.startsWith(String(shopNo).padStart(3, '0') + ' -'));
    if (!file) continue;
    const text = readFileSync(join(SRC, 'Shop', file), 'utf8');
    const items = [];
    const seen = new Set();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('//')) continue;
      const c = line.split('\t').map(x => x.trim());
      const idx = (c[0] ?? '').split(',');
      if (idx.length !== 2) continue;
      const type = num(idx[0]) * 32 + num(idx[1]);
      const level = num(c[1]);
      const key = `${type}:${level}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push([
        type,
        level,
        num(c[2], 0), // 耐久（药水这里是堆叠上限）
        num(c[3]), // skill
        num(c[4]), // luck
        num(c[5]), // option
        num(c[6]), // excellent
      ]);
    }
    if (items.length) out[cls] = { name: file.replace(/^\d+ - /, '').replace(/\.txt$/i, ''), items };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 输出                                                                */
/* ------------------------------------------------------------------ */

const monsters = parseMonsters();
const spawns = parseSpawns();
const skills = parseSkills();
const items = parseItems();
const shops = parseShops();

const payload = {
  meta: {
    builtAt: new Date().toISOString(),
    source: 'MuServer/Data (0.97k)',
    counts: {
      monsters: Object.keys(monsters).length,
      spawns: Object.values(spawns).reduce((n, list) => n + list.length, 0),
      maps: Object.keys(spawns).length,
      skills: skills.length,
      items: items.length,
      droppable: items.filter(it => it[2] !== 0).length,
      shops: Object.keys(shops).length,
      shopItems: Object.values(shops).reduce((n, s) => n + s.items.length, 0),
    },
  },
  monsters,
  spawns,
  skills,
  items,
  shops,
};

mkdirSync(dirname(OUT), { recursive: true });
// 紧凑格式：给浏览器读，不缩进能省 30% 体积
const text = JSON.stringify(payload);
writeFileSync(OUT, text);

console.log(`写出 ${OUT}（${(text.length / 1024).toFixed(0)}KB）`);
console.table(payload.meta.counts);
