/**
 * GitHub Pages 本地仿真（项目站点子路径）。
 *
 *   node tools/serve-gh.mjs            # → http://127.0.0.1:5199/mu-three/
 *   node tools/serve-gh.mjs 5200       # 换端口
 *
 * 为什么不用 `vite preview`：preview **不认** `base`，它把 `dist` 挂在根路径，
 * 于是 `dist/index.html` 里那些 `/mu-three/assets/...` 全部 404（回转成 index.html），
 * 页面白屏。GH Pages 的真实行为是「仓库内容挂在 /<repo>/ 下」，
 * 所以这里按同样的规则做一个最小静态服务器：
 *
 *   /mu-three/xxx  → dist/xxx
 *   /mu-three/demo → dist/404.html（GH Pages 对不存在的路径返回 404.html）
 *   其它           → dist/404.html，状态码 404
 *
 * 顺带把 `404.html` 兜底 `/demo` 这件事也一起验了 —— 这正是线上的运行方式。
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';

const PORT = Number(process.argv[2] ?? 5199);
const PREFIX = '/mu-three/';
const DIST = resolve(process.cwd(), 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bmd': 'application/octet-stream',
  '.ozj': 'application/octet-stream',
  '.ozt': 'application/octet-stream',
  '.dat': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.bmp': 'image/bmp',
  '.tga': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const send = (res, file, status = 200) => {
  res.writeHead(status, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    'Cache-Control': 'no-cache',
  });
  createReadStream(file).pipe(res);
};

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (!url.startsWith(PREFIX)) {
    /*
     * 严格按 GH Pages 的行为：仓库挂在 `/mu-three/` 下，其它路径一律不存在。
     * 以前这里会 302 到前缀，结果把「忘了拼 base」的 bug 全掩盖了
     * （浏览器自动跟随跳转，照样能取到文件，线上却 404）。
     */
    const fallback = join(DIST, '404.html');
    if (existsSync(fallback) && url !== '/') send(res, fallback, 404);
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`只在这个前缀下提供服务：${PREFIX}`);
    }
    return;
  }
  const rel = url.slice(PREFIX.length) || 'index.html';
  const file = normalize(join(DIST, rel));
  if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
    send(res, file);
    return;
  }
  // GH Pages：找不到就回 404.html（内容是我们同一份 index.html）
  const fallback = join(DIST, '404.html');
  if (existsSync(fallback)) send(res, fallback, 404);
  else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404（dist/404.html 不存在，先 npm run build）');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[serve-gh] http://127.0.0.1:${PORT}${PREFIX}  （dist → ${PREFIX}）`);
});
