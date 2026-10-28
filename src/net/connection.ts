/**
 * 浏览器侧网络连接。
 *
 * 浏览器不能直连 TCP，所以走一层 WebSocket 网关。网关有两种宿主，同一份实现
 * （server/bridge-core.mjs）：
 *
 *   - 内嵌开发服务器：ws://127.0.0.1:5180/mu    ← 默认，`npm run dev` 就有
 *   - 独立网关进程：  ws://127.0.0.1:5181/       ← 构建产物 / 单独调试时用
 *
 * bridgeUrls() 按这个顺序给候选地址，连上哪个用哪个。
 *
 * 报文要过三层（顺序不能错，全部按 0.97 服务端源码校对过）：
 *
 *   发： 明文 ──Xor32(下标3起)──► [C3/C4 再走 SimpleModulus] ──流加密──► 线路
 *   收： 线路 ──流解密──► 切包 ──[C3/C4 先 SimpleModulus]──► 明文
 *
 *  - Xor32：服务端 PacketManager::ExtractPacket 会对所有客户端报文做 XorData
 *  - SimpleModulus：C3/C4 专用，密钥来自 Data/Enc1.dat / Dec2.dat
 *  - 流加密：GameServer 编了 ENCRYPT_STATE=1，所有字节都过一遍
 */
import { assetUrl } from '../core/base';
import {
  SimpleModulusDecryptor,
  SimpleModulusEncryptor,
  parseSimpleModulusKeyFile,
  type SimpleModulusKeySet,
  xor32Encrypt,
} from './crypto';
import { PacketStreamDecoder } from './packet';
import { deriveStreamKeys, streamDecrypt, streamEncrypt, type StreamKeys } from './muemu';

export interface NetKeys {
  /** Enc1.dat：客户端 → 服务端 */
  encrypt: SimpleModulusKeySet;
  /** Dec2.dat：服务端 → 客户端 */
  decrypt: SimpleModulusKeySet;
  /** 流加密密钥（由服务端配置推导，服务端没开 ENCRYPT_STATE 时传 null 关闭） */
  stream: StreamKeys | null;
}

export async function loadNetKeys(dataBase = 'Data/'): Promise<NetKeys> {
  const load = async (name: string) => {
    const res = await fetch(assetUrl(`${dataBase}${name}`));
    if (!res.ok) throw new Error(`读取密钥失败: ${name} (${res.status})`);
    return parseSimpleModulusKeyFile(new Uint8Array(await res.arrayBuffer()));
  };

  let stream: StreamKeys | null = null;
  // 同源优先（dev server 内嵌网关），再退到独立网关进程
  for (const url of ['/mu-config', 'http://127.0.0.1:5181/mu-config']) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const cfg = await res.json();
      if (cfg?.customerName && cfg?.serverSerial) {
        stream = deriveStreamKeys(cfg.customerName, cfg.serverSerial);
        break;
      }
    } catch {
      // 这条不通就试下一条；都拿不到就按「服务端没开 ENCRYPT_STATE」处理
    }
  }

  return { encrypt: await load('Enc1.dat'), decrypt: await load('Dec2.dat'), stream };
}

/**
 * 网关候选地址：先试同源 /mu（dev server 内嵌），再试 5181 的独立进程。
 * 两条都失败才算连不上——这样 `npm run dev` 与 `vite build` + bridge 两种跑法都能用。
 */
export function bridgeUrls(host: string, port: number): string[] {
  const list: string[] = [];
  if (typeof location !== 'undefined' && location.host) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    list.push(`${proto}//${location.host}/mu?host=${host}&port=${port}`);
  }
  list.push(`ws://127.0.0.1:5181/?host=${host}&port=${port}`);
  return list;
}

export type PacketHandler = (packet: Uint8Array) => void;

export class MuConnection {
  private ws: WebSocket | null = null;
  private decoder = new PacketStreamDecoder();
  private encryptor: SimpleModulusEncryptor;
  private decryptor: SimpleModulusDecryptor;
  private handlers = new Set<PacketHandler>();

  /** 流加密密钥；null 表示服务端没开 ENCRYPT_STATE */
  stream: StreamKeys | null;

  constructor(keys: NetKeys) {
    this.encryptor = new SimpleModulusEncryptor(keys.encrypt);
    this.decryptor = new SimpleModulusDecryptor(keys.decrypt);
    this.stream = keys.stream;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`WebSocket 连接失败: ${url}`));

      ws.onmessage = ev => {
        let chunk: Uint8Array = new Uint8Array(ev.data as ArrayBuffer);
        if (this.stream) chunk = streamDecrypt(chunk, this.stream);

        for (const raw of this.decoder.push(chunk)) {
          this.handlePacket(raw);
        }
      };

      ws.onclose = () => {
        this.ws = null;
      };
    });
  }

  onPacket(handler: PacketHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private handlePacket(raw: Uint8Array) {
    let packet = raw;

    if (raw[0] === 0xc3 || raw[0] === 0xc4) {
      const { packet: decrypted } = this.decryptor.decrypt(raw.slice());
      packet = decrypted;
    }

    for (const handler of this.handlers) handler(packet);
  }

  send(packet: Uint8Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('连接未建立');
    }

    // 1) Xor32（所有类型都要，服务端 ExtractPacket 无条件解）
    let out = xor32Encrypt(packet.slice());

    // 2) C3/C4 再过 SimpleModulus
    if (out[0] === 0xc3 || out[0] === 0xc4) {
      out = this.encryptor.encrypt(out);
    }

    // 3) 流加密
    if (this.stream) out = streamEncrypt(out, this.stream);

    this.ws.send(out);
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}
