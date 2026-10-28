# 部署（GitHub Pages · 源码仓库 + Actions 构建）

演示站：**https://yyf127.github.io/mu-three/demo**
仓库：**https://github.com/yyf127/mu-three**（**源码 + 资源**，不是构建产物）

---

## 一、仓库结构

| 路径 | 进仓库 | 说明 |
|---|---|---|
| `src/`（96 个文件） | ✅ | 应用源码（TS/CSS） |
| `index.html`、`vite.config.ts`、`tsconfig.json`、`package*.json` | ✅ | 构建入口与配置 |
| `server/` | ✅ | WS ↔ TCP 网关（实机版 `npm run net:bridge` 用） |
| `tools/` | ✅ | 探针与工具（`demo-probe.mjs`、`serve-gh.mjs` …） |
| `docs/` | ✅ | 设计/迁移/部署文档 |
| `dist/Data/`（3548 个文件，208MB） | ✅ | 原版客户端资源；`vite.config.ts` 的 `localAssets()` 直接托管，dev/CI/线上共用这一份 |
| `dist/assets/`、`dist/index.html`、`dist/404.html` | ❌ | 构建产物，`.gitignore` 排除，CI 生成 |
| `node_modules/`、`*.log`、`shots/`、`*.png`、`.tmp/`、`dist-verify/`、`net-test.html` | ❌ | 依赖 / 调试产物 |

为什么资源不放 `public/`：项目从一开始就是「直接加载原版 `Data/`」，
`publicDir: false` + `localAssets()` 中间件让 **dev / 构建 / 线上读同一份** `dist/Data`，
不会出现「本地能跑、线上 404」。

## 二、构建与 base path

```ts
// vite.config.ts
publicDir: false,
base: command === 'build' ? (process.env.MU_BASE || '/mu-three/') : '/',
build: { outDir: DIST, emptyOutDir: false },   // DIST = <repo>/dist，Data 不被清
```

- `npm run dev` → base `/`，`http://127.0.0.1:5180/`
- `npm run build` → base `/mu-three/`（仓库名），产物写回 `dist/`
- 换仓库名 / 自定义域名 / 根路径：`npm run build -- --base=/` 或 `MU_BASE=/ npm run build`

所有资源 URL 必须经过 `src/core/base.ts::assetUrl()`：

```ts
assetUrl('Data/Item/x.bmd')  // dev → /Data/...   线上 → /mu-three/Data/...
```

收口点：`core/texture.ts::fetchBytes`、`data/localText.ts`、`data/quests.ts`、
`data/equipCatalog.ts`、`audio/sound.ts`、`net/connection.ts`、`ui/ozj.ts`、`ui/logoAssets.ts`。

## 三、本地验证（推之前）

```bash
npm run tsc
npm run build
npm run serve:gh                  # http://127.0.0.1:5199/mu-three/（严格仿真子路径）
node tools/demo-probe.mjs http://127.0.0.1:5199/mu-three/demo        # 期望 28/28
```

> `vite preview` **不认 base**（把 dist 挂在根路径），子路径验证会白屏且没有报错，
> 必须用 `serve:gh`。

## 四、发布流程

仓库已配置 `.github/workflows/deploy.yml`：

```
push main → checkout → setup-node 20 → npm ci → npm run build
         → upload-pages-artifact(dist) → deploy-pages
```

日常更新只要：

```bash
git add -A
git commit -m "feat: ..."
git push
```

看状态：

```bash
gh run list --limit 3
gh run watch
gh api repos/yyf127/mu-three/pages --jq '{status, html_url, build_type}'
```

### 首次 / 换仓库时的一次性设置

1. 仓库 **Settings → Pages → Source = GitHub Actions**（`build_type=workflow`）；
2. `Actions → General → Workflow permissions` 保持默认（工作流已声明
   `pages: write` / `id-token: write`）；
3. 推一次触发构建。

> 不要再选「Deploy from a branch」：源码仓库根目录没有构建产物，分支发布会直接 404。

## 五、线上验证

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://yyf127.github.io/mu-three/
curl -s -o /dev/null -w "%{http_code}\n" https://yyf127.github.io/mu-three/demo
curl -s -o /dev/null -w "%{http_code}\n" https://yyf127.github.io/mu-three/Data/Local/Text.bmd
node tools/demo-probe.mjs https://yyf127.github.io/mu-three/demo   # 期望 28/28
```

> `/mu-three/demo` 的 **HTTP 状态是 404**，内容是我们构建出的 `404.html`（= 同一份
> index.html）。这是 GH Pages 的既定行为，浏览器照常渲染，不是部署失败。

## 六、本地实机版（连自己的服务端）

```bash
npm run dev            # 内置 WS 网关：/mu → TCP 44405 / 55901
# 或：独立网关 + 构建产物
npm run build -- --base=/
npm run preview
npm run net:bridge     # 另开终端，ws://127.0.0.1:5181
```

前端 `bridgeUrls()` 先试同源 `/mu`，失败再试 `127.0.0.1:5181`，两种跑法都不用改代码。
线上只有静态文件，**没有** ConnectServer/GameServer，所以线上只跑 `/demo`。

## 七、常见问题

### `git push` 报 `RPC failed; curl 55` / `CONNECT tunnel failed, response 502` / `Failed to connect`

本机有 `http_proxy=http://127.0.0.1:6706`，对 `github.com` 会间歇性 502，直连有时也被挡。
交替重试最稳：

```bash
for i in $(seq 1 20); do
  env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY git push && break
  sleep 10
  git push && break
  sleep 10
done
```

### Actions 里 `npm ci` 失败

`package-lock.json` 必须和 `package.json` 同步（改依赖后本地 `npm install` 再提交）。

### 页面白屏、控制台没有报错

90% 是 base 没拼：确认 `dist/index.html` 里是 `/mu-three/assets/...`，
以及新增的 `fetch` 有没有走 `assetUrl()`。

### `Data/` 能不能裁剪

演示只需要 `World1` + `Player` + `Interface` + `Local` + `Item` + `Logo`；
`World2..12`、`Monster`、`NPC`、`Sound`、`Music` 是实机版要用。裁剪后跑一遍
`serve:gh` + `demo-probe` 再推。
