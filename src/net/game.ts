/**
 * 进图后的实体同步报文。
 *
 * 服务端（Viewport.cpp / Protocol.cpp）下发：
 *   0x12  C2  视野内的**其它玩家**   PMSG_VIEWPORT_PLAYER 每条 32 字节
 *   0x13  C2  视野内的**怪物/NPC**   PMSG_VIEWPORT_MONSTER 每条 12 字节
 *   0x14  C1  离开视野              PMSG_VIEWPORT_DESTROY
 *   0x10  C1  位置/移动              PMSG_MOVE_SEND（**不是 0x11**）
 *
 * 结构体都没加 `#pragma pack`，所以有对齐填充，步长必须按 sizeof 写死。
 */

/**
 * 方向 0..7 → 位移。**必须与服务端 `RoadPathTable` 逐项一致**：
 *
 *   MuServer_Source/GameServer/Util.cpp:17
 *   short RoadPathTable[16] = { -1,-1,  0,-1,  1,-1,  1,0,  1,1,  0,1,  -1,1,  -1,0 };
 *
 * 也就是「从西北开始**顺时针**」。之前这里按逆时针写（3=西、4=东…），
 * 前三个方向碰巧对上，从第 4 个开始全部错位：
 * 客户端往上走报 6，服务端按 6 解释成西南 (-1,+1)，
 * 于是服务端算出来的位置每一步都偏一格，走几步就被 0x11 拉回原地。
 */
export const DIR_VECTORS: [number, number][] = [
  [-1, -1], // 0 西北
  [0, -1], // 1 北
  [1, -1], // 2 东北
  [1, 0], // 3 东
  [1, 1], // 4 东南
  [0, 1], // 5 南
  [-1, 1], // 6 西南
  [-1, 0], // 7 西
];

export interface ViewportPlayer {
  id: number;
  x: number;
  y: number;
  charSet: number[];
  skillState: number;
  name: string;
  tx: number;
  ty: number;
  dir: number;
  pkLevel: number;
  /** 服务端标记这是新建（高位标志），否则只是位置刷新 */
  created: boolean;
}

export interface ViewportMonster {
  id: number;
  type: number;
  /** 只有召唤物（0x1F）带名字，普通怪物（0x13）没有 */
  name?: string;
  skillState: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: number;
  pkLevel: number;
  created: boolean;
}

export interface MoveEvent {
  id: number;
  x: number;
  y: number;
  dir: number;
}

function readName(buf: Uint8Array, offset: number, len = 10) {
  let name = '';
  for (let i = 0; i < len; i++) {
    const c = buf[offset + i];
    if (!c) break;
    name += String.fromCharCode(c);
  }
  return name;
}

/** 0x12：玩家视野。返回 null 表示不是这个格式 */
export function parseViewportPlayers(pkt: Uint8Array): ViewportPlayer[] | null {
  if (pkt[0] !== 0xc2 && pkt[0] !== 0xc4) return null;
  const count = pkt[4];
  if (!count) return [];
  const body = pkt.length - 5;
  if (body % count !== 0 || body / count !== 32) return null;

  const out: ViewportPlayer[] = [];
  for (let i = 0; i < count; i++) {
    const o = 5 + i * 32;
    const created = (pkt[o] & 0x80) !== 0;
    out.push({
      id: ((pkt[o] & 0x7f) << 8) | pkt[o + 1],
      x: pkt[o + 2],
      y: pkt[o + 3],
      charSet: Array.from(pkt.subarray(o + 4, o + 15)),
      skillState: pkt[o + 16] | (pkt[o + 17] << 8),
      name: readName(pkt, o + 18),
      tx: pkt[o + 28],
      ty: pkt[o + 29],
      dir: (pkt[o + 30] >> 4) & 0x0f,
      pkLevel: pkt[o + 30] & 0x0f,
      created,
    });
  }
  return out;
}

/** 0x13：怪物视野 */
export function parseViewportMonsters(pkt: Uint8Array): ViewportMonster[] | null {
  if (pkt[0] !== 0xc2 && pkt[0] !== 0xc4) return null;
  const count = pkt[4];
  if (!count) return [];
  const body = pkt.length - 5;
  if (body % count !== 0 || body / count !== 12) return null;

  const out: ViewportMonster[] = [];
  for (let i = 0; i < count; i++) {
    const o = 5 + i * 12;
    out.push({
      id: ((pkt[o] & 0x7f) << 8) | pkt[o + 1],
      type: pkt[o + 2],
      skillState: pkt[o + 4] | (pkt[o + 5] << 8),
      x: pkt[o + 6],
      y: pkt[o + 7],
      tx: pkt[o + 8],
      ty: pkt[o + 9],
      dir: (pkt[o + 10] >> 4) & 0x0f,
      pkLevel: pkt[o + 10] & 0x0f,
      created: (pkt[o] & 0x80) !== 0,
    });
  }
  return out;
}

/**
 * 0x1F：召唤物视野（`GCViewportSummonSend`，`Viewport.cpp:790`）。
 *
 * 和 0x13 怪物视野**是两条独立的包**：召唤兽/机关类 NPC 走这条。
 * 之前没接，所以精灵召唤出来的宝宝在客户端根本不存在。
 *
 *   `C2 hi lo 1F [count] ( [index:BE16][type][pad][skillState:LE16]
 *                          [x][y][tx][ty][dirPk][name[10]] ) × count`
 *
 * 记录 22 字节（`PMSG_VIEWPORT_SUMMON` 没有 `#pragma pack`，`WORD ViewSkillState`
 * 前面插了 1 字节对齐洞）。
 */
export function parseViewportSummons(pkt: Uint8Array): ViewportMonster[] | null {
  if (pkt[0] !== 0xc2 && pkt[0] !== 0xc4) return null;
  if (pkt[3] !== 0x1f) return null;
  const count = pkt[4];
  if (!count) return [];
  const body = pkt.length - 5;
  if (body % count !== 0) return null;
  const stride = body / count;
  if (stride < 12) return null;

  const out: ViewportMonster[] = [];
  for (let i = 0; i < count; i++) {
    const o = 5 + i * stride;
    const name = stride >= 22 ? readName(pkt, o + 11) : '';
    out.push({
      id: ((pkt[o] & 0x7f) << 8) | pkt[o + 1],
      type: pkt[o + 2],
      skillState: pkt[o + 4] | (pkt[o + 5] << 8),
      x: pkt[o + 6],
      y: pkt[o + 7],
      tx: pkt[o + 8],
      ty: pkt[o + 9],
      dir: (pkt[o + 10] >> 4) & 0x0f,
      pkLevel: pkt[o + 10] & 0x0f,
      created: (pkt[o] & 0x80) !== 0,
      name,
    });
  }
  return out;
}

/**
 * 0x25：某个玩家的**单件装备**变了（`GCItemChangeSend`，`ItemManager.cpp:3236`）。
 *
 *   `C1 0A 25 [index:BE16] [ItemInfo[?]]`
 *
 * 服务端把 `ItemInfo[1]` 覆盖成 `slot*16 | LevelSmallConvert(level)`：
 *   - `ItemInfo[0]` = 物品类型的低 8 位，**0xFF 表示这个槽空了**
 *   - `ItemInfo[1] >> 4` = 装备槽（0..11），`& 0xF` = 强化等级
 *   - 类型的第 9 位在 `ItemInfo[3] & 0x80`（和地面物品同一套编码）
 *
 * 只发给**周围的人**（`MsgSendV2`），所以这里永远代表「别人换装了」。
 */
export interface ItemChangeEvent {
  id: number;
  slot: number;
  level: number;
  /** 完整物品类型（`group*32 + index`）；0xFF/空槽时为 -1 */
  type: number;
}

export function parseItemChange(pkt: Uint8Array): ItemChangeEvent | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 5 || pkt[hs] !== 0x25) return null;
  const id = (pkt[hs + 1] << 8) | pkt[hs + 2];
  const info0 = pkt[hs + 3];
  const info1 = pkt[hs + 4];
  const info3 = pkt[hs + 6] ?? 0;
  const slot = (info1 >> 4) & 0x0f;
  const level = info1 & 0x0f;
  if (info0 === 0xff) return { id, slot, level: 0, type: -1 };
  return { id, slot, level, type: (info3 & 0x80 ? 0x100 : 0) | info0 };
}

/**
 * 0x45：视角里有人**换了皮**（`GCViewportChangeSend`，`Viewport.cpp:962`）。
 *
 * 指环变身用：变身后服务端不再发 0x12，而是这条（同一套视野表 + 新的 skin）。
 *
 *   `C2 hi lo 45 [count] ( [index:BE16][x][y][skin][pad]
 *                          [skillState:LE16][name[10]][tx][ty][dirPk][CharSet[11]] ) × count`
 *
 * 记录 32 字节。`skin` != 0 时客户端要**把这条实体换成该怪物模型**。
 */
export interface ViewportChange {
  id: number;
  x: number;
  y: number;
  /** 变身成的怪物类型（0 = 变回人形） */
  skin: number;
  skillState: number;
  name: string;
  tx: number;
  ty: number;
  dir: number;
  pkLevel: number;
  charSet: number[];
  created: boolean;
}

export function parseViewportChanges(pkt: Uint8Array): ViewportChange[] | null {
  if (pkt[0] !== 0xc2 && pkt[0] !== 0xc4) return null;
  if (pkt[3] !== 0x45) return null;
  const count = pkt[4];
  if (!count) return [];
  const body = pkt.length - 5;
  if (body % count !== 0) return null;
  const stride = body / count;
  if (stride < 21) return null;

  const out: ViewportChange[] = [];
  for (let i = 0; i < count; i++) {
    const o = 5 + i * stride;
    out.push({
      id: ((pkt[o] & 0x7f) << 8) | pkt[o + 1],
      x: pkt[o + 2],
      y: pkt[o + 3],
      skin: pkt[o + 4],
      skillState: pkt[o + 6] | (pkt[o + 7] << 8),
      name: readName(pkt, o + 8),
      tx: pkt[o + 18],
      ty: pkt[o + 19],
      dir: (pkt[o + 20] >> 4) & 0x0f,
      pkLevel: pkt[o + 20] & 0x0f,
      charSet: stride >= 32 ? Array.from(pkt.subarray(o + 21, o + 32)) : [],
      created: (pkt[o] & 0x80) !== 0,
    });
  }
  return out;
}

/**
 * 0x46：地图属性变化（`GCMapAttrSend`，`Protocol.cpp:1759`）。
 *
 *   `C1 size 46 [type][attr][flag][count] ( [x][y][tx][ty] ) × count`
 *
 * 血色城堡/恶魔广场用它把一片区域改成「可传送 / 禁传送」。
 * `type` 是属性类别（`lpObj->MapAttr` 的那套），`attr` 是具体值，`flag` 1 = 设置 0 = 清除。
 */
export interface MapAttrChunk {
  type: number;
  attr: number;
  flag: number;
  cells: { x: number; y: number; tx: number; ty: number }[];
}

export function parseMapAttr(pkt: Uint8Array): MapAttrChunk | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 5 || pkt[hs] !== 0x46) return null;
  const type = pkt[hs + 1];
  const attr = pkt[hs + 2];
  const flag = pkt[hs + 3];
  const count = pkt[hs + 4];
  const cells: MapAttrChunk['cells'] = [];
  // type 0 = 矩形（每条 4 字节 x,y,tx,ty）；type 1 = 单格（每条 2 字节 x,y）
  const per = type === 0 ? 4 : 2;
  for (let i = 0; i < count; i++) {
    const o = hs + 5 + i * per;
    if (o + per - 1 >= pkt.length) break;
    cells.push({
      x: pkt[o],
      y: pkt[o + 1],
      tx: type === 0 ? pkt[o + 2] : pkt[o],
      ty: type === 0 ? pkt[o + 3] : pkt[o + 1],
    });
  }
  return { type, attr, flag, cells };
}

/** 0x0F 天气（`GCWeatherSend`，`Protocol.cpp:1588`）：`C1 04 0F [weather]` */
export function parseWeather(pkt: Uint8Array): number | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 2 || pkt[hs] !== 0x0f) return null;
  return pkt[hs + 1];
}

/**
 * 0x5A 视野里某个玩家的**战盟信息**（`GCViewportGuildInfoSend`，`Viewport.cpp:1062`）。
 *
 *   `C2 hi lo 5A [count] ( [index:BE16][GuildName[8]][Mark[32]] ) × count`
 *
 * `Mark` 就是 `packGuildMark` 那 32 字节（8×8 的 4bit/像素），和 0x5C 的格式一致。
 */
export interface ViewportGuildInfo {
  id: number;
  name: string;
  mark: Uint8Array;
}

export function parseViewportGuildInfo(pkt: Uint8Array): ViewportGuildInfo[] | null {
  if (pkt[0] !== 0xc2 && pkt[0] !== 0xc4) return null;
  if (pkt[3] !== 0x5a) return null;
  const count = pkt[4];
  if (!count) return [];
  const body = pkt.length - 5;
  if (body % count !== 0) return null;
  const stride = body / count;
  if (stride < 42) return null;

  const out: ViewportGuildInfo[] = [];
  for (let i = 0; i < count; i++) {
    const o = 5 + i * stride;
    out.push({
      id: (pkt[o] << 8) | pkt[o + 1],
      name: readName(pkt, o + 2, 8),
      mark: pkt.slice(o + 10, o + 42),
    });
  }
  return out;
}

/**
 * 0x5B 视野里「谁是哪个盟的」（`GCViewportGuildMemberSend`，`Viewport.cpp:1129`）。
 *
 *   `C2 hi lo 5B [count] ( [userIndex:BE16][guildIndex:BE16] ) × count`
 *
 * 只有编号，盟名/标志还得靠 0x5A（或 0x5C 成员表）补齐 —— 原版也是这么两级查的。
 */
export function parseViewportGuildMember(pkt: Uint8Array): { user: number; guild: number }[] | null {
  if (pkt[0] !== 0xc2 && pkt[0] !== 0xc4) return null;
  if (pkt[3] !== 0x5b) return null;
  const count = pkt[4];
  if (!count) return [];
  const out: { user: number; guild: number }[] = [];
  for (let i = 0; i < count; i++) {
    const o = 5 + i * 4;
    if (o + 3 >= pkt.length) break;
    out.push({ user: (pkt[o] << 8) | pkt[o + 1], guild: (pkt[o + 2] << 8) | pkt[o + 3] });
  }
  return out;
}

/**
 * 0x29 特殊物品计时（`GCItemUseSpecialTimeSend`，`Protocol.cpp:1739`）。
 *
 *   `C3 08 29 [number] [time:int32]`（`header.setE` → 加密）
 *
 * `number` 是物品类别（原版用它选提示文案），`time` 是**剩余秒数**。
 */
export function parseSpecialTime(pkt: Uint8Array): { number: number; time: number } | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 6 || pkt[hs] !== 0x29) return null;
  return { number: pkt[hs + 1], time: readU32(pkt, hs + 2) | 0 };
}

/**
 * 0x2C 果实结果（`PMSG_FRUIT_RESULT_SEND`，`Fruit.h:10`）。
 *
 *   `C1 size 2C [result] (GAMESERVER_EXTRA) [ViewValue][ViewPoint]
 *                                       [ViewStrength][ViewDexterity][ViewVitality][ViewEnergy]`
 *
 * `result & 0x3F`：0 = 成功、1 = 类型不对、3 = 失败（等级不够 / 到上限）。
 * 长包（28 字节）会带加完之后的四维，直接覆盖本地值最省事。
 */
export interface FruitResult {
  result: number;
  strength?: number;
  dexterity?: number;
  vitality?: number;
  energy?: number;
  point?: number;
}

export function parseFruitResult(pkt: Uint8Array): FruitResult | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 2 || pkt[hs] !== 0x2c) return null;
  const result = pkt[hs + 1] & 0x3f;
  const out: FruitResult = { result };
  if (pkt.length >= hs + 26) {
    const base = hs + 2;
    out.point = readU32(pkt, base + 4);
    out.strength = readU32(pkt, base + 8);
    out.dexterity = readU32(pkt, base + 12);
    out.vitality = readU32(pkt, base + 16);
    out.energy = readU32(pkt, base + 20);
  }
  return out;
}

/** 0x14：离开视野，返回实体 id 列表 */
export function parseViewportDestroy(pkt: Uint8Array): number[] {
  const count = pkt[3];
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const o = 4 + i * 2;
    if (o + 1 >= pkt.length) break;
    ids.push((pkt[o] << 8) | pkt[o + 1]);
  }
  return ids;
}

/**
 * 0x10：别人（或自己）的移动结果。
 *
 *   C1 08 10 [idHi] [idLo] x y dir
 *
 * 注意 `PROTOCOL_CODE1 = 0x10`（Protocol.h），0x11 是另一个包（位置强制同步）。
 * dir 是**整字节**，不是高 4 位 —— 那个格式只在上行 path[0] 里。
 */
export function parseMove(pkt: Uint8Array): MoveEvent {
  return {
    id: (pkt[3] << 8) | pkt[4],
    x: pkt[5],
    y: pkt[6],
    // 服务端 `pMsg.dir = lpObj->Dir << 4`（Protocol.cpp:1142），方向在**高 4 位**
    dir: pkt[7] >> 4,
  };
}

/** 0x11：位置强制同步（`PMSG_POSITION_SEND`）：C1 07 11 [idHi] [idLo] x y */
export function parsePosition(pkt: Uint8Array): { id: number; x: number; y: number } {
  return { id: (pkt[3] << 8) | pkt[4], x: pkt[5], y: pkt[6] };
}

/**
 * 上行移动包（`CGMoveRecv`）：
 *
 *   C1 0D 10 [x] [y] [dir<<4 | count] [步0<<4 | 步1] [步2<<4 | 步3] ...
 *
 * 服务端拆包规则（Protocol.cpp:1042）：
 *   PathCount = count + 1，PathX[0] = (x, y)
 *   n 从 1 起，每两步一个字节：**奇数步取高半字节，偶数步取低半字节**
 * 所以 count 是**步数**，不是节点数；8 步刚好占满 path[1..4]。
 */
