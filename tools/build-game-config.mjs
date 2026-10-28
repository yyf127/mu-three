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
 *
 * 输出是**派生数据**：本地跑、结果入库（`server/data/game.json`），CI 不跑
 * （CI 里没有 MuServer）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

/* ------------------------------------------------------------------ */
/* 输出                                                                */
/* ------------------------------------------------------------------ */

const monsters = parseMonsters();
const spawns = parseSpawns();
const skills = parseSkills();

const payload = {
  meta: {
    builtAt: new Date().toISOString(),
    source: 'MuServer/Data (0.97k)',
    counts: {
      monsters: Object.keys(monsters).length,
      spawns: Object.values(spawns).reduce((n, list) => n + list.length, 0),
      maps: Object.keys(spawns).length,
      skills: skills.length,
    },
  },
  monsters,
  spawns,
  skills,
};

mkdirSync(dirname(OUT), { recursive: true });
// 紧凑格式：给浏览器读，不缩进能省 30% 体积
const text = JSON.stringify(payload);
writeFileSync(OUT, text);

console.log(`写出 ${OUT}（${(text.length / 1024).toFixed(0)}KB）`);
console.table(payload.meta.counts);
