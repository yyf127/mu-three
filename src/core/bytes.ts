/** 小端二进制读取器（BMD / ATT / OBJ 均使用 little-endian） */
export class ByteReader {
  private view: DataView;
  pos = 0;

  constructor(
    public readonly bytes: Uint8Array,
    offset = 0
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = offset;
  }

  seek(p: number) {
    this.pos = p;
    return this;
  }

  skip(n: number) {
    this.pos += n;
    return this;
  }

  u8() {
    return this.view.getUint8(this.pos++);
  }

  i8() {
    return this.view.getInt8(this.pos++);
  }

  u16() {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16() {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i32() {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  u32() {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32() {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** 固定长度、以 \0 结尾的 ASCII 字符串 */
  str(len: number) {
    const start = this.pos;
    const end = start + len;
    let out = '';
    for (let i = start; i < end; i++) {
      const c = this.bytes[i];
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    this.pos = end;
    return out;
  }

  get remaining() {
    return this.bytes.length - this.pos;
  }
}

export function readStr(bytes: Uint8Array, from: number, to: number) {
  let out = '';
  for (let i = from; i < to; i++) {
    const c = bytes[i];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}
