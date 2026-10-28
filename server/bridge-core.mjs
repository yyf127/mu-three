/**
 * WS ↔ TCP 网关核心。
 *
 * 浏览器不能开裸 TCP，而 MU 的 ConnectServer(44405) / GameServer(55901) 都是裸 TCP，
 * 所以中间必须有一层转发。这套逻辑有两个宿主：
 *
 *   1. server/bridge.mjs   —— 独立进程，监听 5181（生产 / 单独调试网关时用）
 *   2. vite.config.ts      —— 内嵌进 dev server，路径 /mu（同源 5180，不用单开端口）
 *
 * 两边共用本文件，避免逻辑漂移。
 */
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 服务端启动配置：流加密密钥要用里面的 CustomerName / ServerSerial 推 */
export const DEFAULT_INI = resolve(
  __dirname,
  '../../MuServer/GameServer/DATA/GameServerInfo - StartUp.dat'
);

export function readServerConfig(iniPath = DEFAULT_INI) {
  const cfg = { customerName: '', serverVersion: '', serverSerial: '' };
  try {
    const text = readFileSync(iniPath, 'latin1');
    const pick = key => text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() || '';
    cfg.customerName = pick('CustomerName');
    cfg.serverVersion = pick('ServerVersion');
    cfg.serverSerial = pick('ServerSerial');
  } catch (err) {
    cfg.error = `读不到 ${iniPath}: ${err.code || err.message}`;
  }
  return cfg;
}

const hex = buf => Buffer.from(buf).toString('hex').match(/.{1,2}/g)?.join(' ') ?? '';

/**
 * 建一个网关实例。
 *   handleHttp(req, res)      处理 /health、/mu-config，返回 true 表示已响应
 *   attach(httpServer, opts)  挂到某个 http.Server 的 upgrade 事件上，opts.wsPath 限定路径
 */
export function createBridge({ iniPath = DEFAULT_INI, log = false } = {}) {
  /** 活着的隧道，仅用于 /health 报数 */
  const tunnels = new Set();

  function handleHttp(req, res) {
    const path = (req.url || '/').split('?')[0];

    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, connections: tunnels.size }));
      return true;
    }

    // 浏览器拿不到服务端配置文件，这里代读后返回，供前端推导流加密密钥
    if (path === '/mu-config') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify(readServerConfig(iniPath)));
      return true;
    }

    return false;
  }

  /**
   * 把网关挂到 httpServer 上。
   * wsPath 为 '/' 时接管所有 upgrade（独立进程）；为 '/mu' 时只接自己那条，
   * 其它路径原样放过 —— Vite 的 HMR socket 也在这台 server 上。
   */
  function attach(httpServer, { wsPath = '/' } = {}) {
    // noServer：我们自己判断路径后再 handleUpgrade，避免和 Vite HMR 抢 socket
    const wss = new WebSocketServer({ noServer: true });

    const onUpgrade = (req, socket, head) => {
      let pathname = '/';
      try {
        pathname = new URL(req.url, 'http://localhost').pathname;
      } catch {
        /* 解析失败就当根路径 */
      }
      if (pathname !== wsPath) return; // 交给别的 upgrade 监听者（例如 Vite HMR）
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    };

    httpServer.on('upgrade', onUpgrade);

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const targetHost = url.searchParams.get('host') || '127.0.0.1';
      const targetPort = Number(url.searchParams.get('port') || 44405);
      const label = `${targetHost}:${targetPort}`;

      console.log(`[bridge] + ${label}`);

      const tcp = connect({ host: targetHost, port: targetPort });
      tcp.setNoDelay(true);
      tunnels.add(tcp);

      let closed = false;
      const shutdown = reason => {
        if (closed) return;
        closed = true;
        tunnels.delete(tcp);
        console.log(`[bridge] - ${label} (${reason})`);
        try {
          tcp.destroy();
        } catch {
          /* 已关 */
        }
        try {
          ws.close();
        } catch {
          /* 已关 */
        }
      };

      tcp.on('connect', () => console.log(`[bridge]   connected ${label}`));
      tcp.on('data', chunk => {
        if (log) console.log(`[tcp→ws] ${label}\n  ${hex(chunk)}`);
        if (ws.readyState === ws.OPEN) ws.send(chunk);
      });
      tcp.on('end', () => shutdown('tcp end'));
      tcp.on('close', () => shutdown('tcp close'));
      tcp.on('error', err => {
        console.log(`[bridge]   tcp error ${label}: ${err.code || err.message}`);
        shutdown('tcp error');
      });

      ws.on('message', (data, isBinary) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (log) console.log(`[ws→tcp] ${label}\n  ${hex(buf)}`);
        if (!tcp.destroyed) tcp.write(buf);
      });
      ws.on('close', () => shutdown('ws close'));
      ws.on('error', err => {
        console.log(`[bridge]   ws error ${label}: ${err.message}`);
        shutdown('ws error');
      });
    });

    return {
      wss,
      detach() {
        httpServer.off('upgrade', onUpgrade);
        wss.close();
      },
    };
  }

  return { handleHttp, attach };
}
