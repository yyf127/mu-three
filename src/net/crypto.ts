/**
 * MU 0.97 的包加密（SimpleModulus / Xor32 / Xor3）。
 *
 * 密钥不是硬编码的：客户端启动时从 Data\Enc1.dat（收→发方向）和
 * Data\Dec2.dat（发→收方向）读取，文件里的 DWORD 还用一张固定表做过 XOR 混淆
 * （客户端 globals.cpp 里 DAT_00562e48）。
 *
 * 文件布局（54 字节）：
 *   [0..1]   magic 0x1112
 *   [2..3]   size = 54
 *   [4..5]   reserved
 *   [6..53]  12 个 little-endian DWORD = Modulus[4] + Key[4] + Xor[4]，每个再 XOR 混淆表
 *
 * 算法本身与 muonlinejs / OpenMU 的 SimpleModulus 完全一致：
 *   每 8 字节明文 → 11 字节密文，块内 4 个 16bit 值分别做
 *   ((v ^ XorKey[i]) * Key[i]) % Modulus[i] 然后按位打包。
 */
import { getPacketHeaderSize, getPacketSize, setPacketSize } from './packet';

/** 客户端 globals.cpp: DAT_00562e48 */
const KEY_OBFUSCATION = [0x3f08a79b, 0xe25cc287, 0x93d27ab9, 0x20dea7bf];

const DECRYPTED_BLOCK_SIZE = 8;
const ENCRYPTED_BLOCK_SIZE = 11;
const BLOCK_SIZE_XOR_KEY = 0x3d;
const BLOCK_CHECKSUM_XOR_KEY = 0xf8;

export interface SimpleModulusKeySet {
  modulus: number[];
  /** 加密方向是 EncryptKey，解密方向是 DecryptKey */
  key: number[];
  xor: number[];
}

/** 解析 Enc1.dat / Dec2.dat */
export function parseSimpleModulusKeyFile(bytes: Uint8Array): SimpleModulusKeySet {
  if (bytes.length < 54) throw new Error(`密钥文件长度异常: ${bytes.length}`);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values: number[] = [];
  for (let i = 0; i < 12; i++) {
    values.push((view.getUint32(6 + i * 4, true) ^ KEY_OBFUSCATION[i % 4]) >>> 0);
  }

  return {
    modulus: values.slice(0, 4),
    key: values.slice(4, 8),
    xor: values.slice(8, 12),
  };
}

const byte = (n: number) => n & 0xff;

/** 16 位字节对调：C 里是把 WORD 当字节数组按大端写进位流 */
const swap16 = (v: number) => (((v & 0xff) << 8) | ((v >> 8) & 0xff)) & 0xffff;

/** 按 MSB 优先把 value 的低 count 位写进 dst 的 bitPos 处 */
function writeBits(dst: Uint8Array, bitPos: number, value: number, count: number) {
  for (let i = 0; i < count; i++) {
    if ((value >>> (count - 1 - i)) & 1) {
      dst[(bitPos + i) >> 3] |= 0x80 >> ((bitPos + i) & 7);
    }
  }
}

/** 按 MSB 优先从 src 的 bitPos 处读 count 位 */
function readBits(src: Uint8Array, bitPos: number, count: number) {
  let v = 0;
  for (let i = 0; i < count; i++) {
    v = (v << 1) | ((src[(bitPos + i) >> 3] >> (7 - ((bitPos + i) & 7))) & 1);
  }
  return v >>> 0;
}

class SimpleModulusBase {
  counter = 0;

  protected decryptedBlock = new Uint8Array(DECRYPTED_BLOCK_SIZE);
  protected encryptedBlock = new Uint8Array(ENCRYPTED_BLOCK_SIZE);
  /** 4 个 16bit 明文词 / 4 个 32bit 中间值 */
  protected words = new Uint16Array(4);
  protected dwords = new Uint32Array(4);

  reset() {
    this.counter = 0;
  }

  protected getContentSize(packet: Uint8Array, decrypted: boolean) {
    return getPacketSize(packet) - getPacketHeaderSize(packet) + (decrypted ? 1 : 0);
  }
}

export class SimpleModulusEncryptor extends SimpleModulusBase {
  private keys: SimpleModulusKeySet;

  constructor(keys: SimpleModulusKeySet) {
    super();
    this.keys = keys;
  }

  /** C1/C2 不加密，原样返回；C3/C4 逐块加密 */
  encrypt(packet: Uint8Array): Uint8Array {
    if (packet[0] < 0xc3) return packet;
    const result = this.encryptC3(packet);
    this.counter++;
    return result;
  }

