/**
 * 假客户端：打通 GameServer 登录链（0xF1 0x01 → 角色列表 → 选角）。
 *
 *   node tools/login-probe.mjs                  # 先用 ConnectServer 拿地址，再登录
 *   node tools/login-probe.mjs 127.0.0.1 55901  # 直连 GameServer
 *
 * 参数可用环境变量覆盖：MU_ACCOUNT / MU_PASSWORD
 */
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const cryptoMod = require('../.tmp/net/crypto.js');

const DATA = resolve(__dirname, '../../muonlinejs-master/public/Data');
const HWID = process.env.MU_HWID || 'H5MU0001-1A2B3C4D-5E6F7081-92A3B4C5';
const ACCOUNT = process.env.MU_ACCOUNT || '1234';
const PASSWORD = process.env.MU_PASSWORD || '1234';

const hex = b =>
  Buffer.from(b).toString('hex').match(/.{1,2}/g)?.join(' ') ?? '(空)';
const log = (...a) => console.log(...a);

/**
 * 服务端 GameServer 编了 ENCRYPT_STATE=1（GameServer/stdafx.h），
 * 所有进出的字节流都再包一层 XOR：
 *   发： out = (in + add) ^ xor
 *   收： in  = (out ^ xor) - add
 * 其中 (xor, add) 由 CustomerName + ServerSerial 推出来（HackCheck.cpp:InitHackCheck）：
 *   EncDecKey1 = 0xB0 + LOBYTE(key)，EncDecKey2 = 0xF8 + HIBYTE(key)，add = 1*2 & 0xFF
 * 注意 ServerSerial 的缓冲区是 17 字节，循环取模就按 17。
 */
function deriveStreamKeys(customerName, serverSerial) {
  const cust = Buffer.alloc(32);
  cust.write(customerName || '', 0, 'latin1');
  const ser = Buffer.alloc(17);
  ser.write(serverSerial || '', 0, 'latin1');

  let k = 0;
  for (let n = 0; n < cust.length; n++) {
    const c = cust[n];
    const t = ser[n % ser.length];
    k = (k + ((c ^ t) & 0xff)) & 0xffff;
    k = (k ^ ((c - t) & 0xff)) & 0xffff;
  }
  const xor = (0xb0 + (k & 0xff)) & 0xff;
  const k2 = (0xf8 + ((k >> 8) & 0xff)) & 0xff;
  return { xor, add: (k2 * xor) & 0xff };
}

/** 从服务端配置读出 CustomerName / ServerVersion / ServerSerial */
function readServerConfig() {
  const ini = resolve(__dirname, '../../MuServer/GameServer/DATA/GameServerInfo - StartUp.dat');
  const cfg = { customerName: 'Nico', serverVersion: '0.97.11', serverSerial: 'TbYehR2hFUPBKgZj' };
  try {
    const text = readFileSync(ini, 'latin1');
    const pick = key => text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim();
    cfg.customerName = pick('CustomerName') || cfg.customerName;
    cfg.serverVersion = pick('ServerVersion') || cfg.serverVersion;
    cfg.serverSerial = pick('ServerSerial') || cfg.serverSerial;
  } catch {
    // 配置读不到就用默认值
  }
  return cfg;
}

const SERVER = readServerConfig();
const STREAM = deriveStreamKeys(SERVER.customerName, SERVER.serverSerial);

const streamEncrypt = buf => Buffer.from(buf.map(b => ((b + STREAM.add) ^ STREAM.xor) & 0xff));
const streamDecrypt = buf => Buffer.from(buf.map(b => ((b ^ STREAM.xor) - STREAM.add) & 0xff));

/**
 * 版本号取自服务端配置 "0.97.11"：ServerInfo.cpp 跳过两个小数点，
 * 取第 0/2/3/5/6 个字符 → "09711"（5 字节），登录包 memcmp 就是比这 5 字节。
 */
const CLIENT_VERSION = Array.from(
  { length: 5 },
  (_, i) => SERVER.serverVersion[[0, 2, 3, 5, 6][i]]?.charCodeAt(0) ?? 0
);
const CLIENT_SERIAL = Buffer.alloc(16);
CLIENT_SERIAL.write(SERVER.serverSerial.slice(0, 16), 0, 'latin1');

const encKeys = cryptoMod.parseSimpleModulusKeyFile(
  new Uint8Array(readFileSync(resolve(DATA, 'Enc1.dat')))
);
const decKeys = cryptoMod.parseSimpleModulusKeyFile(
  new Uint8Array(readFileSync(resolve(DATA, 'Dec2.dat')))
);
const encryptor = new cryptoMod.SimpleModulusEncryptor(encKeys);
const decryptor = new cryptoMod.SimpleModulusDecryptor(decKeys);

