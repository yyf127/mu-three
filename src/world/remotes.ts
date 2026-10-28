/**
 * 视野内的远程实体（其它玩家 / 怪物 / NPC）。
 *
 * 负责：
 *   - 解析 0x12（玩家视野）/ 0x13（怪物视野）/ 0x14（离开）/ 0x11（移动）
 *   - 按需创建 three.js 的 Actor，并按目标格平滑移动
 *   - 攻击链路：0x18 动作、0x15 伤害、0x9C 死亡
 *   - 地图切换时整体清理
 */
import * as THREE from 'three';
import {
  Actor,
  PlayerAction,
  applyEquipment,
  createCreatureByClass,
  createPlayer,
  disposeActor,
  MODEL_YAW_OFFSET,
  type EquipSet,
} from './actor';
import { decodeCharSet } from '../data/charSet';
import { MONSTER_ACTION } from './monsterModels';
import type { TerrainMesh } from './terrain';
import {
  parseAction,
  parseDamage,
  parseItemChange,
  parseMonsterDie,
  parseMove,
  parsePosition,
  parseViewportChanges,
  parseViewportDestroy,
  parseViewportGuildInfo,
  parseViewportGuildMember,
  parseViewportMonsters,
  parseViewportPlayers,
  parseViewportSummons,
  yawFromDir,
  type ViewportChange,
  type ViewportMonster,
  type ViewportPlayer,
} from '../net/game';

export interface RemoteEntity {
  id: number;
  actor: Actor;
  kind: 'player' | 'monster' | 'npc';
  name: string;
  /** 怪物 / NPC 的 Class */
  cls: number;
  /** 目标格（服务端下发的终点） */
  tx: number;
  ty: number;
  /** 血量（服务端伤害包里带 ViewCurHP） */
  life: number;
  maxLife: number;
  /** 死亡中：播完倒地动作后自动移除 */
  dying: boolean;
  dieTimer: number;
  /** 战盟名（0x5C / 0x5A 下发；空 = 无盟）。标志 32 字节也一起存着，留给以后的模型贴图 */
  guildName?: string;
  guildMark?: Uint8Array;
  /**
   * 12 个装备槽的物品类型（-1 = 空），来源两条：
   *   - 进视野时的 `CharSet[11]`（`decodeCharSet`）
   *   - 之后 `0x25` 的单件增量
   */
  equip: number[];
  /** 变身成的怪物类型（`0x45` 的 skin；0 = 人形） */
  skin: number;
  /** 重算外观的串行令牌：切装很快时避免两次 `applyEquipment` 交错 */
  equipSeq: number;
}

/** 远程实体的移动速度，和本地走路保持一致 */
const REMOTE_SPEED = 2.6;
/** 死亡动作播完到移除实体的时间（秒） */
const CORPSE_TIME = 2.6;

/**
 * 占位记录。
 *
 * 和「实体」分开存：`NO_MODEL_CLASSES`（守卫、传送门等）在客户端没有模型，
 * 以前建模型失败就直接 return，连格子也不占，于是角色能从守卫身上走过去。
 * 服务端的视野包本身只给坐标，占位不依赖有没有模型。
 */
interface Blocker {
  /** 服务端下发的当前格 */
  x: number;
  y: number;
  /** 服务端下发的目标格（移动中的实体占这一格） */
  tx: number;
  ty: number;
  /** 尸体不再占位 */
  dying: boolean;
}

export interface DamageHit {
  id: number;
  name: string;
  damage: number;
  type: number;
  x: number;
  y: number;
  z: number;
}

export class RemoteManager {
  private scene: THREE.Scene;
  private playerDir: string;
  private monsterDir: string;
  private npcDir: string;
  private terrain: TerrainMesh | null = null;
  private entities = new Map<number, RemoteEntity>();
  /** 占位表：与模型解耦，没有模型的守卫/传送门也在这里 */
  private blockerMap = new Map<number, Blocker>();
  /** 自己的实体 id：服务端会把自己的移动/复位包也发回来，要走单独的分支 */
  selfId = -1;
  /** 没有模型的 Class，只警告一次 */
  private warnedTypes = new Set<number>();
  /** 正在创建的实体，避免同一 id 连续两条 0x12 时重复建模型 */
  private pending = new Set<number>();
  /** 0x5B 下发的「谁属于哪个盟」（只有编号，名字/标志靠 0x5A/0x5C 补） */
  guildMembers: { user: number; guild: number }[] = [];

