/**
 * 模拟 ConnectServer：只实现「握手 → 服务器列表 → 服务器地址」三段，
 * 用来在真实 MuServer 还没启动时把 浏览器 → 桥 → TCP → 服务端 这条链路跑通。
 *
 * 协议（来自 MuServer_Source/ConnectServer/ConnectServerProtocol.cpp）：
 *   服务端连上即发   C1 04 00 <result>
 *   客户端请求列表   C1 04 F4 02
 *   服务端回列表     C2 00 <size> F4 02 <count> [ <code:2> <users:1> ]*
 *   客户端请求地址   C1 05 F4 03 <serverCode>
 *   服务端回地址     C1 16 F4 03 <address:16> <port:2>
 *
 * 用法：node server/mock-connect.mjs [port]
 */
import { createServer } from 'node:net';

const PORT = Number(process.argv[2] || 14405);
const GAME_HOST = process.env.GAME_HOST || '127.0.0.1';
const GAME_PORT = Number(process.env.GAME_PORT || 55901);

const hex = buf =>
  Buffer.from(buf).toString('hex').match(/.{1,2}/g)?.join(' ') ?? '';

function serverListPacket() {
  const entries = [{ code: 0, users: 0 }];
  const size = 5 + 1 + entries.length * 3; // C2 头 5 字节 + count + entries
  const buf = Buffer.alloc(size);
  buf[0] = 0xc2;
  buf[1] = (size >> 8) & 0xff;
  buf[2] = size & 0xff;
  buf[3] = 0xf4;
  buf[4] = 0x02;
  buf[5] = entries.length;
  let p = 6;
  for (const e of entries) {
    buf.writeUInt16LE(e.code, p);
    p += 2;
    buf[p++] = e.users;
  }
  return buf;
}

function serverInfoPacket(address = GAME_HOST, port = GAME_PORT) {
  const size = 4 + 16 + 2;
  const buf = Buffer.alloc(size);
  buf[0] = 0xc1;
  buf[1] = size;
  buf[2] = 0xf4;
  buf[3] = 0x03;
  buf.write(address, 4, 16, 'ascii');
  buf.writeUInt16LE(port, 20);
  return buf;
}

const server = createServer(socket => {
  console.log(`[mock-cs] 客户端接入 ${socket.remoteAddress}:${socket.remotePort}`);
  socket.setNoDelay(true);

  // 连上即发初始化结果
  const init = Buffer.from([0xc1, 0x04, 0x00, 0x00]);
  socket.write(init);
  console.log(`[mock-cs] → ${hex(init)}`);

  let acc = Buffer.alloc(0);

  socket.on('data', chunk => {
    acc = Buffer.concat([acc, chunk]);
    console.log(`[mock-cs] ← ${hex(chunk)}`);

    while (acc.length >= 2) {
      const type = acc[0];
      const headerSize = type === 0xc2 || type === 0xc4 ? 3 : 2;
      const size = headerSize === 2 ? acc[1] : (acc[1] << 8) | acc[2];
      if (size < headerSize || acc.length < size) break;

      const packet = acc.subarray(0, size);
      acc = acc.subarray(size);

      const head = packet[2];
      const sub = packet[3];

      if (head === 0xf4 && sub === 0x02) {
        const reply = serverListPacket();
        socket.write(reply);
        console.log(`[mock-cs] → 服务器列表 ${hex(reply)}`);
      } else if (head === 0xf4 && sub === 0x03) {
        const code = packet.length > 4 ? packet[4] : 0;
        const reply = serverInfoPacket();
        socket.write(reply);
        console.log(`[mock-cs] → 服务器地址(code=${code}) ${hex(reply)}`);
      } else if (head === 0xf4 && sub === 0x04) {
        const reply = serverListPacket();
        socket.write(reply);
        console.log(`[mock-cs] → 自定义列表 ${hex(reply)}`);
      } else {
        console.log(`[mock-cs] 未处理的报文 head=0x${head?.toString(16)} sub=0x${sub?.toString(16)}`);
      }
    }
  });

  socket.on('error', () => {});
  socket.on('close', () => console.log('[mock-cs] 断开'));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-cs] listening 127.0.0.1:${PORT}（游戏服指向 ${GAME_HOST}:${GAME_PORT}）`);
});
