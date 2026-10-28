# 选角 / 新建角色界面

> 用 `Data/Logo` 的原版资源重做选角界面：**全屏 3D 背景 + 四周原版框 + 三块銘牌 + 新建角色面板**。
> 布局全部走 640×480 逻辑层（`.mu-layer` + 整层 `scale()`），坐标直接照抄
> `Scene/Scene_CharSelect.cpp` 与 `Render/Scene_CharPreview.cpp`。

## 0. 数值全部来自原版（不要再猜了）

上一版是「按实机截图反推」，怎么调都差一点。这一版改成**直接从反编译源码抄数**：

| 项目 | 来源 | 数值 |
|---|---|---|
| 相机位置 | `globals.cpp` → `CameraWalk_005615ec[wp5]` | `(200, -800, 300)`（MU 单位），再按 roll 做一次 `VectorIRotate` |
| 相机角度 | 同上 `wp5.ang` | pitch **−80**、yaw **0**、roll **−10** |
| FOV | `Camera_Movement.cpp::MoveCamera` | `CameraFOV = 45` |
| 角色站位 | `Net/Net_Process.cpp::Recv_CharList` | `x = slot×100`、`y = slot×50 − 50`（MU 单位） |
| 角色朝向 | 同上 | `rotate = (slot−1)×15°` |
| 布景 | `Game_EnterWorldTick.cpp` 一次性初始化 | `CreateObject(0xa4, {0,0,0}, {0,0,0}, 1.0)` —— **不旋转、不平移** |

两个关键结论：

1. **画面那点斜不是布景转的，是相机 roll = −10°**。原版 `Camera.cpp` 里
   `glRotatef(roll, 0,0,1)` 是视图矩阵的一部分。之前把布景转 −10° 只是碰巧有点像。
2. 相机位置**不是**直接用 `(200,-800,300)`：`MoveCamera` 先 `VectorIRotate(CurPos, AngleMatrix({0,0,roll}))`
   得到 `CameraPosition`。按 −10° 算出来是 `(335.9, −753.1, 300)` → 世界坐标 `(3.36, −7.53, 3.0)`。

### 代码里的旋钮（`src/login/charScene.ts` 顶部）

```ts
const CAM_POS_MU   = { x: 200, y: -800, z: 300 };  // MU 单位，×0.01 = 世界
const CAM_PITCH_DEG = -80;
const CAM_YAW_DEG   = 0;
const CAM_ROLL_DEG  = -10;
const CAM_FOV       = 45;

const CHAR_STEP_X = 100 * MODEL_SCALE;  // 槽位间横向 1 格
const CHAR_STEP_Y =  50 * MODEL_SCALE;  // 槽位间纵向半格
const CHAR_YAW_STEP = 15;               // 每个槽多转 15°
const CHAR_MAX = 5;
```

控制台临时改（不落盘）：`__MU_APP__.char3dCam({ x, y, z, pitch, yaw, roll, fov })`（位置是 MU 单位）。

### 把「树墙」按背面画（不这么干人全被挡）

`main_wood6.jpg` 是那圈**半径 5 个单位、高 9 个单位**的树墙（56 顶点、法线朝内）。
原版开着 `GL_CULL_FACE`，相机在墙外往里看时近侧是背面 → 被剔掉，所以不挡人；
我们默认是双面渲染，整面墙就糊在镜头和角色之间，画面一片漆黑。
`bmdProp.ts` 因此加了 `sideRules`，只把这一个 mesh 设成 `BackSide`：

```ts
buildBmdGroup('Data/Logo/', 'Logo05', { sideRules: [{ match: /wood6\.jpg/i, side: 'back' }] })
```

### 和原版实机截图的对比（数值）

拿用户给的两张 Win32 截图做参照（`clipboard-2026-10-25T23-49-52-*.jpg`，1026×768）：

| 指标 | 原版截图 | 本版 |
|---|---|---|
| 角色带平均亮度 | 46（RGB 58,48,30） | 45（RGB 56,48,30） |
| 横向边缘分布 | 峰在 x≈0.25–0.55 | 同区间 |
| 角色剪影高度 | — | 128–142 px（4 只一致，无遮挡） |

### 人物细节 / 光照（对着原版截图一点点校的）

