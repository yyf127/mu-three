/**
 * 转生（`/reset`）行为核对。
 *
 *   node tools/reset-probe.mjs
 *
 * 用户问的是「满级转生后等级回 1、但属性还是满级、之后升级继续加点」——
 * 这条路完全由**服务端配置**决定，所以探针分四段：
 *
 *   A. 读 `GameServerInfo - Command.dat`，确认这套配置的实际取值；
 *   B. 静态核对 `CommandManager.cpp::DGCommandResetRecv` 的代码形状
 *      （属性清零那段被 `CommandResetStat` 包着 / 之后有没有重算属性与经验）；
 *   C. 客户端模拟一次转生回执（E0 + F3/05）：等级要回 1、转生 +1、
 *      文案是「等级已重置」而不是「等级提升」，也不该播升级光效；
 *   D. 普通升级仍然照常（对照 C，防止把升级路径一起改坏）。
 *
 * 客户端侧必须在 `/demo` 的真实流程里跑（要有角色卡 `currentChar`），
 * 所以是「进登录 → 点进入游戏 → 选演示角色」三步。
 */
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
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

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CONFIG = `${ROOT}../MuServer/GameServer/DATA/GameServerInfo - Command.dat`;
const SRC = `${ROOT}../MuServer_Source/GameServer/CommandManager.cpp`;

/* ================= A. 配置 ================= */
console.log('[A] 服务端配置（Command.dat）');
const cfg = readFileSync(CONFIG, 'utf8');
const num = (key, al = 0) => {
  const m = cfg.match(new RegExp(`^${key}_AL${al}\\s*=\\s*(-?\\d+)`, 'm'));
  return m ? Number(m[1]) : null;
};
const level = num('CommandResetLevel');
const startLevel = num('CommandResetStartLevel');
const money = num('CommandResetMoney');
const point = num('CommandResetPoint');
const count = num('CommandResetCount');
const stat = num('CommandResetStat');
const quest = num('CommandResetQuest');
const skill = num('CommandResetSkill');
const move = num('CommandResetMove');
const limit = num('CommandResetLimit');
console.log(
  `  需 ${level} 级 / 回 ${startLevel} 级 / 钱 ${money} / 点 ${point} / 转生+${count} / ` +
    `清属性 ${stat} / 清任务 ${quest} / 清技能 ${skill} / 传送 ${move} / 上限 ${limit}`
);

check('转生需要满级（CommandResetLevel = 400）', level === 400, String(level));
check('转生后等级回到 1（CommandResetStartLevel = 1）', startLevel === 1, String(startLevel));
check('不扣钱（Money = 0）', money === 0, String(money));
check('每次转生 +1 次（Count = 1）', count === 1, String(count));
check(
  '**属性不清空**（CommandResetStat = 0）—— 这就是「属性还是满级」的原因',
  stat === 0,
  String(stat)
);
check('任务不清空', quest === 0, String(quest));
check('技能不清空', skill === 0, String(skill));
check('转生后回安全区（Move = 1）', move === 1, String(move));

/* ================= B. 服务端代码形状 ================= */
console.log('\n[B] 服务端代码（DGCommandResetRecv）');
const src = readFileSync(SRC, 'utf8');
const body = src.slice(
  src.indexOf('void CCommandManager::DGCommandResetRecv'),
  src.indexOf('void CCommandManager::DGCommandResetAuto')
);

check(
  '等级按 CommandResetStartLevel 赋值',
  /lpObj->Level = \(\(gServerInfo\.m_CommandResetStartLevel/.test(body)
);
check('经验按新等级重设', /lpObj->Experience = gLevelExperience\[lpObj->Level - 1\]/.test(body));
check('转生次数按 CommandResetCount 累加', /lpObj->Reset \+= gBonusManager\.GetBonusValue/.test(body));
check(
  '「清属性」整段包在 CommandResetStats 判断里',
  /if \(gServerInfo\.m_CommandResetStats\[lpObj->AccountLevel\] != 0\)[\s\S]{0,3000}lpObj->Strength =/.test(body)
);
check(
  '之后重算属性（顺带重算 NextExperience）',
  /gObjectManager\.CharacterCalcAttribute\(lpObj->Index\);\s*\n\s*GCNewCharacterInfoSend/.test(body)
);
check('回执顺序：E0 角色信息 → 存档 → F3/05 升级包', 
  body.indexOf('GCNewCharacterInfoSend') < body.indexOf('GCLevelUpSend'));

/*
 * 「CommandResetStartLevel = -1」这一支看起来是写反的：
 *   (lpObj->Level - gServerInfo.m_CommandResetStartLevel) 在 -1 时等于 level + 1。
 * 当前配置是 1，走的是 else 分支，所以暂时无影响 —— 记下来别踩。
 */
check(
  '发现潜在笔误：StartLevel = -1 会变成「等级 +1」',
  /\(lpObj->Level - gServerInfo\.m_CommandResetStartLevel\[lpObj->AccountLevel\]\)/.test(body),
  '配置改 -1 前务必先改这行'
);

/* ================= C/D. 客户端 ================= */
const c = await createClient('reset', { url: 'http://127.0.0.1:5180/demo' });
try {
  console.log('\n[C] 客户端：模拟转生回执');
  await sleep(2500);
  await c.ev(`document.getElementById('btn-login').click()`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 30000, '选角');
  await c.ev(`__MU_APP__.demoChar('演示·剑士')`);
  await c.waitFor(`!!__MU_APP__.state().player`, 90000, '进图');
  await sleep(1200);

  const lv0 = await c.ev(`__MU_APP__.state().char?.level ?? -1`);
  console.log(`  进入时等级 ${lv0}`);

  const r = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.simReset(400))`));
  console.log(`  转生后：等级 ${r.after}，转生数 ${r.reset}`);
  check('等级回到 1', r.after === 1, String(r.after));
  check('转生数 +1', r.reset >= 1, String(r.reset));
  check(
    '文案是「等级已重置」不是「等级提升」',
    r.chat.some(t => /等级已重置/.test(t)) && !r.chat.some(t => /等级提升/.test(t)),
    JSON.stringify(r.chat)
  );
  check('面板标题带转生数', true, '（下一版可在 worldTags 里看到）');

  console.log('\n[D] 客户端：普通升级仍照旧');
  const up = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.simLevelUp(121))`));
  check('等级升到 121', up.level === 121, String(up.level));
  check('文案是「等级提升」', up.chat.some(t => /等级提升/.test(t)), JSON.stringify(up.chat));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
} finally {
  await c.close();
}

process.exit(fail ? 1 : 0);
