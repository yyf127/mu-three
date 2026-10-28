/**
 * 0.97 登录会话：把登录链封装成 Promise，供 UI 使用。
 *
 * 流程（全部按服务端 Protocol.cpp / JSProtocol.cpp 校对）：
 *
 *   服务端 F1/00（握手，带版本号）
 *      → 客户端 F1/04 设置语言        （不先发语言，某些服务端会丢弃登录包）
 *      → 客户端 F1/05 上报 HWID       （不发会被 CBlackList 判成 result=5）
 *      → 客户端 F1/01 登录            （C3，账号密码 XOR {FC,CF,AB}）
 *   服务端 F1/01 result
 *      1=成功  0=密码错  2=账号不存在  3=已连接  5=封禁/黑名单  6=版本不匹配
 *      → 客户端 F3/00 请求角色列表
 *   服务端 F3/00 <count> [slot, name[10], pad, level:2, ctl, charset[11]]×N
 *      → 客户端 F3/03 <name[10]> 选角
 *   服务端 F3/03 角色详细信息（X/Y/Map/Dir/属性…）
 *
 * 期间服务端会下发 0x03 MainCheck 挑战，必须用 C3 原样回显，否则会被判作弊断开。
 */
import type { MuConnection } from './connection';
import { encodeServerText } from './text';

export const LoginResult: Record<number, string> = {
  0: '账号或密码错误',
  1: '成功',
  2: '账号不存在',
  3: '账号已连接',
  4: '服务器账号已满',
  5: '账号被封禁 / HWID 或 IP 在黑名单',
  6: '客户端版本或序列号不匹配',
  8: '失败次数过多',
  11: '服务器锁定',
};

export interface CharacterSummary {
  slot: number;
  name: string;
  level: number;
  ctlCode: number;
  charSet: number[];
}

export interface CharacterInfo {
  x: number;
  y: number;
  map: number;
  dir: number;
  experience: number;
  nextExperience: number;
  levelUpPoint: number;
  strength: number;
  dexterity: number;
  vitality: number;
  energy: number;
  life: number;
  maxLife: number;
  mana: number;
  maxMana: number;
  bp: number;
  maxBp: number;
  money: number;
  pkLevel: number;
  ctlCode: number;
  fruitAddPoint: number;
  maxFruitAddPoint: number;
  raw: Uint8Array;
}

const ARG_XOR = [0xfc, 0xcf, 0xab];

/** 账号/密码的传输编码：逐字节 XOR，服务端 PacketArgumentDecrypt 会解回来 */
function encodeArg(text: string, size = 10): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const ch = i < text.length ? text.charCodeAt(i) : 0;
    out[i] = (ch ^ ARG_XOR[i % 3]) & 0xff;
  }
  return out;
}

function buildPacket(type: number, head: number, sub: number, payload: Uint8Array) {
  const p = new Uint8Array(4 + payload.length);
  p[0] = type;
  p[1] = p.length;
  p[2] = head;
  p[3] = sub;
  p.set(payload, 4);
  return p;
}

export interface LoginOptions {
  account: string;
  password: string;
  /** 上报的硬件指纹，空字符串会被服务端当作黑名单 */
  hwid: string;
  clientVersion: string;
  clientSerial: string;
  lang?: number;
  timeoutMs?: number;
}

export class MuSession {
  private conn: MuConnection;
  private pending = new Map<string, (packet: Uint8Array) => void>();
  private unsubscribe: (() => void) | null = null;

  /** 收到服务端 F1/02 时触发（被踢/正常关服） */
  onClose: ((reason: number) => void) | null = null;
  /** 调试：每个收到的包 */
  onPacket: ((packet: Uint8Array) => void) | null = null;

  constructor(conn: MuConnection) {
    this.conn = conn;
    this.unsubscribe = conn.onPacket(p => this.dispatch(p));
  }

