/**
 * ConnectServer（44405）客户端 —— 登录前的「选择线路」数据源。
 *
 * 原版客户端一进来连的**不是** GameServer，而是 ConnectServer：
 * `Game_SceneUpdate.cpp` 里 `g_HasConnectServer` 为真时先 `CreateSocket(cs, 44405)`，
 * 连上立刻发 `C1 04 F4 02`（`Scene_Login_ServerSelect` 的列表请求）：
 *
 * | 方向 | 包 | 内容 |
 * |---|---|---|
 * | → | `C1 04 F4 02` | 请求服务器列表（**明文**，CS 不做 MuEmu 流加密/Xor32） |
 * | ← | `C1 04 00 01` | 进场回执 result=1 |
 * | ← | `C2 xx F4 04` | 自定义名表：`count(2) + {code(2), name[32]}×N` |
 * | ← | `C2 xx F4 02` | 线路表：`count(1) + {code(2), load(1), pad(1)}×N` |
 * | → | `C1 06 F4 03 code` | 选线路（`C1 06 F4 03 <lo> <hi>`） |
 * | ← | `C1 16 F4 03` | 转向：`address[16] + port(2)` → 去连这台 GameServer |
 *
 * `load`（也就是 `UserTotal`）就是登录界面那排小方块的填充数：
 * `0x80|n` = 满员（红），`n < 100` = 顺畅（绿），`100` = 正常（白）。
 *
 * 服务端侧对照（`MuServer_Source/ConnectServer/ConnectServerProtocol.cpp`）：
 * `case 0xF4: switch(lpMsg[3])` —— 0x02 先回 F4/04 名字表再回 F4/02 列表；
 * 0x03 回 F4/03 地址端口。名字表里 `ServerName[32]` 是 `strcpy_s` 之后
 * 整块 memcpy 出去的，**NUL 之后是栈上的残留**，所以解析必须按 NUL 截断。
 *
 * 这一段是「明文」的，所以不能复用 `MuConnection`（那个会做 Xor32 +
 * SimpleModulus + 流加密），这里直接裸 WebSocket 收发。
 */
import { bridgeUrls } from './connection';

/** ConnectServer 监听端口（服务端 `MuServer/ConnectServer/ConnectServer.ini`） */
export const CS_PORT = 44405;
/** ConnectServer 没起来时的兜底 GameServer 端口 */
export const DEFAULT_GAME_PORT = 55901;

export type LoadState = 'full' | 'low' | 'normal';

export interface ServerChannel {
  /** ServerCode（`F4/03` 回它；显示号 = code%20+1） */
  code: number;
  /** 0..100，`0x80|n` 表示满员 */
  load: number;
}

export interface ServerGroup {
  /** code / 20 */
  group: number;
  /** `F4/04` 给的名字（没有就退回 `Server N`） */
  name: string;
  channels: ServerChannel[];
}

export interface ServerPick {
  host: string;
  port: number;
  /** 选中的 ServerCode，没走 CS 时是 -1 */
  code: number;
}

/** `load` 字节 → 三档状态（`Scene_Login_ServerSelect` Pass 1/4 的判定） */
export function loadState(load: number): LoadState {
  if (load & 0x80) return 'full';
  if ((load & 0x7f) < 100) return 'low';
  return 'normal';
}

/** 满员 → FULL / 顺畅 → LOW / 其余 NORMAL，和原版 GlobalText[560..562] 对齐 */
export function loadText(load: number): string {
  const s = loadState(load);
  return s === 'full' ? '爆满' : s === 'low' ? '顺畅' : '正常';
}

/** 通道显示号：`code % 20 + 1`（源码 Pass 1 的 `% 0x14 + 1`） */
export function channelNo(code: number): number {
  return (code % 20) + 1;
}

interface Packet {
  head: number;
  sub: number;
  body: Uint8Array;
}

