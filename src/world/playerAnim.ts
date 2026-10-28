/**
 * 玩家动作选择 —— `SetPlayerStop` / `SetPlayerWalk` / `SetPlayerAttack` 的移植。
 *
 * 0.97 客户端这三张表都是「按武器模型号选动作号」，模型号 = 物品 type + 400，
 * 所以这里先算模型号，再照抄源码的分支。源码位置：
 *
 *   SetPlayerStop   (`Net/SecondPassword.cpp:1906`)
 *   SetPlayerWalk   (`Net/SecondPassword.cpp:2070`)
 *   SetPlayerAttack (`Scene/Scene_CharSelect_Nav.cpp:1617`)
 *
 * 动作号本身是 player.bmd 里的下标，`Model_Items.cpp:25-120` 的
 * `OpenSMDAnimation` 顺序给出了每个下标的含义（`attack_fist` = 34 有双重证据：
 * `SetAttackSpeed` 写的偏移量是 16*34+4）：
 *
 *   1/2        no-weapon（男/女精灵）
 *   3/4        单手 / 双手武器待机
 *   5          497/498 特殊武器
 *   6          长柄武器双手待机
 *   7/8        弓 / 弩待机
 *   9/10       翅膀飞行待机（10 = 拿弓）
 *   13/14      no-weapon 走
 *   15/16      单手 / 双手走
 *   17/18      锤 / 长柄
 *   19/20      弓 / 法杖
 *   30/31      翅膀飞行（31 = 拿弩）
 *   34         空手攻击
 *   35..38     单手 1/2 段（含双持四连）
 *   39..41     双手三连
 *   42         497/498
 *   43..45     锤 / 法杖
 *   46/47      弓 / 弩
 *   48/49      带翅膀的弓 / 弩
 *   81         431（特殊双手剑）
 *   84/85      长柄双手
 */
import { loadItemTable, type ItemRecord } from '../data/localText';

/** 武器大类 —— 只按源码里出现过的模型号区间划分 */
export type WeaponKind = 'none' | 'sword' | 'mace' | 'staff' | 'spear' | 'bow' | 'crossbow';

let table: ItemRecord[] | null = null;
let tableTask: Promise<ItemRecord[]> | null = null;

/** 预加载 item.bmd（动作选择要读 TwoHand 标记） */
export async function warmPlayerAnimTables(): Promise<void> {
  if (table) return;
  tableTask ??= loadItemTable();
  table = await tableTask;
}

function twoHand(type: number): boolean {
  return (table?.[type]?.twoHand ?? 0) !== 0;
}

/**
 * 调试用：把「这个 type 算哪类武器、是不是双手」摊开给探针看。
 * 动作表本身只认模型号，但双手标记来自 item.bmd，探针没法自己读，所以对外暴露一个查询。
 */
export function weaponInfo(type: number | undefined): { kind: WeaponKind | 'unknown'; twoHand: boolean } {
  if (type === undefined) return { kind: 'unknown', twoHand: false };
  return { kind: weaponKind(type), twoHand: twoHand(type) };
}

/**
 * 装备 type → 武器大类。
 *
 * 源码判的是**模型号**（`c+0x270` 里存的是 type+400）：
 *   400..495  剑/斧/锤      → 单手 35/36，双手 39..41
 *   496..527  （源码注释写 mace）→ 43..45
 *   497/498                  → 42（特殊）
 *   528..534、545            弓
 *   536..542、544、546       弩
 *   560..591  （源码注释写 spear）→ 双手 84/85 / 单手 35/36
 *   592..623  盾 —— 不算武器
 */
export function weaponKind(type: number | undefined): WeaponKind {
  if (type === undefined || type < 0) return 'none';
  const m = type + 400;
  if (m >= 400 && m < 496) return 'sword';
  if (m === 497 || m === 498) return 'mace';
  if (m >= 496 && m < 528) return 'staff';
  if ((m >= 528 && m < 535) || m === 545) return 'bow';
  if ((m >= 536 && m < 543) || m === 544 || m === 546) return 'crossbow';
  if (m >= 560 && m < 592) return 'spear';
  return 'none';
}

export interface AnimInput {
  /** 0 号槽（右手武器） */
  weapon?: number;
  /** 1 号槽（左手：盾 / 弓） */
  shield?: number;
  /** 7 号槽翅膀 */
  wing?: number;
  /** 职业 & 7：2 = 精灵 */
  cls?: number;
  /** 站在安全区 */
  safeZone?: boolean;
  /**
   * 在水里（亚特兰蒂斯 = World 7，非安全区，脚下是水瓦片）。
   *
   * 对应客户端两处：
   *   `SetPlayerStop`：`SceneFlag==5 && World==7` 且脚下的 tile 不是「实地」
   *     → `SetAction(9/10)`，也就是**浮空待机**（拿弓/弩是 10）；
   *   `SetPlayerWalk`：`!SafeZone && World==7` → `SetAction(stamina<40 ? 21 : 29)`，
   *     也就是**游动**（21 正常 / 29 力竭）。
   */
  inWater?: boolean;
  /** 耐力不足（客户端 `stamina < 0x28`）—— 水里用 29 的"力竭游泳" */
  staminaLow?: boolean;
}

