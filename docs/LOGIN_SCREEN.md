# 登录 / 选角界面（`Data/Logo`）

> 用原版 `Data/Logo` 的贴图重做登录界面与角色选择界面。
> 登录界面按原版 **640×480 逻辑坐标**写死在 CSS 里，整层 `scale()` 到舞台
> （见下文「逻辑层」），不做百分比换算。

## 1. 资源 → 槽位（源码 `Scene/Scene_Resources.cpp`）

### `Scene_LoadAccountResources()`（登录 / 账号界面）

| 槽 | 文件 | 尺寸 | 用途 |
|---|---|---|---|
| `0xC` | `0account_new.tga` | 250×216 | **账号面板底板** |
| `0xD` | `0On_Botton.jpg` | 70×19 | OK 按钮 |
| `0xE` | `0On_Botton2.jpg` | 70×20 | 取消按钮 |
| `0xF` | `0Text_Box.jpg` | 124×16 | 输入框底 |
| `0x10` | `0New_Account01.tga` | 256×256 | 新账号页 |
| `0x11` | `0New_Account02.tga` | 256×77 | 新账号页下半 |
| `0x12` | `0Box.jpg` | — | 输入框 |
| `0x13/0x14` | `Interface/Progress_Back.jpg` / `Progress.jpg` | — | 连接进度条 |
| 模型 `0x3C` | `Object1/ship.smd` | — | 登录场景里的船 |
| 模型 `0xA0..0xA3` | `Logo01..04.bmd` | — | 登录场景 3D 元素（MU 字样 / 太阳 / 岛） |

### `Scene_LoadCharSelectResources()`（选角界面）

| 槽 | 文件 | 尺寸 | 用途 |
|---|---|---|---|
| `0xC..0xF` | `Interface01..04.tga` | 256×86 / 64×256 / 64×224 / 256×32 | 选角界面通用件 |
| `0x10` | `New_Character201.tga` | 199×109 | 创建角色面板 |
| `0x11` | `New_Character202.jpg` | 70×25 | 创建按钮 |
| `0x12` | `Delete01.tga` | 205×88 | 删除角色面板 |
| `0x13` | `Delete02.jpg` | 70×19 | 删除确认 |
| `0x14` | `Ok01.tga` | 205×88 | 提示面板 |
| `0x15` | `Ok02.jpg` | 70×19 | 提示确认 |
| `0x16` | `New_Character01.tga` | 213×256 | **选角主面板** |
| `0x17` | `New_Character02.tga` | 213×119 | 选角面板下半 |
| `0x18/0x19` | `New_Character_Cancel.jpg` / `_Ok.jpg` | 72×21 | 底部两键 |
| `0x1A..0x1D` | `New_character001..004.jpg` | 20×19 | 角色卡上的小图标 |
| 模型 `0xA4` | `Logo05.bmd` | — | 选角背景模型 |
| 模型 `0xAA..0xAD` | `Face01..04.bmd` | — | 四个职业的脸 |

## 2. 布局（源码 `Scene/Scene_Login.cpp`）

```
3D 视口   GL_BeginViewport(0, 0x50, 0x280, 0x140)   → (0, 80, 640, 320)
面板      GL_DrawTexture(0xC, 195, dialogY, 250, 216)
账号标签  RenderText(0xE3=227, dialogY + 50)      InputTextWidth = 0x77 (119)
账号输入  RenderInputText(0x127=295, dialogY + 50, field 0)
密码标签  RenderText(227, dialogY + 72)
密码输入  RenderInputText(295, dialogY + 72, field 1)
OK        GL_DrawTexture(0xD, 323, dialogY + 95, 70, 19)
取消      GL_DrawTexture(0xE, 285, dialogY + 180, 70, 20)
版本行    y = 0x1DF - cy*640/WindowWidth，x = 0 / 335
```

`dialogY`（`DAT_005616a4`）是滑入动画：`-100 → 6`（`+= (6 - y)/3`），退出时 `→ -258`。

> **我们改成垂直居中（132/480）**：源码的终值 6 会让 250×216 的面板顶住屏幕边，
> 实机上不像登录界面。

### 面板贴图里自带的「凹槽」和「空 plate」（对齐的关键）

`0account_new.tga` 不是一块纯金属底板，它上面**已经画好了控件底**。实测（250×216）：

| 位置 | 尺寸 | 用途 |
|---|---|---|
| `x 99..220, y 48..63` | 122×16 | 账号输入凹槽（文字写在里面） |
| `x 99..220, y 70..85` | 122×16 | 密码输入凹槽 |
| `(52,95) / (129,95) / (52,118) / (129,118)` | 各 70×19 | 2×2 空 plate |
| `(91,141)` | 70×19 | 空 plate |
| `(90,180)` | 70×20 | 取消按钮 plate |

所以：

* **输入框不能再贴 `0Text_Box.jpg`** —— 凹槽已经在图里了，再叠一层只会和凹槽差
  半个像素，看着就是「账号密码错位」。输入框现在是透明底，只负责接键盘和画光标。
* **按钮常态也是透明的**，露出面板上的 plate；只有 `:hover` 才把
  `0On_Botton*.jpg` 贴上去 —— 原版 `Scene_Login` 就是在 `if (鼠标在按钮范围内)`
  里才 `GL_DrawTexture(0xD/0xE)`。
* OK 落在 `(129,95)` 那个 plate 上（面板内坐标 `128,95` 的 70×19 正好盖住它），
  取消落在 `(90,180)`。**不要**为了「看起来居中」把 OK 往下挪 —— 一挪就压到
  下面那排空 plate 上了。

### 逻辑层（为什么不再用百分比）

