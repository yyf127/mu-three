import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { copyFileSync, cpSync, existsSync, mkdirSync, statSync, createReadStream, rmSync, writeFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
// 网关核心与 server/bridge.mjs 共用同一份实现，避免两份转发逻辑漂移
import { createBridge } from './server/bridge-core.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
/**
 * 站点根目录（构建产物 + 静态资源）。
 *
 * **资源只有一份**：原版客户端的 `Data/` 直接放在 `dist/Data`，dev / preview /
 * GitHub Pages 全都读这里（以前 `publicDir` 指向 `../muonlinejs-master/public`，
 * 构建时再整份拷进 dist，等于 208MB 存两遍，仓库也不自包含）。
 */
const DIST = join(ROOT, 'dist');

/**
 * 站点 base。
 *
 * - `npm run dev` → `/`（本地根路径）
 * - `npm run build` → `/mu-three/`（GitHub Pages 项目站点）
 * - 换仓库名 / 自定义域名 / 根路径预览：`MU_BASE=/ npm run build`
 */
const BUILD_BASE = process.env.MU_BASE || '/mu-three/';

/** 静态资源的 MIME（只覆盖 Data 下出现的扩展名） */
const MIME: Record<string, string> = {
  '.bmd': 'application/octet-stream',
  '.ozj': 'application/octet-stream',
  '.ozt': 'application/octet-stream',
  '.dat': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.bmp': 'image/bmp',
  '.tga': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/**
 * 把 WS ↔ TCP 网关直接嵌进 dev server：
 *
 *   浏览器 ──ws://127.0.0.1:5180/mu──► 本插件 ──TCP──► 44405 / 55901
 *
 * 好处是不用再单开 5181；浏览器侧全部同源，也不存在跨域和"忘记起网关"的问题。
 * 路径固定 /mu，跟 Vite 自己的 HMR socket（根路径）互不干扰。
 * `vite build` 之后没有 dev server，那时才需要 `npm run net:bridge`。
 */
function muBridge(): Plugin {
  const bridge = createBridge({ log: process.env.MU_LOG === '1' });

  return {
    name: 'mu-bridge',
    apply: 'serve',
    configureServer(server) {
      // 同源 /mu-config：前端据此推导服务端流加密密钥
      server.middlewares.use((req, res, next) => {
        if (bridge.handleHttp(req, res)) return;
        next();
      });

      if (!server.httpServer) return;
      const { detach } = bridge.attach(server.httpServer, { wsPath: '/mu' });
      server.httpServer.on('close', detach);

      server.httpServer.on('listening', () => {
        console.log('[mu-bridge] 网关已内嵌：ws://127.0.0.1:5180/mu');
      });
    },
  };
}

/**
 * `/Data/**` 静态资源中间件（dev + preview 共用）。
 *
 * `publicDir` 关掉之后 Vite 不再替我们托管静态资源，而资源又必须只有一份
 * （`dist/Data`），所以这里直接按文件流回出去。同时兼容：
 *
 *   /Data/Item/x.bmd          ← dev（base = /）
 *   /mu-three/Data/Item/x.bmd ← preview / GH Pages（base = /mu-three/）
 *
 * 只截 `/Data/` 这一段之后的部分去 `dist` 里找，跟 base 无关。
 */
function localAssets(): Plugin {
  const handler = (req: any, res: any, next: () => void) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]);
    /*
     * 两个静态根：
     *   /Data/**    → dist/Data（原版客户端资源）
     *   /server/**  → server/    （服务端侧资产：sqlite 配置库等）
     * 前端统一用 `assetUrl('server/data/game.db')` 取。
     */
    const m = /\/(Data|server)\//.exec(url);
    if (!m) return next();
    const rel = url.slice(m.index + 1);
    const root = m[1] === 'Data' ? DIST : ROOT;
    const file = normalize(join(root, rel));
    // 目录穿越防护：必须落在 dist 内
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return next();

    const size = statSync(file).size;
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', size);
    /*
     * 资源名固定、内容不变，可以放心长缓存；用 `no-cache` 让改了同名文件
     * （例如重新生成 textures-index.json）能立刻生效。
     */
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };

  return {
    name: 'mu-local-assets',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

/**
 * 每次构建前清掉上一版的 `dist/assets` 和两个 html。
 *
 * `emptyOutDir` 必须关（`dist/Data` 是资源本体，清掉就得重拷 208MB），
 * 所以带 hash 的旧 chunk 得自己收。
 */
function cleanBuild(): Plugin {
  return {
    name: 'mu-clean-build',
    apply: 'build',
    buildStart() {
      for (const p of ['assets', 'index.html', '404.html']) {
        rmSync(join(DIST, p), { recursive: true, force: true });
      }
    },
  };
}

/**
 * `/demo` 这个地址要落到 `index.html`（离线演示页 = 同一份页面，运行时靠
 * `location.pathname` 判断走假数据）。
 *
 * 为什么不用单独一份 `demo.html`：index.html 里有 400 多行 DOM（登录/选角/HUD/
 * 各种面板），复制一份以后每次改界面都得同步两处。改成「同一份 HTML + 路径判断」，
 * 部署到 GitHub Pages 时再拷一份 `404.html` 兜底就够（那个环境没有服务端路由）。
 */
function demoAlias(): Plugin {
  const rewrite = (req: { url?: string }) => {
    const url = req.url ?? '';
    const path = url.split('?')[0].replace(/\/+$/, '');
    // dev 是 /demo，preview / GH Pages 是 <base>demo —— 都认
    if (/\/demo$/.test(path) || /\/demo\/index\.html$/.test(path)) {
      const base = path.slice(0, path.length - 'demo'.length);
      req.url = `${base}index.html` + (url.includes('?') ? url.slice(url.indexOf('?')) : '');
    }
  };
  return {
    name: 'mu-demo-alias',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req);
        next();
      });
    },
    /**
     * `vite build` 之后把 `dist/index.html` 复制一份成 `dist/404.html`。
     *
     * GitHub Pages 是纯静态托管、没有路由，访问 `/mu-three/demo` 会 404 ——
     * 它会把 `404.html` 当内容返回，于是落到同一份 index.html，
     * 运行时的 `location.pathname` 判断就把它当演示模式跑起来。
     */
    closeBundle() {
      const index = join(DIST, 'index.html');
      if (!existsSync(index)) return;
      copyFileSync(index, join(DIST, '404.html'));
      console.log('[mu-demo-alias] dist/404.html 已生成（GitHub Pages 的 /demo 兜底）');

      /*
       * 服务端配置（`server/data/game.json`）也要进 dist —— 线上只有静态文件，
       * 浏览器得能 `fetch('/mu-three/server/data/game.json')`。
       * 源文件放在 server/ 下（跟网关代码一起），dist 里的是副本。
       */
      const dbSrc = join(ROOT, 'server', 'data');
      if (existsSync(dbSrc)) {
        mkdirSync(join(DIST, 'server'), { recursive: true });
        cpSync(dbSrc, join(DIST, 'server', 'data'), { recursive: true, force: true });
        console.log('[mu-demo-alias] dist/server/data 已同步（服务端配置 JSON）');
      }

      /*
       * Cloudflare Pages 的两个约定文件。GitHub Pages 不认识它们，会当普通
       * 文件忽略，所以同一份 dist 可以同时喂两边。
       *
       * `_redirects`：`/demo` 直接 200 重写到 index.html。
       *   没有它的话 Cloudflare 会走 404.html 兜底 —— 页面能开，但状态码是
       *   404，浏览器控制台会红一条，SEO/监控也难看。
       *
       * `_headers`：`Data/` 是 208MB 的原始资源，Cloudflare 默认只给
       *   `max-age=0, must-revalidate`，每次进图都要为几千个文件各发一次
       *   协商请求。这里给长缓存（文件名固定，改资源要清缓存或用新文件名）。
       */
      const bp = BUILD_BASE.endsWith('/') ? BUILD_BASE : `${BUILD_BASE}/`;
      writeFileSync(
        join(DIST, '_redirects'),
        `# Cloudflare Pages 专用；GitHub Pages 会忽略\n${bp}demo ${bp}index.html 200\n`
      );
      writeFileSync(
        join(DIST, '_headers'),
        [
          '# Cloudflare Pages 专用；GitHub Pages 会忽略',
          '# 带 hash 的构建产物可以永久缓存',
          '/assets/*',
          '  Cache-Control: public, max-age=31536000, immutable',
          '',
          '# 入口 HTML 绝不能被缓存，否则发版后用户还打开旧页面',
          '/index.html',
          '  Cache-Control: no-cache',
          '/404.html',
          '  Cache-Control: no-cache',
          '',
          '# 原版资源（bmd/ozj/ozt）：体积大、名字固定，给一周',
          '/Data/*',
          '  Cache-Control: public, max-age=604800',
          '',
          '# 服务端配置可能随构建变化',
          '/server/*',
          '  Cache-Control: no-cache',
          '',
        ].join('\n')
      );
      console.log('[mu-demo-alias] dist/_redirects、dist/_headers 已生成（Cloudflare Pages）');
    },
  };
}

export default defineConfig(({ command }) => ({
  /**
   * 资源不再走 publicDir：`dist/Data` 是唯一一份，由 `localAssets` 直接托管。
   * 好处是 dev 改完资源立刻生效，构建也不用再拷 208MB。
   */
  publicDir: false,
  base: command === 'build' ? BUILD_BASE : '/',
  plugins: [cleanBuild(), localAssets(), muBridge(), demoAlias()],
  server: {
    port: 5180,
    host: '127.0.0.1',
    strictPort: false,
    fs: { allow: [ROOT] },
  },
  preview: {
    port: 5180,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    outDir: DIST,
    // dist/Data 是资源本体，不能被清掉
    emptyOutDir: false,
  },
}));