/** 任一手上的武器（弓/弩在 1 号槽，所以两边都要看） */
function armedHand(input: AnimInput): { type?: number; kind: WeaponKind } {
  const a = weaponKind(input.weapon);
  if (a !== 'none') return { type: input.weapon, kind: a };
  const b = weaponKind(input.shield);
  if (b !== 'none') return { type: input.shield, kind: b };
  return { kind: 'none' };
}

/** 翅膀生效 = 装了翅膀而且不在安全区（源码 `!SafeZone && wings != -1`） */
export function isFlying(input: AnimInput): boolean {
  return input.wing !== undefined && input.safeZone !== true;
}

/**
 * 武器在不在手上。
 *
 * 安全区里 `RenderCharacterBackItem` 把武器挂到背上（骨骼 47），手里是空的 ——
 * 姿势也必须跟着回到空手，否则就是「背着剑却做持剑待机」这种自相矛盾的画面。
 * 源码那三张表只看 `c+0x270`（手上的武器），没把背挂联立进来，是客户端自己
 * 用 `c->SafeZone` 兜住的；这里补上同一层判断。
 */
function handEmpty(input: AnimInput): boolean {
  return input.safeZone === true;
}

/** 空手待机 / 走：精灵用 2 / 14，其余 1 / 13 */
function unarmedIdle(input: AnimInput): number {
  return (input.cls ?? 0) === 2 ? 2 : 1;
}

function unarmedWalk(input: AnimInput): number {
  return (input.cls ?? 0) === 2 ? 14 : 13;
}

/** 女角（精灵，cls===2）用女性动作，其余用男性动作 —— 与 idle/walk 的性别划分一致 */
function isFemale(input: AnimInput): boolean {
  return (input.cls ?? 0) === 2;
}

/** 待机动作（SetPlayerStop） */
export function idleAction(input: AnimInput): number {
  /*
   * 水里浮空（亚特兰蒂斯）和飞行共用 9/10：客户端 `if (gateA || Fly)` 就把两者
   * 并到一个分支里了。**必须放在空手判断之前** —— 在水里武器是拿着的。
   */
  if (input.inWater) {
    const okind = armedHand(input).kind;
    return okind === 'bow' || okind === 'crossbow' ? 10 : 9;
  }
  if (handEmpty(input)) return unarmedIdle(input);

  const { type, kind } = armedHand(input);

  if (isFlying(input)) {
    return kind === 'bow' || kind === 'crossbow' ? 10 : 9;
  }

  if (kind === 'none') return (input.cls ?? 0) === 2 ? 2 : 1;
  if (kind === 'sword') return twoHand(type!) && type !== 431 ? 4 : 3;
  if (kind === 'mace') return 5;
  if (kind === 'spear') return twoHand(type!) ? 6 : 3;
  if (kind === 'staff') return twoHand(type!) ? 6 : 3;
  if (kind === 'bow') return 7;
  if (kind === 'crossbow') return 8;
  return 1;
}

/** 走 / 跑动作（SetPlayerWalk） */
export function moveAction(input: AnimInput): number {
  /*
   * 亚特兰蒂斯游泳：`!SafeZone && World == 7` → 21（耐力 < 40 时 29）。
   * 翅膀优先（30/31），所以这里只处理没翅膀的情况。
   */
  if (input.inWater && !isFlying(input)) return input.staminaLow ? 29 : 21;
  if (handEmpty(input)) return unarmedWalk(input);

  const { type, kind } = armedHand(input);

  if (isFlying(input)) return kind === 'crossbow' ? 31 : 30;

  if (kind === 'none') return (input.cls ?? 0) === 2 ? 14 : 13;
  if (kind === 'sword') return twoHand(type!) ? (type === 431 ? 79 : 16) : 15;
  if (kind === 'mace') return 17;
  if (kind === 'spear') return twoHand(type!) ? 18 : 15;
  if (kind === 'staff') return 20;
  if (kind === 'bow') return 19;
  if (kind === 'crossbow') return 20;
  return 13;
}

/**
 * 攻击动作（SetPlayerAttack）。
 *
 * `combo` 是原版的 `c+771` 计数器（每次出手 +1），源码用它轮换多段攻击。
 * 返回的动作号会同时发给服务端（0x15 包里带 action），别人看到的就是这个。
 */
export function attackAction(input: AnimInput, combo = 0): number {
  // 安全区手上没武器（背在背上）—— 出手就是空手拳
  if (handEmpty(input)) return 34;

  const { type, kind } = armedHand(input);
  const flying = isFlying(input);

  switch (kind) {
    case 'none':
      return 34;
    case 'sword':
      if (twoHand(type!)) return type === 431 ? 81 : 39 + (combo % 3);
      // 双手各一把剑：35 / 37 / 36 / 38 四连
      if (weaponKind(input.weapon) === 'sword' && weaponKind(input.shield) === 'sword') {
        return [35, 37, 36, 38][combo & 3];
      }
      return 35 + (combo & 1);
    case 'spear':
      return twoHand(type!) ? 84 + (combo & 1) : 35 + (combo & 1);
    case 'mace':
      return 42;
    case 'staff':
      return 43 + (combo % 3);
    case 'bow':
      return flying ? 48 : 46;
    case 'crossbow':
      return flying ? 49 : 47;
    default:
      return 34;
  }
}