`.mu-layer` 是定尺寸 `640px × 480px`、`transform-origin: 0 0` 的盒子，
`loginSkin.ts::layoutLoginLayer()` 按 `#stage` 宽度算 `scale()` 写进
`transform`（和 `#mu-ui` 同一个套路）。这样：

* CSS 里的 `left/top/width` 全是原版像素，抄源码不用换算；
* 字号也写 `12px`（原版字高），跟着整层一起放大，不会出现
  「盒子按百分比缩、文字按 css 像素不缩」导致的错位。

## 3. 文件格式的坑（重要）

### OZJ 前 24 字节是 Webzen 头

`Data/Logo/*.OZJ` 的头部是这样的：

```
00  FF D8 FF E0 00 10 4A 46 49 46 ... APP13 ...     ← 24 字节「假 JPEG」
24  FF D8 FF E0 ...                                  ← 真 JPEG 从这里开始
```

不切头直接给 `<img>` / `createImageBitmap`，会解出 **尺寸对、内容全黑**的图
（PIL 也一样：`extrema = ((0,0),(0,0),(0,0))`）。
原版 `Texture.cpp::tex_load_ozj` 就是 `fseek(f, 24, SEEK_SET)`。

判据：`bytes[24] === 0xFF && bytes[25] === 0xD8` → 从 24 开始。

### OZT 是 4 字节头 + 标准 TGA

```
00 00 02 00 | 00 00 02 00 00 00 00 00 | 00 01 56 00 | 20 08 ...
↑ 4 字节头   ↑ TGA 头(idLen/cmap/type + cmapSpec)  ↑ w=0x0100=256 h=0x0056=86  bpp=0x20 desc=0x08
```

`Interface/` 下那批是另一种变体（**22 字节头 + 裸 BGRA + 26 字节 footer**），
所以 `logoAssets.ts` 先按标准 TGA 解，长度对不上再退回裸像素分支。

### TGA 行序：送给 `<canvas>` 之前必须翻一次

`decodeTga()` 的输出**恒为「第 0 行 = 图像底部」**（`desc` 的 bit5 语义在原实现里
是反的，但恰好让两份分支都落在同一个行序上）。3D 那边没问题：`DataTexture` 默认
`flipY = true`，上传时 GPU 会翻回来。

`<canvas>` / `putImageData` 没有 flipY，直接用就会整张倒过来 —— 登录面板上下颠倒，
账号框跑到面板底部，看起来像「坐标全错了」，其实是图倒着。所以
`logoAssets.ts::decodeOztCanvas()` 里 `putImageData` 之前要 `flipRows()`。

> 排查手法：把面板元素 `clip` 出来缩回 250×216，和导出的 PNG 做 diff，
> `flipV` 的均值明显更低就是倒置（`node tools/login-align-probe.mjs` 的截图可复用）。

## 4. 实现

| 文件 | 职责 |
|---|---|
| `src/ui/logoAssets.ts` | `logoSprite(name)`：取 `/Data/Logo/*`，OZJ 切 24 字节、OZT 手解（含翻行）→ `<canvas>`；`logoCssUrl()` 转 dataURL |
| `src/ui/loginSkin.ts` | 启动时加载贴图并注入 `background-image`；`layoutLoginLayer()` 负责 640×480 逻辑层的 `scale()` |
| `index.html` | `#login` / `#charselect` 的结构（`.mu-screen` / `.mu-bg` / `.mu-layer` / `.mu-panel` / `.mu-btn`） |
| `src/style.css` | 末尾「登录界面」「选角界面」两节；登录部分全部是 640×480 逻辑像素 |
| `tools/login-align-probe.mjs` | 把 DOM 位置换算回逻辑坐标，逐条比对源码坐标（`MU_W/MU_H` 可换窗口尺寸） |

CSS 只写坐标和尺寸，图案由 JS 注入 —— 因为 OZT 浏览器不认、OZJ 要切头，
不能直接 `url(/Data/Logo/xxx.ozj)`。

## 5. 现状

已做：
- 背景 = `Sky0.OZJ`（黄昏天空，512×256）
- MU 标志 = `Logo.ozj`（256×128）
- 账号面板：凹槽 / plate 全部来自 `0account_new`，输入框透明，按钮悬停才贴
  `0On_Botton` / `0On_Botton2`（`0Text_Box` 在登录页不用，凹槽自带）
- 对齐探针 7 项全绿（面板 / 账号密码标签与输入 / OK / 取消），
  1280×760 与 1920×900 两种窗口都验过
- 选角界面：同背景 + 同标志 + 保留原角色卡列表

已做（2026-10-27 补）：
- **选择线路**：连 ConnectServer(44405) 拿真实列表（`F4/04` 名字 + `F4/02` 负载），
  点组 → 点线路 → `F4/03` 拿到 GameServer 地址 → 才进账号密码面板。
  背景沿用同一张登录背景（原版也是这样）。详见 `FEATURES.md` 阶段 BW。
  文件：`src/net/connectServer.ts`、`src/login/serverSelect.ts`、`style.css` 的 `.sv-*`。

待做：
1. **连接中的进度条**（子状态 1，`0x13`/`0x14` 那条 bar）：现在点完线路直接进账号面板，
   少了「连接中…」那 1~2 秒的过场。
2. **登录 3D 背景**：源码是真 3D 场景（`Terrain_Render` + `Logo01..04.bmd` + `ship.smd` + `Sky*`）。
   现在只是贴图，没有「太阳 / 岛 / 船 / MU 立体字样」。
3. **选角面板换成 `New_character01.tga`**：现在是自造的半透明深色面板
   （`213×256` 的图铺不满 `wide` 容器，需要重排角色卡尺寸）。
4. **角色脸**：`Face01..04.bmd` 是四个职业的 3D 脸，选角卡片现在用的是自绘缩略图。
