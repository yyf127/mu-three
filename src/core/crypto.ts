/**
 * MU 客户端的地图文件加密算法（.map/.att/.obj 以及 v12 的 .bmd）。
 * 与 Mu-97k-Client-Source / muonlinejs 中的 decryptMapFile 完全一致。
 */
const XOR_KEY = new Uint8Array([
  0xd1, 0x73, 0x52, 0xf6, 0xd2, 0x9a, 0xcb, 0x27, 0x3e, 0xaf, 0x59, 0x31, 0x37,
  0xb3, 0xe7, 0xa2,
]);
const BUX_CODE = new Uint8Array([0xfc, 0xcf, 0xab]);

export function decryptMapFile(src: Uint8Array, size = src.length): Uint8Array {
  const dst = new Uint8Array(size);
  let key = 0x5e;
  for (let i = 0; i < size; i++) {
    const b = src[i];
    dst[i] = ((b ^ XOR_KEY[i % 16]) - (key & 0xff)) & 0xff;
    key = (b + 0x3d) & 0xff;
  }
  return dst;
}

export function convertBux(buf: Uint8Array, size = buf.length) {
  for (let i = 0; i < size; i++) buf[i] ^= BUX_CODE[i % 3];
  return buf;
}