export function buildMovePacket(
  x: number,
  y: number,
  dirs: number[]
): Uint8Array {
  const count = Math.min(dirs.length, 8);
  const pkt = new Uint8Array(3 + 2 + 8);
  pkt[0] = 0xc1;
  pkt[1] = pkt.length;
  // PROTOCOL_CODE1 = 0x10（CGMoveRecv），写成 0x11 会变成「±15 格瞬移」包
  pkt[2] = 0x10;
  pkt[3] = x & 0xff;
  pkt[4] = y & 0xff;

  // path[0] = 朝向 << 4 | 步数；path[1..] 才是真正的步序列（每字节两步，高半字节先）
  pkt[5] = ((dirs[0] ?? 0) << 4) | (count & 0x0f);
  for (let i = 0; i < count; i++) {
    const byteIndex = 6 + (i >> 1);
    if ((i & 1) === 0) {
      pkt[byteIndex] |= (dirs[i] & 0x0f) << 4;
    } else {
      pkt[byteIndex] |= dirs[i] & 0x0f;
    }
  }
  return pkt;
}

/** 从 (x0,y0) 到 (x1,y1) 的 8 方向步号 */
export function dirFromDelta(dx: number, dy: number) {
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  for (let d = 0; d < 8; d++) {
    if (DIR_VECTORS[d][0] === sx && DIR_VECTORS[d][1] === sy) return d;
  }
  return 0;
}

/** MU 的 dir（0..7）转成我们 three.js 里的 yaw */
export function yawFromDir(dir: number, yawOffset: number) {
  const [dx, dy] = DIR_VECTORS[dir & 7] ?? [1, 0];
  return Math.atan2(dy, dx) + yawOffset;
}

/* ------------------------------------------------------------------ */
/* 攻击链路                                                            */
/* ------------------------------------------------------------------ */

export interface DamageEvent {
  /** 被击中的实体 id */
  targetId: number;
  /** 伤害值（12 位） */
  damage: number;
  /** 伤害类型（damage[0] 高 4 位）：0 普通、1 暴击/额外 */
  type: number;
  /** 目标剩余 HP（GAMESERVER_EXTRA） */
  life: number;
  /** 目标是否已死（服务端用 bit7 标记） */
  flag: boolean;
}

/**
 * 下行 0x15 伤害包（`Protocol.cpp::GCDamageSend`）。
 *
 *   C1 0F 15 [idHi|flag<<7] [idLo] [dmgHi|type] [dmgLo] [curHP:4] [dmgHP:4]
 *
 * 注意它和上行攻击包是同一个 head（0x15），靠方向区分。
 */
export function parseDamage(pkt: Uint8Array): DamageEvent | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x15 || pkt.length < 7) return null;
  const hi = pkt[3];
  return {
    targetId: ((hi & 0x7f) << 8) | pkt[4],
    damage: ((pkt[5] & 0x0f) << 8) | pkt[6],
    type: pkt[5] & 0xf0,
    // 结构体：head(3) + index(2) + damage(2) + pad(1) + ViewCurHP(4) + ViewDamageHP(4) = 16
    life: pkt.length >= 16 ? readU32(pkt, 8) : -1,
    flag: (hi & 0x80) !== 0,
  };
}

/**
 * 上行攻击包（`Attack.cpp::CGAttackRecv`）：
 *   C1 07 15 [idHi] [idLo] [action] [dir]
 *
 * action 用玩家攻击动作编号（34 = ATTACK_FIST），服务端会原样广播给周围。
 */
export function buildAttackPacket(targetId: number, action: number, dir: number) {
  const pkt = new Uint8Array(7);
  pkt[0] = 0xc1;
  pkt[1] = 7;
  pkt[2] = 0x15;
  pkt[3] = (targetId >> 8) & 0xff;
  pkt[4] = targetId & 0xff;
  pkt[5] = action & 0xff;
  pkt[6] = dir & 0x0f;
  return pkt;
}

/**
 * 上行 `0x18` 动作包（坐下 / 倚靠 / 诺利亚浮空）。
 *
 * 服务端结构是 `PMSG_ACTION_RECV`（`MuServer_Source/GameServer/Protocol.h:55`）：
 *
 * ```c
 * struct PMSG_ACTION_RECV { PBMSG_HEAD header; BYTE dir; BYTE action; BYTE index[2]; };
 * ```
 *
 * 也就是 **dir 在 [3]、action 在 [4]**；`CGActionRecv`（`Protocol.cpp:842`）拿
 * `lpMsg->action` 去比 `ACTION_SIT1=108 / ACTION_POSE1=109 / ACTION_HEALING1=110`
 * （`User.h:93`），命中就设 `ViewState` 并广播 `0x18` 给视野里的人。
 *
 * ⚠️ 参考客户端 `Combat.cpp:2454` 拼的是 `[3]=0x01, [4]=heading, [5]=108` ——
 * 按上面这个结构读出来会是 `dir=1, action=heading(0..7)`，`ViewState` 永远设不上。
 * 那份反编译的字节序和 MuEmu 的收包结构对不上，这里以**服务端结构**为准。
 */
export function buildActionPacket(dir: number, action: number) {
  const pkt = new Uint8Array(6);
  pkt[0] = 0xc1;
  pkt[1] = 6;
  pkt[2] = 0x18;
  pkt[3] = dir & 0x0f;
  pkt[4] = action & 0xff;
  pkt[5] = 0;
  return pkt;
}

export interface ActionEvent {
  id: number;
  dir: number;
  action: number;
}

/** 下行 0x18 动作包：`C1 07 18 [idHi] [idLo] [dir] [action]` */
export function parseAction(pkt: Uint8Array): ActionEvent | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x18 || pkt.length < 7) return null;
  return {
    id: (pkt[3] << 8) | pkt[4],
    dir: pkt[5] & 0x0f,
    action: pkt[6],
  };
}

export interface DieEvent {
  id: number;
  /** 本次伤害 */
  damage: number;
  /** 获得的经验（0 表示不是自己打死的） */
  experience: number;
}

/**
 * 下行 0x9C 死亡/经验包（`GCMonsterDieSend`，`header.setE` → **C3**）。
 *
 *   C3 18 9C [idHi|flag<<7] [idLo] pad [exp:4] [damage:2] [curHP:4] [expNow:4] [expNext:4]
 *
 * 结构体没 pack，`WORD experience[2]` 前有 1 字节对齐填充。
 */
export function parseMonsterDie(pkt: Uint8Array): DieEvent | null {
  if (pkt[0] !== 0xc3 || pkt[2] !== 0x9c || pkt.length < 12) return null;
  return {
    id: ((pkt[3] & 0x7f) << 8) | pkt[4],
    // 服务端把 32 位经验拆成两个 WORD 存：experience[0]=高 16 位、[1]=低 16 位，
    // 直接当 DWORD 读会得到「低位左移 16 位」的错值（152 会变成 0x08980000）
    experience: ((pkt[6] | (pkt[7] << 8)) << 16) | (pkt[8] | (pkt[9] << 8)),
    damage: (pkt[10] << 8) | pkt[11],
  };
}