  onCountChange: ((players: number, monsters: number) => void) | null = null;
  /** 有人受伤：用于飘伤害数字 */
  onDamage: ((hit: DamageHit) => void) | null = null;
  /** 怪物死亡：用于显示经验 */
  onDie: ((id: number, experience: number) => void) | null = null;
  /** 自己挨打：用于更新 HP 球 */
  onSelfDamage: ((damage: number, life: number) => void) | null = null;
  /**
   * 把自己位置同步回来。
   * @param authoritative true 表示这是服务端的强制纠偏（0x11），本地必须跟随；
   *   false 只是我们上行 0x10 的回声，不能拿它改本地坐标。
   */
  onSelfMove: ((x: number, y: number, dir: number, authoritative: boolean) => void) | null = null;
  /**
   * 视野包里的 `ViewSkillState`（0x12 玩家 / 0x13 怪物都带）。
   *
   * 这是「进视野时身上已经挂着的 buff」的唯一来源 —— `0x07` 只在 buff 起/停
   * 那一刻发，先进视野的人永远不会收到那一刻的包。离开视野（0x14）时用
   * `mask = 0` 回调一次，让 buff 视觉跟着消失。
   */
  onSkillState: ((id: number, mask: number) => void) | null = null;
  /** 实体离开视野（0x14）：身上的 buff 视觉要一起删 */
  onEntityGone: ((id: number) => void) | null = null;

  /** 调试：最近一次解析结果 */
  debug = {
    last12: -2,
    last13: -2,
    last14: -2,
    last11: -2,
    selfName: '',
    types: [] as number[],
    selfMoves: 0,
    damages: 0,
    dies: 0,
    lastDieExp: -1,
    lastDamage: { dmg: -1, life: -1 },
  };

  constructor(scene: THREE.Scene, playerDir: string, monsterDir: string, npcDir = '/Data/NPC/') {
    this.scene = scene;
    this.playerDir = playerDir;
    this.monsterDir = monsterDir;
    this.npcDir = npcDir;
  }

  setTerrain(terrain: TerrainMesh) {
    this.terrain = terrain;
  }

  get count() {
    let players = 0;
    let monsters = 0;
    for (const e of this.entities.values()) {
      if (e.kind === 'player') players++;
      else if (e.kind === 'monster') monsters++;
    }
    return { players, monsters };
  }

