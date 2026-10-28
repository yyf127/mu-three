/**
 * 静态资源根路径（`base`）。
 *
 * 资源全部放在 `dist/Data`（原版客户端目录原样拷贝，见 `vite.config.ts`）。
 * 本地开发时 `base = '/'`，`/Data/...` 直接命中 `dist/Data`；
 * 部署到 GitHub Pages 项目站点时 `base = '/mu-three/'`，**所有资源 URL 都必须带
 * 这个前缀**，否则绝对路径会指到 `https://yyf127.github.io/Data/...`（404）。
 *
 * 之前全项目的资源路径都是硬编码 `/Data/xxx`，在根路径下的托管没问题，
 * 一到子路径就整站白屏 —— 统一从这里拼。
 */
const BASE = import.meta.env.BASE_URL || '/';

/**
 * 拼资源 URL。
 *
 * - 已经是绝对 URL（`http:` / `https:` / 协议相对 `//`）或 `data:` / `blob:`
 *   的原样返回（贴图解码后会变成 blob URL，不能被二次拼接）；
 * - 传入 `/Data/x` 和 `Data/x` 等价，都会拼到 `BASE` 后面。
 */
export function assetUrl(path: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path)) return path;
  if (path.startsWith('data:') || path.startsWith('blob:')) return path;
  const clean = path.replace(/^\.?\//, '');
  return BASE.endsWith('/') ? BASE + clean : `${BASE}/${clean}`;
}
