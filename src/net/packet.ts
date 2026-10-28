/**
 * MU 报文封装。
 *   C1/C2 明文，C3/C4 加密（C3=带 1 字节计数的加密报文，C4=大包）
 *   头长度：C1/C3 → 2 字节（类型 + 长度），C2/C4 → 3 字节（类型 + 长度 hi/lo）
 */

export function getSizeOfPacketType(type: number) {
  switch (type) {
    case 0xc1:
    case 0xc3:
      return 2;
    case 0xc2:
    case 0xc4:
      return 3;
    default:
      return 0;
  }
}

export function getPacketHeaderSize(packet: Uint8Array) {
  return getSizeOfPacketType(packet[0]);
}

export function getPacketSize(packet: Uint8Array) {
  switch (packet[0]) {
    case 0xc1:
    case 0xc3:
      return packet[1];
    case 0xc2:
    case 0xc4:
      return (packet[1] << 8) | packet[2];
    default:
      return 0;
  }
}

export function setPacketSize(packet: Uint8Array) {
  const size = packet.byteLength;
  switch (packet[0]) {
    case 0xc1:
    case 0xc3:
      packet[1] = size & 0xff;
      break;
    case 0xc2:
    case 0xc4:
      packet[1] = (size & 0xff00) >> 8;
      packet[2] = size & 0x00ff;
      break;
  }
}

/** 小工具：写 C1 / C3 报文 */
export class PacketWriter {
  private bytes: number[];

  constructor(type: number = 0xc1) {
    this.bytes = [type, 0];
  }

  u8(v: number) {
    this.bytes.push(v & 0xff);
    return this;
  }

  u16(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff);
    return this;
  }

  u32(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }

  /** 定长字符串，不足补 0 */
  str(text: string, length: number) {
    for (let i = 0; i < length; i++) {
      this.bytes.push(i < text.length ? text.charCodeAt(i) & 0xff : 0);
    }
    return this;
  }

  raw(data: Uint8Array | number[]) {
    for (const b of data) this.bytes.push(b & 0xff);
    return this;
  }

  build() {
    const out = new Uint8Array(this.bytes);
    setPacketSize(out);
    return out;
  }
}

/** 从接收流里切出完整报文（TCP 会粘包/拆包） */
export class PacketStreamDecoder {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const packets: Uint8Array[] = [];
    let offset = 0;

    while (offset + 2 <= this.buffer.length) {
      const type = this.buffer[offset];
      const headerSize = getSizeOfPacketType(type);
      if (headerSize === 0) {
        // 无法识别的类型，丢弃 1 字节重新同步
        offset++;
        continue;
      }
      if (offset + headerSize > this.buffer.length) break;

      const size =
        headerSize === 2
          ? this.buffer[offset + 1]
          : (this.buffer[offset + 1] << 8) | this.buffer[offset + 2];

      if (size < headerSize) {
        offset++;
        continue;
      }
      if (offset + size > this.buffer.length) break;

      packets.push(this.buffer.slice(offset, offset + size));
      offset += size;
    }

    this.buffer = this.buffer.slice(offset);
    return packets;
  }
}

export function hex(data: Uint8Array, max = 64) {
  return Array.from(data.subarray(0, max))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
}