function readU32(buf: Uint8Array, o: number) {
  if (o + 3 >= buf.length) return 0;
  return (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
}

/** 有符号 32 位（`int` 字段，比如事件等级下限/上限） */
function readS32(buf: Uint8Array, o: number) {
  return readU32(buf, o) | 0;
}

/* ------------------------------------------------------------------ */
/* 地面物品（0x20 视野 / 0x22 拾取）                                   */
/* ------------------------------------------------------------------ */

/**
 * 一条地面物品。
 *
 * 服务端 `Viewport.cpp::GCViewportItemSend` 发的是 `PMSG_VIEWPORT_ITEM`：
 *
 *   index[2] + x + y + ItemInfo[5]   = 9 字节/条
 *
 * `ItemInfo` 由 `CItemManager::ItemByteConvert` 填：
 *   [0] item index 低 8 位
 *   [1] level<<3 | luck<<2 | skill<<7 | addOption&3
 *   [2] 耐久
 *   [3] bit7 = index 第 9 位（index≥256 时置位）| bit6 addOption>3 | 低 6 位卓越
 *   [4] 只有金币（14,15）用：buyMoney 的最低位
 *
 * 金币的数量是 24 位跨三个字节，顺序很反直觉（见下）。
 */
export interface GroundItem {
  /** 地图上的物品 id（服务端 `m_Item` 下标） */
  id: number;
  x: number;
  y: number;
  /** `group * 32 + index`，与客户端 `GET_ITEM` 完全一致 */
  type: number;
  /** 追加等级 `+N`（0..15，`(b1 >> 3) & 0x0F`） */
  level: number;
  /** 耐久 */
  durability: number;
  /** 追加属性 0..7（低 2 位 + `b3 & 0x40` 的第 3 位） */
  option: number;
  /** 卓越（`b3 & 0x3F`，就是卓越属性的位掩码） */
  excellent: boolean;
  /** 技能位（`b1 & 0x80`） */
  skill: boolean;
  /** 幸运位（`b1 & 0x04`） */
  luck: boolean;
  /** 是否金币（服务端用 GET_ITEM(14,15) 表示钱堆） */
  isMoney: boolean;
  /** 金币数量（仅 isMoney） */
  money: number;
}

/**
 * 0x20：视野内的地面物品。
 *
 * 头是 `PWMSG_HEAD`（C2 + 2 字节长度 + head），所以 count 在 `pkt[4]`，
 * 条目从 `pkt[5]` 起 —— 和 0x12 玩家视野同一个布局。
 */
export function parseViewportItems(pkt: Uint8Array): GroundItem[] | null {
  if (pkt[0] !== 0xc2 && pkt[0] !== 0xc4) return null;
  if (pkt.length < 5) return null;
  const count = pkt[4];
  if (!count) return [];
  const body = pkt.length - 5;
  if (body < count * 9) return null;

  const out: GroundItem[] = [];
  for (let i = 0; i < count; i++) {
    const o = 5 + i * 9;
    const hi = pkt[o];
    const info = pkt.subarray(o + 4, o + 9);
    const type = info[0] | ((info[3] & 0x80) ? 0x100 : 0);
    const isMoney = type === TYPE_MONEY;
    out.push({
      id: ((hi & 0x7f) << 8) | pkt[o + 1],
      x: pkt[o + 2],
      y: pkt[o + 3],
      type,
      level: (info[1] >> 3) & 0x0f,
      durability: info[2],
      option: (info[1] & 0x03) | ((info[3] & 0x40) ? 4 : 0),
      excellent: (info[3] & 0x3f) !== 0,
      // 和 `decodeItemInfo` 同一套位：b1 bit7 = 技能、bit2 = 幸运
      skill: (info[1] & 0x80) !== 0,
      luck: (info[1] & 0x04) !== 0,
      isMoney,
      // Viewport.cpp:926 —— 24 位分成 info[1](16-23)、info[2](8-15)、info[4](0-7)
      money: isMoney ? info[4] + ((info[2] + (info[1] << 8)) << 8) : 0,
    });
  }
  return out;
}

/** 金币在服务端的 item 编号：GET_ITEM(14,15) = 14*32+15 */
export const TYPE_MONEY = 14 * 32 + 15;

/** 0x22 拾取结果 */
export interface ItemGetResult {
  /** 0xFF 失败、0xFE 拾到金币、0xFD 叠加成功，其余是放进背包的槽位 */
  result: number;
  /** 服务端回显的物品（金币时是金额） */
  item: { type: number; level: number; durability: number } | null;
  /** 金币数量（仅 result === 0xFE） */
  money: number;
  ok: boolean;
}

/**
 * 下行 0x22 拾取结果（`pMsg.header.setE(0x22)` → **C3**）：
 *
 *   C3 09 22 [result] [ItemInfo[4]]
 *
 * result = 0xFE 时 `ItemInfo[0..3]` 是金币总额（大端）。
 */
export function parseItemGetResult(pkt: Uint8Array): ItemGetResult | null {
  if (pkt[0] !== 0xc3 || pkt[2] !== 0x22 || pkt.length < 8) return null;
  const result = pkt[3];
  if (result === 0xfe) {
    return {
      result,
      item: null,
      money: ((pkt[4] << 24) | (pkt[5] << 16) | (pkt[6] << 8) | pkt[7]) >>> 0,
      ok: true,
    };
  }
  const info = pkt.subarray(4, 8);
  return {
    result,
    item: {
      type: info[0] | ((info[3] & 0x80) ? 0x100 : 0),
      level: (info[1] >> 3) & 0x0f,
      durability: info[2],
    },
    money: 0,
    ok: result !== 0xff,
  };
}

/**
 * 上行拾取包（`CItemManager::CGItemGetRecv`）。
 *
 *   C3 05 22 [idHi] [idLo]
 *
 * **必须是 C3（加密）**，虽然 `PMSG_ITEM_GET_RECV` 在源码里写的是 `PBMSG_HEAD`。
 * 服务端 `HackPacketCheck` 的配置（`Data/Hack/HackPacketCheck.txt` 第 24 行
 * `22 * 0 0 0 0`）要求这一项 `Encrypt = 1`：发 C1 会被判
 * 「Packet encryption error (Index: 34)」直接 CloseClient ——
 * 表现是「发了拾取包，服务端一声不响，然后人掉线」。
 */
export function buildItemGetPacket(itemId: number): Uint8Array {
  const pkt = new Uint8Array(5);
  pkt[0] = 0xc3;
  pkt[1] = 5;
  pkt[2] = 0x22;
  pkt[3] = (itemId >> 8) & 0xff;
  pkt[4] = itemId & 0xff;
  return pkt;
}

/**
 * 0x21：物品离开视野（`Viewport.cpp::GCViewportDestroyItemSend`）。
 *
 * 它和 0x14（玩家/怪物离场）是**两个**包 —— 0x14 里不会带物品 id。
 * 结构跟 0x14 一样：PWMSG_HEAD + count + index[2]×N。
 */
export function parseViewportItemDestroy(pkt: Uint8Array): number[] {
  if (pkt[0] !== 0xc2 && pkt[0] !== 0xc4) return [];
  if (pkt.length < 5) return [];
  const count = pkt[4];
  const out: number[] = [];
  for (let i = 0; i < count && 5 + i * 2 + 1 < pkt.length; i++) {
    const o = 5 + i * 2;
    out.push((pkt[o] << 8) | pkt[o + 1]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 背包（0xF3/0x10）与物品移动（0x24）                                  */
/* ------------------------------------------------------------------ */

/** 背包里的一件东西。`slot` 与服务端 `CItemManager` 的槽位编号一致 */
export interface InventoryItem {
  /** 0..11 = 装备栏（0 武器 / 1 副手 / 2 头盔 / 3 铠甲 / 4 护腿 / 5 护手 / 6 战靴 / 7 翅膀 / 8 守护 / 9,10 戒指 / 11 项链）；12..75 = 8×8 背包格（cell = slot - 12） */
  slot: number;
  /** type = group * 32 + index */
  type: number;
  level: number;
  skill: boolean;
  luck: boolean;
  /** 追加等级 0..7 */
  option: number;
  durability: number;
  /** 卓越属性位掩码 */
  excellent: number;
}

/**
 * 服务端槽位布局（Item.h:3-4 + ItemManager.h:14-15）。
 *
 * 注意方向和我们直觉相反：`INVENTORY_WEAR_SIZE = 12` 且
 * `INVENTORY_WEAR_RANGE(x) = (x>=0 && x<12)`，也就是 **0..11 才是装备槽**，
 * **12..75 才是 8×8 背包**。`InventoryAddItem` 里
 * `x = (slot - 12) % 8; y = (slot - 12) / 8` 就是这条映射的直接证据。
 * 客户端把 `OffsetInventoryItems` 指向 `&Inventory[12]`，所以它眼里格子从 0 开始。
 */
export const INVENTORY_SIZE = 76;
/** 装备槽个数 / 背包起点 */
export const INVENTORY_WEAR_SIZE = 12;
/** 8×8 背包格数 */
export const INVENTORY_GRID = 64;

/**
 * 下行 0xF3/0x10 背包物品列表（`CItemManager::GCItemListSend`，ItemManager.cpp:3284）。
 *
 * 两种头都可能出现，**实测这台服务端发的是 C4 宽包**：
 *
 *   C4 sizeHi sizeLo F3 10 count  { slot, ItemInfo[4] } × count       ← 实测
 *   C3 size        F3 10 count  { ... }                                ← 源码里的 setE
 *
 * 源码 `pMsg.header.setE(0xF3,0x10,0)` 之后又硬写 `header.size[0]/[1]`，
 * 说明结构体用的是 `PWMSG_HEAD`（2 字节长度），所以发出来是 C4。
 * 两种布局只差一个字节，按类型算偏移即可。
 *
 * 条目固定 5 字节：`ItemByteConvert` 只写 4 字节（0.97 是精简版 `MAX_ITEM_INFO`），
 * 加上前面 1 字节槽位。一次遍历 0..75，所以装备栏（0..11）和背包（12..75）
 * 在同一个包里，不需要额外的装备列表报文。
 */
export function parseItemList(pkt: Uint8Array): InventoryItem[] | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  if (!wide && pkt[0] !== 0xc1 && pkt[0] !== 0xc3) return null;

  const headIdx = wide ? 3 : 2;
  if (pkt.length < headIdx + 3) return null;
  if (pkt[headIdx] !== 0xf3 || pkt[headIdx + 1] !== 0x10) return null;

  const countIdx = headIdx + 2;
  const count = pkt[countIdx];
  const start = countIdx + 1;
  if (pkt.length < start + count * 5) return null;

  const out: InventoryItem[] = [];
  for (let i = 0; i < count; i++) {
    const o = start + i * 5;
    out.push(decodeItemInfo(pkt[o], pkt[o + 1], pkt[o + 2], pkt[o + 3], pkt[o + 4]));
  }
  return out;
}

/**
 * 单件物品的 4 字节 `ItemByteConvert` 解码（`ItemManager.cpp:1498`）。
 *
 * 0xF3/0x10 的列表条目和 0xF3/0x14 的单格更新用的是同一套编码：
 *
 *   b0 = Index & 0xFF
 *   b1 = level<<3 | skill<<7 | luck<<2 | (option & 3)
 *   b2 = Durability
 *   b3 = (Index & 256)>>1 | (option>3 ? 0x40 : 0) | excellent
 */
function decodeItemInfo(
  slot: number,
  b0: number,
  b1: number,
  b2: number,
  b3: number
): InventoryItem {
  return {
    slot,
    // lpMsg[3] |= (m_Index & 256) >> 1 → 第 8 位落在 b3 的 bit7
    type: b0 | (b3 & 0x80 ? 0x100 : 0),
    level: (b1 >> 3) & 0x0f,
    skill: (b1 & 0x80) !== 0,
    luck: (b1 & 0x04) !== 0,
    option: (b1 & 0x03) | (b3 & 0x40 ? 4 : 0),
    durability: b2,
    excellent: b3 & 0x3f,
  };
}

/**
 * 下行 0xF3/0x14 单格物品更新（`CItemManager::GCItemModifySend`，ItemManager.cpp:3343）。
 *
 *   C1 09 F3 14 slot ItemInfo[4]
 *
 * 头是 **PSBMSG_HEAD（4 字节，带 subhead）**，所以 total = 4 + 1 + 4 = 9。
 * 服务端在「物品被改动」时只发这一条，不会重发整张表 —— `/make`、`/makeset`、
 * 耐久变化、追加等级变化全走它。之前完全没接，所以 GM 造出来的东西
 * 背包里看不到（服务端明明回了 `Item created`）。
 */
export function parseItemModify(pkt: Uint8Array): InventoryItem | null {
  const hs = pkt[0] === 0xc2 || pkt[0] === 0xc4 ? 3 : 2;
  if (pkt.length < hs + 7) return null;
  if (pkt[hs] !== 0xf3 || pkt[hs + 1] !== 0x14) return null;
  const slot = pkt[hs + 2];
  const o = hs + 3;
  return decodeItemInfo(slot, pkt[o], pkt[o + 1], pkt[o + 2], pkt[o + 3]);
}

/**
 * 上行 0x24 物品移动（`CItemManager::CGItemMoveRecv`，ItemManager.cpp:2513）。
 *
 *   C3 0C 24 [SourceFlag] [SourceSlot] [ItemInfo×4] [TargetFlag] [TargetSlot]
 *
 * 客户端源码里这条包走的是 `SendRequestEquipmentItem → Net_SendSmallPacket`，
 * 也就是 **C3**（加密通道），和 0x22 拾取同一个道理。
 * Flag：0 = 背包，1 = 交易，2 = 仓库。
 * 拖到装备栏也是 flag 0，靠 `TargetSlot`（64..75）区分。
 */
export function buildItemMovePacket(
  fromSlot: number,
  toSlot: number,
  itemInfo: { type: number; level: number; option: number; durability: number } = {
    type: 0,
    level: 0,
    option: 0,
    durability: 0,
  },
  /**
   * 来源/目标容器。0 = 背包（默认），1 = 交易窗，2 = 仓库。
   * 仓库存取就是「flag 2 ↔ flag 0」的搬运，包本身不变
   * （`CItemManager::CGItemMoveRecv` → `MoveItemToWarehouse/FromWarehouse`）。
   */
  flags: { from?: number; to?: number } = {}
): Uint8Array {
  // C3 是「小包」，头只有 3 字节（type/size/head），和 0x22 一致 → 总长 11
  const pkt = new Uint8Array(11);
  pkt[0] = 0xc3;
  pkt[1] = 11;
  pkt[2] = 0x24;
  pkt[3] = (flags.from ?? 0) & 0xff; // SourceFlag
  pkt[4] = fromSlot & 0xff;

  // ItemInfo：服务端只拿它做防作弊校验，按 ItemByteConvert 反着填就行
  const index = itemInfo.type & 0x1ff;
  pkt[5] = index & 0xff;
  pkt[6] = ((itemInfo.level & 0x0f) << 3) | (itemInfo.option & 0x03);
  pkt[7] = itemInfo.durability & 0xff;
  pkt[8] = ((index & 0x100) >> 1) | (itemInfo.option > 3 ? 0x40 : 0);

  pkt[9] = (flags.to ?? 0) & 0xff; // TargetFlag
  pkt[10] = toSlot & 0xff;
  return pkt;
}

/** 0x24 下行回执 */
export interface ItemMoveResult {
  /** 0xFF = 拒绝，其余是目标槽位 */
  result: number;
  slot: number;
  /** 目标格里的物品（失败时是 0xFF 填充） */
  item: { type: number; level: number; durability: number } | null;
  ok: boolean;
}

/**
 * 下行 0x24 移动回执（`pMsg.header.setE(0x24, sizeof(pMsg))` → C3）：
 *
 *   C3 size 24 [result] [slot] [ItemInfo[4]]
 *
 * `result` 是 `MoveItemToXxx` 的返回值：0xFF 表示失败，否则就是落点槽位。
 */
export function parseItemMoveResult(pkt: Uint8Array): ItemMoveResult | null {
  if (pkt[0] !== 0xc3 || pkt[2] !== 0x24 || pkt.length < 9) return null;
  const result = pkt[3];
  const slot = pkt[4];
  const info = pkt.subarray(5, 9);
  const ok = result !== 0xff;
  return {
    result,
    slot,
    item: ok
      ? {
          type: info[0] | ((info[3] & 0x80) ? 0x100 : 0),
          level: (info[1] >> 3) & 0x0f,
          durability: info[2],
        }
      : null,
    ok,
  };
}

/* ================================================================== */
/* NPC 对话 / 商店 / 仓库                                              */
/* ================================================================== */
/*
 * 服务端权威定义：
 *   MuServer_Source/GameServer/NpcTalk.cpp    CGNpcTalkRecv / GC 0x30 result
 *   MuServer_Source/GameServer/Shop.cpp       CShop::GCShopItemListSend   (0x31)
 *   MuServer_Source/GameServer/Warehouse.cpp  GCWarehouseListSend         (0x31)
 *   MuServer_Source/GameServer/ItemManager.cpp CGItemBuy/Sell/RepairRecv
 *
 * 关键结构事实（会直接影响解析）：
 *
 *   1. **商店列表和仓库列表是同一个报文 0x31**（Warehouse.cpp:270 直接复用了
 *      `PMSG_SHOP_ITEM_LIST_SEND`）。服务端靠 `Interface.type` 区分上下文，客户端
 *      也必须记住「这次 0x31 是商店还是仓库」——先收到 0x30 的 result 才有上下文。
 *   2. 0x30 的 result 语义**不是全局统一**的，而是每个 NPC 自己写：
 *        0 = 商店（后面会跟一条 0x31）
 *        2 = 仓库（后面跟 0x31 + 0x83 state）
 *        3 = 混沌合成机（后面跟 0xF3/0x10 背包）
 *        5 = 服务器传送菜单
 *        1/4/6 = 血色城堡 / 恶魔广场 / 黄金弓箭手各自的「不接受」原因
 *      所以这里只做「把 result 原样交给上层」，语义交由 UI 决定。
 *   3. 仓库格号同样是 8 列 × 15 行（`WAREHOUSE_SIZE / 8`），和商店一样是
 *      `8×15 = 120`；两者都是 `slot + ItemInfo[4]`，所以解析函数完全共用。
 */

/** NPC 对话时服务端回的 result 码（不同 NPC 语义不同，见上面注释） */
export const NPC_TALK = {
  SHOP: 0,
  WAREHOUSE: 2,
  CHAOS_MACHINE: 3,
  /** 恶魔广场入场（`NpcCharon` → `DevilSquare.cpp:1243`） */
  DEVIL_SQUARE: 4,
  SERVER_TRANSFER: 5,
  /** 血色城堡入场（`NpcAngelMessenger` → `BloodCastle.cpp:1704`） */
  BLOOD_CASTLE: 6,
} as const;

/**
 * 上行 0x30 与 NPC 对话（`CNpcTalk::CGNpcTalkRecv`）。
 *
 *   C3 05 30 [indexHi] [indexLo]
 *
 * **必须是 C3**：`Data/Hack/HackPacketCheck.txt` 第 32 行 `30 * 1 …`
 * 的 Encrypt = 1，发 C1 会被 `CHackPacketCheck::CheckPacketHack` 判
 * 「encryption error」直接踢下线（和 0x22 拾取、0x24 移动同一个坑）。
 *
 * 服务端还会校验：NPC 类型是 OBJECT_NPC、同地图、玩家与 NPC 的 X/Y 距离 ≤ 5 格，
 * 任一不满足就**静默丢弃**（不回任何包）。所以太远时客户端要先走过去。
 */
export function buildNpcTalkPacket(npcId: number): Uint8Array {
  return new Uint8Array([0xc3, 5, 0x30, (npcId >> 8) & 0xff, npcId & 0xff]);
}

/** 上行 0x31 关闭 NPC 界面（`CGNpcTalkCloseRecv` → 关商店/仓库/交易） */
export function buildNpcClosePacket(): Uint8Array {
  return new Uint8Array([0xc1, 3, 0x31]);
}

/**
 * 上行 `0xF3 0x12` 视野加载完成（`CGCharacterMoveViewportEnableRecv`）。
 *
 *   `C1 04 F3 12`
 *
 * **这条包不发，角色会「假死」**：服务端每次 `gObjMoveGate` / `gObjTeleport`
 * 之后都会 `RegenOk = 1`（User.cpp:1964 / 1991 / 2052），然后**等客户端回这条**
 * 才推进 `RegenOk 1 → 2 → 3 → 0`（Protocol.cpp:1448 + ObjectManager.cpp:167/204）。
 * `RegenOk != 0` 期间：
 *   - `CGItemMoveRecv`（0x24）**一律回 result=0xFF**（ItemManager.cpp:2539）
 *   - 服务端不重建视野 → 0x12 一个都不发，客户端看到的 NPC/怪物全消失
 * 表现就是「传送完人站在 NPC 旁边，但点什么都失败、视野是空的」。
 *
 * 0.97 原版在 `Net_Process.cpp` 里是「进图/换图后立刻发」，本 port 在
 * `loadWorld` 收尾处发（登录进图和 0x1C 换图共用那条路径）。
 */
export function buildViewportEnablePacket(): Uint8Array {
  return new Uint8Array([0xc1, 4, 0xf3, 0x12]);
}

export interface NpcTalkReply {
  result: number;
  /** `BYTE level[7]`：各 NPC 自用（恶魔广场发入场等级区间之类），多数情况全 0 */
  levels: number[];
}

/** 下行 0x30（C3，`PBMSG_HEAD + result + level[7]` = 11 字节） */
export function parseNpcTalk(pkt: Uint8Array): NpcTalkReply | null {
  if (pkt[0] !== 0xc3 || pkt.length < 5 || pkt[2] !== 0x30) return null;
  return {
    result: pkt[3],
    levels: Array.from(pkt.subarray(4, Math.min(pkt.length, 11))),
  };
}

export interface ContainerList {
  /** 报文里的 type 字段（0.97 的服务端固定填 0） */
  type: number;
  /** 物品条目，`slot` 是容器格号（0..119） */
  items: InventoryItem[];
}

/**
 * 下行 0x31 商品 / 仓库列表（C2 宽包）：
 *
 *   C2 sizeHi sizeLo 31 type count { slot, ItemInfo[4] } × count
 *
 * 条目 5 字节，和 0xF3/0x10 背包列表同一套 `ItemByteConvert` 编码。
 * 空容器时服务端只发 `C2 00 06 31 00 00`（count = 0）。
 */
export function parseContainerList(pkt: Uint8Array): ContainerList | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 3 || pkt[hs] !== 0x31) return null;

  const type = pkt[hs + 1];
  const count = pkt[hs + 2];
  const start = hs + 3;
  if (pkt.length < start + count * 5) return null;

  const items: InventoryItem[] = [];
  for (let i = 0; i < count; i++) {
    const o = start + i * 5;
    items.push(decodeItemInfo(pkt[o], pkt[o + 1], pkt[o + 2], pkt[o + 3], pkt[o + 4]));
  }
  return { type, items };
}

/**
 * 上行 0x2B 拆分堆叠（`CItemManager::CGItemStackUnstackRecv`，ItemManager.cpp:2811）。
 *
 *   C1 06 2B 00 [SourceSlot] [Count]
 *
 * `PSBMSG_HEAD` 是 **4 字节**（type/size/head/subh），`subh` 固定 0，
 * 所以 SourceSlot 在偏移 4。`HackPacketCheck` 第 43 行 Encrypt=0 → 用 **C1**。
 *
 * 服务端的硬性条件（任一不满足就静默 return）：
 *   - 该格有物品，且 `Durability > Count`（不能把整堆拆完）；
 *   - `Count < GetItemMaxStack(...)`；
 *   - 每拆 1 个都要 `InventoryInsertItem` 成功（背包有空位）。
 * 成功后服务端会 `GCItemListSend` 重发整张背包表（0xF3/0x10），
 * 客户端**不需要**自己改本地快照。
 */
export function buildUnstackPacket(slot: number, count: number): Uint8Array {
  return new Uint8Array([0xc1, 6, 0x2b, 0, slot & 0xff, count & 0xff]);
}

/**
 * 上行 0x32 购买（`slot` 是**商店格号**，不是背包槽位）。
 *
 * 全部走 C3 —— `Data/Hack/HackPacketCheck.txt` 的**第一列是十进制**包号
 * （`50 * 1` 就是 0x32 要求加密），这一条差点踩死：发 C1 会被
 * `CheckPacketHack` 判 encryption error 并 **CloseClient**，
 * 表现是「点了买没反应，然后人掉线」。
 */
export function buildBuyPacket(slot: number): Uint8Array {
  return new Uint8Array([0xc3, 4, 0x32, slot & 0xff]);
}

/** 上行 0x33 出售（`slot` 是**背包槽位** 0..75；同样要求 C3，见 51 行） */
export function buildSellPacket(slot: number): Uint8Array {
  return new Uint8Array([0xc3, 4, 0x33, slot & 0xff]);
}

/**
 * 上行 0x34 修理（`CGItemRepairRecv`，`ItemManager.cpp:3161`）。要求 C3
 * （HackPacketCheck 第 36 行 Encrypt=1）。
 *
 * **`type` 不是「单件/全部」的开关** —— 这个语义以前写错，代价很直接：
 *
 *   - 「全部修理」必须发 **`slot = 0xFF`**（`if (lpMsg->slot == 0xFF)` 才是全修）；
 *   - `type` 是 **auto-repair 标志**（0 = 找 NPC 修、1 = 自己修），而且
 *     `GetItemRepairMoney` 里 `type == 1` 的价格是 **×2.5**
 *     （`RepairItem` 第 403 行），`CGItemRepairRecv` 还额外要求 `Level >= 50`。
 *
 * 以前发的是 `slot=0, type=1`：只修**武器槽**、价格翻 2.5 倍、
 * 等级不够时服务端一声不响地丢掉。玩家看到的「点一下全部修理，钱全没了」
 * 就是这么来的 —— 修的确确实实只有一把武器，但按 2.5 倍收。
 */
export function buildRepairPacket(slot: number, type = 0): Uint8Array {
  return new Uint8Array([0xc3, 5, 0x34, slot & 0xff, type & 0xff]);
}

/** 全部修理的槽位标记（`Inventory** == 0xFF` → 逐件修 0..11 的装备） */
export const REPAIR_ALL_SLOT = 0xff;

/** 上行 0x23 丢弃（服务端把物品扔到玩家脚边；C3，见 HackPacketCheck 第 35 行） */
export function buildDropPacket(x: number, y: number, slot: number): Uint8Array {
  return new Uint8Array([0xc3, 6, 0x23, x & 0xff, y & 0xff, slot & 0xff]);
}

export interface TradeReply {
  ok: boolean;
  /** 购买成功时回的是**新增的那件物品**（背包槽位由 0xF3/0x10 或 0xF3/0x14 补） */
  item: InventoryItem | null;
  /** 出售/修理回的钱 */
  money: number;
  result: number;
}

/**
 * 下行 0x32 购买回执：
 *
 *   C1 09 32 result ItemInfo[4]
 *
 * `result` 的语义**不是布尔**（`ItemManager.cpp:3053`）：
 *   - `0xFF` = 失败（但**药水叠加成功时也是 0xFF**，见下面的坑）
 *   - 其余   = `InventoryInsertItem` 返回的**落点背包槽位**（0..75）
 *
 * 两个必须注意的点：
 *   1. 成功时服务端**不发背包列表**，只回这一件物品 + 槽位，
 *      客户端要自己 `InsertInventoryItem(slot, ItemInfo)`（原版 `case 0x32` 就是这么干的）。
 *   2. `InventoryInsertItemStack` 分支（买药水叠到已有堆叠）先 `GCMoneySend` 再回
 *      **result=0xFF + ItemInfo 全 0**，看起来和失败一模一样 ——
 *      区分办法是「金币包 0x22/0xFE 刚刚到过」，见 main.ts 的 0x32 分支。
 */
export function parseBuyResult(pkt: Uint8Array): TradeReply | null {
  // 总长 8 = PBMSG_HEAD(3) + result(1) + ItemInfo[4]（sizeof(PMSG_ITEM_BUY_SEND)）
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x32 || pkt.length < 8) return null;
  const result = pkt[3];
  const ok = result !== 0xff;
  return {
    ok,
    result,
    money: 0,
    // 槽位就是 result 本身（原版 InsertInventoryItem 的第一个参数）
    item: ok ? decodeItemInfo(result, pkt[4], pkt[5], pkt[6], pkt[7]) : null,
  };
}

/** 下行 0x33 出售回执：`C1 08 33 result money[4 LE]` */
export function parseSellResult(pkt: Uint8Array): TradeReply | null {
  // `PMSG_ITEM_SELL_SEND` = header(3) + result(1) + DWORD money，同样因为
  // `ItemManager.h` 没 pack(1) 而对齐：money 在 +4（result 刚好填掉那个洞）。
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x33 || pkt.length < 8) return null;
  const result = pkt[3];
  return {
    ok: result !== 0,
    result,
    item: null,
    money: readU32(pkt, 4),
  };
}

/** 下行 0x34 修理回执：`C1 07 34 money[4 LE]`（没有 result 字段，钱 = 0 就是没修） */
/**
 * 下行 0x34 修理回执（`PMSG_ITEM_REPAIR_SEND`）：只剩多少钱。
 *
 * **`money` 在 +4，不是 +3** —— `ItemManager.h` 里这一整段结构体都没有
 * `#pragma pack(1)`，`PBMSG_HEAD` 是 3 字节、后面接 `DWORD`，MSVC 会插
 * 1 个对齐字节，所以发出来是 8 字节，`money` 从 +4 起。
 *
 * 按 +3 读的后果很直观：钱的低 3 字节左移 8 位再补一个脏字节，
 * 4586 万会显示成 **31 亿**（`0x02BBE57A` → `0xBBE57A00`）。
 * 玩家看到的就是「修一次钱暴涨/清零」，两种方向都出现过。
 *
 * 兼容 packed 实现（7 字节、money 在 +3）：按长度判断。
 */
