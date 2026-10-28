/**
 * 技能菜单探针 —— 「选技能 → 点 Cast → 源码说该出的特效真的出了」。
 *
 *   node tools/skill-probe.mjs           # 连服务端（没起就退离线）
 *   node tools/skill-probe.mjs offline
 *
 * 这一版断言的是**客户端源码**给的施法规格，而不是手配的配置表：
 *
 *   - 动作号：法师 82（`SetPlayerMagic` 的 `SetAction(0x52 + rand%2)`）；
 *     战士特例 43→67 / 47→66 / 49→64（`UseSkillWarrior`）；
 *     挥砍类 19..23/41/42/55/56 走 `-1`（由当前武器算 `SetPlayerAttack`）；
 *   - 特效件数：`MoveCharacter` 里 `CreateEffect` 的调用次数与 `count`，
 *     模型（`Data/Skill`）与贴图（`Data/Effect`）两种都要对得上；
 *   - 落点：`self` / `target` / `front` 三档锚点分别落在谁脚下；
 *   - 追踪弹：火球（4）的 `homing` 位必须为 true（源码 param_5=1, param_6=Owner）；
 *   - 播完两层都自动清理，不泄漏场景节点。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('skillprobe');

let pass = 0;
let fail = 0;
function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${extra ? '  ' + extra : ''}`); }
}

async function shot(name, w = 460, h = 420, lift = 1.2, scale = 2) {
  const clip = await clipAt(w, h, lift, scale);
  if (!clip) return null;
  const r = await c.send('Page.captureScreenshot', { format: 'png', clip });
  const b64 = r.data;
  if (name) writeFileSync(`shots/${name}.png`, Buffer.from(b64, 'base64'));
  return { clip, b64 };
}

/** 靶子周围的取景框（靶子不动，所以只算一次） */
async function clipAt(w = 460, h = 420, lift = 1.2, scale = 2) {
  let prev = null, same = 0;
  for (let i = 0; i < 40; i++) {
    const cur = await c.ev(
      `(() => { const t = __MU_APP__.skillTarget(); if (!t || !window.__MU_DEBUG__) return '';
        const p = __MU_DEBUG__.project(t.x, t.y, t.z + ${lift});
        return JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) }); })()`
    );
    if (cur && cur === prev) { if (++same >= 4) break; } else { same = 0; prev = cur; }
    await sleep(200);
  }
  if (!prev) return null;
  const p = JSON.parse(prev);
  return { x: Math.max(0, p.x - w / 2), y: Math.max(0, p.y - h * 0.62), width: w, height: h, scale };
}

/** 两帧截图的像素差分（在页面里用 canvas 比，免得在 Node 里引 PNG 解码器） */
async function diffPixels(a, b) {
  return JSON.parse(
    await c.ev(`(async () => {
      const load = async (b64) => {
        const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
        const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
        const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
        return g.getImageData(0, 0, cv.width, cv.height).data;
      };
      const x = await load(${JSON.stringify(a)}), y = await load(${JSON.stringify(b)});
      let n = 0;
      for (let i = 0; i < x.length; i += 4)
        if (Math.abs(x[i]-y[i]) + Math.abs(x[i+1]-y[i+1]) + Math.abs(x[i+2]-y[i+2]) > 40) n++;
      return JSON.stringify({ changed: n, total: x.length / 4 });
    })()`)
  );
}

/** 角色当前状态（位置 + 正在播的动作号） */
async function playerState() {
  return JSON.parse(
    await c.ev(`(() => { const a = __MU_APP__.playerActor();
      return JSON.stringify({ x: +a.x.toFixed(2), y: +a.y.toFixed(2), action: a.action }); })()`)
  );
}

