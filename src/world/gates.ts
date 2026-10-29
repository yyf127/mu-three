/**
 * 走上去就传送的门（原版 `CheckGate` @ 0x004AC140）。
 *
 * 这里补的是一个**协议空缺**：服务端不会自己发现你踩到传送门 —— 它只在收到
 * `C1 06 1C [gate] 00 00`（`CGTeleportRecv`）时才搬人。原版客户端是**客户端**
 * 每帧扫 `GateAttribute`、踩到就发这个包。我们之前一直没发，所以全服所有
 * 地图之间的路口（洛兰→地下城、地下城→地下城2 …）走过去都没反应。
 *
 * 规则逐条照 `Net/SecondPassword.cpp::CheckGate`：
 *
 *   1. 只看 `flag === 1` 的门 —— `Gate.txt` 里门是成对的：
 *        flag 1 = 入口（客户端踩它，`Target` 指向对面的落点门）
 *        flag 2 = 落点（别人把你送到这里；**踩它不会触发**，否则会来回弹）
 *        flag 0 = `/move` 的大落点区域
 *   2. 矩形是 `X,Y .. TX,TY`（含两端），不是服务端 `IsInGate` 那个「TX±5」。
 *   3. 魔剑士（`Class & 7 === 3`）的等级门槛 × 2/3（`GetMoveLevel`）。
 *   4. 亚特兰蒂斯/塔卡那几道门（45..49 / 55..56）不许带独角兽/恐龙头
 *      （418/419），天空之城（62..65）必须带翅膀或恐龙头。
 *
 * 重置/账号等级的判定**不做**：`parseGateText` 把 `*` 归一成 0，`MaxRes=0`
 * 会被读成「转生必须为 0」，反而挡住所有人。这两条交给服务端拦。
 */
import { warpTable, type GateRecord } from './warp';

/** 踩到门时的结果 */
export interface GateHit {
  /** 要发给服务端的门号（`flag=1` 那条） */
  gate: number;
  /** 目的地门（`Target` 指向的 `flag=2` 落点），离线版直接拿它落地 */
  dest: GateRecord;
}

/** 判定用的角色信息 */
export interface GateActor {
  level: number;
  /** 职业索引（`Class & 7`；3 = 魔剑士） */
  charClass: number;
  /** 装备槽 7 的物品类型，-1/0 = 空 */
  wing: number;
  /** 装备槽 8 的物品类型（守护天使/小恶魔/独角兽/恐龙头），-1/0 = 空 */
  helper: number;
}

/** 被挡住的原因（用来提示，和原版 `GlobalText` 那几条对应） */
export type GateBlock = 'level' | 'helper' | 'wings' | 'pet';

export interface GateCheck {
  hit: GateHit | null;
  block: GateBlock | null;
  /** 提示里要带的数量（等级门槛） */
  need?: number;
}

const ATLANS_GATES = { from: 45, to: 49 };
const TARKAN_GATES = { from: 55, to: 56 };
const ICARUS_GATES = { from: 62, to: 65 };

/** 独角兽 / 恐龙头（原版 `Uniria`,`Dinorant`） */
const isRideHelper = (type: number) => type === 418 || type === 419;
/** 翅膀 384..390 */
const isWing = (type: number) => type >= 384 && type <= 390;

/** 服务端 `CGate::GetMoveLevel`：魔剑士按 2/3 算 */
function moveLevel(actor: GateActor, level: number) {
  return (actor.charClass & 7) === 3 ? Math.floor((level * 2) / 3) : level;
}

/**
 * 扫一遍当前地图的门，返回「踩到了哪个」。没踩到返回 `{hit:null, block:null}`。
 *
 * 同一帧可能同时落在两条门的矩形里（路口重叠），按原版做法**取第一条**
 * —— 原版循环找到就发并置 `LoadingWorld`，后面的不再看。
 */
export function checkWalkGate(
  map: number,
  x: number,
  y: number,
  actor: GateActor
): GateCheck {
  let block: GateBlock | null = null;
  let need = 0;

  for (const g of warpTable.gates.values()) {
    if (g.flag !== 1 || g.map !== map) continue;
    if (x < g.x1 || x > g.x2 || y < g.y1 || y > g.y2) continue;

    const minLevel = moveLevel(actor, g.minLevel);
    if (g.minLevel > 0 && actor.level < minLevel) {
      block = 'level';
      need = minLevel;
      continue;
    }
    if (g.maxLevel > 0 && actor.level > g.maxLevel) continue;

    // 亚特兰蒂斯 / 塔卡：不许骑独角兽、恐龙头
    const nearAtlans =
      (g.index >= ATLANS_GATES.from && g.index <= ATLANS_GATES.to) ||
      (g.index >= TARKAN_GATES.from && g.index <= TARKAN_GATES.to);
    if (nearAtlans && isRideHelper(actor.helper)) {
      block = 'pet';
      continue;
    }

    // 天空之城：必须翅膀或恐龙头
    if (g.index >= ICARUS_GATES.from && g.index <= ICARUS_GATES.to) {
      const ok = isWing(actor.wing) || actor.helper === 419;
      if (!ok) {
        block = 'wings';
        // 原版这里还会补一句「需要 N 级」
        if (g.minLevel > 0 && actor.level < minLevel) need = minLevel;
        continue;
      }
      if (actor.helper === 418) {
        block = 'helper';
        continue;
      }
    }

    const dest = warpTable.gates.get(g.target);
    // `Target` 指向的门不存在就不动（服务端 `GetGate` 也是直接返回 0）
    if (!dest) continue;
    return { hit: { gate: g.index, dest }, block: null };
  }

  return { hit: null, block, need: need || undefined };
}