export function parseRepairResult(pkt: Uint8Array): number | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x34 || pkt.length < 7) return null;
  const offset = pkt.length >= 8 ? 4 : 3;
  return readU32(pkt, offset);
}

/**
 * 上行 0x26 使用物品（喝药、吃卷轴、双击装备）：
 *   `C3 05 26 SourceSlot TargetSlot`
 *
 * `TargetSlot` 一般是 0xFF（「对自己用」）；只有「对某件物品使用」时才填目标。
 * 要求 C3（HackPacketCheck 第 38 行 Encrypt=1）。
 */
export function buildItemUsePacket(sourceSlot: number, targetSlot = 0xff): Uint8Array {
  return new Uint8Array([0xc3, 5, 0x26, sourceSlot & 0xff, targetSlot & 0xff]);
}

/**
 * 下行 0x23 丢弃回执：`C1 05 23 result slot`
 *
 * `result` 默认 0（失败）、成功置 **1**（`ItemManager.cpp:2505` `pMsg.result = 1`），
 * 别按「0 = 成功」写 —— 反了会把成功全当失败。
 */
export function parseDropResult(pkt: Uint8Array): { ok: boolean; slot: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x23 || pkt.length < 5) return null;
  return { ok: pkt[3] !== 0, slot: pkt[4] };
}

/* ---------------------------- 仓库 ---------------------------- */

export interface WarehouseMoney {
  result: number;
  /** 仓库里的存款 */
  warehouse: number;
  /** 身上的金币 */
  inventory: number;
}

/**
 * 下行 0x81 仓库金币（`CWarehouse::GCWarehouseMoneySend`）：
 *   `C1 09 81 result warehouseMoney[4] inventoryMoney[4]`
 */
export function parseWarehouseMoney(pkt: Uint8Array): WarehouseMoney | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x81 || pkt.length < 12) return null;
  return { result: pkt[3], warehouse: readU32(pkt, 4), inventory: readU32(pkt, 8) };
}

/**
 * 上行 0x81 存/取金币（`CGWarehouseMoneyRecv`）：
 *   `C1 08 81 type money[4 LE]`，type 0 = 存入，1 = 取出
 *
 * 长度是 8（`sizeof(PMSG_WAREHOUSE_MONEY_RECV)` = 3 + 1 + 4），
 * 别按 9 写 —— 服务端 `PacketManager` 会校验 size，多一字节整包丢弃。
 */
export function buildWarehouseMoneyPacket(type: number, money: number): Uint8Array {
  const pkt = new Uint8Array(8);
  pkt[0] = 0xc1;
  pkt[1] = 8;
  pkt[2] = 0x81;
  pkt[3] = type & 0xff;
  pkt[4] = money & 0xff;
  pkt[5] = (money >> 8) & 0xff;
  pkt[6] = (money >> 16) & 0xff;
  pkt[7] = (money >> 24) & 0xff;
  return pkt;
}

/** 上行 0x82 关闭仓库（`C1 03 82`；服务端会保存并回一条同码 0x82） */
export function buildWarehouseClosePacket(): Uint8Array {
  return new Uint8Array([0xc1, 3, 0x82]);
}

/**
 * 下行 0x83 仓库密码/状态（`CWarehouse::GCWarehouseStateSend`）：`C1 04 83 state`
 *
 *   0  未设密码   1  需要密码   10 密码错误   12 已解锁   13 个人码错误
 */
export function parseWarehouseState(pkt: Uint8Array): number | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x83 || pkt.length < 4) return null;
  return pkt[3];
}

/**
 * 上行 0x83 仓库密码（`CGWarehousePasswordRecv`）：
 *   `C3 10 83 type password[2 LE] personalCode[10]`
 *
 * type 0 = 用密码解锁（此时 personalCode 全 0）
 * type 1 = 设置新密码（需要个人码 7 位）
 * 要求 C3（HackPacketCheck 第 131 行 Encrypt=1）。
 */
export function buildWarehousePasswordPacket(
  type: number,
  password: number,
  personalCode = ''
): Uint8Array {
  const pkt = new Uint8Array(16);
  pkt[0] = 0xc3;
  pkt[1] = 16;
  pkt[2] = 0x83;
  pkt[3] = type & 0xff;
  pkt[4] = password & 0xff;
  pkt[5] = (password >> 8) & 0xff;
  const code = personalCode.slice(0, 10);
  for (let i = 0; i < code.length; i++) pkt[6 + i] = code.charCodeAt(i) & 0xff;
  return pkt;
}

/* ================================================================== */
/* 联机技能广播（0x19）与事件时间（0xF3/0xE6）                        */
/* ================================================================== */

/**
 * 下行 0x19 技能广播（`CSkillManager::GCSkillAttackSend`，SkillManager.cpp:2124）。
 *
 *   C3 08 19 [skill] [casterHi] [casterLo] [targetHi|type*0x80] [targetLo]
 *
 * 三条容易搞错的语义：
 *   1. `skill` 是**技能号**（= `skill.bmd` 下标 = 上行包里的技能号），不是「特效类型」。
 *      客户端源码 `Combat/Skills.cpp` 那张 type 表描述的是同一个字节的另一批取值
 *      （1/17 = 弓箭远程普攻，48 = 生命之光…），两种解释并存，所以这里原样交给上层。
 *   2. `target` 高字节的 **bit7 是「命中成功」标志**，不是 PvP 标记 ——
 *      服务端写的是 `pMsg.target[0] = SET_NUMBERHB(aIndex) | (type * 0x80)`，
 *      `type` 由调用方传（1 = 命中）。所以取 id 要先 `& 0x7F`。
 *   3. 服务端 `DataSend(lpObj->Index, …)` **会给自己也发一份**，本地施法时已经播过
 *      动作和特效，处理时必须跳过 `casterId === selfId`，否则会双播。
 *
 * 包长 8 字节（`sizeof(PMSG_SKILL_ATTACK_SEND)` = 3 + 1 + 2 + 2），
 * 原版反编译注释里提到的 damage 两字节在这个 MuEmu 版本里没有（伤害走 0x15）。
 */
export interface SkillCastEvent {
  skill: number;
  casterId: number;
  /** 0 = 无目标（群攻/自身 buff） */
  targetId: number;
  /** target 高字节 bit7 */
  success: boolean;
  /**
   * 0x1E 专属：技能的**落点格号**。绝大多数持续技能（5 火焰 / 8 龙卷风 /
   * 10 地狱火 / 14 烈火 / 12 冰封…）没有目标实体，只有一块「打哪儿」的格子，
   * 客户端要靠它把特效放对位置。
   */
  x?: number;
  y?: number;
  /** 0x1E 专属：朝向，`0..255` 对应 **0..360°**（源码 `dir = angle * 255/360`） */
  dir?: number;
}

/**
 * 上行 0x19 施放技能（`CSkillManager::CGSkillAttackRecv`，SkillManager.cpp:1907）。
 *
 *   C3 06 19 [skill] [targetHi] [targetLo]
 *
 * 注意 `index` 字段装的是**目标**索引（不是自己）。服务端的硬性条件：
 *   - 目标必须存在、活着、已连接；
 *   - **施法者与目标都不能站在安全区**（`CheckAttr(x,y,1) != 0` 直接 return），
 *     所以在城里按技能会「毫无反应」，那是服务端拒绝了，不是包没发出去；
 *   - 后面还有技能等级 / 魔法 / BP / 冷却等校验（同一函数下半段）。
 *
 * 要求 C3（HackPacketCheck 第 25 行 Encrypt=1）。
 */
export function buildSkillAttackPacket(skill: number, targetId: number): Uint8Array {
  return new Uint8Array([
    0xc3,
    6,
    0x19,
    skill & 0xff,
    (targetId >> 8) & 0xff,
    targetId & 0xff,
  ]);
}

/**
 * 0x1E「持续技能」清单 —— `Combat.cpp` 里所有调用
 * `Combat_SendDuration1E_97k` 的 case：
 *
 *   5 Flame / 8 Twister / 9 Evil Spirit / 10 Hell Fire / 12 Aqua Beam /
 *   14 Inferno / 41 Twisting Slash / 42 Rageful Blast / 52 Triple Shot /
 *   55 Death Stab / 56 (Death Stab 第二段)
 *
 * 这些技能**不能发 0x19**：服务端 `CGSkillAttackRecv` 走的是
 * `UseAttackSkill`（单体普攻），而它们要的是 `UseDurationSkillAttack`
 * （区块/多段判定）。发错了表现就是「技能放出去了，伤害按普攻打」。
 */
export const DURATION_SKILLS = new Set([5, 8, 9, 10, 12, 14, 41, 42, 52, 55, 56]);

/**
 * 上行 0x1E 持续技能（`PMSG_DURATION_SKILL_ATTACK_RECV`，C3，**11 字节**）。
 *
 *   `C3 0B 1E [skill][x][y][dir][dis][angle][idxHi][idxLo]`
 *
 * 三个反直觉的点（全部来自 `Combat.cpp:1770` 那段注释）：
 *
 *   1. **目标索引是 big-endian**（`idxHi` 在前）—— 服务端用
 *      `MAKE_NUMBERW(index[0], index[1])` 还原，和 0x19 的 `target` 一致。
 *   2. **`dis` / `angle` 只有 55/56 用得上**（`Attack_PackDestination` 的
 *      打包偏移、以及 `(angle+180)/360*255`）；其它技能发 0。
 *   3. 0.97 原版客户端只发 9 字节且**不带目标索引**，服务端会从包外读
 *      `index[2]` → 打出「另一个怪物莫名掉血」。这里必须发满 11 字节。
 */
export function buildDurationSkillAttackPacket(
  skill: number,
  x: number,
  y: number,
  dir: number,
  dis: number,
  angle: number,
  targetId: number
): Uint8Array {
  return new Uint8Array([
    0xc3,
    11,
    0x1e,
    skill & 0xff,
    x & 0xff,
    y & 0xff,
    dir & 0xff,
    dis & 0xff,
    angle & 0xff,
    (targetId >> 8) & 0xff,
    targetId & 0xff,
  ]);
}

/**
 * 下行 0x1E：别人（或自己）放持续技能（`GCDurationSkillAttackSend`）。
 *
 *   `C3 09 1E [skill][idxHi][idxLo][x][y][dir]`
 *
 * 注意和上行**字段顺序不同**：下行是 `skill, index, x, y, dir`，
 * 上行是 `skill, x, y, dir, dis, angle, index`。
 */
export function parseDurationSkillCast(pkt: Uint8Array): SkillCastEvent | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 7 || pkt[hs] !== 0x1e) return null;
  const skill = pkt[hs + 1];
  const casterId = (pkt[hs + 2] << 8) | pkt[hs + 3];
  return {
    skill,
    casterId,
    targetId: 0,
    success: true,
    x: pkt[hs + 4],
    y: pkt[hs + 5],
    dir: pkt[hs + 6],
  };
}

/**
 * 上行 0x1D 多目标技能（`PMSG_MULTI_SKILL_ATTACK_RECV`，C3）。
 *
 *   `C3 [size] 1D [skill][x][y][serial][count] ( [idxHi][idxLo] )×count`
 *
 * 大小 = `8 + count * 2`（包头 3 + 5 个字段 + 每个目标 2 字节）。
 *
 * **这条必须跟在 0x1E 后面**：服务端 `CGMultiSkillAttackRecv` 里
 *   `if (MultiSkillIndex == 0 || MultiSkillIndex != skill || MultiSkillCount++ >= 5) return;`
 * —— `MultiSkillIndex` 只有 `UseDurationSkillAttack` 会设（`SkillManager.cpp:955`），
 * 也就是「先发 0x1E 开技能，再用 0x1D 报最多 5 批、每批最多 5 个目标」。
 * 单独发 0x1D 一定被丢。
 *
 * 允许的技能（服务端白名单）：5 火焰 / 8 龙卷风 / 9 恶魔之眼 / 10 地狱火 /
 * 12 冰封 / 14 烈火 / 41 旋风斩 / 42 狂暴斩 / 52 三连射 / 55 致命一击 /
 * 穿甲 / 穿刺 / 火焰斩 / 怪物群攻。
 *
 * `serial` 服务端完全不读（保留字段），发 0 即可。
 * **目标索引是 big-endian**，和 0x19 / 0x1E 一致（不是 0xB0 的 little-endian）。
 */
export function buildMultiSkillAttackPacket(
  skill: number,
  x: number,
  y: number,
  serial: number,
  targets: number[]
): Uint8Array {
  const ids = targets.slice(0, 5);
  const pkt = new Uint8Array(8 + ids.length * 2);
  pkt[0] = 0xc3;
  pkt[1] = pkt.length;
  pkt[2] = 0x1d;
  pkt[3] = skill & 0xff;
  pkt[4] = x & 0xff;
  pkt[5] = y & 0xff;
  pkt[6] = serial & 0xff;
  pkt[7] = ids.length;
  ids.forEach((id, i) => {
    pkt[8 + i * 2] = (id >> 8) & 0xff;
    pkt[9 + i * 2] = id & 0xff;
  });
  return pkt;
}

/**
 * 上行 0x1B 取消技能效果（`PMSG_SKILL_CANCEL_RECV`，C3，6 字节）。
 *
 *   `C3 06 1B [skill][idxHi][idxLo]`
 *
 * 服务端只做 `gEffectManager.DelEffect(lpObj, GetSkillEffect(skill))`。
 * **0.97 原版客户端从不发它**（只收），这里留着是为了以后做 buff 条时能用。
 */
export function buildSkillCancelPacket(skill: number, index: number): Uint8Array {
  return new Uint8Array([0xc3, 6, 0x1b, skill & 0xff, (index >> 8) & 0xff, index & 0xff]);
}

/**
 * 下行 0x1B：某人的技能效果没了（`GCSkillCancelSend`，**C1**，6 字节）。
 *
 *   `C1 06 1B [skill][idxHi][idxLo]`
 */
export function parseSkillCancel(
  pkt: Uint8Array
): { skill: number; index: number } | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 4 || pkt[hs] !== 0x1b) return null;
  return { skill: pkt[hs + 1], index: (pkt[hs + 2] << 8) | pkt[hs + 3] };
}

/**
 * 上行 0xB0 队友传送（`PMSG_SKILL_TELEPORT_ALLY_RECV`，7 字节）。
 *
 *   `C3 07 B0 [idxLo][idxHi][x][y]`
 *
 * 两个坑：
 *
 *   1. **必须是 C3**。结构体写的是 `PBMSG_HEAD`，0.97 客户端也真的按 C1 发
 *      （`Combat.cpp:1755`），但 `HackPacketCheck.txt` 第 176 行 0xB0 的
 *      Encrypt 列是 **1** —— 服务端只认 C3，发 C1 会直接 `CloseClient`
 *      （探针第一次跑就是这么被踢的：之后所有发包都失败）。
 *   2. **索引是 little-endian**（`idxLo` 在前）。这个结构体在
 *      `SkillManager.h:110` 被 `#pragma pack(1)` 包着、字段是原生 `WORD`，
 *      和 0x19/0x1E 的 big-endian `index[2]` **正好相反**。
 *
 * 服务端校验：双方必须同队、同图、目标格可传送、自己有 `SKILL_TELEPORT_ALLY`
 * 且蓝/AG 够。任一条不过就静默丢弃（不会断线）。
 */
export function buildTeleportAllyPacket(index: number, x: number, y: number): Uint8Array {
  return new Uint8Array([
    0xc3,
    7,
    0xb0,
    index & 0xff,
    (index >> 8) & 0xff,
    x & 0xff,
    y & 0xff,
  ]);
}

export function parseSkillCast(pkt: Uint8Array): SkillCastEvent | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 6 || pkt[hs] !== 0x19) return null;

  const skill = pkt[hs + 1];
  const casterId = (pkt[hs + 2] << 8) | pkt[hs + 3];
  const t0 = pkt[hs + 4];
  return {
    skill,
    casterId,
    targetId: ((t0 & 0x7f) << 8) | pkt[hs + 5],
    success: (t0 & 0x80) !== 0,
  };
}

/* ------------------------------------------------------------------ */
/* 0xF3/0x11 技能列表                                                  */
/* ------------------------------------------------------------------ */

/** 一个「已学会」的技能：服务端技能数组里的槽位 + 技能号 + 等级 */
export interface SkillListEntry {
  /** 服务端 `lpObj->Skill[]` 下标（0..MAX_SKILL_LIST-1 = 59），也是客户端的快捷槽 */
  slot: number;
  /** 技能号（= `skill.bmd` 下标，1..56） */
  skill: number;
  /** 技能等级（0..3，`level = (m_level << 3) | (m_index & 7)` 的高 5 位） */
  level: number;
}

export interface SkillListReply {
  /** `list` = 整表（登录/进图）；`add` / `del` = 增量（学/删一个技能） */
  mode: 'list' | 'add' | 'del';
  entries: SkillListEntry[];
}

/**
 * 下行 0xF3/0x11 技能列表（`CSkillManager::GCSkillListSend` / `GCSkillAddSend` /
 * `GCSkillDelSend`，`SkillManager.cpp:2200/2231/2262`）。
 *
 *   `C1 size F3 11 [count] ([slot][skill][level])×count`
 *
 * `count` 有**三种语义**，这是最容易踩的坑 —— 服务端把「整表」和「增量」
 * 塞进了同一个包结构：
 *
 *   - `count == 0xFE` → **学会一个技能**（包体仍带 1 条）
 *   - `count == 0xFF` → **遗忘一个技能**（包体仍带 1 条，`skill` 是旧值）
 *   - 其余 = 条数 → 整表（进图时 0..20 条）
 *
 * 0.97 客户端原来把 0xFE/0xFF 当成「超大整表」直接 `count > 20` 丢掉，
 * 结果「学了新技能卷轴，要重新登录才看得见」。这里按三种语义分开。
 *
 * `level` 字节是打包的：`(m_level << 3) | (m_index & 7)` —— 低 3 位是技能号
 * 自身的余数（冗余信息），高 5 位才是等级。
 */
