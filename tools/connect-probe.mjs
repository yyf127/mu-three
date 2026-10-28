/**
 * 假客户端：裸跑 ConnectServer 的三段交互，用来验证协议与桥接。
 *
 *   node tools/connect-probe.mjs                        # 直连 127.0.0.1:44405
 *   node tools/connect-probe.mjs 127.0.0.1 14405        # 直连模拟服
 *   node tools/connect-probe.mjs --ws 5181              # 经 WebSocket 桥
 *
 * 输出每一步的十六进制收发，方便和客户端源码/服务端源码对照。
 */
import { connect } from 'node:net';

const args = process.argv.slice(2);
const useWs = args[0] === '--ws';
const host = useWs ? '127.0.0.1' : args[0] || '127.0.0.1';
const port = Number(useWs ? args[1] || 44405 : args[1] || 44405);

const hex = buf =>
  Buffer.from(buf).toString('hex').match(/.{1,2}/g)?.join(' ') ?? '';
const log = (...a) => console.log(...a);

/** C1 04 F4 02 —— 请求服务器列表 */
const REQ_SERVER_LIST = Buffer.from([0xc1, 0x04, 0xf4, 0x02]);
/** C1 05 F4 03 <code:1> —— 请求服务器地址（服务端 struct 里 ServerCode 是 BYTE） */
const reqServerInfo = code => {
  const b = Buffer.alloc(5);
  b[0] = 0xc1;
  b[1] = 5;
  b[2] = 0xf4;
  b[3] = 0x03;
  b[4] = code & 0xff;
  return b;
};

function parsePackets(buf) {
  const out = [];
  let acc = buf;
  while (acc.length >= 2) {
    const type = acc[0];
    const headerSize = type === 0xc2 || type === 0xc4 ? 3 : 2;
    if (headerSize === 0) break;
    const size = headerSize === 2 ? acc[1] : (acc[1] << 8) | acc[2];
    if (size < headerSize || acc.length < size) break;
    out.push(acc.subarray(0, size));
    acc = acc.subarray(size);
  }
  return out;
}

function describe(packet) {
  const type = packet[0];
  const headerSize = type === 0xc2 || type === 0xc4 ? 3 : 2;
  const head = packet[headerSize];
  const sub = packet[headerSize + 1];

  if (head === 0x00) return `初始化结果 result=${packet[headerSize + 1]}`;
  if (head === 0xf4 && sub === 0x02) {
    const count = packet[headerSize + 2];
    const servers = [];
    let p = headerSize + 3;
    for (let i = 0; i < count; i++) {
      servers.push({ code: packet.readUInt16LE(p), users: packet[p + 2] });
      p += 3;
    }
    return `服务器列表 count=${count} ${JSON.stringify(servers)}`;
  }
  if (head === 0xf4 && sub === 0x03) {
    const addr = packet.subarray(headerSize + 2, headerSize + 18).toString('ascii').replace(/\0+$/, '');
    const port = packet.readUInt16LE(headerSize + 18);
    return `服务器地址 ${addr}:${port}`;
  }
  return `head=0x${head?.toString(16)} sub=0x${sub?.toString(16)}`;
}

async function runTcp() {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port }, () => {
      log(`已连接 ${host}:${port}`);
    });
    socket.setNoDelay(true);

    let acc = Buffer.alloc(0);
    let step = 0;

    const send = (name, buf) => {
      log(`→ ${name}: ${hex(buf)}`);
      socket.write(buf);
    };

    socket.on('data', chunk => {
      acc = Buffer.concat([acc, chunk]);
      log(`← ${hex(chunk)}`);

      for (const packet of parsePackets(acc)) {
        acc = acc.subarray(packet.length);
        log(`   ${describe(packet)}`);

        const hs = packet[0] === 0xc2 || packet[0] === 0xc4 ? 3 : 2;
        const head = packet[hs];
        const sub = packet[hs + 1];

        if (step === 0 && head === 0x00) {
          step = 1;
          send('请求服务器列表', REQ_SERVER_LIST);
        } else if (step === 1 && head === 0xf4 && sub === 0x02) {
          step = 2;
          const code = packet.length > hs + 3 ? packet.readUInt16LE(hs + 3) : 0;

          send(`请求服务器地址 code=${code}`, reqServerInfo(code));
        } else if (step === 2 && head === 0xf4 && sub === 0x03) {
          log('链路验证完成 ✓');
          socket.end();
          resolve();
        }
      }
    });

    socket.on('error', reject);
    socket.on('close', () => resolve());
    setTimeout(() => {
      log('超时结束');
      socket.destroy();
      resolve();
    }, 5000);
  });
}

async function runWs() {
  return new Promise((resolve, reject) => {
    const targetPort = Number(args[2] || 44405);
    const url = `ws://127.0.0.1:${port}/?host=${host}&port=${targetPort}`;
    log(`连接桥 ${url}`);
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    let step = 0;
    const send = (name, buf) => {
      log(`→ ${name}: ${hex(buf)}`);
      ws.send(new Uint8Array(buf));
    };

    ws.onopen = () => log('WebSocket 已建立');
    ws.onerror = e => reject(new Error('WebSocket 错误'));

    ws.onmessage = ev => {
      const chunk = Buffer.from(ev.data);
      log(`← ${hex(chunk)}`);
      for (const packet of parsePackets(chunk)) {
        log(`   ${describe(packet)}`);
        const hs = packet[0] === 0xc2 || packet[0] === 0xc4 ? 3 : 2;
        const head = packet[hs];
        const sub = packet[hs + 1];

        if (step === 0 && head === 0x00) {
          step = 1;
          send('请求服务器列表', REQ_SERVER_LIST);
        } else if (step === 1 && head === 0xf4 && sub === 0x02) {
          step = 2;
          const code = packet.length > hs + 3 ? packet.readUInt16LE(hs + 3) : 0;

          send(`请求服务器地址 code=${code}`, reqServerInfo(code));
        } else if (step === 2 && head === 0xf4 && sub === 0x03) {
          log('经桥链路验证完成 ✓');
          ws.close();
          resolve();
        }
      }
    };

    setTimeout(() => {
      log('超时结束');
      try { ws.close(); } catch {}
      resolve();
    }, 6000);
  });
}

(useWs ? runWs() : runTcp()).catch(err => {
  console.error('失败:', err.message);
  process.exitCode = 1;
});
