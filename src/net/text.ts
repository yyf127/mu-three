/**
 * 服务端字符串的编码/解码（聊天、公告、名字）。
 *
 * 0.97 的 Win 客户端是**简体中文版**：聊天正文按 **GBK(CP936)** 收发
 * （`Chat_InputTick.cpp` 直接 `strcpy` 到包里，中文就是双字节 GBK）。
 *
 * 之前的两个坑：
 *   1. 收：`readChatStr` 只在有 `TextDecoder('gbk')` 时用 GBK，具体实现散在 main 里；
 *   2. 发：`sendChat('名字', '正文')` 写的是 `message.charCodeAt(i) & 0xff` ——
 *      把 UTF-16 码元硬截成单字节。中文一个字（如 U+6D4B）= 0x6D4B → 0x4B，
 *      发出去的是一堆垃圾字节，服务端广播回来自然就是**乱码**。
 *
 * 这里统一成一套：
 *   - 解码先按 UTF-8 严格试一次（有些后端/网关会发 UTF-8），失败再按 GBK；
 *     成功的那一边会被记住，后续优先用它（避免每条都试两遍）。
 *   - 编码按记住的字符集来：GBK 需要一个反查表，用 `TextDecoder('gbk')`
 *     遍历双字节区间现建（只建一次，纯 ASCII 直接走快路，不会碰表）。
 */
export type ServerCharset = 'utf-8' | 'gbk';

let charset: ServerCharset = 'gbk';
let utf8Strict: TextDecoder | null = null;
let gbkDecoder: TextDecoder | null = null;
let gbkMap: Map<string, [number, number]> | null = null;

function decoders() {
  if (!utf8Strict) {
    try {
      utf8Strict = new TextDecoder('utf-8', { fatal: true });
    } catch {
      utf8Strict = null;
    }
  }
  if (!gbkDecoder) {
    try {
      gbkDecoder = new TextDecoder('gbk');
    } catch {
      gbkDecoder = null;
    }
  }
  return { utf8Strict, gbkDecoder };
}

/** 字节里有没有非 ASCII（纯 ASCII 不用猜编码） */
function hasHighByte(bytes: Uint8Array) {
  for (const b of bytes) if (b >= 0x80) return true;
  return false;
}

/**
 * 解一段服务端字符串（`0` 结尾的那种由调用方先切好）。
 *
 * 非 ASCII 时先严格按 UTF-8 解，失败退回 GBK，并记住这次用的字符集。
 */
export function decodeServerText(bytes: Uint8Array): string {
  if (!bytes.length) return '';
  if (!hasHighByte(bytes)) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
  const { utf8Strict, gbkDecoder: gbk } = decoders();
  // 先试「记住的那个」，再试另一个 —— 大多数时候第一发就中
  const order: ServerCharset[] = charset === 'utf-8' ? ['utf-8', 'gbk'] : ['gbk', 'utf-8'];
  for (const cs of order) {
    if (cs === 'utf-8') {
      if (!utf8Strict) continue;
      try {
        const s = utf8Strict.decode(bytes);
        charset = 'utf-8';
        return s;
      } catch {
        /* 不是合法 UTF-8，换 GBK */
      }
    } else {
      if (!gbk) continue;
      const s = gbk.decode(bytes);
      // U+FFFD 太多说明这不是 GBK（双字节不匹配会被替换）
      if (s && (s.match(/\uFFFD/g)?.length ?? 0) <= bytes.length / 8) {
        charset = 'gbk';
        return s;
      }
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** GBK 反查表（首字节 0x81..0xFE，尾字节 0x40..0xFE），只建一次 */
function gbkTable() {
  if (gbkMap) return gbkMap;
  const { gbkDecoder: dec } = decoders();
  const map = new Map<string, [number, number]>();
  if (dec) {
    const pair = new Uint8Array(2);
    for (let hi = 0x81; hi <= 0xfe; hi++) {
      for (let lo = 0x40; lo <= 0xfe; lo++) {
        if (lo === 0x7f) continue;
        pair[0] = hi;
        pair[1] = lo;
        const s = dec.decode(pair);
        // 只有正好解出一个字、且不是占位符才算有效双字节
        if (s.length === 1 && s !== '\uFFFD' && !map.has(s)) map.set(s, [hi, lo]);
      }
    }
  }
  gbkMap = map;
  return map;
}

/**
 * 编码成服务端要的字节。
 *
 * @param max 最多写多少字节（原来的包长固定，超了截断）；**不会把双字节字符切半**
 */
export function encodeServerText(text: string, max = Infinity): Uint8Array {
  const out: number[] = [];
  const ascii = /^[\x00-\x7f]*$/.test(text);
  if (ascii || charset === 'utf-8') {
    const enc = new TextEncoder(); // UTF-8
    const bytes = enc.encode(text);
    return bytes.subarray(0, max);
  }
  const map = gbkTable();
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      if (out.length + 1 > max) break;
      out.push(code);
      continue;
    }
    const pair = map.get(ch);
    if (pair) {
      if (out.length + 2 > max) break;
      out.push(pair[0], pair[1]);
    } else {
      // 表里没有的字（GBK 覆盖不到的生僻字/emoji）退化成 '?'
      if (out.length + 1 > max) break;
      out.push(0x3f);
    }
  }
  return new Uint8Array(out);
}

/** 诊断：当前认定的服务端字符集 & GBK 表大小 */
export function textCodecInfo() {
  return { charset, gbkPairs: gbkMap ? gbkMap.size : 0 };
}