export function parseSkillList(pkt: Uint8Array): SkillListReply | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 3 || pkt[hs] !== 0xf3 || pkt[hs + 1] !== 0x11) return null;

  const count = pkt[hs + 2];
  const mode: SkillListReply['mode'] = count === 0xfe ? 'add' : count === 0xff ? 'del' : 'list';
  const n = mode === 'list' ? count : 1;

  const entries: SkillListEntry[] = [];
  for (let i = 0; i < n; i++) {
    const off = hs + 3 + i * 3;
    if (off + 2 >= pkt.length) break;
    entries.push({
      slot: pkt[off],
      skill: pkt[off + 1],
      level: (pkt[off + 2] >> 3) & 0x1f,
    });
  }
  return { mode, entries };
}

/* ------------------------------------------------------------------ */
/* 0xF3/0x05 升级                                                      */
/* ------------------------------------------------------------------ */

export interface LevelUpEvent {
  level: number;
  /** 可分配点数（原版 `CA+84`） */
  levelUpPoint: number;
  maxLife: number;
  maxMana: number;
  maxBp: number;
  /** 以下只有 `GAMESERVER_EXTRA=1` 的长包才有（本服 **48 字节**） */
  fruitAddPoint?: number;
  maxFruitAddPoint?: number;
  experience?: number;
  nextExperience?: number;
}

/**
 * 下行 `0xF3/0x05` 升级（`GCLevelUpSend`，`Protocol.cpp:2003`）。
 *
 *   `C1 size F3 05 [Level][LevelUpPoint][MaxLife][MaxMana][MaxBP]
 *                  [FruitAdd][MaxFruitAdd][FruitSub][MaxFruitSub]  (9 × WORD)
 *                  (pad2) [ViewPoint][ViewMaxHP][ViewMaxMP][ViewMaxBP]
 *                  [ViewExperience][ViewNextExperience]            (6 × DWORD)`
 *
 * 两个坑：
 *
 *   1. **结构体没有 `#pragma pack(1)`**：9 个 WORD 之后是 `#if(GAMESERVER_EXTRA)`
 *      的 DWORD，MSVC 会插 2 字节对齐洞 → `ViewPoint` 在 **+24** 而不是 +22。
 *      本服 `stdafx.h:7` 就是 `#define GAMESERVER_EXTRA 1`，所以实际是 48 字节。
 *   2. **升级会回满血蓝**（原版 `CA+28 = CA+32`、`CA+30 = CA+34`），
 *      不是「保持不变」，调用方别再自己去算。
 */
export function parseLevelUp(pkt: Uint8Array): LevelUpEvent | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 20 || pkt[hs] !== 0xf3 || pkt[hs + 1] !== 0x05) return null;

  const u16 = (o: number) => pkt[o] | (pkt[o + 1] << 8);
  const u32 = (o: number) => (pkt[o] | (pkt[o + 1] << 8) | (pkt[o + 2] << 16) | (pkt[o + 3] << 24)) >>> 0;

  const out: LevelUpEvent = {
    level: u16(4),
    levelUpPoint: u16(6),
    maxLife: u16(8),
    maxMana: u16(10),
    maxBp: u16(12),
    fruitAddPoint: u16(14),
    maxFruitAddPoint: u16(16),
  };
  if (pkt.length >= 48) {
    out.levelUpPoint = u32(24) || out.levelUpPoint;
    out.maxLife = u32(28) || out.maxLife;
    out.maxMana = u32(32) || out.maxMana;
    out.maxBp = u32(36) || out.maxBp;
    out.experience = u32(40);
    out.nextExperience = u32(44);
  }
  return out;
}

/**
 * 下一级所需经验 —— `CharData_CalcNextLevelExp`（0x47E350）：`10 * lvl² * (lvl+9)`。
 *
 * 只在**拿不到服务端值**时兜底（长包会直接给 `ViewNextExperience`，
 * MuEmu 的曲线和这个公式不一样，能用服务端的就用服务端的）。
 */
export function calcNextLevelExp(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return 10 * l * l * (l + 9);
}

/* ------------------------------------------------------------------ */
/* 0x07 效果状态 / 0x1B 技能效果取消（buff 状态位）                     */
/* ------------------------------------------------------------------ */

/**
 * 状态位掩码 —— 服务端 `EffectManager.h:26` 的 `eEffectState`。
 *
 * 这套位同时出现在三个地方，是「buff 到底有没有挂上」的唯一真相：
 *   1. `0x07` 效果状态包（`GCEffectStateSend`，state 1 = 加、0 = 撤）
 *   2. 视野包里的 `ViewSkillState`（`PMSG_VIEWPORT_PLAYER` 的 WORD）
 *   3. `0x1B` 取消技能效果（技能号 → 掩码）
 */
export const STATE_BIT = {
  POISON: 0x0001,
  FREEZE: 0x0002,
  ATTACK: 0x0004,
  DEFENSE: 0x0008,
  ADD_LIFE: 0x0010,
  HARDEN: 0x0020,
  REDUCE_DEFENSE: 0x0040,
  REDUCE_ATTACKDAMAGE: 0x0080,
  REDUCE_MAGICDEFENSE: 0x0100,
  REDUCE_MAGICPOWER: 0x0200,
} as const;

/** 位 → 中文名（调试/提示用） */
export const STATE_NAME: Record<number, string> = {
  0x0001: '中毒',
  0x0002: '冰冻',
  0x0004: '战神之力',
  0x0008: '守护之光',
  0x0010: '生命之光',
  0x0020: '石化',
  0x0040: '防御削弱',
  0x0080: '攻击削弱',
  0x0100: '守护之魂',
  0x0200: '魔力削弱',
};

export interface EffectStateEvent {
  /** 1 = 加上，0 = 撤销 */
  state: number;
  /** 掩码（上面 `STATE_BIT` 的某一位） */
  mask: number;
  /** 实体索引（视野里的 id） */
  index: number;
}

/**
 * 下行 0x07 效果状态（`PMSG_EFFECT_STATE_SEND`，`EffectManager.h:46`）。
 *
 *   `C1 08 07 [state] [effect:LE16] [index:BE16]`
 *
 * 结构体是 `PBMSG_HEAD(3) + BYTE + WORD + BYTE[2]`：`state` 落在 +3，
 * `effect` 从 +4 起（2 字节对齐，正好没有填充洞），`index` 是**大端**。
 *
 * 服务端在两处发它：`GCEffectStateSend`（buff 起/停）和 `CGUseSkill` 的
 * 效果分支。客户端收到后只做两件事：改实体身上的状态位、按掩码挂/摘视觉。
 */
export function parseEffectState(pkt: Uint8Array): EffectStateEvent | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt.length < hs + 6 || pkt[hs] !== 0x07) return null;
  return {
    state: pkt[hs + 1],
    mask: pkt[hs + 2] | (pkt[hs + 3] << 8),
    index: (pkt[hs + 4] << 8) | pkt[hs + 5],
  };
}

/**
 * 技能号 → 状态位掩码（`Net_Process.cpp:4841` 那个 switch，照抄）。
 *
 * 只有这 8 个技能会通过 `0x1B` 撤效果；其余技能的 buff 走 `0x07`。
 * 注意 `0x1B` 包里带的是**技能号**而不是掩码 —— 服务端 `CGSkillCancelRecv`
 * 只做 `DelEffect(lpObj, GetSkillEffect(skill))`，掩码是客户端自己映射的。
 */
export const SKILL_CANCEL_MASK: Record<number, number> = {
  0x01: STATE_BIT.POISON,
  0x07: STATE_BIT.FREEZE,
  0x10: STATE_BIT.REDUCE_MAGICDEFENSE, // 16 守护之魂
  0x1b: STATE_BIT.DEFENSE, // 27 守护之光
  0x1c: STATE_BIT.ATTACK, // 28 战神之力
  0x30: STATE_BIT.ADD_LIFE, // 48 生命之光
  0x33: STATE_BIT.HARDEN, // 51 冰封箭
  0x37: STATE_BIT.REDUCE_DEFENSE, // 55 玄月斩
};

/** 某个掩码中文名（多位置位时用 `+` 连起来） */
export function stateNames(mask: number): string[] {
  const out: string[] = [];
  for (const [bit, name] of Object.entries(STATE_NAME)) {
    if (mask & Number(bit)) out.push(name);
  }
  return out;
}

/** 事件状态（`EventTimeManager.h:7`） */
export const EVENT_STATE = { BLANK: 0, STAND: 1, OPEN: 2, START: 3 } as const;

export interface EventTimeEntry {
  /** 服务端写死的事件名（"Devil Square" / "Blood Castle" / "Golden Invasion" …） */
  name: string;
  status: number;
  /** 剩余秒数（`status === STAND` 时才有意义） */
  time: number;
}

/**
 * 下行 0xF3/0xE6 事件时间表（`CEventTimeManager::GCEventTimeSend`）。
 *
 *   C2 sizeHi sizeLo F3 E6 count { name[32], status, pad[3], time[4 LE] } × count
 *
 * 条目 **40 字节**而不是 37：`PMSG_EVENT_TIME` 里 `char name[32]` 之后是
 * `BYTE status`，紧跟 `DWORD time` 要对齐到 4，中间补 3 字节（实测包长
 * 286 = 6 + 7×40 正好对上）。
 */
/* ------------------------------------------------------------------ */
/* F3/E3 堆叠表 · F3/E4 价格表 · F3/E5 移动列表                       */
/* ------------------------------------------------------------------ */
/**
 * 三张表都是 `PBMSG_HEAD2`（C2 + 2 字节长度 + code + subcode）+ `BYTE count`，
 * 之后是定长记录。以前这三条我们只有一句「DUMP 未移植」，实际上服务端
 * 从登录成功就开始推了，白丢了很多包。
 *
 * 参考客户端那份反编译把它们注释成「quest / skills / master tree」——
 * **那是错的**，看服务端组包函数就知道：
 *
 * | 包 | 服务端 | 内容 |
 * |---|---|---|
 * | `F3/E3` | `CItemStack::GCItemStackListSend`（ItemStack.cpp:118） | 每件物品的最大堆叠数 |
 * | `F3/E4` | `CItemValue::GCItemValueListSend`（ItemValue.cpp:140） | 固定买卖价（ItemValue.txt） |
 * | `F3/E5` | `CMove::GCMoveListSend`（Move.cpp:304） | `/move` 列表 + 服务端按等级算好的门槛 |
 *
 * 记录结构（`ItemStack.h` / `ItemValue.h` / `Move.h` 的 struct 原样）：
 *
 * ```c
 * ITEM_STACK      { int ItemIndex; int Level; int MaxStack; }                  // 12B
 * ITEM_VALUE_INFO { int Index; int Level; int BuyValue; int SellValue; }       // 16B
 * MOVE_LIST_INFO  { BYTE MapNumber; char MapName[32]; bool CanMove;
 *                   short MinLevel, MaxLevel, MinReset, MaxReset, AccountLevel;
 *                   DWORD Money; }                                             // 48B（含 1 字节对齐填充）
 * ```
 *
 * `Level == -1` 表示「不分等级」（`FindValue` / `ItemStack_GetMaxStack` 里那个判断）。
 */
export interface ItemStackEntry {
  itemIndex: number;
  level: number;
  maxStack: number;
}

export interface ItemValueEntry {
  index: number;
  level: number;
  buy: number;
  sell: number;
}

export interface MoveListEntry {
  mapNumber: number;
  /** `Move.txt` 的英文名（和 `WarpEntry.key` 同一个） */
  mapName: string;
  /** 服务端 `gGate.GetMoveLevel` 按等级算过：这一级到底能不能去 */
  canMove: boolean;
  minLevel: number;
  maxLevel: number;
  minReset: number;
  maxReset: number;
  accountLevel: number;
  money: number;
}

/** 三个包共用的头部校验 + 记录数 */
function listHeader(pkt: Uint8Array, sub: number, stride: number): number | null {
  if (pkt[0] !== 0xc2 && pkt[0] !== 0xc4) return null;
  if (pkt.length < 6 || pkt[3] !== 0xf3 || pkt[4] !== sub) return null;
  const count = pkt[5];
  if (pkt.length < 6 + count * stride) {
    // 服务端按 2048 字节缓冲组包，条目多时会截断 —— 按实际能读的算
    return Math.floor((pkt.length - 6) / stride);
  }
  return count;
}

const i32 = (p: Uint8Array, o: number) => p[o] | (p[o + 1] << 8) | (p[o + 2] << 16) | (p[o + 3] << 24);

export function parseItemStackList(pkt: Uint8Array): ItemStackEntry[] | null {
  const count = listHeader(pkt, 0xe3, 12);
  if (count === null) return null;
  const out: ItemStackEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    out.push({ itemIndex: i32(pkt, o), level: i32(pkt, o + 4), maxStack: i32(pkt, o + 8) });
  }
  return out;
}

export function parseItemValueList(pkt: Uint8Array): ItemValueEntry[] | null {
  const count = listHeader(pkt, 0xe4, 16);
  if (count === null) return null;
  const out: ItemValueEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    out.push({
      index: i32(pkt, o),
      level: i32(pkt, o + 4),
      buy: i32(pkt, o + 8),
      sell: i32(pkt, o + 12),
    });
  }
  return out;
}

/**
 * `F3/E5` 移动列表。
 *
 * ⚠️ 这条**比其他两条多一个字节**：`CMove::GCMoveListSend` 在 `count` 之前先写了
 * `pMsg.PKLimitFree = gServerInfo.m_PKLimitFree`（`Move.cpp:311`），所以真实布局是
 *
 * ```text
 * C2 sizeHi sizeLo F3 E5 | PKLimitFree(1) | count(1) | MOVE_LIST_INFO × count
 * ```
 *
 * 实测 1111 字节 = 7 + 23×48，按 `[5]` 读 count 会得到 `PKLimitFree = 0`，
 * 整张表就静默变成空表（第一次接的时候就是这个症状）。
 */
export function parseMoveList(pkt: Uint8Array): MoveListEntry[] | null {
  if (pkt[0] !== 0xc2 && pkt[0] !== 0xc4) return null;
  if (pkt.length < 8 || pkt[3] !== 0xf3 || pkt[4] !== 0xe5) return null;
  const START = 7; // 5 字节头 + PKLimitFree
  const raw = pkt[6];
  const count = pkt.length < START + raw * 48 ? Math.floor((pkt.length - START) / 48) : raw;
  const out: MoveListEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = START + i * 48;
    let name = '';
    for (let k = 0; k < 32; k++) {
      const c = pkt[o + 1 + k];
      if (!c) break;
      name += String.fromCharCode(c);
    }
    const sh = (at: number) => {
      const v = pkt[o + at] | (pkt[o + at + 1] << 8);
      return v > 0x7fff ? v - 0x10000 : v;
    };
    out.push({
      mapNumber: pkt[o],
      mapName: name.trim(),
      canMove: pkt[o + 33] !== 0,
      minLevel: sh(34),
      maxLevel: sh(36),
      minReset: sh(38),
      maxReset: sh(40),
      accountLevel: sh(42),
      // Money 在 +44；无符号
      money: i32(pkt, o + 44) >>> 0,
    });
  }
  return out;
}

export function parseEventTime(pkt: Uint8Array): EventTimeEntry[] | null {
  if (pkt[0] !== 0xc2 && pkt[0] !== 0xc4) return null;
  if (pkt.length < 6 || pkt[3] !== 0xf3 || pkt[4] !== 0xe6) return null;

  const count = pkt[5];
  const start = 6;
  const STRIDE = 40;
  if (pkt.length < start + count * STRIDE) return null;

  const out: EventTimeEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = start + i * STRIDE;
    let name = '';
    for (let k = 0; k < 32; k++) {
      const c = pkt[o + k];
      if (!c) break;
      name += String.fromCharCode(c);
    }
    out.push({
      name: name.trim(),
      status: pkt[o + 32],
      time: readU32(pkt, o + 36),
    });
  }
  return out;
}

/* ================================================================== */
/* 任务（0xA0 信息 / 0xA1 状态 / 0xA2 接交 / 0xA3 奖励）              */
/* ================================================================== */

/**
 * 下行 0xA0 任务状态表（`CQuest::GCQuestInfoSend`）。
 *
 *   C1 36 A0 [count] [QuestInfo: 50 字节 bitmask]
 *
 * 服务端 `count = MAX_QUEST_LIST / 4 = 48`，但结构体里是 `QuestInfo[50]`，
 * **实际发 50 字节**（`sizeof(pMsg)` = 3 + 1 + 50 = 54）。这里按「够长就全取」
 * 处理，不去纠结 count 和 50 的差值。
 *
 * 每个任务占 **2 bit**：`byte[index / 4] >> ((index % 4) * 2) & 3`
 * （0 未接 / 1 进行中 / 2 已完成 / 3 已取消）。
 */
export function parseQuestInfo(pkt: Uint8Array): Uint8Array | null {
  if (pkt[2] !== 0xa0) return null;
  const body = pkt.subarray(4);
  if (body.length < 50) return null;
  // 拷进一个新的定长数组：`subarray/slice` 的底层可能是 SharedArrayBuffer，
  // 类型上是 `Uint8Array<ArrayBufferLike>`，和拿到就用 `Uint8Array` 的地方不兼容。
  const out = new Uint8Array(50);
  out.set(body.subarray(0, 50));
  return out;
}

/** 下行 0xA1 单个任务状态变化：`C1 05 A1 index state` */
export function parseQuestStateUpdate(pkt: Uint8Array): { index: number; state: number } | null {
  if (pkt[2] !== 0xa1 || pkt.length < 5) return null;
  return { index: pkt[3], state: pkt[4] };
}

/**
 * 下行 0xA2 接取/完成回执：`C1 05 A2 index result state`
 *
 * `result = 0` 成功、`0xFF` 失败（目标没达成 / 条件不足 / 已经完成过）。
 * `state` 是**操作之后**的状态，直接拿去更新本地 bitmask，不用等 0xA1。
 */
export function parseQuestResult(pkt: Uint8Array): { index: number; result: number; state: number } | null {
  if (pkt[2] !== 0xa2 || pkt.length < 5) return null;
  return { index: pkt[3], result: pkt[4], state: pkt[5] ?? 0 };
}