  list() {
    return [...this.entities.values()].map(e => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      cls: e.cls,
      hp: e.life,
      maxHp: e.maxLife,
      dying: e.dying,
      // 世界坐标（格心，已经带 +0.5）：给标签/特效/投影用，和 three 里的真实位置一致
      x: +e.actor.wx.toFixed(2),
      y: +e.actor.wy.toFixed(2),
      // 目标格（服务端下发的终点）：占位用的是这个，不是插值中的 x/y
      tx: e.tx,
      ty: e.ty,
      guild: e.guildName ?? '',
      /** 变身成的怪物类型（0 = 人形） */
      skin: e.skin,
      /** 12 个装备槽的物品类型（-1 = 空） */
      equip: [...e.equip],
      /** 战盟标志（32 字节，`0x5A`/`0x5C` 下发） */
      mark: e.guildMark ? e.guildMark.length : 0,
    }));
  }

  clear() {
    for (const e of this.entities.values()) disposeActor(this.scene, e.actor);
    this.entities.clear();
    this.blockerMap.clear();
    // 注意：selfId 不清。切地图时服务端不会再发一次「自己」那条，
    // 清了就永远不知道哪个 id 是自己了。只有重新登录时才重置。
    this.notify();
  }

  /**
   * 按屏幕位置精确拾取一个实体（点**模型**才算点到）。
   *
   * 以前 `pickMonsterAt` / `pickNpcAt` 用的是「投影点到鼠标的距离 < 70px」，
   * 70px 在 1600×900 下差不多是 1.7 格 —— 怪站在旁边时，它周围两格的
   * 地面全被吃掉，点过去变成「攻击/对话」，人当然不走。这就是实机反馈的
   * 「地面有时候点不动」。原版客户端是拿模型的屏幕包围盒做 `PickObject`，
   * 这里改成对骨骼模型做一次真射线求交（只在点击时算一次，不占帧）。
   *
   * 兜底：模型还在异步加载时做一次按包围盒缩放的屏幕判定（半径按模型
   * 投影高度算，约 0.5 格），不会再出现「一大片地面点不到」。
   */
  pickAt(
    camera: THREE.Camera,
    clientX: number,
    clientY: number,
    rect: { left: number; top: number; width: number; height: number },
    kind: 'monster' | 'npc'
  ): number | null {
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    const targets: THREE.Object3D[] = [];
    const byObject = new Map<THREE.Object3D, number>();
    for (const e of this.entities.values()) {
      if (e.kind !== kind || e.dying) continue;
      targets.push(e.actor.root);
      byObject.set(e.actor.root, e.id);
    }
    if (!targets.length) return null;

    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hits = ray.intersectObjects(targets, true);
    if (hits.length) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o) {
        const id = byObject.get(o);
        if (id !== undefined) return id;
        o = o.parent;
      }
    }

    // 兜底：模型没加载完 / 射线擦边 —— 用投影包围盒（脚到头顶）判断
    return this.hoverAt(camera, clientX, clientY, rect, kind);
  }

  /**
   * 只要「鼠标是不是压在这个实体身上」（屏幕包围盒），**不做射线求交**。
   *
   * 光标每 60ms 就要换一次，射线打在几十个骨骼模型上太贵；包围盒只是几次
   * `Vector3.project`，足够判断"指到谁了"。点击仍然走 `pickAt`（精确）。
   */
  hoverAt(
    camera: THREE.Camera,
    clientX: number,
    clientY: number,
    rect: { left: number; top: number; width: number; height: number },
    kind: 'monster' | 'npc'
  ): number | null {
    const v = new THREE.Vector3();
    let bestId: number | null = null;
    let bestDist = Infinity;
    for (const e of this.entities.values()) {
      if (e.kind !== kind || e.dying) continue;
      const px = e.actor.wx;
      const py = e.actor.wy;
      const z = e.actor.z;
      v.set(px, py, z).project(camera);
      if (v.z > 1) continue;
      const fx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
      const fy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      v.set(px, py, z + 1.5).project(camera);
      const hx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
      const hy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      const height = Math.max(8, Math.hypot(hx - fx, hy - fy));
      // 身体大致是 0.55 格宽 —— 只允许点在身上那一条
      const rx = height * 0.34;
      if (Math.abs(clientX - (fx + hx) / 2) > rx) continue;
      if (clientY < hy - height * 0.15 || clientY > fy + 4) continue;
      const d = Math.hypot(clientX - fx, clientY - fy);
      if (d < bestDist) {
        bestDist = d;
        bestId = e.id;
      }
    }
    return bestId;
  }

  /**
   * 当前被单位占用的格子（服务端坐标，格 = 1 单位）。
   *
   * 用目标格 `tx/ty` 而不是平滑移动中的 `actor.x/y`：
   * 客户端寻路也是按「实体要去的那一格」挡路的，用插值中的浮点位置
   * 会出现「走到一半让不开」的抖动。
   */
  blockerCells(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const b of this.blockerMap.values()) {
      if (b.dying) continue;
      out.push({ x: b.tx, y: b.ty });
    }
    return out;
  }

  private setBlocker(id: number, x: number, y: number, tx: number, ty: number) {
    const b = this.blockerMap.get(id);
    if (b) {
      b.x = x;
      b.y = y;
      b.tx = tx;
      b.ty = ty;
      b.dying = false;
      return;
    }
    this.blockerMap.set(id, { x, y, tx, ty, dying: false });
  }

  /** 实体位移后同步占位（0x10 / 0x11） */
  private moveBlocker(id: number, x: number, y: number) {
    const b = this.blockerMap.get(id);
    if (!b) return;
    b.x = x;
    b.y = y;
    b.tx = x;
    b.ty = y;
  }

  /** 按 id 取实体（用于攻击判定 / HUD） */
  /**
   * 0x5C / 0x5D：给某个远端实体挂上 / 清掉战盟信息。
   *
   * 0.97 里这对应「别人进视野时服务端补发 0x5C」，客户端用它在头顶画盟名
   * 和标志。本 port 先把数据收下来（`state().remotes[].guild`），
   * 3D 标志贴图那一层还没做。
   */
  setGuild(id: number, name: string, mark?: Uint8Array) {
    const e = this.entities.get(id);
    if (!e) return false;
    e.guildName = name;
    if (mark) e.guildMark = mark.slice();
    this.notify();
    return true;
  }

  get(id: number) {
    return this.entities.get(id) ?? null;
  }

  /** 找最近的活着的怪物（攻击用），range 为格数 */
  nearestMonster(x: number, y: number, range = 3.2) {
    let best: RemoteEntity | null = null;
    let bestDist = range;
    for (const e of this.entities.values()) {
      if (e.kind !== 'monster' || e.dying) continue;
      const d = Math.hypot(e.tx - x, e.ty - y);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best ? { id: best.id, name: best.name, tx: best.tx, ty: best.ty, dist: bestDist } : null;
  }

  /** 处理一个已解密的报文；返回 true 表示这条报文被吃掉了 */
  handle(pkt: Uint8Array): boolean {
    const head = pkt[0] === 0xc2 || pkt[0] === 0xc4 ? pkt[3] : pkt[2];

    if (head === 0x12) {
      const players = parseViewportPlayers(pkt);
      this.debug.last12 = players ? players.length : -1;
      this.debug.selfName = selfName;
      if (!players) return false;
      for (const p of players) this.upsertPlayer(p);
      this.notify();
      return true;
    }

    if (head === 0x13) {
      const monsters = parseViewportMonsters(pkt);
      this.debug.last13 = monsters ? monsters.length : -1;
      for (const m of monsters ?? []) {
        if (!this.debug.types.includes(m.type)) this.debug.types.push(m.type);
      }
      if (!monsters) return false;
      for (const m of monsters) this.upsertMonster(m);
      this.notify();
      return true;
    }

    if (head === 0x1f) {
      this.handleSummons(pkt);
      return true;
    }

    if (head === 0x45) {
      const list = parseViewportChanges(pkt);
      if (!list) return false;
      for (const c of list) void this.handleSkinChange(c);
      return true;
    }

    if (head === 0x25) {
      this.handleItemChange(pkt);
      return true;
    }

    if (head === 0x5a || head === 0x5b) {
      this.handleViewportGuild(pkt);
      return true;
    }

    if (head === 0x14) {
      for (const id of parseViewportDestroy(pkt)) this.remove(id);
      this.notify();
      return true;
    }

    // 0x10 移动结果（PROTOCOL_CODE1）
    if (head === 0x10) {
      const ev = parseMove(pkt);
      if (ev.id === this.selfId) {
        // 服务端接受上行 0x10 后回的广播（x/y 是它算出的终点）。
        // 别拿它搬本地位置：一发多包时它们会依次到达，每搬一次就打断当前路径。
        this.debug.selfMoves++;
        this.onSelfMove?.(ev.x, ev.y, ev.dir, false);
        return true;
      }
      const entity = this.entities.get(ev.id);
      if (entity) {
        entity.tx = ev.x;
        entity.ty = ev.y;
        entity.actor.yaw = yawFromDir(ev.dir, MODEL_YAW_OFFSET);
      }
      // 没有模型的实体（守卫/传送门）也要跟着走位
      this.moveBlocker(ev.id, ev.x, ev.y);
      return true;
    }

    // 0x11 位置强制同步（服务端认为我们位置不对时会把我们拉回去）
    if (head === 0x11 && pkt.length >= 7) {
      const pos = parsePosition(pkt);
      if (pos.id === this.selfId) {
        this.onSelfMove?.(pos.x, pos.y, -1, true);
      } else {
        const e = this.entities.get(pos.id);
        if (e) {
          e.tx = pos.x;
          e.ty = pos.y;
          e.actor.x = pos.x;
          e.actor.y = pos.y;
        }
        this.moveBlocker(pos.id, pos.x, pos.y);
      }
      return true;
    }

    // 0x18 动作广播（含自己）
    const action = parseAction(pkt);
    if (action) {
      this.applyAction(action.id, action.dir, action.action);
      return true;
    }

    // 0x15 伤害（下行；上行同名协议不会走到这里）
    const dmg = parseDamage(pkt);
    if (dmg) {
      this.debug.damages++;
      this.applyDamage(dmg.targetId, dmg.damage, dmg.type, dmg.life, dmg.flag);
      return true;
    }

    // 0x9C 死亡 / 经验（C3）
    const die = parseMonsterDie(pkt);
    if (die) {
      this.debug.dies++;
      this.kill(die.id, die.experience);
      return true;
    }

    return false;
  }

  private applyAction(id: number, dir: number, action: number) {
    const e = this.entities.get(id);
    if (!e) return;
    e.actor.yaw = yawFromDir(dir, MODEL_YAW_OFFSET);
    if (e.kind === 'player') {
      // 玩家的攻击动作编号就是服务端广播的那个
      e.actor.play(action, !isPlayerAttack(action));
    } else {
      // 怪物动作组是 0..5，服务端广播的是玩家编号，只区分「是不是攻击」
      e.actor.play(isPlayerAttack(action) ? MONSTER_ACTION.ATTACK1 : MONSTER_ACTION.STOP, false);
    }
  }

  private applyDamage(targetId: number, damage: number, type: number, life: number, flag: boolean) {
    this.debug.lastDamage = { dmg: damage, life };
    if (targetId === this.selfId) {
      // 服务端把「自己挨打」也发回来（GCDamageSend 会给两端各发一份）
      this.onSelfDamage?.(damage, life);
      return;
    }

    const e = this.entities.get(targetId);
    if (!e) return;

    if (life >= 0) {
      e.life = life;
      // 服务端只给「当前 HP」，第一次受伤时用 life + damage 反推上限
      if (e.maxLife <= 0) e.maxLife = life + damage;
      if (e.maxLife < life) e.maxLife = life;
    }
    if (flag || (life === 0 && damage > 0)) {
      this.kill(targetId, 0);
      return;
    }

    this.onDamage?.({
      id: targetId,
      name: e.name,
      damage,
      type,
      x: e.actor.x,
      y: e.actor.y,
      z: e.actor.z + 1.4,
    });
  }

  private kill(id: number, experience: number) {
    // 先标记占位：没有模型的实体（守卫/传送门）也要能「死掉」从而让开格子
    const b = this.blockerMap.get(id);
    if (b) b.dying = true;

    const e = this.entities.get(id);
    if (!e) {
      /*
       * 实体已经不在了（先离开视野 / 刚被删）也**必须把经验发出去** ——
       * 经验是给「杀怪的人」的，跟他还看不看得见那具尸体无关。
       * 原版是 `CharacterAttribute+16 += Exp`，压根不看实体表。
       */
      if (experience > 0) {
        this.debug.lastDieExp = experience;
        this.onDie?.(id, experience);
      }
      return;
    }

    if (e.dying) {
      // 血量归零时先被 0x15 判死，随后 0x9C 才带经验到达 —— 经验不能丢
      if (experience > 0) {
        this.debug.lastDieExp = experience;
        this.onDie?.(id, experience);
      }
      return;
    }

    e.dying = true;
    e.dieTimer = CORPSE_TIME;
    e.life = 0;
    e.tx = e.actor.x;
    e.ty = e.actor.y;

    const dieAction = e.kind === 'player' ? 12 : MONSTER_ACTION.DIE;
    if (e.actor.rig.bmd.actions[dieAction]) e.actor.play(dieAction, false);

    if (experience > 0) {
      this.debug.lastDieExp = experience;
      this.onDie?.(id, experience);
    }
  }

  private notify() {
    const { players, monsters } = this.count;
    this.onCountChange?.(players, monsters);
  }

  private upsertPlayer(p: ViewportPlayer) {
    if (p.name === selfName) {
      this.selfId = p.id;
      this.onSkillState?.(p.id, p.skillState);
      // 自己不能占位，否则寻路会把出发点当成障碍
      this.blockerMap.delete(p.id);
      return;
    }
    // 先登记占位再建模型：建模型是异步的，中间这几帧也不能让人穿过去
    this.setBlocker(p.id, p.x, p.y, p.tx || p.x, p.ty || p.y);

    const existing = this.entities.get(p.id);
    if (existing) {
      existing.tx = p.tx || p.x;
      existing.ty = p.ty || p.y;
      existing.actor.yaw = yawFromDir(p.dir, MODEL_YAW_OFFSET);
      // 刷新包里的状态位是**权威值**，直接覆盖（不是增量）
      this.onSkillState?.(p.id, p.skillState);
      return;
    }
    this.onSkillState?.(p.id, p.skillState);
    void this.spawnPlayer(p);
  }

  private async spawnPlayer(p: ViewportPlayer) {
    if (this.pending.has(p.id)) return;
    this.pending.add(p.id);
    try {
      // 外观直接按视野包里的 CharSet 建（原版就是 `createPlayer` 之后
      // 立刻 `ChangeCharacterExt(slot, CharSet+1)`）
      const decoded = decodeCharSet(p.charSet);
      const actor = await createPlayer(this.scene, this.playerDir, decoded.equip);
      const cls = decoded.equip.cls ?? 0;
      actor.root.name = `player-${p.id}`;
      actor.kind = 'player';
      this.place(actor, p.x, p.y, p.dir);
      this.entities.set(p.id, {
        id: p.id,
        actor,
        kind: 'player',
        name: p.name,
        // 玩家的 `cls` 现在存**职业号**（`CharSet[0]` 解出来的 0..3），
        // 换装时要靠它挑 Male/Elf 体型（`bodyOfClass`）
        cls,
        tx: p.tx || p.x,
        ty: p.ty || p.y,
        life: 0,
        maxLife: 0,
        dying: false,
        dieTimer: 0,
        equip: this.equipFromCharSet(p.charSet),
        skin: 0,
        equipSeq: 0,
      });
      this.notify();
    } catch (err) {
      console.warn(`[remote] 创建玩家 ${p.name} 失败`, err);
    } finally {
      this.pending.delete(p.id);
    }
  }

  private async upsertMonster(m: ViewportMonster) {
    // 同样先占位：`NO_MODEL_CLASSES` 里的守卫/传送门没有模型，但仍然要挡路
    this.setBlocker(m.id, m.x, m.y, m.tx || m.x, m.ty || m.y);

    if (this.pending.has(m.id)) return;
    const existing = this.entities.get(m.id);
    if (existing) {
      existing.tx = m.tx || m.x;
      existing.ty = m.ty || m.y;
      existing.actor.yaw = yawFromDir(m.dir, MODEL_YAW_OFFSET);
      this.onSkillState?.(m.id, m.skillState);
      return;
    }
    this.onSkillState?.(m.id, m.skillState);

    this.pending.add(m.id);
    try {
      const created = await createCreatureByClass(
        this.scene,
        { monster: this.monsterDir, npc: this.npcDir },
        m.type
      );
      if (!created) {
        if (!this.warnedTypes.has(m.type)) {
          this.warnedTypes.add(m.type);
          console.info(`[remote] Class=${m.type} 客户端没有模型（守卫/传送门之类），跳过`);
        }
        return;
      }
      const { actor } = created;
      actor.root.name = `monster-${m.id}`;
      this.place(actor, m.x, m.y, m.dir);
      // 召唤物（0x1F）自带名字，普通怪物的 name 字段是空的
      if (m.name) actor.name = m.name;
      this.entities.set(m.id, {
        id: m.id,
        actor,
        kind: actor.kind,
        name: m.name || actor.name,
        cls: m.type,
        tx: m.tx || m.x,
        ty: m.ty || m.y,
        life: 0,
        maxLife: 0,
        dying: false,
        dieTimer: 0,
        equip: new Array(12).fill(-1),
        skin: 0,
        equipSeq: 0,
      });
      this.notify();
    } catch (err) {
      console.warn(`[remote] 创建怪物 ${m.type} 失败`, err);
    } finally {
      this.pending.delete(m.id);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 外观：CharSet / 0x25 单件换装 / 0x45 变身                          */
  /* ---------------------------------------------------------------- */

  /**
   * `CharSet[11]` → 12 个装备槽的物品类型（-1 = 空）。
   *
   * 槽位编号跟背包一致：0 武器 / 1 盾 / 2 头盔 / 3 铠甲 / 4 护腿 /
   * 5 手套 / 6 靴子 / 7 翅膀。`decodeCharSet` 给的是这五件 + 翅膀，
   * 直接摊到同一张表里，之后 `0x25` 的增量也写这张表。
   */
  private equipFromCharSet(charSet: number[] | undefined): number[] {
    const decoded = decodeCharSet(charSet);
    const eq = new Array(12).fill(-1);
    const put = (slot: number, type?: number) => {
      if (type !== undefined) eq[slot] = type;
    };
    put(2, decoded.equip.helm);
    put(3, decoded.equip.armor);
    put(4, decoded.equip.pants);
    put(5, decoded.equip.gloves);
    put(6, decoded.equip.boots);
    put(7, decoded.equip.wing);
    return eq;
  }

  /** 装备槽表 → `EquipSet`（`applyEquipment` 的入参） */
  private equipSetOf(e: RemoteEntity): EquipSet {
    const at = (slot: number) => (e.equip[slot] >= 0 ? e.equip[slot] : undefined);
    return {
      weapon: at(0),
      shield: at(1),
      helm: at(2),
      armor: at(3),
      pants: at(4),
      gloves: at(5),
      boots: at(6),
      wing: at(7),
      // 远程玩家不知道职业位时退回 0（男）；CharSet 里其实有，但只是粗略位
      cls: e.cls >= 0 ? e.cls : 0,
    };
  }

  /** 按当前 `equip` 重算外观（异步，用一个自增序号防交错） */
  private async rebuildEquip(e: RemoteEntity) {
    if (e.kind !== 'player' || e.dying) return;
    const seq = ++e.equipSeq;
    try {
      await applyEquipment(e.actor, this.playerDir, this.equipSetOf(e));
    } catch (err) {
      console.warn(`[remote] ${e.name} 换装失败`, err);
    }
    // 中途又换了装：这一次的结果作废（后一次已经在跑）
    if (seq !== e.equipSeq) return;
  }

  /**
   * `0x25`：别人单件换装。
   *
   * 服务端只把 `ItemInfo[1]` 覆盖成 `slot*16 | level`，物品类型在 `ItemInfo[0]`
   * （第 9 位在 `ItemInfo[3] & 0x80`）。`ItemInfo[0] == 0xFF` = 这个槽空了。
   */
  private handleItemChange(pkt: Uint8Array) {
    const ch = parseItemChange(pkt);
    if (!ch) return;
    const e = this.entities.get(ch.id);
    if (!e || e.kind !== 'player') return;
    if (ch.slot >= 12) return;
    const before = e.equip[ch.slot];
    e.equip[ch.slot] = ch.type;
    if (before === ch.type) return;
    void this.rebuildEquip(e);
  }

  /**
   * `0x45`：视角里有人变身 / 变回来。
   *
   * `skin != 0` 时把这条实体**换成那个怪物模型**（原版走 `CreateMonster` 同一套槽位）；
   * `skin == 0` 是变回人形，按包里的 CharSet 重新建外观。
   */
  private async handleSkinChange(c: ViewportChange) {
    const e = this.entities.get(c.id);
    if (!e) return;
    if (e.skin === c.skin) {
      // 没变皮：只更新位置和装备
      e.tx = c.tx || c.x;
      e.ty = c.ty || c.y;
      if (c.charSet.length) {
        e.equip = this.equipFromCharSet(c.charSet);
        void this.rebuildEquip(e);
      }
      return;
    }

    e.skin = c.skin;
    const wasName = e.name;
    const wasKind = e.kind;
    // 先把旧模型摘掉（保留占位，别让人从人身上穿过去）
    disposeActor(this.scene, e.actor);

    if (c.skin === 0) {
      // 变回人形
      const decoded = decodeCharSet(c.charSet);
      const actor = await createPlayer(this.scene, this.playerDir, decoded.equip);
      actor.root.name = `player-${c.id}`;
      actor.kind = 'player';
      this.place(actor, c.x, c.y, c.dir);
      e.actor = actor;
      e.kind = 'player';
      e.name = wasName;
      e.equip = this.equipFromCharSet(c.charSet);
      e.equipSeq = 0;
    } else {
      const created = await createCreatureByClass(
        this.scene,
        { monster: this.monsterDir, npc: this.npcDir },
        c.skin
      );
      if (!created) {
        // 没有这个模型：把实体整条删掉，免得留下一个隐形的挡路者
        this.entities.delete(c.id);
        this.blockerMap.delete(c.id);
        return;
      }
      created.actor.root.name = `skin-${c.id}`;
      this.place(created.actor, c.x, c.y, c.dir);
      e.actor = created.actor;
      e.kind = created.actor.kind;
      e.cls = c.skin;
      e.name = wasName;
    }
    if (wasKind === 'player' && e.skin !== 0) {
      // 变身期间没有 CharSet 可读，清空装备表
      e.equip = new Array(12).fill(-1);
    }
    this.notify();
  }

  /**
   * `0x1F` 召唤物视野。
   *
   * 记录结构和 0x13 的怪物一样（多一个 10 字节名字），所以直接复用
   * `upsertMonster` —— 名字会覆盖成服务端给的（"Goblin" 之类）。
   */
  private handleSummons(pkt: Uint8Array) {
    const list = parseViewportSummons(pkt);
    if (!list) return;
    for (const s of list) {
      if (!this.warnedTypes.has(s.type)) {
        if (!this.debug.types.includes(s.type)) this.debug.types.push(s.type);
      }
      this.upsertMonster(s);
    }
    this.notify();
  }

  /**
   * `0x5A` / `0x5B`：视野里的战盟信息。
   *
   * 0x5A 直接带盟名 + 32 字节标志，0x5B 只有 `userIndex → guildIndex` 的映射
   * （原版靠它把同盟的人串起来，名字/标志仍要从 0x5C 成员表查）。
   * 这里 0x5A 直接落到实体上；0x5B 只记账（同盟高亮还没做）。
   */
  private handleViewportGuild(pkt: Uint8Array) {
    const info = parseViewportGuildInfo(pkt);
    if (info) {
      for (const g of info) {
        this.setGuild(g.id, g.name, g.mark);
      }
      return;
    }
    const members = parseViewportGuildMember(pkt);
    if (members) {
      this.guildMembers = members;
    }
  }

  private place(actor: Actor, x: number, y: number, dir: number) {
    actor.x = x;
    actor.y = y;
    // 模型渲染在格心（Actor 自己 +0.5），高度也按格心取
    actor.z = this.terrain?.getHeight(x + 0.5, y + 0.5) ?? 0;
    actor.yaw = yawFromDir(dir, MODEL_YAW_OFFSET);
    actor.play(actor.kind === 'player' ? PlayerAction.STOP_MALE : MONSTER_ACTION.STOP, true);
  }

  private remove(id: number) {
    this.blockerMap.delete(id);
    // 离开视野 → 身上的 buff 视觉一起消失（原版实体被删，特效跟着 owner 走）
    this.onEntityGone?.(id);
    const e = this.entities.get(id);
    if (!e) return;
    disposeActor(this.scene, e.actor);
    this.entities.delete(id);
  }

  update(dt: number) {
    if (!this.terrain) return;
    const terrain = this.terrain;

    for (const e of [...this.entities.values()]) {
      const a = e.actor;

      if (e.dying) {
        e.dieTimer -= dt;
        a.z = terrain.getHeight(a.x, a.y);
        a.update(dt);
        if (e.dieTimer <= 0) {
          this.remove(e.id);
          this.notify();
        }
        continue;
      }

      // NPC 站着不动
      const dx = e.kind === 'npc' ? 0 : e.tx - a.x;
      const dy = e.kind === 'npc' ? 0 : e.ty - a.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 0.06) {
        const step = Math.min(dist, REMOTE_SPEED * dt);
        a.x += (dx / dist) * step;
        a.y += (dy / dist) * step;
        // 朝向跟随移动方向
        const target = Math.atan2(dy, dx) + MODEL_YAW_OFFSET;
        let delta = target - a.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        a.yaw += delta * Math.min(1, dt * 10);
        playSafe(a, e.kind === 'player' ? PlayerAction.WALK_MALE : MONSTER_ACTION.MOVE, true);
      } else {
        playSafe(a, e.kind === 'player' ? PlayerAction.STOP_MALE : MONSTER_ACTION.STOP, true);
      }

      a.z = terrain.getHeight(a.x, a.y);
      a.update(dt);
    }
  }
}

/** 动作组不足时退回第 0 组，避免 Frame 取到 undefined */
function playSafe(actor: Actor, action: number, loop: boolean) {
  const act = actor.rig.bmd.actions[action] ? action : 0;
  actor.play(act, loop);
}

/** 玩家的攻击动作区间（34..55），用来判断服务端广播的 action 是不是攻击 */
function isPlayerAttack(action: number) {
  return action >= 34 && action <= 55;
}

/** 由 main.ts 在登录后设置，用来识别「视野里的自己」 */
let selfName = '';
export function setSelfName(name: string) {
  selfName = name;
}