  private getEncryptedSize(packet: Uint8Array) {
    const contentSize = this.getContentSize(packet, true);
    const blocks = Math.ceil(contentSize / DECRYPTED_BLOCK_SIZE);
    return blocks * ENCRYPTED_BLOCK_SIZE + getPacketHeaderSize(packet);
  }

  private encryptC3(packet: Uint8Array): Uint8Array {
    const headerSize = getPacketHeaderSize(packet);
    const contentSize = this.getContentSize(packet, true);

    // 明文内容 = [序号][报文去掉 type/size 的部分]
    const contents = new Uint8Array(contentSize);
    contents[0] = byte(this.counter);
    contents.set(packet.subarray(headerSize, headerSize + contentSize - 1), 1);

    const result = new Uint8Array(this.getEncryptedSize(packet));
    let offset = headerSize;
    for (let i = 0; i < contentSize; i += DECRYPTED_BLOCK_SIZE) {
      const take = Math.min(DECRYPTED_BLOCK_SIZE, contentSize - i);
      this.decryptedBlock.fill(0);
      this.decryptedBlock.set(contents.subarray(i, i + take), 0);
      this.encodeBlock(this.encryptedBlock, this.decryptedBlock, take);
      result.set(this.encryptedBlock, offset);
      offset += ENCRYPTED_BLOCK_SIZE;
    }

    result[0] = packet[0];
    setPacketSize(result);
    return result;
  }

  /**
   * 8 字节 → 11 字节。
   * 对应 GameServer/PacketManager.cpp::EncryptBlock：
   *   pass1  (Xor[i] ^ word[i] ^ prev) * Key[i] % Mod[i]
   *   pass2  packed[i] ^= Xor[i] ^ (packed[i+1] & 0xFFFF)（升序，取原始 i+1）
   *   pass3  每个值 16 位 + 高 2 位按位打包，末尾补 [长度字节, 校验和]
   */
  private encodeBlock(output: Uint8Array, input: Uint8Array, blockSize: number) {
    const k = this.keys;
    const w = this.words;
    w.fill(0);
    for (let i = 0; i < blockSize; i++) w[i >> 1] |= input[i] << ((i & 1) * 8);

    const p = this.dwords;
    let prev = 0;
    for (let i = 0; i < 4; i++) {
      p[i] = Math.floor((k.key[i] * ((prev ^ w[i] ^ k.xor[i]) & 0xffff)) % k.modulus[i]) >>> 0;
      prev = p[i] & 0xffff;
    }
    for (let i = 0; i < 3; i++) {
      p[i] = (p[i] ^ k.xor[i] ^ (p[i + 1] & 0xffff)) >>> 0;
    }

    output.fill(0);
    let bitPos = 0;
    for (let i = 0; i < 4; i++) {
      writeBits(output, bitPos, swap16(p[i] & 0xffff), 16);
      bitPos += 16;
      // 附加的 2 位是 bit16..17（不是 bit22..23）：C 里的 `AddBits(..., 22, 2)`
      // 会先左移 6 位，实际取到的就是低字节的高 2 位
      writeBits(output, bitPos, (p[i] >>> 16) & 0x3, 2);
      bitPos += 2;
    }

    let checksum = BLOCK_CHECKSUM_XOR_KEY;
    for (let i = 0; i < blockSize; i++) checksum ^= input[i];
    const sizeByte = (checksum ^ blockSize ^ BLOCK_SIZE_XOR_KEY) & 0xff;
    writeBits(output, bitPos, ((sizeByte << 8) | checksum) & 0xffff, 16);
  }
}

export class SimpleModulusDecryptor extends SimpleModulusBase {
  private keys: SimpleModulusKeySet;

  constructor(keys: SimpleModulusKeySet) {
    super();
    this.keys = keys;
  }

  decrypt(packet: Uint8Array): { success: boolean; packet: Uint8Array } {
    if (packet[0] < 0xc3) return { success: true, packet };

    const { counterValue, result } = this.decryptC3(packet);
    const success = this.counter === counterValue;
    this.counter++;
    return { success, packet: result };
  }