/*
 * 任务奖励子类型（`0xA3` 的第 6 个字节）。
 *
 * 服务端 `CQuestReward::InsertQuestReward` 按 `QuestReward.txt` 里的 reward 索引
 * 分支，客户端 `Net_Process.cpp` 的 `case 0xA3` 也是按这个字节走：
 *
 *   0xC8 → 只加属性点（`LevelUpPoint += value`）
 *   0xC9 → 转职（把编码后的职业号写到实体和 `CharacterAttribute[11]`）
 *   0xCA → 转职 + 属性点
 *   0xCB → 转职（不加点）
 *
 * 三个转职分支都会播同一套特效（15 束 `Joint_Create(1249)` + `CreateEffect(1264)`）。
 */
export const QUEST_REWARD_POINT = 0xc8;
export const QUEST_REWARD_CLASS = 0xc9;
export const QUEST_REWARD_CLASS_POINT = 0xca;
export const QUEST_REWARD_CLASS_ONLY = 0xcb;

/**
 * 下行 0xA3 奖励：`C1 06 A3 index[2] reward value`
 *
 * `index` 是**玩家 id**（`FindCharacterIndex(index & 0x7FFF)`），不是任务号；
 * `value` 在加点的分支里是点数，在转职分支里是**编码后的职业号**。
 * `GAMESERVER_EXTRA=1` 时包尾还会多一个 DWORD（`ViewPoint`，已结算的可用点数）。
 */
export function parseQuestReward(pkt: Uint8Array): {
  /** 玩家 id（低 15 位） */
  key: number;
  /** 子类型：0xC8 / 0xC9 / 0xCA / 0xCB */
  reward: number;
  /** 点数，或编码后的职业号 */
  value: number;
  /** `GAMESERVER_EXTRA` 的结算点数（没有就是 null） */
  viewPoint: number | null;
} | null {
  if (pkt[2] !== 0xa3 || pkt.length < 7) return null;
  const viewPoint =
    pkt.length >= 12
      ? (pkt[8] | (pkt[9] << 8) | (pkt[10] << 16) | (pkt[11] << 24)) >>> 0
      : null;
  return {
    key: (((pkt[3] << 8) | pkt[4]) & 0x7fff) >>> 0,
    reward: pkt[5],
    value: pkt[6],
    viewPoint,
  };
}

/**
 * `0xA3` 里那个职业字节 → **原版编码后的职业号**（低 3 位职业组 + 高位转职次数）。
 *
 * 客户端原文（`Net_Process.cpp` 的 0xA3 分支）：
 *
 *     BYTE klass = (BYTE)((((Msg[6] >> 4) | (Msg[6] & 0x10))) >> 1);
 *
 * 验证：魔法师一转时服务端发 0x10 → `((1|0x10)>>1)` = 8 = 「魔法师 + 一转」
 * （`Text.bmd` 第 24 行正好是「魔导师」）；剑士一转发 0x30 → 9 =「骑士」。
 */
export function decodeQuestClass(byte: number): number {
  return ((((byte >> 4) | (byte & 0x10)) >> 1) & 0x1f) >>> 0;
}

/**
 * 上行 0xA2 接取 / 完成（`CQuest::CGQuestStateRecv`）。
 *
 *   C3 05 A2 [index] [state]
 *
 * **服务端不看 `state` 字节**（`CGQuestStateRecv` 只读 `QuestIndex`）：
 * 它按该任务当前状态自己决定「未接 → 接取」还是「进行中 → 完成」，
 * 目标不满足就回 `result = 0xFF`。
 * 要求 C3（HackPacketCheck 第 162 行 Encrypt=1）。
 */
export function buildQuestStatePacket(index: number, state = 0): Uint8Array {
  return new Uint8Array([0xc3, 5, 0xa2, index & 0xff, state & 0xff]);
}

/** 上行 0xA0 主动要一次任务表（C3 03 A0；服务端登录时通常已经推过） */
export function buildQuestInfoRequest(): Uint8Array {
  return new Uint8Array([0xc3, 3, 0xa0]);
}

/* ================================================================== */
/* 组队（0x40 邀请 / 0x41 应答 / 0x42 列表 / 0x43 踢人 / 0x44 血量）  */
/* ================================================================== */

export interface PartyMember {
  name: string;
  /** 队伍里的位置 0..4（0 号是队长） */
  number: number;
  map: number;
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

/**
 * 上行 0x40 邀请（`CParty::CGPartyRequestRecv`）。
 *
 *   C3 05 40 [indexHi] [indexLo]
 *
 * 硬性条件（任一不满足就**静默丢弃**或只回一条提示）：
 *   - 双方都没占用 Interface（正在开商店/仓库/交易时点邀请无效）；
 *   - **双方等级差 ≤ `PartyLevelDifference`**（服务端配置，默认 30 左右）；
 *   - 邀请者必须是队长（已在队伍里时，非队长会被回 `0x41 result=0`）。
 * 要求 C3（HackPacketCheck 第 64 行 Encrypt=1）。
 */
export function buildPartyInvitePacket(index: number): Uint8Array {
  return new Uint8Array([0xc3, 5, 0x40, (index >> 8) & 0xff, index & 0xff]);
}

/**
 * 上行 0x41 应答邀请（`CGPartyRequestResultRecv`）。
 *
 *   C3 06 41 [result] [indexHi] [indexLo]
 *
 * 注意语义和直觉相反：**`result = 0` 是拒绝**，非 0（通常 1）才是接受。
 * 服务端 `if (lpMsg->result == 0) { GCPartyResultSend(aIndex, 1); goto CLEAR; }`
 * —— 也就是「0 = 不组」，而回给邀请方 `0x41 result=1` 表示「对方拒绝了」。
 * 要求 C3（HackPacketCheck 第 65 行 Encrypt=1）。
 */
export function buildPartyResponsePacket(index: number, accept: boolean): Uint8Array {
  return new Uint8Array([0xc3, 6, 0x41, accept ? 1 : 0, (index >> 8) & 0xff, index & 0xff]);
}

/** 上行 0x42 请求队伍列表（`C1 03 42`；服务端不在队伍里就不回） */
export function buildPartyListRequest(): Uint8Array {
  return new Uint8Array([0xc1, 3, 0x42]);
}

/**
 * 上行 0x43 踢人（`C1 04 43 number`）。
 *
 * `number` 是**队伍里的位置**（0 = 队长自己），不是对象索引。
 * 服务端：非队长只能踢自己（= 退队）；队伍只剩 2 人时踢人 = 解散。
 */
export function buildPartyKickPacket(number: number): Uint8Array {
  return new Uint8Array([0xc1, 4, 0x43, number & 0xff]);
}

/** 下行 0x40 有人邀请你：`C1 05 40 index[2]`（邀请者的索引） */
export function parsePartyRequest(pkt: Uint8Array): { index: number } | null {
  if (pkt[2] !== 0x40 || pkt.length < 5) return null;
  return { index: (pkt[3] << 8) | pkt[4] };
}

/**
 * 下行 0x41 组队结果：`C1 04 41 result`
 *
 * 服务端只发这几个值（`CParty::GCPartyResultSend`）：
 *   1 = 对方拒绝 / 邀请失败
 *   2 = 组队失败（队伍满 5 人）
 *   0 = 未知（`OBJECT_RANGE(PartyTargetUser)` 冲突时用的兜底）
 */
export function parsePartyResult(pkt: Uint8Array): { result: number } | null {
  if (pkt[2] !== 0x41 || pkt.length < 4) return null;
  return { result: pkt[3] };
}

/**
 * 下行 0x42 队伍列表：`C1 size 42 [result] [count]` + count × 22 字节成员。
 *
 * 成员结构（`PMSG_PARTY_LIST`）：
 *   char name[10]; BYTE number; BYTE map; BYTE x; BYTE y; DWORD CurLife; DWORD MaxLife
 * 注意 `name[10]` **不保证有结尾 0** —— 名字刚好 10 字节时要按长度截。
 * `result`：1 = 在队伍里（后面跟成员），0 = 自己没队伍（count 也是 0）。
 */
export function parsePartyList(pkt: Uint8Array): { result: number; members: PartyMember[] } | null {
  if (pkt[2] !== 0x42 || pkt.length < 5) return null;
  const result = pkt[3];
  const count = pkt[4];
  const out: PartyMember[] = [];
  const STRIDE = 22;
  let o = 5;
  for (let i = 0; i < count; i++) {
    if (o + STRIDE > pkt.length) break;
    let name = '';
    for (let k = 0; k < 10; k++) {
      const ch = pkt[o + k];
      if (!ch) break;
      name += String.fromCharCode(ch);
    }
    out.push({
      name,
      number: pkt[o + 10],
      map: pkt[o + 11],
      x: pkt[o + 12],
      y: pkt[o + 13],
      life: pkt[o + 14] | (pkt[o + 15] << 8) | (pkt[o + 16] << 16) | (pkt[o + 17] << 24),
      maxLife: pkt[o + 18] | (pkt[o + 19] << 8) | (pkt[o + 20] << 16) | (pkt[o + 21] << 24),
    });
    o += STRIDE;
  }
  return { result, members: out };
}

/**
 * 下行 0x44 队伍血量：`C1 size 44 [count]` + count × 1 字节。
 *
 * 每个字节：**高 4 bit = 成员位置**，低 4 bit = 血量百分比 / 10（0..10）。
 * 也就是服务端只发「十等分」，不是精确 HP —— 照原版画 10 格血条即可。
 */
export function parsePartyLife(pkt: Uint8Array): { number: number; tenths: number }[] | null {
  if (pkt[2] !== 0x44 || pkt.length < 4) return null;
  const count = pkt[3];
  const out: { number: number; tenths: number }[] = [];
  for (let i = 0; i < count; i++) {
    const b = pkt[4 + i];
    if (b === undefined) break;
    out.push({ number: (b >> 4) & 0x0f, tenths: b & 0x0f });
  }
  return out;
}

/* ================================================================== */
/* 交易（0x36 请求 / 0x37 应答 / 0x38-0x39 对方物品 / 0x3A-0x3B 金币  */
/*        0x3C 确定 / 0x3D 结果）                                     */
/* ================================================================== */

/**
 * 上行 0x36 发起交易（`CTrade::CGTradeRequestRecv`）。
 *
 *   C3 05 36 [indexHi] [indexLo]
 *
 * 服务端硬性条件：**同图 + X/Y 相差 ≤ 2 格**（`lpObj->X < lpTarget->X - 2 …`），
 * 任一不满足就回 `0x37 response=0`，而不会静默丢弃。
 * 要求 C3（HackPacketCheck 第 54 行 Encrypt=1）。
 */
export function buildTradeRequestPacket(index: number): Uint8Array {
  return new Uint8Array([0xc3, 5, 0x36, (index >> 8) & 0xff, index & 0xff]);
}

/**
 * 上行 0x37 应答交易（`CGTradeResponseRecv`）。
 *
 *   C1 04 37 [response]      // 0 = 拒绝，非 0 = 接受
 *
 * 结构体里后面还有 `name[10] + level(2) + guild(4)`，但服务端**只读 response**
 * （对方信息它自己有），所以这里发最短的 4 字节就够。
 */
export function buildTradeResponsePacket(accept: boolean): Uint8Array {
  return new Uint8Array([0xc1, 4, 0x37, accept ? 1 : 0]);
}

/**
 * 上行 0x3A 设定交易金币（`C1 07 3A money[4 LE]`）。
 *
 * 注意服务端会**立刻从身上扣掉**这笔钱（`GCMoneySend`），
 * 交易取消/失败时再由 `ExchangeTradeItem` 或 `ResetTrade` 退回来 ——
 * 所以 UI 上「放入」之后金币会马上变少，这是正常的。
 */
export function buildTradeMoneyPacket(money: number): Uint8Array {
  const pkt = new Uint8Array(7);
  pkt[0] = 0xc1;
  pkt[1] = 7;
  pkt[2] = 0x3a;
  pkt[3] = money & 0xff;
  pkt[4] = (money >> 8) & 0xff;
  pkt[5] = (money >> 16) & 0xff;
  pkt[6] = (money >> 24) & 0xff;
  return pkt;
}

/**
 * 上行 0x3C 确定 / 取消确定（`C3 04 3C flag`）。
 *
 * 双方都 `TradeOk = 1` 时服务端才交换物品；任何一方改动物品/金币，
 * 服务端会给双方发 `0x3C flag=0` 清状态。
 * 要求 C3（HackPacketCheck 第 60 行 Encrypt=1）。
 */
export function buildTradeOkPacket(flag: boolean): Uint8Array {
  return new Uint8Array([0xc3, 4, 0x3c, flag ? 1 : 0]);
}

/** 上行 0x3D 取消交易（C3 03 3D；要求加密，第 61 行） */
export function buildTradeCancelPacket(): Uint8Array {
  return new Uint8Array([0xc3, 3, 0x3d]);
}

/** 下行 0x36 有人请求交易：`C3 0D 36 name[10]` */
export function parseTradeRequest(pkt: Uint8Array): { name: string } | null {
  if (pkt[2] !== 0x36 || pkt.length < 13) return null;
  let name = '';
  for (let i = 0; i < 10; i++) {
    const ch = pkt[3 + i];
    if (!ch) break;
    name += String.fromCharCode(ch);
  }
  return { name };
}

/**
 * 下行 0x37 交易应答/开始：`C1 size 37 [response] [name:10] [level:2] [guild:4]`
 *
 * `response = 1` 表示交易开始（名字/等级是**对方**的），0 表示被拒绝或中断。
 */
export function parseTradeResponse(pkt: Uint8Array): { response: number; name: string; level: number } | null {
  if (pkt[2] !== 0x37 || pkt.length < 16) return null;
  let name = '';
  for (let i = 0; i < 10; i++) {
    const ch = pkt[4 + i];
    if (!ch) break;
    name += String.fromCharCode(ch);
  }
  return { response: pkt[3], name, level: pkt[14] | (pkt[15] << 8) };
}

/** 下行 0x38 对方拿走一件交易物品：`C1 04 38 slot` */
export function parseTradeItemDel(pkt: Uint8Array): { slot: number } | null {
  if (pkt[2] !== 0x38 || pkt.length < 4) return null;
  return { slot: pkt[3] };
}

/** 下行 0x39 对方放进一件交易物品：`C1 09 39 slot ItemInfo[4]` */
export function parseTradeItemAdd(pkt: Uint8Array): { slot: number; item: InventoryItem } | null {
  if (pkt[2] !== 0x39 || pkt.length < 9) return null;
  const slot = pkt[3];
  return { slot, item: decodeItemInfo(slot, pkt[4], pkt[5], pkt[6], pkt[7]) };
}

/** 下行 0x3A 金币设定结果：`C1 04 3A result`（1 = 成功） */
export function parseTradeMoneyResult(pkt: Uint8Array): { result: number } | null {
  if (pkt[2] !== 0x3a || pkt.length < 4) return null;
  return { result: pkt[3] };
}

/** 下行 0x3B 交易金币显示：`C1 07 3B money[4]`（对方放进去的钱） */
/**
 * 下行 0x3B 交易里的金币（`PMSG_TRADE_MONEY_SEND` = header + DWORD money）。
 *
 * `Trade.h` 没有 pack(1)，`money` 在 **+4**（包长 8）。按 +3 读会让交易窗口
 * 显示的金额变成天文数字（和 0x34 修理回执同一个坑）。
 */
export function parseTradeMoney(pkt: Uint8Array): { money: number } | null {
  if (pkt[2] !== 0x3b || pkt.length < 7) return null;
  const base = pkt.length >= 8 ? 4 : 3;
  return { money: readU32(pkt, base) };
}

/** 下行 0x3C 确定状态：`C1 04 3C flag`（0 重置 / 1 对方已确定） */
export function parseTradeOk(pkt: Uint8Array): { flag: number } | null {
  if (pkt[2] !== 0x3c || pkt.length < 4) return null;
  return { flag: pkt[3] };
}

/**
 * 下行 0x3D 交易结果：`C1 04 3D result`
 *
 *   0 = 取消 / 对方取消   1 = 成功
 *   2 = 物品交换失败（背包放不下）
 *   5 = 金币超过上限
 */
export function parseTradeResult(pkt: Uint8Array): { result: number } | null {
  if (pkt[2] !== 0x3d || pkt.length < 4) return null;
  return { result: pkt[3] };
}

/* ================================================================== */
/* 混沌合成（0x86 合成 / 0x87 关闭 / 0x88 成功率）                     */
/* ================================================================== */

/** 混沌机器的合成类型（`ChaosBox.h` 的 `eChaosMixNumber`） */
export const CHAOS_MIX_TYPES: { value: number; label: string }[] = [
  { value: 1, label: '混沌武器' },
  { value: 2, label: '恶魔广场入场券' },
  { value: 3, label: '装备 +10（一级）' },
  { value: 4, label: '装备 +10（二级）' },
  { value: 5, label: '独角兽（Dinorant）' },
  { value: 6, label: '果实' },
  { value: 7, label: '二代翅膀' },
  { value: 8, label: '血色城堡入场券' },
  { value: 11, label: '一代翅膀' },
];

/** 上行 0x86 合成（`C1 04 86 type`；Encrypt=0 → C1） */
export function buildChaosMixPacket(type: number): Uint8Array {
  return new Uint8Array([0xc1, 4, 0x86, type & 0xff]);
}

/** 上行 0x87 关闭混沌机（`C1 03 87`；服务端会把箱内物品退回背包） */
export function buildChaosClosePacket(): Uint8Array {
  return new Uint8Array([0xc1, 3, 0x87]);
}

/**
 * 上行 0x88 查询成功率与费用（`C1 07 88 type[4 LE]`）。
 *
 * 服务端 `CGetChaosMixRateAndMoney` 会按材料算，回：
 *   `C1 0B 88 rate(DWORD) money(DWORD)`
 * 注意 `type` 是 **int**（4 字节），不是 1 字节。
 */
export function buildChaosRatePacket(type: number): Uint8Array {
  /*
   * `PMSG_CHAOS_MIX_RATE_RECV` = `PBMSG_HEAD`(3) + `int type`，而 `ChaosBox.h`
   * **没有 `#pragma pack(1)`** —— `int` 要 4 字节对齐，所以 `type` 在 **+4**，
   * 中间那个 +3 是对齐洞，`sizeof` = 8。
   *
   * 以前发的是 `C1 07 88 [type 四字节 @+3]`：服务端从 +4 读，拿到的是
   * `type` 的高 3 字节 + 越界字节 —— 只有 type < 256 时才不炸，
   * 而它读到的是 `type >> 8`，也就是 0。所以成功率查询一直回 0/0。
   */
  const pkt = new Uint8Array(8);
  pkt[0] = 0xc1;
  pkt[1] = 8;
  pkt[2] = 0x88;
  pkt[3] = 0; // padding
  pkt[4] = type & 0xff;
  pkt[5] = (type >> 8) & 0xff;
  pkt[6] = (type >> 16) & 0xff;
  pkt[7] = (type >> 24) & 0xff;
  return pkt;
}

/**
 * 下行 0x86 合成结果：`C1 06 86 result ItemInfo[4]`
 *
 * 结果码（`CChaosBox` 各 Mix 函数里写死的）：
 *   1 = **成功且产出了物品**（`ItemInfo` 就是那件，+10 装备会带新等级）
 *   0 = 成功但没产出 / 失败（**两种都会回 0**，看 `ItemInfo` 是不是全 0xFF）
 *   2 = 材料不对 / 条件不满足
 *   8 = 等级或属性超出范围
 */
export function parseChaosMixResult(pkt: Uint8Array): { result: number; item: InventoryItem | null } | null {
  if (pkt[2] !== 0x86 || pkt.length < 8) return null;
  const info = pkt.subarray(4, 8);
  const empty = info.every(b => b === 0xff);
  return {
    result: pkt[3],
    item: empty ? null : decodeItemInfo(0, info[0], info[1], info[2], info[3]),
  };
}

/** 下行 0x88 成功率/费用：`C1 0B 88 rate(4) money(4)` */
/**
 * 下行 0x88 成功率 / 费用（`PMSG_CHAOS_MIX_RATE_SEND` = header + DWORD + DWORD）。
 *
 * 同样因为 `ChaosBox.h` 没 pack(1)：两个 DWORD 都要 4 字节对齐，
 * 所以 `rate` 在 **+4**、`money` 在 **+8**（+3 是洞）。包长 12。
 * 按 +3 / +7 读会把 rate 读成「低 3 字节左移 8」—— 混沌面板上显示的成功率
 * 和费用一直是错的（还会出现天文数字）。
 */
export function parseChaosRate(pkt: Uint8Array): { rate: number; money: number } | null {
  if (pkt[2] !== 0x88 || pkt.length < 11) return null;
  // 12 = 对齐版，11 = packed 版；按长度判
  const base = pkt.length >= 12 ? 4 : 3;
  return { rate: readU32(pkt, base), money: readU32(pkt, base + 4) };
}

/* ================================================================== */
/* 战盟（0x50–0x64）                                                   */
/* ================================================================== */

/**
 * 战盟协议血缘：`MuServer_Source/GameServer/Guild.h`（结构体）+
 * `Guild.cpp`（判定逻辑）+ Win 端 `Net_Process.cpp:5699-5795`（收包）。
 *
 * 全部上行都是 **C1**（`HackPacketCheck.txt` 里 80/81/82/83/84/85/87/97 的
 * Encrypt 列都是 0），但**带 payload 的包要过 chain-XOR**（服务端
 * `CGChatRecv` 之前统一 `XorData`），所以这里仍然走 `connection.send`。
 *
 * 两个容易搞反的语义：
 *
 *   1. **0x50 是「申请加入」，不是「邀请」**。
 *      客户端在会长面前打 `/guild` → 发 `0x50 [会长的索引]`；服务端校验的是
 *      **被发的那个 index 必须是会长**（`CGGuildRequestRecv` 里
 *      `lpTarget->GuildStatus != GUILD_STATUS_MASTER → result 4`），
 *      然后把 0x50 转发给会长，会长回 0x51。
 *   2. **0x52 是 C2 长包，而且结构体有对齐填充**。
 *      成员表从 **+16** 开始，不是 +11 ——
 *      `PMSG_GUILD_LIST_SEND` 里 `count` 之后有 2 字节 padding 让
 *      `TotalScore` 4 字节对齐，`score` 之后又补 3 字节。踩过一次的话
 *      名字会整体错 5 个字节（0.97 客户端源码里记着这个 bug）。
 */

/** `MAX_GUILD_MEMBER`（`GuildManager.h`） */
export const GUILD_MAX_MEMBER = 40;
/** `GUILD_STATUS_MASTER` —— 成员行的 bit7 是「会长」标记 */
export const GUILD_STATUS_MASTER = 128;

export interface GuildMember {
  name: string;
  /** 服务端 `Members[n].Server`：>=0 表示在线（值就是 GameServer 编号），<0 表示离线 */
  number: number;
  connected: boolean;
  /** bit7 = 会长 */
  master: boolean;
}

export interface GuildListReply {
  /** 1 = 有战盟且成员表非空；0 = 没有战盟 */
  result: number;
  count: number;
  /** 战盟总积分（`GuildScore`） */
  totalScore: number;
  /** 个人贡献分（`PlayScore`） */
  playScore: number;
  members: GuildMember[];
}

/**
 * 0x50 上行：申请加入某人的战盟。
 *
 *   `C1 05 50 [indexHi][indexLo]`
 */
export function buildGuildJoinRequestPacket(targetIndex: number): Uint8Array {
  return new Uint8Array([0xc1, 5, 0x50, (targetIndex >> 8) & 0xff, targetIndex & 0xff]);
}

/**
 * 0x51 上行：应答加入申请（**只有会长会收到 0x50**）。
 *
 *   `C1 06 51 [1 接受 / 0 拒绝] [indexHi][indexLo]`   ← index 是申请人的索引
 */
export function buildGuildJoinAnswerPacket(accept: boolean, applicantIndex: number): Uint8Array {
  return new Uint8Array([
    0xc1,
    6,
    0x51,
    accept ? 1 : 0,
    (applicantIndex >> 8) & 0xff,
    applicantIndex & 0xff,
  ]);
}

/** 0x52 上行：拉取战盟成员表（`CGGuildListRecv`，无 payload） */
export function buildGuildListRequestPacket(): Uint8Array {
  return new Uint8Array([0xc1, 3, 0x52]);
}

/**
 * 0x53 上行：退出 / 驱逐 / 解散（**同一个包，服务端自己判断**）。
 *
 *   `C1 17 53 name[10] PersonalCode[10]`   ← 23 字节
 *
 *   - 普通成员：name 只能是自己 → 退盟
 *   - 会长点别人：驱逐该成员
 *   - 会长点自己：解散战盟
 *
 * `PersonalCode` 是**账号**级的 7 位个人码（不是仓库密码），
 * 服务端拿 `gObjCheckPersonalCode` 比对，错了回 result≠1。
 */
export function buildGuildDeletePacket(name: string, personalCode: string): Uint8Array {
  const pkt = new Uint8Array(23);
  pkt[0] = 0xc1;
  pkt[1] = 23;
  pkt[2] = 0x53;
  for (let i = 0; i < 10 && i < name.length; i++) pkt[3 + i] = name.charCodeAt(i) & 0xff;
  for (let i = 0; i < 10 && i < personalCode.length; i++) pkt[13 + i] = personalCode.charCodeAt(i) & 0xff;
  return pkt;
}

/**
 * 0x54 上行：请求打开「创建战盟」界面（`result` 固定 1）。
 *
 * 服务端 `CGGuildMasterOpenRecv` 先查等级 / 转身数（`GuildCreateMinLevel` /
 * `GuildCreateMinReset`），够格才回一个**只有包头**的 0x55（= 客户端可以弹
 * 创建框了）；不够格就什么也不回。
 */
export function buildGuildOpenCreatePacket(): Uint8Array {
  return new Uint8Array([0xc1, 4, 0x54, 1]);
}

/**
 * 0x55 上行：真正建盟。
 *
 *   `C1 2B 55 GuildName[8] Mark[32]`   ← 43 字节
 *
 * 服务端只做「长度 2..8 / 不许有空格 / 不许有特殊字符」的本地校验，
 * 然后交给 DataServer 走 `WZ_GuildCreate` 存储过程，结果从 0x56 回来。
 */
export function buildGuildCreatePacket(guildName: string, mark: Uint8Array): Uint8Array {
  const pkt = new Uint8Array(43);
  pkt[0] = 0xc1;
  pkt[1] = 43;
  pkt[2] = 0x55;
  for (let i = 0; i < 8 && i < guildName.length; i++) pkt[3 + i] = guildName.charCodeAt(i) & 0xff;
  pkt.set(mark.subarray(0, 32), 11);
  return pkt;
}

/** 0x57 上行：取消创建（服务端只清 `Interface`，没有回执） */
export function buildGuildCreateCancelPacket(): Uint8Array {
  return new Uint8Array([0xc1, 3, 0x57]);
}

/** 0x61 上行：应答战盟战邀请（`CGGuildWarRequestResultRecv`） */
export function buildGuildWarAnswerPacket(result: number): Uint8Array {
  return new Uint8Array([0xc1, 4, 0x61, result & 0xff]);
}

/* ---------------- 下行 ---------------- */

/** 下行 0x50：有人申请加入我的战盟（`C1 05 50 [hi][lo]`，index = 申请人的对象号） */
export function parseGuildRequest(pkt: Uint8Array): { index: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x50 || pkt.length < 5) return null;
  return { index: (pkt[3] << 8) | pkt[4] };
}

