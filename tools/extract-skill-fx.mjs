/**
 * 从 0.97k 客户端源码里提取「技能 → 特效」与「特效号 → 资源」。
 *
 *   node tools/extract-skill-fx.mjs
 *
 * 输出 `src/data/skillFx.generated.ts`（由脚本覆盖，不要手改）。
 *
 * 提取的三张表：
 *
 *   1. EFFECT_MODELS   特效号 → Data/Skill/*.bmd
 *      来源 `src/Model/Model_Misc.cpp` 的 `Model_LoadSkillEffectAssets()`（IDA: OpenSkills）。
 *      显式 `AccessModel(0xbf, "Data\\Skill\\", "Fire", 1)` 直接抓；
 *      写成 `for` 循环的那几段（Stone/Skeleton/Bone/Snow/BigStone）在下面的
 *      LOOP_EXPANSIONS 里按源码字面量展开，并且会先校验那行原文还在，
 *      源码变了脚本会报错而不是悄悄输出过期数据。
 *
 *   2. EFFECT_TEXTURES 特效号 → Data/Effect/*.ozj|.ozt
 *      来源 `src/Scene/Scene_AssetLoad.cpp` 的 `OpenJPG/OpenTGA("Effect/xxx.jpg", 0x4ab, ...)`。
 *      0x4xx 段的效果是**贴图精灵**（火焰、魔法阵、雷电），不是 BMD 模型 ——
 *      0.97k 里一半技能靠这些。
 *
 *   3. SKILL_CASTS     技能号 → 施法时要生成的特效
 *      来源 `src/Net/SecondPassword.cpp` 的 `MoveCharacter`（0x00449900）。
 *      函数里有两段分发：
 *        · `switch ((char)v328)`          —— 无目标（自身/地面）技能
 *        · `switch (skillId)`（有目标分支）—— 指向目标生效的技能
 *      每个 `case` 里的 `CreateEffect` / `Particle_Spawn` / `Joint_Create`
 *      连同「生成在谁身上」（o+16 自己 / Owner+16 目标 / WorldPosition 地面点）
 *      和循环次数一起抓出来。
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const ROOT = 'D:/Project/H5_mu/Mu-97k-Client-Source-main/src';
const DATA = 'D:/Project/H5_mu/muonlinejs-master/public/Data';
const OUT = 'src/data/skillFx.generated.ts';

const read = p => readFileSync(`${ROOT}/${p}`, 'utf8');

/**
 * 磁盘上的真实文件名（大小写）。
 * 源码写 `"Data\\Skill\\", "ArrowBomb", 1`，实际文件是 `Arrowbomb01.bmd` ——
 * Windows 不区分大小写所以原版没事，浏览器走 HTTP 是区分的，必须按磁盘名字落表。
 */
const diskSkill = new Map(
  readdirSync(`${DATA}/Skill`)
    .filter(f => /\.bmd$/i.test(f))
    .map(f => [f.toLowerCase(), f])
);
const diskEffect = new Map(
  readdirSync(`${DATA}/Effect`)
    .filter(f => /\.(ozj|ozt)$/i.test(f))
    .map(f => [f.toLowerCase(), f])
);
const missing = [];

/* ------------------------------------------------------------------ */
/* 1. 特效号 → BMD 模型                                                */
/* ------------------------------------------------------------------ */

const modelSrc = read('Model/Model_Misc.cpp');

/**
 * 源码里用 `for` 循环批量注册的那几段。
 * `needle` 是原文片段，脚本先校验它在（防止源码重排后静默失效）。
 */
const LOOP_EXPANSIONS = [
  {
    needle: 'for (int i = 0xc5; i-0xc5 < 2; i++)',
    slots: [0xc5, 0xc6],
    name: 'Stone',
    from: 1,
  },
  {
    needle: 'for (int i = 0xce; i-0xce < 3; i++)',
    slots: [0xce, 0xcf, 0xd0],
    name: 'Skeleton',
    from: 1,
  },
  {
    needle: 'for (int i = 0xd2; i-0xd2 < 2; i++)',
    slots: [0xd2, 0xd3],
    name: 'Bone',
    from: 1,
  },
  {
    needle: 'for (int i = 0xd4; i-0xd4 < 3; i++)',
    slots: [0xd4, 0xd5, 0xd6],
    name: 'Snow',
    from: 1,
  },
  {
    needle: 'for (int i = 0xe2; i-0xe2 < 2; i++)',
    slots: [0xe2, 0xe3],
    name: 'BigStone',
    from: 1,
  },
];