| 项 | 原版依据 | 我们的做法 |
|---|---|---|
| 穿什么 | `Recv_CharList` 里 `ChangeCharacterExt(slot, &CharSet[1])` | `decodeCharSet(charSet).equip` 喂给 `createPlayer`（真装备，不是职业默认皮） |
| 透明裁切 | `glAlphaFunc(GL_GREATER, 0.25)` | `getBmdMaterial` 的 `alphaTest` 由 0.45 改成 **0.25**（发丝/布边不再被多切） |
| 贴图过滤 | GL 只设 `GL_LINEAR`（没有 mip） | 角色贴图**关掉 mipmap**（`sharpen()`），人物 200px 左右不再吃到 mip 层 |
| 布景亮度 | 原版截图 p50 = 43，我们原来 30 | `STAGE_LIGHT = 1.05` + 顶点色朝白 lerp `STAGE_LIGHT_SOFT = 0.45` |
| 角色亮度 | 原版截图 p95 = 113，我们原来 128 | `charLight = 0.92`（另：`paintHighlight` 取消高亮时要还原到带亮度的材质，否则会被打回原样） |

实测分位数（角色带 x 0.25–0.62、y 0.42–0.78）：

| | 亮度 | p50 | p90 | p95 | p99 |
|---|---|---|---|---|---|
| 原版 | 50.5 | 43 | 98 | 113 | 180 |
| 本版 | 46.1 | 34 | 98 | 123 | 175 |

还想微调的话（都在控制台，立刻生效）：

```js
__MU_APP__.char3dLight(1.15)      // 布景亮度（1 = 当前 1.05 的基准之外再乘）
__MU_APP__.char3dCharLight(1.0)   // 角色亮度
__MU_APP__.char3dSharp(false)     // 角色贴图恢复 mipmap
__MU_APP__.char3dFlat(true)       // 布景完全不吃顶点光照（最平）
__MU_APP__.char3dGamma(true)      // 老 GL 那套不做 sRGB 输出（对照用，会整体变暗）
```

## 1. 3D 背景 + 场上的角色（`Logo05.bmd`）

`Game_EnterWorldTick.cpp` 进选角时一次性初始化：`Scene_LoadCharSelectResources()` 载资源，
`CreateObject(0xa4, {0,0,0}, {0,0,0}, 1.0f)` 把布景摆在**原点、不转**。
实现在 `src/login/charScene.ts`（独立 renderer 画在 `#char-3d`）。

模型 11 块 mesh：

| mesh 贴图 | 内容 |
|---|---|
| `main_earth.jpg` | 地面圆盘（中间亮、四周压黑） |
| `back1/back2.jpg` | 幕布（两块大的浅色布） |
| `main_wood1..5` / `main_stone` | 木柱、石件 |
| `main_wood6.jpg` | **把那圈树墙**（半径约 5 单位、高 9 单位，法线朝内）→ 必须 `BackSide` 画，见第 0 节 |
| `main_wood6.tga` | 树墙上的一条横梁（正常双面） |

### 场上的角色

`setChars(list)`：每只 `createPlayer(scene, '/Data/Player/', { cls })` +
`actor.attachMeshes(scene)`（蒙皮网格不在 root 下，少了这句只剩骨骼），然后按槽位摆：

```ts
// 原版 Recv_CharList：x = slot*100, y = slot*50-50, rotate = (slot-1)*15°
worldX = slot * CHAR_STEP_X;          // 1 格一个
worldY = slot * CHAR_STEP_Y - CHAR_STEP_Y;  // 半格一个，斜着排
yaw    = degToRad((slot - 1) * CHAR_YAW_STEP);
```

- `Actor.x/y` 是**格号**，渲染时会 +0.5 落到格心，所以赋值时要 `worldX - 0.5`。
- 站位是**斜线**（每个槽 +1 格 X、+0.5 格 Y），最远的那只也最小 —— 这是原版就有的透视，
  不是 bug。
- 朝向：`rotate = 0` 时模型正对镜头（模型本地朝 −Y，相机在 −Y 侧），
  其余按 15° 递增，所以 5 只分别是 −15/0/15/30/45°。

## 2. 四周的框：`Interface01..04`

`FUN_005239a0`（`UI_DrawLoginBg`）把 4 张图**左右各画一份**，但两份不是同一方向：

```cpp
GL_DrawTexture(0xc, 320.0, 0.0, 256.0, 86.0, 0.0, 0.0,  1.0, 0.671875, …);  // 右：u 0→1
GL_DrawTexture(0xc,  64.0, 0.0, 256.0, 86.0, 1.0, 0.0, -1.0, 0.671875, …);  // 左：u 1→0
```

**右边那份是原图（u 从 0 到 1），左边才是镜像（u 从 1 到 0，或负的 u 缩放）。**
所以画图顺序是「先把右边排好，再把同一张图镜像到左边」—— 反过来整圈花纹会朝外。