/** 账号/密码的传输编码：逐字节 XOR {FC,CF,AB}（服务端 PacketArgumentDecrypt） */
function encodeArg(text, size = 10) {
  const table = [0xfc, 0xcf, 0xab];
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const ch = i < text.length ? text.charCodeAt(i) : 0;
    out[i] = (ch ^ table[i % 3]) & 0xff;
  }
  return out;
}

/** C3 F1 01 登录包 */
function buildLoginPacket() {
  const size = 4 + 10 + 10 + 4 + 5 + 16; // 49
  const p = new Uint8Array(size);
  p[0] = 0xc3;
  p[1] = size;
  p[2] = 0xf1;
  p[3] = 0x01;
  p.set(encodeArg(ACCOUNT), 4);
  p.set(encodeArg(PASSWORD), 14);
  // TickCount（客户端本地毫秒数，服务端只记录不校验）
  const tick = Date.now() >>> 0;
  p[24] = tick & 0xff;
  p[25] = (tick >>> 8) & 0xff;
  p[26] = (tick >>> 16) & 0xff;
  p[27] = (tick >>> 24) & 0xff;
  p.set(CLIENT_VERSION, 28);
  p.set(CLIENT_SERIAL, 33);
  return p;
}

/** C3 F1 04 <lang:int32> 设置语言（必须在登录前） */
function buildLangPacket(lang = 0) {
  const p = Buffer.alloc(8);
  p[0] = 0xc3;
  p[1] = 8;
  p[2] = 0xf1;
  p[3] = 0x04;
  p.writeInt32LE(lang, 4);
  return p;
}

/**
 * C3 F1 05 <HardwareId[36]> 上报硬件指纹。
 * 服务端 CBlackList::CheckHardwareID 对空字符串直接返回 1，
 * 也就是未上报 HWID 时登录会被判成 result=5（黑名单）。
 */
function buildHwidPacket() {
  const p = Buffer.alloc(40);
  p[0] = 0xc3;
  p[1] = 40;
  p[2] = 0xf1;
  p[3] = 0x05;
  p.write(HWID, 4, 'latin1');
  return p;
}

/** C1 04 F3 00 请求角色列表（size 含 type+size+head+sub，最小 4） */
const buildCharListPacket = () => Buffer.from([0xc1, 0x04, 0xf3, 0x00]);

/** C1 0E F3 03 <name:10> 选择角色 */
function buildCharSelectPacket(name) {
  const p = Buffer.alloc(4 + 10);
  p[0] = 0xc1;
  p[1] = p.length;
  p[2] = 0xf3;
  p[3] = 0x03;
  p.write(name, 4, 'ascii');
  return p;
}

/** 把 TCP 字节流切成完整报文 */
function makeSplitter(onPacket) {
  let acc = Buffer.alloc(0);
  return chunk => {
    acc = Buffer.concat([acc, chunk]);
    while (acc.length >= 3) {
      const type = acc[0];
      const headerSize = type === 0xc2 || type === 0xc4 ? 3 : 2;
      if (type !== 0xc1 && type !== 0xc2 && type !== 0xc3 && type !== 0xc4) {
        log(`!! 未知报文头 0x${type.toString(16)}，丢弃缓冲区`);
        acc = Buffer.alloc(0);
        return;
      }
      const size = headerSize === 2 ? acc[1] : (acc[1] << 8) | acc[2];
      if (size < headerSize) {
        acc = Buffer.alloc(0);
        return;
      }
      if (acc.length < size) return;
      onPacket(acc.subarray(0, size));
      acc = acc.subarray(size);
    }
  };
}

/** 解密（若为 C3/C4）并返回 {head, sub, payload, encrypted} */
function decodePacket(raw) {
  const buf = Buffer.from(raw);
  if (buf[0] === 0xc3 || buf[0] === 0xc4) {
    const { success, packet } = decryptor.decrypt(new Uint8Array(buf));
    const out = Buffer.from(packet);
    const hs = out[0] === 0xc2 || out[0] === 0xc4 ? 3 : 2;
    return {
      head: out[hs],
      sub: out[hs + 1],
      payload: out.subarray(hs + 2),
      encrypted: true,
      counterOk: success,
      raw: out,
    };
  }
  const hs = buf[0] === 0xc2 || buf[0] === 0xc4 ? 3 : 2;
  return {
    head: buf[hs],
    sub: buf[hs + 1],
    payload: buf.subarray(hs + 2),
    encrypted: false,
    counterOk: true,
    raw: buf,
  };
}