function modelFile(name, index) {
  // AccessModel 的第 4 个参数是**模型序号**：1 → "01"、-1 → 无序号
  const want = index < 0 ? `${name}.bmd` : `${name}${String(index).padStart(2, '0')}.bmd`;
  const real = diskSkill.get(want.toLowerCase());
  if (!real) missing.push(`Skill/${want}`);
  return `Skill/${real ?? want}`;
}

const effectModels = {};

// 显式调用：AccessModel(0xbf, "Data\\Skill\\", "Fire", 1)
for (const m of modelSrc.matchAll(
  /AccessModel\(\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*"Data\\\\Skill\\\\"\s*,\s*"([^"]+)"\s*,\s*(-?\d+)\s*\)/g
)) {
  const slot = Number(m[1]);
  const name = m[2];
  const idx = Number(m[3]);
  // `Name01` 这种才是模型；-1 表示单文件
  effectModels[slot] = modelFile(name, idx);
}

for (const loop of LOOP_EXPANSIONS) {
  if (!modelSrc.includes(loop.needle)) {
    throw new Error(`源码里找不到循环 "${loop.needle}"，请同步 LOOP_EXPANSIONS`);
  }
  loop.slots.forEach((slot, i) => {
    effectModels[slot] = modelFile(loop.name, loop.from + i);
  });
}

/* ------------------------------------------------------------------ */
/* 2. 特效号 → 贴图（0x4xx 精灵段）                                    */
/* ------------------------------------------------------------------ */

const assetSrc = read('Scene/Scene_AssetLoad.cpp');
const effectTextures = {};

for (const m of assetSrc.matchAll(/Open(JPG|TGA)\("Effect\/([^"]+)",\s*(0x[0-9a-fA-F]+)/g)) {
  const ext = m[1] === 'JPG' ? '.ozj' : '.ozt';
  /*
   * 源码写 `Effect/Flame01.jpg`，但磁盘上（原版客户端和这个 port 都一样）
   * **一个 .jpg 都没有** —— `Data/Effect` 只有 44 个 .OZJ + 4 个 .OZT：
   *   .ozj = MU 头 + 真 JPEG     .ozt = 4 字节头 + TGA
   * `.jpg` 只是 `OpenJPG` 这个加载函数的名字（角色/物件贴图那边才是真 jpg）。
   * 所以这里去掉源码里的假扩展名，换成实盘扩展名，再按 readdir 纠正大小写。
   */
  const base = m[2].replace(/\.[^./]+$/, '');
  const want = `${base}${ext}`;
  const real = diskEffect.get(want.toLowerCase());
  if (!real) missing.push(`Effect/${want}`);
  effectTextures[Number(m[3])] = `Effect/${real ?? want}`;
}

/* ------------------------------------------------------------------ */
/* 3. 技能 → 施法特效                                                  */
/* ------------------------------------------------------------------ */

const moveSrc = read('Net/SecondPassword.cpp');

/** 从 `start` 找到与第一个 `{` 配对的那个 `}`，返回区间文本 */
function blockAt(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { body: text.slice(openIndex, i + 1), from: openIndex, to: i + 1 };
    }
  }
  throw new Error('花括号不配对');
}

/**
 * 解析一个 switch 块，返回 `case 号 → 该 case 的源码文本`。
 *
 * 用「case 标签的缩进深度」归属：只有和标签同深度的语句算这个 case，
 * 嵌套 switch（比如 case 17 里还有一层）的语句归给外层 case ——
 * 正是我们要的粒度（内层按怪物类型分，对英雄无意义）。
 */