/** 按包头声明长度切包（C1/C3 单字节长度，C2/C4 双字节） */
class Splitter {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): Packet[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const out: Packet[] = [];
    let off = 0;
    while (off + 3 <= this.buf.length) {
      const type = this.buf[off];
      let len: number;
      if (type === 0xc1 || type === 0xc3) len = this.buf[off + 1];
      else if (type === 0xc2 || type === 0xc4) len = (this.buf[off + 1] << 8) | this.buf[off + 2];
      else {
        // 认不出类型：整体丢弃，避免卡在垃圾数据上死循环
        this.buf = new Uint8Array(0);
        return out;
      }
      if (len < 3) {
        this.buf = this.buf.subarray(off);
        return out;
      }
      if (off + len > this.buf.length) break;
      const headOff = type === 0xc2 || type === 0xc4 ? 3 : 2;
      out.push({
        head: this.buf[off + headOff],
        sub: this.buf[off + headOff + 1],
        body: this.buf.subarray(off, off + len),
      });
      off += len;
    }
    this.buf = this.buf.subarray(off);
    return out;
  }
}

type Waiter = {
  match: (p: Packet) => boolean;
  resolve: (p: Packet) => void;
  reject: (e: Error) => void;
  timer: number;
};

export class ConnectServerError extends Error {}

export class ConnectServerClient {
  private ws: WebSocket | null = null;
  private splitter = new Splitter();
  private waiters: Waiter[] = [];
  /** `F4/04` 名字表：ServerCode → 名字 */
  private names = new Map<number, string>();
  /** 已经解析到的线路（F4/02 每次刷新都重建） */
  groups: ServerGroup[] = [];
  /** 连的那一端（日志/探针用） */
  readonly label: string;

  private constructor(ws: WebSocket, label: string) {
    this.ws = ws;
    this.label = label;
    ws.addEventListener('message', ev => {
      const chunk = new Uint8Array(ev.data as ArrayBuffer);
      for (const p of this.splitter.push(chunk)) this.dispatch(p);
    });
  }

  /**
   * 依次试 `bridgeUrls` 的候选地址，第一个「连上 + 列表拿到」的胜出。
   *
   * 为什么必须真拿到列表才算成功：网关是「先接 WS、再去连 TCP」，
   * ConnectServer 没起来时 WS 也是通的，接着立刻被网关关掉 —— 光看
   * `onopen` 会误判成成功，界面就会空着一张线路表。
   */
  static async open(host = '127.0.0.1', opts: { timeoutMs?: number } = {}) {
    const timeoutMs = opts.timeoutMs ?? 3500;
    const errors: string[] = [];
    for (const url of bridgeUrls(host, CS_PORT)) {
      try {
        const ws = await openSocket(url, timeoutMs);
        const client = new ConnectServerClient(ws, url);
        await client.refresh(timeoutMs);
        return client;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    throw new ConnectServerError(`ConnectServer 未响应（${errors.join(' / ')}）`);
  }

  /** 请求一次列表（`C1 04 F4 02`），等 `F4/02` 回来 */
  async refresh(timeoutMs = 3500): Promise<ServerGroup[]> {
    this.send(new Uint8Array([0xc1, 0x04, 0xf4, 0x02]));
    const pkt = await this.waitFor(p => p.head === 0xf4 && p.sub === 0x02, timeoutMs, '服务器列表');
    this.groups = this.parseList(pkt.body);
    return this.groups;
  }

  /**
   * 选线路：`C1 06 F4 03 <code>`。
   * 回包是 `F4/03` 的「转向」，里面才是真正要连的 GameServer 地址。
   */
  async pick(code: number, timeoutMs = 5000): Promise<ServerPick> {
    this.send(
      new Uint8Array([0xc1, 0x06, 0xf4, 0x03, code & 0xff, (code >> 8) & 0xff])
    );
    const pkt = await this.waitFor(p => p.head === 0xf4 && p.sub === 0x03, timeoutMs, '线路地址');
    const body = pkt.body;
    // 4 字节头之后：address[16] + port(2)
    let address = '';
    for (let i = 4; i < Math.min(20, body.length); i++) {
      const c = body[i];
      if (c === 0) break;
      address += String.fromCharCode(c);
    }
    if (!address) throw new ConnectServerError('线路回包没有地址');
    const port = body[20] | (body[21] << 8);
    if (!port) throw new ConnectServerError('线路回包没有端口');
    return { host: address, port, code };
  }

  close() {
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new ConnectServerError('连接已关闭'));
    }
    this.waiters = [];
    try {
      this.ws?.close();
    } catch {
      /* 已关 */
    }
    this.ws = null;
  }