function tcpQuery(host, port, onData, onReady) {
  return new Promise((resolvePromise, reject) => {
    const socket = connect({ host, port }, () => onReady(socket));
    socket.on('data', onData);
    socket.on('error', reject);
    socket.on('close', () => resolvePromise());
  });
}

/** 第一步：向 ConnectServer 要 GameServer 地址 */
async function resolveGameServer() {
  let code = 0;
  let result = null;

  const socket = connect({ host: '127.0.0.1', port: 44405 });
  const split = makeSplitter(raw => {
    const p = decodePacket(raw);
    log(`  ← ConnectServer ${hex(p.raw)}`);
    if (p.head === 0x00) {
      socket.write(Buffer.from([0xc1, 0x04, 0xf4, 0x02]));
    } else if (p.head === 0xf4 && p.sub === 0x02) {
      const count = p.payload[0];
      code = p.payload[1] | (p.payload[2] << 8);
      log(`  服务器数量=${count} 首个 code=${code} 在线=${p.payload[3]}`);
      const req = Buffer.from([0xc1, 0x05, 0xf4, 0x03, code & 0xff]);
      socket.write(req);
    } else if (p.head === 0xf4 && p.sub === 0x03) {
      // 服务端地址结构 char[16] 只写了前几个字节，后面是未初始化栈数据，必须从首个 \0 截断
      const address = p.payload.subarray(0, 16).toString('latin1').replace(/\0.*$/s, '').trim();
      const port = p.payload.readUInt16LE(16);
      result = { address, port };
      log(`  GameServer 地址 = ${address}:${port}`);
      socket.end();
    }
  });

  socket.on('data', split);
  await new Promise(r => socket.on('close', r));
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  let host = args[0];
  let port = Number(args[1] || 0);

  if (!host) {
    log('== 1) 向 ConnectServer(44405) 请求服务器地址 ==');
    const resolved = await resolveGameServer();
    if (!resolved) throw new Error('ConnectServer 未返回地址');
    host = resolved.address === '0.0.0.0' ? '127.0.0.1' : resolved.address;
    port = resolved.port;
  }

  log(`\n== 2) 连接 GameServer ${host}:${port}，账号 ${ACCOUNT} / 密码 ${'*'.repeat(PASSWORD.length)} ==`);

  const socket = connect({ host, port });
  let stage = 'login';
  let charName = null;

  /**
   * 发往 GameServer 的包，三层依次上：
   *   1) Xor32：服务端 ExtractPacket 会对 3..end 做 XorData，必须先编码
   *   2) 若为 C3/C4：SimpleModulus
   *   3) 流加密（ENCRYPT_STATE）
   */
  const sendPacket = buf => {
    const p = Buffer.from(buf);
    cryptoMod.xor32Encrypt(p);
    const sm = p[0] >= 0xc3 ? Buffer.from(encryptor.encrypt(new Uint8Array(p))) : p;
    socket.write(streamEncrypt(sm));
  };

  const split = makeSplitter(raw => {
    const p = decodePacket(raw);
    log(`  ← ${hex(p.raw)}${p.encrypted ? `  [解密后 head=${p.head.toString(16)} sub=${p.sub.toString(16)} counterOk=${p.counterOk}]` : ''}`);

    if (p.head === 0xf1 && p.sub === 0x00) {
      log(`\n  【服务器握手】版本=${p.payload.subarray(3, 8).toString('latin1')} index=${p.payload[1] | (p.payload[2] << 8)}`);
      log('  → F1/04 设置语言 (0=English)');
      sendPacket(buildLangPacket(0));
      log(`  → F1/05 上报 HWID ${HWID}`);
      sendPacket(buildHwidPacket());
      const login = buildLoginPacket();
      log(`  → F1/01 登录明文 ${hex(login)}`);
      sendPacket(login);
      return;
    }

    if (p.head === 0xf1 && p.sub === 0x01) {
      const resultCode = p.payload[0];
      // 服务端语义（GameServer/JSProtocol.cpp + JoinServerProtocol.cpp）：
      //   1 = 成功（JoinServer 用 1 表示成功，不是 0）
      const names = {
        0: '账号或密码错误',
        1: '成功',
        2: '账号不存在 / 数据库查询失败',
        3: '账号已连接',
        4: '服务器账号数已满',
        5: '账号被封禁或硬件ID/IP 在黑名单',
        6: '客户端版本或序列号不匹配',
        8: '重复登录失败次数过多',
        11: '服务器锁定',
      };
      log(`\n  【登录结果】${resultCode} = ${names[resultCode] ?? '未知'}`);
      if (resultCode === 1) {
        stage = 'charlist';
        log('  → 请求角色列表 C1 04 F3 00');
        sendPacket(buildCharListPacket());
      } else {
        socket.end();
      }
      return;
    }

    if (p.head === 0xf3 && p.sub === 0x00) {
      const count = p.payload[0];
      log(`\n  【角色列表】${count} 个角色`);
      // 每条 26 字节：slot(1) + Name[10] + 对齐填充(1) + Level(2) + CtlCode(1) + CharSet[11]
      const ENTRY = 26;
      let off = 1;
      const chars = [];
      for (let i = 0; i < count; i++) {
        const slot = p.payload[off];
        const name = p.payload.subarray(off + 1, off + 11).toString('latin1').replace(/\0+$/, '');
        const level = p.payload.readUInt16LE(off + 12);
        const ctl = p.payload[off + 14];
        const charSet = Array.from(p.payload.subarray(off + 15, off + 26));
        chars.push({ slot, name, level, ctl, charSet });
        log(`    [${slot}] ${name} 等级 ${level} CtlCode ${ctl} CharSet ${charSet.join(',')}`);
        off += ENTRY;
      }
      if (chars.length === 0) {
        log('  ! 该账号没有角色');
        socket.end();
        return;
      }
      charName = process.env.MU_CHAR && chars.find(c => c.name === process.env.MU_CHAR)
        ? process.env.MU_CHAR
        : chars[0].name;
      stage = 'select';
      const pkt = buildCharSelectPacket(charName);
      log(`  → 选择角色 ${charName}：${hex(pkt)}`);
      sendPacket(pkt);
      return;
    }

    if (p.head === 0xf3 && p.sub === 0x03) {
      const pl = p.payload;
      log(`\n  【角色信息】`);
      log(`    X=${pl[0]} Y=${pl[1]} Map=${pl[2]} Dir=${pl[3]}`);
      log(`    Exp=${pl.readUInt32LE(4)} NextExp=${pl.readUInt32LE(8)}`);
      const u16 = o => pl.readUInt16LE(o);
      log(`    力量=${u16(14)} 敏捷=${u16(16)} 体力=${u16(18)} 智力=${u16(20)}`);
      log(`    HP=${u16(22)}/${u16(24)} MP=${u16(26)}/${u16(28)}`);
      log(`    金钱=${pl.readUInt32LE(32)}`);
      log(`\n  ✓ 登录链跑通：账号登录 → 角色列表 → 选角进入游戏`);
      return;
    }

    if (p.head === 0x03) {
      // 服务端 MainCheck 挑战，客户端必须用 C3 回显（否则被判作弊直接断开）
      const ack = Buffer.from(p.raw);
      ack[0] = 0xc3;
      log(`  → 0x03 MainCheck 回显 ${hex(ack)}`);
      sendPacket(ack);
      return;
    }

    if (p.head === 0xf1 && p.sub === 0x02) {
      log(`\n  【服务器断开】F1/02 type=${p.payload[0]}`);
      return;
    }

    if (p.head === 0xf3 && p.sub === 0x01) {
      log(`  【角色创建结果】${p.payload[0]}`);
    }
  });

  // GameServer 收发都要过那一层流加密
  socket.on('data', chunk => {
    const plain = streamDecrypt(chunk);
    log(`  [raw ${chunk.length}B] ${hex(plain)}`);
    split(plain);
  });
  socket.on('error', err => log('!! socket 错误', err.message));
  socket.on('close', () => log('连接已关闭'));

  log(`  流加密密钥 xor=0x${STREAM.xor.toString(16)} add=0x${STREAM.add.toString(16)}` +
    `（CustomerName=${SERVER.customerName}，版本 ${CLIENT_VERSION.map(c => String.fromCharCode(c)).join('')}）`);
  log('  等待服务器握手包 F1/00 …');

  await new Promise(r => setTimeout(r, Number(process.env.MU_HOLD || 6000)));
  // 正常退出：不发 F1/02 账号会卡在 JoinServer 在线表里
  try {
    sendPacket(Buffer.from([0xc3, 0x05, 0xf1, 0x02, 0x00]));
  } catch {}
  await new Promise(r => setTimeout(r, 300));
  socket.end();
  process.exit(0);
}

main().catch(err => {
  console.error('失败:', err.message);
  process.exit(1);
});
