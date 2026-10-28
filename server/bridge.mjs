/**
 * 独立网关进程：WebSocket ↔ TCP 转发。
 *
 * 浏览器不能开裸 TCP，而 MU 的 ConnectServer / GameServer 都是裸 TCP，
 * 所以中间必须有一层转发。**日常开发不用单独跑它** —— vite.config.ts 已经把
 * 同一套逻辑（server/bridge-core.mjs）挂到 dev server 的 /mu 上了，
 * 打开 5180 就能登录。只有下面两种情况需要这个独立进程：
 *
 *   - 构建产物（vite build 后没有 dev server 了）
 *   - 单独排查网关：想看每条连接的日志、或想让 5181 长期常驻
 *
 * 用法：
 *   node server/bridge.mjs                     # 默认 0.0.0.0:5181
 *   PORT=5181 node server/bridge.mjs
 *
 * 浏览器端：
 *   new WebSocket('ws://127.0.0.1:5181/?host=127.0.0.1&port=44405')
 *
 * 每个 WebSocket 连接对应一条独立的 TCP 连接，二进制透传，不做任何改写。
 * 设置 MU_LOG=1 可以把双向报文以十六进制打到控制台。
 */
import { createServer } from 'node:http';
import { createBridge } from './bridge-core.mjs';

const PORT = Number(process.env.PORT || 5181);
const HOST = process.env.HOST || '0.0.0.0';
const LOG = process.env.MU_LOG === '1';

const bridge = createBridge({ log: LOG });

const http = createServer((req, res) => {
  if (bridge.handleHttp(req, res)) return;

  res.writeHead(426, { 'content-type': 'text/plain' });
  res.end('WebSocket only. Example: ws://127.0.0.1:5181/?host=127.0.0.1&port=44405');
});

bridge.attach(http, { wsPath: '/' });

http.listen(PORT, HOST, () => {
  console.log(`[bridge] listening ws://${HOST}:${PORT}/?host=<ip>&port=<port>`);
  if (LOG) console.log('[bridge] 报文日志已开启');
});