  private decryptC3(data: Uint8Array) {
    const contentSize = this.getContentSize(data, false);
    const headerSize = getPacketHeaderSize(data);

    const result = new Uint8Array(this.getMaximumDecryptedSize(data));
    let written = 0;
    for (let i = 0; i < contentSize; i += ENCRYPTED_BLOCK_SIZE) {
      const blockSize = this.decodeBlock(this.decryptedBlock, data.subarray(headerSize + i, headerSize + i + ENCRYPTED_BLOCK_SIZE));
      if (blockSize < 0) break;
      result.set(this.decryptedBlock.subarray(0, blockSize), headerSize - 1 + written);
      written += blockSize;
    }

    // 解密结果里第 1 个字节是序号（会被 setPacketSize 覆盖成报文长度）
    const counterValue = result[headerSize - 1];
    result[0] = data[0];
    const out = result.slice(0, Math.min(result.length, written + headerSize - 1));
    setPacketSize(out);
    return { counterValue, result: out };
  }

  private decodeBlock(output: Uint8Array, input: Uint8Array) {
    const k = this.keys;
    const p = this.dwords;

    let bitPos = 0;
    for (let i = 0; i < 4; i++) {
      const lo = swap16(readBits(input, bitPos, 16));
      bitPos += 16;
      const hi = readBits(input, bitPos, 2);
      bitPos += 2;
      p[i] = (lo | (hi << 16)) >>> 0;
    }

    // pass2 反演：降序，用已还原的 i+1
    for (let i = 2; i >= 0; i--) {
      p[i] = (p[i] ^ k.xor[i] ^ (p[i + 1] & 0xffff)) >>> 0;
    }

    const w = this.words;
    w.fill(0);
    let value = 0;
    for (let i = 0; i < 4; i++) {
      // C 里是 DWORD 乘法（先截断到 32 位）再取模
      const prod = (Math.imul(k.key[i], p[i]) >>> 0) % k.modulus[i];
      w[i] = (prod ^ k.xor[i] ^ value) & 0xffff;
      value = p[i] & 0xffff;
    }

    const tail = swap16(readBits(input, bitPos, 16));
    const sizeByte = (tail >>> 8) & 0xff;
    const checksum = tail & 0xff;
    const blockSize = (sizeByte ^ checksum ^ BLOCK_SIZE_XOR_KEY) & 0xff;
    if (blockSize > DECRYPTED_BLOCK_SIZE) return -1;

    for (let i = 0; i < blockSize; i++) {
      output[i] = byte(w[i >> 1] >> ((i & 1) * 8));
    }
    return blockSize;
  }

  private getMaximumDecryptedSize(packet: Uint8Array) {
    const blocks = Math.floor(this.getContentSize(packet, false) / ENCRYPTED_BLOCK_SIZE);
    return blocks * DECRYPTED_BLOCK_SIZE + getPacketHeaderSize(packet) - 1;
  }
}

/* ------------------------------------------------------------------ */
/* Xor32 / Xor3                                                        */
/* ------------------------------------------------------------------ */

/**
 * Xor32 过滤表（32 字节）。
 * 取自 GameServer/PacketManager.cpp 的 m_XorFilter，
 * 与客户端 Net_LegacyRuntime.cpp 里的 xorKey 完全一致。
 * 作用范围：C1/C2/C3/C4 报文里 head 之后（下标 3 起）到末尾。
 */
export const XOR32_KEY = new Uint8Array([
  0xe7, 0x6d, 0x3a, 0x89, 0xbc, 0xb2, 0x9f, 0x73,
  0x23, 0xa8, 0xfe, 0xb6, 0x49, 0x5d, 0x39, 0x5d,
  0x8a, 0xcb, 0x63, 0x8d, 0xea, 0x7d, 0x2b, 0x5f,
  0xc3, 0xb1, 0xe9, 0x83, 0x29, 0x51, 0xe8, 0x56,
]);

export const XOR3_KEY = new Uint8Array([0xfc, 0xcf, 0xab]);

export function xor32Encrypt(packet: Uint8Array, key = XOR32_KEY): Uint8Array {
  const headerSize = getPacketHeaderSize(packet);
  for (let i = headerSize + 1; i < packet.length; i++) {
    packet[i] = byte(packet[i] ^ packet[i - 1] ^ key[i % 32]);
  }
  return packet;
}

export function xor32Decrypt(packet: Uint8Array, key = XOR32_KEY): Uint8Array {
  const headerSize = getPacketHeaderSize(packet);
  for (let i = packet.length - 1; i > headerSize; i--) {
    packet[i] = byte(packet[i] ^ packet[i - 1] ^ key[i % 32]);
  }
  return packet;
}

export function xor3(packet: Uint8Array, size = packet.length): Uint8Array {
  for (let i = 0; i < size; i++) packet[i] ^= XOR3_KEY[i % 3];
  return packet;
}