function parseSwitch(text, label, caseIndent) {
  const at = text.indexOf(label);
  if (at < 0) throw new Error(`找不到 ${label}`);
  const { body } = blockAt(text, text.indexOf('{', at));

  const lines = body.split('\n');
  const cases = new Map();
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current === null) return;
    for (const id of current) {
      const prev = cases.get(id);
      cases.set(id, (prev ? prev + '\n' : '') + buffer.join('\n'));
    }
    buffer = [];
  };

  for (const line of lines) {
    const lead = line.length - line.trimStart().length;
    // 一行里可能挂多个标签：`case 30: case 31: ... case 36:  // Buff`
    const labels = [...line.matchAll(/\bcase\s+(\d+)\s*:/g)].map(m => Number(m[1]));
    // 只认和 `case 5:` 同缩进的标签（内层 switch 的缩进更深）
    if (labels.length && lead === caseIndent) {
      flush();
      current = labels;
      buffer.push(line);
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return cases;
}

/**
 * 位置实参 → 生成锚点。
 *
 * 源码里三种写法：
 *   `(float*)(o + 16)`     自己脚下          → self
 *   `(float*)(Owner + 16)` 目标身上          → target
 *   `WorldPosition`        目标格的地面点    → targetGround
 */
function anchorOf(call) {
  if (/mc_AngleVectorOffset/.test(call)) return 'front';   // 施法者身前 x 单位
  if (/\bOwner\s*\+\s*16/.test(call)) return 'target';
  if (/WorldPosition/.test(call)) return 'targetGround';
  return 'self';
}

/**
 * 去掉「只在某种怪物身上才走」的分支。
 *
 * `MoveCharacter` 里有些特效挂在 `if (*(short*)(o + 2) == 288) { ... }` 下 ——
 * 那是按怪物模型号分支，英雄（390）永远不进。留着会把「极光」放成三道、
 * 给「能量球」多挂一个怪物专用的雪花。这里把这类分支整块删掉，
 * `else` 分支保留（例如 282 走 Snow01、其他走雷电精灵）。
 */
function stripMonsterBranches(text) {
  let out = text;
  for (let guard = 0; guard < 8; guard++) {
    const m = /if\s*\(\s*\*\(short\*\)\(o \+ 2\)\s*==\s*(\d+)\s*\)\s*\{/.exec(out);
    if (!m) break;
    const type = Number(m[1]);
    if (type === 390) break; // 英雄分支，保留
    const open = out.indexOf('{', m.index);
    let depth = 0;
    let close = open;
    for (let i = open; i < out.length; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    let rest = out.slice(close + 1);
    let replacement = '';
    const elseMatch = /^\s*else\s*\{/.exec(rest);
    if (elseMatch) {
      const eOpen = close + 1 + elseMatch[0].length - 1;
      let d = 0;
      let eClose = eOpen;
      for (let i = eOpen; i < out.length; i++) {
        if (out[i] === '{') d++;
        else if (out[i] === '}') {
          d--;
          if (d === 0) { eClose = i; break; }
        }
      }
      replacement = out.slice(eOpen + 1, eClose);
      rest = out.slice(eClose + 1);
    }
    out = out.slice(0, m.index) + replacement + rest;
  }
  return out;
}

/** 调用点前面最近的 `for (int x = 0; x < N` 决定重复次数 */
function countOf(caseText, index) {
  const before = caseText.slice(Math.max(0, index - 600), index);
  const loops = [...before.matchAll(/for \(int (\w+) = 0; \1 < (\w+)/g)];
  if (!loops.length) return 1;
  const bound = loops[loops.length - 1][2];
  let n = Number(bound);
  if (Number.isNaN(n)) {
    // `int v398 = 36;` 这种先赋给局部变量再用的
    const local = new RegExp(`int ${bound} = (\\d+);`).exec(caseText.slice(0, index));
    n = local ? Number(local[1]) : 1;
  }
  return n > 0 && n < 64 ? n : 1;
}

/**
 * 把一次调用的实参按顶层逗号切开（不切嵌套括号里的逗号）。
 * `CreateEffect(type, pos, angle, light, sub, owner, …)` —— 第 5 个才是 SubType，
 * 而 SubType 决定了**同一个模型号的不同用法**（191 = 0 是陨石下砸、= 1 是追踪火球）。
 */
function argsOf(window) {
  const open = window.indexOf('(');
  if (open < 0) return [];
  const args = [];
  let depth = 0;
  let cur = '';
  for (let i = open + 1; i < window.length; i++) {
    const ch = window[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') {
      if (depth === 0) { args.push(cur.trim()); break; }
      depth--;
    } else if (ch === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  return args;
}

/** 第 5 个实参（SubType）；`nullptr` / `0` / `(float*)(uintptr_t)N` 都归一到数字 */
function subOf(window) {
  const raw = argsOf(window)[4] ?? '';
  if (/null/i.test(raw) || raw === '') return 0;
  const m = raw.match(/(\d+)\s*\)?\s*$/);
  return m ? Number(m[1]) : 0;
}

function collectCalls(caseText, re) {
  const out = [];
  const caseHasFront = /mc_AngleVectorOffset/.test(caseText);
  for (const m of caseText.matchAll(re)) {
    const at = m.index ?? 0;
    // 位置实参在调用的后面几个参数里，只抓 `CreateEffect(192,` 判断不出锚点
    const window = caseText.slice(at, at + 260);
    let anchor = anchorOf(window);
    // case 12：源码先 `mc_AngleVectorOffset(o, -20, -90, 100, WorldPosition)`
    // 把「身前 100」算好再传，所以落点其实是施法者身前，不是目标格
    if (anchor === 'targetGround' && caseHasFront) anchor = 'front';
    out.push({
      call: m[0],
      type: Number(m[1]),
      index: at,
      count: countOf(caseText, at),
      at: anchor,
      // SubType：决定同一模型号的具体用法（191/0 陨石 vs 191/1 火球）
      sub: subOf(window),
      // param_5 = 1 且 param_6 = Owner ⇒ 追踪目标飞的弹道（火球就是这样）
      homing: /\(float\*\)(?:\(uintptr_t\))?1\s*,\s*\(float\*\)Owner/.test(window),
    });
  }
  return out;
}

const selfCases = parseSwitch(moveSrc, 'switch ((char)v328)', 8);
const targetCases = parseSwitch(moveSrc, 'switch (skillId)', 12);

/** 合并同一个 case 里重复的同类型调用（源码里两条一样的 CreateEffect 就是放两份） */
function mergeCalls(calls) {
  const byType = new Map();
  for (const c of calls) {
    // 按「类型 + SubType」合并：191/0（陨石）和 191/1（火球）是两件不同的事
    const key = `${c.type}:${c.sub ?? 0}`;
    const prev = byType.get(key);
    if (prev) prev.count += c.count;
    else byType.set(key, { ...c });
  }
  return [...byType.values()].map(({ call, index, ...rest }) => rest);
}

const skillCasts = {};

function addCase(id, rawText, phase) {
  const text = stripMonsterBranches(rawText);
  const effects = mergeCalls(
    collectCalls(text, /CreateEffect\(\s*(\d+)\s*,/g)
  );
  const particles = mergeCalls(
    collectCalls(text, /Particle_Spawn\(\s*(\d+)\s*,/g)
  );
  const joints = mergeCalls(
    collectCalls(text, /Joint_Create\(\s*(\d+)\s*,/g)
  );
  const bombRing = /Effect_SpawnBombRing/.test(text);
  if (!effects.length && !particles.length && !joints.length && !bombRing) return;
  skillCasts[id] = { id, phase, effects, particles, joints, bombRing };
}

for (const [id, text] of selfCases) addCase(id, text, 'self');
for (const [id, text] of targetCases) addCase(id, text, 'target');

/* ------------------------------------------------------------------ */
/* 4. 精灵特效的寿命（CreateEffect 里 pfVar17[0x18] 的帧数）            */
/* ------------------------------------------------------------------ */

/**
 * `CreateEffect` 的 case 里 `pfVar17[0x18] = 2.8026e-44` 这种「看起来很怪的浮点数」
 * 其实是**小整数的位模式**（denormal：1.401298e-45 × 位模式）。那个字段是寿命，单位帧。
 * 这里把它换算回帧数，方便前端按 25fps 播完就销毁。
 */
const createSrc = read('Render/Effect_Create.cpp');
const effectLifeFrames = {};
const DENORMAL = 1.401298464324817e-45;

for (const m of createSrc.matchAll(/case (0x[0-9a-fA-F]+|\d+):\s*\n\s*pfVar17\[0x18\] = ([\d.e+-]+);/g)) {
  const type = Number(m[1]);
  const v = Number(m[2]);
  const frames = Math.round(v / DENORMAL);
  if (frames >= 2 && frames <= 400) effectLifeFrames[type] = frames;
}

/* ------------------------------------------------------------------ */
/* 输出                                                                */
/* ------------------------------------------------------------------ */

const sortNum = (a, b) => Number(a[0]) - Number(b[0]);
const obj = (map, fmt) =>
  Object.entries(map)
    .sort(sortNum)
    .map(([k, v]) => `  ${k}: ${fmt(v)},`)
    .join('\n');

const effectMap = (list) =>
  list
    .map(
      e =>
        `    { type: ${e.type}, at: '${e.at}', count: ${e.count}` +
        `${e.sub ? `, sub: ${e.sub}` : ''}${e.homing ? ', homing: true' : ''} },`
    )
    .join('\n');

const castBlocks = Object.values(skillCasts)
  .sort((a, b) => a.id - b.id)
  .map(c => {
    const parts = [
      `  ${c.id}: {`,
      `    phase: '${c.phase}',`,
      c.effects.length ? `    effects: [\n${effectMap(c.effects)}\n    ],` : '    effects: [],',
      c.particles.length ? `    particles: [\n${effectMap(c.particles)}\n    ],` : '    particles: [],',
      c.joints.length ? `    joints: [\n${effectMap(c.joints)}\n    ],` : '    joints: [],',
      c.bombRing ? '    bombRing: true,' : '',
      '  },',
    ];
    return parts.filter(Boolean).join('\n');
  })
  .join('\n');

const content = `/**
 * ⚠️ 自动生成，不要手改 —— 改 \`tools/extract-skill-fx.mjs\` 后重跑。
 *
 *   node tools/extract-skill-fx.mjs
 *
 * 数据全部摘自 0.97k 客户端源码（\`Mu-97k-Client-Source-main\`）：
 *
 *   EFFECT_MODELS    \`src/Model/Model_Misc.cpp\`   Model_LoadSkillEffectAssets() —— IDA: OpenSkills 0x0050B710
 *   EFFECT_TEXTURES  \`src/Scene/Scene_AssetLoad.cpp\`                              —— 特效贴图表
 *   SKILL_CASTS      \`src/Net/SecondPassword.cpp\`  MoveCharacter() —— IDA: 0x00449900
 *   EFFECT_LIFE      \`src/Render/Effect_Create.cpp\`                               —— 寿命（帧）
 */

/** 特效号 → \`Data/Skill/\` 下的 BMD 模型（源码里的模型槽 190..268） */
export const EFFECT_MODELS: Record<number, string> = {
${obj(effectModels, v => `'${v}'`)}
};

/** 特效号 → \`Data/Effect/\` 下的贴图（源码里的精灵段 0x4xx） */
export const EFFECT_TEXTURES: Record<number, string> = {
${obj(effectTextures, v => `'${v}'`)}
};

/** 特效号 → 寿命帧数（25fps）；源码 \`pfVar17[0x18]\` 的位模式换算回来的 */
export const EFFECT_LIFE_FRAMES: Record<number, number> = {
${obj(effectLifeFrames, v => String(v))}
};

export interface SourceFx {
  /** CreateEffect / Particle_Spawn / Joint_Create 的第一个参数 */
  type: number;
  /** 生成在谁身上：自己 / 目标 / 目标脚下的地面点 / 施法者身前 */
  at: 'self' | 'target' | 'targetGround' | 'front';
  /** 源码里这一帧放几个 */
  count: number;
  /**
   * CreateEffect 的第 5 个实参（SubType）。
   * 同一个模型号靠它区分用法：191/0 = 陨石下砸、191/1 = 追踪火球。
   */
  sub?: number;
  /** 是不是追踪弹（源码 param_5 = 1 且 param_6 = Owner） */
  homing?: boolean;
}

export interface SourceCast {
  /** self = 无目标分支（switch ((char)v328)），target = 有目标分支（switch (skillId)） */
  phase: 'self' | 'target';
  effects: SourceFx[];
  particles: SourceFx[];
  joints: SourceFx[];
  bombRing?: boolean;
}

/** 技能号 → MoveCharacter 里那一帧要生成的东西 */
export const SKILL_CASTS: Record<number, SourceCast> = {
${castBlocks}
};
`;

writeFileSync(OUT, content);
console.log(
  `写出 ${OUT}\n  模型 ${Object.keys(effectModels).length} 条 / 贴图 ${
    Object.keys(effectTextures).length
  } 条 / 技能 ${Object.keys(skillCasts).length} 条 / 寿命 ${Object.keys(effectLifeFrames).length} 条`
);
console.log('技能号:', Object.keys(skillCasts).map(Number).sort((a, b) => a - b).join(','));
if (missing.length) console.warn('磁盘上找不到的资源:', [...new Set(missing)].join(', '));