  /* ---------------------------------------------------------------- */

  private send(data: Uint8Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ConnectServerError('ConnectServer 连接未建立');
    }
    this.ws.send(data);
  }

  private waitFor(match: (p: Packet) => boolean, timeoutMs: number, what: string) {
    return new Promise<Packet>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiters = this.waiters.filter(w => w.timer !== timer);
        reject(new ConnectServerError(`等待${what}超时`));
      }, timeoutMs);
      this.waiters.push({ match, resolve, reject, timer });
    });
  }

  private dispatch(p: Packet) {
    if (this.ws === null) return;
    // `F4/04` 名字表比 `F4/02` 先到，但没有人在等它 —— 先收下来备用
    if (p.head === 0xf4 && p.sub === 0x04) {
      for (const [code, name] of parseCustomNames(p.body)) this.names.set(code, name);
      return;
    }
    for (const w of [...this.waiters]) {
      if (!w.match(p)) continue;
      clearTimeout(w.timer);
      this.waiters = this.waiters.filter(x => x !== w);
      w.resolve(p);
      return;
    }
  }

  /**
   * `F4/02` 列表 → 分组。
   *
   * 客户端的分组规则（`Net_Process.cpp::Recv_ServerList`）：
   *   `group = code / 20`，显示槽位 `slot = 23 - group`，所以**组号大的排前面**；
   *   PVP 与否看名字最后一位是不是 `'2'`（`Scene_Login_ServerSelect` Pass 2），
   *   本服 `ServerList.dat` 只有一组，这条主要影响两列布局。
   */
  private parseList(body: Uint8Array): ServerGroup[] {
    if (body.length < 6) return [];
    // 5 字节 PSWMSG 头 + 1 字节 count
    const count = body[5];
    const map = new Map<number, ServerGroup>();
    const order: number[] = [];
    for (let i = 0; i < count; i++) {
      const off = 6 + i * 4;
      if (off + 4 > body.length) break;
      const code = body[off] | (body[off + 1] << 8);
      const load = body[off + 2];
      const group = Math.floor(code / 20);
      let g = map.get(group);
      if (!g) {
        g = { group, name: this.names.get(code) || `Server ${group + 1}`, channels: [] };
        map.set(group, g);
        order.push(group);
      }
      g.channels.push({ code, load });
    }
    // slot = 23 - group → group 越大越靠前
    order.sort((a, b) => b - a);
    const out = order.map(k => map.get(k)!);
    for (const g of out) g.channels.sort((a, b) => a.code - b.code);
    return out;
  }
}

/** `F4/04` 名字表单独解析：`count(2) + {code(2), name[32]}×N` */
function parseCustomNames(body: Uint8Array): Map<number, string> {
  const out = new Map<number, string>();
  if (body.length < 7) return out;
  const count = (body[5] << 8) | body[6];
  for (let i = 0; i < count; i++) {
    const off = 7 + i * 34;
    if (off + 34 > body.length) break;
    const code = body[off] | (body[off + 1] << 8);
    let name = '';
    for (let k = 2; k < 34; k++) {
      const c = body[off + k];
      if (c === 0) break;
      name += String.fromCharCode(c);
    }
    if (name) out.set(code, name.trim());
  }
  return out;
}

/*
 * 名字表是 `F4/02` 之前单独一包发过来的，而 `open()` 里 `refresh()` 只等
 * `F4/02`。为了不改变包序假设，`dispatch()` 里挂了旁路：任何 `F4/04` 都先
 * 收进 `names`（正文见 `dispatch`）。
 */
function openSocket(url: string, timeoutMs: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    ws.binaryType = 'arraybuffer';
    const timer = window.setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      reject(new ConnectServerError('连接超时'));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new ConnectServerError('WebSocket 连接失败'));
    });
  });
}

export { parseCustomNames };
