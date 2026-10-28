/**
 * 交叉校验：把本项目的 SimpleModulus 与 muonlinejs 的参考实现逐字节对比。
 * 依赖 .tmp/refjs（由 muonlinejs 的 simpleModulus.ts 加壳编译而来）：
 *   mkdir -p .tmp/ref && cp ../muonlinejs-master/src/common/encryption/simpleModulus.ts .tmp/ref/
 *   （把 import "../utils" 改成 "./utils"，再补一个只含 castToByte/getPacketSize 等函数的 utils.ts）
 *   npx tsc .tmp/ref/simpleModulus.ts .tmp/ref/utils.ts --outDir .tmp/refjs --module commonjs --target es2020
 *   echo {"type":"commonjs"} > .tmp/refjs/package.json
 *
 * 开发阶段已跑通：12 种长度密文完全一致，且参考实现能解开本实现的密文。
 */
const fs = require('node:fs');
const path = require('node:path');
const ref = require('../.tmp/refjs/simpleModulus.js');
const mine = require('../.tmp/net/crypto.js');
const { hex } = require('../.tmp/net/packet.js');

const DATA = path.resolve(__dirname, '../../muonlinejs-master/public/Data');
const kEnc = mine.parseSimpleModulusKeyFile(new Uint8Array(fs.readFileSync(path.join(DATA, 'Enc1.dat'))));
const kDec = mine.parseSimpleModulusKeyFile(new Uint8Array(fs.readFileSync(path.join(DATA, 'Dec2.dat'))));

const refEnc = new ref.SimpleModulusEncryptor();
refEnc.encryptionKeys = {
  ModulusKey: kEnc.modulus, XorKey: kEnc.xor, EncryptKey: kEnc.key, DecryptKey: [0, 0, 0, 0],
  GetEncryptionKeys() { return this; },
};
const refDec = new ref.SimpleModulusDecryptor();
refDec.decryptionKeys = {
  ModulusKey: kDec.modulus, XorKey: kDec.xor, DecryptKey: kDec.key, EncryptKey: [0, 0, 0, 0],
  GetEncryptionKeys() { return this; },
};

const myEnc = new mine.SimpleModulusEncryptor(kEnc);
const myDec = new mine.SimpleModulusDecryptor(kDec);

function makePacket(len) {
  const p = new Uint8Array(4 + len);
  p[0] = 0xc3; p[1] = p.length; p[2] = 0xf3;
  for (let i = 0; i < len; i++) p[3 + i] = (i * 37 + 11) & 0xff;
  p[3 + len - 1] = len & 0xff;
  return p;
}

let ok = 0, bad = 0;
for (const len of [1, 2, 3, 7, 8, 9, 15, 16, 17, 23, 24, 40]) {
  const p = makePacket(len);
  console.log(`  counter mine=${myEnc.counter} ref=${refEnc.Counter.Count}`);
  const a = myEnc.encrypt(p.slice());
  const b = refEnc.Encrypt(p.slice());
  const same = a.length === b.length && a.every((v, i) => v === b[i]);
  console.log(`len=${len} 加密一致: ${same}`);
  if (same) ok++; else { bad++; console.log('  mine:', hex(a, 32)); console.log('  ref :', hex(b, 32)); }

  // 交叉解密：参考实现解我的密文
  const cross = refDec.Decrypt(a.slice());
  const crossOk = cross[1].every((v, i) => v === p[i]) && cross[1].length === p.length;
  console.log(`     参考实现可解我的密文: ${crossOk}`);
}
console.log(`\n一致 ${ok}, 不一致 ${bad}`);