| 槽 | 文件 | 尺寸 | 右（原图） | 左（镜像） |
|---|---|---|---|---|
| `0xC` | `Interface01.ozt` | 256×86 | `(320,0)` | `(64,0)` |
| `0xD` | `Interface02.ozt` | 64×256 | `(576,0)` | `(0,0)` |
| `0xE` | `Interface03.ozt` | 64×224 | `(576,256)` | `(0,256)` |
| `0xF` | `Interface04.ozt` | 256×32 | `(320,448)` | `(64,448)` |

HTML 里 `.cf.flip`（`transform: scaleX(-1)`）**只加在左半那四个元素上**。

## 3. 三块銘牌

| 槽 | 文件 | 尺寸 | 位置 | 悬停高亮 |
|---|---|---|---|---|
| `0x10` | `New_character201.ozt` | 199×109 | `(221, 6)` | `0x11` `(286,81)` 70×25 |
| `0x12` | `Delete01.ozt` | 205×88 | `(0, 116)` | `0x13` `(128,148)` 70×19 |
| `0x14` | `Ok01.ozt` | 205×88 | `(434, 116)` | `0x15` `(441,148)` 70×19 |

注意 `0x14/0x15` 是 **Ok01/Ok02**（不是第二个 Delete）—— 左边是「删除」、
右边是「进入」。三块銘牌上的文字（NEW CHARACTER / DELETE / OK）**本来就画在贴图上**，
所以按钮是透明的，悬停时只把对应的高亮版本叠在 `::after` 上，不重复画字。

- **进界面不预选**：原版要你点一下角色。`selectedCharName` 初始为 `null`，
  没选人时左右两块完全在屏幕外（`translateX(∓205px)` + `opacity: 0`）。
- **选中后左右各从自己那一侧伸进来**：DELETE（左边那块，x=0）从左边滑到 0，
  OK（右边那块，x=434）从右边滑到 0，0.28s ease。CSS 用
  `#charselect:not(.has-sel) .plq-del { transform: translateX(-205px) }` / `.plq-ok { … 205px }`。
- 新建 → 打开下面那块面板。**5 个槽满了以后这块銘牌整块不显示**
  （`#charselect.slots-full .plq-new { display: none }`，由 `renderCharList()` 按
  `MAX_CHARS - 角色数 === 0` 打类）。
- 5 只一起站：横向间距自动从 `CHAR_GAP`(1.0) 收到 `CHAR_GAP_5`(0.8)，
  实测 5 只剪影宽 55/57/55/59/55（一致 = 没人被挡），中心落在 320。
- 进入 → `selectCharacter(选中的名字)`。
- 删除 → 还没接（原版要 `0xF3/02` + 7 位安全码），点了给提示。
- 建角时三块銘牌和名字标签都收起来，只剩面板。

## 4. 角色名字标签

原版是 `Camera_ProjectWorldToScreen(角色坐标)` 之后画两行字：

```
名字（粗体白）      ← 位置 = 投影点 - 字高 - 3
职业 + 等级（白）   ← 位置 = 投影点
```

我们照做：`charScene.syncLabels()` 每帧把头顶点 `(x, y, z + 2.05)` 投影回 640×480，
把 `.char-card` 的 `left/top` 写过去（CSS 用 `translate(-50%, -100%)` 以底边中点为锚），
所以标签是**跟着角色走**的，和实机一致。点标签 = 选中；双击或点右边 OK = 进图。

3D 起不来时 `#char-list.no3d` 会退回中间一列静态布局，至少还能点。

### 选中的反馈：人物打亮 + 标签放大

`charScene.setSelected(name)` 把那几只网格的材质换成**提亮过的副本**：

```ts
const hi = base.clone();                 // 必须 clone —— 材质按贴图全局缓存
hi.color.setRGB(2.5, 2.3, 1.85);         // >1 = 乘上去比原色更亮
hi.toneMapped = false;
```

武器/盾挂在骨骼下，单独 `props.traverse` 一遍。实测 1 号角色区域的 p90 亮度
111 → 153（+38%）、接近纯白的像素只占 0.78%，不会糊成一片白；旁边的角色保持原样。
标签这边同时放大约 1.14 倍并加金色光晕。

## 5. 新建角色面板

`#create-panel` 放在 `(214, 52)`，213×375：

