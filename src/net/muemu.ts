/**
 * MuEmu 流加密层（GameServer ENCRYPT_STATE=1）。
 *
 * GameServer/stdafx.h 里 `#define ENCRYPT_STATE 1` 时，**每一个进出字节**
 * 都会再过一层单字节变换（HackCheck.cpp::EncryptData / DecryptData）：
 *
 *   发： out = (plain + add) ^ xor
 *   收： plain = (in ^ xor) - add
 *
 * xor/add 不是常量，由服务端配置里的 CustomerName + ServerSerial 推出来：
 *
 *   key = 0
 *   for n in 0..31:                      // CustomerName 缓冲区固定 32 字节
 *     key += (BYTE)(CustomerName[n] ^ ServerSerial[n % 17])   // 注意是 17，不是 16
 *     key ^= (BYTE)(CustomerName[n] - ServerSerial[n % 17])
 *   xor = (BYTE)(0xB0 + LOBYTE(key))
 *   k2  = (BYTE)(0xF8 + HIBYTE(key))
 *   add = (BYTE)(k2 * xor)
 *
 * 取值来自 Data\GameServerInfo - StartUp.dat，所以换服务端配置就得重算。
 */

export interface StreamKeys {
  xor: number;
  add: number;
}

/** 按 HackCheck.cpp::InitHackCheck 推导流加密密钥 */
export function deriveStreamKeys(customerName: string, serverSerial: string): StreamKeys {
  const cust = new Uint8Array(32);
  for (let i = 0; i < 32 && i < customerName.length; i++) cust[i] = customerName.charCodeAt(i) & 0xff;

  const ser = new Uint8Array(17);
  for (let i = 0; i < 17 && i < serverSerial.length; i++) ser[i] = serverSerial.charCodeAt(i) & 0xff;

  let key = 0;
  for (let n = 0; n < cust.length; n++) {
    const c = cust[n];
    const s = ser[n % ser.length];
    key = (key + ((c ^ s) & 0xff)) & 0xffff;
    key = (key ^ ((c - s) & 0xff)) & 0xffff;
  }

  const xor = (0xb0 + (key & 0xff)) & 0xff;
  const k2 = (0xf8 + ((key >> 8) & 0xff)) & 0xff;
  return { xor, add: (k2 * xor) & 0xff };
}

export function streamEncrypt(data: Uint8Array, keys: StreamKeys): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = ((data[i] + keys.add) ^ keys.xor) & 0xff;
  }
  return out;
}

export function streamDecrypt(data: Uint8Array, keys: StreamKeys): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = ((data[i] ^ keys.xor) - keys.add) & 0xff;
  }
  return out;
}