/** 下行 0x51：加入结果（`C1 04 51 result`） */
export function parseGuildResult(pkt: Uint8Array): { result: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x51 || pkt.length < 4) return null;
  return { result: pkt[3] };
}

/**
 * 下行 0x52：战盟成员表（`C2` 长包）。
 *
 *   +0..3   PWMSG_HEAD（C2 两字节长度）
 *   +4      result
 *   +5      count
 *   +6..7   padding
 *   +8..11  TotalScore (u32)
 *   +12     score
 *   +13..15 padding
 *   +16..   成员：{ name[10], number, connected } × count（12 字节/条）
 */
export function parseGuildList(pkt: Uint8Array): GuildListReply | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  const hs = wide ? 3 : 2;
  if (pkt[hs] !== 0x52) return null;
  const HEAD = 16;
  if (pkt.length < HEAD) return null;

  const count = pkt[5];
  if (pkt.length < HEAD + count * 12) return null;

  const members: GuildMember[] = [];
  for (let i = 0; i < count; i++) {
    const o = HEAD + i * 12;
    const flags = pkt[o + 11];
    members.push({
      name: readName(pkt, o, 10),
      number: pkt[o + 10],
      // `connected` 的低 7 位是 GameServer 编号，bit7 = 会长
      master: (flags & GUILD_STATUS_MASTER) !== 0,
      connected: (flags & 0x7f) !== 0x7f,
    });
  }

  return {
    result: pkt[4],
    count,
    totalScore: readU32(pkt, 8),
    playScore: pkt[12],
    members,
  };
}

/** 下行 0x53：退盟 / 驱逐 / 解散的结果（`C1 04 53 result`） */
export function parseGuildDeleteResult(pkt: Uint8Array): { result: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x53 || pkt.length < 4) return null;
  return { result: pkt[3] };
}

/** 下行 0x55：可以打开创建框了（**只有 3 字节包头**） */
export function parseGuildCreateOpen(pkt: Uint8Array): boolean {
  return pkt[0] === 0xc1 && pkt.length >= 3 && pkt[2] === 0x55;
}

/** 下行 0x56：建盟结果（`C1 04 56 result`；1 = 成功） */
export function parseGuildCreateResult(pkt: Uint8Array): { result: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x56 || pkt.length < 4) return null;
  return { result: pkt[3] };
}

/** 下行 0x5C：某人进了视野 → 带上他的战盟名 + 标志（`C1 2D 5C`） */
export function parseGuildViewportCreate(
  pkt: Uint8Array
): { index: number; name: string; mark: Uint8Array } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x5c || pkt.length < 45) return null;
  return {
    index: (pkt[3] << 8) | pkt[4],
    name: readName(pkt, 5, 8),
    mark: pkt.slice(13, 45),
  };
}

/** 下行 0x5D：某人离开视野 / 换盟 → 清掉他的战盟标记（`C1 05 5D`） */
export function parseGuildViewportDelete(pkt: Uint8Array): { index: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x5d || pkt.length < 5) return null;
  return { index: (pkt[3] << 8) | pkt[4] };
}

/** 下行 0x60：战盟战申请结果（`C1 04 60 result`） */
export function parseGuildWarResult(pkt: Uint8Array): { result: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x60 || pkt.length < 4) return null;
  return { result: pkt[3] };
}

/** 下行 0x61：对方宣战/我方被宣战（`C1 0C 61 GuildName[8] type`） */
export function parseGuildWarDeclare(pkt: Uint8Array): { name: string; type: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x61 || pkt.length < 12) return null;
  return { name: readName(pkt, 3, 8), type: pkt[11] };
}

/** 下行 0x62：战盟战开始（`C1 0D 62 GuildName[8] type team`） */
export function parseGuildWarStart(
  pkt: Uint8Array
): { name: string; type: number; team: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x62 || pkt.length < 13) return null;
  return { name: readName(pkt, 3, 8), type: pkt[11], team: pkt[12] };
}

/** 下行 0x63：战盟战结束（`C1 0C 63 result GuildName[8]`） */
export function parseGuildWarEnd(pkt: Uint8Array): { result: number; name: string } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x63 || pkt.length < 12) return null;
  return { result: pkt[3], name: readName(pkt, 4, 8) };
}

/** 下行 0x64：战盟战比分（`C1 05 64 score[2]`，big-endian 16 位） */
export function parseGuildWarScore(pkt: Uint8Array): { score: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x64 || pkt.length < 5) return null;
  return { score: (pkt[3] << 8) | pkt[4] };
}

/* ---------------- 标志（8×8 像素，32 字节打包） ---------------- */

/**
 * 64 格 → 32 字节。每字节塞两格：**低 4 位是偶数格，高 4 位是奇数格**
 * （0.97 客户端编辑器里 `mark[gx + gy*8]` 是每格一个字节，发包前才压成
 * 32 字节，`PMSG_GUILD_CREATE_RECV::Mark[32]`）。
 */
export function packGuildMark(cells: number[]): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const lo = (cells[i * 2] ?? 0) & 0x0f;
    const hi = (cells[i * 2 + 1] ?? 0) & 0x0f;
    out[i] = lo | (hi << 4);
  }
  return out;
}

/** 32 字节 → 64 格（`packGuildMark` 的逆运算） */
export function unpackGuildMark(mark: Uint8Array): number[] {
  const cells: number[] = [];
  for (let i = 0; i < 32; i++) {
    cells.push(mark[i] & 0x0f);
    cells.push((mark[i] >> 4) & 0x0f);
  }
  return cells;
}

/**
 * 战盟标志的 16 色调色板（`UI_GuildMark.cpp::GuildMark_InitializePalette`，
 * `DAT_07e11f34` = `MarkColor[16]`，ARGB）。
 *
 * 0 号是透明（编辑器里当橡皮），其余 15 色按彩虹顺序排列。
 */
export const GUILD_MARK_COLORS: string[] = [
  'transparent',
  '#000000', // 1 黑
  '#808080', // 2 灰
  '#ffffff', // 3 白
  '#0000ff', // 4 蓝
  '#0080ff', // 5 天蓝
  '#00ffff', // 6 青
  '#00ff80', // 7 青绿
  '#00ff00', // 8 绿
  '#80ff00', // 9 黄绿
  '#ffff00', // 10 黄
  '#ff8000', // 11 橙
  '#ff0000', // 12 红
  '#ff0080', // 13 粉
  '#ff00ff', // 14 品红
  '#8000ff', // 15 紫
];

/* ================================================================== */
/* 事件入场（恶魔广场 0x90 / 血色城堡 0x9A）+ 赛事状态（0x91-0x93）      */
/* ================================================================== */

/**
 * 协议血缘：`DevilSquare.cpp:1341`（`CGDevilSquareEnterRecv`）、
 * `BloodCastle.cpp:2074`（`CGBloodCastleEnterRecv`）、
 * `Protocol.cpp:898`（`CGEventRemainTimeRecv`）+
 * Win 端 `SecondPassword.cpp:917-1005`（点击）+ `Net_Events.cpp:46-171`（收包）。
 *
 * 四个必须记住的点：
 *
 *   1. **两个事件都从 NPC 进，不从物品进。** 恶魔广场是诺利亚的
 *      Charon 237（`NpcCharon`），血色城堡是诺利亚的
 *      Messenger of Archangel 233（`NpcAngelMessenger`）。两者都回
 *      **0x30**：result=4 / 6。之前本 port 把 4 / 6 当成「拒绝对话」，
 *      所以这两个 NPC 一直像坏了一样。
 *   2. **回执之前服务端先发等级表**（0x8E / 0x8F），里面是每一档的
 *      min/max 等级，界面上的「Square 3 (180 - 229 level)」就是它。
 *   3. **上行 slot 是「背包绝对槽位」**（含 12 个装备位），服务端统一
 *      `slot -= INVENTORY_WEAR_SIZE`。0.97 客户端在恶魔广场那一路写的是
 *      `slot + 24`，那是它自己 `GetItemSlot` 的 0-based 语义，照抄会越界。
 *   4. **level 语义两边相反**：恶魔广场 0-based（0..3），血色城堡
 *      1-based（1..6，服务端 `level -= 1`）。
 */

/** 0x91 的 `EventType`（`PMSG_EVENT_REMAIN_TIME_RECV`） */
export const EVENT_TYPE = {
  DEVIL_SQUARE: 1,
  BLOOD_CASTLE: 2,
} as const;

/** 恶魔广场档数（`MAX_DS_LEVEL`） */
export const DS_LEVELS = 4;
/** 血色城堡档数（`MAX_BC_LEVEL`） */
export const BC_LEVELS = 6;

export interface EventLevelRange {
  min: number;
  max: number;
}

/**
 * 上行 0x90：进恶魔广场（`C1 05 90 level slot`）。
 *
 * `level` 0-based（0..3），`slot` 是背包绝对槽位（12..75）。
 * 服务端校验：票必须是 `GET_ITEM(14,19)`（467，`Devil's Invitation`）、
 * 票的 `m_Level` 必须等于 `level + 1`、入口开着、人数没满、等级在档内。
 */
export function buildDevilSquareEnterPacket(level: number, invSlot: number): Uint8Array {
  return new Uint8Array([0xc1, 5, 0x90, level & 0xff, invSlot & 0xff]);
}