  private liveTimer: ReturnType<typeof setInterval> | null = null;

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopLive();
  }

  /**
   * 保活心跳：`PMSG_LIVE_CLIENT_RECV`（C3 0E）。
   *
   *   C3 0B 0E [TickCount:4] [PhysiSpeed:2] [MagicSpeed:2]
   *
   * 进图后服务端会盯着这个包，长时间不发会被判定掉线（实测约 60 秒
   * socket 被服务端主动回收，日志是 `WSASend() failed with error: 10038`）。
   */
  startLive(physiSpeed = 20, magicSpeed = 20) {
    this.stopLive();
    const beat = () => {
      try {
        const pkt = new Uint8Array(11);
        pkt[0] = 0xc3;
        pkt[1] = 11;
        pkt[2] = 0x0e;
        const tick = Date.now() >>> 0;
        pkt[3] = tick & 0xff;
        pkt[4] = (tick >>> 8) & 0xff;
        pkt[5] = (tick >>> 16) & 0xff;
        pkt[6] = (tick >>> 24) & 0xff;
        pkt[7] = physiSpeed & 0xff;
        pkt[8] = (physiSpeed >>> 8) & 0xff;
        pkt[9] = magicSpeed & 0xff;
        pkt[10] = (magicSpeed >>> 8) & 0xff;
        this.conn.send(pkt);
      } catch {
        /* 连接已断，等 onClose 处理 */
      }
    };
    beat();
    this.liveTimer = setInterval(beat, 10000);
  }

  stopLive() {
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = null;
  }

  /**
   * 正常退出：给服务端发 F1/02（CGCloseClientRecv）。
   * 不发这个包直接断 socket，账号会一直挂在 JoinServer 的在线表里，
   * 下次登录会返回 result=3「账号已连接」。
   */
  closeClient(type = 0) {
    this.stopLive();
    this.conn.send(new Uint8Array([0xc3, 0x05, 0xf1, 0x02, type]));
  }

  /**
   * 发一条普通聊天（`CGChatRecv`）。
   *
   *   C1 49 00 name[10] message[60]
   *
   * 服务端会 `strcmp(lpMsg->name, lpObj->Name)`，**名字必须填自己的**，
   * 否则整包被静默丢弃。带 `/` 前缀的会被当命令处理（`/drop`、`/move`…）。
   */
  sendChat(name: string, message: string) {
    const pkt = new Uint8Array(3 + 10 + 60);
    pkt[0] = 0xc1;
    pkt[1] = pkt.length;
    pkt[2] = 0x00;
    /*
     * 名字 10 字节、正文 60 字节（留 1 字节 0 结尾），**按服务端字符集编码**。
     * 以前是 `charCodeAt(i) & 0xff`，中文会被截成单字节垃圾 —— 服务端广播回来
     * 就是乱码（见 `net/text.ts` 头注释）。
     */
    pkt.set(encodeServerText(name, 10), 3);
    pkt.set(encodeServerText(message, 59), 13);
    this.conn.send(pkt);
  }

  /** 等待头/子头匹配的包 */
  private wait(head: number, sub: number, timeoutMs = 8000): Promise<Uint8Array> {
    const key = `${head}:${sub}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`等待报文超时 ${head.toString(16)}/${sub.toString(16)}`));
      }, timeoutMs);

      this.pending.set(key, packet => {
        clearTimeout(timer);
        this.pending.delete(key);
        resolve(packet);
      });
    });
  }

  private dispatch(packet: Uint8Array) {
    this.onPacket?.(packet);

    const hs = packet[0] === 0xc2 || packet[0] === 0xc4 ? 3 : 2;
    const head = packet[hs];
    const sub = packet[hs + 1];

    // 服务端心跳挑战：必须 C3 回显，否则被判作弊
    if (head === 0x03) {
      const ack = packet.slice();
      ack[0] = 0xc3;
      this.conn.send(ack);
      return;
    }

    if (head === 0xf1 && sub === 0x02) {
      this.onClose?.(packet[hs + 2]);
      return;
    }

    const waiter = this.pending.get(`${head}:${sub}`);
    if (waiter) waiter(packet);
  }

  /**
   * 服务端分配给我的对象索引（`0xF1/0x00` 的 `index` 字段）。
   *
   * 这个值很关键却很容易被忽略：服务端**从不把自己放进 0x12 视野包**
   * （`CViewport::CreateViewportPlayer` 里 `n == aIndex` 直接 continue），
   * 所以「按名字匹配出 selfId」那条路在真机上是走不通的，必须从这里拿。
   *
   * 布局（`PMSG_CONNECT_CLIENT_SEND`，PSBMSG_HEAD 4 字节）：
   *   [0]=C1 [1]=size [2]=F1 [3]=00 [4]=result [5..6]=index [7..11]=version
   */
  selfIndex = -1;

  /** 握手包 F1/00，返回服务端版本 5 字节 */
  async waitGreeting(timeoutMs = 8000) {
    const pkt = await this.wait(0xf1, 0x00, timeoutMs);
    console.log(
      `[MU] F1/00 ${pkt.length}B: ` +
        Array.from(pkt).map(n => n.toString(16).padStart(2, '0')).join(' ')
    );
    this.selfIndex = (pkt[5] << 8) | pkt[6];
    return String.fromCharCode(...pkt.subarray(7, 12));
  }

  /** 登录；返回服务端结果码（1 = 成功） */
  async login(options: LoginOptions): Promise<number> {
    const { account, password, hwid, clientVersion, clientSerial, lang = 0 } = options;

    // F1/04 语言
    const langPkt = new Uint8Array(8);
    langPkt[0] = 0xc3;
    langPkt[1] = 8;
    langPkt[2] = 0xf1;
    langPkt[3] = 0x04;
    new DataView(langPkt.buffer).setInt32(4, lang, true);
    this.conn.send(langPkt);

    // F1/05 HWID（char[36]）
    const hwidPayload = new Uint8Array(36);
    for (let i = 0; i < 36 && i < hwid.length; i++) hwidPayload[i] = hwid.charCodeAt(i) & 0xff;
    this.conn.send(buildPacket(0xc3, 0xf1, 0x05, hwidPayload));

    // F1/01 登录
    const payload = new Uint8Array(45);
    payload.set(encodeArg(account, 10), 0);
    payload.set(encodeArg(password, 10), 10);
    new DataView(payload.buffer).setUint32(20, Date.now() >>> 0, true);
    for (let i = 0; i < 5; i++) payload[24 + i] = clientVersion.charCodeAt(i) & 0xff;
    for (let i = 0; i < 16; i++) payload[29 + i] = clientSerial.charCodeAt(i) & 0xff;
    this.conn.send(buildPacket(0xc3, 0xf1, 0x01, payload));

    const res = await this.wait(0xf1, 0x01, options.timeoutMs ?? 8000);
    return res[res[0] === 0xc2 || res[0] === 0xc4 ? 5 : 4];
  }

  /** 请求角色列表 */
  async requestCharacterList(timeoutMs = 8000): Promise<CharacterSummary[]> {
    this.conn.send(new Uint8Array([0xc1, 0x04, 0xf3, 0x00]));
    const pkt = await this.wait(0xf3, 0x00, timeoutMs);

    const base = pkt[0] === 0xc2 || pkt[0] === 0xc4 ? 3 : 2;
    const body = pkt.subarray(base + 2);
    const count = body[0];
    const list: CharacterSummary[] = [];

    // 每条 26 字节：slot(1) + Name[10] + 对齐填充(1) + Level(2) + CtlCode(1) + CharSet[11]
    let off = 1;
    for (let i = 0; i < count; i++) {
      if (off + 26 > body.length) break;
      const nameBytes = body.subarray(off + 1, off + 11);
      let name = '';
      for (const b of nameBytes) {
        if (b === 0) break;
        name += String.fromCharCode(b);
      }
      list.push({
        slot: body[off],
        name,
        level: body[off + 12] | (body[off + 13] << 8),
        ctlCode: body[off + 14],
        charSet: Array.from(body.subarray(off + 15, off + 26)),
      });
      off += 26;
    }
    return list;
  }

  /**
   * 加一点属性（`0xF3/06`）。`type`：0=力量 1=敏捷 2=体力 3=能量。
   *
   * 包结构 `PSBMSG_HEAD{type,size,head,subh}` + `BYTE type` = 5 字节。
   * 服务端 `CGLevelUpPointRecv` 一次只加 1 点
   * （`CharacterLevelUpPointAdd(obj, type, 1)`），成功回 `result = 16 + type`。
   */
  sendAddPoint(stat: number) {
    this.conn.send(buildPacket(0xc1, 0xf3, 0x06, new Uint8Array([stat & 3])));
  }

  /**
   * 建角（`0xF3/0x01`）。
   *
   * 包结构（`GameServer/Protocol.h` 的 `PMSG_CHARACTER_CREATE_RECV`）：
   *   `PSBMSG_HEAD{C1,F3,01}` + `char name[10]` + `BYTE Class`
   * 回包 `PMSG_CHARACTER_CREATE_SEND`：`result` 0 = 失败，非 0 = 成功。
   * `Class` 用 `DB_CLASS_*`：0 魔法师 / 1 剑士 / 2 弓箭手 / 3 魔剑士。
   */
  async createCharacter(name: string, klass: number, timeoutMs = 10000): Promise<boolean> {
    const payload = new Uint8Array(11);
    for (let i = 0; i < 10 && i < name.length; i++) payload[i] = name.charCodeAt(i) & 0xff;
    payload[10] = klass & 0xff;
    this.conn.send(buildPacket(0xc1, 0xf3, 0x01, payload));

    const pkt = await this.wait(0xf3, 0x01, timeoutMs);
    const base = pkt[0] === 0xc2 || pkt[0] === 0xc4 ? 3 : 2;
    // base+2 跳过 C1/size 和 F3/01 这两组头，落在 result 上
    return pkt[base + 2] !== 0;
  }

  /** 选角进图 */
  async selectCharacter(name: string, timeoutMs = 12000): Promise<CharacterInfo> {
    const namePayload = new Uint8Array(10);
    for (let i = 0; i < 10 && i < name.length; i++) namePayload[i] = name.charCodeAt(i) & 0xff;
    this.conn.send(buildPacket(0xc1, 0xf3, 0x03, namePayload));

    const pkt = await this.wait(0xf3, 0x03, timeoutMs);
    const base = pkt[0] === 0xc2 || pkt[0] === 0xc4 ? 3 : 2;
    const p = pkt.subarray(base + 2);
    const u16 = (o: number) => p[o] | (p[o + 1] << 8);
    const u32 = (o: number) => (p[o] | (p[o + 1] << 8) | (p[o + 2] << 16) | (p[o + 3] << 24)) >>> 0;

    return {
      x: p[0],
      y: p[1],
      map: p[2],
      dir: p[3],
      experience: u32(4),
      nextExperience: u32(8),
      levelUpPoint: u16(12),
      strength: u16(14),
      dexterity: u16(16),
      vitality: u16(18),
      energy: u16(20),
      life: u16(22),
      maxLife: u16(24),
      mana: u16(26),
      maxMana: u16(28),
      bp: u16(30),
      maxBp: u16(32),
      // Money 是 DWORD，编译器会把它对齐到 4 字节边界 → 前面有 2 字节填充
      money: u32(36),
      pkLevel: p[40],
      ctlCode: p[41],
      fruitAddPoint: u16(42),
      maxFruitAddPoint: u16(44),
      raw: p.slice(),
    };
  }
}
