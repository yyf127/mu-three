# mu-three · 在线演示

MU Online 0.97k 的 H5 客户端（three.js）离线演示站，仓库内容是 `vite build` 的产物。

- 演示地址：https://yyf127.github.io/mu-three/demo
- 首页（真实登录入口，需要本机 GameServer + WS 网关）：https://yyf127.github.io/mu-three/

## 内容

| 路径 | 说明 |
|---|---|
| `index.html` / `assets/` | 构建产物（JS/CSS） |
| `404.html` | 与 index.html 同一份，GitHub Pages 上把 `/demo` 兜到它 |
| `Data/` | 原版客户端资源（BMD/OZJ/OZT/音频/文本表），运行时按 `<base>Data/...` 读取 |
| `.nojekyll` | 关掉 Jekyll，避免静态资源被过滤/拖慢 |

## 重新构建

```bash
npm run build          # base 默认 /mu-three/
npm run build -- --base=/    # 部署到域名根路径时（或 MU_BASE=/ npm run build）
```

构建直接写回本目录（`emptyOutDir: false`，`Data/` 不会被清），随后在 `dist/` 里
`git add -A && git commit && git push` 即可更新线上。