/**
 * 上行 0x9A：进血色城堡（`C1 05 9A level slot`）。
 *
 * `level` **1-based**（1..6），`slot` 是背包绝对槽位。
 * 票是 `GET_ITEM(13,18)`（434，`Cloak of Invisibility`），
 * 票的 `m_Level` 必须等于 `level`。
 */
export function buildBloodCastleEnterPacket(level: number, invSlot: number): Uint8Array {
  return new Uint8Array([0xc1, 5, 0x9a, level & 0xff, invSlot & 0xff]);
}

/**
 * 上行 0x91：查「还有多久开」（`C1 05 91 EventType ItemLevel`）。
 *
 * 这是**右键点票**的动作（`Item_ClickHandler.cpp:1021`）：467（恶魔广场票）
 * → EventType 1，434（隐身斗篷）→ EventType 2；`ItemLevel` 就是票的 `m_Level`。
 * 服务端自己 `ItemLevel - 1` 去索引档位。
 *
 * 回执的 `RemainTime` 是**分钟**（`GetRemainTime` 里 `RemainTime/60` 向上取整），
 * 0 = 现在就能进。
 */
export function buildEventRemainTimePacket(eventType: number, itemLevel: number): Uint8Array {
  return new Uint8Array([0xc1, 5, 0x91, eventType & 0xff, itemLevel & 0xff]);
}

/** 下行 0x90 / 0x9A：入场结果（`C1 04 xx result`，0 = 成功） */
export function parseEventEnterResult(
  pkt: Uint8Array,
  opcode: 0x90 | 0x9a
): { result: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== opcode || pkt.length < 4) return null;
  return { result: pkt[3] };
}

/** 下行 0x91：`C1 05 91 EventType RemainTime(分钟)` */
export function parseEventRemainTime(pkt: Uint8Array): { eventType: number; minutes: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x91 || pkt.length < 5) return null;
  return { eventType: pkt[3], minutes: pkt[4] };
}

/**
 * 下行 0x8E / 0x8F：各档等级要求。
 *
 * 服务端这两个结构体**没有 `#pragma pack(1)`**（`DevilSquare.h:37` /
 * `BloodCastle.h:41`），`PBMSG_HEAD` 是 3 字节、后面接 `int`，所以 MSVC 插
 * 1 个对齐字节：0x8E 发 36 字节（int 从 +4 起），0x8F 发 100 字节。
 * 但别的服务端实现（MuEmu 原版）是 packed 的 35 / 99 字节（int 从 +3 起）。
 * 两种都认：长度够就按 +4 读，否则按 +3 读。
 *
 * 0x8E 是 `int[4][2]`（min/max 交替），0x8F 是 `int[6][4]`：
 * `[0]` min `[1]` max（普通职业）、`[2]` min `[3]` max（魔剑士）。
 * 客户端 `Recv_BloodCastleRequiredLevels` 把两组摊成 12 行的表。
 */
export function parseEventRequiredLevels(
  pkt: Uint8Array,
  kind: 'ds' | 'bc'
): EventLevelRange[] | null {
  const opcode = kind === 'ds' ? 0x8e : 0x8f;
  if (pkt[0] !== 0xc1 || pkt[2] !== opcode) return null;

  const rows = kind === 'ds' ? DS_LEVELS : BC_LEVELS;
  const cols = kind === 'ds' ? 2 : 4;
  const valueBytes = rows * cols * 4;
  if (pkt.length < 3 + valueBytes) return null;
  const base = pkt.length >= 4 + valueBytes ? 4 : 3;

  const out: EventLevelRange[] = [];
  if (kind === 'ds') {
    for (let r = 0; r < rows; r++) {
      out.push({ min: readS32(pkt, base + r * 8), max: readS32(pkt, base + r * 8 + 4) });
    }
    return out;
  }

  // 0x8F：前 6 行普通职业，后 6 行魔剑士（`level + 6`）
  const normal: EventLevelRange[] = [];
  const mg: EventLevelRange[] = [];
  for (let r = 0; r < rows; r++) {
    const o = base + r * 16;
    normal.push({ min: readS32(pkt, o), max: readS32(pkt, o + 4) });
    mg.push({ min: readS32(pkt, o + 8), max: readS32(pkt, o + 12) });
  }
  return normal.concat(mg);
}

/**
 * 下行 0x9B：赛事状态（`PMSG_BLOOD_CASTLE_STATE_SEND`，血堡和恶魔广场共用）。
 *
 *   +3      state（0 = 开始，1/4 = 进行中）
 *   +4..5   time（秒）
 *   +6..7   MaxMonster
 *   +8..9   CurMonster
 *   +10..11 EventItemOwner（对象号，-1 = 没人拿）
 *   +12     EventItemLevel（0xFF = 没有事件道具）
 *
 * 这个结构体在 `BloodCastle.h:65` 是 packed 的（`#pragma pack(1)` 在 47-56
 * 包住了 SCORE_SEND，STATE_SEND 在 58 之后、没有 pack）—— 但字段排布本身
 * 刚好对齐（state 在 +3，第一个 WORD 在 +4），所以两种编译方式字节一致。
 */
export function parseMatchState(pkt: Uint8Array): {
  state: number;
  time: number;
  maxMonster: number;
  curMonster: number;
  itemOwner: number;
  itemLevel: number;
} | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x9b || pkt.length < 13) return null;
  return {
    state: pkt[3],
    time: pkt[4] | (pkt[5] << 8),
    maxMonster: pkt[6] | (pkt[7] << 8),
    curMonster: pkt[8] | (pkt[9] << 8),
    itemOwner: (pkt[10] | (pkt[11] << 8)) << 16 >> 16,
    itemLevel: pkt[12],
  };
}

/**
 * 下行 0x92：赛事倒计时开始（`C1 04 92 type`）。
 *
 * `type` 是 0-based，客户端 `Recv_StartMatchCountDown` 存的是 `Msg[3] + 1`
 * （= 1 恶魔广场 / 2 血色城堡），然后画 30 秒的左下角标语。
 */
export function parseMatchCountDown(pkt: Uint8Array): { type: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x92 || pkt.length < 4) return null;
  return { type: pkt[3] + 1 };
}

export interface DevilSquareRank {
  /** 名次（1-based） */
  rank: number;
  /** 0xFF = 只更新这一条，否则是整表 */
  count: number;
  name: string;
  score: number;
  exp: number;
  money: number;
}

/**
 * 下行 0x93：恶魔广场排名（`GCDevilSquareScoreSend`）。
 *
 * 前 2 字节（rank / count）之后是 `PMSG_DEVIL_SQUARE_SCORE`
 * `{ name[10], score(4), exp(4), money(4) }` = 22 字节。
 * `Msg[4] == 0xFF` 表示只推一条（某人分数变了），否则是整表。
 */
export function parseDevilSquareRank(pkt: Uint8Array): DevilSquareRank | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x93 || pkt.length < 27) return null;
  /*
   * 服务端是这么拼包（`DevilSquare.cpp:1510-1534`）：
   *
   *     BYTE send[256];
   *     int size = sizeof(PMSG_DEVIL_SQUARE_SCORE_SEND);   // = 5（全 BYTE）
   *     memcpy(&send[size], &info, sizeof(info));          // info 从 +5 开始
   *
   * `PMSG_DEVIL_SQUARE_SCORE` 自己含 DWORD，**内部**有一个 2 字节对齐洞：
   * name@0、score@**12**、exp@16、money@20（sizeof 24）。
   *
   * 所以线上：name@5、score@5+12=**17**、exp@21、money@25（总 29 字节）。
   * 以前按 15/19/23 读，正好跳过了那个洞 —— 分数会读成 name 的尾字节。
   */
  return {
    rank: pkt[3],
    count: pkt[4],
    name: readName(pkt, 5, 10),
    score: readU32(pkt, 17),
    exp: readU32(pkt, 21),
    money: readU32(pkt, 25),
  };
}

/* ================================================================== */
/* 黄金弓箭手（0x94 / 0x95 / 0x96 / 0x97 / 0x9D）                      */
/* ================================================================== */

/**
 * 协议血缘：`GoldenArcher.h`（结构体）+ `GoldenArcher.cpp`（判定）+
 * Win 端 `UI/GoldenArcher.cpp:849-1035`（自定义事件流程的收包与绘制）。
 *
 * 这个 NPC 有**两套流程**，用哪个由服务端决定：
 *
 *   - 0.97 原版：0x95 登记 chip / 0x96 取号码 / 0x98 兑换 / 0x9D 刮刮卡；
 *   - MuEmu 自定义事件（**本服务端用的是这套**）：登录时先发一条
 *     `0x97/0x00` 配置包，客户端看到它就把流程切成「Rena / Stone 收集器」。
 *
 * 四个必须记住的点：
 *
 *   1. **0x94 的 `Count` 在 +4，不是 +3。** `PMSG_NPC_GOLDEN_ARCHER_SEND` =
 *      `PBMSG_HEAD`(3) + `BYTE Type` + `short Count`，而 `GoldenArcher.h` 没有
 *      `#pragma pack(1)` → `short` 要 2 字节对齐，+4 正好对齐，于是 +3 之后
 *      有一字节洞？不 —— Type 在 +3，下一个空闲是 +4，`short` 从 +4 开始，
 *      **没有洞，`sizeof` 也只是对齐到 20**。`LuckyNumber` 因此从 **+6** 起。
 *   2. **0x95 回包的 `Count` 是 `short`，-1 表示「背包里没有 Rena/Stone」。**
 *   3. **0x97/0x01 是 C2 长包，`count` 在 +8。** `PSWMSG_HEAD` 是 5 字节
 *      （type + size[2] + head + subh），后面接 `int` 要 4 字节对齐 → 5..7 是洞，
 *      成员从 **+12** 起、每条 13 字节。
 *   4. **登记（0x95）和兑换（0x97/0x02）用的是同一个物品 `GET_ITEM(14,21)`=469**，
 *      靠**等级**区分：`level 0` = Rena、`level 1` = Stone
 *      （`GetInventoryItemSlot(lpObj, GET_ITEM(14,21), lpMsg->Type)`）。
 */

/** `eGoldenArcherTypes` —— 0x94 的 `Type` */
export const GOLDEN_ARCHER_TYPE = {
  RENA: 0,
  STONE: 1,
  LUCKY_EXCHANGE: 2,
  BINGO_LIST: 3,
} as const;

/** Rena / Stone 共用的物品号 `GET_ITEM(14,21)` */
export const GOLDEN_ARCHER_ITEM = 469;

export interface GoldenArcherOpen {
  /** 0 = Rena 收集器（洛兰）1 = Stone 收集器（诺利亚）2 = 幸运号码兑换 3 = 号码列表 */
  type: number;
  /** 已登记的 Rena / Stone 数量（type 2/3 时是 0） */
  count: number;
  /** 自己的幸运号码（12 位数字串，可能为空） */
  lucky: string;
}

export interface GoldenArcherInfo {
  /** 兑换物品袋需要的 Rena 数（4 档，0 = 该档关闭） */
  renaRequired: number[];
  /** 兑换 VIP 需要的 Stone 数（3 档） */
  stoneRequired: number[];
  /** VIP 时长（小时，3 档） */
  stoneVipHours: number[];
  /** 兑换幸运号码需要的 Stone 数（第 4 档，单独一个字段） */
  luckyRequired: number;
}

/* ---------------- 上行 ---------------- */

/**
 * 0x95 登记一件 Rena / Stone（从背包扣 1 件，计数 +1）。
 *
 *   `C1 04 95 [type]`   ← type 0 = Rena、1 = Stone
 */
export function buildGoldenArcherRegisterPacket(type: number): Uint8Array {
  return new Uint8Array([0xc1, 4, 0x95, type & 0xff]);
}

/**
 * 0x97/0x02 兑换。
 *
 *   `C1 08 97 02 [type] [pad] [countLo] [countHi]`
 *
 * `count` 是**档位下标**（0..3），不是数量 —— 服务端拿它去查
 * `m_RenaExchangeRequiredCount[count]`。
 *
 * `short` 在 +6 而不是 +5：`PSBMSG_HEAD` 是 4 字节，`BYTE Type` 在 +4，
 * `short Count` 要 2 字节对齐 → +5 是洞。
 */
export function buildGoldenArcherExchangePacket(type: number, count: number): Uint8Array {
  return new Uint8Array([
    0xc1,
    8,
    0x97,
    0x02,
    type & 0xff,
    0,
    count & 0xff,
    (count >> 8) & 0xff,
  ]);
}

/**
 * 0x97/0x03 登记幸运号码（Stone 第 4 档换来的号码写进账号）。
 *
 *   `C1 11 97 03 [number[13]]`   ← 12 位数字 + NUL
 */
export function buildGoldenArcherRegisterLuckyPacket(number: string): Uint8Array {
  const pkt = new Uint8Array(17);
  pkt[0] = 0xc1;
  pkt[1] = 17;
  pkt[2] = 0x97;
  pkt[3] = 0x03;
  for (let i = 0; i < 12 && i < number.length; i++) pkt[4 + i] = number.charCodeAt(i) & 0xff;
  return pkt;
}

/**
 * 0x9D 用幸运号码领奖。
 *
 *   `C1 10 9D [number[13]]`
 */
export function buildGoldenArcherExchangeLuckyPacket(number: string): Uint8Array {
  const pkt = new Uint8Array(16);
  pkt[0] = 0xc1;
  pkt[1] = 16;
  pkt[2] = 0x9d;
  for (let i = 0; i < 12 && i < number.length; i++) pkt[3 + i] = number.charCodeAt(i) & 0xff;
  return pkt;
}

/* ---------------- 下行 ---------------- */

/**
 * 0x94 打开收集器界面（**不是 0x30**！）。
 *
 *   `C1 14 94 [type] [countLo][countHi] [lucky[13]] [pad]`
 *
 * 服务端 `NpcGoldenArcher` 直接发这条，**不发 0x30** —— 所以客户端必须靠它
 * 判断「面板该弹出来了」。
 */
export function parseGoldenArcherOpen(pkt: Uint8Array): GoldenArcherOpen | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x94) return null;
  if (pkt.length < 6) return null;
  const lucky = pkt.length >= 19 ? readName(pkt, 6, 13) : '';
  return {
    type: pkt[3],
    count: (pkt[4] | (pkt[5] << 8)) << 16 >> 16,
    lucky,
  };
}

/**
 * 0x95 回包：登记后的累计数。
 *
 *   `C1 06 95 [pad] [countLo][countHi]`   ← -1 = 背包里没有 Rena/Stone
 */
export function parseGoldenArcherRegister(pkt: Uint8Array): { count: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x95 || pkt.length < 6) return null;
  return { count: ((pkt[4] | (pkt[5] << 8)) << 16) >> 16 };
}

/** 0x96：服务端推来的幸运号码（`C1 10 96 [number[13]]`） */
export function parseGoldenArcherLuckyNumber(pkt: Uint8Array): { lucky: string } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x96 || pkt.length < 16) return null;
  return { lucky: readName(pkt, 3, 13) };
}

/**
 * 0x97/0x00：兑换配置。
 *
 *   `C1 30 97 00 [rena[4]×4] [stone[4]×4] [vip[3]×4]`   ← 48 字节
 *   `rena` 在 +4、`stone` 在 +20、`vip` 在 +36
 *
 * `stone` 的第 4 个元素是「换幸运号码要多少石头」（配置项
 * `StoneExchangeRequiredLuckyNumber`），不参与 VIP。
 */
export function parseGoldenArcherInfo(pkt: Uint8Array): GoldenArcherInfo | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  // `hs` = 子码的下标：C1 是 +3、C2 的四字节包头是 +4；`head` 永远在它前面一格
  const hs = wide ? 4 : 3;
  if (pkt[hs - 1] !== 0x97 || pkt[hs] !== 0x00 || pkt.length < 48) return null;
  const rena: number[] = [];
  const stone: number[] = [];
  const vip: number[] = [];
  for (let i = 0; i < 4; i++) rena.push(readS32(pkt, 4 + i * 4));
  for (let i = 0; i < 4; i++) stone.push(readS32(pkt, 20 + i * 4));
  for (let i = 0; i < 3; i++) vip.push(readU32(pkt, 36 + i * 4));
  return {
    renaRequired: rena,
    stoneRequired: stone.slice(0, 3),
    stoneVipHours: vip,
    luckyRequired: stone[3] ?? 0,
  };
}

/**
 * 0x97/0x01：自己登记过的幸运号码列表（C2 长包）。
 *
 *   +0..4   PSWMSG_HEAD（type + size[2] + head + subh）
 *   +5..7   padding（`int` 要 4 字节对齐）
 *   +8..11  count
 *   +12..   `char LuckyNumber[13]` × count
 *
 * `s_TotalPages = count / 10 + 1`（一页 10 条），客户端每页画 10 行。
 */
export function parseGoldenArcherList(pkt: Uint8Array): { numbers: string[] } | null {
  const wide = pkt[0] === 0xc2 || pkt[0] === 0xc4;
  if (!wide) return null;
  if (pkt[3] !== 0x97 || pkt[4] !== 0x01) return null;
  if (pkt.length < 12) return null;
  const count = readU32(pkt, 8);
  const numbers: string[] = [];
  for (let i = 0; i < count; i++) {
    const o = 12 + i * 13;
    if (o + 13 > pkt.length) break;
    numbers.push(readName(pkt, o, 13));
  }
  return { numbers };
}

/** 0x97/0x03 回执：`C1 05 97 03 [result]`（0..3 → GlobalText[900..903]） */
export function parseGoldenArcherRegisterLuckyResult(
  pkt: Uint8Array
): { result: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x97 || pkt[3] !== 0x03 || pkt.length < 5) return null;
  return { result: pkt[4] };
}

/** 0x9D 回执：`C1 04 9D [result]`（0..3 → GlobalText[911..914]） */
export function parseGoldenArcherExchangeLuckyResult(
  pkt: Uint8Array
): { result: number } | null {
  if (pkt[0] !== 0xc1 || pkt[2] !== 0x9d || pkt.length < 4) return null;
  return { result: pkt[3] };
}

/** 0x97/0x04：服务端要求关闭窗口（**没有任何 payload**） */
export function isGoldenArcherClose(pkt: Uint8Array): boolean {
  return pkt[0] === 0xc1 && pkt[2] === 0x97 && pkt[3] === 0x04;
}