const bare = f => f.replace(/^Skill\//i, '').toLowerCase();

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图');
  await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, '角色创建');
  await c.waitFor(`!!__MU_APP__.skillTarget()`, 30000, '技能靶子');

  /* ---- 靶子 ---- */
  const t = await c.ev(`__MU_APP__.skillTarget()`);
  console.log(`靶子: ${JSON.stringify(t)}`);
  check('靶子在洛兰 (186,129)', Math.abs(t.x - 186.5) < 0.6 && Math.abs(t.y - 129.5) < 0.6, `实际 ${t.x},${t.y}`);
  check('靶子是 Class 7 Giant', /giant/i.test(t.name), `实际 ${t.name}`);

  /* ---- 面板 ---- */
  await c.ev(`__MU_APP__.sandboxShow(true)`);
  const pj = JSON.parse(await c.ev(`(() => {
    const cards = [...document.querySelectorAll('#sandbox .sb-card')];
    return JSON.stringify({
      cards: cards.map(c => c.querySelector('.sb-title')?.textContent ?? ''),
      castBtn: !!document.querySelector('#sandbox .sb-cast'),
      hint: document.querySelector('#sandbox .sb-hint')?.textContent ?? '',
      firstOpts: [...document.querySelectorAll('#sandbox .sb-card:nth-child(3) option')].slice(0, 3).map(o => o.textContent),
    });
  })()`));
  console.log(`面板: ${JSON.stringify(pj)}`);
  check('面板有三张卡片（Character / Equipment / Skill）', pj.cards.length === 3, `实际 ${pj.cards.join('|')}`);
  check('第三张是 Skill', /skill/i.test(pj.cards[2] ?? ''), `实际 ${pj.cards[2]}`);
  check('有 Cast 按钮', pj.castBtn === true);
  check(
    '下拉项标出了特效来源（◆源码 / ○兜底 / —无特效）',
    pj.firstOpts.every(o => /^[◆○—]/.test(o)),
    pj.firstOpts.join(' | ')
  );

  /* ---- 技能清单 ---- */
  const skills = await c.ev(`__MU_APP__.skills()`);
  console.log(`技能 ${skills.length} 个: ${skills.map(s => `${s.id}:${s.name}`).join(', ')}`);
  check('skill.bmd 解出 45 个技能（最大编号 56）', skills.length === 45, `实际 ${skills.length}`);
  check('最大技能号是 56', Math.max(...skills.map(s => s.id)) === 56, `实际 ${Math.max(...skills.map(s => s.id))}`);
  check('技能名是中文（读的是 chs/skill.bmd）', skills.every(s => /[\u4e00-\u9fa5]/.test(s.name)));
  check('技能名不带 `-编号` 尾巴', skills.every(s => !/-\d+$/.test(s.name)), skills.filter(s => /-\d+$/.test(s.name)).map(s => s.name).join(','));
  const noVis = skills.filter(s => s.source === 'none');
  console.log(`源码「无视觉」${noVis.length} 个: ${noVis.map(s => s.name).join(',')}`);
  /*
   * 弓箭三技能（24/51/52）源码走 `CreateArrows`（投射物实体），**本来就没有**
   * 原地特效件 —— 它们的验证放在后面「走 CreateArrows：N 支箭」那几条。
   */
  const BOW_IDS = new Set([24, 51, 52]);
  check(
    '除「源码无视觉」和弓箭投射物外，每个技能都有特效件',
    skills.every(s => s.parts.length > 0 || s.source === 'none' || BOW_IDS.has(s.id)),
    skills
      .filter(s => !s.parts.length && s.source !== 'none' && !BOW_IDS.has(s.id))
      .map(s => s.name)
      .join(',')
  );
  check('「无视觉」的技能确实没有特效件', noVis.every(s => s.parts.length === 0), '有残留');
  const jobs = [...new Set(skills.map(s => s.job))];
  console.log(`分组: ${jobs.join(', ')}`);
  check('按三个职业 + Other 分组', ['wizard', 'knight', 'elf', 'misc'].every(j => jobs.includes(j)), jobs.join(','));

  /*
   * ── 职业归属对账 ──────────────────────────────────────────────
   * `skill.bmd` 里**没有职业字段**（40 字节到 `RequireEnergy` 就结束了），
   * 职业位只在服务端 `Skill.txt` 的 `DW DK FE MG` 四列。
   * `src/data/skills.ts` 的 `SKILL_JOBS` 是照那张表誊的，
   * 这条断言就是防止誊错、也防止以后有人改回来。
   */
  const skillTxtPath = fileURLToPath(new URL('../../MuServer/Data/Skill/Skill.txt', import.meta.url));
  let skillTxt = null;
  try { skillTxt = readFileSync(skillTxtPath, 'latin1'); } catch { /* 没有就跳过 */ }
  if (!skillTxt) {
    console.log(`（跳过职业对账：找不到 ${skillTxtPath}）`);
  } else {
    const want = new Map();
    for (const line of skillTxt.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('//')) continue;
      const col = line.split('\t').map(x => x.trim().replace(/^"|"$/g, '')).filter(x => x !== '');
      if (!/^\d+$/.test(col[0])) continue;
      const list = [];
      if (+col[12]) list.push('wizard'); // DW
      if (+col[13]) list.push('knight'); // DK
      if (+col[14]) list.push('elf');   // FE
      if (+col[15]) list.push('mg');    // MG
      want.set(+col[0], list);
    }
    const wrong = skills.filter(s => {
      const w = want.get(s.id);
      if (!w) return false;
      return w.length !== s.jobs.length || w.some(j => !s.jobs.includes(j));
    });
    check(
      `职业归属与服务端 Skill.txt 逐条一致（${want.size} 条）`,
      wrong.length === 0,
      wrong.map(s => `${s.id}:${s.name} 应[${want.get(s.id)}] 实[${s.jobs}]`).join(' | ')
    );
    const sum = j => skills.filter(s => s.jobs.includes(j)).length;
    console.log(`各职业可用技能数: DW ${sum('wizard')} / DK ${sum('knight')} / FE ${sum('elf')} / MG ${sum('mg')}`);
    check('每个技能都至少有一个职业（除怪物专用 50）',
      skills.every(s => s.jobs.length > 0 || s.id === 50),
      skills.filter(s => !s.jobs.length && s.id !== 50).map(s => `${s.id}:${s.name}`).join(','));
  }

  const opts = await c.ev(`document.querySelectorAll('#sandbox .sb-card:nth-child(3) select option').length`);
  check('下拉选项数 = 技能数', Number(opts) === skills.length, `下拉 ${opts} / 技能 ${skills.length}`);

  /*
   * 技能下拉要跟着 CHARACTER 卡片的职业走（默认 0 = Dark Wizard）。
   * 不属于本职业的**留在列表里但禁用**，所以选项总数不变、禁用的正好是差额。
   */
  const dwUsable = skills.filter(s => s.jobs.includes('wizard')).length;
  const offCount = Number(
    await c.ev(
      `[...document.querySelectorAll('#sandbox .sb-card:nth-child(3) select option')].filter(o => o.disabled).length`
    )
  );
  check(
    `非本职业技能被禁用（Dark Wizard 可用 ${dwUsable}/${skills.length}）`,
    offCount === skills.length - dwUsable,
    `禁用 ${offCount}，预期 ${skills.length - dwUsable}`
  );
  const groups = Number(await c.ev(`document.querySelectorAll('#sandbox .sb-card:nth-child(3) select optgroup').length`));
  check('下拉按 5 个职业分组（DW/DK/FE/MG/Other）', groups === 5, `实际 ${groups}`);

  /* ---- 源码覆盖率 ---- */
  const fromClient = skills.filter(s => s.source === 'client');
  const fallback = skills.filter(s => s.source === 'fallback');
  console.log(
    `源码覆盖 ${fromClient.length} 个: ${fromClient.map(s => s.id).join(',')}\n` +
      `兜底 ${fallback.length} 个: ${fallback.map(s => `${s.id}:${s.name}`).join(',') || '无'}`
  );
  // MoveCharacter 的 dispatch 里 28 个 + AttackStage 补的 43/47/56
  check('源码覆盖 ≥ 28 个技能（MoveCharacter 28 + AttackStage 补）', fromClient.length >= 28, `实际 ${fromClient.length}`);

  /* ---- 动作号：直接对源码 PacketHandler_0x19 ---- */
  const wizard = skills.filter(s => s.job === 'wizard');
  check(
    '法师技能一律用施法动作 82（SetPlayerMagic → 0x52）',
    wizard.every(s => s.action === 82),
    wizard.filter(s => s.action !== 82).map(s => `${s.name}:${s.action}`).join(',')
  );
  // Skills.cpp 的 switch，逐条对照（action 号 = 源码 SetAction 的实参）
  const exact = { 19: 56, 20: 57, 21: 58, 22: 59, 43: 67, 47: 66, 48: 63, 49: 64, 56: 81 };
  for (const [id, want] of Object.entries(exact)) {
    const s = skills.find(x => x.id === Number(id));
    check(`${s?.name ?? id} 动作 ${want}（0x19 case）`, s?.action === want, `实际 ${s?.action}`);
  }
  // 23 天地十字剑：源码 (caster[771] & 1) ? 41 : 60，这里固定取 41
  check(
    '天地十字剑 动作 41/60 交替（取 41）',
    skills.find(s => s.id === 23)?.action === 41,
    `实际 ${skills.find(s => s.id === 23)?.action}`
  );
  // 24/51/52 走 SetPlayerBow，随武器
  const bow = [24, 51, 52];
  check(
    '弓箭类（24/51/52）交给 attackAction（SetPlayerBow）',
    bow.every(id => skills.find(s => s.id === id)?.action === -1),
    bow.filter(id => skills.find(s => s.id === id)?.action !== -1).join(',')
  );
  // 同一模型号靠 SubType 区分：191/0 陨石有高度和下落速度，191/1 火球没有
  const meteor = skills.find(s => s.id === 2)?.parts.find(p => p.kind === 'model');
  const fireball = skills.find(s => s.id === 4)?.parts.find(p => p.kind === 'model');
  check('陨石（191/0）带「离地 4 m + 下落速度」', meteor?.drop === 4 && meteor?.vel?.z === -12.5,
    `drop=${meteor?.drop} vel=${JSON.stringify(meteor?.vel)}`);
  check('火球（191/1）不带下落（它是追踪弹）', !fireball?.vel && fireball?.homing === true,
    `vel=${JSON.stringify(fireball?.vel)} homing=${fireball?.homing}`);
  check('陨石寿命按源码 40 帧 = 1.6 s', Math.abs((meteor?.life ?? 0) - 1.6) < 0.01, `实际 ${meteor?.life}`);
  check('火球寿命按源码 60 帧 = 2.4 s', Math.abs((fireball?.life ?? 0) - 2.4) < 0.01, `实际 ${fireball?.life}`);

  /*
   * 弓箭类在客户端是**投射物实体**（`CreateArrows`），不是原地特效。
   * 所以这里断言的是「`castOf` 不再给它们编造型号特效」，实际放箭由
   * `main.ts` 的 `shootArrows()` 负责，箭数在下面逐个技能验证（3/1/1）。
   */
  const bowSpec = skills.find(s => s.id === 24);
  check(
    '多重箭（24）按 CreateArrows 处理：不再生成原地特效',
    bowSpec?.parts.length === 0 && bowSpec?.source === 'client',
    `parts=${bowSpec?.parts.length} source=${bowSpec?.source}`
  );

  // 模型特效不缩放：源码 RenderEffects 用 +0x1a（默认 1.0）
  const modelParts = skills.flatMap(s => s.parts.filter(p => p.kind === 'model'));
  check(
    '模型特效一律 scale = 1（源码 +0x1a 默认值，不做「缩到 N 米」）',
    modelParts.every(p => p.scale === 1),
    modelParts.filter(p => p.scale !== 1).map(p => `${p.file}:${p.scale}`).join(',')
  );

  /* ---- 精灵特效：源码里那半技能全靠贴图 ---- */
  const spriteSkills = skills.filter(s => s.parts.some(p => p.kind === 'sprite'));
  console.log(`带贴图特效的技能 ${spriteSkills.length} 个: ${spriteSkills.map(s => `${s.id}:${s.name}`).join(',')}`);
  check('有技能走贴图特效（Data/Effect/*）', spriteSkills.length > 0, `实际 ${spriteSkills.length}`);

  /* ---- 逐件替补都带说明 ---- */
  check(
    '替补资源逐条带 note（可追溯到源码槽位）',
    fromClient.every(s => s.parts.every(p => p.note && p.note.length > 0)),
    '有 part 没写 note'
  );

  /* ---- 逐个释放：件数 / 落点 / 动作号 ---- */
  const errorsBefore = (c.logs ?? []).length;
  let totalModels = 0;
  let totalSprites = 0;

  const frameNo = () => c.ev(`window.__MU__?.renderer?.info?.render?.frame ?? 0`).then(Number);
  const waitForFrames = async (need = 6, ms = 30000) => {
    const t0 = Date.now();
    let last = await frameNo();
    let gained = 0;
    while (Date.now() - t0 < ms) {
      await sleep(200);
      const now = await frameNo();
      gained += Math.max(0, now - last);
      last = now;
      if (gained >= need) return true;
    }
    return false;
  };

  /* ---- 武器旋转：源码 238 → 239 `RenderWheelWeapon` ----
   * 238 号特效槽在 `RenderEffects` 里是 `case 238: break;`（不画），
   * 真正的视觉是它每帧生成的 239：把**玩家手上那把武器**转起来、抬到头顶 1 m。
   * 所以这里断言的不是「有个模型在转」，而是「转的是玩家武器」。
   *
   * 放在 45 个技能之前跑：软渲染打到后面会整段卡死，那时采样窗口里一帧都不跑，
   * `age` / `angle` 全冻住，会把「转了」误判成「没转」。
   */
  await c.ev(`__MU_APP__.previewEquip({ cls: 1, safeZone: false, weapon: 0 })`);
  await sleep(350);

  let w1 = null;
  let w2 = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitForFrames(4);
    await c.ev(`__MU_APP__.fxClear()`);
    await c.ev(`__MU_APP__.castSkill(41)`);
    for (let i = 0; i < 20; i++) {
      const list = await c.ev(`__MU_APP__.fxWheels()`);
      w1 = list[0] ?? null;
      if (w1) break;
      await sleep(100);
    }
    await sleep(260);
    w2 = (await c.ev(`__MU_APP__.fxWheels()`))[0] ?? null;
    // `age` 不动 = 这段窗口页面一帧都没跑，角度自然也不动 → 重采
    if (w1 && w2 && w2.age > w1.age + 0.05) break;
    console.log('  … 武器旋转采样窗口内没跑帧，重试');
  }
  console.log(`武器旋转: ${JSON.stringify(w1)} → ${JSON.stringify(w2)}`);
  check(
    '霹雳回旋斩（41）转的是玩家武器（239 RenderWheelWeapon）',
    !!w1 && w1.meshes > 0,
    w1 ? `meshes=${w1.meshes}` : '没有 wheel 实例'
  );
  if (!w1 || !w2 || w2.age <= w1.age) {
    console.log('  · 跳过：武器转速（页面没跑帧，环境问题）');
  } else {
    check(
      '武器绕竖轴转（源码 -30°/帧 ≈ -13.09 rad/s，方向为负）',
      w2.angle < w1.angle - 0.8,
      `角度 ${w1.angle} → ${w2.angle}`
    );
  }
  check(
    '武器被抬到头顶 1 m（源码 o+24 += 100 单位）',
    !!w1 && w1.pos[2] > 2.0,
    w1 ? `z=${w1.pos[2]}` : 'null'
  );

  /* ---- 武器砸地：源码 244 `ItemDrop_RenderGroundWeapon` ----
   * 42 雷霆裂闪不是「一个地裂模型」：前半段是**武器举起来砸下去**
   * （`life > 10` 时才画武器），落地（life == 3）才出裂缝 + 扬尘。 */
  await c.ev(`__MU_APP__.fxClear()`);
  await c.ev(`__MU_APP__.castSkill(42)`);
  let slamFirst = null;
  let peak = -1;
  let landed = false;
  let crack = false;
  for (let i = 0; i < 45; i++) {
    const slam = await c.ev(`__MU_APP__.fxSlam()`);
    if (slam.length) {
      slamFirst = slamFirst ?? slam[0];
      peak = Math.max(peak, slam[0].height);
      if (slam[0].impacted) landed = true;
    }
    if (landed) {
      const fx = await c.ev(`__MU_APP__.fx()`);
      if (fx.some(f => /Earthquake/i.test(f.file))) {
        crack = true;
        break;
      }
    }
    await sleep(80);
  }
  console.log(
    `武器砸地: first=${JSON.stringify(slamFirst)} peak=${peak.toFixed(2)} landed=${landed} crack=${crack}`
  );
  check('雷霆裂闪（42）是「武器砸地」而不是一个地裂模型', !!slamFirst && slamFirst.meshes > 0,
    slamFirst ? `meshes=${slamFirst.meshes}` : '没有 slam 实例');
  check('武器真的被举起来（高度 > 0.6）', peak > 0.6, `峰值 ${peak.toFixed(2)}`);
  check('武器落地后砸出地裂（源码 life==3 才出裂缝）', landed && crack,
    `landed=${landed} crack=${crack}`);

  /*
   * 逐技能断言之前确保**手持武器**：41 的视觉是转武器，空手时源码也转不出东西；
   * 而且 `previewEquip` 是异步重建，后面每个技能开始前都会再确认一次。
   */
  /** 弓箭三技能走 `CreateArrows`（投射物），件数断言换成「几支箭」 */
  const BOW = new Set([24, 51, 52]);

  for (const s of skills) {
    /* ---- 源码判定「没有视觉」的技能：必须一件都不生成 ---- */
    if (s.source === 'none') {
      await c.ev(`__MU_APP__.fxClear()`);
      await c.ev(`__MU_APP__.castSkill(${s.id})`);
      await sleep(700); // 等过「延迟出特效」的窗口，确认真的什么都没生成
      const m = await c.ev(`__MU_APP__.fx()`);
      const sp = await c.ev(`__MU_APP__.fxSprites()`);
      check(
        `${s.name} 源码无特效 → 不生成任何东西（${s.action >= 0 ? `动作 ${s.action}` : '挥砍'}）`,
        m.length === 0 && sp.length === 0,
        `模型 ${m.length} / 贴图 ${sp.length}`
      );
      continue;
    }

    const wantModels = s.parts.filter(p => p.kind === 'model' || p.kind === 'debris');
    // 拖尾也是贴图（源码 1210..1212 连发 N 个 1176），一起算进贴图层
    const wantSprites = s.parts.filter(
      p => p.kind === 'sprite' || p.kind === 'trail' || p.kind === 'flash'
    );
    const wantM = wantModels.reduce((a, p) => a + p.count, 0);
    const wantS = wantSprites.reduce((a, p) => a + p.count, 0);
    // 关节（光束）单独一层：`Joint_Create` 两点之间的一道光
    const wantBeams = s.parts.filter(p => p.kind === 'beam');
    const wantB = wantBeams.reduce((a, p) => a + p.count, 0);
    const modelFiles = new Set(wantModels.map(p => bare(p.file)));
    const spriteFiles = new Set(wantSprites.map(p => p.file));

    /** 放一次 + 轮询两层特效，返回 [模型, 贴图, 动作快照] */
    const castOnce = async () => {
      /*
       * 清两次，中间等一拍：`effects.spawn` 是异步的（要加载 BMD），
       * 上一个技能的箭/碎石可能在 `fxClear` **之后**才挂进场景 ——
       * 不补这一拍，它们会落进下一个技能的采样窗口（守护之光被数出
       * 3 个 Arrow01 就是这么来的）。
       */
      await c.ev(`__MU_APP__.fxClear()`);
      await sleep(320);
      await c.ev(`__MU_APP__.fxClear()`);
      /*
       * 动作号必须和 castSkill **在同一次求值里**读：
       * 分两次 CDP 往返的话中间会跑好几帧，一次性动作播完主循环就切回待机（1 号），
       * 探针读到的永远是 1 —— 那是探针的时序问题，不是游戏的问题。
       */
      const snap = JSON.parse(await c.ev(`(async () => {
        await __MU_APP__.castSkill(${s.id});
        const a = __MU_APP__.playerActor();
        return JSON.stringify({ action: a.action, x: a.x, y: a.y });
      })()`));

      /*
       * 武器砸地类（42）：地裂是在**落地那一帧**（cast 后 0.54 s）才生成的。
       * 不等它跑完就进下一个技能，那个 Earthquake03 会落到别人的采样窗口里，
       * 把件数断言带偏（实测把 47 钻云枪数成 4 件）。
       */
      if (s.parts.some(p => p.kind === 'weaponSlam')) await sleep(950);

      let m = [];
      let sp = [];
      let bm = [];
      /*
       * 三层**一次**取走（同一个 eval 里原子快照）。
       * 早先分三次 `await c.ev(...)`，中间隔了两次 CDP 往返 —— 龙卷风那种
       * 「1 模型 + 6 贴图」的技能，贴图寿命只有 0.5 s，常常是模型读到了、
       * 贴图已经过期，于是断言「1+0 ≠ 1+6」偶发失败（实测约五分之一概率）。
       */
      for (let i = 0; i < 30; i++) {
        const raw3 = await c.ev(
          `JSON.stringify({ m: __MU_APP__.fx(), s: __MU_APP__.fxSprites(), b: __MU_APP__.fxBeams() })`
        );
        if (typeof raw3 !== 'string') {
          console.warn('  [probe] 快照求值异常：', JSON.stringify(raw3).slice(0, 300));
          await sleep(100);
          continue;
        }
        const snap3 = JSON.parse(raw3);
        m = snap3.m;
        // 没有对应件就别管那一层，断言只看需要的
        sp = wantS ? snap3.s : [];
        bm = wantB ? snap3.b : [];
        if (m.length >= wantM && sp.length >= wantS && bm.length >= wantB) break;
        await sleep(100);
      }
      return [m, sp, bm, snap];
    };

    const t0 = Date.now();
    let [models, sprites, beams, after] = await castOnce();
    /*
     * 第一次一件都没出，再给一次机会：无头浏览器的 SwiftShader 偶尔会在
     * 贴图上传时卡住一整段（实测钻云枪正常 <150 ms，卡的时候 18 s 都不出），
     * 那不是代码问题。重试失败才算真的失败。
     */
    if (models.length === 0 && sprites.length === 0 && (wantM || wantS)) {
      console.log(`  … ${s.name} 第一次没出特效，重试一次`);
      [models, sprites, beams, after] = await castOnce();
    }
    const waited = Date.now() - t0;
    totalModels += models.length;
    totalSprites += sprites.length;

    const gotM = models.length;
    const gotS = sprites.length;
    check(
      `${s.name} 特效件数 ${gotM}模型 + ${gotS}贴图 = 源码 ${wantM}+${wantS}（${waited}ms）`,
      gotM === wantM && gotS === wantS,
      gotM === wantM && gotS === wantS
        ? ''
        : `模型 [${models.map(m => m.file).join(',')}] 贴图 [${sprites.map(f => f.file).join(',')}]`
    );

    /*
     * 弓箭三技能在源码里是 `CreateArrows`（投射物实体），件数为 0 是**对的**。
     * 但要确认箭真的放出去了：多重箭 3 支（中心 + ±8°），冰封箭/穿透箭各 1 支。
     */
    if (BOW.has(s.id)) {
      const want = s.id === 24 ? 3 : 1;
      // 箭是在 `castSkill` 的 setTimeout 里发的（前摇 260 ms），要等它真的执行
      let shot = 0;
      for (let i = 0; i < 10; i++) {
        shot = Number(await c.ev(`__MU_APP__.arrows().last ? __MU_APP__.arrows().last.count : 0`));
        if (shot === want) break;
        await sleep(120);
      }
      check(`${s.name} 走 CreateArrows：${want} 支箭`, shot === want, `实际 ${shot} 支`);
    }

    if (gotM) {
      check(
        `${s.name} 模型文件与源码一致`,
        models.every(m => modelFiles.has(bare(m.file))),
        models.map(m => m.file).join(',')
      );
      check(`${s.name} 网格数 > 0`, models.every(m => m.meshes > 0), `meshes=${models.map(m => m.meshes).join(',')}`);
    }
    if (wantB) {
      check(
        `${s.name} 关节光束 ${beams.length} 道 = 源码 ${wantB}（Joint_Create）`,
        beams.length === wantB,
        beams.map(b => `${b.file} len${b.len}`).join(',')
      );
    }
    if (gotS) {
      check(
        `${s.name} 贴图文件与源码一致`,
        sprites.every(f => spriteFiles.has(f.file)),
        sprites.map(f => f.file).join(',')
      );
    }

    /* 落点：按 part 的 anchor 分别核对 */
    const me = after;
    for (const m of models) {
      /*
       * 同一技能里可能有**多件同模型**的 part（天雷闪既有 MoveCharacter 的
       * 1 件、又有 AttackStage 补的 5 件散开版），所以只要落在**任意一个**
       * 源码给的锚点上都算对 —— 但必须至少有一个锚点对得上。
       */
      const cands = wantModels.filter(p => bare(p.file) === bare(m.file));
      if (!cands.length) continue;
      const near = p => {
        const lim = (p.anchor === 'front' ? 1.4 : 0.45) + (p.spread ?? 0);
        return p.anchor === 'self' || p.anchor === 'front'
          ? Math.hypot(m.pos[0] - me.x, m.pos[1] - me.y) <= lim
          : Math.hypot(m.pos[0] - t.x, m.pos[1] - t.y) <= 0.5 + (p.spread ?? 0);
      };
      check(
        `${s.name} ${m.file} 落在源码给的锚点上（${cands.map(p => p.anchor).join('/')}）`,
        cands.some(near),
        `特效 ${m.pos} vs 角色 ${me.x},${me.y} / 靶子 ${t.x},${t.y}`
      );
    }

    /* 动作号：action >= 0 时角色必须真的在播这个号 */
    if (s.action >= 0) {
      check(`${s.name} 角色动作 = ${s.action}`, after.action === s.action, `实际 ${after.action}`);
    }

    await sleep(80);
  }
  console.log(`合计生成 ${totalModels} 个模型特效 / ${totalSprites} 个贴图特效`);

  /*
   * 软渲染（SwiftShader）在跑完 49 个技能之后会整段卡住十几秒：
   * `renderer.info.render.frame` 一帧都不涨、特效 `age` 冻在 0。
   * 这时「火球没飞 / 陨石没落 / 拖尾没点」全是**假报警**。
   * 所以凡是断言「每帧推进」的用例，先等页面真的恢复出帧再采样；
   * 等不到就跳过并打印，而不是把环境问题记成产品缺陷。
   */
  /* ---- 追踪弹：火球 ---- */
  const framesOk = await waitForFrames(6);
  if (!framesOk) console.log('  … 页面长时间不跑帧（软渲染卡死），「每帧推进」类断言将跳过');
  await c.ev(`__MU_APP__.fxClear()`);
  const fire = skills.find(s => s.id === 4);
  const firePart = fire?.parts.find(p => p.kind === 'model');
  check('火球（4）标了 homing 追踪弹', firePart?.homing === true, `parts=${JSON.stringify(fire?.parts)}`);
  const castRes = await c.ev(`__MU_APP__.castSkill(4)`);
  /*
   * 弹道只飞 0.32 s，所以采样要密。这里**从 Node 逐次采**而不是在页面里
   * 跑一个大 await：页面一旦卡住（软渲染下会整段卡十几秒），那个大 await
   * 就永远不返回，整个探针跟着挂死。
   *
   * 同时采 `renderer.info.render.frame`：帧号不涨 = 页面根本没跑帧，
   * 特效 `age` 自然冻在 0 —— 那不是「弹道没生效」，不能拿来下结论。
   */
  const sample = async () => {
    const f0 = await frameNo();
    const xs = [];
    for (let i = 0; i < 60; i++) {
      const fx = await c.ev(`__MU_APP__.fx()`);
      const e = fx.find(x => /fire01/i.test(x.file));
      if (e) xs.push(e.at[0]);
      else if (xs.length) break; // 出过又消失了 = 播完
      await sleep(50);
    }
    return { xs, frames: (await frameNo()) - f0 };
  };

  let s1 = await sample();
  if (s1.frames === 0) {
    console.log('  … 页面整段没跑帧（软渲染卡顿），重试一次');
    await c.ev(`__MU_APP__.fxClear()`);
    await c.ev(`__MU_APP__.castSkill(4)`);
    s1 = await sample();
  }
  const span = s1.xs.length ? Math.max(...s1.xs) - Math.min(...s1.xs) : 0;
  console.log(
    `火球轨迹 ${s1.xs.length} 个样本（页面跑了 ${s1.frames} 帧）: ${s1.xs.join(' → ')}`
  );
  console.log(`cast(4) = ${JSON.stringify(castRes)}`);
  if (s1.frames === 0) {
    console.log('  · 跳过：火球弹道（页面全程没跑帧，环境问题）');
  } else {
    check('火球朝靶子动了（追踪弹道）', span > 0.5, `横向位移 ${span.toFixed(2)} 格`);
  }

  /* ---- 武器拖尾：源码 Trail_RenderAll 的近似 ----
   * 点来自持械手骨骼每帧的世界坐标（源码里是 m_vPosSword），
   * 19 地裂斩源码里没有法术特效，能看到的就该是这条刀光。 */
  const measureTrail = async () => {
    const live = await waitForFrames(4);
    await c.ev(`__MU_APP__.fxClear()`);
    await c.ev(`__MU_APP__.castSkill(19)`);
    // 动作先起来再采样：刚 cast 那一刻还没 push 第一个点
    await sleep(200);
    let t = null;
    for (let i = 0; i < 30; i++) {
      t = await c.ev(`__MU_APP__.fxTrail()`);
      if (t.points >= 2) break;
      await sleep(100);
    }
    return { ...t, live };
  };
  let trail = await measureTrail();
  // 一次都没点就重试：软渲染偶尔整段卡住，采样窗口里一帧都没跑
  if (!trail || trail.points === 0) trail = await measureTrail();
  console.log(`拖尾: ${JSON.stringify(trail)}`);
  /*
   * 阈值用 2 不是偷懒：无头软渲染只有 ~10 fps，而单点寿命 0.24 s，
   * 同一时刻点列里天然只有 2~3 个点（真机上 60 fps 会有十几个）。
   * 关键是 span > 0.2 m —— 说明它真的划过一段弧，而不是原地抖。
   */
  if (!trail || trail.live === false) {
    console.log('  · 跳过：武器拖尾（页面全程没跑帧，环境问题）');
  } else {
    check(
      '挥砍留下武器拖尾（≥2 个采样点、折线 > 0.2 m）',
      trail.points >= 2 && trail.span > 0.2,
      `points=${trail.points} span=${trail.span}`
    );
  }

  /* ---- 特效朝向：MU 世界角度（0 = +X），必须**正好**朝向目标 ----
   * 
   * 这里踩过两个坑，都要靠这两条断言挡住：
   *   1. 世界是 Z-up，绕竖轴是 `rotation.z` —— 写成 `rotation.y` 会把特效翻倒；
   *   2. `player.yaw` 里带 `MODEL_YAW_OFFSET(π/2)`（给角色 BMD 的「本地朝 -Y」用的），
   *      特效模型是「0 = +X」，直接传就会**整体多转 90°**。
   */
  await c.ev(`__MU_APP__.fxClear()`);
  const aim = JSON.parse(
    await c.ev(`(async () => {
      const p0 = __MU_APP__.playerActor();
      const t0 = __MU_APP__.skillTarget();
      await __MU_APP__.castSkill(13);        // 毁灭烈焰：定向特效（Blast01，本地 +Y 伸出）
      const want = Math.atan2(t0.y - p0.y, t0.x - p0.x);
      let root = null;
      for (let i = 0; i < 40; i++) {
        root = __MU__.scene.getObjectByName('fx:Blast01.bmd');
        if (root) break;
        await new Promise(r => setTimeout(r, 50));
      }
      if (!root) return JSON.stringify({ ok: false, reason: 'no-entity' });
      root.updateMatrixWorld(true);
      const el = root.matrixWorld.elements;
      // 局部 +X 在世界 XY 平面的投影；用 a 求出的角度与「指向目标」比较
      const fxAng = Math.atan2(el[1], el[0]);
      const p1 = __MU_APP__.playerActor();
      const t1 = __MU_APP__.skillTarget();
      const toTgt = Math.atan2(t1.y - p1.y, t1.x - p1.x);
      return JSON.stringify({ ok: true, want, fxAng, toTgt });
    })()`)
  );
  const angDiff = (a, b) => {
    let d = ((a - b) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    return Math.abs(d);
  };
  console.log(`朝向: 施法角度 ${aim.want?.toFixed(3)} / 特效角度 ${aim.fxAng?.toFixed(3)} / 指向目标 ${aim.toTgt?.toFixed(3)}`);
  check(
    '特效 root 的局部 +X 指向目标（没有多转 90°）',
    aim.ok === true && angDiff(aim.fxAng, aim.toTgt) < 0.05,
    `差 ${aim.ok ? (angDiff(aim.fxAng, aim.toTgt) * 180 / Math.PI).toFixed(1) + '°' : aim.reason}`
  );
  check(
    '特效是绕**竖轴**(Z)转的，不是绕水平轴（rotation.y 会翻倒）',
    aim.ok === true && Math.abs(aim.fxAng - aim.toTgt) < Math.PI / 2,
    '角度差接近 90° 说明用错了轴'
  );

  /* ---- 地面光斑：源码 MoveEffect 每帧 AddTerrainLight 的近似 ---- */
  await c.ev(`__MU_APP__.fxClear()`);
  await c.ev(`__MU_APP__.castSkill(10)`); // 地狱火：地面火环
  let glowSeen = false;
  for (let i = 0; i < 20; i++) {
    const fx = await c.ev(`__MU_APP__.fx()`);
    if (fx.some(f => f.glow)) { glowSeen = true; break; }
    await sleep(80);
  }
  check('落点地面有光斑（AddTerrainLight 的近似）', glowSeen);

  /* ---- 陨石：源码写死的「天降」轨迹 ----
   * `CreateEffect(191, …)` 的 SubType 0 把 `[6] += 400`（离地 4 m）、
   * `[0x32] = -50`（每帧 -50 单位 = -12.5 m/s）。这里量 z 是不是真的从高处掉到地面。 */
  const meteorOk = await waitForFrames(6);
  await c.ev(`__MU_APP__.fxClear()`);
  const tgt = await c.ev(`__MU_APP__.skillTarget()`);
  await c.ev(`__MU_APP__.castSkill(2)`);
  const zs = [];
  for (let i = 0; i < 40; i++) {
    const fx = await c.ev(`__MU_APP__.fx()`);
    const e = fx.find(f => /fire01/i.test(f.file));
    if (e) zs.push(e.at[2]);
    else if (zs.length) break;
    await sleep(60);
  }
  // 取**整段采样的最高点**：采样第一帧有可能已经错过 0.32 s 的下落段
  const zTop = zs.length ? Math.max(...zs) : 0;
  const zEnd = zs.length ? zs[zs.length - 1] : 0;
  console.log(`陨石高度轨迹: ${zs.map(z => z.toFixed(2)).join(' → ')}（地面 ${tgt.z.toFixed(2)}）`);
  if (!meteorOk) {
    console.log('  · 跳过：陨石落点（页面全程没跑帧，环境问题）');
  } else {
    check('陨石从高空生成（离地 ≈4 m）', zTop - tgt.z > 2.5, `起始 ${zTop.toFixed(2)} vs 地面 ${tgt.z.toFixed(2)}`);
    check('陨石落到地面', Math.abs(zEnd - tgt.z) < 0.6, `落点 ${zEnd.toFixed(2)} vs 地面 ${tgt.z.toFixed(2)}`);
  }

  /* ---- 播完自动销毁 ----
   * 软渲染下帧率只有 ~10 fps，`dt` 被夹在 0.1，所以墙钟时间要留够；
   * 这里轮询到「两层都空」为止（最多 10 s），避免把卡顿误判成泄漏。 */
  /*
   * 这一条要**确定性**地测：先清空，再放两个寿命已知的技能
   * （地狱火 15 帧 = 0.6 s、火龙贴图 0.8 s），然后等它们自己消失。
   * 不依赖上一步的残留 —— 上一步的陨石寿命 1.6 s，轮询窗口刚好会和它错开。
   */
  await c.ev(`__MU_APP__.fxClear()`);
  await c.ev(`__MU_APP__.castSkill(10)`);
  await c.ev(`__MU_APP__.castSkill(5)`);
  let leftM = [];
  let leftS = [];
  for (let i = 0; i < 40; i++) {
    leftM = await c.ev(`__MU_APP__.fx()`);
    leftS = await c.ev(`__MU_APP__.fxSprites()`);
    if (!leftM.length && !leftS.length) break;
    await sleep(250);
  }
  check(
    '模型特效播完自动移除（不泄漏）',
    leftM.length === 0,
    `还剩 ${leftM.length} 个：${leftM.map(f => `${f.file}(age ${f.age})`).join(',')}`
  );
  check(
    '贴图特效播完自动移除（不泄漏）',
    leftS.length === 0,
    `还剩 ${leftS.length} 个：${leftS.map(f => `${f.file}(age ${f.age})`).join(',')}`
  );

  /* ---- 站位与朝向 ---- */
  const nj = JSON.parse(await c.ev(`(() => {
    const a = __MU_APP__.playerActor(), t = __MU_APP__.skillTarget();
    const d = Math.hypot(t.x - a.x, t.y - a.y);
    // 面向靶子：模型朝 -Y，yaw = atan2(dy,dx) + π/2
    const want = Math.atan2(t.y - a.y, t.x - a.x) + Math.PI / 2;
    let diff = Math.abs(((a.yaw - want + Math.PI) % (Math.PI * 2)) - Math.PI);
    return JSON.stringify({ d: +d.toFixed(2), yawDiff: +diff.toFixed(3) });
  })()`));
  check('点 Cast 后角色贴到靶子 3.2 格内', nj.d <= 3.3, `实际 ${nj.d} 格`);
  check('角色面向靶子', nj.yawDiff < 0.2, `差 ${nj.yawDiff} rad`);

  const errors = (c.logs ?? []).slice(errorsBefore).filter(l => /\[exc\]|error/i.test(l));
  check('释放过程中没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' | '));

  /* ---- 视觉验证：画面上真的出现了东西 ----
   * 这条是补上一个坑：特效节点在场景里、包围盒也对，但蒙皮网格没挂到场景根，
   * 结果是 `fx()` 一切正常、屏幕上什么都没有。只查数据是抓不到的。 */
  await c.ev(`__MU_APP__.sandboxShow(false)`);
  await sleep(1400); // 等上一轮特效全部淡出
  const before = await shot(null);
  await c.ev(`__MU_APP__.castSkill(4)`); // Fire Ball
  for (let i = 0; i < 30; i++) {
    const fx = await c.ev(`__MU_APP__.fx()`);
    if (fx.some(f => f.file === 'Fire01.bmd')) break;
    await sleep(60);
  }
  await sleep(60); // 让第一帧动画走起来
  const after = await shot('skill-fire');
  const diff = await diffPixels(before.b64, after.b64);
  const ratio = diff.changed / diff.total;
  check(
    `Fire Ball 真的画到屏幕上（像素差分 ${(ratio * 100).toFixed(2)}%）`,
    ratio > 0.004,
    `${diff.changed}/${diff.total} 像素变化`
  );

  /* ---- 贴图特效也能画出来（这一层以前完全没有） ---- */
  await sleep(1200);
  const before2 = await shot(null);
  await c.ev(`__MU_APP__.castSkill(5)`); // 火龙：源码只有 Flame01 贴图，没有模型
  /*
   * 不能「等到出现就拍」：贴图寿命只有 0.8 s，而 CDP 一次往返 100~300 ms，
   * 等循环结束再截可能已经在淡出的尾巴上（实测掉到 0.06%）。
   * 固定等 380 ms（延迟 240 + 生成 ~100），正好在火焰最亮的时候。
   */
  await sleep(380);
  const after2 = await shot('skill-sprite');
  const diff2 = await diffPixels(before2.b64, after2.b64);
  const ratio2 = diff2.changed / diff2.total;
  check(
    `火龙贴图特效画到屏幕上（像素差分 ${(ratio2 * 100).toFixed(2)}%）`,
    ratio2 > 0.004,
    `${diff2.changed}/${diff2.total} 像素变化`
  );

  console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：✓ ${pass} / ✗ ${fail}`);
} finally {
  await c.close?.();
}