| 元素 | 位置（面板内） | 说明 |
|---|---|---|
| `New_character01.ozt` 213×256 | `(0,0)` | 上半 |
| `New_character02.ozt` 213×119 | `(0,256)` | 下半（CANCEL / OK 画在图上） |
| 职业头像 | `(71,90)` 74×79 | 见下 |
| 名字输入 | `(71,180)` 宽 73 | `4~10` 位字母数字由 `validCharName()` 校验 |
| 职业名 | `(71,200)` | `Text.bmd` 第 `20+职业号` 行 |
| 换职业箭头 | `(149,196)` / `(170,196)` 20×19 | 下排 `(149,215)/(170,215)` 原版用途未确认，先不接 |
| OK / CANCEL | `(121,349)` / `(21,349)` 72×21 | 透明热区（文字在贴图上） |

### 职业头像 = `Face01..04.bmd`

面板上那块 74×79 的框画的是**半身像**，不是玩家模型：

| 文件 | 模型名 | 职业 |
|---|---|---|
| `Face01.bmd` | 마법사（magic_01..03） | 0 魔法师 |
| `Face02.bmd` | warrior | 1 剑士 |
| `Face03.bmd` | fairy | 2 弓箭手 |
| `Face04.bmd` | 마검사_얼굴（magic_09） | 3 魔剑士 |

`src/ui/charPreview.ts` 用主渲染器的 RenderTarget 离线渲一次、缓存 dataURL
（和 `itemIcon.ts` 一套）。两个坑：

1. 半身像**脸朝 -X**，相机在 -Y 侧，绕 Z 转 `+90°` 才是正面。
2. 视线要抬到「脸」的高度（`center.z + size.z*0.2`），正对包围盒中心会拍到胸口、头发顶出框。

## 6. 建角协议

`session.createCharacter(name, klass)` → `C1 F3 01` + `name[10]` + `class`。

- 服务端：`GameServer/Protocol.cpp::CGCharacterCreateRecv`，
  `DB_CLASS_DW/DK/FE/MG` = 0/1/2/3，非法职业/满槽都回 `result = 0`。
- 回包 `PMSG_CHARACTER_CREATE_SEND`：`result` 0 = 失败，非 0 = 成功；
  成功后重新拉 `0xF3/00` 刷列表。

## 7. 文件

| 文件 | 职责 |
|---|---|
| `src/login/charScene.ts` | Logo05 3D 背景（固定相机 + 布景旋转 + 场上角色 + 标签投影 + 选中打亮） |
| `src/core/bmdProp.ts` | 把一只 BMD 烘成静态 `Group`（登录/选角摆件共用） |
| `src/ui/charPreview.ts` | `Face01..04` 职业头像离屏渲染 |
| `src/ui/loginSkin.ts` | `initCharSkin()` 注入框 / 三块銘牌 / 新建面板 |
| `index.html` / `src/style.css` | 选角结构与 640×480 逻辑坐标 |
| `src/main.ts` | 选中态、按钮绑定、建角流程 |
| `src/net/session.ts` | `createCharacter()` |
| `tools/charselect-shot.mjs` | 登录→停选角→（点第一个角色）→开面板，出三张成品图 |
| `tools/ref_charselect_shot.py` | 起 Win32 客户端自动登录截图（做参照，服务器选择那一步还不稳） |

## 8. 调试入口（控制台）

| 调用 | 作用 |
|---|---|
| `__MU_APP__.char3dCam({ x, y, z, pitch, yaw, roll, fov })` | 临时改相机（位置是 **MU 单位**，会自动按 roll 逆旋转） |
| `__MU_APP__.char3dScene({ rot, offsetY })` | 临时转 / 挪布景（原版是 0，正常不要动） |
| `__MU_APP__.char3dProbe()` | 射线检查每只角色被什么挡着（含 world 坐标、朝向、屏幕投影） |
| `__MU_APP__.char3dBoxes()` | 布景每块 mesh 的世界包围盒 |
| `__MU_APP__.char3dSet([{ name, cls, level, slot }])` | 换场上角色（传 `[]` 清空；不传 slot 就按顺序 0..n） |
| `__MU_APP__.char3d()` | 相机位置 / 视线点 / FOV |

## 9. 还差的

1. **角色的装备**：现在按职业给默认装（`{ cls }`），原版是按 `CharSet[11]` 穿身上那套。
2. **选中特效**：原版选中角色脚下有橙色光环 + 轨道粒子（`Effect_DrawRing(0x4f1, ...)`）。
3. **删除角色**：`0xF3/02` + 7 位安全码的输入流程。
4. 面板箭头**下排**那对的用途还没确认。
