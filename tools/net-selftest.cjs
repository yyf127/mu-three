/**
 * 加密层自测（不需要服务端）：
 *   Enc1.dat 加密 → Dec2.dat 解密，应当还原出原始报文（两组密钥互为模逆）。
 * 用法： npx tsc ... && node tools/net-selftest.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const {
  parseSimpleModulusKeyFile,
  SimpleModulusEncryptor,
  SimpleModulusDecryptor,
  xor32Encrypt,
  xor32Decrypt,
  xor3,
  XOR3_KEY,
} = require('../.tmp/net/crypto.js');
const { hex } = require('../.tmp/net/packet.js');

const DATA = path.resolve(__dirname, '../../muonlinejs-master/public/Data');

function loadKeys(file) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(DATA, file)));
  return parseSimpleModulusKeyFile(bytes);
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

console.log('=== 密钥解析 ===');
const encKeys = loadKeys('Enc1.dat');
const decKeys = loadKeys('Dec2.dat');
console.log('  Enc1 modulus:', encKeys.modulus);
console.log('  Enc1 key    :', encKeys.key);
console.log('  Dec2 key    :', decKeys.key);
console.log('  xor         :', encKeys.xor);

check(
  '两组模数一致',
  encKeys.modulus.every((m, i) => m === decKeys.modulus[i])
);
check(
  '两组 XOR 表一致',
  encKeys.xor.every((m, i) => m === decKeys.xor[i])
);
check(
  '密钥互为模逆 (e*d % m == 1)',
  encKeys.key.every((e, i) => (e * decKeys.key[i]) % encKeys.modulus[i] === 1)
);

console.log('=== SimpleModulus 往返 ===');
const encryptor = new SimpleModulusEncryptor({ ...encKeys });
const decryptor = new SimpleModulusDecryptor({ ...decKeys });

// 覆盖多种长度，包括跨块边界（8 的倍数）与非整数倍
const lengths = [1, 2, 3, 7, 8, 9, 15, 16, 17, 23, 24, 40];

for (const payloadLen of lengths) {
  // C3 报文：type + size + 0xF3 + payload
  const packet = new Uint8Array(4 + payloadLen);
  packet[0] = 0xc3;
  packet[1] = packet.length;
  packet[2] = 0xf3;
  for (let i = 0; i < payloadLen; i++) packet[3 + i] = (i * 37 + 11) & 0xff;
  packet[3 + payloadLen - 1] = payloadLen & 0xff;

  const encrypted = encryptor.encrypt(packet.slice());
  const decrypted = decryptor.decrypt(encrypted.slice());

  const expectEncSize = Math.ceil((packet.length - 2 + 1) / 8) * 11 + 2;
  check(
    `payload=${payloadLen} 密文长度`,
    encrypted.length === expectEncSize,
    `实际 ${encrypted.length} 期望 ${expectEncSize}`
  );
  check(
    `payload=${payloadLen} 解密还原`,
    equal(decrypted.packet, packet),
    `\n      got: ${hex(decrypted.packet, 24)}\n      exp: ${hex(packet, 24)}`
  );
}

console.log('=== Xor32 / Xor3 ===');
{
  const packet = new Uint8Array([0xc1, 0x0c, 0xf3, 0x01, 2, 3, 4, 5, 6, 7, 8, 9]);
  const original = packet.slice();
  xor32Encrypt(packet);
  check('Xor32 加密改变了数据', !equal(packet, original));
  xor32Decrypt(packet);
  check('Xor32 往返还原', equal(packet, original), hex(packet));

  const x3 = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
  xor3(x3);
  check('Xor3 使用 FC CF AB', x3[0] === (1 ^ XOR3_KEY[0]));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
