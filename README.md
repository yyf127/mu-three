# MU Online · Three.js H5 客户端（演示版）

用 **three.js** 复刻的奇迹（MU Online 0.97k）H5 客户端 Demo。
**直接加载原版客户端资源**（`BMD` / `OZJ` / `OZT` / `BMP` / 加密地图），
不需要像 `muonlinejs-master` 那样先用 `tools/` 把资源转成 glTF + WebP。

```
原版 Data/  ──►  浏览器内解析  ──►  three.js 场景
   .bmd  骨骼 + 网格 + 141 组动作        SkinnedMesh + 骨骼层级
   .ozj  24 字节头 + JPEG                ImageBitmap
   .ozt  4 字节头 + TGA                  自研 TGA 解码（含 RLE/32bit）
   .map/.att/.obj  MU 私有加密            rolling XOR 解密
   .OZB  高度图（1084 偏移）              地形高度
```

## 在线演示 / 部署

- 演示站：<https://yyf127.github.io/mu-three/demo>
- 源码仓库：<https://github.com/yyf127/mu-three>（**源码 + 资源**，不是构建产物）

```
源码 push → GitHub Actions（npm ci && npm run build）→ 发布 dist/ → Pages
```

仓库结构（部署相关）：

| 路径 | 说明 |
|---|---|
| `src/`、`index.html`、`vite.config.ts`、`package*.json` | 应用源码 |
| `server/` | WS ↔ TCP 网关（`npm run net:bridge`，实机版用） |
| `tools/` | 探针 / 工具脚本（`demo-probe`、`serve-gh` 等） |
| `dist/Data/` | 原版客户端资源（208MB，**进仓库**；`vite.config.ts` 的 `localAssets()` 直接托管它） |
| `dist/assets/`、`dist/index.html`、`dist/404.html` | ❌ 不进仓库，CI 构建生成 |
| `.github/workflows/deploy.yml` | Pages 构建 + 发布 |

资源统一放在 `dist/Data`（`publicDir: false`），构建 base 默认 `/mu-three/`，
所有资源 URL 走 `src/core/base.ts::assetUrl()`（子路径部署的关键）。
本地可用 `npm run serve:gh` 仿真 GitHub Pages 子路径。完整步骤见 **`docs/DEPLOY.md`**。

## 运行

**一键启动（推荐）**：双击根目录 `启动游戏.bat`，一个窗口拉起来就完事：

```
MuServer   ConnectServer 44405 → JoinServer → DataServer → GameServer 55901
              ↓ 裸 TCP（浏览器开不了 socket，必须由下面这层转成 WebSocket）
dev server Vite 5180 + 内嵌网关 /mu   → 自动打开 http://127.0.0.1:5180，登录 1234 / 1234
```

**网关不用单独启动**——它就是 `vite.config.ts` 里的 `muBridge()` 插件，跑在 5180 上：

| 路径 | 作用 |
| --- | --- |
| `ws://127.0.0.1:5180/mu?host=…&port=…` | WS ↔ TCP 转发到 44405 / 55901 |
| `http://127.0.0.1:5180/mu-config` | 代读 `GameServerInfo - StartUp.dat`，前端据此推流加密密钥 |

好处是浏览器侧全部同源，没有跨域，也不存在「忘记起网关所以登录失败」。路径固定 `/mu`，
和 Vite 自己的 HMR socket（根路径）互不干扰。转发逻辑与 `server/bridge-core.mjs` 是同一份。

各层启动前都会探测端口与进程，**已在运行的直接复用**；脚本还会探一下 `/mu-config`，
内嵌网关不可用时才回退去起独立的 5181。

| 脚本 | 作用 |
| --- | --- |
| `启动游戏.bat` | MuServer + dev server（含网关），全启 |
| `启动演示.bat` | 等价于 `启动游戏.bat noserver`：只起 dev server，不碰 MuServer |
| `停止游戏.bat` | 按端口（5180 / 5181）和映像名停掉全部层，不会误杀其它 node 进程 |

**分开手动起**：

```bash
cd mu-three
npm install
npm run dev          # 5180：客户端 + 内嵌网关，一个命令够了
# MuServer 另外双击 MuServer/1-STARTUP.bat
```

> `npm run net:bridge`（独立 5181）现在只有两种情况需要：
> `vite build` 之后的构建产物（没有 dev server 了），或者专门盯网关的逐条连接日志。
> 前端会自动先试同源 `/mu`，不通再退到 5181，两种部署都不用改代码。

> 资源目录通过 `vite.config.ts` 的 `publicDir` 直接指向
> `../muonlinejs-master/public`，因此 `/Data/...` 走的就是原版资源，**没有任何拷贝或转换**。
> 想换成自己的客户端资源，只要保证 `public/Data/{World1,Player,Object1,Monster}` 结构一致即可。

## 操作

| 输入 | 功能 |
| --- | --- |
| 鼠标左键点地面 | 走到目标点（地形高度自适应）；**按住不放**会跟着光标连续走 |
| 鼠标左键点怪 | **普通攻击**（Win 端行为） |
| 鼠标右键点画面 | **放当前技能**（对着鼠标下的怪 / 锁定的目标 / 最近的怪） |
| 鼠标右键拖拽 | 旋转视角（水平 + 俯仰）。按下后移动超过 6px 才算拖拽，点一下算技能 |
| W / A / S / D | 相对镜头方向移动 |
| 鼠标样式 | 原版 `Data/Interface/Cursor*.ozt`：默认箭头 / 怪=crosshair / NPC=对话 / 地面物品=拾取 / 按住左键=推走 or 禁止移动 |
| 滚轮 | 缩放镜头（6 ~ 24 格） |
| 空格 | 播放攻击动作 |
| **鼠标左键点 NPC** | 走过去对话（商店 / 仓库 / 传送 / 合成机） |
| **I 或 V** | 物品栏（商店/仓库开着时单击物品 = 卖出/存入） |
| **背包右键** | 丢在地上（0x23，+5 以上和卓越品服务端拒绝） |
| **背包双击** | 使用物品（0x26，喝药 / 穿装备） |
| **Q / W / E** | 喝 治疗 / 魔法 / 辅助 药（大瓶优先） |
| **点技能栏主图标** | 展开/收起那一排技能（原版 `Hero+913` 那个 32×36 图标） |
| **点技能格** | 设为当前技能；之后**右键**放它（左键永远是普攻） |
| **Ctrl + 数字**（悬停技能格时） | 把该数字设为这格的快捷键 |
| **数字键 1..0** | 按快捷键选技能（原版 `SelectSkillByHotkey`） |
| **M** | 移动命令窗口 |
| **C** | 角色属性面板 |
| **回车** | 打开聊天；`/post` `/move` `/str` 等 31 条命令直接可用 |
| **Tab** | 小地图开关（3 档缩放：点边框右上角放大镜切换） |
| **Esc** | 关面板（NPC 界面会发 0x31 清服务端的 `Interface.use`） |
| **右上角「声音」** | 静音开关（原版是选项菜单里的 `MusicOnOff`，状态存 localStorage） |

## 已实现

- **BMD 解析**：版本 10 / 12（加密）/ 15，网格、法线、UV、三角面、骨骼、动作全部读取
- **刚体蒙皮**：每个顶点绑定单根骨骼（`skinWeight=1`，`inverseBindMatrix=identity`），
  与原客户端 `world * bonesArray[boneIndex]` 的算法等价
- **动作索引（0.97 实测）**：`STOP_MALE=1`、`WALK_MALE=13`、`RUN=22`、`ATTACK_FIST=34`
  （依据：walk 系列 13~20 全部 `LockPositions=1` 且根骨位移 242.88；`SetAttackSpeed` 把
  FIST 写在 `P+548 = 16*34+4`）
- **朝向**：模型本地正面为 **-Y**（脚踝→脚趾、走路摆动腿两个独立测量一致），
  故 `yaw = atan2(dy,dx) + π/2`
- **动作播放**：141 组玩家动作、逐帧插值。节奏按客户端
  `BMD__PlayAnimation`（每帧 `frame += speed`，speed 表在 `OpenPlayers`/`SetAttackSpeed` 里，
  不在 BMD 中）：idle 0.28、walk/run 0.30、拳 0.6+攻速×0.004，换算基准 25fps
- **根骨锁定**：走/跑/骑乘动作 `LockPositions=1`，根骨 `Bip01` 每循环带动 242.9 单位位移，
  必须锁住根骨 XY（保留 Z 起伏），否则每圈前冲 2.4 格再瞬移回来
- **循环长度**：末帧与首帧相同的动作按 `frameCount-1` 循环，避免每圈多停一帧
- **角色换装**：`player.bmd` 提供骨架，`Armor/Pant/Glove/Boot/Helm*.bmd` 按**骨骼名**映射到同一骨架
- **洛兰地形**：高度图 + 双层 tile 贴图混合 + 光照图，`sampler2DArray` 9 层贴图数组，单 DrawCall
- **场景物件**：`EncTerrain1.obj` 2870 条记录，隐藏 78 个标记物（Light01~03 / PoseBox01，
  客户端 `HiddenMesh=-2` 整只不画），其余 2792 个按贴图合并成 100 个 DrawCall
- **相机**：参数取自客户端 `MoveMainCamera`（FOV 35°、距离 1000 单位、高度 +850 单位）
- **走位**：A* 绕墙 / 绕 NPC / 绕其他玩家（含斜向不擦人、路径被占自动重算），
  方向表对齐服务端 `RoadPathTable`，一次最多 8 步上报（见阶段 F）
- **掉落与拾取**：`0x20` 地面物品视野 / `0x21` 物品离场 / `0x22` 拾取，
  `type → ItemAngle → BMD` 全按客户端源码映射，点物品自动走过去捡（见阶段 G）
- **角色数值面板**：HUD 右下「角色 C」，等级/经验条/力敏体智/HP/MP/AG/金币/可分配点/PK
- **进屋收屋顶**：洛兰**酒馆**（`HouseWall05/06` 的 8 块屋顶板拼成 1 间）——
  进屋整片收顶、出门恢复，进店还会切 `Pub.mp3`。其它房子是实心装饰（`.att` 全
  `TW_NOMOVE`，人走不进去），不做（见阶段 BD）
- **严格整数坐标**：逻辑位置是整数格号（`lpObj->X/Y`），渲染补 `+0.5` 落到格心 ——
  点地面就走**到那个格子的中心**，不再差半格；寻路仍是原来的格子 A*
- **平滑单步**：点身边一格也是正常插值走过去（到点判定按距离 + 单帧步长钳制），
  不会出现「最后一步硬跳半格」的滑步（见阶段 BF）
- **小地图**：`Interface/MiniMap.OZT` 边框 + `terrain.buildMinimap()` 现场合成的地形图
  （tile 平均色 + 山体阴影 + 水面），队友/NPC/目标标记，3 档缩放，Tab 开关（见阶段 BA）
- **头顶标签**：队友名字 + `cur/max` + 10 格血条（`0x44` 的十等分，几何/颜色 1:1 对
  `Render_HPBars`）、其他玩家名字、当前目标怪物名字（冷色）；NPC 不画（见阶段 AZ）
- **联机可见性**：远程玩家按 `CharSet` 穿装、`0x25` 单件换装实时更新、`0x45` 变身、
  `0x1F` 召唤兽、`0x5A/0x5B` 战盟名（见阶段 AY）
- **天气 / 地形属性**：`0x0F` 雨（强度走 uniform）、`0x46` 直接改地形属性位
  （血堡大门/桥开关即时生效）
- **经验与升级**：`0x9C` 里本地累加经验（原版就是 `CA+16 += Exp`）+ `0xF3/0x05` 升级
  （等级/点数/上限/回满血蓝 + 15 道 joint 与光环特效；注意 48 字节长包的对齐洞）
- **声音**：91 条 `PlayBuffer` 音效表（抄 `Sound_LoadGameSamples`）+ 地图 BGM/环境循环音，
  脚步/挥砍/命中/死亡/拾取/施法全部接上，3D 定位按相机方位（见阶段 AW）
- **buff（持续技能效果）**：`0x07` 状态包 + `0x1B` 取消 + 视野 `ViewSkillState` 三条通道，
  按状态位在角色身上挂/摘光环、护盾球、冰壳（见阶段 AV）
- **技能栏**：`0xF3/0x11` 技能表（整表 / 学到 / 遗忘三种语义）→ 底栏主技能图标
  `(304,444)` + 点开的一排居中图标（`y=370`，`Interface/Skill.ozj` 图集切片），
  数字键选技能、Ctrl+数字设键位（见阶段 AU）
- **HUD**：角色信息、金币、HP/MP 球、FPS、坐标

## 目录

```
mu-three/
├─ src/
│  ├─ core/
│  │  ├─ bmd.ts       BMD 解析（含 v12 解密）
│  │  ├─ crypto.ts    MU 地图/模型 rolling XOR 解密
│  │  ├─ texture.ts   OZJ / OZT / BMP 解码 + 缓存
│  │  ├─ model.ts     BMD → BufferGeometry / SkinnedMesh / 骨骼动画
│  │  └─ bytes.ts     小端读取器
│  ├─ world/
│  │  ├─ terrain.ts   地形（高度/属性/双贴图/光照图着色器）
│  │  ├─ objects.ts   物件表 + 合并渲染
│  │  ├─ actor.ts     角色 & 怪物
│  │  └─ camera.ts    MU 风格相机 + 地形拾取
│  ├─ ui/             HUD 样式
│  ├─ debug.ts        自动化验证接口（__MU_DEBUG__）
│  └─ main.ts         启动流程
├─ tools/             无头浏览器验证脚本（probe / diff / behavior / shots）
└─ shots/             演示截图
```

## 关键格式备忘

| 结构 | 大小 | 说明 |
| --- | --- | --- |
| BMD 头 | 4 + 32 + 6 | `"BMD"`+version、名称、mesh/bone/action 数量 |
| BMD 顶点 | 16 | node(i16) + pad + xyz(f32) |
| BMD 法线 | 20 | node + pad + xyz + bindVertex |
| BMD 三角面 | **64（固定）** | polygon + 4×顶点/法线/UV 索引 + 4×lightmap uv + front |
| BMD 骨骼 | 1 + 34 + keys×24 | dummy 标记 → 名称 32 + parent + 每帧位置/欧拉角 |
| OZJ | 24 字节头 | 其后是 JPEG |
| OZT | 4 字节头 | 其后是 TGA（22 字节头 + 像素） |
| EncTerrain.map | 2 + 3×65536 | 版本、地图号、layer1、layer2、alpha |
| EncTerrain.att | 4 + 2×65536 | 解密后还要过一次 Bux XOR |
| EncTerrain.obj | 4 + 30×N | 物件：id、xyz、xyz（**度**）、scale |
| TerrainHeight | 1084 起 65536 字节 | `h * 0.015` = 高度（格） |

## 下一步

服务端 `Protocol.cpp` 的分发表已经把后续要接的协议都摆在那了，按「体验闭环」
排序，而不是按「代码好写」排序：

1. ~~**掉落物与拾取**（0x20 / 0x21 / 0x22）~~ —— 已完成，见阶段 G
2. **背包 UI**：拾取结果里的槽位号（`result = 0x03..0x??`）目前只用于判断成功/失败，
   物品已经进服务端背包但没有界面能看。要做 `0x24` 拖放 + 装备栏
3. **外观**：按 `CharSet`（装备）动态换装，远程玩家/怪物都跟进；翅膀、坐骑
4. **NPC 对话与商店**（0x30 打开 / 0x31 关闭 / 0x32 购买 / 0x33 卖出 / 0x34 修理）
5. **战斗补全**：技能（0x19 单体 / 0x1D 多目标 / 0x1E 持续）、音效
6. **角色数值面板补装备加成**：现在只显示服务端下发的白字，攻击/防御/攻速要等背包数据
7. **其它 UI**：聊天、经验条
8. **优化**：物件分块合批、贴图数组压缩、实例化，低端机降帧

## 说明

本项目仅用于技术研究与本地演示，所有美术资源版权归 Webzen 及原权利人所有。

---

## 网络层（阶段 A：协议地基）

浏览器不能开裸 TCP，链路是：

```
three.js 客户端 ──ws://127.0.0.1:5180/mu──► vite 插件 muBridge ──TCP──► ConnectServer(44405) / GameServer(55901)
                                            （同一份转发逻辑也在 server/bridge.mjs，可独立跑在 5181）
```

| 模块 | 说明 |
| --- | --- |
| `src/net/crypto.ts` | SimpleModulus 加解密 + Xor32 + Xor3，密钥从 `Data/Enc1.dat`、`Data/Dec2.dat` 读取 |
| `src/net/muemu.ts` | 流加密层（`ENCRYPT_STATE=1` 时所有字节都要过一遍），密钥由服务端配置推导 |
| `src/net/packet.ts` | C1/C2/C3/C4 封包、`PacketStreamDecoder`（处理粘包/拆包） |
| `src/net/connection.ts` | 浏览器侧连接：三层加解密 + 事件分发 |
| `src/net/session.ts` | 登录会话：握手 → 语言 → HWID → 登录 → 角色列表 → 选角 → 进图 |
| `server/bridge-core.mjs` | WS ↔ TCP 转发核心：`attach(httpServer, { wsPath })` + `/mu-config` 代读 StartUp.dat |
| `vite.config.ts` 的 `muBridge()` | 把上面那份核心挂到 dev server 的 `/mu`（默认路径，同源免端口） |
| `server/bridge.mjs` | 独立网关进程（5181），构建产物或单独排查连接时用 |
| `tools/login-probe.mjs` | Node 假客户端，逐包十六进制打印完整登录链 |
| `tools/net-login-probe.mjs` | 无头浏览器跑 `net-test.html`，验证浏览器端同一套代码 |

### 三层加密（顺序不能错）

很多 MU 教程只讲 SimpleModulus，但 0.97 的这个服务端实际有三层，缺一层就会被静默丢弃：

```
发： 明文 ──Xor32(下标3起)──► [C3/C4 再走 SimpleModulus] ──流加密──► 线路
收： 线路 ──流解密──► 切包 ──[C3/C4 先 SimpleModulus]──► 明文
```

1. **Xor32**：`GameServer/PacketManager.cpp::ExtractPacket` 对**所有**客户端报文调 `XorData(size-1, 2)`，
   即 `buf[n] ^= buf[n-1] ^ filter[n%32]`（n 从末尾往前）。客户端必须先按低→高编码。
   过滤表就取服务端 `m_XorFilter`，与客户端 `Net_LegacyRuntime.cpp` 的 xorKey 一致：
   `E7 6D 3A 89 BC B2 9F 73 23 A8 FE B6 49 5D 39 5D 8A CB 63 8D EA 7D 2B 5F C3 B1 E9 83 29 51 E8 56`
2. **SimpleModulus**：C3/C4 专用。每 8 字节明文 → 11 字节密文，4 个 16bit 值各自
   `(v ^ XorKey[i] ^ prev) * Key[i] % Modulus[i]`，再按位打包。
   **注意**：每个值占 18 位（低 16 位 + **bit16..17** 两位），不是 bit22..23 —— C 里
   `AddBits(..., 22, 2)` 会先左移 6 位，取到的其实是低字节高 2 位。这一位之差会让服务端解密出的
   高 2 位全错，然后整个包被当成垃圾静默丢掉。
3. **流加密**：`GameServer/stdafx.h` 里 `#define ENCRYPT_STATE 1`，所有进出字节再走
   `out = (in + add) ^ xor`。xor/add 由配置推导：

```
key = 0
for n in 0..31:                       // CustomerName 缓冲固定 32 字节
  key += (BYTE)(CustomerName[n] ^ ServerSerial[n % 17])   // 注意取模 17，不是 16
  key ^= (BYTE)(CustomerName[n] - ServerSerial[n % 17])
xor = 0xB0 + LOBYTE(key);  k2 = 0xF8 + HIBYTE(key);  add = k2 * xor
```

本机配置（`CustomerName=Nico` + `ServerSerial=TbYehR2hFUPBKgZj`）算出 `xor=0xF8, add=0xF8`。
`/mu-config` 会读服务端 `.dat` 后返回这两个字段的来源，前端自动推导；换服务端配置不用改代码。

### SimpleModulus 密钥不是硬编码的

`Enc1.dat` / `Dec2.dat` 是 54 字节：`[6 字节头][12 个 LE DWORD]`，每个 DWORD 还要与固定表
`0x3F08A79B, 0xE25CC287, 0x93D27AB9, 0x20DEA7BF`（客户端 `globals.cpp`: `DAT_00562e48`）做 XOR 反混淆：

| | 值 |
| --- | --- |
| Modulus | 72619 / 72691 / 73136 / 78576 |
| Enc1 Key | 14067 / 5411 / 31865 / 16225 |
| Dec2 Key | 22606 / 40463 / 33209 / 33169 |
| Xor | 560 / 8315 / 21196 / 27946 |

Enc1 与 Dec2 互为模逆（`e*d % m == 1`），所以不做服务端也能往返自测；服务端的
`Data/Hack/Dec1.dat` 与客户端 `Dec2.dat`、`Enc2.dat` 与 `Enc1.dat` 是同一份文件（md5 相同）。

---

## 登录链（阶段 B，已用真实服务端验证）

`MuServer` 服务端已在 16:2x 启动，两个账号（`1234/1234`、`1111/1111`）实测跑通：

| 步骤 | 报文 | 说明 |
| --- | --- | --- |
| 1 | 服务端 → `C1 0C F1 00 01 <idx:2> <版本:5>` | 握手，版本字节是 `09711` |
| 2 | 客户端 → `C3 F1 04 <lang:int32>` | 设置语言，0=English |
| 3 | 客户端 → `C3 F1 05 <HWID:36>` | **必须发**：`CBlackList::CheckHardwareID` 对空串直接返回 1 → 登录被判 result=5 |
| 4 | 客户端 → `C3 F1 01` | 账号[10]+密码[10]（XOR `FC CF AB`）+ tick(4) + 版本(5) + 序列(16) |
| 5 | 服务端 → `C1 05 F1 01 <result>` | 见下表 |
| 6 | 客户端 → `C1 04 F3 00` | 请求角色列表（**size 必须 4**，写成 3 会让服务端把下一字节当报文头直接断开） |
| 7 | 服务端 → `C3 F3 00 <count> …` | 每条 **26 字节** |
| 8 | 客户端 → `C1 0E F3 03 <name:10>` | 选角 |
| 9 | 服务端 → `C3 F3 03 …` | 角色属性 + 后续一堆进图包 |

### 登录返回码（GameServer/JSProtocol.cpp）

| 值 | 含义 |
| --- | --- |
| **1** | **成功**（不是 0！JoinServer 用 1 表示成功） |
| 0 | 账号或密码错误 |
| 2 | 账号不存在 / 数据库查询失败 |
| 3 | 账号已连接（上次没正常退出，会一直挂着） |
| 4 | 服务器账号数已满 |
| 5 | 账号封禁，或 HWID/IP 命中黑名单 |
| 6 | 客户端版本或序列号不匹配 |
| 8 | 失败次数过多 |
| 11 | 服务器锁定 |

### 角色列表条目（26 字节）

```
slot(1) | Name[10] | 填充(1) | Level(2) | CtlCode(1) | CharSet[11]
```

服务端结构体没有 `#pragma pack`，`WORD Level` 会被对齐到 4 字节边界，所以 `Name` 后面多了 1 字节填充。
按 25 字节解析会整体错位：等级变成 1536、第二个角色名前面多一个字节。同理角色信息里
`DWORD Money` 在 `MaxBP` 之后有 **2 字节填充**，金钱实际在偏移 **36**。

### 角色信息（F3 03）字段偏移

| 偏移 | 字段 | 偏移 | 字段 |
| --- | --- | --- | --- |
| 0..3 | X / Y / Map / Dir | 22..33 | Life / MaxLife / Mana / MaxMana / BP / MaxBP |
| 4..7 | Experience | 34..35 | 填充 |
| 8..11 | NextExperience | **36..39** | **Money** |
| 12..13 | LevelUpPoint | 40 / 41 | PKLevel / CtlCode |
| 14..21 | 力量 / 敏捷 / 体力 / 智力 | 42..45 | FruitAddPoint / MaxFruitAddPoint |

### 两个必踩的坑

1. **0x03 MainCheck**：进图后服务端会下发 `C1 06 03 …` 挑战，必须用 **C3** 原样回显
   （`PMSG_MAIN_CHECK_SEND` 在 `HackPacketCheck.txt` 里 `Encrypt=1`）。不发或用 C1 回，
   服务端会回 `F1 02` 直接断开，日志里是 `Invalid Main CheckSum`。
2. **退出要发 F1/02**：直接断 socket，账号会卡在 JoinServer 的在线表里，下次登录返回
   「账号已连接」。`MuSession.closeClient()` 会发 `C3 05 F1 02 00`。

### 验证命令

```bash
npm run test:net            # 30 项：密钥解析 / SimpleModulus 往返 / Xor32 / Xor3
npm run dev                 # 5180：客户端 + 内嵌网关，一个就够
npm run net:login           # Node 假客户端跑完整登录链（直连 55901）
npm run net:login:browser   # 无头浏览器跑 net-test.html（同一套前端代码，走 /mu）
```

浏览器手工验证：<http://127.0.0.1:5180/net-test.html?account=1234&password=1234>
（会自动握手 → 登录 → 列角色 → 选第一个角色进图，并把 HP/MP/经验/金钱打出来）

---

## 登录界面 & 多地图（阶段 C）

主入口 `index.html` 现在是完整的三段式流程：

```
登录面板（账号/密码，或「离线演示」）
   → 角色列表（服务端返回的 3 个角色，点一个进图）
   → 载入该角色所在地图 → HUD（名称/地图/FPS/坐标/HP/MP 球）
```

按 **Esc** 回选角（会先发 `F1/02` 正常退出，避免账号卡在「已连接」）。

离线演示时左边有个「角色 / 装备 / 技能」沙盘：**按住卡片标题就能把它拖到任何位置**
（位置记在 `localStorage`，下次打开还在原处）；右上角是 **Tab** 开关的小地图。

### 离线演示服能打到什么（阶段 CN/CO/CP）

演示没有服务端，但怪物/掉落全部来自**服务端配置**（`server/data/game.json`，
由 `npm run config:build` 从 `MuServer/Data` 生成）：

| 环节 | 依据 |
|---|---|
| 出怪 | `MonsterSetBase.txt` 的刷怪点，按范围成群刷，视野内最多 80 只 |
| 等级 / 血量 / 攻防 / 金钱 | `Monster.txt` |
| 经验 / 掉率 / 掉落池 | 经验 ≈ `Lv²×1.6 + Lv×8`；掉落池 = `Item.txt` 里「物品等级 ∈ [怪等级-2, +4]」且可掉的物品 |
| 掉落物 | 击杀后掉在脚下，**按 Alt 或悬停看名字**，走过去点它就进背包 |

怪物头顶有名字 + 血条（挨打时实时变化）。**点怪就上去打**（自动连续攻击），
**点 NPC 对话**：商人开商店（货架来自 `Shop/*.txt`）、Safety Guardian 开仓库
（存在 `localStorage`，刷新还在）。离线演示里单击即成交：点商品买下、点背包物品卖出/存入。

`__MU_APP__` 上有调试口：`demoMonsters()` / `demoNpcs()` / `demoShop()` /
`demoWarehouse()` / `progress()` / `demoDrops()` / `bag()` / `attack(id)`。

小地图边框左下角有一颗 **M**，点它等于按 M（移动命令面板，手机上没有键盘也能用）。

### 地图资源是「地图号 + 1」

| 地图号 | 地图 | 资源目录 |
| --- | --- | --- |
| 0 | 洛兰 Lorencia | `World1` / `Object1` |
| 1 | 地下城 Dungeon | `World2` / `Object2` |
| 2 | 冰风谷 Devias | `World3` / `Object3` |
| 3 | 诺利亚 Noria | `World4` / `Object4` |
| 4 | 失落之塔 Lost Tower | `World5` / `Object5` |
| 7 | 亚特兰蒂斯 Atlans | `World8` / `Object8` |
| 8 | 塔卡 Tarkan | `World9` / `Object9` |
| 9 | 恶魔广场 Devil Square | `World10` / `Object10` |
| 10 | 天空之城 Icarus | `World11` / `Object11` |
| 11..16 | 血色城堡 Blood Castle | `World12` / `Object12`（六个等级共用） |

**物件命名规则不同**（`Terrain_LegacyLoad.cpp`）：

- 洛兰是用 `OpenModel` 逐个手写名字（`Tree01`、`House02`……），所以 `objects.ts` 里有一张
  109 项的 ID → 文件名表；
- 其它地图统一是 `AccessModel(i, "Data/Object{N}/", "Object", i + 1)`，
  也就是 **物件 ID `i` → `Object{i+1}.bmd`**，不需要维护表。

实测各地图物件落地数：

| 地图 | 物件记录 | 实际放置 | 缺失 ID |
| --- | --- | --- | --- |
| 洛兰 | 2870 | 2792（隐藏 78） | 无 |
| 地下城 | 4488 | 4479 | 60 |
| 冰风谷 | 2144 | 2144 | 无 |
| 诺利亚 | 9399 | 9398 | 43 |
| 亚特兰蒂斯 | 5205 | 5205 | 无 |

### 地面贴图：一张 tile 只铺 4 格

这条之前理解错过好几次，现在有源码硬证据。`Terrain_RenderFace.cpp` 的 `FaceTexture`：

```c
if (Scale) { Width = 16.0f / bmp->Width; dHeight = 16.0f; }   // 水面/BC 用
else       { Width = 64.0f / bmp->Width; dHeight = 64.0f; }   // 普通地面
float Height = dHeight / bmp->Height;
float suf = Width * xf;    // xf = 格子坐标（整数，1 格步进）
float svf = Height * yf;
```

`xf` 就是索引图的格坐标，所以每格的 UV 前进量是 `64 / 贴图宽`：

| 贴图尺寸 | 每格 UV 前进 | 一张 tile 覆盖 | 每格 texel |
| --- | --- | --- | --- |
| 256×256 | 0.25 | **4 格** | 64 |
| 128×128 | 0.5 | **2 格** | 64 |

也就是 **地面纹理只占索引纹理的 1/4**，两种尺寸的像素密度恒为 64 texel/格。
muonlinejs 的写法等价：`scale = size === 256 ? size / 4 : size`，然后 `texture2D(tile, vUV * scale)`
（vUV 是 0..1 的全图 UV）。之前按「每格一张」渲染，纹理密度翻了 4 倍，地面又碎又花。

关键点：**不同地图的同一个槽位尺寸并不一样**（洛兰 `TileGrass02` 是 128，诺利亚是 256），
所以 `uTileDiv` 必须按解码后的真实尺寸逐张推导，不能用固定表：

```bash
node tools/terrain-div-probe.mjs 0 3 7    # 逐张打印 尺寸/div/每格 texel + div4·div1 对照图
```

实测（洛兰 / 诺利亚 / 亚特兰蒂斯）全部满足 256→4、128→2，每格 64 texel。

另外 14 个槽位（`Bitmaps` 0x23..0x30）在原版里是**所有地图共用同一组文件名**
（`Scene_OpenWorld.cpp` 逐个 `OpenJPG`），缺文件的地图就是打开失败，本项目退化为草地贴图。

### 地形光照按光照图真乘（恢复明暗）

`TerrainLight.OZJ` 的分布很宽：洛兰 p05 `0.10` / p50 `0.53` / p95 `1.00`，
诺利亚 p50 `0.66`、亚特兰蒂斯 p50 `0.33`。「哪块地亮、哪块地暗」本来就全在这张图里。

着色器按 `light = floor + gain × rl` 映射（`LIGHT_TUNE`：`0.16 / 0.92`），
再对通道差 > 0.4 的格子做拉平（否则会出现紫/品红色块；拉平取三通道均值，不影响明暗）。
贴图与光照图都按 sRGB 数值直用，不做解码。

> 曾经取 `0.75 + 0.30 × rl`（把 0..1 压到 0.75..1.05）想把地形抬到「接近 1.0」，
> 结果地面均值 0.92、明暗只剩 30% —— 画面上就是**又亮又平**。
> 实测地面 luma 从 78 降到 62，明暗幅度从 1.3 倍拉到 6.8 倍。

`.map` 里 `layer2 = 255` 表示「没有第二层」，必须判越界，否则越界采样会把地面压黑。

### 验证方式

```bash
npm run dev                 # 5180（客户端 + 内嵌网关）
npm run app:probe           # 无头浏览器：登录 1234 → 选角 → 进图 → 依次切 1/2/3/7 号地图截图

node tools/terrain-shot.mjs now     # 3D 画布截图 + 暗像素 / 亮度 / 边缘密度
node tools/terrain-div-probe.mjs 0 3 7   # 铺几格的硬校验（读 uniform 对账源码公式）
node tools/map-shot.mjs 3 130 130 noria  # 任意地图全景截图
```

`tools/app-probe.mjs` 会打印每张地图的 `mapId / objects / missing / player` 并输出截图到 `shots/`。

---

## 进图后的实体同步（阶段 D）

进图后服务端会把视野内的其它玩家和怪物推下来，现在这些都接进了 three.js：

| 报文 | 方向 | 内容 | 源码 |
| --- | --- | --- | --- |
| `0x12` | S→C | 其它玩家的视野（每条 **32 字节**） | `Viewport.cpp::GCViewportPlayerSend` |
| `0x13` | S→C | 怪物 / NPC 的视野（每条 **12 字节**） | `Viewport.cpp::GCViewportMonsterSend` |
| `0x14` | S→C | 离开视野（每项 2 字节 id） | `PMSG_VIEWPORT_DESTROY_SEND` |
| `0x11` | S→C | 别人的移动结果（id / x / y / dir） | `PMSG_MOVE_SEND` |
| `0x11` | C→S | 自己走了一步（x / y + path[8]） | `CGMoveRecv` |

两个结构体都没有 `#pragma pack`，所以**步长必须按 sizeof 写死**，不能按「报文长度 / count」算：

```
玩家 32 字节：id(2) x(1) y(1) CharSet[11] pad(1) ViewSkillState(2) name[10] tx(1) ty(1) dirpk(1) pad(1)
怪物 12 字节：id(2) type(1) pad(1) ViewSkillState(2) x(1) y(1) tx(1) ty(1) dirpk(1) pad(1)
```

> `id[0]` 的最高位是 `OBJECT_CREATE` 标志，取值时要用 `& 0x7F`。

### 怎么认出「自己」

`0x12` 里**包含自己那一条**。服务端不会再单独告诉自己 id，所以只能靠名字匹配：
选角后立刻记下角色名，`0x12` 里名字相同的那条就是自己，之后 `0x11` 里它的移动回显要忽略
（否则本地移动会被服务端回包拽回去）。

### 怪物 / NPC 的模型编号（已修正）

之前按 `Monster{Class+1}.bmd` 猜，**和客户端对不上**。客户端 `Monster.cpp::CreateMonster`
是一个大 switch，每个 Class 显式调用 `OpenMonsterModel(n)`（→ `Monster{n+1}.bmd`）
或 `OpenNpc(n)`（→ `Data/NPC/{名字}01.bmd`），索引和 Class 完全不是简单加一：

| Class | 客户端模型 | 名字 |
| --- | --- | --- |
| 1 | `Monster02.bmd` | Hound |
| 2 | `Monster03.bmd` | Budge Dragon |
| 3 | `Monster10.bmd` | Spider |
| 6 / 9 | `Monster05.bmd` | Lich / Thunder Lich |
| 7 | `Monster06.bmd` | Giant |
| 255 | `NPC/Female01.bmd` + 部件 | Lumen the Barmaid |
| 251 | `NPC/Smith01.bmd` | Hanzo the Blacksmith |

完整映射在 `src/world/monsterModels.ts`（85 个怪物 Class + 22 个 NPC Class），
名字取服务端 `MonsterSetBase.txt` 的注释列。

**人形 NPC 是「骨架 + 部件」拼的**：`Female01.bmd` / `Man01.bmd` / `Girl01.bmd`
本身 **0 个网格**，只有骨骼；身体在 `FemaleHead01`、`ManUpper01`、`ManBoots01`
这些部件里。客户端 `OpenNpc` 循环加载 1..3 号部件挂到同一套骨架 ——
我们复用 `createPlayer` 的 `createBoneRemap` 做同样的事。

几个 Class 客户端根本没模型（守卫 Class 249、Golden Archer 236 等只调
`CreateChar5(Key, 390)`），会跳过并打一条 info 日志。

### NPC 目录名是大写

`Data/NPC/`（不是 `Data/Npc/`）。Vite 的静态服务在 Windows 上按字符串**精确匹配**，
写小写会静默回落成 `index.html`（HTTP 200 + text/html），表现为「模型加载失败 404」。

### 实测验证

| 项目 | 结果 |
| --- | --- |
| 远程玩家（1124，9 格外） | 实体创建在 `(140,123)`，10 个蒙皮网格、**706 三角形 / 10 DrawCall** |
| 移除后重新渲染 | 三角形 566924 → 566218，DrawCall 111 → 101（证明真的画出来了） |
| 怪物 2/3/6/7 号 | 落点 `(136,131)/(130,131)/(133,134)/(133,128)`，整图差分 3.67% |
| 上行移动 | 按住 W 走 1.6 秒，服务端**回显 3 次 `0x11`**（说明被接受，没被踢） |

### 踩到的坑

**清空实体的时机**：一开始在 `loadWorld` **结束**时调用 `remotes.clear()`，
而 `0x12/0x13` 恰恰是在地图加载那十几秒里到达的 —— 实体刚建好就被删掉。
改成在加载**开始**时清。

### 验证命令

```bash
# 1. 先起一个小号挂在洛兰（约 80 秒）
MU_ACCOUNT=1111 MU_PASSWORD=1111 MU_CHAR=1124 MU_HOLD=80000 npm run net:login
# 2. 另开一个浏览器窗口登录 1234，就能看到 1124
node tools/app-probe.mjs 1234 1234 1234
# 3. 不依赖服务端刷怪的实体测试（造 0x13 包 + 像素差分）
node tools/entity-probe.mjs
```

---

## 4:3 舞台 · 怪物/NPC 模型 · 攻击链路（阶段 E）

### 4:3 固定视口

MU 客户端是 4:3（800×600 起步）。现在 `#stage` 用 CSS 锁 4:3：

```css
#stage {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(100vw, calc(100vh * 4 / 3));
  height: min(100vh, calc(100vw * 3 / 4));
}
```

登录面板、选角、载入、HUD、伤害飘字全在 stage 内（从 `fixed` 改成 `absolute`），
渲染缓冲跟 `stage.clientWidth` 走，`ResizeObserver` 监听；宽屏只加黑边，画面不拉伸。

### 攻击链路

```
C→S  C1 07 15 [idHi] [idLo] [action] [dir]      CGAttackRecv
S→C  C1 07 18 [idHi] [idLo] [dir] [action]      GCActionSend（广播给视野）
S→C  C1 10 15 [idHi|flag<<7] [idLo] [dmgHi|type] [dmgLo] pad [curHP:4] [dmgHP:4]
S→C  C3 18 9C [idHi|flag<<7] [idLo] pad [exp:4] [damage:2] ...
```

几个容易错的点：

1. **攻击包和伤害包是同一个 head（0x15）**，靠方向区分。
2. **伤害包的 `ViewCurHP` 在 offset 8**，不是 7 —— 结构体有 1 字节对齐填充，总长 16。
3. **死亡包 0x9C 是 C3（加密）**，`header.setE` 用的是 0xC3；经验是
   `experience[0]=高16位、experience[1]=低16位`，直接当 DWORD 读会得到
   「低位左移 16 位」的错值（152 会变成 144179200）。
4. **服务端先判死再发经验包**：血量为 0 的 0x15 会先把实体标成死亡，
   随后 0x9C 到达时不能因为「已经死了」就丢掉经验。

### 移动包必须是 0x10，不是 0x11

`Protocol.h` 里 `PROTOCOL_CODE1 = 0x10`（`CGMoveRecv` / `PMSG_MOVE_SEND`），
`0x11` 是 `CGPositionRecv` —— 一个「±15 格瞬移」包，不做路径校验。

之前发 0x11 也能动，所以一直没发现；但它会绕过服务端寻路、也不广播给别人。
换成 0x10 后还有一串坑（方向表、回声 vs 权威、分段上报），见下面的**阶段 F**。

### 0x0E 保活

进图后不发心跳的话约 60 秒 socket 会被服务端回收（日志
`WSASend() failed with error: 10038`）。`MuSession.startLive()` 每 10 秒发一次：

```
C3 0B 0E [TickCount:4] [PhysiSpeed:2] [MagicSpeed:2]
```

### 实测（真实服务端）

```
走到 187,120 → 攻击 Spider(id=233)
#0 d=1.0 → HP 27/30   飘字 3
#4 d=0.1 → HP 16/30   飘字 6
#8 d=0.1 → HP  2/30   飘字 10
#9 → 收到死亡包 0x9C，经验飘字 +1
```

FPS 采样、目标血条（首次受伤时用 `life + damage` 反推上限）、
自身挨打飘 `-N`、死亡（0x17）锁操作、重生（F3/04）恢复，都已接上。

### 两条命令行验证

```bash
npm run app:probe       # 离线：4:3 比例 + 怪物/NPC 模型文件清单 + 截图
npm run attack:probe    # 联机：登录 → BFS 走到刷怪点 → 打怪 → 校验伤害/死亡/经验
npm run packet:test     # 报文级：构造 0x15/0x18/0x9C 校验字段偏移
```

### 尚未完成

1. 角色外观按 `CharSet` / 装备 BMD 组合（远程玩家仍统一用默认那套装备）
2. NPC 对话/商店（现在只是站着显示模型）
3. 掉落物、技能特效（`Data/Effect`）
4. 走位动画与服务端速度对齐（现在只按格推进，没乘 `PhysiSpeed`）

---

## 移动判定 · 占位（阶段 F）

### 方向表必须对齐服务端的 RoadPathTable

`GameServer/Util.cpp:17` 是方向编号的**唯一权威**：

```cpp
int RoadPathTable[MAX_ROAD_PATH_TABLE][2] = {
  -1,-1,  0,-1,  1,-1,  1,0,  1,1,  0,1,  -1,1,  -1,0
};
```

从西北开始**顺时针**（NW → N → NE → E → SE → S → SW → W）。

原来 `DIR_VECTORS` 写成了逆时针，从第 4 项起全部错位：按 W 往上走报 `6`，
服务端按 `RoadPathTable[6] = (-1,+1)` 解释成**西南**，每步偏一格；连走几步后
本地位置和服务端差出 2 格以上，`gObjSetPosition` 就触发 `0x11` 把人拽回去。

现象很有欺骗性 —— **单步看着对，连走两步就被拉回原地**。
现在 `DIR_VECTORS` 与表逐项一致，而 `dirFromDelta` / `yawFromDir` /
攻击包的 `dir` 全部由它派生，所以只改一处就全对。

定位手段：给 `MuSession` 加 `netLog`，并排打两列 —— `sent`（我包里的格）和
`echo`（服务端 0x10 回的格）。一格对一格才正常，差一格就是方向表错。

### 上行包里是起点，下行 0x10 里是终点

`CGMoveRecv`（`Protocol.cpp:976`）拿到包后的第一件事是：

```cpp
lpObj->TX = lpMsg->x;  lpObj->TY = lpMsg->y;   // 包里的是**起点**
lpObj->PathX[0] = lpMsg->x;                    // 从起点开始累加方向
```

然后 `for (n = 1; n < PathCount; n++)` 用 `RoadPathTable` 一格一格推出
`PathX[n]`，最后 `TX/TY` 才是**终点**。校验也只看终点（`CheckAttr(TX,TY,4|8)`
和 `±15`），**中间节点一格都不查** —— 所以客户端可以一次塞 8 步，
但方向序列必须自己算对，服务端不会替你纠。

拒绝包时的分支很干净：清空路径 → `gObjSetPosition(lpObj, lpObj->X, lpObj->Y)`
→ 发 `PMSG_POSITION_SEND`(0x11) 把客户端拽回服务端记的原位置。

正常接受时发的是 `PMSG_MOVE_SEND`(0x10)，里面 `x/y = TX/TY`（终点）、
`dir = Dir << 4`。

### 所以：0x10 不能拿来搬人，0x11 才是权威

两件事要说清：

1. **0x10 的坐标是对的**，它就是服务端算出来的终点 —— 拿它做日志对照完全成立
   （方向表错位就是这么查出来的）。
2. **但不能拿它搬人**：一条 0x10 对应你刚才那一包，而本地可能已经走进下一格；
   连续发几包时，一串 0x10 会依次到达，每搬一次就打断当前路径。
   实测「走两步被拉回原地」有一半原因在这里。

真正的硬纠偏只有 0x11，只在包被拒（越界 / 终点是墙 / 定向瞬移校验失败）时出现。

所以监听回调签名是 `onSelfMove(x, y, dir, authoritative)`，
只有 `authoritative === true` 时才搬人 + `resetMoveTracking()`。
实测正常走位时**一次 0x11 都不该来**，来了就是包被拒了。

### 一次最多带 8 步

`CGMoveRecv` 的 `PathCount = (path[0] & 0x0F) + 1`，上限 8 格；`PathX[0]` 用包里
的 x,y，之后逐字节拆方向（奇数步取高半字节、偶数步取低半字节）。
服务端**不逐格校验**，只查终点 attr、±15 范围、100ms 间隔。

逐格一包（110ms 节流）在低帧率下会积压，所以现在：

- `onEnterCell()` 记住 `lastCell`，跨格（含一次跨多格）时把方向压进 `outSteps`
- `flushMoves()` 每帧最多取 8 步组包，成功后推进 `sentCell`
- 上报基准永远是 `sentCell`（服务端已知位置），**不是** `round(player.x)`
- 进图 / 重生 / 0x11 纠偏都走 `resetMoveTracking(x, y)` 归零

### 占位和模型解耦

`NO_MODEL_CLASSES`（守卫 Class 249、Golden Archer 236、传送门）没有 BMD。
早期代码在建模型失败时直接 `return`，格子也不占 —— 角色能笔直穿过守卫。

现在 `Remotes` 里有独立的 `blockerMap`：

- `upsertPlayer` / `upsertMonster` 在**建模型之前**登记阻断格，模型失败不影响占位
- `blockerCells()` 用服务端给的**目标格** `tx/ty`，不用插值中的浮点坐标
  （否则角色走到半格时，那一格会忽然变成可通行）
- `kill()` 先置 `dying = true`，等尸体淡出后才删，避免一死就能踩
- `p.name === selfName` 时把自己从 map 里摘掉，不然自己挡自己

### 卡死的两个根因

1. **滑动分支没排除零分量**。`stepY === 0` 时 `canEnter(player.x, ny)` 必然为
   `true`，代码走进「沿 Y 轴滑动」，把 `player.y` 设成自己 —— 既不动，也永远
   进不到重算分支。现在先算 `tryX / tryY`，零分量的轴不参与滑动。
2. **`nearestFree` 按扫描顺序返回**。点 NPC 脚下时永远绕到西北角那一格。
   改成按欧氏距离取最近（`d2 < bestD`）。
   顺带把点地取格统一成 `Math.floor`：格心是 `x.5`，`round` 会偏到下一格，
   正好压到 NPC 头上。

### 服务端的 3×3 不是「贴墙判定」

`gObjCheckMapTile`（`User.cpp:1201`）看着像贴墙检查，其实两点都和直觉不同：

```cpp
for (int x = 0; x < 3; x++)
  for (int y = 0; y < 3; y++)
    if (!CheckAttr(X + x, Y + y, 4) && !CheckAttr(X + x, Y + y, 8))
      return 0;   // 只要有一格不是墙就合法
```

1. 窗口是 `X..X+2, Y..Y+2`（**偏了一个格**，不是 `-1..+1`）
2. 判定是「9 格**全部**是墙才返回 1」

返回 1 的后果分三处：0x10 移动包直接丢弃、0x11 瞬移直接丢弃、
进图/重生时 `gObjMoveGate` 传到城门口。

也就是说**贴墙走完全合法**，只有整个人陷在墙堆里才会被处理。
客户端不要跟着加严成 3×3 —— 那样贴着建筑就走不动了。

### 绕过其他角色：斜向擦人是真凶

其他玩家和 NPC 走同一套占位：服务端 `0x12` 视野包带着 id/x/y/tx/ty，
`upsertPlayer` 先登记 `blockerMap` 再建模型，`selfName` 那一条跳过自己。

但**只把格子塞进 `blockedCells` 还不够**。实测（双账号）第一次就翻车：

```
A(138,120)  B(138,121)  A 的目标(139,122)
A* 下一点 = (139,121)          ← 斜向一格
轨迹只有 138,120，floor 永远不动，停滞超过 1.8s
```

原因是 8 方向移动的斜向一步会**先跨一个轴**：从 `(138,120)` 往 `(139,121)`
走，`floor` 会短暂落在 `(138,121)` —— 正好是 B 站的那一格。于是每帧都判定
「撞到人」→ 清路径 → 重算 → A* 又给出同一条斜线 → 原地抖，永远过不去。

三处一起改才对：

1. **A\* 禁止擦人斜穿**：`findPath` 加可选参数 `blockDiag`，斜向时若两个正交
   侧格任一被单位占用就换条路。侧格是**墙**仍然允许（贴墙绕行是正常操作）。
2. **移动判定同样禁止**：`canEnter` 里斜向跨格时检查 `unitBlocked(侧格)`，
   不通过就走下面的滑动分支，自然变成「先走一轴再走另一轴」。
3. **撞人不再沿墙滑**：滑动分支是给墙用的，用在人身上会变成贴着对方横向蹭。
   现在区分 `terrainWalkable && unitBlocked` → 直接按当前占位重算（250ms 节流）。

另外加了**路径预检**：每帧看路径前方 3 个节点，被单位占了就提前重算，
不用等撞上去。`walkToCell(tx, ty, force)` 的 `force` 用来跳过「同目标复用旧路径」，
否则目标没变就永远拿到那条已经走不通的老路。

### 实测（真实服务端）

| 场景 | 结果 |
| --- | --- |
| 东移 6 格 | `sent` / `lastCell` / `echo` 逐格一致，距目标 0.15，**0x11 一次没来** |
| 再往南 6 格 | 距目标 0.52，0x11 一次没来 |
| 斜向点建筑里 (158,111) | 该格 `attr=4`，自动退到最近可站格 (153,109)，走完全程 |
| 走向 Safety Guardian(146,110) | 停在 `(146,109)`，离 NPC 格心 1.04 格，没踩 NPC 格 |
| 双账号 A(139,122) 绕过 B(138,124) | 轨迹 `139,122 → 138,123 → 137,123 → 137,124`，**不含 B 的格**，`clearReason=repath-unit` |
| B 移动后 A 追过去 | A 停在 B 目标格旁，`goal` 自动从 `(138,125)` 挪到 `(138,124)`，没踩 B |

> 报文头里全是 `0x10:8`，**没有一条 `0x11`** —— 说明没有一个移动包被拒。

离线（`tools/walk-probe.mjs`）：

| 场景 | 结果 |
| --- | --- |
| NPC 格 `canStand` | `false` |
| 点 NPC 脚下 | 停在 1.4 格外，轨迹不含 NPC 格 |
| 伪造玩家 Blocker 挡路 | A* 绕行，轨迹不踩那一格 |
| **走起来之后**才有人插到路上 | 轨迹绕到下一行再回原线，`clearReason=repath-unit` |
| 点在墙里 | 走到墙边最近的可站格 |
| 长距离 42 格 | 采样窗口内持续推进，未触发卡死 |

### 验证命令

```bash
node tools/walk-probe.mjs          # 离线：NPC/玩家占位、绕行、点墙里、长距离
node tools/online-move-probe.mjs   # 联机：三段走位 + 走向 NPC，输出 sent/echo 对照表
node tools/two-player-probe.mjs    # 双账号：A 是否看见 B、绕不绕 B、B 动了还绕不绕
node tools/two-shot.mjs            # 双账号同屏截图：确认对方模型真的渲染出来（不只是占了格）
```

`two-player-probe` 会开两个独立 Edge（`1234/1234` 和 `1111/1111`），打印：

- `A 的实体` / `player#id name 目标格`：确认 0x12 视野包真的把对方建出来了
- `A 的占位集合`：确认对方被登记成 blocker（不是只有模型、不挡路）
- `可走网格`：`canStand` 的 7×8 快照，`#` 是墙或单位 —— 一眼看出「没路绕」还是「没绕」
- `轨迹` / `next` / `clearReason`：绕行是否发生、是不是又掉回原地抖

`online-move-probe` 会打印三样东西，缺一不可：

- `轨迹(格|sent|out)`：本地所在格 / 服务端已知格 / 未发出的步数，三列同步才算健康
- `netLog`：`sent` 与 `echo` 并排，一格错位就是方向表错
- `报文头`：正常走位只该有 `0x10`，出现 `0x11` 说明有包被拒

### 探针的临时 profile 必须自己收尸

探针都是「起一个 headless Edge + CDP 遥控」，`--user-data-dir` 每个实例会写
**60~200 MB**。早期脚本只在 `finally` 里 `edge.kill()`，**进程杀干净了但目录没删**，
跑一天下来 `%TEMP%` 里躺了 122 个目录、合计 **13.6 GB**。

现在统一走 `tools/lib/profile.mjs`：

```js
import { makeProfile } from './lib/profile.mjs';
const profile = makeProfile('walk');   // → %TEMP%/mu-probe/walk-<pid>-1
```

- 全部收在 `%TEMP%/mu-probe/` 一个父目录下，不再散落在 TEMP 根
- `makeProfile()` 先清扫历史残留（跳过 5 分钟内还在动的，避免删掉并发跑的那个）
- 退出时靠 `process.on('exit')` **同步**删除 —— 脚本里 `process.exit()` 之后
  事件循环已经停了，异步删除一定丢；同步删不掉（Edge 还没放开句柄）就留给下次清扫

新增探针别再自己拼 `--user-data-dir=${process.env.TEMP}\xxx-${Date.now()}`。

---

## 掉落与拾取（阶段 G）

### 三个包，别搞混

| 包 | 方向 | 内容 | 发送点 |
| --- | --- | --- | --- |
| `0x20` | 下行 C2 | 物品**进入视野** | `CViewport::GCViewportItemSend` |
| `0x21` | 下行 C2 | 物品**离开视野** | `CViewport::GCViewportDestroyItemSend` |
| `0x22` | 双向 C3 | 上行拾取 / 下行结果 | `CGItemGetRecv` / `GCMoneySend` |

`0x21` 是独立的包 —— `0x14`（玩家/怪物离场）里**不带物品 id**，
只处理 `0x14` 的话，别人捡走的东西会永远留在地上。

### 0x20 的布局

`PMSG_VIEWPORT_SEND` 的头是 `PWMSG_HEAD`（**4 字节**：C2 + 2 字节长度 + head），
所以 count 在 `pkt[4]`，条目从 `pkt[5]` 起，每件 **9 字节**：

```
index[2]  x  y  ItemInfo[5]
```

- `index[0]` 的最高位 = 服务端标记「新建」，取值时要 `& 0x7F`
- `ItemInfo` 由 `ItemByteConvert` 填：
  `[0]` type 低 8 位、`[1]` `level<<3 | luck<<2 | skill<<7 | option&3`、
  `[2]` 耐久、`[3]` `bit7 = type 第 9 位` + `bit6 = option>3` + 低 6 位卓越、`[4]` 只有金币用

### type 与模型：两个恒等式

```
type  = GET_ITEM(group, index) = group * 32 + index   // MAX_ITEM_TYPE = 32
model = type + ITEM_BASE_MODEL(400)
```

两边源码（`ItemManager.h` / `structs.h`）里的宏完全一致，所以模型文件名就是
「group 对应的前缀 + `index+1` 的两位数字」：

| group | 模型 | 目录 | group | 模型 | 目录 |
| --- | --- | --- | --- | --- | --- |
| 0 | `Sword01..21` | `Data/Item` | 8 | `ArmorMale01..` | `Data/Player` |
| 1 | `Axe01..09` | `Data/Item` | 9 | `PantMale01..` | `Data/Player` |
| 2 | `Mace01..` | `Data/Item` | 10 | `GloveMale01..` | `Data/Player` |
| 3 | `Spear01..` | `Data/Item` | 11 | `BootMale01..` | `Data/Player` |
| 4 | `Bow01..` | `Data/Item` | 12 | `Wing01..07` | `Data/Item` |
| 5 | `Staff01..` | `Data/Item` | 13 | `Helper01..` | `Data/Player` |
| 6 | `Shield01..` | `Data/Item` | 14 | `Potion01..08` + 特例 | `Data/Item` |
| 7 | `HelmMale01..` | `Data/Player` | 15 | `Book01..19` | `Data/Item` |

group 14 的 index 8 以后不是 Potion09/10…，客户端是逐个点名的：
8 `Antidote01`、9 `Beer01`、10 `Scroll01`、11 `MagicBox01`、12 `Event01`、
13 `Jewel01`、14 `Jewel02`、15 `Gold01`。见 `items.ts::GROUP14_SPECIAL`。

**模型必须归一化**：物品 BMD 的单位差得很远（戒指指甲盖大、翅膀比人还大），
按包围盒把最大边缩到 0.7 格，否则不是看不见就是糊满屏。

### 朝向照抄 ItemAngle，不是自转

`Entity_LegacyEffects.cpp::ItemAngle`（IDA 0x005030C0）给的是**一次性固定角度**：

- 默认 `rz = -45°`
- 400..463（剑/斧/锤/矛）`rx = 60°`
- 536..544 / 546（弓）`rx = 90°`
- 464..591 `ry = 270°`
- 592..623（盾）`ry = 270°, rz = 225°`
- 656..751（防具）`rx = 270°`
- 784..815（翅膀）`rx = 270°, rz = 45°`

一开始写成「绕 X 轴 -90° + 绕 Z 自转」，看起来像地上躺着的东西在打转。
原版是静置的斜插效果，照抄这套角度就对了。

### 0x22 必须是 C3，这是最容易卡住的地方

`PMSG_ITEM_GET_RECV` 在源码里写的是 `PBMSG_HEAD`（C1），但发 C1 会被
**反作弊静默丢掉**：

```
Data/Hack/HackPacketCheck.txt:24   22  *  0  0  0  0
```

这一行要求 `Encrypt = 1`。发 C1 服务端只会在 `HACK_LOG` 里留一句
`Packet encryption error (Index: 34, Value: -1, Encrypt: [0][1])`
然后 `CloseClient` —— 表现是「发了拾取包，服务端一声不响，人物接着掉线」。

正确包：`C3 05 22 [idHi] [idLo]`。

### 0xFE 有两个来源，认错会误删

`result = 0xFE` 既表示「捡到金币」，也是 `GCMoneySend`（Protocol.cpp:1669）
主动同步金币用的 —— 两者都带玩家的**总金币**（不是本次金额）。

唯一可靠的区分是**有没有 pending**：

- 有 pending → 是拾取回执，删掉地上那件、飘字
- 没有 pending → 是金币同步（进图/命令/买东西都会来），只更新数字

写成「收到 0xFE 就删 pending 那件」的话，一次金币同步就能把别的物品从地上抹掉。

### 拾取流程

```
左键点物品 → tryPickup(id)
  ├─ 距离 ≤ 1.8 格 → 直接发 0x22
  └─ 否则 walkToCell(物品格)，主循环每帧检查，进 1.8 格内才发
发完 markPicking(id) 防重复，3 秒没回执就放开重试
回执 ok → 删模型 + 飘字（金币显示 "Zen N"）+ 刷新面板
回执 0xFF → 放开标记，可再点
```

服务端 `CMap::CheckItemGive` 的判定是 `|dx| ≤ 2 && |dy| ≤ 2`，客户端贴 1.8 走留余量。

### 角色数值

数据全部来自 `0xF3/04` 角色包。**阶段 J 之后这些数值不再单独开一个面板**，
而是画进原版底栏（HP/MP 球 + 经验条 + AG 条 + 名字/坐标），见文末
「底栏数值与 Data/Local 文本」。

- **等级不在 0xF3/04 里**，得用选角列表（`F3/00`）里那一条，所以 `currentChar` 多存了 `level`
- 攻击/防御在原版里是客户端派生值（`CharacterAttribute` CA+56..68），
  0xF3 只给四维和 HP/MP/AG，所以属性面板那三行是**近似值**

### 实测（真实服务端）

```
/drop 0 0 0 0 0 0 0          → 脚下掉一把 Kris，视野包收到 id=9
走开 3.38 格                  → 自动走回来
进 1.8 格 → 发 0x22
回执 result=0x15(21) item={type:0,lv:0,dura:20}   → 背包槽位 21
地面物品 9 已消失，剩 10 件
```

9 种物品（剑/斧/弓/盾/铠甲/翅膀/药水/宝石/书）模型全部解析成功，
场景里 9 个节点 14 个 mesh，尺寸归一化到 0.7 格。

### 验证命令

```bash
node tools/item-probe.mjs    # 模型映射 + 环形摆件 + /drop 真实掉落 + 走过去拾取 + 面板
```

探针里的 `/drop` 是服务端 GM 命令（`Data/Command.txt:44`，普通账号也能用），
用法 `/drop <组> <序号> <等级> <技能> <幸运> <追加> <卓越>`。

`__MU_APP__` 新增：`testItem / testMoney / items / itemCount / nearestItem / pickupItem /
itemDebug / chat / stats / toggleStats / statPanelOpen`。



## 背包 UI · 槽位布局（阶段 H）

背包面板不是「自己设计一套好看的」，而是按 `Mu-97k-Client-Source-main` 里
`Render/HUD_Pass6.cpp::RenderInventoryWindow` 的**硬编码坐标**逐像素复刻，
贴图全部直接读 `Data/Interface/*.ozj`，不做任何转换。

### OZJ 就是「24 字节头 + 标准 JPEG」

客户端 `Render/Texture/Texture.cpp::tex_load_ozj`（IDA 0x00529740）全程只有一句
`fseek(f, 24, SEEK_SET)`，之后就当普通 JPEG 解码。判定式：

```ts
d[24] === 0xFF && d[25] === 0xD8   // SOI
```

`Data/Interface` 下 79 个 `.ozj` 全部符合；另有 35 个是「0 和 24 都能解」的普通 JPEG
（切掉 24 字节反而坏），所以要看 SOI 位置判断，不能一律切。
`.ozt` 是 TGA 变体（type 2 未压缩 / type 10 RLE，24/32bpp），浏览器解不了，
`src/ui/ozj.ts::decodeOzt` 手解，光标 / `Font.ozt` / `MiniMap.OZT` 靠它。

### 640×480 是逻辑坐标系

客户端所有面板坐标都是这个基线的绝对值 —— 背包 `sx = 450`、宽 190（450+190=640），
标题字号 `120 * WindowWidth / 0x280` 里的 `0x280` 也是 640。
所以 `UiLayer` 用 `transform: scale(stage.clientWidth / 640)` 整体缩放，
**不做自适应重排**，否则和原版对不上。

### 服务端槽位：0..11 是装备，12..75 才是背包

这是最容易搞反的一处，`Item.h:3` + `ItemManager.h:15`：

```c
#define INVENTORY_WEAR_SIZE 12
#define INVENTORY_WEAR_RANGE(x) (((x)<0)?0:((x)>=INVENTORY_WEAR_SIZE)?0:1)   // 0..11 → 1
```

也就是说 **0..11 是那 12 个装备槽，12..75 是 8×8 背包**，
格子序号 `cell = slot - 12`（`InventoryAddItem` 里 `x=(slot-12)%8; y=(slot-12)/8` 是直接证据）。
客户端把 `OffsetInventoryItems` 指向 `&Inventory[12]`，所以它眼里格子从 0 开始 —— 这也是
一开始按「0..63 背包 / 64..75 装备」写、结果装备永远为空、拖到 `slot 0` 被拒的原因。

12 个装备槽的位置见 `FUN_004d1fc0`（`Net/SecondPassword.cpp`，12 次
`FUN_004cdc70(x, y, w, h, slotIdx)` 调用），槽位号由 `Data/Item/Item.txt` 的 Slot 列定死：

| slot | 位置 | 尺寸 | 内容 | 占位贴图 |
|------|------|------|------|----------|
| 0 | 15,89 | 40×60 | 武器（左） | `Item_Weapon01` |
| 1 | 134,89 | 40×60 | 副手 / 箭（右） | `Item_Weapon02` |
| 2 | 75,46 | 40×40 | 头盔 | `Item_Cap` |
| 3 | 75,89 | 40×60 | 铠甲 | `Item_Upper` |
| 4 | 75,152 | 40×40 | 护腿 | `Item_Lower` |
| 5 | 15,152 | 40×40 | 护手 | `Item_Gloves` |
| 6 | 134,152 | 40×40 | 战靴 | `Item_Boots` |
| 7 | 115,46 | 60×40 | 翅膀 | `Item_Wing` |
| 8 | 15,46 | 40×40 | 守护 / 宠物 | `Item_Fairy` |
| 9 | 55,89 | 20×20 | 项链 | `Item_NeckLace` |
| 10 | 55,152 | 20×20 | 戒指 1 | `Item_Ring` |
| 11 | 115,152 | 20×20 | 戒指 2 | `Item_Ring` |

（`Item.txt` 里 `Pendant of Lightning` 是 `12 9 …`、`Ring of Ice` 是 `8 10 …`，
`CheckItemMoveToInventory` 还特意放行 `slot 10 / 11` 互换成对戒指 —— 9 是项链不是戒指。）

### 0xF3/0x10 是 C4 宽包，不是源码表面上的 C3

源码写的是 `pMsg.header.setE(0xF3, 0x10, 0)`，但结构体用的是 `PWMSG_HEAD`（2 字节长度），
发出来实际是：

```
c4 00 92 f3 10 1c  { slot, ItemInfo[4] } × count     ← 实测 28 件
```

`parseItemList` 按 `pkt[0]` 判宽/窄头算偏移，一次遍历 0..75，
所以**装备栏和背包在同一个包里**，不需要额外请求。之后捡东西只回 `0x22`，
`result` 就是落点槽位，客户端自己 `addInventoryItem` 补进本地快照。

### 0x24 是「背包内换位能用、背包→装备被服务端拒」

包体和原版逐字节一致（3+1+1+4+1+1 = 11，C3 头，`HackPacketCheck.txt` 要求 Encrypt=1）：

```
c3 0b 24 | srcFlag | srcSlot | ItemInfo[4] | dstFlag | dstSlot
```

实测结论：

- **背包内换位**（如 `13 → 68`）→ 服务端接受，**重登后仍是 68**，持久化没问题
- **背包 → 装备槽**（`36 → 10`，一枚无属性要求的 Transformation Ring）→ 恒回 `result=0xFF`
  + 一条 `0x2A`（耐久包），两个角色、全部 12 个槽位都一样

客户端没有发错，是**服务端二进制的分支反了**：`MoveItemToInventoryFromInventory`
→ `InventoryAddItem` 里装备槽（< 12）被 `INVENTORY_WEAR_RANGE` 判进了背包分支，
于是拿 `(slot - 12)` 得到**负数坐标**去 `InventoryRectCheck`，必然返回 0xFF；
而「背包→背包」走的是 else 分支（只查职业），所以照常成功。
`MuServer_Source` 的源码本身是对的，跑着的 exe 不是这份源码编出来的。

所以客户端采用**乐观更新 + 回执纠错**：松手立刻本地换位，回执 `0xFF` 就把物品放回去，
并在面板底部弹一条 `服务端拒绝了这次装备操作（0xFF）`，不让玩家以为「拖了没反应」。
哪天服务端修好，这条链路不用改。

### 物品缩略图必须借主渲染器的 RenderTarget

原版 `RenderItems3D` 是在同一个 GL 上下文里逐格 `RenderItem3D`，格子里其实是带透视的实时模型。
H5 里改成**离线渲一次、缓存成 dataURL**，但**不能另开 `WebGLRenderer`**：
BMD 材质是全局缓存的 `MeshBasicMaterial`，换上下文后贴图不会重新上传，
渲出来是一堆纯白轮廓（踩过）。

正确做法：借主渲染器的 `WebGLRenderTarget` + `readRenderTargetPixels`，
再逐行翻转（WebGL 原点在左下）填进 `ImageData` → `toDataURL`。
`rt.texture.colorSpace = SRGBColorSpace` 必须显式设，否则读回来整体发白。

取景角度也不能省：原版 `RenderObjectScreen`（`Render/BMD_LegacyDraw.cpp:1750`）
给每个 model id 写死一组角度（普通物品一律 `180/270/15` 度），
直接正对着画会把剑看成一条细线（刀面朝 ±X，从 +Z 看只剩刀刃）。
这里没照抄角度表（那是 MU 自己的 Z-up 约定，搬过来会全歪），改成**按包围盒主轴对齐**：

```
最长轴 → +Y（竖直）   中间轴 → +X（水平）   最短轴 → +Z（正对相机）
```

剑的长轴是刀身 → 竖起来，最短轴是刀身厚度 → 刀面正对镜头；铠甲/头盔最短轴是前后厚度
→ 正面朝镜头。药水/戒指近似对称，怎么转都行。
已知残留：长轴在模型空间里是**斜的**物品（斧头、弩）没法用纯轴向映射摆正，
会看着偏 90° —— 要完全对齐得像原版那样给每类补一条角度特例。

另外每件物品的取图都要 `try/catch`：一件没有模型的物品抛出来会把整个 `paint()`
打断，后面的格子和整个装备栏停在上一帧，看起来像「物品消失了」。

### Vite 会拿 index.html 冒充图片

`Data/Interface` 里大小写不统一（`Item_Back02.OZJ`），猜错名字时 Vite **不返回 404**，
而是 SPA 回落成 `index.html`（HTTP 200 + 6KB HTML + `content-type: text/html`），
`<img>` 静默解码失败，面板只剩上半截。
所以 `tools/gen-ui-manifest.mjs` 扫盘生成 `src/data/uiManifest.ts` 固化真实文件名，
`fetchSprite` 还会检查 `content-type` 是不是 `text/html` 并给出明确告警。

### 验证命令

```bash
node tools/ui-inventory-probe.mjs   # 面板几何 + 底板/格子/装备槽/图标/金币 + /drop 拾取闭环
node tools/ui-drag-probe.mjs        # 真鼠标拖拽：背包换位（服务端接受）+ 穿戴被拒后回滚
node tools/ui-equip-probe.mjs       # 装备槽渲染（注入假数据，不依赖服务端穿戴）
```

拖拽用的是 CDP `Input.dispatchMouseEvent`（`mousePressed/Moved/Released`），
走浏览器真实输入管线，页面里 `pointerdown/move/up` 照常触发。
`tools/lib/edge-client.mjs` 因此多了 `ptr / dragTo / center / drag` 四个助手。

`__MU_APP__` 新增：`inventory / inventoryOpen / toggleInventory / moveItem /
lastMove / mockInventory / chars`。



## 角色属性面板与底栏（阶段 I）

两个东西共用一套基础设施（`UiLayer` 的 640×480 逻辑层 + `ozj.ts` 的解码器），
所以做完背包之后基本是「照抄坐标」。

### 属性面板和背包是同一块底板

`Render/HUD_Pass4.cpp:414` 的调用就一行：

```c
if (CharacterOpened) RenderCharacterInfoWindow(450, 0);
```

`RenderCharacterInfoWindow`（`HUD_Pass6.cpp:773`，IDA `0x4ECC60`）开头画的是
`GL_DrawTexture(260, x, y, 190, 256, …)` + `(261, x, y+256, 190, 177, …)` ——
**和背包的 `RenderInventoryInterface` 是同一对 `Item_Back01/02`**。
所以游戏里按 C 和按 I 切的是同一块右侧面板，只是内容不同。

版面（相对面板左上角，原版坐标减 450）：

| 元素 | 位置 | 尺寸/字号 | 备注 |
|---|---|---|---|
| 名字 | (35, 12) | 宽 120 居中 | bold |
| 职业 | (22, 22) | — | 原版与「服务器-频道」sin 互补淡入淡出 |
| 属性行底 ×5 | (13, 56 + i·60) | 75×21 | `Level_box.ozj`，原版 sprite 245 |
| 等级 | (14, 60) | 宽 104 | 原版给 70，中文会被截断 |
| 经验 | (24, 80) | 宽 130 | 半透明黑底 |
| 点数 | (95, 49) | 宽 80 | 蓝底黑字，只在 >0 时画 |
| 重置点数 | (24, 95) | 宽 130 | 橙色 |
| 力量/敏捷/体力/能量 | (14, 120/180/240/300) | 宽 70 | 青蓝 |
| 攻击/防御/防御率/生命/魔法 | (24, 140/200/215/260/320) | 宽 130 | 白字黑底 |
| 加点按钮 | (125, 115 + 60·row) | 24×24 | `Level_01/02.ozj`，命中框来自 `sub_4E5DE0 L94-98` |

原版**不画关闭按钮**（`HUD_Pass6.cpp` 末尾注释：「close button is NOT drawn by this
function」），关面板走底栏的 C 按钮。H5 里沿用背包那个 `exit_01/02` 放右上角。

### 职业号要做位运算，不能直接拿 charSet[0]

`Net/Net_Process.cpp:1643`：

```c
int klass = ((csByte0 >> 4) | (csByte0 & 0x10)) >> 1;
```

实测三个角色印证：`0x20 → 1`(DK)、`0x00 → 0`(DW)、`0x40 → 2`(FE)。
直接当职业号用会得到 0/32/64，全部落空（表现是标题下面显示 `(—)`）。

### 底栏：三段 256+128+256 = 640

`RenderMainFrameWindow`（`Render/HUD_Pass1.cpp:340`，IDA `0x4BD2B0`，
`Render_BottomHUD` 只是它的别名）：

```c
GL_DrawTexture(0xE9,   0, 387, 108, 45, …);              // 左下角饰
GL_DrawTexture(0xE9, 532, 387, 108, 45, 0.84,0,-0.84,0.70, …); // 右下角饰，水平镜像
GL_DrawTexture(0xE6,   0, 432, 256, 48, 0,0, 1, 0.75, …);  // 左段
GL_DrawTexture(231,  256, 432, 128, 48, 0,0, 1, 0.75, …);  // 中段
GL_DrawTexture(232,  384, 432, 256, 48, 0,0, 1, 0.75, …);  // 右段
```

`0xE6/231/232` 依次是 `Menu01_new / Menu02 / Menu03_new`，`0xE9` 是 `Menu04.ozt`。
UV 的 `0.75` 是「原贴图高 64、只取上 48 行」——`Interface/` 里这些 OZJ 已经被
Webzen 裁成显示尺寸（256×48），所以整张铺满即可。

按钮命中框来自 `Game/Player_InputTick.cpp:280-330`，全是 640×480 绝对值：

| 按钮 | x | y | 尺寸 | 图标 |
|---|---|---|---|---|
| 队伍 | 348 | 452 | 24×24 | `Menu_party.ozj`（门形） |
| 角色 | 379 | 452 | 24×24 | `Menu_character.ozj`（放大镜） |
| 背包 | 410 | 452 | 24×24 | `Menu_inventory.ozj`（卷轴） |
| 公会 | 582 | 459 | 52×18 | 文字按钮，未做 |

三个 24px 图标正好落在 `Menu03_new` 自带的三个金属凹槽上，位置是对的。

### OZT 是 22 字节头 + 裸 BGRA + 26 字节 TGA footer

这是本轮踩得最深的一个坑，两个错误版本都「看起来能跑」：

```text
[0..1]    00 00
[2]       02          未压缩（10 = RLE）
[16..17]  宽（u16 小端）
[18..19]  高
[20]      bpp（24 / 32）
[21]      desc（bit5 = 0 → 扫描线自下而上）
[22..]    像素，BGRA
[-26..]   TGA 2.0 footer，结尾是 "TRUEVISION-XFILE."
```

`Interface/` 下 17 个 OZT **全部**满足 `22 + w*h*(bpp/8) + 26 == 文件长度`。

踩过的两个坑：

1. 先按**标准 TGA** 读（宽高在 12/14），结果全是 0 → 静默返回 null，
   界面上只表现为「这张图没出来」。
2. 改对宽高偏移后，又以为头是 **48 字节**，因为 `48 + w*h*4 == 文件长度` 也成立。
   那只是 `48-22` 恰好等于 footer 长度。**像素相位整体错 2 字节**，
   alpha 读到邻居通道 —— `Menu04` 角饰（四周本来是透明的龙形）渲染成一整块黑板。

识别特征：按 4 字节步长扫 alpha，正确偏移下 `255` 占 60% 左右、`<8` 占 35% 左右；
错位时 `255` 只剩 1%。

### 攻防是客户端派生值，不是服务端下发的

`0xF3/0x03` 的角色包只有 **48 字节**（`x/y/map/dir` + exp/nextExp + levelUpPoint +
四维 + HP/MP/BP + money + pkLevel），**没有**攻击力、防御力、防御率。
原版面板读的是 `CharacterAttribute` 的 CA+56/60/62/68，那些是客户端自己算的。

现在的近似：

```text
攻击   = STR/6 ～ STR/4  + 左右手武器基础 DamageMin/Max
防御   = AGI/3           + 所有防具基础 Defense
防御率 = AGI * 1.2
装备强化 +N 按 3%/级折算
```

装备数据来自 `Item.txt`（`tools/gen-item-attrs.mjs` 现在多输出
`[宽, 高, 名字, 攻击min, 攻击max, 防御]`）。字段下标不能硬编码 ——
这版 `Item.txt` 在 Name 后面留了几个空的 tab 列，要**跳到第一个非空字段**再读，
否则 Kris 的攻击力会解析成 0。

未算：追加属性、卓越、套装、翅膀加成。这三行要在读的时候知道是近似值。

### 层级：面板必须压在底栏之上

底栏角饰从 y=387 就开始了，而两个面板高 433 —— 天然重叠。
底栏 `.bottom-bar` 是 `z-index: 5`，`.inv-panel` / `.chr-panel` 都给 `10`，
否则右下角那条黑龙头会从面板底部钻出来。

同样地，属性面板的底板是**异步**挂上去的，不给 `.chr-plate` 显式 `z-index: 0`
就会盖住所有文字（背包那一轮已经踩过一次）。

### 验证命令

```bash
node tools/ui-panel-probe.mjs    # 底栏三段/角饰载入 + 按钮命中框 + 面板互斥 + 文本行 + 真鼠标点按钮
node tools/ui-zoom.mjs 450 0 190 433 3 chr-zoom   # 按逻辑坐标裁一块放大截图
node tools/ui-icons.mjs "Menu_character,Menu_inventory,Menu_party" 5 icons
```

`__MU_APP__` 新增：`characterOpen / toggleCharacter / characterRows /
bottomButtons / uiSprite / uiPixel`。

`uiPixel(name)` 是查 OZT/JPEG 通道问题的利器：返回宽高、角/中心像素、
`darkRatio`（近黑像素占比）。当初判断「图标是黑底还是带 alpha」就靠它。



## 底栏数值与 Data/Local 文本（阶段 J）

上一阶段把属性面板和底栏的**贴图**铺好了，但角色数值还挂在几个临时 HTML 元素上
（左上角名字板、左下角两个圆球、F1 数值面板、三个悬浮按钮）。这一阶段全部拆掉，
改成原版那套：数值画在底栏里，文案从 `Data/Local` 读。

### HP/MP 球

`Render/HUD_Pass5.cpp`（IDA `sub_4BD650`）里这段很短：

```cpp
double v19 = hp_frac * 48.0;                 // hp_frac = 空的比例
float  va  = (float)(v19 * 0.015625);        // = empty * 0.75，贴图 UV 起点
GL_DrawTexture(poisoned ? 247 : 234,
               97.0f, v19 + 432.0, 53.0f, 48.0f - va * 64,
               0.0f, va, 0.828125f, 0.75f, 1, 1);
```

翻译成 DOM 就是「外层 53×48 + 内层 `clip-path: inset(空液比例 0 0 0)`」，
贴图永远是 `Menu_red.ozj` / `Menu_blue.ozj`（53×48，原版贴图号 234/235，中毒换 247）。

两个球的位置是写死的：**HP (97, 432)**、**MP (489, 432)**，正好落在
`Menu01_new` 与 `Menu03_new` 内嵌的圆形凹槽里 —— 之前用 HTML 圆球时，凹槽一直空着。

### 经验条只画「这一档的余量」

这是最容易做错的一处。`RenderExperience`（`HUD_Pass2.cpp:649`）：

```cpp
double fExpBarNum = (double)fExp / (double)fNeedExp * 10.0;
int    iExp       = (int)fExpBarNum;              // 0..9
glColor3f(0.92f, 0.80f, 0.34f);
GL_DrawRect(221.0f, 439.0f, (fExpBarNum - iExp) * 198.0, 4.0f);
RenderNumber2D(425.0f, 434.0f, iExp, 9.0f, 10.0f);
```

条长是**小数部分** × 198，也就是说条只表示「当前这一档填了多少」，
满一格就跳回 0，档位本身由右边那个 0..9 的数字表示 —— 不是常见的总进度条。
原先按 `exp/nextExp` 直接铺满 198 是错的（第一次跑出来 105px，以为公式错，
其实是我多除了一次 10）。

起点 `prevExp` 也要照抄：`10*(lv-1)^2*(lv-1+9)`，lv-1 > 255 时再加一段立方项。
但本服务端 `0xF3` 的 `nextExperience` 是**本级需求**（Lv12 约 3.4k），
不是原版 CA+52 的**累计值**（Lv12 约 5.4 万），所以 `expProgress()` 里做了判别：
`nextExperience > prevExp` 才按累计算，否则直接拿本级需求当分母。

### AG 条（当时判断错了，已在阶段 L 修正）

这一版误以为 0.97 没有 AG，在经验条下面补了条 198×3 的绿横条，
还把 `Menu03_new_ag.ozj` 说成「拉成横条会糊」而弃用。
实际上它是 15×36 的**竖槽**贴图，原版画在 (551, 437)，见下文「AG 是竖条」。

### 数字用位图字体，不用浏览器字体

原版 `RenderNumber2D`（`sub_5122F0`）逐位画 `Fonttest.ozt`：

```
u = digit * 0.0625   (= 16/256)，v = 0，宽 0.0625，高 0.5 (= 16/32)
起点 xa = x - n * Width * 0.5，逐位步进 Width * 0.7
```

所以每个字是 16×16 的一格、显示 9×10、前一位压 2.7px。
DOM 里用 `mask-image: url(Fonttest.ozt)` + `background: currentColor` 实现，
既能任意染色（等价原版 `glColor3f`），又不会像 `<img>` 那样丢掉锐利边缘。

三处数字：HP (100, 467)、MP (540, 467) 米黄；经验档位 (425, 434) 偏暗。

### 名字与坐标塞进 Menu01_new 的凹槽

那个 85×22 的凹槽在原版画的是金币/杀敌计数（(24,462)、(48,462)）。
这里改成两行：角色名（8px 金色）+ `地图 X, Y`（7px 灰蓝）。
坐标每 0.5 秒跟 `player.x/y` 一起刷。

### Text.bmd：3 字节滚动密钥 XOR，每行 300 字节

`Local/Text_Data.cpp:1-14` 写得很清楚：`300000 B = 1000 行 × 300 B`，
整块与 `{0xFC, 0xCF, 0xAB}` 按 `i % 3` 异或。第一行解出来是 `Tahoma`
（存的是字体名，不是文案）。

```
offset 0 ^ FC = 'T'   offset 1 ^ CF = 'a'   offset 2 ^ AB = 'h'   → Tahoma
```

切行后 `GlobalText[i]` 就是第 i 条。属性面板的文案全部按原版索引取：

| 索引 | 内容 | 索引 | 内容 |
|---|---|---|---|
| 199 | `Spare points: %d / %d` | 200 | `Level: %d / %d` |
| 201 | `Experience: %u / %u` | 202 | `Strength: %d` |
| 203/204 | `Damage (rate): %d ~ %d (%d)` / `Damage: %d ~ %d` | 205 | `Agility: %d` |
| 208/209 | `Defense (rate): %d (%d)` / `Defense: %d` | 210 | `Vitality: %d` |
| 211 | `Health: %d / %d` | 212 | `Energy: %d` |
| 213 | `Mana: %d / %d` | 217 | `Point: %u` |
| 20..29 | 职业名（`4*(upper)+20+(lower)`） | 67 | `Defense rate: %d` |

注意 **67**：源码里 `sprintf(Buffer, GlobalText[64], defRate)` 打的是防御率，
但这份 Text.bmd 的 [64] 是 `Attack speed: %d`（西语版行号整体偏了几位），
[67] 才对得上语义。

### item.bmd / Dialog.bmd 是「每条重置」密钥

同一个 3 字节密钥，但作用域不同（`Tools_Source/kayitoTools` 里 `BMDFileOpen.BuxConvert`
的调用方式就是答案：`TextEditor.cs:184` 传整块长度，其余编辑器都是**逐条**传记录长度）：

- `Text.bmd` 整块滚动（`i % 3`）
- `item.bmd`（512 条 × 64 B）**每条从 key[0] 重新开始**
- `Dialog.bmd`（200 条 × 1024 B）、`skill.bmd`（64 × 40）、`Gate.bmd`（100 × 9）同理

用整块滚动去解 item.bmd，第一条永远是 `Kris`，从第二条开始全乱码 —— 这个坑踩过。
改成每条重置后依次是 `Kris / Short Sword / Rapier / Katana …`，和 `Item.txt` 完全吻合。

还有一处同类陷阱：`512*64 + 4` 里的 4 字节在**文件末尾**，不是开头。
`ItemEditor.cs:722` 只校验长度，读取时 `Array.Copy(buffer, i * 64, …)` 从 offset 0 起。
按「4 字节头」去切，症状一模一样：第一条对、后面全错位。`skill.bmd` / `Filter.bmd` 也是这个布局。

### item.bmd 是完整物品表，不只是名字

`ItemManager.cs` 的字段表（`pragma pack 4`，64 字节/条）：

```
+00 Name[30]   +30 TwoHand  +31 Level   +32 Width    +33 Height
+34 DamageMin  +35 DamageMax +36 DefRate +37 Defense  +38 MagicDefense
+39 AtkSpeed   +40 WalkSpeed +41 Durability +42 MagicDurability +43 MagicPower
+44 WORD ReqStr  +46 WORD ReqAgi  +48 ReqEnergy +49 ReqLevel +50 Value
+52 DWORD Money  +56..59 ReqDW/DK/ELF/MG  +60..63 抗冰/毒/雷/火
```

也就是说攻防、需求力敏、耐久、价格全在里面，**比从 `Item.txt` 正则抠更权威**。
实测校对：`Kris` 6~11 / 耐久 20 / 需力 40；`Bronze Helm` def 9、`Bronze Armor` def 14 ——
和之前注入装备测出来的「防御 6 → 29」完全对得上（6 + 9 + 14）。

`src/data/localText.ts` 里已经按这张表解析成 `ItemRecord[]`（`loadItemTable()`），
`itemAttrs.ts`（Item.txt 生成的 283 条中文名 + 尺寸）暂时留着做 UI 缓存。

### 拆掉的临时 UI

`index.html` 里删了：`.hud-top-left`（名字/地图/金币板）、`.hud-bottom-left`（两个圆球）、
`.hud-buttons`（背包/角色/数值三个按钮）、`#stat-panel`（F1 数值面板）。
`main.ts` 里对应的 `updateOrbs / updateStatPanel / toggleStatPanel` 合并成一个
`refreshHud()`，`F1` 快捷键一起删掉 —— 现在开关面板只走底栏那三个原版按钮。

### 验证命令

```bash
node tools/hud-probe.mjs        # 底栏几何断言（换算回 640×480）+ 截图
node tools/hud-probe.mjs low    # 残血：确认体液面 clip 到 86.25% / 90%
```

`hud-probe` 不连服务端：点「离线演示」后调 `__MU_APP__.hudPreview()` 塞一份假 0xF3 数据，
既能看版式也能断言坐标。实测输出：

```
hpOrb [97, 432.2, 53, 48]      mpOrb [489.2, 432.2, 53, 48]
exp   [221.1, 439.2, 105, 4]   ag    [551.2, 437.2, 15, 36]（Menu03_new_ag 竖槽）
HP 数字中心 96.8（原版中心参数 100，因为原版按 Width*0.5 算起点，天生偏左 3px）
```

`__MU_APP__` 新增：`hudValues()`（快照）、`hudPreview(partial)`（假数据）。



## 装备 / 加点 / 占格（阶段 K）

### 「拖到装备栏弹回来」不是占格算错，是需求不够

0.97k 服务端对 `0x24` 失败**只回 `result = 0xFF`，不带原因**
（`ItemManager.cpp:2531` 起十几个 early-return 全是同一个值）。所以看起来像
「占格算法不对」，其实是 `CheckItemMoveToInventory` 里某个条件没过：

```
if (INVENTORY_WEAR_RANGE(slot) == 0) return 1;     // 放背包格子：不查任何条件
CheckItemRequireLevel / Strength / Dexterity / Vitality / Energy
CheckItemRequireClass    RequireClass[Class] != 0 且 (ChangeUp+1) >= 该值
m_Slot != slot 且 slot 不是 0/1/10/11 → 拒绝
```

实测账号 `1234` 的角色：Lv10 / 力量 28 / 敏捷 20，而最弱的 `Kris` 要
**力量 40 + 敏捷 40** —— 所以拖上去必然 0xFF。把力/敏各加到 40 后同一件装备立刻成功，
这条链路可以完全复现：

```
起始：力量 32，可用点数 41
加点后：力量 40 敏捷 40，可用点数 13
moveItem(18 → 0): {"ok":true,"lastMove":{"from":18,"to":0}}
装备栏: 0:0        ← slot 0 = 武器，type 0 = Kris
面板：Damage: 12 ~ 21   ← 40/6+6 ~ 40/4+11
```

### 本地先判，再发包

`src/ui/itemRules.ts` 把上面那套规则搬到浏览器侧，`requestItemMove()` 先判一遍：

- 目标槽 < 12 → `checkEquip()`：槽位匹配（武器/盾 0↔1、戒指 10↔11 互通）、
  等级、力量、敏捷、智力、体力、职业掩码
- 目标槽 ≥ 12 → `canPlaceInGrid()`：`8×8` 越界 + 与其它物品的矩形重叠
  （被拖的那件不算冲突，服务端也是先抹掉再放）

判不过就不发包，toast 直接写原因，比如
`敏捷不足：需要 40（当前 20，还差 20）`。这样玩家不会再遇到「拖了没反应」。

### 物品表补齐了装备槽和需求

`tools/gen-item-attrs.mjs` 改成**按 Item.txt 表头列名**取值 —— 老版本靠「跳过 Name
后面的空 tab」，但各段表头不一样（武器段第三列是 `DmgMax`，防具段是 `MagiDef`），
硬编码下标必然串位。现在每行是 15 个字段：

```
[宽, 高, 名字, 最小攻, 最大攻, 防御, 装备槽, 需求等级, 需求力, 需求敏,
 需求智, 需求体, 耐久, 职业掩码, 攻速/防御率]
```

装备槽就是服务端 `CItem::m_Slot`（0 武器 / 1 盾 / 2 头 / 3 甲 / 4 腿 / 5 手 /
6 靴 / 7 翅膀 / 8 守护 / 9 项链 / 10-11 戒指，`-1` 表示不能装备）。

### 加点：0xF3/06 的回执里就有新四维

之前点 `[+]` 毫无反应，是因为发完包又去请求 `0xF3/03` —— 那个包**只在角色选择阶段
才会回**，游戏中发出去石沉大海，于是 3 秒超时。实际上 `GAMESERVER_EXTRA=1` 时
`PMSG_LEVEL_UP_POINT_SEND` 带了完整数值（44 字节，按 4 字节对齐）：

```
4   result = 16 + type（0力 1敏 2体 3能），0 = 失败
8   MaxLifeAndMana(u16)   ← 只有 type 2/3 才赋值，其他情况是栈垃圾
10  MaxBP(u16)
12  ViewPoint(u32)
16  ViewMaxHP   20 ViewMaxMP   24 ViewMaxBP
28  ViewStrength  32 ViewDexterity  36 ViewVitality  40 ViewEnergy
```

实测 `c1 2c f3 06 10 …` 后面 8 个 DWORD = `42/128/24/26/31/20/25/10`，
正好是「加点后的剩余点数 + 新四维」。现在直接解析它并 `refreshHud()`。

### 物品词条 tooltip

背包格子/装备槽 hover 时显示名字 + 攻击/防御/攻速/耐久 + 需求（`Lv/力/敏/智/体`）。
数据就是上面那张表的 15 个字段，不再只有一行名字。

### 验证命令

```bash
node tools/equip-probe.mjs    # 加点到需求 → 装备 → 校验装备栏与面板攻防
```

`__MU_APP__` 新增：`packets(head?)`（最近 40 个完整报文，定位字段偏移用）；
`moveItem(from, to)` 现在走和拖拽完全相同的判定路径，返回 `{ ok, lastMove }`。



## 底栏数值与药水快捷槽（阶段 L）

这一节第一版做错了三处，全部按源码重来。踩过的坑记在最前面，免得再犯。

### 教训：先找渲染函数，别自己设计

| 我做错的 | 源码里其实是这样 |
|---|---|
| 球上拼 `3228/3228` | `RenderNumber2D(100, 467, cur_HP, 9, 10)` —— **只有一个当前值**，最大值在悬停提示里 |
| 快捷槽图标放 (216, 435) 22×22 | `Render_HotbarItems3D`：`slot_x` 从 **208** 起、**y=454**、**20×20**、步进 31 |
| 背包凡是 `durability > 1` 就画数量 | `itemType > 0x1BF && itemType < 0x1C9` —— 只有 **448..456 的药水**才有数量 |

### 球面数字：只有当前值，最大值在 hover

```cpp
// Render_HudPass_4BD650_
glColor3f(1.0f, 0.95f, 0.75f);
RenderNumber2D(100.0f, 467.0f, *(unsigned short*)(CA + 28), 9.0f, 10.0f);   // HP
RenderNumber2D(540.0f, 467.0f, *(unsigned short*)(CA + 30), 9.0f, 10.0f);   // MP

if (MouseX ∈ [97,150) && MouseY ∈ [432,480)) RenderTipText(103, 419, "Health: %d / %d");
if (MouseX ∈ [489,542) && MouseY ∈ [432,480)) RenderTipText(495, 419, "Mana: %d / %d");
```

所以球上就是 `3228`，鼠标移上去才出现 `Health: 3228 / 3228`
（`GlobalText[358]/[359]`）。之前那道手画的斜杠和缩字号逻辑全删了。

### Q/W/E 药水槽

图标是**3D 模型**，不是贴图 —— `Render_HotbarItems3D`（`HUD_Pass1.cpp:521`）：

```cpp
int slot_x = 208;
for (int slot_idx = 0; slot_x < 301; ++slot_idx) {
    int v2 = Item_FindQuickSlotByCategory(slot_idx);
    if (v2 != -1) RenderItem3D(slot_x, 454.0f, 20.0f, 20.0f, type, level, 0, 0, 0);
    slot_x += 31;                      // 208 / 239 / 270
}
```

数量在另一个 pass 里：`RenderNumber2D(i*31 + 226, 447, count, 9, 10)` → **226 / 257 / 288**，y=**447**。
数字压着图标上边缘（447+10 与 454 重叠 3px）是原版行为，不是错位。

选哪一件 + 数量怎么算（`Item_FindQuickSlotByCategory` + `sub_482E40`）：

```
Q = 448..451 从高到低找第一个有货的（451 大治疗 → 448 Apple）
W = 452..454
E = 456/457/468 里的辅助品（456 = Antidote，传送卷轴 458 被特意排除）

数量 = 该范围内**所有堆叠之和**，所以会出现「显示 Apple、数字 512（含治疗瓶）」
这种组合 —— 原版就是这么算的
```

### 背包数量只给 448..456

`Item/Item_InventoryRender.cpp:387`：

```cpp
if (p6 != 0 && itemType > 0x1bf && itemType < 0x1c9 && cell->Durability > 1) {
    glColor3f(1.0f, 0.9f, 0.7f);
    RenderNumber2D(x + _DAT_005527dc, y, (unsigned int)cell->Durability, 9.0f, 10.0f);
}
```

`0x1BF < type < 0x1C9` = **448..456**：Apple / 小中大治疗 / 小中大魔法 / 圣水 / Antidote。
位置 `x + 13`（`_DAT_005527dc = 13.0f`，注释写着 "arrow count X offset"）、`y` 顶格，
**不是**右下角。字号 9×10，米黄 `(1, 0.9, 0.7)`。

装备的 `Durability` 是**耐久**不是数量 —— 之前一刀切 `durability > 1`，
结果剑和铠甲上全是 `20`、`34` 这种数字。实测现在 `expect 7` 个标签 = `labels 7`，
背包里 6 把 type 0 的 Kris（durability 20）一个标签都没有。

### AG（Stamina）是竖条，不是横条

0.97 的 HUD 里 AG 不是「第三个球」，也不是经验条下面的横条，而是**右侧一根 15×36 的竖槽**，
贴图就是 `Menu03_new_ag.ozj`（贴图号 257，加载于 `Scene_AssetLoad.cpp:60`）。
`Render_HudPass_4BCD20_`（`HUD_Pass3.cpp:345`）全文：

```cpp
int v3 = *(u16*)((BYTE*)CharacterAttribute + 36);       // 当前 AG
int v23 = *(u16*)((BYTE*)CharacterAttribute + 38);      // 上限
if (v23 == 0) v23 = 1;
int barHeight = 36 * v3 / v23;                          // 0..36

float Heightb = (float)barHeight;
float vHeight = Heightb * 0.015625f;                     // = h / 64
float y = 473.0f - Heightb;
GL_DrawTexture(257, 551.0f, y, 15.0f, Heightb, 0.0f, 0.0f, 0.9375f, vHeight, 1, 1);

RenderNumber2D(571.0f, 467.0f, v3, 9.0f, 10.0f);

if (MouseX ∈ [551,566) && MouseY ∈ [437,473))
    RenderTipText(546, 419, GlobalText[214]);           // "Stamina: %d / %d"
```

三点很容易看错：

1. **贴图 15×36 正好就是槽位尺寸**，不用拉伸；`u` 到 0.9375 = 15/16、`v` 到 h/64，
   说明原始资源是 16×64 的竖条，这份 Data 里已经裁成 15×36。
2. **液面方向同 HP 球**：采样 `v ∈ [0, h/64]` 是取贴图**上面 h 行**，画在 `473-h` 起的高度上，
   所以 AG 掉的时候是从顶部往下退，不是横向回缩。DOM 里就是
   `clip-path: inset(空的比例 0 0 0)` + 贴图铺满 15×36。
3. **数字在槽右边**：`RenderNumber2D(571, 467)` 的 x 是中心，和 HP/MP 一样偏左 3px 的算法；
   悬停提示在 `(546, 419)`。

之前我在 (221,447) 补的那条 198×3 绿横条已经删掉了 —— 那是自己发明的版式。

### 验证命令

```bash
node tools/hud-quick-probe.mjs   # 球数值 / AG 竖槽液面 / Q,W,E 类型与数量 / 三段悬停提示 + 底栏特写
```

实测：

```
HP 3228  MP 1058  AG 1648（clip 0.00%）
药水槽: type=450 × 512 | type=453 × 900 | type=456 × 0
AG 几何: agBox [551.2, 437.2, 15, 36]  贴图 natural 15×36
AG 满槽四段亮度: [88, 93, 96, 95]
AG 25% 四段亮度: [21, 23, 17, 88]        ← 只剩最下面一段亮，顶部被裁掉
图标: 60px/1146px 60px/1146px 60px/798px
提示: Mana 1058/1058 @ (495,419) · Stamina 1648/1648 @ (546,419)
数字中心: 3228→100 · 1058→540 · 9→425 · 1648→571 · 512→226 · 900→257
```

亮像素那两行是最好用的判据：满槽四段均匀亮，打到 25% 后上面三段掉到背景水平
（17~23）、只剩底部一段 88 —— 说明液面确实是「从顶部退」，不是横向进度条。

### 实时数值：0x26 / 0x27 之前根本没处理

球上的数字一直停在进图那一刻，不是坐标问题 —— 是**服务端推的 HP/MP 同步包没人接**。

`Protocol.h:249` `PMSG_LIFE_SEND` / `PMSG_MANA_SEND`，C1 头 3 字节：

```
0x26  [3]=sub  [4..5]=life 或 maxLife（**大端 WORD**）
      0xFD 锁物品栏   0xFE MaxLife   0xFF Life   其他 = 该格耐久--
0x27  [3]=sub  [4..5]=mana 或 maxMana   [6..7]=bp 或 maxBp
      0xFE MaxMana+MaxBP   0xFF Mana+BP
```

吃药、被打、自然回血、捡到加血装备全走这两个包（`Attack.cpp:297`、`ItemManager.cpp:2667`
每次 `GCLifeSend`）。补上之后 `refreshHud()` 就会跟着刷球、条和数字。

**大端**这点容易抄错：0xF3 那些字段是小端，这两个是大端 `(Msg[4] << 8) | Msg[5]`。
实测注入 `c1 0b 26 ff 03 20 …` → HP 从 3228 变 800、球体液面裁到 75.22%；
`c1 0b 27 ff 01 00 02 00 …` → MP 256 / Stamina 512；`sub=0xFE` 改上限也生效。

调试用 `__MU_APP__.inject('c1 0b 26 ff 03 20 00 00 00 00 00')` 可以离线灌一个包。

### AG 的颜色不用自己配

曾经自己画过绿色渐变（横向纯色 → 竖向三段 + 内高光），全删了。
现在槽体颜色、金属描边、液面高光全部来自 `Menu03_new_ag.ozj` 本身，
代码只负责按比例裁高度 —— 和 HP/MP 球一样「贴图说话」，不叠任何 CSS 颜色。

### 数字“看不见”的真凶：z-index 被底栏整块盖住

球、条、角色名都能看见，唯独所有数字不显示 —— 排查过程很绕，结论却只有一行：

**`BitmapNumber` 当初是 `layer.add()` 挂到 `#mu-ui` 根上的，z-index 只有 2；
而底栏 `.bottom-bar` 是 `640×480` 满屏 + `z-index: 5`，把整层数字盖死了。**

球和条之所以正常，是因为它们的父容器 `.hud-values` 自带 `z-index: 6`。
把数字改成 append 到 `.hud-values` 之后全部出现（HP 区域亮像素从 0 变 2082）。

中间还走了两条弯路，都记录了，免得下次再试：

1. **CSS `mask-image` 染色**：`mask` computed 值、`mask-size`、`mask-position` 全对，
   mask 图也能 `decode()` 出 256px，但截图里一个像素都没有。
2. **canvas `drawImage` + `source-in`**：`getImageData` 能看到 160 个不透明像素、
   `maxA=255`，`elementFromPoint` 也命中 canvas，**同样合成不进画面**。

两条路的共同点都是「数据对、画面没有」——因为都在同一个错误的层里。
最后数字用 DOM 文本渲染（Tahoma 11px 粗体 + 四向黑描边），
字号/位置仍按原版 `RenderNumber2D` 的「以 x 为中心」算法。

### 排查手段：像素级断言

肉眼看不出来、截图我又读不了图，所以写了一套「截图 → 页面里 canvas 解码 → 数亮像素」的验证：

```js
// 隐藏前后对比，差多少就是这层到底画了什么
const clip = { x: stage.x + 78 * k, y: stage.y + 460 * k, width: 70 * k, height: 22 * k, scale: 1 };
```

判据是「同区域亮像素数量」：角色名 916、坐标 1413、数字 0 → 一眼看出只有数字没画。
改完 z-index 后数字 2082、MP 2184、Stamina 1323、Q 槽 1526、W 槽 1913。


## 聊天框（阶段 M）

### 版面：三处硬编码坐标

| 元素 | 坐标 | 出处 |
|---|---|---|
| 输入条底板 ×2 | `(186,415)` / `(320,415)` 各 134×29 | `Render_ChatBox_`（`HUD_Pass2.cpp:235`） |
| 输入文字 | `(191,422)` / 密语 `(376,422)` | `RenderInputText(191,422,0)` / `(376,422,1)` |
| 消息行 | `x = 196`，`y = 404 - 13*row` | `ChatLB_renderLine`：`x=self[11]+10`、`y=self[12]-13*v5-16` |
| 6 行 / 行高 13 | `obj[35]=6`、`obj[39]=13.0f` | `ChatListBox_Construct` |
| 聊天框基准点 | `obj[11]=186, obj[12]=420` | 同上（`sub_40C690(this,186,420)`） |

底板贴图是 `Dialogue1.ozj` / `Dialogue2.ozj`（贴图号 248/249），实测 **133×29**，
源码按 134×29 画（差 1px 拉伸），照抄。注意这两张图**只在打字时出现** ——
`Render_ChatBox_` 开头就是 `if (!(InputEnable || DAT_07e11d71)) return;`。

### 频道颜色：两张调色板，ABGR

`ChatLB_renderLine`（`UI/ChatListBox.cpp:1265`）里发送者和正文各一套，只有密语不同：

| channel | 含义 | 文字 | 背景 |
|---|---|---|---|
| 0 | chat | `#000000` | `#FFC832`（0x9632C8FF，59% 不透明） |
| 1 | system | `#6496FF` | 无 |
| 2 | GM / 密语 | `#FF1E00` | 无 |
| 3 | 普通聊天 | 发送者 `#EFDCCD` / 正文 `#C8DCE6` | 无 |
| 4 | 队伍 | `#000000` | `#00C8FF` |
| 5 | 战盟 | `#000000` | `#96FF00` |

`m_dwTextColor` 是 **ABGR**（`CharMenu_Build.cpp:217` 注明），所以
`0xFFFF9664` 拆开是 R=0x64 G=0x96 B=0xFF，不是橙色。

### 收包：0x00 的三种前缀

`ReceiveChat`（`Net/Net_LegacyRuntime.cpp:189`）：

```
C1 | size | 00 | name[10] | msg…          ← msg[0] 是前缀字节
'~' → 正文从 +1 开始，频道 4（队伍）
'@' → 正文从 +1 开始，频道 5（战盟）
'#' → 只画头顶气泡，不进日志
其他 → 正文从 msg[0] 开始（不减一），频道 3
```

**长度是可变的**：服务端 `header.set(0x00, sizeof(pMsg) - (sizeof(pMsg.message) - (size+1)))`
= `14 + strlen(msg)`，所以不能按 73 字节的定长结构判。这句在客户端源码里
踩过一次（`Net_Process.cpp:6974` 的注释），照抄了结论。

`0x0D` 是公告 `PMSG_NOTICE_SEND`：`header(3) + type(1) + message`，统一进频道 1。
实测进图就能看到服务端推的 `You have: 0 Resets | 0 Grand Resets`（浅蓝）。

### 输入

原版的消息行只有 6 行、最新在最下面，输入框在打字时才出现。所以：

- **Enter** 打开输入条（`InputEnable=1`），Esc 收起，发送后自动收起
- 输入用真实的 `<input>`，IME / 退格 / 选中全都免费；`main.ts` 里
  把 `typing` 的按键提前 `return`，否则一边打字一边 WASD 跑
- ↑/↓ 翻最近 20 条发送历史
- 焦点被画面抢走时自动收起（否则 `typing` 卡住，所有快捷键失效）
- 不做本地回显：服务端 `CGItemMoveRecv` 那条路径会把聊天广播回给自己，
  实测发 `hello from h5` 后收到 `1234: hello from h5`（1 个 0x00 包）

### 验证命令

```bash
node tools/chat-probe.mjs   # 5 个频道配色 + 6 行几何 + Enter 开输入条 + 真键盘发送
```

实测：

```
[196.1,404.2,114.3,13] Dave: guild meeting        fg=rgb(0,0,0)       bg=rgba(150,255,0,.78)
[196.1,391.2, 87.5,13] Carol: party up            fg=rgb(0,0,0)       bg=rgba(0,200,255,.59)
[196.1,378.1,113.2,13] Bob: whisper to you        fg=rgb(255,30,0)    bg=transparent
[196.1,365.1,197.5,13] Server notice: …           fg=rgb(100,150,255) bg=transparent
[196.1,352.1, 98.8,13] Alice: hello world         fg=rgb(200,220,230) bg=transparent

输入条: panels [(186,415) 134×29 nat 133×29] [(320,415) 134×29]
发送后: last = 1234: hello from h5（channel 3）
```

像素判据（隐藏前后对比）：消息区 2307 → 111，说明那 6 行字确实画在画面上，
不是「数据对、屏幕空」那种层叠问题。

`__MU_APP__` 新增：`chatLog()` / `openChat(text?)` / `closeChat()` /
`pushChat(name, text, channel?)`。


## GM 命令与补齐的三个报文（阶段 N）

`MuServer/Data/Command.txt` 里 37 条命令对**普通玩家（AL0）全部 Enable=1、Money=0、
无等级/重置限制、Delay=0、GameMaster=0** —— 也就是说全开。真正决定「能不能用」的是
客户端有没有接对应的回包。逐条实测（`node tools/command-probe.mjs`）后补了三块：

### 0xF3/0x14 单格物品更新（`GCItemModifySend`）

```
C1 09 F3 14 slot ItemInfo[4]
```

头是 **PSBMSG_HEAD（4 字节带 subhead）**，所以 9 字节。服务端「物品被改动」时
**只发这一条，不重发整张表**：`/make`、`/makeset`、追加等级、耐久变化全走它。
之前完全没接 —— 于是 `/make` 明明回 `Item created`，背包里却是空的（实测
`0xF3/0x10` 列表仍是 32 条）。

补上之后实测：`/make 14 0`（Apple）→ `c1 09 f3 14 23 c0 00 01 80`（slot 0x23、
type 0x1C0=448、dur 1），背包 34→35 件。

顺带发现「/make 有时成功有时没反应」的真因：**背包碎片不够**。这个号只剩 7 个空格，
1×2 的 Kris 放不进去（服务端 `InventoryInsertItem` 返回 0xFF，但提示照样打
`Item created`），1×1 的 Apple 就能进。

### 0x28 / 0x2A 物品消失与耐久

```
C1 05 28 slot flag     GCItemDeleteSend   /clearinv 逐格发这个
C1 05 2A slot dur flag GCItemDurSend      药水的 dur 就是堆叠数
```

`0x2A` 只对可堆叠（type ≥ 448）触发界面刷新 —— 装备耐久不掉界面，每帧重画图标没必要。

### 0x02 密语 / 金色公告（`PMSG_CHAT_WHISPER_SEND`）

`CommandPostType=0`（本服默认）时 `/post` 走的是 **0x02**，不是 0x00：
`C1|size|02|name[10]|message`。原版 `ReceiveWhisper`（IDA 0x4278F0）用**频道 0**
（黑字 + 浅蓝底），和 0x00 的普通聊天（频道 3）不是一个颜色。补上后实测
`/post h5 post test` → `[POST][SV1] h5 post test`。

### 各命令的实际状态

| 命令 | 状态 | 说明 |
|---|---|---|
| `/move` | ✅ | 0x1C + 0x12 重建视野；扣 1000 zen |
| `/post` `/global` | ✅ | 0x02 / 0x0D |
| `/str` `/agi` `/vit` `/ene` | ✅ | 0xF3/06 回执带四维 |
| `/addmoney` `/submoney` | ✅ | 0x22 result=0xFE 金币同步 |
| `/pkclear` `/onlines` | ✅ | 0x0D 提示 |
| `/drop` | ✅ | 0x20 地面物品 |
| `/make` `/makeset` | ✅ | 0xF3/0x14（本轮补） |
| `/clearinv` | ✅ | 0x28（本轮补） |
| `/re` | ✅ | 服务端开关，静默 |
| `/ware` | ⚠️ | 服务端改仓库号，但**没有仓库 UI**；且只在地图有仓库时可用 |
| `/reset` `/grandreset` | ⚠️ | 缺 **0xF3/0x05**（`PMSG_LEVEL_UP_SEND`：等级/剩余点数/上限），重置后 HUD 不会变 |
| `/evo` | ⚠️ | 缺职业刷新（ChangeUp），模型不会变 |
| `/fireworks` | ⚠️ | 收到 5 条 `0xF3/0x40`（type/x/y），客户端**没有烟花特效** |
| `/skin <名字> <Change>` | ⚠️ | 注释写的是 `<MonsterNumber>`，实际是**玩家名 + Change**；客户端不认 Change 字段 |
| `/makemob` | ⚠️ | 服务端加怪成功（`Monster created`），但**不发 0x13**，要等视野刷新（走两步）怪物才出现 |
| `/war` `/soccer` | ❌ | 依赖战盟系统（未做） |
| `/gmove` `/gmoveall` `/chase` `/bring` `/disconnect` | ❌ | 需要第二个玩家；别人被传送只能等视野重建 |

服务端条件（不是客户端问题）：`/reset` 要 ≥400 级、`/grandreset` 要重置数/金币达标、
`/ware` 只在地图有仓库时可用 —— 实测分别回 `Only characters over Level 400`、
`You cannot reset right now`、`You cannot change ware right now`。


## 角色装备穿脱外观（阶段 O）

以前 `createPlayer()` 是写死一套 `ArmorMale01/PantMale01/GloveMale01/BootMale01/HelmMale01`，
不管背包里穿什么，角色永远那个样子。这一阶段改成**按服务端穿戴槽实时搭模型**。

### 槽位 → 部件

原版 `RenderCharacter`（`Entity_UpdateRender.cpp:753` 的 body-part 循环）按槽位分别画：

| 槽位 | 部件 | 做法 | 依据 |
|---|---|---|---|
| 2 | 头盔 | `HelmMale##` 蒙皮 | 与 player.bmd 同名骨骼 |
| 3 | 铠甲 | `ArmorMale##` 蒙皮 | 同上 |
| 4 | 护腿 | `PantMale##` | 同上 |
| 5 | 护手 | `GloveMale##` | 同上 |
| 6 | 战靴 | `BootMale##` | 同上 |
| 0 | 武器 | `Sword/Axe/…` 挂**骨骼 33** | `Entity_Spawn.cpp:377` default 分支 Weapon[0]=33 |
| 1 | 盾 | `Shield##` 挂**骨骼 42** | 同上 Weapon[1]=42 |
| 7 | 翅膀 | `Wing##` 蒙皮 | 翅膀的 Bone01..08 与主角同名 |

模型的 type → 文件名换算就是 `items.ts` 里已有的 `itemModelPath()`（`model = type + 400`），
所以地面掉落和身上穿的用的是同一张表，不会出现「地上认得、身上不认得」。

**挂点不是写死骨骼号**：先按名字找，找不到才退回索引。

```
右手 knife_gdf        （Bip01 R Hand 的子骨，索引 33）
左手 hand_bofdgne01   （Bip01 L Hand 的子骨，索引 42）
```

实测 `player.bmd` 的骨骼表里这两个名字确实在 33 / 42，和源码的 default 分支一致。

### 手持模型怎么挂

武器/盾是**单骨静态模型**（`Sword01.bmd` 只有一根 `Box01`），原版 `RenderLinkObject`
是拿父模型的 LinkBone 矩阵直接画、忽略模型自己的骨骼变换。这里等价做法：

1. 用模型自己的 bind pose 取一次 `getBoneMatrices()`，把姿态烘进顶点（`createStaticMeshes`）
2. 建一个 Group 塞进手骨（identity）

实测挂载点与骨骼世界坐标偏差 `boneDist = 0`。

### 只换网格，不重建角色

`Actor.setMeshes()` 摘掉旧的蒙皮网格和手持节点、换新的，骨架 / 当前动作 / 朝向 / 位置
全部保留 —— 穿脱装备时角色不会「闪一下重来」。

触发点是 `syncInventoryViews()`：**背包一变就比对穿戴槽签名**（`equipSig`），
只有 0..7 槽真的变了才重建，捡一瓶药水不会白重算。重建用 `equipTask` 串行化，
连点穿脱不会交叉删网格。

### player.bmd 只有骨架，全裸就是不可见

`player.bmd` 解出来 `meshes=0 / bones=60 / actions=141` —— 它只提供骨架和动作，
**身体几何全在装备 BMD 里**（客户端源码注释原话：*Player.bmd is skeleton-only
(numMesh=0); body geometry lives in separate BMD models*）。所以把装备全脱掉时
角色是不可见的，这一点和原版一致，不是 bug。

### 验证

```bash
node tools/equip-visual-probe.mjs
```

实测输出：

```
① 进图（真实背包）  wear=["0:33"]  held=[{held:33, bone:knife_gdf, meshes:1, boneDist:0}]
② 全套 + 剑 + 盾    parts=[HelmMale01, ArmorMale01, PantMale01, GloveMale01, BootMale01]
                    meshes=10  held=[{held:0, bone:knife_gdf}, {held:192, bone:hand_bofdgne01}]
③ 全脱              parts=[]  meshes=0  held=[]
④ 像素差分（穿装 vs 裸）  changed=3595 / 594520
⑤ 换第 9 阶 + 翅膀   parts=[…09.bmd, Wing01.bmd]  meshes=15
⑥ mock 背包变化      wear=[0:1, 2:224, 3:256, 4:288] → 重建出 3 件身体 + 手持剑
```

第 ④ 步是关键：只断言「节点存在」不够（之前吃过「数据对、画面空」的亏），
所以直接比同一屏的像素差 —— 3595 个像素不一样，说明装备真的画上去了。

`__MU_APP__` 新增：`playerActor()`（返回 Actor，探针在页面里直接量网格/骨骼）、
`previewEquip(equip)`（只改外观不动背包，验证模型映射用）。

### 还没做

- ~~翅膀的扇动动画~~ → [阶段 R](#翅膀重建与安全区姿势阶段-r) 已改成独立骨架 + 自己的扇动动作
- 别人的装备：`0x13` 视野包里带装备字段，但远程玩家目前只按 Class 建基础模型

（安全区把武器挂背上已在[阶段 P](#安全区背挂与武器动作阶段-p)完成。）


## 安全区背挂与武器动作（阶段 P）

用户报的问题：「场景中没显示人物」。追下去发现是三件事叠在一起：

1. `player.bmd` 只有骨架（阶段 O 已查明），**空槽必须退回职业默认身体**，否则全裸即隐形；
2. 安全区里武器该挂在背上（`RenderCharacterBackItem` → LinkBone 47），之前一律握手里；
3. 不同武器的待机/走跑/攻击动作号完全不同，之前写死 1 / 13 / 34。

### 空槽退职业默认身体

`BodyPart[1..5]` 在原版是 `CreateHero`（`Entity_Init.cpp:20-80`）填的：

```
BodyPart[1..5] = (Class & 7) + 0x390 / 0x397 / 0x39e / 0x3a5 / 0x3ac
```

`0x390` 起连续 5 段就是 `HelmClass## / ArmorClass## / PantClass## / GloveClass## / BootClass##`
（`Model_Items.cpp:212-220` 的 `AccessModel(i+0x38f, "Data\\Player\\", "HelmClass", i)`）。

所以 `applyEquipment` 现在对每个空槽都填默认模型，编号 `(cls & 7) + 1`，
扩展职业退到 `*Class201..203`，再找不到就退 `01` —— **宁可穿错一代，也比隐形强**。

### 安全区 → 背上（Bone05 / 骨骼 47）

`Render_PlayerEquipment.cpp:599-730`：

```c
IsBackItem(type)  = type >= 400 && type <= 623
bind 条件         = SafeZone || 动作 93..124 || (World == 7 && 游泳)
挂点              = *(BYTE*)(c+0x2A4) = 47
```

H5 这边用 `TerrainWall[idx] & 1`（`TW_SAFEZONE`）判安全区，
主循环每帧比对 `isSafeZoneAt()`，**只有进出安全区那一刻**才重建手持节点，不是每帧重挂。

挂点先按名字找再退索引：`knife_gdf`(33, 右手) / `hand_bofdgne01`(42, 左手) / `Bone05`(47, 背)。

#### pose 直接照抄源码，不再自己凑基变换

`RenderLinkObject(0, 0, 15, …)` 里那三个 `0, 0, 15` **只在 `Link=0` 的非链接分支
里被用到**（`RenderLinkObject.cpp` 全文只有那 3 行读 `param_1/2/3`）。
安全区背挂传的是 `Link=1`，走 linked path，位置和朝向**全部**来自 pose 表：

| 情况 | 欧拉角（度） | 平移列（游戏单位；/100 = 格） |
|---|---|---|
| 通用武器（默认走这条） | `(70, 0, 90)` | `(-20, 5, 40)` |
| 弓（模型号 `0x218..0x21e` / `0x220` / `0x222`） | `(0, 20, 180)` | `(-10, 8, 40)` |
| 第二件（`g_BackItemHand != 0`） | `(-110, 180, 90)` | `(20, 15, 40)` |
| 盾（模型号 592..623，多数分支） | `(70, 0, 90)` | `(-10, 10, 0)` |

`Matrix_BuildFromEuler` 的展开式与 **`R = Rz(z)·Ry(y)·Rx(x)`** 逐项一致，
`eulerMatrix()` 就照这个写；平移列是「先转再加」，所以 `group.position` 直接取它。

> 弓的独立角度、以及 `598/605/606/607/608` 这几个特殊盾表还没接 —— 它们按
> **模型号**分支，而我们现在手里只有 item type（`Shield01.bmd` 之类要反查模型号）。
> 目前弓和普通盾都落「通用武器 / 其余盾」这两条，观感正常。

早先这里是自己凑的 `makeBasis` + `tilt = 0.42` 基变换，效果是「刀尖朝上」，
再靠翻转硬掰。翻转时又用 `Box3.expandByObject` 求中心 —— 那取的是**骨骼空间**
的 AABB，却被当成 group 局部坐标去补 `(0, 2cy, 2cz)`，等于每件武器被推走
`2 × 中心`：短剑顶到头顶、长矛扎进地里。**这就是「有的武器显示偏高」的根因。**

#### 模型 +Y 是握把端，各家美术的刀身方向不一样

同一套 pose 挂出来，斧/锤/杖/弓/矛 是「柄在上、梢头朝下」，**剑类恰好相反**：

| | 模型局部包围盒 y | +Y 指向 | 挂上去的原始效果 |
|---|---|---|---|
| 剑（type 0..31） | `[-0.65 .. 0.10]` | 握把端 | 柄在上、**尖已朝下** ✓ |
| 斧/锤/杖/弓/矛 | `[-0.13 .. 1.02]`（短剑）等 | 梢头 | 柄在上、**头朝下** ✗ 要翻 |

`equip-visual-probe` 的 `tipZ` 取 `(0, 1, 0)`（= 握把端）的世界 z 分量：
剑 `+0.94`（柄朝上 = 尖朝下）、矛 `-0.94`（柄朝下 = 梢头朝上）、盾 `+0.93`。

#### 翻转：只翻非剑类，绕模型中心，位置一点不动

`BACK_FLIP.keep = new Set([0])` —— item type `/ 32` 后的**剑组不翻**，
其余武器翻 180°，盾牌走单独的 `false` 分支。判定集中在 `backFlipOf(type)`：

```ts
export function backFlipOf(type: number): boolean {
  return BACK_FLIP.weapon && !BACK_FLIP.keep.has(Math.floor(type / 32));
}
```

翻转本身（`flipInPlace`）关键是**绕模型自身中心**转，而且中心必须用
**group 局部**坐标算：

```ts
const toLocal = group.matrixWorld.clone().invert();
group.traverse(o => { /* Box3.union(geometry.boundingBox × (toLocal × o.matrixWorld)) */ });
// R = diag(1, -1, -1) ⇒ t = (0, 2cy, 2cz)
```

这样模型占据的空间范围**逐位不变**，只换头尾。实测短剑翻转前后都是
`离脚 0.55..1.74`、x 范围也完全一样 —— 所以「翻 180°」和「显示偏高」是
两件独立的事，翻不会挪位置。盾牌**不翻**：翻了就是看到内衬和绑带，
盾面必须朝外。

原版对**所有**武器类型用的是同一套固定 pose（`RenderLinkObject` 里
`Angle(70,0,90) / trans(-20,5,40)`，第二件才切到 `(-110,180,90)`），
但美术基准不一致，所以这里按类补一次 180°：斧/锤/杖/弓/矛 的头朝上、
剑类保持柄上尖下，两者都和手握时的朝向对得上。

### 三张动作表（`src/world/playerAnim.ts`）

照抄 `SetPlayerStop`（`SecondPassword.cpp:1906`）、`SetPlayerWalk`（:2070）、
`SetPlayerAttack`（`Scene_CharSelect_Nav.cpp:1617`）。三张表都按**模型号**（type + 400）分支：

| 武器 | 待机 | 走跑 | 攻击 |
|---|---|---|---|
| 空手 | 1（精灵 2） | 13（精灵 14） | 34 |
| 单手剑 | 3 | 15 | 35/36 轮转 |
| 双手剑 | 4 | 16 | 39/40/41 三连 |
| 双持剑 | 3 | 15 | 35/37/36/38 四连 |
| 431 特殊双手剑 | 4 | 79 | 81 |
| 锤/杖 496..527 | 5 | 17 | 42 |
| 长柄 560..591 | 双手 6 / 单手 3 | 双手 18 / 单手 15 | 双手 84/85 / 单手 35/36 |
| 弓 528..534 | 7 | 19 | 46（带翅膀 48） |
| 弩 536..546 | 8 | 20 | 47（带翅膀 49） |
| 翅膀飞行 | 9（拿弓弩 10） | 30（拿弩 31） | — |

「双手」标记不在模型号里，要读 `item.bmd` 的 `twoHand` 字节，
所以启动时 `warmPlayerAnimTables()` 先把物品表拉进内存。

连击计数对应原版的 `c+771`（每次出手 +1），用它轮换多段攻击。
动作号不只影响本地播放 —— **它还会随 0x15 包发给服务端**，别人看到的就是这个号。

### 翅膀 → 浮空

`c+0x2A0`(672) 的判定是 `Wing.Type != 0xFFFF && !SafeZone`：
出了安全区才算「飞」，这时待机 9 / 走跑 30，角色整体抬高，脚离地。

### 验证

```bash
node tools/equip-visual-probe.mjs offline    # 不连服务端也能跑
node tools/equip-visual-probe.mjs            # 连服务端，登录失败会自动退离线
```

九步全部用 `waitFor` 等「可观测结果」而不是等固定时长 —— 换装是异步重建网格，
按时间采样很容易截到中间态（早先就截到过「头盔还是 `HelmClass01`」的半成品）。

```
① 进图（空背包，安全区）
   parts=[HelmClass01..BootClass01] meshes=5 held=[] anim{idle:1,move:13,attack:34} foot=1.76
② 安全区穿全套
   parts=[HelmMale01..BootMale01] meshes=10
   held=[held:0@back→Bone05, held:192@back→Bone05]
③ 出城（170,170）
   held=[held:0@right→knife_gdf, held:192@left→hand_bofdgne01]
④ 回城（133,133）  → 又回到 Bone05
⑤ 全裸  parts=[HelmClass01..] meshes=5 held=[]   像素差分 162927/283500 有变化
⑥ 出城 + 翅膀  parts=[…, Wing01.bmd] anim{idle:9, move:30, flying:true}
   浮空高度：裸站脚 z=1.76 → 装翅膀脚 z=2.41
⑦ item.bmd 武器代表型号
   {sword:1h:0, sword:2h:9, staff:2h:96, staff:1h:107, bow:2h:128, crossbow:2h:136, spear:2h:161}
⑧ 攻击动作表（安全区外）
   空手 1/13/34 · 单手剑 3/15/35 · 双手剑 4/16/39 · 长柄 6/18/84
   锤杖 3/20/43 · 弓 7/19/46 · 弩 8/20/47 · 弓+翅膀 10/30/48
⑨ 双手剑(9) 三连 attack action = [39,40,41]
```

⑦⑧ 的型号不是猜的：`weaponInfo(type)` 会告诉探针「这个 type 属于哪类、是不是双手」，
探针再拿真实型号去跑动作表，避免出现「测的武器其实不在这张表里」的假绿。

截图取景也不用固定比例：早先按 `#stage` 宽度算裁剪框，瞬移后相机会晚几帧才追上，
裁出来常常是一块空地。现在用 `__MU_DEBUG__.project()` 把身体投到屏幕上再框，
并且等投影坐标连稳 4 次才拍。

### 还没做

- ~~翅膀的扇动动画~~ → [阶段 R](#翅膀重建与安全区姿势阶段-r)：独立骨架、自己的 7 帧扇动、
  JPG 翅膀走加色去黑底、TGA 翅膀走 alpha
- 远程玩家的装备（`0x13` 视野包带装备字段，但远端 Actor 仍只按 Class 建基础模型）


## 离线演示的角色 / 装备面板（阶段 Q）

离线演示没有服务端，背包永远是空的，穿什么、是什么职业都没法验证。
这一阶段在画面右上角加了一块面板（视觉参考图：深蓝卡片 + 青色描边下拉框）：

```
┌ CHARACTER ─────────────┐
│  Class  [ Dark Wizard ]│
└────────────────────────┘
┌ EQUIPMENT ─────────────┐
│  Helm       [ Bronze Helm ]  │
│  Armor      …   Pants …      │
│  Gloves     …   Boots …      │
│  Left Hand  …   Right Hand … │
│  Wings      …                │
└──────────────────────────────┘
```

**顺序、文案、样式**都照参考图：先 5 件防具，再左右手，最后翅膀；标签在框上方，
标题大写 + 宽字距。按 **P** 或点卡片标题可以收起。面板只在「离线演示 + 已进图」时出现，
登录 / 选角 / 读条时 `showScreens()` 会把它收起来。

### 数据全部来自 `Data/Local/item.bmd`

不是写死的清单。`src/data/equipCatalog.ts` 直接读那张表（`localText.ts` 已有解码）：

| 字段 | 偏移 | 用途 |
|---|---|---|
| `Name[30]` | +0 | 下拉框里显示的名字（原版英文名，不翻译） |
| `TwoHand` | +30 | 双手标记，动作表要用 |
| `RequireLevel` | +49 | 需求等级（进 tooltip 用） |
| `RequireDW/DK/ELF/MG` | +56..59 | **0 = 该职业不能穿，1 = 能穿，2 = 二转专属** |

item.bmd 里没有「部位」字段 —— **部位就是物品编号的分组**（和服务端 `CItem::m_Index` 同一套编号）：

```
type = group * 32 + index
  0..5   武器（剑/斧/锤/矛/弓/法杖）  → 右手
  6      盾                          → 左手
  7..11  盔/甲/腿/手/靴              → 槽 2..6
  12     0..6 翅膀（7 以后是技能球）
```

职业过滤直接读 item.bmd 的四个标志位：`RequireXxx > 0` 才进下拉框。
所以「黑暗巫师选不到 Bronze Helm（那是骑士的）」「魔剑士没有头盔」都是表里写死的，
不是我们判断的。

### 只有真能画出来的才进菜单

光有名字不够 —— 0.97 的男防具只有 `01..10` 和 `16/17`，精灵防具只有 `01..05`，
超出的编号客户端根本没加载（`Model_Items.cpp:246-262`）。所以目录最后一步会 `HEAD`
一下 `/Data/.../Xxx.bmd`，不存在的直接剔掉，避免「选了但画面没反应」。

两个坑：

1. **不能只看 `res.ok`**：vite 带 SPA 回退，路径不存在时也回 200 + index.html。
   真正的 bmd 响应没有 `text/html`，得靠 content-type 区分。
2. **大小写**：资源里同时有 `Shield15.bmd` 和 `shield16.bmd`，
   Windows 的 `existsSync` 不区分大小写，但 HTTP 请求区分 —— 所以探针里另写了一个
   逐段精确比对的 `existsExact()`，否则会出现「探针说有、页面里没有」。

### 精灵的防具编号是压缩过的

item.bmd 里精灵五套在 index 10..14（Vine/Silk/Wind/Spirit/Guardian），
而文件是 `HelmElf01..05` —— 所以文件号 = `index - 9`，不是 `index + 1`。

不压缩的话 `Vine Helm`(234) 会算成 `HelmElf11`，那文件不存在，精灵会一件都穿不上
（除了职业默认身体）。顺带：后续版本补的 `Divine`（index 19）→ 10 → 也不存在，一并被滤掉。

`items.ts` 里因此多了 `bodyFileIndex()` 和 `BodyGender`：`itemModelPath(type, body)`
按穿戴者拼 `HelmMale##` / `HelmElf##`，`applyEquipment` 按 `cls === 2 → Elf` 传进去。

### 和真实背包的关系

`currentEquip()` 有两个来源，**沙盘优先**：

```ts
if (sandbox.on) return { ...sandbox.slots, cls: sandbox.cls, safeZone };
```

- 离线进图 → `sandbox.on = true`，面板接管；
- 联机选角 → `sandbox.on = false`，只看服务端下发的穿戴槽；
- 调 `__MU_APP__.mockInventory()`（探针用）时也会把沙盘关掉 ——
  两个都是「外观覆盖层」，后调用的说了算，否则假背包会被沙盘盖住。

换职业不需要重建 Actor：`applyEquipment` 本来就会按 `cls` 重挑默认身体
（`*Class##`）和体型前缀，`Actor.setMeshes()` 只换网格、骨架和动作都留着。

### 验证

```bash
node tools/sandbox-probe.mjs
```

46 条断言全绿。核心那条不是「数量差不多」，而是**逐个名字比对**：
探针自己独立解一遍 item.bmd（不复用 `src/`），按同样规则算出「这个职业这个部位应该有
哪些装备」，再和页面 DOM 里 `<option>` 的文字排序后逐条对齐。

```
✓ 两张卡片  ["Character","Equipment"]
✓ 字段与参考图一致  ["Class","Helm","Armor","Pants","Gloves","Boots","Left Hand","Right Hand","Wings"]
✓ Dark Wizard / Helm（5 项）与 item.bmd 一致
✓ Dark Knight / Right Hand（46 项）与 item.bmd 一致
✓ Fairy Elf / Armor（5 项）与 item.bmd 一致
✓ Magic Gladiator / Helm（0 项）与 item.bmd 一致    ← 魔剑士确实没有头盔
✓ 魔剑士用 *Class04 身体 / 精灵用 *Class03 身体
✓ 精灵戴 Vine Helm → HelmElf01
✓ 装备全部换成 Male 系模型   手持: held:3@back@Bone05, held:194@back@Bone05
✓ 清空后回职业默认身体
```

截图：`shots/sandbox-panel.png`（面板本体）、`shots/sandbox-player.png`（面板 + 穿好的一身）。

### 还没做

- 面板只改外观，不改服务端状态 —— 联机时想要真穿脱还得走背包拖拽那条路（这台服务端会拒 0x24）
- 没有等级/力量/敏捷的需求校验（当前只看职业 + 模型是否存在），做「能不能穿」还需要角色属性


## 翅膀重建与安全区姿势（阶段 R）

两个问题一起修：**翅膀的网格/纹理是错的**，**安全区背着武器却做持剑姿势**。

### 一、翅膀为什么「网格和纹理都不对」

原来翅膀是当成**主角骨架的蒙皮**处理的：

```ts
if (equip.wing !== undefined) {
  const wing = await loadItemBmd(equip.wing);
  if (wing) await buildSkinnedPart(actor, wing, skinned);   // ← 错在这里
}
```

`buildSkinnedPart` 走 `createBoneRemap`，按**骨骼名**把翅膀的骨骼映射到主角骨架。
问题在于两套骨架只是**同名**，不是同一套绑定姿势：

| | 主角 player.bmd | Wing01.bmd |
|---|---|---|
| `Bone01..Bone09` | 43..51，挂在 `Bip01 Spine` 上的脊椎/披风链 | 1..9，翅膀自己的翼骨链 |
| `Bip01` 根骨 | z ≈ 100（腰高） | 没有，翼根就在原点 |
| 顶点 | 每顶点相对所属骨骼（bone-local） | 同样 bone-local，但骨骼位置差一个量级 |

顶点是 bone-local 的，蒙皮时又乘上主角骨骼的 `matrixWorld`，等于**被两套姿势各变换一次**，
翼面直接被撕成几片 —— 画面里就是几块黑色三角，纹理自然也对不上。

正确做法来自原版 `RenderLinkObject` 的 `Link=1` 分支（`RenderLinkObject.cpp:300-360`）：

```c
BMD_Animation(wingModel, ownBoneTransform, ...)   // 翅膀用自己的骨架 + 自己的 action
R_ConcatTransforms(parentBoneMatrix, angleMatrix, ParentMatrix)  // 整体再挂到背骨
```

也就是 **翅膀是一个独立 PART**：自己的骨架、自己的动作，只借背骨的矩阵定位。
muonlinejs 里是同一个做法（`playerObject.ts:76-78`）：

```ts
this.Wings.LinkParent = false;      // 不并入主角骨架
this.Wings.ParentBoneLink = 47;     // 只挂到骨骼 47
this.Wings.SkipBoundingBox = true;
```

H5 这版落成 `buildWing()`：

```ts
const rig = createRig(bmd, MODEL_SCALE);              // 翅膀自己的骨架
const identity = (n: number) => n;                    // 索引原样映射，不跨骨架
createSkinnedMesh(bmd, mesh, rig, identity, tex, true);
root.add(rig.root);                                   // 根节点挂 Bone05
actor.setWing({ root, rig, action: 0, frame: 0, speed });
```

`Actor.tickWing()` 每帧推进翅膀自己的 action 0（就是**扇动**），
待机 0.3 / 走跑 0.9（MU 语义：每帧前进量 × 25fps；7 帧 ≈ 0.83s 一次待机扇动）。

挂点仍然是骨骼 47（`Bone05`，`Bip01 Spine` 子骨），局部轴和背挂武器一致：
**+Z 朝上、+Y 朝背后、+X 朝体侧**。`WING_POSE` 里只放三个可调值（偏移 + 前倾角），
一开始把 `offset` 写成 `[0, 0.06, -0.34]`，实测翅膀整个掉到腰上 —— 因为 `+Z` 才是「上」，
`-0.34` 等于往下压 34cm。当时改成 `[0, 0.12, 0.02]`（只解决「别再往下压」），
翼根其实还在腰上，最终值是 `[-0.06, 0.12, 0.3]` —— 见
[阶段 T](#翼根抬到肩部阶段-t)。

### 二、纹理：JPG 翅膀要「去黑底」，TGA 翅膀走 alpha

四种翅膀的纹理格式不同，不能一套材质打天下：

| 模型 | 纹理 | 格式 | 处理 |
|---|---|---|---|
| Wing01 精灵 | `elfin_wing.OZJ` | JPEG，**无 alpha**，黑底 | 加色混合（黑=不加色，自然消失） |
| Wing02 天使 | `angel_wing.OZT` | 32 位 TGA，alpha 真值（0/255+渐变） | 普通 alpha 混合，`alphaTest 0.02` |
| Wing03 恶魔 | `devil_wing.OZT` | 同上 | 同上 |
| Wing04 精灵 2 | `NewingEl.OZJ` | JPEG，黑底 | 加色混合 |

两条都要求 `side: DoubleSide` —— 翼面是单层三角带，背面被剔除的话整对翅膀就没了；
`depthWrite: false`，让半透明翼面互相叠加时不出硬边。

`WING_BLEND.jpg` 还留了一个 `lum` 选项（用亮度当 alpha，走普通混合）。
实测精灵翅膀的纹理本来就偏暗，`lum` 会把整对翅膀压成一层灰雾，所以默认用 `add`。

翅膀纹理本身没坏，解码路径和身体贴图完全一致（OZJ 跳 24 字节头、OZT 跳 4 字节头）：

```
elfin_wing.OZJ jpg 64x64   angel_wing.OZT tga 128x128 bpp=32
devil_wing.OZT tga 128x128  NewingEl.OZJ    jpg 128x128
```

### 三、安全区里姿势要跟着「手是不是空的」

`SetPlayerStop` / `SetPlayerWalk` / `SetPlayerAttack` 三张表只看 `c+0x270`（手上的武器），
而安全区里 `RenderCharacterBackItem` 已经把武器挪到背上（骨骼 47）了 ——
原版是靠 `c->SafeZone` 在动作选择外面兜住的，之前的移植没兜，于是出现
**剑背在背上、人却在做持剑待机**。

现在 `playerAnim.ts` 加了一层 `handEmpty(input)`：

```ts
function handEmpty(input: AnimInput): boolean {
  return input.safeZone === true;    // 安全区 = 手上没东西
}
```

三个动作函数入口都先判它，命中就走空手分支（精灵是 2/14）：

| 场景 | 待机 | 走跑 | 攻击 |
|---|---|---|---|
| 安全区（剑+盾在背上） | 1 | 13 | 34 |
| 野外（剑在手） | 3 | 15 | 35 |

同一个角色、同一把剑，**进出城门只改挂点不改模型**，姿势随之切换；非安全区那张表没动。

### 验证

```bash
node tools/equip-visual-probe.mjs offline
```

```
② 安全区穿全套
   held=[held:0@back→Bone05, held:192@back→Bone05]
   姿势（安全区，武器在背上）: 待机 1 走跑 13 攻击 34 ✓ 空手姿势
③ 出城（170,170）
   held=[held:0@right→knife_gdf, held:192@left→hand_bofdgne01]
   姿势（野外，剑在手）: 待机 3 走跑 15 攻击 35 ✓ 持剑姿势
⑥ 出城 + 翅膀
   翅膀: 挂 Bone05  骨架 11 根 / 扇动 7 帧  混合 add
   包围盒 {min:[-0.84,0.05,0.91], max:[0.99,0.96,2.21]}
   扇动帧 1 → 1.772 ✓ 在扇
   浮空高度: 裸站脚 z=1.76 → 装翅膀脚 z=2.56
```

「翅膀对不对」不能只靠「节点在」—— 所以断言了四件事：
**挂在 `Bone05`**、**骨架是翅膀自己的（11 根，不是主角的 60 根）**、
**扇动帧自己在走**、**相对角色的包围盒**（宽 ≈ 1.8m、高 0.9→2.2m，
被压成一条线或者飘到头顶都会立刻露出来）。

截图：`shots/equip-safezone.png`（背着剑、空手站姿）、`shots/equip-wing.png`（精灵翅膀浮空）、
`shots/fin-385-back2.png`（天使翅膀）。

### 还没做

- 翅膀在「进图那一刻」不会立刻扇，第一帧是 bind pose（差一帧，肉眼看不出来）
- 远程玩家的装备仍然只按 Class 建基础模型（`0x13` 包里带装备字段，还没接）


## 翅膀朝向校正（阶段 S）

用户报：**Wings of Heaven（天使）和 Wings of Satan（恶魔）上下颠倒了**。

### 为什么只有这两种倒着

MU 的翅膀不是同一套美术基准建的。把四种翅膀的骨骼数据摊开看：

| | 骨骼链 | 链首→链尾的局部 z 分量 | 挂到背骨 47 后 |
|---|---|---|---|
| Wing01 精灵 | `Line01/Bone01..09` | Bone03 z = **+25.6** | 翼骨自带仰角，向上展开 |
| Wing02 天使 | `Bone01..09` | z = **0**（纯水平） | 翼膜往 −Z 垂 → 翼尖朝下 |
| Wing03 恶魔 | `Bone01..09` | z = **0**（纯水平） | 同上 |
| Wing04 精灵二阶 | `Box01/Box97..112` | z ≈ −0.04（微倾） | 横向大翼面，可接受 |

也就是说天使 / 恶魔的翼骨链**在模型里就是平的**，翼膜挂在骨骼下方；
精灵那两对的翼骨已经带了仰角。同一套 `WING_POSE` 打天下，前两种就倒挂着。

原版靠 `RenderLinkObject` 里每个 type 一组 `AngleMatrix` 角度兜住，这里同样按模型号补偿：

```ts
/** Wing02 = Wings of Heaven，Wing03 = Wings of Satan */
export const WING_FLIP = new Set([2, 3]);
```

`applyWingPose()` 把它折算进 `rx`：

```ts
w.root.rotation.set(WING_POSE.rx + (w.flip ? Math.PI : 0), WING_POSE.ry, WING_POSE.rz);
```

翻转轴选的是**左右轴（rx）**，不是前后轴。实测绕前后轴（rz = π）只是左右互换、
翼尖照样垂着；只有 rx 加 π 才能把「下」变成「上」。

> 另一个坑：`actor.wing()` 里的包围盒是用 `player.root.matrixWorld` 的逆把世界坐标
> 折回角色局部坐标的。瞬移 / 换装之后渲染器可能还没跑这一帧，逆矩阵还是旧的，
> 量出来就是一堆绝对坐标（`min:[187.37,…]`）。现在量之前先 `updateMatrixWorld(true)`。

### 验证

```bash
node tools/wing-probe.mjs offline     # 四种翅膀逐个过
```

33 条断言全绿。每个翅膀查六件事：**挂 Bone05**、**翻转标志与模型号一致**、
**骨架是它自己的（11/16/20 根，不是主角 60 根）**、**纹理混合**（JPG 加色 / TGA alpha）、
**翼展 > 1.2 m 且顶到 1.6 m 以上**（缩在腰下就是倒挂着）、**扇动帧自己在走**，
最后再查出城飞行（待机 9/10）和回安全区落地（待机 1/2）。

```
— 385 Wings of Heaven —
✓ 挂 Bone05   ✓ 用翻转姿态   ✓ 骨架 16 根   ✓ 混合 alpha
✓ 翼展 > 1.2 m   ✓ 顶到 1.6 m 以上   ✓ 自己在扇（帧 3.05 → 5.30）   ✓ 出城飞行
— 386 Wings of Satan —
✓ 用翻转姿态   ✓ 混合 alpha   ✓ 自己在扇（帧 1.58 → 3.08）   ✓ 出城飞行
— 384 / 387 —
✓ 用原始姿态（没被翻坏）
```

`equip-visual-probe` 的 ⑥ 顺手补了一个等待条件：原来只等「算出来的飞行动作是 9」，
可主循环还没真正切动作，量到的还是地面待机的脚高（1.76 而不是 2.54）。
现在等 `playerActor().action === 9`，浮空高度和扇动帧才稳定。

截图：`shots/wingfix-385.png`（天使上扬）、`shots/wingfix-386.png`（恶魔蝠翼上扬）、
`shots/wingfix-384.png` / `shots/wingfix-387.png`（精灵两对，未动）。

### 还没做

- 384 / 387 的翼面仍偏横向（原版精灵翼本来也偏横向），如果也要上扬，走同一张 `WING_FLIP` 表即可
- 远程玩家的装备仍然只按 Class 建基础模型（`0x13` 包里带装备字段，还没接）


## 翼根抬到肩部（阶段 T）

用户报：**翅膀根部应该在肩部，实际都挂在腰上**。

### 为什么一定落在腰上

翅膀 BMD 是照**角色原点**建的：翼骨链第一根 `Bone01` 就在 `(0,0,0)`，翼展铺在
X-Z 平面上。所以「挂到哪个骨骼」= 「翼根落在那个骨骼的原点高度」，跟模型怎么画没关系。

而挂点骨骼 47（`Bone05`，`Bip01 Spine` 的子骨）本来就在腰背：

```
Bip01 Pelvis    z = 1.07   ← 站立时
Bone05 (47)     z = 1.32   ← 挂点，腰
Bip01 Spine1    z = 1.64
Bip01 Clavicle  z = 1.56 … 1.90（左右肩）
Bip01 Head      z = 1.85 … 2.25
```

（同一套骨架在不同动作下高度差很大 —— 安全区站姿是半蹲，出城飞行姿态腿伸直，
所以肩线从 1.56 m 一直到 1.90 m。**对照时得拿同一帧的肩线**，不能写死一个绝对值。）

原版是把 `Entity_Spawn.cpp` 里写死的 `BoneOffset(-60)` 叠上去的，等价于一个固定抬升。
之前 `WING_POSE.offset` 只写了 `z = 0.02`，等于没抬 —— 翼根 1.32 m，正好卡在腰上。

### 抬多少

`Bone05` 的局部轴在角色空间里不是纯竖直的：

```
+Z ≈ (0.22, -0.07, 0.97)      ← 朝上，但带 13° 体侧倾斜
+Y ≈ (0.54, -0.82, -0.18)     ← 身后
+X ≈ (-0.81, -0.57, 0.14)     ← 体侧
```

所以「沿 +Z 抬 0.28 m」实际是上抬 `0.28 × 0.97 ≈ 0.27 m`，同时往 +X 甩 `0.28 × 0.22 ≈ 0.06 m`。
两笔都补上，就是最终值：

```ts
export const WING_POSE = {
  /** 骨骼局部：+Z 朝上、+Y 朝背后、+X 朝体侧（和背挂武器同一套轴） */
  offset: [-0.06, 0.12, 0.3],   // 0.12 是推离体表，0.3 抬到肩，-0.06 抵掉体侧倾斜
  rx: -0.15, ry: 0, rz: 0,
};
```

### 四种姿态实测

| 姿态 | 动作 | 肩线 | 翼根（旧 `z=0.02`） | 翼根（`z=0.3`） |
|---|---|---|---|---|
| 安全区站 | 1 | 1.562 | ≈ 1.32（腰） | **1.586** |
| 安全区走 | 13 | 1.526 | ≈ 1.29 | **1.556** |
| 出城飞停 | 9 | 1.821 | ≈ 1.50 | **1.769** |
| 出城飞走 | 30 | 1.821 | ≈ 1.65 | **1.919** |

四种翅膀（384/385/386/387）都在同一帧里测过，翼根和肩线的差稳定在 −0.05 … +0.10 m
—— 因为偏移挂在骨头上，肩线自己怎么浮动，翼根就跟着浮动。

### 验证

`wing-probe` 新增 3 类断言（4 种翅膀 × 2 + 安全区 1 = 9 条，33 → 42 条）：

```
✓ Wings of Elf 翼根在肩部（肩 1.894 m，翼根 1.849 m）
✓ Wings of Elf 翼根明显高于脊柱底 1.444 m          ← 防「又掉回腰」
✓ 安全区站立时翼根仍在肩部（肩 1.562 m，翼根 1.586 m）
全部通过：✓ 42 / ✗ 0
```

翼根数据来自 `__MU_DEBUG__.wing().rootWorld`（挂点折回角色局部坐标）与
`jointZ`（同一帧的 Spine / Spine1 / 左右 Clavicle / Head 高度），
断言是「翼根贴肩线 ±0.15 m」+「比脊柱底高 0.25 m 以上」，不写死绝对高度。

截图：`shots/jk-384/385/386/387-safe.png`（安全区站）、`shots/jk-*-.png`（出城浮空）。

### 还没做

- 远程玩家的翅膀/装备仍未接（同阶段 R / S）



## 技能菜单与特效层（阶段 U）

在沙盘面板下面加了第三张卡片：**SKILL**（技能下拉 + Cast），并在洛兰
`(186,129)` 固定刷一只靶子怪，点一下就能看到技能特效打在身上。

### 一、技能数据从哪来：`Data/Local/chs/skill.bmd`

和 `item.bmd` 同一套加密（密钥 `{FC,CF,AB}`，**每条记录各自从 key[0] 重置**），
64 条 × 40 B + 末尾 4 B：

```
char Name[32]     技能名
BYTE RequireLevel 需求等级
BYTE Damage       伤害百分比
WORD ManaUse      耗蓝
WORD BPUse        耗 BP
BYTE Range        射程（格）
BYTE RequireEnergy 需求智力
```

两份文件都是 2564 B、64 槽，差别只在名字编码：

| 文件 | 名字 | 名字编码 |
|---|---|---|
| `Data/Local/skill.bmd` | `Poison` / `Fire Ball` | ASCII |
| `Data/Local/chs/skill.bmd` | `毒咒` / `火球` | GBK |

面板优先读 chs（`TextDecoder('gbk')`，纯 ASCII 时直接转，拿不到再退回英文版）。
中文包里不少名字尾巴挂着技能号（`火龙-5`、`霹雳回旋斩-41`），那是打包工具的
补丁标记，显示前用 `/-\d+$/` 掐掉。

**64 个槽位里 45 个有名字，最大编号 56**（天雷闪）。空槽是
0 / 25 / 29 / 37..40 / 44..46 / 53 / 54 / 57..63：

```
 1 毒咒     2 陨石     3 掌心雷   4 火球    5 火龙    6 瞬间移动  7 冰封
 8 龙卷风   9 黑龙波  10 地狱火  11 真空波 12 极光   13 爆炎    14 毁灭烈焰
15 小挪移  16 守护之魂 17 能量球 18 圣盾防御 19 地裂斩 20 牙突刺 21 升龙击
22 旋风斩  23 天地十字剑 24 多重箭 26 治疗  27 守护之光 28 战神之力
30..36 召唤（哥布林/石巨人/暗杀者/雪人王/暗黑骑士/守护兽巴里/黄金斗士）
41 霹雳回旋斩 42 雷霆裂闪 43 袭风刺 47 钻云枪 48 生命之光 49 流星焰
50 怪物区域攻击 51 冰封箭 52 穿透箭 55 玄月斩 56 天雷闪
```

素材是 `Data/Skill/*.bmd` —— 65 个标准 BMD（骨骼 + 蒙皮网格 + 逐帧动画），
和角色/装备同一套解析器。纹理齐全的有 63 个（`M_piercing` 缺 `strongP_R.ozj`、
`M_waves` 缺 `combo3.ozj`）。

### 二、技能 → 特效是张表，不是数据

原版客户端没有「技能对应哪个特效文件」的表：`ZzzEffect.cpp` 里是一个巨大的
`switch(skillType)`，每个分支直接挑模型。这里照抄同样的思路，把分支摊平成
`src/data/skills.ts` 的 `SKILL_FX` —— 45 个技能逐个配：

| 技能 | 特效模型 | 尺寸 | 观感 |
|---|---|---|---|
| 毒咒 | `Poison01.bmd` | 2.2 m | 绿色毒雾柱 |
| 陨石 | `Groundstone.bmd` | 2.6 m | 石头砸地 |
| 掌心雷 | `Laser01.bmd` | 2.6 m | 斜插的雷柱 |
| 火球 / 流星焰 | `Fire01.bmd` | 2.2 m | 火柱 |
| 火龙 | `Fire01.bmd` | 3.6 m | 同一模型拉长 + 慢放，播两遍 |
| 冰封 | `Ice01.bmd` | 2.8 m | 冰晶炸开 |
| 龙卷风 | `Storm01.bmd` | 3.6 m | 龙卷 |
| 黑龙波 / 能量球 | `Ball01.bmd` | 2.0 m | 能量球（纹理在 `Item/` 下） |
| 地狱火 / 毁灭烈焰 | `Inferno01.bmd` | 3.2 / 4.2 m | 地面火环 |
| 真空波 | `Waveforce.bmd` | 3.4 m | 地面冲击 |
| 极光 / 爆炎 | `Blast01.bmd` | 2.6 / 2.8 m | 光柱冲击 |
| 地裂斩 | `Earthquake02.bmd` | 3.0 m | 地裂 |
| 雷霆裂闪 | `Earthquake05.bmd` | 3.4 m | 大范围地面炸裂 |
| 牙突刺 / 穿透箭 | `Piercing.bmd` | 2.4 m | 突刺光 |
| 升龙击 | `Flashing.bmd` | 2.6 m | 上挑闪光 |
| 旋风斩 / 霹雳回旋斩 | `Saw01.bmd` | 2.0 / 2.4 m | 剑刃旋风 |
| 天地十字剑 | `Kcross.bmd` | 3.0 m | 十字光 |
| 袭风刺 | `Pierpart.bmd` | 2.6 m | 碎片突刺 |
| 钻云枪 | `Ridingspear01.bmd` | 2.8 m | 长枪突进 |
| 玄月斩 | `Tail.bmd` | 3.0 m | 月牙弧光 |
| 多重箭 | `Arrowdouble01.bmd` | 2.6 m | 双箭 |
| 冰封箭 | `Ice02.bmd` | 1.8 m | 冰箭碎片 |
| 瞬移 / 小挪移 | `Magiccircle01.bmd` | 2.4 / 2.8 m | 脚下魔法阵 |
| 守护之魂 / 守护之光 / 生命之光 | `Protect02.bmd` | 2.2~2.6 m | 护盾光 |
| 圣盾防御 / 治疗 | `Protect01.bmd` | 2.0 / 2.2 m | 治疗光 |
| 战神之力 | `Magic01.bmd` | 2.4 m | 魔法爆 |
| 召唤 哥布林 / 石巨人 / 暗杀者 / 雪人王 / 暗黑骑士 / 守护兽巴里 / 黄金斗士 | `Tama01` / `Bigstone01` / `Skeleton02` / `Rider02` / `Skeleton03` / `Rider01` / `Phoenixshield01` | 1.8~2.6 m | 召唤物闪现 |
| 怪物区域攻击 | `Earthquake08.bmd` | 3.0 m | 地面炸裂 |

`SKILL_FX` 里还有两个落点/结算属性：

- **`at: 'self'`** —— buff / 召唤 / 瞬移出在自己脚下，而不是打到靶子身上。
  这类技能点 Cast 时也不会把人往靶子跟前拽（贴过去的逻辑只在打靶子时才有用）。
- **`noDamage: true`** —— 只出光效，不播受击动作、不飘伤害数字。


### 三、特效层 `src/world/effects.ts`

骨架和翅膀同理（自带骨架 + 自己的动作），但多了四个坑：

**1. 蒙皮网格必须挂场景根。** `createSkinnedMesh` 用 `bindMatrix = identity`，
顶点直接被骨骼世界矩阵变换（同 `Actor.attachMeshes`）。挂到 root 下面会多吃一次
root 的位置/缩放 —— 表现是 `fx()` 里一切正常、屏幕上什么都没有。

**2. 尺寸不能写死缩放。** 12 个模型的原始尺寸差 20 倍（Poison01 48 cm，
Inferno01 8 m），而且 `Box3.setFromObject` 对 SkinnedMesh 只看 bind pose，
量不出真实大小。所以 `spawn()` 会先按**动画中段**跑一遍骨架，逐顶点过骨骼矩阵
算出真实包围盒，再按「最长边 = size」反算缩放，同时把包围盒底部中心对到落点。

用最长边而不是高度：`Waveforce.bmd` 是个纯水平面片（包围盒 z 尺寸是 0），
按高度算会除零然后炸成 8 米。

**3. 单帧特效要兜一个最短寿命。** `Laser01` / `Blast01` / `Saw01` / `Ice02`
都只有 **1 帧**，按 25fps 播就是 40 ms —— 比一帧渲染还短，人眼什么都看不到。
现在 `aliveFor = max(period × loops, 0.35 s)`，之后 0.2 s 淡出（材质按实例克隆，
共享材质会把同一张图的所有特效一起弄透明）。

**4. 纹理名大小写。** BMD 里写 `DhorSS.jpg` / `GroundEff.jpg`，实际文件是
`Dhorss.ozj` / `Groundeff.ozj`。Windows 不区分大小写所以原版没事，浏览器走 HTTP
就 404。现在 `loadTexture` 先读一次 `Data/textures-index.json`
（`{"小写基名": ["Skill/Fire01.ozj", …]}`，1470 条），按小写基名查实际路径、
同目录优先；索引里没有才退回「猜大小写」的老逻辑。
这一步是通用的，不只技能特效受益。

### 四、面板：第三张卡片

`SandboxPanel` 原来两张卡片（Character / Equipment），现在加第三张 **SKILL**：

```
CHARACTER   Class 下拉
EQUIPMENT   （默认折叠）
SKILL       Skill 下拉（按职业分 optgroup）+ CAST + 一行提示
```

两个细节都是被布局逼出来的：

- **技能下拉用 `optgroup` 按职业分组**（Dark Wizard / Dark Knight / Fairy Elf / Other）——
  技能不做过滤（45 个都能选），但一眼能看出哪个是本职业的。分组标签来自
  `SKILL_FX[].job`，不是另一张数据表；组顺序走 `JOB_ORDER`，不靠 Map 的插入顺序
  （技能号在文件里是交叉排列的：1..24 是法师+战士+精灵混着）。
- **Equipment 默认折叠**。三张卡片全展开有 756 px，而面板一屏只有 560 px
  （要躲开底栏的 108 px 血蓝球），技能卡片会被挤到滚动区外面 ——「点 Cast」
  变成要先滚 200 px 的事。折叠后 315 px 一屏放得下，要用装备点一下标题即可。
  顺带修了 `.sb-card` 缺 `flex: 0 0 auto` 的问题：面板是 flex 列，不写这条
  卡片会被压扁成一条（内容被 `overflow: hidden` 裁掉），而且一点滚动条都不出。

提示行会显示当前靶子（`靶子：Giant @ 186,129`），放完技能变成
`火球 → Giant · 3 MP`；buff 类技能是 `治疗 · 自身 · 20 MP`。

### 五、靶子与施法

- 靶子：Class 7 = **Giant**（`Monster06.bmd`），挂在 `(186.5, 129.5)` 不参与 AI。
- `castSkill()` 的顺序照 MU 手感：转向 → 播技能动作 → **240 ms 后**出特效
  → 靶子播受击（`MONSTER_ACTION.SHOCK`）+ 飘伤害数字 → 0.7 s 后回待机。
- **`at: 'self'` 的技能不贴身也不打靶子**：治疗 / 护盾 / 召唤 / 瞬移的落点是角色
  自己的脚下，也不会触发受击与伤害数字（`noDamage`）。不然「治疗」打到怪身上很怪。
- 靶子离出生点 50 多格，所以点 Cast 时如果远于 3.2 格，会先把角色贴到靶子面前 2.6 格
  再把相机一次到位（`muCamera.update(1.5)` 让 lerp 收敛），不然点一下什么都看不见。
- 伤害只是拿 `skill.bmd` 的 `Damage` 折算个数字，没有真实战斗/减血/死亡。

### 六、验证

```bash
node tools/skill-probe.mjs offline
```

148 条断言，查的是渲染结果而不是配置：

```
✓ 靶子在洛兰 (186,129)   ✓ Class 7 Giant
✓ 面板三张卡片 / 有 Cast / 下拉选项数 = 技能数
✓ skill.bmd 解出 45 个技能（最大编号 56）
✓ 技能名是中文（读的是 chs/skill.bmd）+ 不带 `-编号` 尾巴
✓ 按三个职业 + Other 分组
✓ 45 个技能逐个 Cast：模型出现、网格数 > 0、落点 = 靶子（或自己）脚下
✓ 特效播完自动移除（不泄漏场景节点）
✓ 点 Cast 后角色贴到 3.2 格内、面向靶子
✓ 火球真的画到屏幕上（像素差分）
```

最后一条是补坑补出来的：前面几轮「特效节点在、包围盒也对，但屏幕上空的」，
只查数据抓不到，所以加了一次 canvas 像素差分。

`tools/sandbox-probe.mjs` 也跟着从「两张卡片」改成三张（新增 `Skill` 字段）。

出图：`node tools/skill-shots.mjs`（45 张全出，约 2 分钟），
或 `node tools/skill-shots.mjs 4 10 41` 只出指定的几个。
文件名是 `skill-<编号>-<模型>`（纯 ASCII，中文名留给这张表）。

### 七、踩到的第六个坑：OZJ 头不是固定 24 字节

`Skill/Mmn2.ozj`（钻云枪用的纹理）头部里那个假 JPEG 头的长度和别的文件一样，
但真 JPEG 起点实测在 **24**，`createImageBitmap` 解出来是 `18432x0` —— 一张破图。
（同类问题更常见的是头部长度不同：有的文件真数据在 26。）

现在改成在头 64 字节里找「第二个 SOI」：找到就从那里切，找不到（纯 JPEG）就用 0。
顺带把 `loadImageData()` 也换成同一个 `jpegOffset()`。

另外 `castSkill()` 里 `effects.spawn()` 是 `void` 掉的，**失败时没人接**——
表现是「点了没反应、控制台也干净」。现在补了 `.catch(console.warn)`。

### 还没做

- 特效只有「命中/落点」，没有飞行轨迹（火球不会从手上飞过去）
- 技能动作号统一用当前武器攻击动作（`SKILL_FX.action` 留了字段但没逐技能配）
- 没有蓝耗/冷却校验，也没有技能等级与学习条件（`RequireLevel` / `RequireEnergy` 读出来了但没用）
- 45 个技能里有几组共用同一个模型（火球/火龙/流星焰都是 `Fire01`，
  极光/爆炎都是 `Blast01`），只是尺寸和速度不同 —— 原版 0.97 客户端本身
  的 2D sprite 特效更细分，3D 模型池只有这 63 个
- 召唤类只是「召唤物模型闪一下」，没有真正生成 AI 单位



## 源码驱动的动作与特效（阶段 V）

阶段 U 的 `SKILL_FX` 是**手猜的**：45 条「技能号 → 一个模型 + 一个尺寸」，
动作号一律用「当前武器的攻击动作」。拿客户端源码一对，三处都不对：

- 0.97 里技能特效有**两种形态**，模型只占一半，另一半是 `Data/Effect/*.ozj|ozt`
  的贴图面片（火焰、魔法阵、雷电、灵魂连线）—— 这一层以前**完全没有渲染器**；
- 施法动作是 **82/83**（`SetPlayerMagic` 的 `SetAction(0x52 + rand()%2)`），
  不是武器的 35..41；战士三个特技另有 67/66/64；
- 一个技能经常一次放好几个特效，落点也不都是目标脚下（自己 / 目标 / 目标格地面 / 身前 1 格）。

所以这一阶段把「配表」换成「**读源码**」。

### 一、数据链：4 个 cpp 文件 → 4 张表

```bash
node tools/extract-skill-fx.mjs
```

| 表 | 出处 | 内容 |
|---|---|---|
| `EFFECT_MODELS` | `Model/Model_Misc.cpp` `Model_LoadSkillEffectAssets()`（IDA `OpenSkills` @0x0050B710） | 特效号 190..268 → `Data/Skill/*.bmd`（55 条） |
| `EFFECT_TEXTURES` | `Scene/Scene_AssetLoad.cpp` 的 `OpenJPG/OpenTGA` | 特效号 0x4ab..0x596 → `Data/Effect/*.ozj|ozt`（43 条） |
| `SKILL_CASTS` | `Net/SecondPassword.cpp` `MoveCharacter()`（IDA 0x00449900，2773 行） | 技能号 → 这一帧放哪些特效、放几个、落在谁身上（28 条） |
| `EFFECT_LIFE_FRAMES` | `Render/Effect_Create.cpp` | 特效寿命（帧，25 fps）（33 条） |

生成物是 `src/data/skillFx.generated.ts`，头部写明「自动生成，不要手改」。
提取器**不是一次性脚本**：它在 `LOOP_EXPANSIONS` 里给每段 `for` 循环留了
`needle`，在源码里找不到就 `throw` —— 源码一改就报错，不会静默输出过期数据。

`MoveCharacter` 的分发读法有两个容易踩的点：

- **多标签 case**：`case 30: case 31: … case 36:` 一行里有 6 个号，
  只捕获第一个的话召唤 31..36 全部丢施法数据（技能数会从 28 掉到 22）；
- **怪物专用分支**：`if (*(short*)(o + 2) == 288) { 三道 203 }` 是怪物的极光，
  不清掉的话玩家的极光会变成三道、能量球会多挂雪花。`stripMonsterBranches()`
  把「不是 390（玩家）」的整块 `if` 删掉、`else` 内容提升到原地。

### 二、两种特效形态

| 形态 | 资源 | 源码写法 | 渲染层 |
|---|---|---|---|
| 模型 | `Data/Skill/*.bmd`（骨骼 + 蒙皮 + 逐帧动画） | `CreateEffect(191, …)` | `EffectLayer`（阶段 U 已有） |
| 贴图 | `Data/Effect/*.ozj|ozt`（一张面片） | `CreateEffect(1200, …)`，槽位 0x4xx | **`SpriteLayer`（本阶段新增）** |

`SpriteLayer`（`src/world/sprites.ts`）两种摆法：

- **billboard**（默认）：`THREE.Sprite`，始终朝相机 —— 火球、雷电、光点；
- **ground**：`PlaneGeometry` 平铺 —— 魔法阵、地狱火圈、轰击环。

寿命直接用源码的帧数（`pfVar17[0x18]` 的 denormal 位模式 ÷ 25），最后 35% 淡出。
`SKILL_CASTS` 里 18 个技能会走到这一层（毒咒的毒雾、火龙的火焰柱、黑龙波的灵魂、
召唤的闪现、生命之光的上升光点、守护之魂的灵魂火花……）。

#### `.jpg` 还是 `.ozj`？—— 是同一个文件

源码写的是 `OpenJPG("Effect/Fire01.jpg", 0x4ab, …)`，但**磁盘上一个 `.jpg` 都没有**：

```
MU-097k-Client-Win32/Data/Effect/   44 × .OZJ  +  4 × .OZT
muonlinejs-master/public/Data/Effect/  同上（原样拷贝，没做转换）
```

`.ozj` 就是「一小段 MU 头 + 真 JPEG」（`jpegOffset()` 在头 64 字节里找第二个
`SOI`，从那里切给浏览器）；`.ozt` 是「4 字节头 + TGA」（同 `tools/oztToTga.ts`
里的 `buffer.slice(4)`）。所以 `.jpg` 只是这个加载函数的名字/历史命名习惯，
不是真实扩展名 —— `OpenJPG` 和角色、物件贴图共用，那些目录下才是真 `.jpg`。

于是提取器做的是「去掉源码里那个假扩展名 → 换成 `.ozj|.ozt` → 按 `readdir`
的实盘名纠正大小写」，43 条**全部命中，没有一条走兜底**，生成表里 0 个 `.jpg`。
表里写实盘名不是为了好看，是为了让探针能直接断言「这个文件真的存在」。

### 三、动作号：不是「统一施法」，是逐条 SetAction

**动作号的唯一来源是 `Combat/Skills.cpp` 的 `PacketHandler_0x19`（IDA 0x0042BCA0）**
——服务端广播「谁对谁放了哪个技能」（0x19 包，`skill_type` = 技能号），客户端就在
这里决定施法者播哪个动作。逐条抄下来是这样的：

| skill_type | 源码 | 动作 |
|---|---|---|
| 0x01/0x02/0x04/0x07/0x0B/0x11（1,2,4,7,11,17） | `SetPlayerMagic(caster)` | **82/83** |
| 0x03（3 掌心雷）、0x10（16）、0x1A..0x24（26..28,30..36） | 同上 | **82/83** |
| 0x13..0x16（**19..22**） | `SetAction(caster, skill_type + 37)` | **56 / 57 / 58 / 59** |
| 0x17（**23**） | `(caster[771] & 1) ? 41 : 60` | **41**（交替） |
| 0x18 / 0x33 / 0x34（24, 51, 52） | `SetPlayerBow(caster)` | 46..49，**随弓/弩** |
| 0x2B（**43**） | `SetAction(caster, 67)` | **67** |
| 0x2F（**47**） | `SetAction(caster, 66)` | **66** |
| 0x30（**48**） | `SetAction(caster, 63)` | **63** |
| 0x31（**49**） | `(World == 8 \|\| World == 10) ? 65 : 64` | **64** |
| 0x38（**56**） | `SetAction(caster, 81)` | **81** |
| 0x32（50）、0x37（55） | 不设动作 | 随武器挥砍（−1） |

上一版只用了「法师 82 / 战士 67·66·64 / 其余挥砍」，于是：

- 19..22（地裂斩/牙突刺/升龙击/旋风斩）被当成挥砍 → 其实各有专属动作 56..59；
- 23 天地十字剑被当成挥砍 → 其实 41/60 交替；
- 48 生命之光被当成施法 82 → 其实是 **63**；
- 56 天雷闪被当成挥砍 → 其实是 **81**。

另外 `MoveCharacter()` 里那个 `switch ((char)v328)`（技能 5/8/9/10/12/13/14/30..36/
41/42/48/49）是**施法者自己的逐帧特效序列**，不负责选动作；这些技能的伤害/命中
走的是 0x19。两条路径都要看，只读一条会漏。

`castOf()` 返回 `action = -1` 就是「让调用方按当前武器算挥砍」。
这条同时暴露了一个**存活了两阶段的老 bug**：`isAttacking()` 只认 `34..55 / 81 / 84 / 85`，
现在扩到 `34..67 / 81..85` —— 不然 56..67 这一段（战士技能）和 82/83（施法）
都会被待机动作下一帧顶掉，一帧都看不见。

### 四、`castOf()`：把源码翻译成「怎么放」

`src/data/skillFx.ts` 只做翻译，不去猜资源：

```ts
export interface FxPart {
  kind: 'model' | 'sprite' | 'trail';
  file: string;                 // 'Skill/Ice01.bmd' | 'Effect/Flame01.OZJ'
  anchor: 'self' | 'target' | 'targetGround' | 'front';
  count: number;                // 源码这一帧放几个（trail 时 = 段数）
  scale?: number;               // 模型：1 = 模型自身单位（源码 +0x1a）
  size?: number;                // 贴图：边长（米）
  lift?: number; ground?: boolean; spread?: number;
  homing?: boolean;             // 追踪弹（param_5=1 / param_6=Owner）
  spin?: number;                // 自转（239 武器旋转 = -750°/s）
  note?: string;                // 出处，或「为什么用替补」
}
```

锚点对应源码里 `CreateEffect` 第三个实参的四种来历：

| anchor | 源码 | 世界位置 |
|---|---|---|
| `self` | `(float*)(o + 16)` | 施法者脚下 |
| `target` | `(float*)(Owner + 16)` | 目标脚下 |
| `targetGround` | `WorldPosition` | 目标格地面 |
| `front` | `mc_AngleVectorOffset(o, -20, -90, 100, WorldPosition)` | 施法者身前 1 格 |

**火球是追踪弹**：源码 `CreateEffect(191, …, (float*)1, (float*)Owner, …)` 的
`param_5 = 1` + `param_6 = Owner` 就是「绑在施法者身上、朝目标飞」。对应到
`EffectLayer.spawn({ flyTo })`，0.32 s 线性插值飞过去，伤害也延后到命中再飘。
所以火球在数据上是 `anchor: 'self'` 但**算「有目标」** —— 不然玩家不会贴过去、
也不会结算伤害。

### 五、特效是怎么被画出来的（RenderEffects 的分发）

模型特效不是「拿到 BMD 就随便找个尺寸画」。`Render/Render_WorldHelpers.cpp` 的
`EffectPool_RenderAll`（IDA 0x0046BBA0，200 个效果槽 × 0x1bc 字节）按**类型号**
分发，规则是硬的：

```
type 238 / 243        → break;                        不画（没加载模型，硬画=白方块）
type 239              → RenderWheelWeapon(o);         把 owner 的武器转起来甩
type 244              → ItemDrop_RenderGroundWeapon;  地面武器渲染器（砸地）
type 266              → 自己的 BMD_Animation + RenderPartObject（scale 1）
type 190..268         → Entity_PrepareRender(o);      按**模型自身单位**画
type 1210..1212       → 沿速度方向连发 30 个 1176 精灵（拖尾）
其它（1150/1176/1200/1264…）→ 精灵池，不在这里
```

由此得到三条**必须照抄**的渲染约定：

1. **不缩放**。`CreateEffect` 把效果槽 `+0x1a` 初始化成 `1.0`，`Entity_PrepareRender`
   就用它 —— 模型画多大就多大。以前按「缩到 2.2 米」处理，把 8 米的
   `Inferno01` 火环压成 4 米、把半米的 `Poison01` 放大五倍，这是「特效不对」的主因。
2. **不做包围盒对齐**。效果位置 = 落点，模型原点由美术定。以前按包围盒
   「底部中心」贴地，`Laser01` 这种包围盒 x 从 67.9 起的会整体偏半格。
3. **动画速度 0.3**。`CreateEffect` 写 `+0x33 = 0.3`，`MoveEffect` 尾部拿它调
   `BMD__PlayAnimation(…)`。以前按 1.0 播，5 帧的火焰 40 ms 就烧完，看着像「闪一下」。

#### 具体例子：陨石为什么会「从天而降」

技能 2「陨石」的效果参数全在源码里，一条注释都没有，全是数字：

```
Net/SecondPassword.cpp  case 2:
    CreateEffect(191, Owner+16, Owner+28, o+232, SubType=0, …)

Render/Effect_Create.cpp  case 0xBF, SubType 0:
    [0x18] = 5.60519e-44        → 位模式 40 → 寿命 40 帧（1.6 s）
    [6]   += _DAT_00552850      → 400.0 单位 = **离地 4 格**
    [0x30]=0  [0x31]=0
    [0x32]= -50.0               → Z 速度 **-50 单位/帧（25 fps → -12.5 m/s）**

Render/MoveEffect.cpp  case 0xBF（SubType 0）:
    每帧 AddTerrainLight(…)                        ← 地面被照亮
    [0x1a] = (rand()%4+4) * 0.1                    ← 火焰尺寸抖动
    [4] += [0x30]（公共尾：位置按速度推进）
```

4 m ÷ 12.5 m/s = **0.32 s 落地**，剩下 1.28 s 在地上烧。这就是「天降陨石砸中怪物」——
它不是美术摆的姿态，而是「离地高度 + 速度 + 寿命」三个数算出来的。

同一套机制里 SubType 5 更完整（`MoveEffect` 里有重力、触地反弹、落地时
`Particle_Spawn(0x4BF)` 加 6 块碎石 `rand()%2 + 0xC5`），只是技能 2 走的是 SubType 0。

我们原来把这个效果放在**目标脚下**、`scale 1`、没有速度 —— 所以只剩「地上烧一下」。
现在按 `+0x18 / +0x30..32` 补了 `drop / vel / life`，探针会量「起点离地 > 2.5 m、终点落回地面」。

另外 238（霹雳回旋斩）的视觉**不在 238 自己身上**：`MoveEffect` 的 `case 0xee`
每帧 `CreateEffect(0xEF)`，而 239 = `RenderWheelWeapon` —— 转的其实是玩家手上
那把武器（`-30°/帧`）。这个渲染器已经接上了，见下面「武器旋转层」。

### 六、替补：源码引用了、但本 port 没加载的 5 个槽位

`CreateEffect` 引用了这几个号，但**不能一律当「模型」放** —— 它们在源码里
根本不是同一种东西。**每一件都写进 `note`**，探针会校验「所有源码件的 note 都非空」：

| 槽位 | 源码里它是什么 | 这里的处理 |
|---|---|---|
| 238 (0xEE) | `RenderEffects` 直接 `break`（**不画**）；`MoveEffect` 每帧生成 239 = `RenderWheelWeapon`（转玩家武器） | 已按源码实现（`src/world/wheels.ts`），**不再用替代模型** |
| 244 (0xF4) | `ItemDrop_RenderGroundWeapon` 专属渲染：武器升起→砸下，`cnt==3` 时砸地出地裂 | 只取「砸地后的地裂」 → `Earthquake03.bmd` |
| 1210..1212 | **拖尾**：沿速度方向连发 30 个 1176 火花 | `kind: 'trail'`，铺 10 段 `Spark03.OZJ`，逐段缩小 |
| 496 (0x1F0) | `AttackStage` 阶段帧生成，本 port 没登记槽位 | `Pierpart.bmd`（Skill 目录里本来就有这个技能的模型） |
| 497 (0x1F1) | 同上 | `Ridingspear01.bmd` |

另外**关节**（`Joint_Create`）不按模型画：技能 16 守护之魂 / 27 守护之光传的是
**266**，那是个模型槽（`RidingSpear01.bmd`），原版借的是它的**纹理**去画连线。
本 port 没有关节渲染器，直接当模型放会在玩家身上出现一把长枪，所以统一换成
`Effect/JointSpirit01.OZJ` 的灵魂火花面片（观感 = 身上冒光点）。

### 七、覆盖率

```
源码有特效     31 个: 1,2,4,5,7,8,9,10,11,12,13,14,16,17,26,27,28,30..36,41,42,43,47,48,49,56
源码无视觉      6 个: 19 地裂斩, 20 牙突刺, 21 升龙击, 22 旋风斩, 23 天地十字剑, 50 怪物区域攻击
投射物          3 个: 24 多重箭, 51 冰封箭, 52 穿透箭（CreateArrow，从弓上飞出去）
仍走表现兜底    5 个: 3 掌心雷, 6 瞬间移动, 15 小挪移, 18 圣盾防御, 55 玄月斩
```

**「源码无视觉」不是漏了，是原版就这样。** 地裂斩/牙突刺/升龙击/旋风斩/天地十字剑
在三条 dispatch（`MoveCharacter` 的两个 switch + `AttackStage`）里都没有 `CreateEffect`，
光效来自**武器拖尾**（`Trail_Render`，另一套池子，纹理 = `type + 0x48D`）。
以前给它们硬塞 `Earthquake02`/`Piercing` 之类的模型，是「特效不对」最刺眼的部分，
现在改成**只播动作、不生成任何东西**，探针会验证「一件都不许生成」。

`castOf()` 的 `source` 因此有三态：`client`（源码查到）/ `fallback`（表现兜底）/ `none`（源码无视觉）。
面板下拉的前缀也对应 `◆` / `○` / `—`。

### 八、验证

```bash
node tools/skill-probe.mjs offline
```

`✓ 230 / ✗ 0`（「每帧推进」类断言在软渲染卡死时会自动跳过并打印，不计失败），全部断言在**渲染结果**上：

```
✓ 源码覆盖 ≥ 28 个技能   ✓ 法师技能一律 82（SetPlayerMagic）
✓ 地裂斩 56 / 牙突刺 57 / 升龙击 58 / 旋风斩 59（skill_type + 37）
✓ 天地十字剑 41（41/60 交替）   ✓ 弓箭类交给 SetPlayerBow（-1）
✓ 袭风刺 67 / 钻云枪 66 / 生命之光 63 / 流星焰 64 / 天雷闪 81
✓ 模型特效一律 scale = 1（源码 +0x1a，不做「缩到 N 米」）
✓ 陨石（191/0）离地 4 m + -12.5 m/s 下落；火球（191/1）不带下落、寿命 2.4 s
✓ 霹雳回旋斩（41）转的是玩家武器（239 RenderWheelWeapon），-1.309 rad/0.1 s
✓ 雷霆裂闪（42）武器举到顶（height 1.00）→ 落地 → 才出地裂
✓ 特效 root 的局部 +X 指向目标（角度差 < 0.05 rad，没有多转 90°）
✓ 特效绕的是竖轴 Z（`rotation.y` 会把特效翻倒）
✓ 弓箭类（24/51/52）按 CreateArrow 从施法者飞向目标
✓ 源码无视觉的 6 个技能：一件特效都不生成
✓ 每个技能 Cast 后件数对得上源码（例：毒咒 = 1 模型 + 10 贴图，极光 = 10 段拖尾）
✓ 模型与贴图文件都来自源码表，落点在源码给的锚点（self/target/front）
✓ 角色真的在播那个动作号
✓ 火球朝靶子飞了（轨迹采样 183.9 → 186.5）
✓ 模型/贴图两层播完都自动移除
✓ 火球与火龙的像素差分都 > 0.4%（两层都真的画到了屏幕上）
```

探针本身踩到两件事，记在这里免得下次再查：

1. **动作号必须在同一次求值里读**。分两次 CDP 往返，中间会跑好几帧，
   一次性动作播完主循环就切回待机（1 号）—— 读到 1 不是游戏的错。
2. **无头浏览器是 SwiftShader 软渲染**，只有 ~10 fps，且偶尔整段卡住十几秒
   （`renderer.info.render.frame` 一帧不涨）。这时候特效 `age` 冻在 0，
   看起来像「弹道没生效」。采样时同时采帧号，帧号没动就重试，不拿它下结论。

### 九、这一阶段修掉的真 bug

1. **`.OZT` 被当成 JPEG 解码**。`resolveTextureCandidates()` 只把 `.tga`
   认成 TGA，而技能贴图表给的是**已经带后缀**的实盘名（`Effect/fi02.OZT`），
   于是被丢进 `createImageBitmap` 解 JPEG → `InvalidStateError`，流星焰整件特效
   静默消失。现在 `.tga` 和 `.ozt` 都走 `decodeTga(bytes, 4)`（OZT 是「4 字节头
   + TGA」，同 `tools/oztToTga.ts` 里的 `buffer.slice(4)`）。
2. **82/83 不算「正在出手」**。见第三节，施法动作被待机动作一帧顶掉。
3. **地面片转错了 90°**。这个世界是 **Z 轴朝上**（`camera.up = (0,0,1)`），
   `PlaneGeometry` 默认躺在 XY 平面就是「平铺在地上」，早先按 Y-up 的习惯
   又转了 `rotateX(-π/2)`，结果魔法阵全部立成一面墙。

### 十、为什么「还是不够还原」：缺的是三块运行时

到这一步，「放什么」已经全对了（哪个模型、几个、落谁身上、寿命多少、往哪走）。
剩下的不像，是**运行时**没搬 —— 用 grep 数一下就知道缺口多大：

| 缺失的子系统 | 源码规模 | 症状 |
|---|---|---|
| `MoveEffect` 的逐帧行为 | **80 处** `CreateEffect`/`Particle_Spawn`/`CreateJoint`、**22 处** `AddTerrainLight` | 技能只有「放一下」，没有子效果连环、没有地面被照亮 |
| 关节 `Joint_Create` | MoveCharacter **21 处**、AttackStage 里 3 条 | 袭风刺已接（见下）；16/27 两端同点，仍是点状精灵 |
| 音效 `PlayBuffer` | MoveCharacter **62 处** | 全程静音 |
| 专用渲染器 239 / 244 / 266 | 各一支函数 | **239 / 244 已接**（转武器、举起来砸地）；266 仍是火花替身 |
| 武器拖尾 `Trail_Render` | 一套 `GL_QUAD_STRIP` 池子 | 已接（见下） |

其中**地形光**是最影响「像不像 MU」的一条：几乎每个效果 case 都在每帧
`AddTerrainLight(x, y, color, 2, …)`，技能落地时地面会泛一圈对应颜色的光。
我们的地形是静态顶点色，没有动态光照通道，所以这一块要单独做一层。

**这一版补了两条**：

1. **地面光斑**（`AddTerrainLight` 的近似）。`MoveEffect` 里 22 处
   每帧调 `AddTerrainLight(x, y, color, 2, …)`，效果是「技能把脚下的地形照亮」。
   我们的地形是静态顶点色、没有动态光照通道，所以在 `EffectLayer.spawn` 里挂一张
   **朝上的加色径向光斑**（`CanvasTexture` 程序生成，128²，中心 0.95 → 边缘 0），
   贴地 3 cm、跟着特效走（火球飞过去时地面那圈光也跟）、亮度跟特效淡出曲线一致。
   半径 = `max(1.6, 2.6 × scale)`，峰值不透明度 0.3。
   探针断言「落点地面有光斑」。
2. **特效按施法者朝向摆**（下面这段）。

**关节 / 光束层**（`src/world/beams.ts`）：源码里「两点之间的一道光」不走模型也不走精灵，
而是 `Joint_Create(type, posA, posB, angle, entity, mode, size, …)`，由 `Joint_Render`
沿 A→B 铺串四边形。我们用**两片交叉的加色面片**近似整条光束（交叉 90° 保证任何角度
都不会看成一条线），长度 = 两点距离、宽度 = `size`、加色混合、`depthWrite:false`。

第一处接的是 **43 袭风刺**：`AttackStage` case 0x2B 在 attackTime 2..8 每帧
`Joint_Create(0x10A, pos, …)`，`pos` 是「英雄位置 ±300 单位」——
所以是三道电光从身上向外炸开，寿命约 0.3 s（8 帧）。探针断言「3 道 = 源码 3」。
（16/27 的 `Joint_Create(266, Owner+16, Owner+16, …)` 两端是同一点、等价于点发射，
继续走精灵层。）

**武器拖尾层**（`src/world/trails.ts`）：源码里刀光走 `Trail_RenderAll`
（`FUN_0046c3e0`）——每个槽存一串历史点，渲染成 `GL_QUAD_STRIP` 带子，
透明度按 `(count - i) / count` 从新到旧衰减，贴图 = `type + 0x48D`
（0x48D = 1165 = `Effect/blur01.OZJ`，正好拖尾贴图段的第一个）。

点从哪来：`AttackStage` 每帧用 `BMD__TransformPosition` 算武器骨骼的世界坐标，
存进 `o + 0x188`（`m_vPosSword`），拖尾池把这个点推进点列。我们做的是同一件事：

```ts
player.update(dt);
if (isAttacking()) { trailLayer.begin(); trailLayer.push(player.handPosition(tmpHand)); }
else trailLayer.end();
trailLayer.update(dt);
```

`Actor.handPosition()` 优先取**挂武器的那只手**（`props` 里 `@right` 的组），
空手才退到 `MOUNT_BONES.right`（`knife_gdf` / `Bip01 R Hand`，骨骼 28/33）。
点列最多 24 个、最小步长 3 cm、单点寿命 0.24 s；顶点色按「越旧越暗」衰减，
配合加色混合等价于越旧越透明。探针量「≥3 个采样点且折线 > 0.2 m」。

**武器旋转层**（`src/world/wheels.ts`）：技能 **41 霹雳回旋斩**的视觉不在 238 号槽上 ——
`RenderEffects` 里 `case 238: break;`（`OpenSkills` 也没给它加载模型，硬画就是白方块）。
真正的来源是 `MoveEffect` 的 `case 0xee`：每帧 `CreateEffect(0xEF)`，而 239 走
`RenderWheelWeapon`（**0x0046B7C0**）：

```c
owner 的武器  → model_id = *(uchar*)(owner + 136) + 400   // Item 模型池
o+36 += -30°/帧            // -750°/s ≈ -13.09 rad/s
o+32  = 90°               // 把武器放平
o+24 += 100 单位          // 抬到头顶 1 m
RenderPartObject(...)     // 借用效果槽画完，再把 2/16/20/24/28/32/36 全还原
```

也就是说 **转的是玩家手上那把武器本身**。我们的实现等价但更干净：武器在
`buildHeldItem` 里是**静态几何**（`createStaticMeshes` + 烘焙骨骼矩阵），所以
克隆一份 → 挂到绕竖轴转的 pivot（`rotation.z`）→ 到期销毁；不碰角色本体，
也就不需要源码那套「改字段 → 画 → 还原」。

- 寿命取 239 的 `+0x18`（`3.50325e-44` → 位模式 **25 帧 = 1.0 s**），后 30% 淡出；
- 材质**逐个克隆**（改 opacity 会把角色手上的武器一起弄透明）；
- 旋转前把克隆体平移到自身包围盒中心，否则会绕挂载点甩出一个大圈；
- **武器取不到就什么都不画**（源码空手也取不到 `model_id`）。这里刻意不做替代模型兜底：
  兜底是延迟生成的，会漏过探针的 `fxClear()`，凭空多一件留在场上，把后面技能的
  件数断言全带歪（这个坑真踩过）。

探针（放在 45 个技能**之前**跑：软渲染打到后面会整段卡死，采样窗口一帧不跑会把「转了」误判成「没转」）：

```
武器旋转: {"meshes":1,"angle":0,"life":1,"pos":[133.5,131.5,2.65]}
       → {"meshes":1,"angle":-1.309,"life":1,...}      // 0.1 s × -13.09 rad/s
✓ 霹雳回旋斩（41）转的是玩家武器（239 RenderWheelWeapon）
✓ 武器绕竖轴转（源码 -30°/帧 ≈ -13.09 rad/s，方向为负）
✓ 武器被抬到头顶 1 m（源码 o+24 += 100 单位）
```

**武器砸地层**（`src/world/wheels.ts` 的 `WeaponSlamLayer`）：技能 **42 雷霆裂闪**（Rageful Blow）
在源码里也有专属渲染器 `ItemDrop_RenderGroundWeapon`（**0x0046B980**），而且它自己还带一条
**按帧号排的时间线**（`MoveEffect` 的 `case 0xF4`，总 20 帧 = 0.8 s）：

| 帧（life） | 时刻 | 发生什么 |
|---|---|---|
| 20 → 15 | 0 ~ 0.25 | 武器升起 |
| 15 | 0.25 | 垂直速度翻号（`o+216`）→ 开始下落 |
| 15 → 10 | 0.25 ~ 0.5 | 每帧 **−8 单位**（−2 m/s），只掉一点点 |
| 10 → 3 | 0.5 ~ 0.85 | 继续下坠 |
| **3** | **0.85** | **砸地**：`Joint_Create(0x4E9)` ×8 裂缝、`Particle_Spawn(0x4BF)` 扬尘、`CreateEffect(0xFD/0xF7/0xF5/0xF6)` |
| 2 | 0.9 | 结算并销毁 |

还有一个容易忽略的事实：**`ItemDrop_RenderGroundWeapon` 只在 `life > 10` 时画武器**
（`if (_DAT_00552488 >= (float)*(int*)(o + 96)) return;`），也就是说落地之后
这个效果画的是**裂缝，不再是武器**。

所以 42 号拆成三件，而且后两件是**延迟生成**的（新增 `FxPart.delay`）：

```ts
{ kind: 'weaponSlam', life: 0.8, spin: -2.4 }                       // 武器升起→砸下
{ kind: 'model',  file: 'Skill/Earthquake03.bmd', delay: 0.68 }     // 落地：地裂
{ kind: 'sprite', file: 'Effect/smoke01.OZJ', count: 6, delay: 0.68 } // 落地：扬尘
```

延迟件之所以放进 `parts` 而不是在渲染层偷偷生成，是因为探针按 `parts` 数件数 ——
偷偷生成的地裂会被算成"凭空多一件"，把后面技能的断言带偏（第一次就是
**47 钻云枪**被数成 4 件）。

探针：

```
武器砸地: {"phase":"rise","z":1.65,...}  peak=1.00  landed=true  crack=true
✓ 雷霆裂闪（42）是「武器砸地」而不是一个地裂模型
✓ 武器真的被举起来（高度 > 0.6）
✓ 武器落地后砸出地裂（源码 life==3 才出裂缝）
✓ 雷霆裂闪 特效件数 1模型 + 6贴图 = 源码 1+6
```

**关于朝向**：特效现在按**施法者朝向**摆，但这里有两个必须分开的约定。

`CreateEffect` 的第 3 个实参永远是角度（`(float*)(o + 28)`）。以前一律 `yaw = 0`，
所以极光/爆炎/激光这类**定向**特效全是朝 +X 打的。

修的时候踩了两个坑，都不是"再调 90°"能解决的：

| 坑 | 现象 | 正解 |
|---|---|---|
| 用了 `root.rotation.y` | 世界是 **Z-up**，绕 `y` 是绕**水平轴** —— 特效被翻倒/侧立起来 | 绕竖轴是 `rotation.z` |
| 直接传 `player.yaw` | `player.yaw` 带 `MODEL_YAW_OFFSET(π/2)`，那是给**角色** BMD 的「本地朝 -Y」补的 | 传 MU 世界角度 `atan2(dy, dx)` = `player.yaw - π/2` |

第二条的依据不是猜的，是量出来的：特效 BMD 的角度约定是「**0 = +X**」，跟角色模型完全不同。

```
Data/Skill/Laser01.bmd   顶点包围盒中心 = (+0.92, +0.11, +0.08)   本地 +X 伸出
Data/Skill/Blast01.bmd   中心 = (0, +1.54, +0.04)                 本地 +Y 伸出
Data/Skill/Ice01.bmd     中心 = (-0.01, -1.31, +1.21)             本地 -Y 伸出
Data/Skill/Inferno01/Storm01/Protect01/…   sizeX ≈ sizeY，中心 0  环绕型，无朝向
```

也就是说特效模型**没有统一的"前"**，`CreateEffect` 的 angle 是**世界角度**直接喂给
`MatrixRotationZ`，不像角色那样要补 π/2。所以 `spawn({ yaw })` 的语义定为
「MU 世界角度，0 = +X」，调用方自己减掉 `MODEL_YAW_OFFSET`。

探针不比对代码里的数字，而是直接读 **`root.matrixWorld` 的局部 +X 在世界里的投影角**，
和「施法者→目标」的方向比：

```
朝向: 施法角度 -0.021 / 特效角度 -0.021 / 指向目标 -0.021
✓ 特效 root 的局部 +X 指向目标（没有多转 90°）
✓ 特效是绕竖轴(Z)转的，不是绕水平轴（rotation.y 会翻倒）
```

顺带：238 霹雳回旋斩那句 `spin` 也从 `rotation.y` 改到 `rotation.z`（绕竖轴甩武器）。

### 十一、可见性盘点：45 个技能到底「看得见几个」

探针只验证了「**生成件数**对得上源码」，但「生成了」不等于「看得见」。为此加了三个工具：

| 工具 | 量什么 | 怎么用 |
|---|---|---|
| `tools/fx-audit.mjs` | 逐技能数**实际生成的件数** + 每件的**屏幕投影是否在视口内** + 控制台警告 | `node tools/fx-audit.mjs` |
| `tools/fx-strength.mjs` | **像素差分**：变化像素占画面比例、亮度增量、变化区域包围盒 | `node tools/fx-strength.mjs 4 5 12` |
| `tools/panel-cast-probe.mjs` | 按**用户的点法**（下拉选技能 → 点 Cast，150 ms 连点下一个）验证链路 | `node tools/panel-cast-probe.mjs` |

实测结论（45 个技能）：

```
有视觉的 39 个 → 生成且在屏内 38 个
「一件都没生成」0 个（41 那次是脚本跑了 40 个技能后装备被重建，空手 → 见下）
源码无视觉 6 个（19..23 / 50）：按设计就是 0 件
```

代表技能的屏幕强度（两帧差分，取峰值）：

```
id 技能        占比%   亮度增量  包围盒      判定
 1 毒咒        55.35     -20     336×459    正常
 2 陨石         6.76      20     348×267    正常
 4 火球         7.20      24     410×227    正常
 5 火龙        12.32      42     411×280    正常
 9 黑龙波       5.34      66     412×213    正常
12 极光         3.55       7     412×271    正常
14 毁灭烈焰     36.24      79     429×408    正常
16 守护之魂      4.28      58     429×225    正常
27 守护之光     10.08      80     360×221    正常
42 雷霆裂闪      4.00      -1     430×223    正常
43 袭风刺        3.19      -5     423×221    正常
48 生命之光     17.01     136     423×259    正常
56 天雷闪       12.90     127     423×278    正常
```

也就是说**渲染层没有「大量缺失」**。盘点过程中反而揪出两个会让人误以为「没特效」的真问题：

**1. 面板 Cast 有 0.85 s 的静默节流**

```ts
if (castCd > 0) return;   // 旧代码：什么都不说就返回
castCd = 0.85;
```

沙盘是「点一下看一次」的演示工具，连续点几个技能时 0.85 s 内的点击**全被吞掉、面板毫无反馈**，
看起来就是「这些技能没特效」。现在降到 0.05 s（只防同一帧重复），并且角色死亡时会明确提示。
`panel-cast-probe.mjs` 专门按 150 ms 的节奏连点来验证这条。

**2. 预热时把 `weapon` 件当贴图加载**

`warmUp()` 里 `else sprites.add(part.file)` 把 41/42 的 `weapon` / `weaponSlam` 件也塞进了贴图集合，
于是去 `Data/Effect/Saw01.bmd` 找模型文件，控制台里出现
`[texture] 未找到 Skill/Saw01.bmd (dir=Data/Effect/)`。现在只预热 `sprite` / `trail`。

**3. 41 在盘点里「空手」暴露的另一件事**

那 40 个技能把玩家拽来拽去，进出安全区触发 `refreshPlayerEquipment()`，
而它会先 `removeFromParent` 再挂新件 —— 中间几帧 `props` 是空的。
`weapon` / `weaponSlam` 已经改成「取不到就隔 120 ms 重试 3 次」，
但**根因还在**：装备重建不是原子的。严格做法是先建好新件再一次性替换。

### 十二、地面纹理与光照：索引、越界、以及「原版到底乘了什么」

用户报「地面纹理索引有问题」。逐条对源码之后，结论如下。

#### 1. tile 索引表是对的，但要按源码槽位理解

`Scene/Scene_OpenWorld.cpp` 是**硬编码槽位**，所有地图共用同一组文件名（只是目录不同）：

```
0x23 TileGrass01   0x24 TileGrass02   0x25 TileGround01   0x26 TileGround02
0x27 TileGround03  0x28 TileWater01   0x29 TileWood01     0x2A TileRock01
0x2B TileRock02    0x2C TileRock03    0x2D TileRock04     0x2E TileRock05
0x2F TileRock06    0x30 TileRock07
```

也就是 `.map` 里每格的字节**就是 0..13 的索引**（不是 GL 槽号），对应 `0x23 + index`。
实测 `EncTerrain1.map`：`layer1` 取值 0..8，`layer2` 取值 0..8 **以及 255**。
（muonlinejs 的 `getTilesList` 是按地图返回不同列表的，那是它自己的一套；0.97k 源码是固定表。）

#### 2. 真正的 bug：`layer2 = 255` 越界采样

`layer2` 有 **43785 格**是 255，表示「这一格没有第二层」。
原版是靠逐个 `if` 比较索引、255 不命中任何分支来跳过的；我们直接当 texture array 的层号用，
**WebGL 越界采样返回 0（黑）**，于是 `mix(c1, 黑, alpha)` 把对应地面压暗 —— 表现就是「地面一块块发黑」。

现在：

```glsl
float ok2 = step(l2raw, uTileCount - 0.5);
float l2  = ok2 > 0.5 ? l2raw : l1;
vec3 base = mix(c1, c2, a * ok2);
```

源码里也有同样的兜底：`if (tileTex < 0x23 || tileTex > 0x30) tileTex = 0x23;`

#### 3. 光照：按光照图真乘，明暗要留出来

`TerrainLight.OZJ` 里已经带了完整的明暗信息（洛兰 p05 `0.10` / p50 `0.53` / p95 `1.00`），
问题是**怎么映射**。压得太狠就没层次，压得太松就把整张图抬白。

```glsl
vec3 rl = texture(lightMap, vUv / 256.0).rgb;
// 原版 sanitize：某些格子的通道极端不平衡（R 高、G=0、B 高）→ 地面出现紫/品红色块
if (mx - mn > 0.4) rl = vec3((rl.r + rl.g + rl.b) / 3.0);
vec3 light = vec3(0.16) + 0.92 * rl;   // LIGHT_TUNE.floor / gain
vec3 col   = base * light * uExposure;
```

| 映射 | rl=0 | rl=0.53 | rl=1 | 洛兰地面 luma |
|---|---|---|---|---|
| 旧 `0.75 + 0.30·rl` | 0.75 | 0.91 | 1.05 | 78（又亮又平） |
| **现在 `0.16 + 0.92·rl`** | 0.16 | 0.65 | 1.08 | **62（有明暗）** |

`uExposure` 只当整体微调（默认 1.0，调它不动对比度）。
调试口：`__MU_APP__.lightTune({ floor, gain, exposure })` 可热改。

#### 4. UV：每格一整张 tile

源码地形是逐格一个 quad，`glTexCoord2f(0,0) … (1,1)` —— **一格一张完整贴图**。
（中途按 muonlinejs 的 `uv * 64` 试过「每 4 格一张」，结论是反的，已回滚。）

#### 5. 缺文件的地图不再出灰块

`World1` 只有 9 张 tile（缺 `TileRock03..07`），`World7` 缺 `TileGround01/02`，
`World8` 连 `TileWater01` 都没有。原版是「OpenJPG 失败 → 纹理留空」，留空在我们这里就是**纯灰块**。
现在缺的槽位退化成 0 号 tile（草地），并在控制台列一次缺件清单。

#### 量化对比（同口径，只截 3D 画布）

| 区域 | 压平前（旧 0.75+0.30） | 现在（0.16+0.92） |
|---|---|---|
| 天空 | 62.6 | 59.0 |
| 远景 | 77.1 | 65.6 |
| 地面 | 77.8 | **62.2** |

（更早的「旧基线」是 57.5 / 54.9 / 54.2 —— 那时 UV 和越界都还有 bug，不能直接比。）

工具：`node tools/terrain-shot.mjs <tag>`（只截 canvas，输出分段亮度 / 暗像素比例 / 边缘密度）。

### 十三、41/42「点了没效果」的两个真正原因

前面把 239（转武器）和 244（砸武器）都实现了，但**默认状态下点 41/42 还是什么都看不到**。
原因不在渲染层，而是「找不到武器」：

**1. 离线演示默认是空装**

`sandbox.slots` 初始全是 `undefined`，`currentEquip()` 读出来就是空手。
而 `RenderWheelWeapon` / `ItemDrop_RenderGroundWeapon` 都是
`model_id = *(uchar*)(owner + 136) + 400` —— 取**当前武器**的模型，空手时源码也是什么都不画。

→ 现在点「离线演示」会给一把默认武器（`SandboxPanel.equipDefaultWeapon()`，
从 `item.bmd` 目录里挑第一件右手武器），再 `loadWorld`。

**2. 出生点在安全区，武器挂在背上**

补了武器之后依然没效果，因为 `props` 里是 `held:161@back` —— 安全区会把武器背起来。
而我们只找 `endsWith('@right')`，于是又变成「空手」。

源码根本不关心挂在哪个位置（它读的是武器**类型**），所以现在按「任意挂载位置的武器」找：

```ts
const weapon =
  me.props.find(p => p.name.endsWith('@right')) ??
  me.props.find(p => p.name.startsWith('held:'));
```

实测（默认装备 + 出生点安全区，**没有** `previewEquip`）：

```
skill 41: {"m":0,"sp":0,"w":1,"sl":0}        ← 武器旋转
skill 42: {"m":1,"sp":6,"w":0,"sl":1}        ← 武器砸地 + 地裂 + 扬尘
```

回归 `skill-probe` **226 条全绿**（其中 4 条「每帧推进」类因软渲染卡死跳过）。

> 顺带说明：上一轮那个 `warmUp()` 把 `weapon` 件当贴图的修复是有效的 ——
> 控制台里 `[texture] 未找到 Skill/Saw01.bmd (dir=Data/Effect/)` 已经消失。
> 但那条只影响控制台噪音，不影响 41/42 出不出效果。

### 十四、地面/物件贴图：一个会让材质「有图但全黑」的解码 bug

追 `Image in DataTexture is too big (18432x0)` 这条警告，最后发现是**解码路径选错**：

```ts
// 旧代码：isTga 是按「候选列表」算的
const { candidates, isTga } = resolveTextureCandidates(dir, texturePath);
for (const url of candidates) { if (isTga) { decodeTga(bytes, 4) } ... }
```

BMD 里写的贴图名是 `ston02.tga`，但磁盘上只有 **`ston02.OZJ`（真 JPEG）**。
候选列表用 `.tga` 扩展名算出 `isTga = true`，于是**拿 JPEG 数据去按 TGA 头解析**：

```
TGA 头：width = bytes[12..13] = 0x4800 = 18432
        height = bytes[14..15] = 0
```

→ 生成一个 `data.length = 0` 的 `DataTexture` → three 上传时报
`Image in DataTexture is too big (18432x0)` 并**静默失败** → 那个材质变成「有图但全黑」。

洛兰里命中的是 `Object1/ston02.OZJ`、`tree_01.OZJ`、`tree_02.OZJ` —— 石头和两棵树。

修复：**按实际取到的那个 url** 决定解码方式，失败再换另一种（MU 里扩展名和内容不符的文件不少）：

```ts
const ext = (url.split('.').pop() || '').toLowerCase();
const preferTga = ext === 'tga' || ext === 'ozt';
if (preferTga) { const img = tryTga(bytes); if (img) return ...; }
const bmp = await tryJpeg(bytes); if (bmp) return ...;
if (!preferTga) { const img = tryTga(bytes); if (img) return ...; }
```

改完 `18432x0` 警告消失，场景里再没有任何异常尺寸的纹理
（用一个遍历 `scene` 检查所有 sampler uniform 的小脚本验证过）。

### 十五、tile 纹理：改成图集 + 最近邻

两个独立的问题：

1. **`DataArrayTexture` 会被 three 误判尺寸**（就是上面那条警告的另一半来源）。
   现在把 14 张 tile 拼成一张 **1024×1024 的 4×4 图集**（普通 `DataTexture`），
   着色器里 `fract(vUv)` 取格内坐标、`(col,row)/4` 定位：

   ```glsl
   vec2 uvTile = fract(vUv);
   vec3 c1 = texture(tiles, (vec2(mod(l1,4.0), floor(l1/4.0)) + uvTile) / 4.0).rgb;
   ```

2. **采样方式**：源码 `OpenJPG(file, slot, 0x2600, 0x2901, 0, flag)`
   → `0x2600 = GL_NEAREST`、`0x2901 = GL_REPEAT`。我们之前用 Linear + mipmap，
   既抹平了像素，又让远处糊成一片。改成 `NearestFilter` + 无 mipmap。

   顺带发现 tile 尺寸并不统一：`Grass01/Ground01/Water01/Rock01` 是 256，
   `Grass02/Ground02/Ground03/Wood01/Rock02` 是 **128**，统一拉到 256 之后有一半是放大的，
   用 NEAREST 至少保住像素质感。

地面边缘密度（`terrain-shot.mjs` 的 `edge`）：**13.1 → 20.4**（+56%），亮度 54.2 → 78.7。

### 十六、按 `xulek/muonline` 补「撞上之后」：结构性行为 + 三个真 bug

`skillFx.generated.ts` 是从 **0.97k 原版二进制**里挖出来的「这一帧生成了什么」，
它能说清「陨石 = `CreateEffect(191)`，从 4 格高砸下来」，但**挖不出「砸中之后发生什么」**
—— 碎石、爆闪、火柱在二进制里是模型自己播的动画 + 另一套粒子系统，静态提取拿不到。

`xulek/muonline` 是照着官方 `SourceMain5.2` 重写的 C# 客户端，把这些**结构性行为**
写得很明确。所以我们加了一层 `src/data/skillFxRefine.ts`：

- **只补缺失的部分**（撞击后生成什么、量多大、往哪飞），
  **不覆盖源码已经给出的数值**（下落高度、寿命、动作号）；
- 那条 `FallFrames = 20f` 的注释写着 "slowed ~2.5x for more dramatic arc"，
  是作者为了好看刻意放慢的，我们仍用 0.97k 的真实下落时间。

单位换算：那边 `Constants.TERRAIN_SCALE = 100`（1 格 = 100 单位）→ **长度 ÷ 100**；
速度是「单位/帧」（25 fps）→ 米/秒要 `× 25 / 100 = ÷ 4`；加速度「单位/帧²」→ `× 625 / 100`。

#### 新增的三类「件」

| `kind` | 是什么 | 渲染方式 |
|---|---|---|
| `debris` | 抛物线飞溅的模型（碎石、火石） | `EffectLayer` + `vel`/`velJitter`/`gravity`，随机自转，**不挂地面光斑**（一次陨石 6 颗会过曝） |
| `flash` | 图集爆闪（`Explotion01` 4×4 = 16 帧） | `SpriteLayer` + `frames`，**每实例克隆纹理**（`offset` 是纹理属性，共用会一起跳帧） |
| `beam.aim` / `anchor:'target'` | 两点之间的一道光 / 贴在目标身上的短电弧 | `BeamLayer` |

#### 逐技能的数值来自哪（全部可对源码）

| 技能 | 补了什么 | 源码依据 |
|---|---|---|
| 2 陨石 | 碎石 ×6（±1.6 m/s、重力 -7.5、寿命 0.64~0.96 s）+ 爆闪 ×4（世界半径 2.2 格、16 帧、橙 `1/0.7/0.35`）+ 火柱 ×3 层（0/0.35/0.7 格、缩放 1/0.75/0.5、3.5/2.8/2.1 s） | `ScrollOfMeteoriteEffect.TriggerImpact` |
| 5 火龙 | 地面片收成 **2×2 格**（原来 3.8 m ≈ 4 格，火「假大」）+ 上升火苗 ×5 | `ScrollOfFlameEffect`：`TerrainBitmapSize = 2f` |
| 8 龙卷风 | 朝目标 **2.4 m/s 匀速**推过去 + **8 rad/s** 自转 + 沿路 `smoke02` 烟 ×6 | `ScrollOfTwisterEffect`：`MoveSpeed = 240`、`StormSpinSpeed = 8`、`LifeFrames = 59` |
| 10 地狱火 | 火石 ×12 分 4 批滴出（半径 0..3 格、**向上加速 3.1 m/s²**，1.6 s 升到 4 格高） | `ScrollOfHellFireEffect.SpawnStone`：`RandFPSCheck(4)`、`gravity += 0.5` |
| 14 毁灭烈焰 | 外圈爆闪 ×8（半径 **2.2 格**、抬高 0.8 格、橙 `1/0.7/0.4`）+ `Spark03` 火花 ×10 | `ScrollOfInfernoEffect.SpawnBursts`：`RingRadius = 220`、`BombZOffset = 80` |
| 42 雷霆裂闪 | 落地冲击波 **1 处**（20 帧、白色）+ `Spark02` 火星 ×10 + 碎石 ×4 | `RagefulBlowEffect`：`_explosion.Scale = 0.5f`、`ExplosionLifeFrames = 20` |
| 43 袭风刺 | **受击者体表电弧** ×6（随机两点之间、0.5 s） | `DeathStabVictimEffect.SpawnLightningBetweenBones`：每 2 帧一道、共 35 帧 |

#### 这一轮修掉的三个真 bug

**1）龙卷风永远留在施法者脚下。**

```ts
// 旧
const t = atSelf ? null : skillTarget;
```

`atSelf` 本来是「要不要跑过去打」的判定（技能 8 的源码相位是 `self`，不用跑），
但**特效本身仍然需要目标** —— 追踪弹的落点、`anchor:'target'` 的锚点全靠它。
跟着一起抹成 `null` 之后，`homing` 那条分支永远进不去。现在改成 `const t = skillTarget`，
每件特效自己按 `anchor` / `homing` / `aim` 决定用不用。验证：放 8 之后读 `__MU_APP__.fx()`，
`at` 从 `(183.9,129.6)` 一路走到 `(185.83,129.5)`（目标 `186.5,129.5`）。

**2）4 层加色爆闪 = 一片死白。** 两个原因叠在一起：

- **没有着色**：源码画爆闪是**带色**画的 —— `Color(1f*alpha, 0.7f*alpha, 0.35f*alpha, alpha)`，
  我们直接拿白贴图加色，4 层叠起来 R/G/B 全部饱和。给精灵层加了 `tint`（与贴图相乘）。
- **淡出曲线不对**：源码是 `alpha = 剩余帧 / 16`，**从第一帧就线性衰减**；
  我们写的是 `fadeIn 0.06 / fadeOut 0.55`，前 45% 生命期都满亮度。
  改成 `fadeIn 0.04 / fadeOut 0.9`。

**3）`Data/Effect` 里有 26 张 OZJ 浏览器解不出来。**

`Data/Effect` 一共 48 个文件 = **44 个 `.OZJ`（JPEG）+ 4 个 `.OZT`（TGA）**。
`new Image().decode()` 的结果：**18 好 / 26 坏 / 4 个 ozt 本来就不归它管**。

> 常被误记成「30/48」：30 = 26 个坏 OZJ + 4 个 `.OZT`。那 4 个是 TGA
> （`blood.OZT` `blood01.ozt` `fi02.OZT` `smoke02.ozt`），一直走 `tryTga`
> 解码，从来不是 bug，别把它们算进坏图。

**坏的 26 张（全部 `.OZJ`）：**

```
Chrome01  Explotion01  Fire01     Flare      JointEnergy01  JointLaser02
JointThunder01         Magic_Circle1         Shiny01        Shiny02
Spark01    Spark02     Spark03    Thunder01  bab2           blur01
eye01      fi01        flare01    lightning  lightning2     motion_blur
motion_blur_r          ring       smoke01    spark
```

**好的 18 张：**

```
Chrome02   DinoE   Fire02  Fire03  Fire04  Flame01  JointLaser01  JointSpirit01
Magic_Ground1      Magic_Ground2     NSkill   PoundingBall  Shiny03
cloudLight clouds  flare02 flareBlue  motion_blur_r2
```

这个影响面远大于技能 —— `Shiny*`、`Spark*`、`smoke*`、`ring`、`Thunder01` 都在用。
表现是 `loadTexture` 退回 TGA 解码、从 JPEG 字节里读出垃圾尺寸，加色混合后**整屏白**
（陨石撞击把整个画面盖住就是这个）。

原因：这 44 个 OZJ 里**每一个都是多个 JPEG 流塞在一个文件里**（`SOI×3`，
`Flare.OZJ` 是 `SOI×4`）—— 但「多 SOI」并不是坏图的原因，**18 张好的同样如此**。
真正的差别在缩略图段链能不能走通：坏的那批是
`APP0(len=16) → APP13(len=2152) → 下一个字节不是 0xFF`，
Chrome 顺着段链走到一半就 `EncodingError`，连主图都读不到。

主图始终在**最后一个 `SOI`** 后面，所以修法是「从最后一个 SOI 往前逐个试」：

```ts
/** 套了缩略图的 OZJ，主图在最后一个 SOI 后面 */
function decodeOzj(bytes) {
  const at = jpegOffsets(bytes);          // 所有 0xFFD8 的位置
  for (let i = at.length - 1; i >= 0; i--) { ... }
}
```

实测 **26/26 全部救回**，尺寸（`tools/tex-decode-scan.mjs` 对账）：

| 文件 | 尺寸 | 文件 | 尺寸 |
|---|---|---|---|
| `Explotion01` | 256×256 | `lightning` | 256×256 |
| `Fire01` | 256×64 | `lightning2` | 128×128 |
| `JointThunder01` | 256×32 | `spark` | 128×128 |
| `Magic_Circle1` | 128×32 | `fi01` | 128×128 |
| `JointLaser02` | 128×32 | `smoke01` / `Thunder01` / `ring` / `Chrome01` / `Flare` / `flare01` | 64×64 |
| `Spark03` / `bab2` | 32×32 | `Shiny02` | 32×64 |
| `blur01` / `motion_blur` / `motion_blur_r` | 32×64 | `Shiny01` | 16×16 |
| `eye01` | 32×16 | `JointEnergy01` / `Spark01` | 8×4 |

注意 `Explotion01` 是 **256×256** —— 4×4 图集正好每帧 64×64，和
`EXPLOSION_ATLAS = { cols: 4, rows: 4 }` 对得上。（早前记的 112×112 是错的。）
同时加了 `looksJpeg` 判断，避免 JPEG 再被当 TGA 解。

#### 验证

```bash
node tools/skill-impact-shots.mjs 2 8 full   # 陨石：碎石/爆闪/火柱逐帧
node tools/skill-impact-shots.mjs 14 3 full  # 毁灭烈焰：外圈爆闪
node tools/skill-probe.mjs offline           # 结构回归（件数/落点/追踪位）
node tools/tex-decode-scan.mjs               # Data/Effect 全量「能不能解」（走原生解码，不经兜底）
node tools/tex-audit.mjs Effect/Explotion01.OZJ   # 单张体检：尺寸 + 4×4 每格均值/纯白占比
```

`skill-impact-shots` 有两个必须知道的坑，都已经在工具里处理：

- **CDP 往返抖动**：`castSkill` 一次 0.1~0.7 s，按「第 N 秒截图」会被整段带偏；
- **特效是延迟生成的**（`castSkill` 里 `window.setTimeout`，实测 1 s 上下），
  所以不能开拍就拍 —— 现在先 `waitFor` 场上真的有件，再拍第一帧。
  另外 `Page.captureScreenshot` 在 SwiftShader 下要 3~4 s（必拍到空场景），
  改用页面内 `renderer.render()` + `canvas.toDataURL()`，往返降到几十毫秒。

### 十七、技能归属：`skill.bmd` 里根本没有职业位

一个常见的误会是「`skill.bmd` 决定谁能用哪些技能」。**不是。**

`skill.bmd` 一条记录就是 40 字节，到第 39 字节（`RequireEnergy`）就结束了：

```
+00  char Name[32]
+32  BYTE RequireLevel
+33  BYTE Damage
+34  WORD ManaUse
+36  WORD BPUse
+38  BYTE Range
+39  BYTE RequireEnergy
```

没有职业字段。客户端拿它只做三件事：显示名字、按蓝耗/BP 扣、按射程判距离。

**职业归属在服务端** `MuServer/Data/Skill/Skill.txt`，第 13..16 列：

```
Index  Name          Damage MP  BP Range Radio Delay Attrib Effect ReqLvl ReqEne  DW DK FE MG
1      "Poison"      12     42  0  6     0     0     1      55     0      0       1  0  0  1
```

`DW DK FE MG` = Dark Wizard / Dark Knight / Fairy Elf / Magic Gladiator，
值 > 0 表示该职业可学（值本身是这一列的技能等级，这里只当布尔用）。

#### 两份数据怎么确认对上的

`Skill.txt` 的 `Poison` 行是 `Damage=12 / MP=42 / BP=0 / Range=6`；
`chs/skill.bmd` 第 1 条解出来是 `b33=12 / w34=42 / w36=0 / b38=6`。逐字节吻合
→ 字段偏移的解释正确，与 `Tools_Source/kayitoTools/.../SkillManager.cs` 的结构声明一致。
顺便确认：这份 0.97k 表里 `+32`/`+39` **全表都是 0**，即没有等级/智力门槛，
所以 `canUse()` 现在只卡职业、不卡等级。

#### 落地

- `src/data/skills.ts` 新增 `SKILL_JOBS`（45 条，照 Skill.txt 誊）+ `canUse()` + `jobOfClassId()`；
  `SkillEntry.jobs` 是「能学这个技能的全部职业」，`job` 只是 `jobs[0]`（面板分组用）。
- **`SKILL_FX[].job` 不再是权威**，只当兜底 —— 它曾经有三处错：

  | 技能 | 原来标的 | 实际（Skill.txt） |
  |---|---|---|
  | 48 生命之光 | 精灵 | **DK**（Greater Life） |
  | 55 玄月斩 | 战士 | **MG**（Fire Slash） |
  | 56 天雷闪 | 战士 | **MG**（Power Slash） |

- 沙盘技能下拉跟着 CHARACTER 卡片的职业走：非本职业技能**留在列表里但禁用**，
  前缀打 `✕`（不直接删 —— 删了会让人以为漏配）。切职业时若当前选中项被禁用，
  自动跳到第一个可用技能。
- 回归里加了对账：`skill-probe` 直接读 `MuServer/Data/Skill/Skill.txt`，
  跟页面里的 `SKILL_JOBS` 逐条比，45 条全等才算过。

#### 誊表时踩的坑

`15 / 42 / 43 / 51` 这四条的对应列是 `2`（DW=2、DK=2、DK=2、FE=2）。
四列是**固定位置**的，某列是 0 也照样占位 —— 第一次誊的时候把后面的值往前挤，
误判成「MG 也能用」，被对账断言当场抓出来（`应[wizard] 实[wizard,mg]`）。
`SKILL_JOBS` 的注释里专门写了这一条。

各职业可用技能数（含 MG，虽然 0.97k 客户端没有魔剑士这个职业）：
DW 17 / DK 12 / FE 13 / MG 24，怪物专用 1 个（50）。

### 还没做

- 0x19（`PMSG_MAGICATTACK`）**没有处理**：联网时服务端广播的「谁对谁放了什么技能」
  既不播动作也不出特效，只有离线沙盘的 Cast 一条路径。包格式
  `[C1][len][0x19][skill_type][caster][target][damage]`（target 的 bit15 = 成功标志），
  源码在 `Combat/Skills.cpp` 的 `PacketHandler_0x19`
- 关节（`Joint_Create`）没有真正的连线渲染器，现在用灵魂火花面片近似
- `Effect_SpawnBombRing`（源码里的轰击环：8 个位置各 `rand()%2 + 197`）还没接；
  毁灭烈焰的**外圈爆裂**已按 `ScrollOfInfernoEffect` 补了（见十六），
  但 0.97k 那条 `SpawnBombRing` 是另一套（贴着地面铺的炸弹环），还没对
- 怪物技能（`*(short*)(o+2) == 288` 那几支）被主动剔除了，敌对怪放技能还没做
- **联机时拿不到角色职业**：`0xF3/0x03` 角色信息包（x/y/map/dir/exp/四维/HP/MP/BP/money/pk）
  里没有 class 字段，`0xF3/0x04` 角色列表也只有 `CharSet[11]`。所以
  `jobOfClassId()` 目前只服务于离线沙盘（职业由沙盘自己选）。
  要按「这个角色的真实职业」限制技能，得先把 class 从角色列表或进图包里解出来
- 箭矢类（`CreateArrows`）仍走「命中特效」，没有实体箭飞出去

---

## 场景物件动画与环境粒子（阶段 AC）

这一阶段把「地图上会动的东西」补齐：物件自己的骨骼动画、物件的火/烟/地光、
以及原版那套跟着主角走的氛围粒子。全部源自 0.97k 源码，不靠猜。

### 一、物件动画：源码只有一个数字

`CreateObject`（0x004FF5A0）给每个场景物体写 `+0x0cc = 0.16`，单位是「帧/帧」；
`MoveObject_PerWorld` 每帧调 `BMD__PlayAnimation(model, frame, …, 0.16)`，
**永远播 action 0**。25 fps 基准下就是 4 帧/秒：

| 物件 | 帧数 | 一轮 |
|---|---|---|
| Tree11 | 31 | 7.8 s |
| Ship01 | 30 | 7.5 s |
| Curtain01 | 26 | 6.5 s |
| Carriage01 | 21 | 5.3 s |
| Candle01 | 7 | 1.8 s |

实现上没有给每个实例建骨架：同 id 的实例**共享一套 Rig**（原版也是同时创建、同速、
同 action，天然同相），每个实例只多一层 `holder` 提供位置/朝向/缩放。

一个实例的每个 mesh = 一个 draw call，蒙皮没法合批。洛兰实测：
Tree11 165 个 + Tree01 80 个 = 490 个 draw call，所以加了
`ANIM_MAX_INSTANCES = 40`：只给船/马车/动物/窗帘/吊灯/街灯/蜡烛/围墙做动画
（89 个实例、250 根骨、251 个 SkinnedMesh），两种树保持静态合并。

### 二、三个踩过的坑（都不是「写法问题」，是「语义问题」）

**① 小数帧 → 全体骨骼停在绑定姿态**

`applyActionFrame` 是按整数帧下标取数组的（`posArr[f*3]`）。播放时传的是
`frame += 0.16*25*dt` 这种小数，`posArr[1.11]` 读到 `undefined`，被 NaN 兜底
变成 0 —— 于是 24 根骨全是单位变换，骨骼矩阵求和恒等于 **96**（24×4），
看上去「没动」。改用插值版 `applyActionPose(rig, 0, frame, true)` 才对。

**② dummy 骨的空数组**

`BmdBone.dummy` 的 `positions/quaternions` 是**空数组**而不是 `undefined`，
`if (!posArr)` 拦不住，随后 `posArr[f*3] * scale` = `undefined * 0.01` = NaN，
整条骨链连带顶点全 NaN。现象是**场景物件整片消失、骨骼矩阵求和是 NaN**。
判据要写成 `posArr.length < keys*3`。

**③ `AttachedBindMode` 会把 holder 抵消掉**

Three 的顶点 = `bindMatrixInverse · boneMatrix · bindMatrix · p`，
而 `SkinnedMesh.updateMatrixWorld` 在默认的 `AttachedBindMode` 下每帧把
`bindMatrixInverse` 覆写成 `inverse(mesh.matrixWorld)` = `inverse(holder)`，
着色器里再乘 `modelViewMatrix`（含 holder）时正好抵消 ——
**所有动画物件都被钉在模型原点**。必须显式
`sm.bindMode = THREE.DetachedBindMode`。

### 三、物件特效：照抄 `FUN_0046c7f0`

`Scene_ObjectUpdate.cpp` 的 World 0 分支逐 id 写死了粒子发射点（偏移是**局部坐标**，
先按物件角度旋转再加位置）。洛兰共 128 个点：

| id | 模型 | 效果 |
|---|---|---|
| 0x32 / 0x33 | FireLight01/02 | 墙上火把，火焰在 `dz = +200 / +60` |
| 0x34 | Bonfire01 | 篝火 |
| 0x37 | DoungeonGate01 | 门两侧各一簇 |
| 0x50 | Bridge01 | 桥头火盆两簇 |
| 0x5a / 0x96 | StreetLight01 / Candle01 | `AddTerrainLight` → 贴地暖光斑 |
| 0x82..0x84 | Light01..03 | `kind = id-0x82` → 火 / 烟 / 烟（模型本身 `HiddenMesh`，不画） |

源码里火是「每帧 50% 概率 spawn 粒子」，我们改成**每个火点几个 billboard 固定循环**
（上升 + 放大 + `sin` 淡入淡出），观感等价、开销恒定。

### 四、环境粒子：`Weather_Update` 的 per-World 表

`src/Render/Weather.cpp` 的 `switch (World)`：

| World | 类型 | 表现 | 本 port |
|---|---|---|---|
| 0 洛兰 | 0xae | 飞鸟（`FixPigeons` 就是它） | ✅ `Bird01.bmd`，6 只绕主角盘旋 |
| 3 诺利亚 | 0xaf | 花瓣 / 雪（`scale = 0.3`） | ✅ 110 片漂移 |
| 10 天空之城 | 0x10a | 萤火（`scale = 2.2`，`x += sin φ·s`） | ✅ 18 只，加色混合 |
| 11..16 | 0xb8 | 落叶 | ✅ 90 片 |
| 7 亚特兰蒂斯 | 0xb6/0xb7 | 南半场跃鱼 | ⬜ 缺鱼模型 |
| 1 / 4 | 0xb0 | 雨 | ⬜ 只在进图过渡态刷 |

源码的生成规则很「跟屁虫」：粒子永远在主角 **±5.12 m** 的方框里生成
（`rand & 0x3ff - 0x200`，单位 cm），离主角超过 15 m（`_DAT_00552d24`）回收。
这里同样做成「跟着主角走、超出半径重生」，只铺视野内的一小片。

漂移粒子用 `THREE.Points` + 自定义 shader（`gl_PointSize = aSize·uScale/dist`），
一类粒子一次 draw call；飞鸟是蒙皮网格，每只一套骨架（共用骨架会 8 只同拍，很假）。

**取景约束**：本作相机是 40° 俯角、36° FOV，屏幕上方只到地平线上一点。
飞鸟半径 4..7 m、离地 2..4 m；花瓣散布半径 13 m。再高就飞出视野了
（第一版 8..14 m / 离地 8 m，6 只鸟全在屏幕外，`project()` 的 y 是负数）。

### 五、验证

```
node tools/object-anim-probe.mjs     # 物件：骨骼矩阵在变、火点 128 个、每帧开销
node tools/ambient-probe.mjs 0       # 氛围：鸟在扇翅+盘旋、每帧开销、整帧截图
node tools/obj-anim-scan.mjs         # 哪些物件带动作（21 类 / 334 实例）
```

实测（洛兰，`?offline`）：

```
骨骼矩阵: {"bones":24,"nan":0,"sum":165.644} → {"sum":165.337}   ✓ 在动
每帧 JS 开销: 物件动画 0.111 ms · 物件特效 0.023 ms · 环境粒子 0.053 ms
drawCall 283 / 三角面 564k / SkinnedMesh 257
```

**不要拿无头浏览器的 FPS 当性能依据**：它跑的是 SwiftShader（CPU 光栅化，
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))`），564k 三角面只有个位数帧率。
能控制的只有「每帧 JS 开销」和「draw call / 三角面」。

### 还没做

- 亚特兰蒂斯的跃鱼（0xb6/0xb7，需要 `Object7` 里的鱼的模型）
- 雨（0xb0）与雨溅（0xbf）、雷云（0x12d，天空之城的 slots 0..2）
- 云/鸟的四段生命周期（`Rise→Hover→Descend→Fade`，源码里会落到地面再被主角惊飞）
- 物件动画只播 action 0，源码的 `SetAction` 分支（比如门开关）没接

---

## 移动命令窗口（M 键，阶段 AD）

按 M 弹出「移动命令」，四列（纷争 / 地图名称 / 等级 / 金币）+ 移动 / 关闭，
选一行回车（或双击、或点「移动」）就传送过去。

### 一、数据源：服务端 `Move.txt` + `Gate.txt`

0.97 客户端没有跨图窗口（原版只能走到 NPC 前面买传送，或者等战士系任务飞），
所以窗口按后期版本的 `MoveCommand` 补。但**表不放客户端**，直接吃服务端的：

```
MuServer/Data/Move/Move.txt   //Index Name Money MinLvl MaxLvl MinRes MaxRes AccLvl Gate
MuServer/Data/Move/Gate.txt   //Index Flag Map X Y TX TY Target Dir MinLvl MaxLvl MinRes MaxRes AccountLvl
```

`Move.Gate` 指向 `Gate.Index`，地图号取 `Gate.Map`，**落点取 Gate 的矩形
`(X,Y)..(TX,TY)`** —— 服务端 `CGate` 就是在这个矩形里随机挑一格，不是挑中心。
这一条把之前「按安全区重心猜落点」的整段猜测换掉了。

| # | 纷争 | 地图（Move.txt 名 → 显示） | mapId | 等级 | 金币 | Gate → 落点矩形 |
|---|---|---|---|---|---|---|
| 1 | 争 | Stadium → 足球场 | 6 | 50 | 3000 | 50 → 72,140..73,181 |
| 2 | | Lorencia → 勇者大陆 | 0 | 10 | 1000 | 17 → 133,118..151,135 |
| 3 | | Noria → 仙踪林 | 3 | 10 | 1000 | 27 → 171,108..177,117 |
| 4–7 | | Devias/2/3/4 → 冰风谷 1..4 | 2 | 20 | 1500–2500 | 22 / 72 / 73 / 74 |
| 8–10 | | Dungeon/2/3 → 地下城 1..3 | **1** | 30/40/50 | 3000/3000/3500 | 2 / 6 / 10 |
| 11–13 | 争 | Atlans/2/3 → 亚特兰蒂斯 1..3 | 7 | 70/80/90 | 4000–5000 | 49 / 75 / 76 |
| 14–20 | | LostTower1..7 → 失落之塔 1..7 | 4 | 50–70 | 5000–6500 | 42/31/33/35/37/39/41 |
| 21–22 | 争 | Tarkan/2 → 死亡沙漠 1..2 | 8 | 140 | 8000/8500 | 57 / 77 |
| 23 | 争 | Icarus → 天空之城 | 10 | 170 | 9000 | 63 → 14,13..16,13 |

**顺手纠正了两个地图号**（以前写错了）：地下城 1/2/3 其实是**同一张图**
（map 1）的三个区域，落点区别在 Gate 上；map 5 是 `Dare Devil`、map 6 是
`Arena`（足球场），以服务端 `MapManager.txt` 为准，不再是「地下城2/3」。

`Move.txt` 没有的列按地图性质补：**纷争**（自由 PK）= 6/7/8/10，
**要翅膀** = 10（天空之城）。等级上限、转生、账号等级三列也解析进来了，
只是 0.97 的 `CharacterInfo` 里没有转生字段，`minReset` 暂时不校验。

判定顺序照服务端：**翅膀 → 等级上限 → 等级下限 → 转生 → 金币**，任何一条不满足
整行变红、点「移动」只抖一下并在底下写原因。离线演示没有角色卡，等级按 0
（= 不校验）、金币按 -1（= 不校验）传进去，所以只有「天空之城要翅膀」这条仍然生效。

### 二、以后接服务端：换的是数据源，不是窗口

表归服务端所有，客户端不能写死。所以「表」和「从哪来」是分开的：

```
src/data/warpTable.generated.ts   ← node tools/gen-warp-table.mjs 从 Move.txt/Gate.txt 生成的快照
        ↓ import（编译期默认值）
src/world/warp.ts                  ← 解析 + 合并成 WarpEntry[] + 同步接口
        ↓ warpTable.onChange()
src/ui/moveCommand.ts               ← 行是动态重建的，表变了自动重画
```

服务端能下发之后，**不用改窗口代码**，二选一：

```ts
// A. 注册 loader，登录后拉一次（返回 null = 这次没新表，继续用旧快照）
import { setWarpTableLoader, syncWarpTable } from './world/warp';
setWarpTableLoader(async () => {
  const [moveText, gateText] = await Promise.all([
    fetch('Data/Move/Move.txt').then(r => r.text()),
    fetch('Data/Move/Gate.txt').then(r => r.text()),
  ]);
  return { moveText, gateText };
});
await syncWarpTable();

// B. 服务端直接把原文推过来
import { warpTable } from './world/warp';
warpTable.applyText(moveText, gateText, 'server');
```

`src/main.ts` 里已经写了一句 `void syncWarpTable()`（没有 loader 时空转）。
表里的 `entry.index` 就是 `Move.txt` 的 Index，将来发 `MapSvrMoveReq` 直接用它。

**没必要用「猜」当主路径了**：`findSpawnTile`（安全区重心）降级成兜底，
只在 Gate 缺表、或者矩形整块被墙/水占满时才接手。
新的 `findSpawnTileInRect` 做三件事：矩形里有能站的格 → 随机挑一格（每次落点不同，
和原版一致）；全被占 → 从矩形中心螺旋外扩 24 格找最近的可站格；还没有 → 交回兜底。

传送还要排除**水**（`TW_WATER`）：亚特兰蒂斯整张图是水，掉水里比掉墙上更难受。

23 条实测落点（`node tools/move-probe.mjs`，全部落在 Gate 矩形内且可站）：

```
足球场 72,140 安全区   勇者大陆 144,135 安全区   仙踪林 173,111 安全区
冰风谷 198, 46 安全区  地下城1 107,247          地下城2 234,126
地下城3   3, 85        亚特兰蒂斯 23, 20 安全区  亚特兰蒂斯2 227, 52
失落之塔1 211, 71 安全区 失落之塔2 244,237       失落之塔7   9, 87
死亡沙漠 203, 58 安全区  天空之城 14, 13
```

### 三、在线模式为什么不放行

0.97 协议里跨图只有**服务端 → 客户端**的 `0xF3/0x03`，没有客户端主动发起的 Warp 包
（本地 `server/` 里也只有 mock，没有传送实现）。本地硬切图会让客户端和服务端的
坐标彻底对不上，之后每次移动都会被判成瞬移，所以在线模式下点「移动」只弹一句提示；
离线演示（`?offline` / 离线演示按钮）才是真的切图。

同图移动不重载世界，只把人挪到落点 + 清掉走位队列（`movePath` / `pathCursor`）；
跨图走 `loadWorld()`，和正常进图完全同一条路径。

### 四、顺手修的两处 NaN（都不是渲染代码的锅，是数据）

**① 地下城2 的地形**

加探针时发现 `地下城2` 每次进图都刷两条
`THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values`。
不是物件、不是骨骼，是**地形本身**：这张图的 `TerrainHeight.OZB` 比
`1084 + 65536` 短 2 个字节，`parseHeight` 越界读到 `undefined`，
`undefined × 0.015 = NaN`，一个顶点就能污染整张地形的包围盒。

`parseHeight` 改成「越界就用前一个有效高度接着填」——只剩最后两个顶点，
肉眼不可见，警告消失。

**② 冰风谷的物件记录**

换图之后 Devias 也刷同样的警告。逐层排查：不是地形、不是骨骼、不是 BMD 顶点，
而是 `EncTerrain3.obj` 里 **2144 条记录中有 2 条 `y = NaN`**（id=86）。
这 2 条记录会被 `matrix.compose(pos=NaN)` 烘进同一桶的合并几何里，
于是那一桶**所有顶点的 y 分量**都变 NaN（378 / 1134 个分量，正好 1/3）。

`createWorldObjects` 现在会在放置前过滤掉坐标/角度/缩放的非法记录
（`stats.bad` 计数，冰风谷 = 2）。它们本来也画不出来，丢掉最干净。

### 五、验证

```
node tools/move-probe.mjs     # 表 → 开窗 → 门槛 → 跨图/同图 → 走遍 23 条验落点 → 服务端同步
```

实测输出（节选）：

```
表: {"source":"builtin","moves":23,"gates":77,"entries":23,"orphans":0}
# 2   勇者大陆     等级  10  金币  1000  gate 17 → 地图  0 [133,118..151,135]  ✓
# 8   地下城1      等级  30  金币  3000  gate  2 → 地图  1 [107,247..110,247]  ✓
#23 争 天空之城     等级 170  金币  9000  gate 63 → 地图 10 [14,13..16,13]  ✗ 需要装备翅膀

角色卡 等级 10 / 金币 100000 / 翅膀 无 → 21 条走不通（缺翅膀被拦）
角色卡 等级 50 / 金币 100000 / 翅膀 有 → 10 条走不通（等级刚好够）
角色卡 等级 200 / 金币 100     / 翅膀 有 → 23 条走不通（金币不足）
走不通时点移动: ✓ 没有传送
冰风谷落点: {"cell":[198,46],"attr":1,"safe":true}   ✓ 在 Gate 矩形内
同图移动: {"x":198.5,"y":46.5} → setPos(140,140) → {"x":211.5,"y":48.5}  ✓ 挪回了落点
#10 地下城3   →   3, 85  ✓ 在 Gate 矩形内  ✓ 可站
服务端同步: {"source":"server",...} → 勇者大陆价格 7777 ✓   （改一行原文，窗口立刻跟着变）
errors: []
✓ 全部通过
```

探针里有 `__MU_APP__.setMoveStatus(level, money, wings)` 模拟角色卡（离线没角色卡，
门槛测不了），`__MU_APP__.syncWarpTable(moveText, gateText)` 模拟服务端推送。

### 六、文件

- 新增：`src/ui/moveCommand.ts`（窗口）、`src/world/warp.ts`（表 + 解析 + 同步接口）、
  `src/data/warpTable.generated.ts`（Move/Gate 快照，`node tools/gen-warp-table.mjs` 生成）、
  `tools/gen-warp-table.mjs`、`tools/move-probe.mjs`
- 改：`src/world/terrain.ts`（`SpawnRect`、`findSpawnTileInRect`）、
  `src/world/maps.ts`（删掉硬编码 `WARP_LIST`；地图名按 `MapManager.txt` 修正 5/6）、
  `src/main.ts`（M 键、Home/End/PageUp/PageDown、`warpTo` 走 Gate 矩形、`loadWorld` 的
  `spawnRect`/`dir`、调试口 `warp`/`warpIndex`/`warpTable`/`syncWarpTable`/`setMoveStatus`）、
  `src/style.css`（`.mv-*`，列表 12 行 + 滚动条）


---

## 城内经济闭环：NPC / 商店 / 仓库 / 丢弃 / 喝药（阶段 AE）

按 `docs/FEATURES.md` 的清单，这一阶段把「服务端有协议、客户端完全没接」的那批
一次性补上：**服务端 46 个协议入口，客户端已完整接入 18 个（本轮新增 9 个）**。

### 一、一条链路看清全部报文

```
点 NPC ──0x30──► 服务端按 NPC Class 分流（NpcTalk.cpp:56 switch）
                   ├ 普通商人 251/254/255/248/250/244/245/246/242/243/230/231/239
                   │    → 0x30 result=0 ＋ 0x31 货架（8×15，最多 120 格）
                   ├ 仓库 240 → 0x30 result=2 ＋ 0x31 仓库 ＋ 0x83 密码状态
                   ├ 混沌 238 → 0x30 result=3
                   ├ 传送 234 → 0x30 result=5
                   └ 血色城堡 232/233、黄金弓箭手 236、Charon 237、守卫 247/249
买    ──0x32 货架格──► 0x32 回执（result = 落点背包槽）＋ 0x22/0xFE 金币
卖    ──0x33 背包槽──► 0x33 回执（result ＋ **出售后总金币**）
修    ──0x34 slot/type──► 0x34 回执（money = **花费**）
存/取 ──0x24 flag 0↔2──► 0x24 回执（slot = 落点格，result 是方向码）
丢    ──0x23 x y slot──► 0x23 回执（**result 1 = 成功**，0 = 失败）
喝药  ──0x26 slot 0xFF──► 0x26/0x27 生命魔法 ＋ 0x2A 堆叠数
关窗口 ──0x31──► 服务端清 Interface.use（不发的话下次对话直接被拒）
```

### 二、6 个真坑（全是语义问题，不是写法问题）

1. **`HackPacketCheck.txt` 第一列是十进制包号**。`50 * 1` 是 **0x32** 要求加密，
   不是 index 50 = 0x50。按十六进制查会得出「0x32 不用加密」，发 C1 后服务端
   判 `encryption error` 并 **CloseClient** —— 表现是「点了买没反应，然后掉线」。
   结论：`0x30/0x32/0x33/0x34/0x23/0x26/0x83` 上行必须 C3；`0x31/0x81/0x82` 才是 C1。
2. **NPC 距离用服务端记的坐标判**。本地瞬移到 NPC 旁边没用，`CGNpcTalkRecv`
   判 > 5 格就静默 `return`（一个字节都不回）。必须真走路把位置同步上去。
3. **商店和仓库是同一个 0x31**。`Warehouse.cpp:270` 直接复用了
   `PMSG_SHOP_ITEM_LIST_SEND`，服务端靠 `Interface.type` 区分，客户端只能靠
   「刚才那条 0x30 的 result」区分。
4. **0x32 的 result 不是布尔**。`0xFF` = 失败，其余 = `InventoryInsertItem`
   返回的**落点背包槽位**；而「买药水叠到已有堆叠」这个成功分支也回 `0xFF`
   （先扣钱再回），唯一判据是「金币包 0x22/0xFE 刚刚到过」。
5. **仓库存取不能传 0xFF**。`MoveItemToWarehouseFromInventory` 第一句就是
   `WAREHOUSE_RANGE(TargetSlot)`，0xFF 直接非法。落点要客户端自己算（`firstFreeGrid`）。
6. **卖/丢/存取服务端都不重发背包表**，只回一个 result。物品变动得客户端自己删/插 ——
   原版 `case 0x32/0x33` 也是这么干的。仓库更绕：`0x24` 的 `slot` 才是落点，
   `result` 只是「2 = 背包→仓库」这种方向码。

### 三、界面

`src/ui/npcPanel.ts` 一个面板两用（服务端本来就是同一个报文）：

- 版式：左侧 `x=4..184`，与右侧背包（`450..640`）正好一人一边
- 8 列 × 15 行 = 120 格，格宽 20px，与原版 `SHOP_SIZE` / `WAREHOUSE_SIZE` 同一套 `y*8+x` 索引
- 多格物品按 `itemAttr` 的 w/h 铺开（和背包同一套规则），药水画堆叠数
- 商店模式底部「修理全部」（0x34 type=1），仓库模式底部「存金币 / 取金币」（0x81）

### 四、验证（真实服务端，不是沙盘）

```bash
node tools/npc-probe.mjs
```

```
进图：1234 map=0
  ✓ 找到商人 Lumen（Class 255）  id=0
  ✓ 0x30 result=0 → 0x31 商店列表  标题「Lumen the Barmaid」19 件
  ✓ 买入：金币减少  9130475 → 9109315
  ✓ 买入：物品进背包（新格或叠加）  24 → 25 件，type 449 数量 255 → 510
  ✓ 卖出：金币回涨  9109315 → 9116365
  ✓ 0x31 关闭商店界面
  ✓ 找到仓库守卫（Class 240）  id=7
  ✓ 0x30 result=2 → 仓库面板  mode=warehouse 仓库 1 件
  ✓ 存入：背包 -1  24 → 23      ✓ 存入：仓库 +1  1 → 2
  ✓ 取出：背包恢复  23 → 24     ✓ 取出：仓库 -1  2 → 1
  ✓ 丢弃：背包 -1  24 → 23
  ✓ Q 键喝药（0x26 使用物品）  药水总量 255 → 254
  ✓ 聊天命令 /post 被服务端处理并回显  聊天框 3 → 4 行
结果：通过 17 / 失败 0
```

`/post` 那条同时能在服务端 `COMMAND_LOG/` 和 `CHAT_LOG/` 里看到记录 ——
31 条 `Command.txt` 里的命令（`/move /post /str /agi /vit /ene /reset /pkclear
/addmoney /make /drop /clearinv /skin …`）**客户端一行代码都不用写**，
聊天框发什么服务端就执行什么。

### 五、文件

- 新增：`src/ui/npcPanel.ts`、`tools/npc-probe.mjs`、`docs/FEATURES.md`
- 改：`src/net/game.ts`（0x30–0x34 / 0x23 / 0x26 / 0x81–0x83 的编解码，`buildItemMovePacket`
  加 `flags`）、`src/main.ts`（NPC 点击与走位、买卖存取丢弃、Q/W/E、双击、调试口
  `npcs/talk/talkClass/npcPanel/buy/sell/store/take/drop/closeNpc/chatLines/money`）、
  `src/ui/inventory.ts`（`onClick` / `onDiscard`）、`src/ui/hudValues.ts`（导出 `QUICK_RANGES`）、
  `src/style.css`（`.npc-*`）

### 六、下一步（清单里的 P0/P1）

见 `docs/FEATURES.md` 第三节。最值得先做的三项：

1. **0x19 联机技能广播**（现在联机时看不到别人放技能）
2. **0xF3/E6 事件倒计时**（服务端一直在推，客户端还没画）
3. **任务 0xA0 / 0xA2**（`Quest.txt` 9 条，NPC 侧已经打通）

---

## 仓库/商店 UI 对齐 Win 端 + 技能广播 + 事件倒计时（阶段 AF）

### 一、仓库/商店面板改成原版版式

上一阶段（AE）的面板是自己用 CSS 摆的，这一阶段换成**逐像素照抄 Win 端**
（`RenderWarehouse` HUD_Pass6.cpp:1654 / `RenderShopInterface` :1426）：

| 元素 | 原版数字 | 本 port |
| --- | --- | --- |
| 面板原点 | `dword_7EAA0C8 = 260`, `dword_7EAA0CC = 0` | 同 |
| 底板 | `Item_Back01` 190×256 @(0,0) + `Item_Back02` 190×177 @(0,256) | 同（总高 433） |
| 标题 | `RenderText(dword+35, dword+12)`，`GlobalText[230]` / `[234]+" (Open|Close)"` | (35,11)，`商店` / `仓库 (开启|锁定)`；上锁时字变黄 |
| 网格 | `RenderItemsBoxes(dword+15, dword+50, …, 8, 15)` | (15,50)，8×15=120 格，格 20px |
| 格子底色 | 277 `Item_box` / 278 `InventoryBox2` | 同 |
| zen 条 | `Item_Money`(271) @(dword+50, dword+352.7) 113×18 | 同 |
| zen 文字 | 标签 @(dword+20)、金额 @(dword+60)，y=355 | 同；金额按原版分级变色（≥100K 绿 / ≥1M 橙 / ≥10M 红） |
| 税费 | 标签 `GlobalText[266]` @(dword+50,374)、金额 @(dword+120,374) | `仓库费用`，公式与服务端 `GetWarehouseTaxMoney` 一致 |
| 按钮 | `{26,76,126}+dword` @y=390，24×24 | 存 zen `Money_01/02`、取 zen `Money_01/02`、锁 `Lock_01..04` |

贴图索引是查源码里的 `OpenJPG` 得到的（`Model/Model_SkillEffects.cpp`）：

```
271 → Interface\Item_Money.jpg    272/273 → Money_01/02.jpg
294..297 → lock_01..04.jpg        260/261 → Item_Back01/02
277/278 → Item_box / InventoryBox2
```

**版面自检工具**：`node tools/ui-layout-probe.mjs` —— 打开商店和仓库，把每个元素的
逻辑坐标/尺寸打出来，对照上表，比截图量像素快。

### 二、联机技能广播（0x19）

```
下行 C3 08 19 [skill] [casterHi] [casterLo] [targetHi|命中标志] [targetLo]
```

三处容易错的语义（都写进 `net/game.ts` 注释了）：

1. `skill` 是**技能号**（= `skill.bmd` 下标），直接查 `SKILL_FX` 拿特效文件；
2. `target` 高字节 **bit7 是「命中成功」**，不是 PvP 标记 —— 取 id 要先 `& 0x7F`；
3. 服务端 `DataSend(lpObj->Index, …)` **会给自己也抄送一份**，所以
   `casterId === selfId` 必须跳过，否则本地施法会双播（动作闪两下、特效叠两层）。

收到后做三件事：转身朝目标（`yaw = atan2 + π/2`，因为角色模型本地朝 -Y）、
播施法动作（特效表配了就用，否则 82/83）、延迟后在目标处 `effects.spawn`
（特效模型的角度约定是「0 = +X」，所以给它的 `yaw` **不要**加 π/2）。

上行 `buildSkillAttackPacket(skill, targetId)` 也备好了（`C3 06 19`），
但注意服务端 `CGSkillAttackRecv` 第一道关就是**安全区不能放技能**
（`CheckAttr(x,y,1) != 0` 直接 return），在城里测会「毫无反应」。

### 三、事件倒计时（0xF3/0xE6）

服务端**每秒**推一次整表（`CEventTimeManager::GCEventTimeSend`），7 条左右：

```
Devil Square / Blood Castle / Death King / Red Dragon / Golden
Happy Hour / Golden Archer Bingo
```

条目 **40 字节**：`name[32] + status(1) + pad(3) + time(4)` —— 不是 37，
`DWORD` 要对齐到 4（实测包长 286 = 6 + 7×40）。

status：`0 BLANK` 不显示、`1 STAND` 倒计时到开始、`2 OPEN` 可入场、`3 START` 进行中。
客户端只收到「那一刻的剩余秒数」，之后本地每秒递减（`src/ui/eventTimer.ts`）。

0.97 的 Win 端**没有这块 UI**（源码只解包不显示），位置是本 port 定的：
左上角 (8,6)，避开右侧背包（450..640）与底部聊天框。

### 四、顺带修掉的一个真 bug：`selfId` 一直是 -1

以前靠「0x12 视野包里名字等于自己」来认自己 —— **这条路在真机上永远走不通**：
服务端 `CViewport::CreateViewportPlayer` 里 `n == aIndex` 直接 `continue`，
**从来不会把自己发给客户端**。

后果：「别人打我」「自己放技能被抄送一份」「自己的移动广播」这些判断全部失效
（虽然多数被下游的 `remotes.get(id) === undefined` 兜住了，但那是碰巧）。

正确来源是握手包 `0xF1/0x00`（`PMSG_CONNECT_CLIENT_SEND`）：

```
C1 0C F1 00 [result] [indexHi] [indexLo] [version × 5]
```

实测拿到 `c1 0c f1 00 01 23 28 30 39 37 31 31` → index = 0x2328 = **9000**，
正好等于 `OBJECT_START_USER = MAX_OBJECT - MAX_OBJECT_USER = 10000 - 1000`，
玩家槽从 9000 开始，完全对得上。

### 五、验证

```bash
node tools/skillcast-probe.mjs      # 事件倒计时 + 0x19（10 项）
node tools/npc-probe.mjs            # 商店/仓库/丢弃/喝药/命令（17 项，回归）
node tools/ui-layout-probe.mjs      # 面板坐标对照
```

```
✓ 收到 0xF3/0xE6 事件表  7 条
✓ 左上角画出倒计时行  7 行
✓ 技能 4（火球）取到特效 Fire01.bmd
✓ 技能 7（冰封）取到特效 Ice01.bmd
✓ success 标志（target 高字节 bit7）解析正确
✓ caster 是自己/不存在时不施法  skipped=self selfId=9000
✓ 未知技能号（99）只播动作、不出特效
结果：通过 10 / 失败 0
```

### 六、文件

- 新增：`src/ui/eventTimer.ts`、`tools/skillcast-probe.mjs`、`tools/ui-layout-probe.mjs`
- 重写：`src/ui/npcPanel.ts`（CSS 自绘 → 原版贴图版式）、`src/style.css` 的 `.npc-*`
- 改：`src/net/game.ts`（`parseSkillCast` / `buildSkillAttackPacket` / `parseEventTime`）、
  `src/net/session.ts`（`selfIndex`）、`src/main.ts`（0x19 / 0xF3E6 处理、
  `playRemoteSkill`、`warehouseTax`、调试口 `skillDebug`/`eventTimer`/`testSkill`/`castSkillAt`）

### 七、下一步

清单（`docs/FEATURES.md`）里 P0 只剩「技能门槛校验（蓝耗/冷却/学习条件）」和
「施法入口（选技能 → 发 0x19）」。P1 依次是：任务 0xA0/0xA2、组队 0x40-43、
战盟 0x50-61、交易 0x36-3D、混沌 0x86-88。

---

## 技能特效全量盘点与补全（阶段 AG）

### 一、先量，再补

写了个盘点工具 `tools/skill-visual-probe.mjs`：45 个技能逐个施法，
**读六个特效层的存活数量**（而不是看像素差分）：

| 层 | 来源 |
| --- | --- |
| `model` | `Data/Skill/*.bmd`（`EffectLayer`） |
| `sprite` | `Data/Effect/*.ozj|ozt` 序列帧 / 光斑（`SpriteLayer`） |
| `beam` | `Joint_Create` 两点光束（`BeamLayer`） |
| `trail` | 武器拖尾（`TrailLayer`） |
| `wheel` | 武器旋转（源码 238 `RenderWheelWeapon`） |
| `slam` | 武器砸地（源码 244 `ItemDrop_RenderGroundWeapon`） |

**为什么不用像素差分**：沙盘的相机会跟着角色贴到靶子面前（`castSkill` 里
`muCamera.setTarget + update(1.5)`），角色一动整屏位移，差分动辄 60%；
而角色自己的挥砍动作也有 7~12% 差异 —— 两条都会把「无特效」判成「有」。
换成结构计数后，判据才和「画面上有没有东西」对齐。

### 二、45 个技能的盘点结果

```
合计 45：有视觉 44，无视觉 1（来源：client 31 / fallback 13 / none 1）
无视觉：50:怪物区域攻击(none)   ← 怪物技能，玩家侧用不到
```

明细见 `shots/skill-visual.json`。几个值得记的：

| 技能 | 层 | 说明 |
| --- | --- | --- |
| 2 陨石 | 7 模型 + 7 贴图 | 陨石 + 碎石 + 地面火环 |
| 10 地狱火 | 14 模型 | 火环一圈 |
| 14 毁灭烈焰 | 1 模型 + 18 贴图 | 爆裂 + 外圈 |
| 48 生命之光 | 72 贴图 | 金色粒子最多的一条 |
| 43 袭风刺 | 2 模型 + 9 光束 | 体表电弧 |
| 41 霹雳回旋斩 | 1 武器旋转 | 只转武器，没有独立特效模型 |

### 三、补全的五个战士技能

源码里 19..23（地裂斩 / 牙突刺 / 升龙击 / 旋风斩 / 天地十字剑）在三条路径
（`MoveCharacter` 的 `switch(skill)`、`switch(skillId)`、`AttackStage`）里
**都没有 `CreateEffect`** —— Win 端靠「实体武器 + 材质拖影」撑观感，
H5 的刚体蒙皮 + 折线拖尾视觉重量差太多，实测「只播动作」几乎没有反馈。

所以把它们从 `NO_VISUAL` 里移出来，走 `SKILL_FX` 的**表现兜底**，
每个挑一件语义最贴的现成资源（都在 `Data/Skill` 里，纹理齐全）：

| 技能 | 借用 | 理由 |
| --- | --- | --- |
| 19 地裂斩 | `Earthquake02.bmd` | 地裂冲击，贴地 |
| 20 牙突刺 | `Piercing.bmd` | 贯穿尖刺 |
| 21 升龙击 | `Blast01.bmd`（lift 1.2） | 向上爆开 |
| 22 旋风斩 | `Storm01.bmd`（`at: self`） | 环绕旋风 |
| 23 天地十字剑 | `Kcross.bmd` | 十字光 |

这五条在 `castOf()` 里是 `source: 'fallback'`（面板标「兜底」），
想恢复「严格照抄源码」只要把 19..23 加回 `NO_VISUAL` 即可。

### 四、顺手修掉两个探针的采样 bug

盘点一开始在「41 霹雳回旋斩」和「8 龙卷风」上给出假阴性，查下来都是探针的问题：

1. **`fxWheels()` / `fxSlam()` 返回的是实例数组**，不是 `{active}` 对象。
   按 `.active` 读永远是 `undefined` → 41 号明明在转武器，却被判「无视觉」。
2. **三层分三次取**（`fx()` / `fxSprites()` / `fxBeams()` 各一次 CDP 往返），
   中间隔了 2 次网络往返。龙卷风的贴图寿命只有 0.5 s，常常「模型读到了、
   贴图已过期」→ 断言 `1+0 ≠ 1+6`，约五分之一概率假失败。
   改成一次 eval 里原子快照 + 轮询 2 秒取峰值后稳定。

### 五、验证

```bash
node tools/skill-visual-probe.mjs       # 45 个技能盘点（约 3 分钟）
node tools/skill-probe.mjs offline      # 旧的全量断言：279 / 0
npm run build                           # 21.6s
```

```
合计生成 62 个模型特效 / 181 个贴图特效
全部通过：✓ 279 / ✗ 0
```

（贴图特效总数从 175 涨到 181：补的 5 个战士技能各带 1 件，其余是采样稳定后
原本偶发漏计的部分被捞回来了。）

### 六、文件

- 新增：`tools/skill-visual-probe.mjs`（六层盘点）、`shots/skill-visual.json`
- 改：`src/data/skillFx.ts`（`NO_VISUAL` 只留 50 + 一段「为什么放出来」的依据）、
  `src/data/skills.ts`（21 改 `Blast01`、22 改 `Storm01` 并加 `at: 'self'`）、
  `src/main.ts`（`setActorsVisible` 调试口）、`tools/skill-probe.mjs`（原子采样）

---

## 精灵的箭矢：CreateArrows（阶段 AH）

### 一、先说清楚：Dark Wizard 不是"没修"

上一轮补的 19..23 是**战士**技能，但 DW 和 FE 也逐个查过了：

| 职业 | 技能 | 源码里的样子 | 本 port |
| --- | --- | --- | --- |
| DW | 1/2/4/5/7/8/9/10/11/12/13/14/16/17 | `MoveCharacter` 两个 dispatch 都有 `CreateEffect` | ✅ 源码驱动（34 个 client 技能就是它们） |
| DW | **3 掌心雷** | case 0x03 只有 `PlayBuffer(60)` + 打断目标动作 | 兜底 `Laser01`（源码无特效） |
| DW | **6 瞬移 / 15 小挪移** | 只有 `CreateTeleportBegin/End`（模型上移淡出） | 兜底魔法阵（源码无特效模型） |
| DW | **18 圣盾防御** | 0x19 里无分支 | 兜底 `Protect01` |
| FE | **24 多重箭 / 51 冰封箭 / 52 穿透箭** | **`CreateArrows`（投射物实体）** | ❌ **本轮之前完全没有箭** |

也就是说：DW 那四个是「源码本来就没有特效」（和战士 19..23 同性质，已经用兜底补过视觉）；
**FE 的三个才是真缺** —— 源码明确要生成箭矢实体，我们一支都没发。

### 二、`CreateArrows` 到底是什么

`Combat/Combat_Projectiles.cpp`：

```
CreateArrow(c, o, to, SkillIndex, Skill, SKKey)
  ├ 按**武器模型号**选箭矢模型（不是按技能！）
  │   528/529 → ArrowSteel   530 → ArrowSaw     531 → ArrowLaser
  │   532 → ArrowThunder     533 → ArrowWing    534 → ArrowBomb
  │   536/538 → ArrowDouble  其余弓 → Arrow01
  └ CreateEffect(model, oPos, oAngle, …, o)   ← 绑定施法者，从弓上飞出去

CreateArrows(...)
  Skill == 1 → 中心 1 支 + 左右各 1 支（±_DAT_00552834 ≈ 8°）→ **三连**
  Skill == 2 → 五连
  其余（51/52）→ 单支
```

调用点（`MoveCharacter`）：
- 普攻：`o+261` 是动作 46..49/54/55（拉弓/放箭）→ `CreateArrows(..., 1, skill)`
- `case 24` → `CreateArrows(..., Skill=1)` → 三连
- `case 51/52` → `CreateArrows(..., Skill=51/52)` → 单支

### 三、实现

`src/main.ts` 新增 `shootArrows(count, dest)`：

```ts
function arrowModelOf(weaponType) { … }        // 按武器 model+400 选箭矢 BMD
function isRangedWeapon() { … }                // bow / crossbow
function shootArrows(count, dest) {
  // 起点 = 角色手上的位置；三连/五连按 ±0.14 rad 散开
  // 每支用 effects.spawn(箭模型, 手部, { yaw, flyTo: dest, flyTime: dist/34 })
}
```

接入两处：
1. **普攻**：`tryAttack()` 里，武器是弓/弩 → 动作起手 120 ms 后放 1 支
2. **技能**：`castSkill()` 里 `BOW_SKILLS`（24/51/52）→ 直接放箭并 `return`，
   不再走 `SKILL_FX` 的兜底模型（以前是"一坨箭头飞过去"，且多重箭只出 1 支）

`castOf()` 里这三个技能的 `parts` 现在是**空**（源码确实没有原地特效），
`note` 写着「源码走 CreateArrows → 由 shootArrows 发箭」。

### 四、验证

```bash
node tools/arrow-probe.mjs              # 箭矢专项（9 项）
node tools/skill-probe.mjs offline      # 全量回归：273 / 0
node tools/skill-visual-probe.mjs       # 六层盘点 + 箭矢列
```

```
✓ 多重箭（24）放 3 支箭  实际 3 支 Arrow01.bmd,Arrow01.bmd,Arrow01.bmd
✓ 冰封箭（51）放 1 支箭  实际 1 支 Arrow01.bmd
✓ 穿透箭（52）放 1 支箭  实际 1 支 Arrow01.bmd
飞行轨迹样本: (187.8,129.3) → (188.9,129.2) → (192.3,129.1) → (195.7,129.0) → (205.9,128.7) → (213.9,128.5)
✓ 箭矢在飞（>0.5 m 位移）  位移 26.13 m
✓ 箭矢命中后自动销毁  还剩 0 支
结果：通过 9 / 失败 0
```

盘点表新增「箭」列：

```
 24  多重箭      client    3  0  0  0 0 0  3   有
 51  冰封箭      client    1  0  0  0 0 0  1   有
 52  穿透箭      client    1  0  0  0 0 0  1   有
合计 45：有视觉 44，无视觉 1（client 34 / fallback 10 / none 1）
```

### 五、又抓到两个探针的时序坑

1. **异步 spawn 落在清场之后**：`effects.spawn` 要加载 BMD，上一技能的箭/碎石
   可能在 `fxClear()` **之后**才挂进场景 → 被算进下一个技能（守护之光被数出
   3 个 `Arrow01`）。改成「清两次、中间等 320 ms」。
2. **箭数读得太早**：箭在 `castSkill` 的 `setTimeout`（前摇 260 ms）里才发，
   立即读 `arrows().last` 拿到的是上一个技能的数字（冰封箭被读成 3 支）。
   改成轮询到匹配为止。

### 六、文件

- 新增：`tools/arrow-probe.mjs`
- 改：`src/main.ts`（`arrowModelOf` / `isRangedWeapon` / `shootArrows` / `arrowDebug`，
  普攻与技能接入，调试口 `arrows` / `fxArrows` / `testArrows`）、
  `src/data/skillFx.ts`（`BOW_SKILLS` 改为导出；三技能 `parts` 置空并注明走投射物）、
  `tools/skill-probe.mjs`（清场两次 + 箭数轮询 + 两条过期断言）、
  `tools/skill-visual-probe.mjs`（新增「箭」列）

---

## 箭矢朝向/粗细 + 法师技能表现修正（阶段 AI）

### 一、箭矢为什么是「↓↓」而不是「→→」

`Arrow01.bmd` 的**顶点**长轴在模型空间是 **+Z**（8.7cm × 8.7cm × 86cm），
但它的骨骼绑定把这份几何转到了世界的 **-Y**。把实时的「模型本地 +Z 在世界上指向哪」
读出来（新增的 `EffectSnapshot.axis` 字段）就能确认：

```
yaw = 0            → axis = (0, -1)   ← 屏幕上朝下
yaw = atan2(dy,dx) → 箭身整体歪 90°
```

`effects.spawn` 的 `yaw` 是「绕世界竖轴、0 = +X」，而箭身实际是
`axis(θ) = (sinθ, -cosθ)`，要它等于飞行方向 `(cosφ, sinφ)` 就得 **θ = φ + π/2**：

```ts
const ARROW_YAW_OFFSET = Math.PI / 2;   // Arrow 系列专用，其它特效模型不要套
```

> 顺带踩过一次：先按「模型长轴 +Y」推成 `-π/2`，实测 `axis=(-1,0)` —— 箭是**倒着飞**的。
> 结论：轴向不要靠推测，读 `axis` 或者读蒙皮后的包围盒。

### 二、箭矢加粗

`Arrow01` 的横截面只有 **8.7 cm**，在 Win 端 800×600 的近景镜头里刚好，这个 port
的默认镜头更远，箭细得像根线。`effects.spawn` 原来只有等比 `scale`，新增**分轴**
`scale3`：

```ts
const ARROW_SCALE3 = [2, 1.15, 2];  // 横截面 ×2（17cm），长度只 +15%
```

（`scale3` 在 `scale` 之后乘，直接写进 `root.scale`，蒙皮顶点跟着骨骼矩阵走，不会被丢掉。）

### 三、联机时别人放箭

`0x19` 收到精灵的 24/51/52 时，以前查 `SKILL_FX` 得到的是「空 parts」→ 什么都不出。
现在在查表**之前**判 `BOW_SKILLS`，用施法者自己的手部位置发箭（远程实体的武器
明细服务端不下发，箭矢模型退回 `Arrow01`）：

```ts
shootArrows(ev.skill === 24 ? 3 : 1, dest, { actor: caster.actor });
```

`shootArrows` 因此多了第三个参数 `origin`，默认仍是自己。

### 四、法师（DW）5 个技能：二进制没错，是 port 画错了

依据 `Net/SecondPassword.cpp` 的 `switch ((char)v328)`（施法者自己那条路径）：

```
case 11  CreateEffect(203,  o+16, Angle, …, 0, nullptr)   // o+16 = 施法者位置
case 17  CreateEffect(1180, o+16, Angle, …, 0, Owner)     // 同上
```

两处都只在**施法者身上生成一次**，位移由 `MoveEffect` 按 `Angle` 推进 ——
也就是「一波推出去 / 一颗球飞出去」。port 之前把 `at: 'self'` 理解成「原地不动」，
于是真空波变成脚下一圈雷、能量球变成脚边一团光。

| 技能 | 之前 | 现在 |
| --- | --- | --- |
| 11 真空波 | `Magic02` 静止在脚下 | `Magic02` 从施法者飞向目标（`homing`, 20 m/s） |
| 17 能量球 | `Thunder01` 贴图静止（贴图层没有位移能力） | `Ball01` 实体飞向目标（17 m/s） |
| 3 掌心雷 | `Laser01` 光柱立在目标身上 | 施法者→目标一道雷（`JointThunder01`）+ 命中雷光/电花 |
| 6 瞬间移动 | `Magiccircle01` 模型 | 地面法阵（`Magic_Circle1`，反向自转）+ 4 道升腾光 |
| 15 小挪移 | 同上 | 同上，范围更大（法阵 3.8 m、6 道升腾光） |

3/6/15 在二进制里**确实没有 `CreateEffect`**（case 3 只有 `PlayBuffer(60)` + 打断目标动作；
6/15 走 `CreateTeleportBegin/End` 的模型升降淡出），所以它们仍是 `fallback`，
只是换了更像原版的素材。面板上标「兜底」，注释里写明依据。

为此补了两个能力：

- `FxPart.rise`（贴图每秒上浮多少米）—— 瞬移的「升腾感」，之前是写死 0.18；
- `FxPart` 的 `homing/flySpeed` 复用到 sprites 之外的模型（本来就有，这次只是用上）。

### 五、验证

```bash
node tools/dw-skill-probe.mjs      # 法师 5 技能 + 箭矢回归（19 项）
node tools/arrow-probe.mjs         # 箭矢专项（10 项）
node tools/skill-probe.mjs offline # 全量技能（270 / 0）
node tools/skill-visual-probe.mjs  # 45 技能盘点
```

```
✓ 掌心雷：画出了一道雷  JointThunder01.OZJ len=2.61m
✓ 掌心雷：雷从施法者连到目标  雷长 2.61m vs 距离 2.60m
✓ 掌心雷：不再用 Laser01 光柱兜底  模型 无
✓ 瞬间移动：脚下有地面法阵  Magic_Circle1.OZJ size=3.2 kind=ground
✓ 小挪移：法阵尺寸 3.5m 以上  size=3.8
✓ 真空波：位置在推进（>0.5 m）  位移 2.60 m / 12 帧
✓ 能量球：朝目标靠近  起点距施法者 0.00m，终点距目标 0.00m
✓ 箭矢朝向与飞行方向一致  flyYaw=0.095 modelYaw=1.6658（差 π/2）
✓ 箭身长轴与飞行方向一致（不是歪 90°/反向）  点乘 1.000
结果：通过 19 / 失败 0
```

### 六、文件

- 新增：`tools/dw-skill-probe.mjs`
- 改：`src/main.ts`（`ARROW_YAW_OFFSET` / `ARROW_SCALE3` / `shootArrows(origin)` /
  `playRemoteSkill` 的弓箭分支 / 贴图 `rise`）、
  `src/data/skillFx.ts`（`WIZARD_FIX` 五条修正、`FxPart.rise`）、
  `src/world/effects.ts`（`SpawnOptions.scale3`、`EffectSnapshot.axis`）、
  `tools/arrow-probe.mjs`（朝向与加粗断言）、`tools/skill-probe.mjs`（快照求值容错）

---

## 服务端入口补全（阶段 AJ）：拆堆叠 / 单件修理 / 仓库密码

这一轮把 `Protocol.cpp` 里「服务端早就支持、客户端还空着」的三条接上，
并补了它们缺的 UI（一个通用输入框）。

### 一、0x2B 拆堆叠

```
上行 C1 06 2B 00 [SourceSlot] [Count]
```

- `PSBMSG_HEAD` 是 **4 字节**（type/size/head/subh=0），所以 slot 在偏移 4；
- `HackPacketCheck` 第 43 行 Encrypt=0 → **C1**；
- 服务端 `CGItemStackUnstackRecv` 的约束：`Count < durability`、`Count < MaxStack`、
  每拆一个都要有空位（`InventoryInsertItem`）；
- **服务端是逐个插入**：`for (i=0;i<Count;i++) InventoryInsertItem(..., m_Durability = 1)`，
  所以拆 4 个得到 **4 件单件**，不是一堆 4 个（探针最初就按「一堆 4」断言，红了）；
- 成功后服务端 `GCItemListSend` 重发整张背包表 → **客户端不需要自己改本地快照**。

交互：**Shift + 左键**点背包物品 → 输入框问数量（原版是 Shift 拖到空格；
H5 里拖拽已经给了「换位」，再叠 Shift 容易误触）。

### 二、0x34 单件修理

`CGItemRepairRecv`：`C1 05 34 slot type`，`type 0 = 单件`、`type 1 = 全部`。
面板底部「修理全部」早就有了，单件补在**商店内右键物品**上
（商店里左键已经是「卖」、拖拽是换位，右键当上下文菜单最直观）。

> ⚠️ 修理费随等级暴涨：探针早期随便挑一件修，几轮下来把测试账号 9M 金币修光了。
> 现在探针只修**等级最低**的装备，并断言「扣费 ≤ 10 万」。

### 三、0x83 仓库密码（UI 补齐）

```
上行 C3 10 83 [type] [password:2 LE] [personalCode:10]
下行 C1 04 83 [state]
```

| type | 含义 | 服务端条件 |
| --- | --- | --- |
| 0 | 用密码解锁 | 必须已上锁；密码对 → state 12，错 → 10 |
| 1 | 设置密码 | 必须未上锁；要**账号个人码**，错 → 13 |
| 2 | 取消密码 | **只校验个人码**（不看旧密码）→ 忘了密码的出路 |

state：`0` 无密码 / `1` 已上锁 / `10` 密码错 / `11` 已上锁不能再设 / `12` 已解锁 / `13` 个人码错。

UI 行为：
- 仓库面板点 **锁按钮** → 弹输入框；
- 已上锁：`密码` + `个人码` 两个字段，按钮「解锁 / 取消密码 / 取消」；
- 未上锁：`新密码` + `个人码`，按钮「设置」（有过密码时多一个「取消密码」）；
- 结果码统一走 `0x83` 下行 → 聊天框 + 面板 toast，并刷新标题（上锁时标题变黄）。

### 四、通用输入框（`src/ui/dialog.ts`）

拆堆叠和仓库密码共用一个组件：标题、若干字段（可数字过滤 / 圆点遮罩）、
最多三个按钮、Enter 确认、Esc 取消、点遮罩取消。

**为什么不用 `window.prompt`**：
1. 全屏游戏里它会挡住 canvas，浏览器还可能「阻止此页面创建更多对话框」静默吃掉；
2. 弹窗期间 `keydown` 被浏览器接管，关掉后游戏收不到 `keyup`，
   `keys` 集合里 WASD 仍是按下状态 —— 角色会自己一直走。

### 五、验证（真实服务端）

```bash
node tools/econ-probe.mjs     # 新增：拆堆叠 / 单件修理 / 仓库密码（16 项）
node tools/npc-probe.mjs      # 回归：商店/仓库/丢弃/喝药/命令（17 项）
```

```
✓ 拆堆叠：原堆减少 4  255 → 251
✓ 拆堆叠：多出 4 件（服务端逐个插入，每件 1 个）  背包 27 → 31 件
✓ 单件修理：连接没被断开  slot=18 lv=0
✓ 单件修理：扣费合理（≤10 万）  19978840 → 19978840（花 0）
✓ 仓库状态已下发（0x83）  state=0
✓ 密码框标题随锁状态变化  「仓库密码」
✓ 设置密码：服务端有明确回应（1=上锁 / 13=个人码错）  state=1
✓ 上锁后仍能打开密码框（含「取消密码」）
✓ 取消密码：恢复成未设置  state=0
结果：通过 16 / 失败 0
```

（探针跑完会把测试密码取消掉，不污染账号。）

### 六、文件

- 新增：`src/ui/dialog.ts`、`tools/econ-probe.mjs`
- 改：`src/net/game.ts`（`buildUnstackPacket`）、`src/ui/inventory.ts`
  （`onClick` 带 `mods.shift`）、`src/main.ts`（拆堆叠/单件修理/密码框、0x83 下行状态、
  调试口 `dialogOpen/openSplit/openWarehousePassword/repairOne/warehouseState`）、
  `src/style.css`（`.dlg-*`）

### 七、还没接的服务端入口

按工作量排序：**任务 0xA0-0xA3**（`Quest.txt` 9 条 + 目标/奖励表）、
**组队 0x40-43**、**混沌合成 0x86-88**、**交易 0x36-3D**、**战盟 0x50-61**、
**事件入场 0x90/0x9A**、**黄金弓箭手 0x95/0x97/0x9D**。

---

## 服务端入口补全（阶段 AJ）：拆堆叠 / 单件修理 / 仓库密码

这一轮把 `Protocol.cpp` 里「服务端早就支持、客户端还空着」的三条接上，
并补了它们缺的 UI（一个通用输入框）。

### 一、0x2B 拆堆叠

```
上行 C1 06 2B 00 [SourceSlot] [Count]
```

- `PSBMSG_HEAD` 是 **4 字节**（type/size/head/subh=0），所以 slot 在偏移 4；
- `HackPacketCheck` 第 43 行 Encrypt=0 → **C1**；
- 服务端 `CGItemStackUnstackRecv` 的约束：`Count < durability`、`Count < MaxStack`、
  每拆一个都要有空位（`InventoryInsertItem`）；
- **服务端是逐个插入**：`for (i=0;i<Count;i++) InventoryInsertItem(..., m_Durability = 1)`，
  所以拆 4 个得到 **4 件单件**，不是一堆 4 个（探针最初就按「一堆 4」断言，红了）；
- 成功后服务端 `GCItemListSend` 重发整张背包表 → **客户端不需要自己改本地快照**。

交互：**Shift + 左键**点背包物品 → 输入框问数量（原版是 Shift 拖到空格；
H5 里拖拽已经给了「换位」，再叠 Shift 容易误触）。

### 二、0x34 单件修理

`CGItemRepairRecv`：`C1 05 34 slot type`，`type 0 = 单件`、`type 1 = 全部`。
面板底部「修理全部」早就有了，单件补在**商店内右键物品**上
（商店里左键已经是「卖」、拖拽是换位，右键当上下文菜单最直观）。

> ⚠️ 修理费随等级暴涨：探针早期随便挑一件修，几轮下来把测试账号 9M 金币修光了。
> 现在探针只修**等级最低**的装备，并断言「扣费 ≤ 10 万」。

### 三、0x83 仓库密码（UI 补齐）

```
上行 C3 10 83 [type] [password:2 LE] [personalCode:10]
下行 C1 04 83 [state]
```

| type | 含义 | 服务端条件 |
| --- | --- | --- |
| 0 | 用密码解锁 | 必须已上锁；密码对 → state 12，错 → 10 |
| 1 | 设置密码 | 必须未上锁；要**账号个人码**，错 → 13 |
| 2 | 取消密码 | **只校验个人码**（不看旧密码）→ 忘了密码的出路 |

state：`0` 无密码 / `1` 已上锁 / `10` 密码错 / `11` 已上锁不能再设 / `12` 已解锁 / `13` 个人码错。

UI 行为：
- 仓库面板点 **锁按钮** → 弹输入框；
- 已上锁：`密码` + `个人码` 两个字段，按钮「解锁 / 取消密码 / 取消」；
- 未上锁：`新密码` + `个人码`，按钮「设置」（有过密码时多一个「取消密码」）；
- 结果码统一走 `0x83` 下行 → 聊天框 + 面板 toast，并刷新标题（上锁时标题变黄）。

### 四、通用输入框（`src/ui/dialog.ts`）

拆堆叠和仓库密码共用一个组件：标题、若干字段（可数字过滤 / 圆点遮罩）、
最多三个按钮、Enter 确认、Esc 取消、点遮罩取消。

**为什么不用 `window.prompt`**：
1. 全屏游戏里它会挡住 canvas，浏览器还可能「阻止此页面创建更多对话框」静默吃掉；
2. 弹窗期间 `keydown` 被浏览器接管，关掉后游戏收不到 `keyup`，
   `keys` 集合里 WASD 仍是按下状态 —— 角色会自己一直走。

### 五、验证（真实服务端）

```bash
node tools/econ-probe.mjs     # 新增：拆堆叠 / 单件修理 / 仓库密码（16 项）
node tools/npc-probe.mjs      # 回归：商店/仓库/丢弃/喝药/命令（17 项）
```

```
✓ 拆堆叠：原堆减少 4  255 → 251
✓ 拆堆叠：多出 4 件（服务端逐个插入，每件 1 个）  背包 27 → 31 件
✓ 单件修理：连接没被断开  slot=18 lv=0
✓ 单件修理：扣费合理（≤10 万）  19978840 → 19978840（花 0）
✓ 仓库状态已下发（0x83）  state=0
✓ 密码框标题随锁状态变化  「仓库密码」
✓ 设置密码：服务端有明确回应（1=上锁 / 13=个人码错）  state=1
✓ 上锁后仍能打开密码框（含「取消密码」）
✓ 取消密码：恢复成未设置  state=0
结果：通过 16 / 失败 0
```

（探针跑完会把测试密码取消掉，不污染账号。）

### 六、文件

- 新增：`src/ui/dialog.ts`、`tools/econ-probe.mjs`
- 改：`src/net/game.ts`（`buildUnstackPacket`）、`src/ui/inventory.ts`
  （`onClick` 带 `mods.shift`）、`src/main.ts`（拆堆叠/单件修理/密码框、0x83 下行状态、
  调试口 `dialogOpen/openSplit/openWarehousePassword/repairOne/warehouseState`）、
  `src/style.css`（`.dlg-*`）

### 七、还没接的服务端入口

按工作量排序：**任务 0xA0-0xA3**（`Quest.txt` 9 条 + 目标/奖励表）、
**组队 0x40-43**、**混沌合成 0x86-88**、**交易 0x36-3D**、**战盟 0x50-61**、
**事件入场 0x90/0x9A**、**黄金弓箭手 0x95/0x97/0x9D**。

---

## 任务系统（阶段 AK，0xA0 / 0xA1 / 0xA2 / 0xA3）

### 一、服务端只发状态位，数据表在客户端

```
下行 C1 36 A0 [count] [QuestInfo: 50B]   ← 192 个任务 × 2 bit，登录时推一次
下行 C1 05 A1 [index] [state]            ← 单条状态变化
上行 C3 05 A2 [index] [state]            ← 接取 / 完成（服务端**只看 index**）
下行 C1 05 A2 [index] [result] [state]   ← result 0 成功 / 0xFF 条件不足
下行 C1 06 A3 [index:2] [reward] [amount] ← 1 = 升级点，2 = 一转
```

状态位布局（`CQuest::AddQuestList`）：`Quest[i/4] >> ((i%4)*2) & 3`，
0 未接 / 1 进行中 / 2 已完成 / 3 已取消。

任务的名字、需求、目标、奖励都不在协议里 —— 全在服务端配置表：

| 表 | 管什么 | 关键列 |
| --- | --- | --- |
| `Quest.txt` | 每个任务**每个状态**一行 | MonsterClass / CurrentState / RequireIndex / RequireState / 等级区间 / 职业位 |
| `QuestObjective.txt` | 目标 | Type(1 物品/2 金币) / Index / Value / **RequireIndex=任务号** / RequireState |
| `QuestReward.txt` | 奖励 | Type(1 升级点/2 一转) / Value / RequireIndex / RequireState |

三张表从 `MuServer/Data/Quest/` 复制到资源目录 `/Data/Quest/`，运行时 fetch 解析
（`src/data/quests.ts`），改配置不用重新构建。

### 二、两个容易看错的语义

1. **`QuestObjective.txt` 的 `RequireIndex` 是任务号**，不是前置任务；
   `RequireState` 才是「本任务处于该状态时，这条目标才生效」——
   服务端 `CheckQuestObjectiveRequisite` 用 `CheckQuestListState(lpObj, RequireIndex, RequireState)`。
   例：任务 0 在 state 0/3 时要求「交 100 万 Zen」，state 1 时要求「拿到 471 号物品」。
2. **奖励挂的是 `RequireState = 1`（进行中）那一行** ——
   服务端在「进行中 → 完成」这一步才 `InsertQuestReward`。
   所以 UI 在「未接取」状态下也要显示奖励（显示的是「完成后能拿到什么」）。

### 三、客户端实现

- `src/data/quests.ts`：三表解析 + 状态位读写（`questStateFromMask` / `setQuestStateInMask`）+ 目标/奖励筛选
- `src/ui/questPanel.ts`：左侧任务列表（状态着色）+ 右侧详情（需求等级 / 前置 / 目标 / 奖励）+ 接取·完成按钮
- 交互：**J 键**开关（Esc 也关）；标题用目标拼（「支付 1,000,000 Zen」/「国王卷轴 ×1」）
- 服务端 `CGQuestStateRecv` 没有距离校验，也没有 NPC 校验 —— 客户端不需要贴到 235 号 NPC 旁边

### 四、验证

```bash
node tools/quest-probe.mjs
```

```
✓ 收到 0xA0 任务状态表
✓ 数据表解析出任务  2 个
✓ 任务标题来自目标（金币/物品）  支付 1,000,000 Zen | 支付 2,000,000 Zen
✓ 状态位被展开成 任务号→状态  {"0":3,"1":3}
✓ 详情显示需求等级 150 / 目标 / 奖励
✓ 未接取时按钮是「接取」；点接取后连接没被断开，0xA2 已发出
✓ 注入「接取成功」→ 状态 1，按钮变「完成」，详情切到物品 471
✓ 注入「完成」→ 状态 2，按钮隐藏
✓ 注入失败回执（0xFF）不改状态
✓ J 键关闭任务窗口
结果：通过 18 / 失败 0
```

> 为什么不用服务端真跑一遍接取：两个任务都要求**等级 150**，测试账号不够，
> 服务端 `GetInfoByIndex` 过滤后**静默不回包**（不是回 0xFF）。所以「点接取」
> 只验证包发出与连接存活，状态流转用 `injectQuestResult`（和收包同一条
> `applyQuestResult` 路径）验证。

### 五、文件

- 新增：`src/data/quests.ts`、`src/ui/questPanel.ts`、`tools/quest-probe.mjs`
- 改：`src/net/game.ts`（0xA0/A1/A2/A3 编解码）、`src/main.ts`（收包、J 键、
  `applyQuestResult`、调试口 `quests/questPanelView/openQuests/selectQuest/questAction/injectQuestResult`）、
  `src/style.css`（`.quest-*`）、资源目录新增 `Data/Quest/*.txt`

---

## 任务系统（阶段 AK，0xA0 / 0xA1 / 0xA2 / 0xA3）

### 一、服务端只发状态位，数据表在客户端

```
下行 C1 36 A0 [count] [QuestInfo: 50B]   ← 192 个任务 × 2 bit，登录时推一次
下行 C1 05 A1 [index] [state]            ← 单条状态变化
上行 C3 05 A2 [index] [state]            ← 接取 / 完成（服务端**只看 index**）
下行 C1 05 A2 [index] [result] [state]   ← result 0 成功 / 0xFF 条件不足
下行 C1 06 A3 [index:2] [reward] [amount] ← 1 = 升级点，2 = 一转
```

状态位布局（`CQuest::AddQuestList`）：`Quest[i/4] >> ((i%4)*2) & 3`，
0 未接 / 1 进行中 / 2 已完成 / 3 已取消。

任务的名字、需求、目标、奖励都不在协议里 —— 全在服务端配置表：

| 表 | 管什么 | 关键列 |
| --- | --- | --- |
| `Quest.txt` | 每个任务**每个状态**一行 | MonsterClass / CurrentState / RequireIndex / RequireState / 等级区间 / 职业位 |
| `QuestObjective.txt` | 目标 | Type(1 物品/2 金币) / Index / Value / **RequireIndex=任务号** / RequireState |
| `QuestReward.txt` | 奖励 | Type(1 升级点/2 一转) / Value / RequireIndex / RequireState |

三张表从 `MuServer/Data/Quest/` 复制到资源目录 `/Data/Quest/`，运行时 fetch 解析
（`src/data/quests.ts`），改配置不用重新构建。

### 二、两个容易看错的语义

1. **`QuestObjective.txt` 的 `RequireIndex` 是任务号**，不是前置任务；
   `RequireState` 才是「本任务处于该状态时，这条目标才生效」——
   服务端 `CheckQuestObjectiveRequisite` 用 `CheckQuestListState(lpObj, RequireIndex, RequireState)`。
   例：任务 0 在 state 0/3 时要求「交 100 万 Zen」，state 1 时要求「拿到 471 号物品」。
2. **奖励挂的是 `RequireState = 1`（进行中）那一行** ——
   服务端在「进行中 → 完成」这一步才 `InsertQuestReward`。
   所以 UI 在「未接取」状态下也要显示奖励（显示的是「完成后能拿到什么」）。

### 三、客户端实现

- `src/data/quests.ts`：三表解析 + 状态位读写（`questStateFromMask` / `setQuestStateInMask`）+ 目标/奖励筛选
- `src/ui/questPanel.ts`：左侧任务列表（状态着色）+ 右侧详情（需求等级 / 前置 / 目标 / 奖励）+ 接取·完成按钮
- 交互：**J 键**开关（Esc 也关）；标题用目标拼（「支付 1,000,000 Zen」/「国王卷轴 ×1」）
- 服务端 `CGQuestStateRecv` 没有距离校验，也没有 NPC 校验 —— 客户端不需要贴到 235 号 NPC 旁边

### 四、验证

```bash
node tools/quest-probe.mjs
```

```
✓ 收到 0xA0 任务状态表
✓ 数据表解析出任务  2 个
✓ 任务标题来自目标（金币/物品）  支付 1,000,000 Zen | 支付 2,000,000 Zen
✓ 状态位被展开成 任务号→状态  {"0":3,"1":3}
✓ 详情显示需求等级 150 / 目标 / 奖励
✓ 未接取时按钮是「接取」；点接取后连接没被断开，0xA2 已发出
✓ 注入「接取成功」→ 状态 1，按钮变「完成」，详情切到物品 471
✓ 注入「完成」→ 状态 2，按钮隐藏
✓ 注入失败回执（0xFF）不改状态
✓ J 键关闭任务窗口
结果：通过 18 / 失败 0
```

> 为什么不用服务端真跑一遍接取：两个任务都要求**等级 150**，测试账号不够，
> 服务端 `GetInfoByIndex` 过滤后**静默不回包**（不是回 0xFF）。所以「点接取」
> 只验证包发出与连接存活，状态流转用 `injectQuestResult`（和收包同一条
> `applyQuestResult` 路径）验证。

### 五、文件

- 新增：`src/data/quests.ts`、`src/ui/questPanel.ts`、`tools/quest-probe.mjs`
- 改：`src/net/game.ts`（0xA0/A1/A2/A3 编解码）、`src/main.ts`（收包、J 键、
  `applyQuestResult`、调试口 `quests/questPanelView/openQuests/selectQuest/questAction/injectQuestResult`）、
  `src/style.css`（`.quest-*`）、资源目录新增 `Data/Quest/*.txt`

---

## 组队系统（阶段 AL，0x40 / 0x41 / 0x42 / 0x43 / 0x44）

### 一、报文

```
上行 C3 05 40 [indexHi][indexLo]          ← 邀请（Encrypt=1）
上行 C3 06 41 [result][indexHi][indexLo]  ← 应答（**result=0 是拒绝**，非 0 才是接受）
上行 C1 03 42                             ← 请求列表（不在队伍里服务端不回）
上行 C1 04 43 [number]                    ← 踢人 / 退队（number = **队伍位置**，不是对象索引）
下行 C1 05 40 [indexHi][indexLo]          ← 有人邀请你
下行 C1 04 41 [result]                    ← 1 对方拒绝 / 2 队伍满
下行 C1 size 42 [result][count] + N×22B   ← 队伍列表
下行 C1 size 44 [count] + N×1B            ← 血量（高 4 bit 位置，低 4 bit 十等分）
```

成员结构（`PMSG_PARTY_LIST`，22 字节）：
`name[10] + number + map + x + y + CurLife(4) + MaxLife(4)`。
**`name[10]` 不保证有结尾 0** —— 名字正好 10 字节时会读到下一字段，必须按长度截。

### 二、三个和直觉相反的语义

1. **0x41 的 `result = 0` 是拒绝**。服务端 `if (lpMsg->result == 0) { 回邀请方 1; }`
   —— 也就是「0 = 不组」，回给邀请方的 `1` 才是「对方拒绝」。
2. **0x43 的 `number` 是队伍位置**（0 = 队长），不是对象索引；
   非队长发别人的位置会被服务端忽略，只能发自己的 = 退队。
3. **队伍 ≤ 2 人时踢人 = 解散**（`GetMemberCount() <= 2 → Destroy`），
   所以「两个人时退队」和「解散队伍」是同一条路。

另外：邀请时服务端会把**双方**的 `Interface` 都置成 PARTY，
在应答之前双方都开不了商店/仓库 —— UI 上拖太久会卡住对方，所以收到邀请会自动弹面板。

### 三、界面（P 键）

- **成员**：`★` 队长标记 + 名字 + 10 格血条 + 地图/坐标；右键行 = 踢人（自己那行 = 退队）
- **附近玩家**：视野内其他玩家（`remotes.list()` 里 `kind === 'player'` 且不是自己），点一下发 0x40
- **收到的邀请**：底部一条「XXX 邀请你组队 [接受][拒绝]」；收到 0x40 时自动打开面板

### 四、验证

```bash
node tools/party-probe.mjs
```

```
✓ P 面板打开 / 打开时发 0x42 请求
✓ 未组队时成员为空
✓ 注入列表 → 成员 2 人，0 号是队长（★）
✓ 血条按比例折成 10 格（100/200 → 5 格）
✓ 0x44 血量更新（9 / 3 格）
✓ 邀请条出现 → 拒绝会发 0x41 → 邀请条清空
✓ 邀请包 0x40 已发出 / 踢人包 0x43 已发出 / 连接没被断开
✓ P 键关闭队伍窗口
结果：通过 16 / 失败 0
```

单人环境没法真的凑两个人（同账号不能双开），所以「列表 / 血量 / 邀请条」用
`injectPartyList` / `injectPartyLife` / `injectPartyRequest` 注入，走的是和收包
**完全相同**的渲染路径；上行的 0x40 / 0x41 / 0x43 则是真发（服务端对非法索引静默丢弃，属正常）。

### 五、文件

- 新增：`src/ui/partyPanel.ts`、`tools/party-probe.mjs`
- 改：`src/net/game.ts`（组队 5 个包的编解码 + `PartyMember`）、
  `src/main.ts`（收包、P 键、附近玩家、调试口 `party/partyView/openParty/partyInvite/partyKick/partyRespond/injectParty*`）、
  `src/style.css`（`.party-*`）

---

## 组队系统（阶段 AL，0x40 / 0x41 / 0x42 / 0x43 / 0x44）

### 一、报文

```
上行 C3 05 40 [indexHi][indexLo]          ← 邀请（Encrypt=1）
上行 C3 06 41 [result][indexHi][indexLo]  ← 应答（**result=0 是拒绝**，非 0 才是接受）
上行 C1 03 42                             ← 请求列表（不在队伍里服务端不回）
上行 C1 04 43 [number]                    ← 踢人 / 退队（number = **队伍位置**，不是对象索引）
下行 C1 05 40 [indexHi][indexLo]          ← 有人邀请你
下行 C1 04 41 [result]                    ← 1 对方拒绝 / 2 队伍满
下行 C1 size 42 [result][count] + N×22B   ← 队伍列表
下行 C1 size 44 [count] + N×1B            ← 血量（高 4 bit 位置，低 4 bit 十等分）
```

成员结构（`PMSG_PARTY_LIST`，22 字节）：
`name[10] + number + map + x + y + CurLife(4) + MaxLife(4)`。
**`name[10]` 不保证有结尾 0** —— 名字正好 10 字节时会读到下一字段，必须按长度截。

### 二、三个和直觉相反的语义

1. **0x41 的 `result = 0` 是拒绝**。服务端 `if (lpMsg->result == 0) { 回邀请方 1; }`
   —— 也就是「0 = 不组」，回给邀请方的 `1` 才是「对方拒绝」。
2. **0x43 的 `number` 是队伍位置**（0 = 队长），不是对象索引；
   非队长发别人的位置会被服务端忽略，只能发自己的 = 退队。
3. **队伍 ≤ 2 人时踢人 = 解散**（`GetMemberCount() <= 2 → Destroy`），
   所以「两个人时退队」和「解散队伍」是同一条路。

另外：邀请时服务端会把**双方**的 `Interface` 都置成 PARTY，
在应答之前双方都开不了商店/仓库 —— UI 上拖太久会卡住对方，所以收到邀请会自动弹面板。

### 三、界面（P 键）

- **成员**：`★` 队长标记 + 名字 + 10 格血条 + 地图/坐标；右键行 = 踢人（自己那行 = 退队）
- **附近玩家**：视野内其他玩家（`remotes.list()` 里 `kind === 'player'` 且不是自己），点一下发 0x40
- **收到的邀请**：底部一条「XXX 邀请你组队 [接受][拒绝]」；收到 0x40 时自动打开面板

### 四、验证

```bash
node tools/party-probe.mjs
```

```
✓ P 面板打开 / 打开时发 0x42 请求
✓ 未组队时成员为空
✓ 注入列表 → 成员 2 人，0 号是队长（★）
✓ 血条按比例折成 10 格（100/200 → 5 格）
✓ 0x44 血量更新（9 / 3 格）
✓ 邀请条出现 → 拒绝会发 0x41 → 邀请条清空
✓ 邀请包 0x40 已发出 / 踢人包 0x43 已发出 / 连接没被断开
✓ P 键关闭队伍窗口
结果：通过 16 / 失败 0
```

单人环境没法真的凑两个人（同账号不能双开），所以「列表 / 血量 / 邀请条」用
`injectPartyList` / `injectPartyLife` / `injectPartyRequest` 注入，走的是和收包
**完全相同**的渲染路径；上行的 0x40 / 0x41 / 0x43 则是真发（服务端对非法索引静默丢弃，属正常）。

### 五、文件

- 新增：`src/ui/partyPanel.ts`、`tools/party-probe.mjs`
- 改：`src/net/game.ts`（组队 5 个包的编解码 + `PartyMember`）、
  `src/main.ts`（收包、P 键、附近玩家、调试口 `party/partyView/openParty/partyInvite/partyKick/partyRespond/injectParty*`）、
  `src/style.css`（`.party-*`）

---

## 交易系统（阶段 AM，0x36 / 0x37 / 0x38 / 0x39 / 0x3A–0x3D）

### 一、报文

```
上行 C3 05 36 [indexHi][indexLo]     ← 请求交易（Encrypt=1）
上行 C1 04 37 [response]             ← 应答（1 接受 / 0 拒绝）
上行 C1 07 3A [money:4 LE]           ← 放入金币
上行 C3 04 3C [flag]                 ← 确定 / 取消确定（Encrypt=1）
上行 C3 03 3D                        ← 取消交易（Encrypt=1）
下行 C3 0D 36 name[10]               ← 有人请求交易（C3 头）
下行 C1 14 37 [response][name:10][level:2][guild:4]
下行 C1 04 38 [slot]                 ← 对方取回一件
下行 C1 09 39 [slot][ItemInfo:4]     ← 对方放入一件
下行 C1 04 3A [result] / C1 07 3B [money]
下行 C1 04 3C [flag] / C1 04 3D [result]
```

### 二、四个必须记住的点

1. **交易物品走的是 0x24，不是 0x38/0x39**。
   `0x24` 的 `SourceFlag/TargetFlag` 取 0（背包）/1（交易格）/2（仓库）。
   `0x38/0x39` 是服务端**发给对方**的同步包（`GCTradeItemAddSend(lpObj->TargetNumber, …)`），
   自己这侧只收到 0x24 的回执。
2. **发起要求「同图 + X/Y 相差 ≤ 2 格」**（`CGTradeRequestRecv` 里逐轴比），
   不满足会回 `0x37 response=0`，不是静默丢弃。
3. **放入金币会立刻扣钱**（服务端 `GCMoneySend` 再回 `0x3A result=1`），
   取消/失败时退回 —— 所以 UI 上点「放入」后余额马上变小是正常的。
4. **任何一方改动物品/金币，服务端给双方发 `0x3C flag=0`** 清掉「确定」状态，
   改完必须重新点确定；双方都 `TradeOk=1` 才真正交换。

### 三、界面

- 8×4 = **32 格**（服务端 `TRADE_SIZE 32`）：上格是我的、下格是对方的
- 交易开着时**单击背包物品 = 放进交易格**，点自己交易格里的图标 = 退回背包
- 金币输入框 + 「放入」；底部「确定 / 取消」；状态栏显示「已确定 / 对方已确定」
- 收到请求时窗口底部弹「XXX 请求交易 [接受][拒绝]」
- 发起方式：聊天框输入 **`/trade 玩家名`**（本地拦截，服务端没这条命令；
  原版是「点玩家 → 交易」，H5 里点玩家已经用于选中目标）

### 四、验证

```bash
node tools/trade-probe.mjs
```

```
✓ 交易窗口打开，显示对方名字/等级
✓ 对方物品按槽位进入交易格（0:449 / 3:471）
✓ 0x39 结构：slot 在偏移 3、ItemInfo 4 字节
✓ 对方已确定 → 状态栏提示；改动物品后清零
✓ 0x3A 金币包 / 0x3C 确定包 / 0x3D 取消包 都发出，连接正常
✓ 无交易时「放入」被服务端拒绝但客户端不崩
✓ /trade 找不到人时提示「视野里没有玩家」
结果：通过 15 / 失败 0
```

单人环境开不了真交易，窗口/物品/确定状态用注入走**与收包相同**的渲染路径；
上行四个包真发（服务端对不存在的交易静默忽略，属正常）。

### 五、文件

- 新增：`src/ui/tradePanel.ts`、`tools/trade-probe.mjs`
- 改：`src/net/game.ts`（交易 8 个包的编解码）、`src/main.ts`
  （收包、`/trade` 拦截、背包↔交易格搬运、`pendingTradeMove`、
  调试口 `trade/tradeView/tradeWith/tradePut/tradeTake/tradeMoney/tradeOk/tradeCancel/injectTrade*`）、
  `src/style.css`（`.trade-*`）

---

## 交易系统（阶段 AM，0x36 / 0x37 / 0x38 / 0x39 / 0x3A–0x3D）

### 一、报文

```
上行 C3 05 36 [indexHi][indexLo]     ← 请求交易（Encrypt=1）
上行 C1 04 37 [response]             ← 应答（1 接受 / 0 拒绝）
上行 C1 07 3A [money:4 LE]           ← 放入金币
上行 C3 04 3C [flag]                 ← 确定 / 取消确定（Encrypt=1）
上行 C3 03 3D                        ← 取消交易（Encrypt=1）
下行 C3 0D 36 name[10]               ← 有人请求交易（C3 头）
下行 C1 14 37 [response][name:10][level:2][guild:4]
下行 C1 04 38 [slot]                 ← 对方取回一件
下行 C1 09 39 [slot][ItemInfo:4]     ← 对方放入一件
下行 C1 04 3A [result] / C1 07 3B [money]
下行 C1 04 3C [flag] / C1 04 3D [result]
```

### 二、四个必须记住的点

1. **交易物品走的是 0x24，不是 0x38/0x39**。
   `0x24` 的 `SourceFlag/TargetFlag` 取 0（背包）/1（交易格）/2（仓库）。
   `0x38/0x39` 是服务端**发给对方**的同步包（`GCTradeItemAddSend(lpObj->TargetNumber, …)`），
   自己这侧只收到 0x24 的回执。
2. **发起要求「同图 + X/Y 相差 ≤ 2 格」**（`CGTradeRequestRecv` 里逐轴比），
   不满足会回 `0x37 response=0`，不是静默丢弃。
3. **放入金币会立刻扣钱**（服务端 `GCMoneySend` 再回 `0x3A result=1`），
   取消/失败时退回 —— 所以 UI 上点「放入」后余额马上变小是正常的。
4. **任何一方改动物品/金币，服务端给双方发 `0x3C flag=0`** 清掉「确定」状态，
   改完必须重新点确定；双方都 `TradeOk=1` 才真正交换。

### 三、界面

- 8×4 = **32 格**（服务端 `TRADE_SIZE 32`）：上格是我的、下格是对方的
- 交易开着时**单击背包物品 = 放进交易格**，点自己交易格里的图标 = 退回背包
- 金币输入框 + 「放入」；底部「确定 / 取消」；状态栏显示「已确定 / 对方已确定」
- 收到请求时窗口底部弹「XXX 请求交易 [接受][拒绝]」
- 发起方式：聊天框输入 **`/trade 玩家名`**（本地拦截，服务端没这条命令；
  原版是「点玩家 → 交易」，H5 里点玩家已经用于选中目标）

### 四、验证

```bash
node tools/trade-probe.mjs
```

```
✓ 交易窗口打开，显示对方名字/等级
✓ 对方物品按槽位进入交易格（0:449 / 3:471）
✓ 0x39 结构：slot 在偏移 3、ItemInfo 4 字节
✓ 对方已确定 → 状态栏提示；改动物品后清零
✓ 0x3A 金币包 / 0x3C 确定包 / 0x3D 取消包 都发出，连接正常
✓ 无交易时「放入」被服务端拒绝但客户端不崩
✓ /trade 找不到人时提示「视野里没有玩家」
结果：通过 15 / 失败 0
```

单人环境开不了真交易，窗口/物品/确定状态用注入走**与收包相同**的渲染路径；
上行四个包真发（服务端对不存在的交易静默忽略，属正常）。

### 五、文件

- 新增：`src/ui/tradePanel.ts`、`tools/trade-probe.mjs`
- 改：`src/net/game.ts`（交易 8 个包的编解码）、`src/main.ts`
  （收包、`/trade` 拦截、背包↔交易格搬运、`pendingTradeMove`、
  调试口 `trade/tradeView/tradeWith/tradePut/tradeTake/tradeMoney/tradeOk/tradeCancel/injectTrade*`）、
  `src/style.css`（`.trade-*`）

---

## 混沌合成 + 服务端换图（阶段 AN，0x1C / 0x86 / 0x87 / 0x88）

### 一、报文

```
下行 C3 08 1C [gate][map][x][y][dir]        ← 传送 / 换图（`GCTeleportSend`）
上行 C1 04 86 [type]                        ← 合成（Encrypt=0）
下行 C1 06 86 [result][ItemInfo:4]          ← 结果 + 产物
上行 C1 03 87                               ← 关闭合成窗
下行 C1 03 87                               ← 关闭确认
上行 C1 07 88 [type:4 LE]                   ← 查成功率/费用（**type 是 int，4 字节**）
下行 C1 0B 88 [rate:4][money:4]
```

`0x24` 的物品移动多了一组 flag：`0` 背包 / `1` 交易 / `2` 仓库 / **`3` 混沌箱**
（服务端还接受 5..20，那是扩展仓库，本 port 不用）。
背包→箱子 `SourceFlag=0 TargetFlag=3`，箱子→背包 `3→0`，箱内换位 `3→3`。

### 二、五个必须记住的点

1. **产物不在背包里，还在箱子第 0 格。**
   `DGCreateItemRecv`（DSProtocol.cpp:927）在 `map == 0xFF` 时先 `ChaosBoxInit()`
   再 `ChaosBoxAddItem(…, item, 0)`，然后才 `GCChaosMixSend(result=1, &item)`。
   玩家必须自己点回背包。
2. **关闭混沌机 = 销毁箱内物品。** `CGChaosMixCloseRecv` 只做 `ChaosBoxInit` +
   `gObjInventoryCommit`，**不退还**。所以 `ChaosPanel.requestClose()` 在箱子非空时
   直接拒绝关闭（原版 `ChaosBoxRequestClose` + `GlobalText[593]` 同款行为）。
3. **材料不对时服务端一个包都不回。** `GetXxxMixRates()` 返 false →
   `ChaosItemMix()` 直接 return，而 `ChaosLock` 已经置 true —— 客户端会永久卡在
   「合成中」。所以**本地必须先推导配方**（`src/data/chaosRecipe.ts`，移植
   `CheckMixRecipe`），配方为 0 就根本不发包。
4. **成功率/费用不在客户端算。** 原版 `RenderChaosMix` 里那一大坨
   `rate/money` 是按材料估值猜的；本 port 直接发 `0x88` 让服务端
   `GetChaosMixRateAndMoney` 算，显示的是服务端真值（配置项是
   `m_ChaosItemMixRate[AccountLevel]` 之类）。
5. **走过传送门也会发 `0x1C`。** `gObjMoveGate` → `GCMapChangeSend`/`GCTeleportSend`。
   在这之前客户端完全不认这条包，后果是「人在诺利亚、画面还在洛兰」，
   所有寻路/点击都错。现在 `map` 变了就 `loadWorld(map, x, y, {offline:false})` 整张图重载；
   同一张图只对齐坐标。

### 三、界面（`src/ui/chaosPanel.ts`，逐像素照 `RenderChaosMix`）

| 元素 | 坐标（相对面板 260,0） | 源码 |
| --- | --- | --- |
| 底板 | `Item_Back01` 190×256 + `Item_Back02` 190×177 | `RenderInventoryInterface` |
| 标题 | (35, 11) | `RenderText(x+35, y+12, GlobalText[735])` |
| 配方名 | (20, 50) | `GlobalText[601..608]` |
| 成功率 | (20, 70) | `GlobalText[584]` |
| 费用 | (20, 90) | `GlobalText[585]` |
| 材料网格 | (15, 110) 8 列 × **4 行** | `RenderItemsBoxes(x+15, y+110, …, 8, 4)` |
| 提示行 | (20, 210 / 225 / 240 / 255) | `GlobalText[586..611]` |
| 合成按钮 | (75, 300) 44×32 `Mix_button1/2` | `GL_DrawTexture(292, x+75, y+300, 44, 32)` |

操作：混沌机开着时**单击背包物品 = 放进箱子**，**点箱子里的物品 = 取回背包**
（原版是拖拽；本 port 与仓库/交易保持同一套点击手势）。

### 四、配方推导一览（`checkMixRecipe`）

| 返回 | 配方 | 材料 | 服务端 |
| --- | --- | --- | --- |
| 1 | 混沌武器 | 混沌之石 + 卓越装备 | `ChaosItemMix` |
| 2 | 恶魔广场券 | 混沌 + 恶魔之眼 + 恶魔之钥（同级） | `DevilSquareMix` |
| 3 | 创造 +10 | 混沌 + 祝福 + 灵魂 + 9 级装备 | `PlusItemLevelMix(0)` |
| 4 | 创造 +11 | 混沌 + 2 祝福 + 2 灵魂 + 10 级装备 | `PlusItemLevelMix(1)` |
| 5 | 独角兽 | 混沌 + 10 × 独角兽之角 | `DinorantMix` |
| 6 | 果实 | 混沌 + 创造宝石(470) | `FruitMix` |
| 7 | 二代翅膀 | 混沌 + 洛克之羽(430) + 一代翅膀 + 若干「卓越且 +4」 | `Wing2Mix` |
| 8 | 血色城堡券 | 混沌 + 大天使卷轴 + 血骨（同级） | `BloodCastleMix` |
| 11 | 一代翅膀 | 混沌 + 卓越**武器型**(70/134/167) | `Wing1Mix` |
| -2 / -8 | 等级不一致 | 眼/钥 · 卷轴/骨 | 原版同样返负数 |

### 五、视野加载握手（0xF3/0x12）—— 不加这条，传送后角色「假死」

接混沌机时踩出来的一个**跨功能**问题：

```
上行 C1 04 F3 12     ← CGCharacterMoveViewportEnableRecv
```

服务端每次 `gObjMoveGate` / `gObjTeleport` 之后都会 `RegenOk = 1`
（`User.cpp:1964 / 1991 / 2052`），然后**等这条包**才推进
`1 → 2 → 3 → 0`（`Protocol.cpp:1448` + `ObjectManager.cpp:167,204`）。
`RegenOk != 0` 期间：

- `CGItemMoveRecv`（0x24）**一律回 result=0xFF**（`ItemManager.cpp:2539`）——
  仓库/交易/混沌箱的搬运全部失败；
- 服务端不重建视野，0x12 一个都不发 —— 客户端看到的 NPC/怪物**全部消失**。

表现就是「传送完人站在 NPC 旁边，但点什么都失败、视野是空的」。
原版客户端在换图后立刻发这条；本 port 在 `loadWorld` 收尾和同图传送后调用
`notifyViewportReady()`，并**每秒重发直到真的收到 0x12/0x13**（最多 20 秒）——
因为服务端 `gObjMoveGate` 的 `CreateViewport → ClearViewport` 顺序会把刚下发的
0x12 又删掉，通常要走一两步才会重新推。

### 六、验证

```bash
node tools/chaos-probe.mjs
```

```
✓ 0x1C 收到并重载地图（洛兰 → 诺利亚，mapName=Noria）
✓ 配方推导 11 条：1/2/3/4/5/6/7/8/11 + 负数分支
✓ 0x88 显示成功率 75% / 费用 3,000,000
✓ 0x86 result=1 → 产物进箱子第 0 格、phase=result
✓ 箱里有产物 → 拒绝关闭；result=0 → 清空箱子
✓ 真链路：走到混沌哥布林 238（<4 格）→ 0x30 result=3 → 面板打开
✓ GM /make 造混沌之石 + 创造宝石
✓ 0x24 背包→箱子（服务端接受）→ 点箱子格取回（服务端接受）
✓ 真实合成：混沌之石 + 创造宝石 → 配方 6 → 点「合成」→ 回执 result=1
✓ 产物（Fruit, 13,15）落在箱子第 0 格，点回背包后箱子清空
✓ 0x87 关闭 + 服务端回执
结果：通过 40 / 失败 0
```

**这条链路是真跑通的**：材料是真放进服务端混沌箱的（不是注入），
`0x86` 由服务端 `FruitMix` 判定并 `GDCreateItemSend` 产出，回执里带回
`ItemInfo`（type 431 + 随机等级），产物留在箱子第 0 格等着玩家取。

混沌哥布林只在**诺利亚**（`MonsterSetBase.txt: 238 3 0 180 103`），
所以探针开头用 `/move Noria` 触发 `0x1C`，结尾再 `/move Lorencia` 把角色送回主城
（位置是持久化的，不回去会让 `npc-probe` 找不到洛兰的商人）。

### 七、文件

- 新增：`src/ui/chaosPanel.ts`、`src/data/chaosRecipe.ts`、`tools/chaos-probe.mjs`
- 改：`src/net/game.ts`（0x86/0x87/0x88 编解码）、`src/main.ts`
  （0x1C `serverTeleport`、`notifyViewportReady` 视野握手、混沌面板接线、
  `putIntoChaosBox`/`takeFromChaosBox`/
  `mixChaos`/`queryChaosRate`、`pendingChaosMove`、
  调试口 `chaos/chaosView/chaosOpen/chaosPut/chaosTake/chaosRate/chaosMix/chaosClose/injectChaos*`）、
  `src/style.css`（`.chaos-*`）

---

## 战盟系统（阶段 AO，0x50–0x64）

### 一、报文

```
上行 C1 05 50 [indexHi][indexLo]      ← 申请加入「这个人」的战盟（**不是邀请**）
下行 C1 05 50 [indexHi][indexLo]      ← 有人申请加入我的战盟（我是会长才会收到）
上行 C1 06 51 [1|0][indexHi][indexLo] ← 会长应答申请（index = 申请人的对象号）
下行 C1 04 51 [result]                ← 入盟结果（0 拒 / 2 满 / 4 非会长 / 5 已有盟 / 6 忙 / 7 等级<6）
上行 C1 03 52                          ← 拉成员表
下行 C2 xx 52 [result][count][pad2][TotalScore:4][score][pad3] + 成员×count
上行 C1 17 53 name[10] PersonalCode[10] ← 退盟 / 驱逐 / 解散（同一个包）
下行 C1 04 53 [result]                 ← 结果
上行 C1 04 54 01                       ← 申请打开创建框
下行 C1 03 55                          ← 允许创建（只有包头）
上行 C1 2B 55 GuildName[8] Mark[32]    ← 建盟
下行 C1 04 56 [result]                 ← 建盟结果（1 成功）
上行 C1 03 57                          ← 取消创建
下行 C1 2D 5C [indexHi][indexLo] name[8] Mark[32]  ← 某人（含自己）进视野 → 盟名 + 标志
下行 C1 05 5D [indexHi][indexLo]       ← 移除
上行 C1 04 61 [result]                 ← 战盟战应答
下行 C1 04 60 result / C1 0C 61 名字+type / C1 0D 62 名字+type+team
下行 C1 0C 63 result+名字 / C1 05 64 score[2]
```

### 二、五个必须记住的点

1. **0x50 是「申请加入」，不是「邀请」。** 客户端在会长面前打 `/guild`
   （`Chat_InputTick.cpp::Chat_TrySendGuildRequest`）→ 发 `0x50 [会长索引]`。
   服务端 `CGGuildRequestRecv` 校验的是**被发的那个 index 必须是会长**
   （`lpTarget->GuildStatus != GUILD_STATUS_MASTER → result 4`），
   然后把 0x50 原样转发给会长，会长回 0x51。
2. **0x52 的成员表从 +16 开始，不是 +11。**
   `PMSG_GUILD_LIST_SEND` 是 `PWMSG_HEAD(4) + result + count + pad(2) +
   TotalScore(4) + score + pad(3)`，成员 `{name[10], number, connected}` 12 字节/条。
   按 +11 读会让所有名字整体错 5 个字节（0.97 客户端源码里记着这个 bug）。
3. **盟名不在 0x52 里。** 盟名 + 标志只从 **0x5C** 来（登录/入盟时服务端给
   自己发一份，别人进视野时也发）。本 port 把「自己那份」存进面板标题，
   把别人的存进 `remotes`（`state().remotes[].guild`）。
4. **0x53 一个包三种语义**：普通成员发自己 = 退盟；会长发别人 = 驱逐；
   会长发自己 = 解散。都要 **账号个人码**（`gObjCheckPersonalCode`，7 位，
   和仓库密码不是一回事），错了回 `result≠1`。
5. **0x54 可能没有回执**：服务端先查 `GuildCreateMinLevel` / `GuildCreateMinReset`，
   不够格就静默不回（不是 bug）。够格才回一个**只有 3 字节包头**的 0x55，
   客户端收到它才弹创建框。

### 三、界面（`src/ui/guildPanel.ts`，照 `RenderGuildList(450, 0)`）

| 元素 | 坐标（相对面板） | 源码 |
| --- | --- | --- |
| 面板 | **(450, 0)** 190×433 | `RenderGuildList(450, 0)` |
| 标题 | (35, 12) `盟名 (Score:总分)` / `GlobalText[180] "Guild"` | 有盟时带总分，无盟只写 Guild |
| 公告 | 居中 (95, 44 / 58) 金色 | `GlobalText` 公告两行 |
| 无盟提示 | (20, 50 / 65 / 80) | `GlobalText[185..187]`「走到会长面前打 /guild」 |
| 成员行 | (8, 86) 起，18px/行，最多 15 行（滚轮翻页，上限 40 人） | 13 字节/条的列表控件 |
| 按钮 | y=396：创建 / 退出·解散 / 刷新 | 原版由底栏与模态触发，这里显式给按钮 |
| 创建框 | 名字 (55,60) + 画板 8×8@(50,100)/15px + 调色板 (15,260)/20px | `RenderGuildCreation` |

**标志编辑器**：8×8 格，调色板 16 色（`UI_GuildMark.cpp` 的 `MarkColor[16]`，
0 号当橡皮）。发包前按「低 4 位 = 偶数格、高 4 位 = 奇数格」压成 32 字节
（`packGuildMark` / `unpackGuildMark`）。

**互斥**：战盟面板和背包、人物面板都在 x=450，原版也是互斥的
（`Player_InputTick.cpp` 里点背包会 `GuildOpened = 0`）。

入口：底栏右下「战盟」文字按钮（原版命中框 582,459 52×18）+ 键盘 `O`。

### 四、验证

```bash
node tools/guild-probe.mjs
```

```
✓ 战盟窗口打开 / 面板在 (450,0) / 开背包会关掉战盟
✓ 0x52 注入：成员 3 人、会长标记 *、离线标记 (off)、总分 1234/贡献 56
✓ 0x5C 命中自己 → 标题「TestGuild (Score:1234)」
✓ 0x50 申请条 + 0x51 接受 → 发出应答、申请条清空
✓ 0x54/0x55/0x56 创建框：确定发 0x55、取消发 0x57、成功回执关框
✓ 真服务端 0x52（测试号在一个「盟名为空」的战盟里，成员表 1 人 + master 位）
✓ 0x5C 收到过自己的战盟信息
✓ 0x53 错误个人码 → 服务端回执（不静默）
✓ /guild 附近没人 → 「走到会长面前再打」
结果：通过 25 / 失败 0
```

探针**不真建盟**：建了就要解散，解散要账号个人码（探针拿不到），
所以在创建框里用 1 个字符的非法名字触发服务端本地校验（`result=2`），
既能验证 0x55→0x56 全链路，又不会往数据库写垃圾。

### 五、文件

- 新增：`src/ui/guildPanel.ts`、`tools/guild-probe.mjs`
- 改：`src/net/game.ts`（战盟 0x50–0x64 编解码 + 标志打包 + 16 色调色板）、
  `src/main.ts`（面板接线、`/guild` 就近申请、收包分发、个人码对话框）、
  `src/ui/bottomBar.ts`（底栏「战盟」文字按钮）、
  `src/world/remotes.ts`（远端实体挂 `guildName/guildMark`）、
  `src/style.css`（`.guild-*`）

---

## 事件入场：恶魔广场 / 血色城堡（阶段 AP，0x8E / 0x8F / 0x90 / 0x91 / 0x9A / 0x9B）

### 一、报文

```
上行 C1 05 90 [level(0-3)][slot]          ← 进恶魔广场（level 0-based）
上行 C1 05 9A [level(1-6)][slot]          ← 进血色城堡（level 1-based）
上行 C1 05 91 [EventType][ItemLevel]      ← 右键点票：问还有多久开
下行 C1 04 90 [result]                     ← 入场结果（0 成功）
下行 C1 04 9A [result]                     ← 入场结果（0 成功）
下行 C1 05 91 [EventType][RemainTime]      ← **分钟**，0 = 现在就能进
下行 C1 24 8E int[4][2]                    ← 恶魔广场 4 档 min/max
下行 C1 64 8F int[6][4]                    ← 血堡 6 档 ×（普通 min/max + 魔剑士 min/max）
下行 C1 04 92 [type]                       ← 赛事倒计时（type 0-based）
下行 C1 1B 93 [rank][count][name[10]][score:4][exp:4][money:4]
下行 C1 0D 9B [state][time:2][max:2][cur:2][owner:2][itemLevel]
```

`0x24` 之外，这一批唯一的“新”上行是 0x90/0x91/0x9A —— 全是 `C1`（`HackPacketCheck.txt`
里 144 / 145 / 154 行的 Encrypt 列都是 0）。

### 二、六个必须记住的点

1. **两个事件都从 NPC 进，不从物品进。**
   恶魔广场是诺利亚的 **Charon 237**（171,105），血色城堡是诺利亚的
   **Messenger of Archangel 233**（208,30）。票（467 / 434）只在窗口里当“钥匙”，
   点它自己不会进图 —— 右键点票只是发 0x91 问时间。

2. **服务端用 `0x30 result=4 / 6` 表示“可以选档了”，不是错误码。**
   本 port 以前把 4/6 归进「拒绝对话」，所以这两个 NPC 一直像坏了一样。
   而且 `result` 之前**还会先发等级表**（0x8E / 0x8F），界面上
   “Square 3 (180 - 229 level)”就是它。

3. **0x8E / 0x8F 的结构体没有 `#pragma pack(1)`，int 从 +4 起。**
   `PBMSG_HEAD` 是 3 字节，后面接 `int` 时 MSVC 插 1 字节对齐：
   0x8E 发 36 字节、0x8F 发 100 字节。按 +3 读会把 `15` 读成 `0x00000F06 = 3846`
   （0.97 客户端源码里记着这个 bug）。解析器两种长度都认。

4. **level 语义两边相反**：恶魔广场 0-based（0..3，服务端校验票的
   `m_Level == level + 1`），血色城堡 **1-based**（1..6，服务端自己 `level -= 1`，
   校验票的 `m_Level == level`）。

5. **0x91 回的是分钟，而且 `EventType` 会被改成 0。**
   `GetRemainTime` 里做的是 `RemainTime / 60` 向上取整，所以文案是“还有 N 分钟”。
   如果票的 `m_Level` 是 0，服务端 `ItemLevel - 1` 越界，会把 `EventType`
   改回 **0** 再回包 —— 客户端必须把 0 当成“这一档不存在”，
   不能当成“血色城堡”。

6. **NPC 拒绝入场走的是 `F3/40`，不是 0x30。**
   `GCServerCommandSend(1, cmd1)`：`cmd1=2` 没票、`3` 不在入场时间、
   `20` 血堡时间不对、`21` 血堡没斗篷、`24` 资格不符、`46` 已经打完。
   之前本 port 完全不认这个包，表现就是「点 Charon 什么都不发生」。
   现在有一张 8 条的中文文案表（`serverCommandText`）。

### 三、界面（`src/ui/eventPanel.ts`，照 `RenderEventWindow`）

| 元素 | 坐标（相对面板 260,0） | 源码 |
| --- | --- | --- |
| 底板 | `Item_Back01` 190×256 + `Item_Back02` 190×177 | `RenderInventoryInterface` |
| 标题 | (35, 11) `GlobalText[846]` 血堡 / `[39]` 恶魔广场 | `RenderText(x+35, y+12, …)` |
| 档位行 | x=25 宽 **140**，底图是贴图 **240 = `Interface/Message_box`** | `GL_DrawTexture(240, x, y, 140, h, 0, 0, 0.832, 1)` |
| └ 恶魔广场 | y 从 **210** 起，stride **45**，高 **35**，共 **4** 行 | `count = bloodCastle ? 6 : 4` |
| └ 血色城堡 | y 从 **170** 起，stride **40**，高 **33**，共 **6** 行 | 同上 |
| 说明 | 血堡 `GlobalText[832]` 26 字/行 从 (30,64)；恶魔广场 `[670..675]` 从 (30,80) | `SeparateTextIntoLines` |
| 关闭 | (25, 395) 24×24 | 发 0x31 |

两个不对称的地方，原版就是这样的：

- **只有血色城堡会把等级不匹配的行灰掉**（`glColor3f(0.4,0.4,0.5)` 且点击直接
  `continue`）。恶魔广场四行永远可点，超范围由服务端回 `result=3/4` 再提示。
- **血色城堡有第二套等级表**：0x8F 的 6 行 × 4 个 int 里，前两个是普通职业
  min/max、后两个是魔剑士的，客户端按职业选第二组（`Hero[444] & 7 == 3`）。

灰行的判断放在 `EventPanel.pick()` 里而不是按钮的 click 里 —— 否则任何走
`onPick` 的其它入口（调试口、以后的键盘）都能绕过它。

### 四、赛事状态 HUD（0x9B）

只有血色城堡发，且只在**进图和阶段切换**时推一次（`RemainTime` 之外不逐秒跟），
所以左上角那一行记下收到时刻、自己按秒递减：

```
血色城堡 · 4:32 · 怪物 17/40 · 圣物 Lv3
```

`EventItemOwner` 是自己时显示「圣物在你手上」；`EventItemLevel == 0xFF`
表示这一场没有圣物，不显示那一段。

### 五、验证

```bash
node tools/event-probe.mjs
```

```
✓ 0x8E 4 档全部解析（对齐填充被跳过，不是 3846 这类脏值）
✓ 恶魔广场窗口：4 行、x=25 宽 140 高 35 起点 210 stride 45、`Square 1 (15 - 79 level)`
✓ 0x8F 12 行（后 6 行是魔剑士那一组）
✓ 血堡 6 行、level 1-based、`Castle 1 (level 15-79)`
✓ 血堡灰行 = 6 - 等级命中档数；点灰行 → pick() 返回 false、0x9A 一个都没发
✓ GM /make 造 467（level 1）+ 434（level 1）
✓ 走到 Charon（诺利亚 171,105）→ 0x30 → 服务端回 F3/40 (1,3)「你来早了」
✓ 右键票 → 0x91 → 服务端回分钟数
✓ 走到 Messenger（诺利亚 208,30）→ 0x30 → 明确响应
✓ 0x9B：HUD 文字「血色城堡 · 5:00 · 怪物 12/40 · 圣物 Lv3」，本地 300s → 298s
✓ 0x92 type 0/1 → 1/2；0x93 排名解析 + 进聊天框
结果：通过 48 / 失败 0
```

这台服务端只在场次开始前 5 分钟放人（`DevilSquare.dat` 的
`* * * * 0/4/8/12/16/20 30 0`），跑探针时大概率不在窗口内 ——
所以真链路的断言是「**开窗 或 收到 F3/40 拒绝】**都算通过：
它证明 0x30 到达了服务端、服务端认出了这个 NPC、并且走进了事件分支。

### 六、文件

- 新增：`src/ui/eventPanel.ts`、`tools/event-probe.mjs`
- 改：`src/net/game.ts`（0x8E/0x8F/0x90/0x91/0x92/0x93/0x9A/0x9B 编解码 +
  `EVENT_TYPE`/`DS_LEVELS`/`BC_LEVELS`）、
  `src/main.ts`（`openEventWindow`/`closeEventWindow`/`onEventEnterResult`/
  `queryEventRemainTime`/`serverCommandText`、`F3/40` 收包、右键点票、
  调试口 `event/injectDsLevels/injectBcLevels/eventOpen/eventPick/injectEvent*`）、
  `src/ui/eventTimer.ts`（`setMatch` 赛事状态行）、
  `src/style.css`（`.event-*`、`.evt-match`）

---

## 与 Win 端对齐的一轮修复（阶段 AQ）

用户指出的六个问题，逐条处理：

### 一、底栏图标：只在面板打开时显示

原版是 `if (XxxOpened) GL_DrawTexture(...)`（`HUD_Pass5.cpp:308-338`），
**面板没开时底栏上只有 `Menu0x_new` 的凹槽底纹，一个图标都没有**。
本 port 之前把四个图标常亮，看起来像「多了一排按钮」。

现在：按钮命中框常驻（原版 rect 一直有效），但 `<img>` 默认 `opacity: 0`，
由 `bottomBar.setActive(id)` 点亮；hover 给 35% 淡影代替原版的 `RenderTipText`。

### 二、战盟不是文字按钮，是 `Guild.jpg` 图标

| 按钮 | 位置 | 图标 | 贴图索引 |
| --- | --- | --- | --- |
| 队伍 | (348,452) 24×24 | `Menu_Party` | 0xEC |
| 角色 | (379,452) 24×24 | `Menu_Character` | 0xED |
| 背包 | (410,452) 24×24 | `Menu_Inventory` | 0xEE |
| **战盟** | **(582,459) 52×18** | **`Guild`** | **0xFA** |

`HUD_Pass5.cpp:336`：`GL_DrawTexture(250, 582, 459, 52, 18, 0, 0, 0.8125, 0.5625)`，
贴图文件就是 `Data/Interface/Guild.ozj`（52×18）。之前用自造的文字按钮。

### 三、战盟快捷键是 `G`，不是 `O`

`Player_InputTick.cpp:478`：`PressKey(0x47)` = `G`。`P` = 队伍、`C` = 角色、
`I`/`V` = 背包。`O` 是本 port 自己起的，已删。

战盟**没有 NPC 入口**：洛兰/诺利亚都没有 GuildMaster（Class 241 只在
冰风谷 214,47 的 Captain Lorence）。公会会长收申请是靠别人在他面前打
`/guild`（0x50 转发）。

### 四、勇者大陆缺少 NPC —— 是 `NO_MODEL_CLASSES` 把它们过滤掉了

`236 Golden Archer`、`247`、`249 Berdysh Guard` 在客户端走的是
`CreateChar5(Key, 390, …)`（**玩家骨架 + 硬编码装备外观**），
不是普通 NPC 模型；`OpenNpc(390)` 在 `NPC_ModelLoad.cpp` 的 switch 里
也没有对应分支（那份反编译只到 0x176），`Data/Npc` 下也没有
`GoldenArcher01.bmd`。所以之前直接把它们塞进 `NO_MODEL_CLASSES` 跳过了 ——
结果洛兰城门口的守卫和黄金弓箭手**整片消失**。

现在给它们替身模型（注释里标了 TODO：真正的做法是新增「NPC 用玩家外观」）：

- 236 黄金弓箭手（女性 NPC）→ `Sevina01`
- 247 / 249 城门守卫 → `Man01`

实测在洛兰能看到 236 / 240 / 249 / 251 / 255 五种 NPC。

### 五、M 键移动：接上服务端 `Data/Move`

跨图**没有客户端上行包**：0x1C（`CMove::CGTeleportRecv`）的语义是
「我已经站在这个门的格子上，请确认换图」，服务端还会用
`gGate.IsInGate()` 复核，站在别处发它只会被拉回原地。

真正的付费传送只有服务端命令一条路：

```
/move <Move.txt 的英文名>   → CCommandManager::CommandMove
                            → CMove::GetInfoByName + CMove::Move
```

`CMove::Move` 按**服务端自己的** `Move.txt` 校验等级 / 金币 / 转生，扣钱后
`gObjMoveGate` 下发 0x1C。所以 M 窗口在线模式下点条目 = 发这条命令，
价格、门槛、落点全部以服务端为准；本地那份表只负责画界面（离线演示仍本地切图）。

### 六、「全部修理」把钱扣光 —— 两个独立 bug 叠在一起

**(1) `0x34` 的参数语义写反了。**

`type` 不是「单件 / 全部」的开关：

```c
// CGItemRepairRecv (ItemManager.cpp:3176)
if (lpMsg->type == 1 && lpObj->Level < 50) return;   // 静默丢弃
if (lpMsg->slot == 0xFF) { ...逐件修 0..11... }      // ← 全部修理在这里
```

`type` 其实是 **auto-repair 标志**（0 = 找 NPC 修，1 = 自己修），而且
`GetItemRepairMoney` 里 `type == 1` 的价格 **×2.5**（`RepairItem` 第 403 行）。

之前发的是 `slot=0, type=1`：只修**武器槽**一件、价格翻 2.5 倍、
等级不够时服务端一声不响地丢掉。武器买价高的时候正好把余额清零。
现在发 `slot=0xFF, type=0`，并加了**二次确认**（客户端拿不到 `m_BuyMoney`，
算不出准确总价，只能明说「可能花光」让玩家再点一次）。

**(2) 回执的 `money` 读错了偏移。**

`PMSG_ITEM_REPAIR_SEND` = `PBMSG_HEAD`(3) + `DWORD money`，而
`ItemManager.h` **没有 `#pragma pack(1)`** → MSVC 在 +3 插 1 个对齐字节，
`money` 在 **+4**，`sizeof` 8。

按 +3 读的后果是「钱的低 3 字节左移 8 位」：4586 万（`0x02BBE57A`）
显示成 **31 亿**（`0xBBE57A00`）。玩家看到的就是「修一次钱暴涨 / 清零」。

### 七、顺带排查出同一类的另外三处对齐 bug

服务端这几个头文件都**没有 `#pragma pack(1)`**：
`ItemManager.h` / `ChaosBox.h` / `Trade.h` / `Guild.h` / `Quest.h` /
`Party.h` / `Warehouse.h`。凡是结构体里出现 `DWORD` / `int` / `WORD`
且前面没有偶数个 `BYTE` 垫着，字段就会整体后移。

| 包 | 正确偏移 | 之前 | 症状 |
| --- | --- | --- | --- |
| 0x34 修理回执 | `money@4` | `@3` | 钱变 31 亿 |
| 0x3B 交易金币 | `money@4` | `@3` | 交易金额天文数字 |
| **0x88 上行** 查成功率 | `int type@4`（**要 1 字节 padding**，包长 8） | `@3`，包长 7 | 服务端读到 `type>>8` = 0 → **成功率一直回 0/0** |
| 0x88 回执 | `rate@4 money@8`（包长 12） | `@3 / @7` | 面板显示天文数字 |
| 0x93 恶魔广场排名 | `score@17 exp@21 money@25` | `@15/19/23` | 分数串进名字 |

`0x93` 是最绕的一个：服务端先放 5 字节的
`PMSG_DEVIL_SQUARE_SCORE_SEND`（全 `BYTE`，`sizeof` = 5），再把
`PMSG_DEVIL_SQUARE_SCORE`（name@0、**score@12**、exp@16、money@20，
`sizeof` 24）`memcpy` 到 `+5` —— 所以线上 `score` 在 `5+12 = 17`。

已经确认**没问题**的（结构体用 `BYTE x[2]` 而不是 `WORD`，天然无填充）：
0x50 下行、0x5C/0x5D 战盟视野、0x64 战盟战比分、0x9B 赛事状态、
0x81 仓库金币、0xA3 任务奖励、0x52 战盟列表（`count` 后那 2 字节 padding
就是对齐洞）。

### 八、验证

```bash
node tools/align-probe.mjs     # 对齐专项，11 项
node tools/ui-fix-probe.mjs    # 底栏/快捷键/NPC/修理/M 键，29 项
node tools/chaos-probe.mjs     # 混沌（含 0x88 真服务端成功率）
```

```
[align]
✓ 0x34 按 +4 读，钱正好是 12345678（不是左移 8 位的脏值）
✓ 0x3B / 0x81 / 0x88 / 0x93 解析全部对上服务端布局
✓ 真链路：耐久满时修理不花钱，回执带回同一个余额 45866514

[uifix]
✓ 底栏 4 个按钮都在，默认 opacity 0；开背包只有背包亮、其余仍 0
✓ 战盟是 Guild.jpg 52×18 @ (582,459)
✓ O 键不再开战盟；G 键打开并点亮图标
✓ 洛兰逐点巡查：255 / 251 / 236 / 249 / 240 全部可见
✓ 修理第一次点击不发包 + 提示「可能花光」，第二次发 slot=0xFF,type=0
✓ M 窗口 23 条来自 Move.txt，点条目发 `/move Noria`，服务端真把人传过去

[chaos]
✓ 真服务端回 0x88 成功率 90% / 费用 3,000,000（以前是 0/0）
结果：通过 45 / 失败 0
```

---

## 队伍面板还原 + 黄金弓箭手（阶段 AR / AS）

### 一、队伍（组队）：照 `RenderParty(450, 0)` 重做

原来的队伍面板是自己画的一个 246×236 窗口（200,96）。原版其实是
**一整套 190×433 的右侧面板**，并且有**两种形态**：

| 形态 | 位置 | 内容 |
| --- | --- | --- |
| 面板（`PartyOpened`） | **(450, 0)** 190×433 | `Item_Back01` 190×256 + `Item_Back02` 190×177，5 行成员 + 关闭按钮 |
| 紧凑血条（`!PartyOpened`） | 屏幕右缘 `GetScreenWidth()-50` | 50×19 一行、10 格血量、常驻显示 |

**紧凑血条才是原版的「组队 UI 主体」**：不解散队伍就一直挂在屏幕右边，
不用按 P 也能看到谁快死了。上下两条 54×3 的盖片是 `Message_box2`（0xFC），
左右各一条 1px 竖线；成员不在视野内时那一行变暗红（`glColor4f(0.3,0,0,0.5)`）。

行内坐标全部照抄源码字面量（`a1+20 / a2+52+35*row` 那一串）：

| 元素 | 坐标 | 源码 |
| --- | --- | --- |
| 名字 | (20, 52+35i) 粗体 | `RenderText(a1+20, a2+52+35*row, …)` |
| 地图 | (40, 60+35i) | `GlobalText[map+30]`（0→洛兰 … 11..16→血色城堡） |
| 坐标 | (90, 60+35i) | `"%d,%d"` |
| 血条底 | (39, 69+35i) 92×5 深红 | `glColor3f(0.2,0,0)` |
| 血条填充 | (40, 69+35i) `90*cur/max` × 3 | `glColor3f(0.882,0.059,0)` |
| (cur/max) | (65, 77+35i) | `"( %d / %d )"` |
| 踢人按钮 | (140, 55+35i) 24×24 | `exit_01` / 按下 `exit_02` |
| 关闭按钮 | (25, 395) 24×24 | `GlobalText[221]` 提示 |

三个坑：

1. **第 0 行是「队长」，不是「我」**。原版给第 0 行的**文字**加了
   `m_dwBackColor = 0xFF962828` 的暗红底（`row == 0` 分支），不是整行高亮。
2. **踢人按钮不是每行都有**：`if (!strcmp(Party, Hero->Name) || !strcmp(row, Hero->Name))`。
   队长匹配上第 0 行就对**所有行**成立 → 队长能踢所有人；普通队员只有自己那行有
   （点它是退队，服务端 0x43 也只允许踢自己）。
3. **字高只有 9px**：四行文字（名字 / 地图+坐标 / 血条 / cur-max）要挤进 35px 行高，
   原版 `g_hFont` 在 640×480 下的实际字高就是 9px。换成 12px 会互相压。

交互上补了原版的 `/party` 聊天命令（`Chat_InputTick.cpp::Chat_TrySendPartyRequest`）：
不传名字 = 邀请面前 3 格内最近的玩家，也可以 `/party 名字`。

### 二、黄金弓箭手（0x94–0x9D）

面板 (450, 0) 190×433，四种形态由 **0x94 的 `Type`** 决定：

| Type | 形态 | 内容 |
| --- | --- | --- |
| 0 | 雷娜收集器（**洛兰**） | 登记雷娜 → 4 档兑换 |
| 1 | 宝石收集器（**诺利亚**） | 登记宝石 → 3 档 VIP（第 1 页）/ 换幸运号码（第 2 页） |
| 2 | 幸运号码兑换 | 输入 12 位号码 → 0x9D 领奖 |
| 3 | 号码查看 | 登记过的号码，10 条一页 |

**注意：0x94 不是 0x30。** 对话 NPC 236 之后服务端直接发 0x94
（`NpcGoldenArcher → NpcGoldenArcherOpenSend`），所以「面板该弹了」只能靠它判断。

报文（全部 C1，`HackPacketCheck` 里 148/149/150/151/157 的 Encrypt 列都是 0）：

```
下行 C1 14 94 [type] [count:2@4] [lucky[13]@6] [pad]   ← Count 在 +4，不是 +3
上行 C1 04 95 [type]                                    ← 登记 Rena(0)/Stone(1)
下行 C1 06 95 [pad] [count:2@4]                         ← -1 = 背包里没有
下行 C1 10 96 [lucky[13]@3]
上行 C1 08 97 02 [type] [pad] [idx:2@6]                 ← 兑换（idx 是档位，不是数量）
下行 C1 30 97 00 [rena:4×4@4][stone:4×4@20][vip:3×4@36] ← 48 字节
下行 C2 xx 97 01 [pad3] [count:4@8] [lucky[13]]×count   ← 号码列表
上行 C1 11 97 03 [lucky[13]@4]  →  下行 C1 05 97 03 [result@4]
上行 C1 10 9D [lucky[13]@3]     →  下行 C1 04 9D [result@3]
下行 C1 04 97 04                                        ← 服务端要求关窗
```

三个坑：

1. **登记和兑换用的是同一个物品**：`GET_ITEM(14,21)` = 469，靠**等级**区分
   —— `level 0` = 雷娜、`level 1` = 宝石
   （`GetInventoryItemSlot(lpObj, GET_ITEM(14,21), lpMsg->Type)`）。
2. **`0x97/0x02` 的 `count` 是档位下标**（0..3），不是数量；服务端拿它查
   `m_RenaExchangeRequiredCount[count]`。
3. **`0x97/0x01` 是 C2 长包，`count` 在 +8**：`PSWMSG_HEAD` 是 5 字节，
   后面接 `int` 要 4 字节对齐 → +5..7 是洞、条目从 **+12** 起、每条 13 字节。
   0x94 的 `Count` 在 **+4**（`BYTE Type` 之后 `short` 正好对齐），`lucky` 在 +6。

配置来自 `Data/GameServerInfo - Event.dat`（本服：雷娜 10/50/100/500、
宝石 VIP 100/250/500 各 1 小时、幸运号码 50 颗），客户端**不写死**，
全部由 `0x97/0x00` 下发。

按源码还原的细节：按钮在条件不满足时**整块灰掉且点击无效**
（`RenderBox(..., hoverable=false)` 的 `glColor3f(0.4,0.4,0.4)`）；
Stone 固定两页（`s_TotalPages = 2`），但雷娜面板**不画翻页条**
（`RenderRena` 里没有 `RenderPagination`）；幸运号码显示成 `xxxx - xxxx - xxxx`。

### 三、验证

```bash
node tools/party-probe.mjs           # 40 项：版式 / 队长行 / 踢人按钮规则 / 紧凑血条 / P 键
node tools/golden-archer-probe.mjs   # 54 项：四种形态 / 按钮可点性 / 分页 / 真服务端登记
```

```
[party] 通过 40 / 失败 0
  ✓ 面板在 (450,0) 190×433；底板 190x256@0 + 190x177@256
  ✓ 名字 (20,52) / 地图 (40,60) / 坐标 (90,60) / 血条 (39,69) 92×5 → 45×3
  ✓ 队长行文字暗红底 rgb(150,40,40)
  ✓ 队长 → 每行都有踢人按钮；队员 → 只有自己那行
  ✓ 紧凑血条 x=590（无面板）→ 开背包后 400

[ga] 通过 54 / 失败 0
  ✓ 0x97/0x00 四组配置全部解析
  ✓ type=1 两页；第 2 页换幸运号码、有号码后变「登记幸运号码」
  ✓ 输入 12 位 → 确认按钮点亮 → 发 0x9D
  ✓ 15 个号码分 2 页、10 行/页、格式 4-4-4
  ✓ 真链路：/make 14 21 0 → 洛兰 (131,128) → 对话 236 → 0x94 type=0
  ✓ 真点登记 → 0x95 回执 count=1，客户端背包 2 → 1
```

### 四、文件

- 新增：`src/ui/goldenArcherPanel.ts`、`tools/golden-archer-probe.mjs`
- 重写：`src/ui/partyPanel.ts`（450×433 面板 + 紧凑血条）
- 改：`src/net/game.ts`（0x94/0x95/0x96/0x97/0x9D 编解码）、
  `src/main.ts`（`/party`、`syncPartyHud`、黄金弓箭手接线与调试口）、
  `src/style.css`（`.party-*` 重写、`.ga-*`）

---

## 技能剩余四条包（阶段 AT，0x1B / 0x1D / 0x1E / 0xB0）

### 一、报文

```
上 C3 06 1B [skill][idxHi][idxLo]                       ← 取消技能效果
下 C1 06 1B [skill][idxHi][idxLo]                       ← 某人 buff 没了（0.97 客户端只收不发）
上 C3 0B 1E [skill][x][y][dir][dis][angle][idxHi][idxLo] ← 持续技能（**11 字节**）
下 C3 09 1E [skill][idxHi][idxLo][x][y][dir]            ← 持续技能广播（**带落点**）
上 C3 (8+2n) 1D [skill][x][y][serial][count] (idxHi idxLo)×count  ← 多目标技能
上 C3 07 B0 [idxLo][idxHi][x][y]                        ← 队友传送
```

`HackPacketCheck.txt` 里 0x1B(27) / 0x1D(29) / 0x1E(30) / 0xB0(176) 的 **Encrypt 列全是 1**。

### 二、四个必须记住的点

1. **0x1E 必须发满 11 字节，而且目标索引是 big-endian。**
   0.97 原版客户端只发 9 字节（`C3 09 1E skill x y ...`）且**不带目标**，
   服务端 `MAKE_NUMBERW(index[0], index[1])` 会从包外读两个字节 →
   `bIndex` 是垃圾 → **打着打着另一个怪物莫名掉血**，穿刺直接没效果。
   这是 0.97 客户端对着 MuEmu 服务端的老问题，DLL 补丁也是靠补满 11 字节解决的。
2. **0xB0 必须发 C3，否则直接被踢。**
   结构体写的是 `PBMSG_HEAD`、0.97 客户端也真的按 **C1** 发
   （`Combat.cpp:1755`），但服务端 `HackPacketCheck` 要求加密 ——
   按 C1 发就是 `CloseClient`。**探针第一次跑就是这么被断的**：之后所有发包
   全部失败，表现为「技能放不出来、聊天没反应」。
3. **0xB0 的索引是 little-endian，0x19/0x1E 是 big-endian。**
   `PMSG_SKILL_TELEPORT_ALLY_RECV` 在 `SkillManager.h:110` 被 `#pragma pack(1)`
   包着、字段是原生 `WORD`；另外两条是 `BYTE index[2]`。同一个「目标索引」，
   两条包方向相反 —— 写反了就是「传到别人身上 / 传不动」。
4. **0x1D 必须跟在 0x1E 后面。**
   `CGMultiSkillAttackRecv` 开头就查
   `if (MultiSkillIndex == 0 || MultiSkillIndex != skill || MultiSkillCount++ >= 5) return;`，
   而 `MultiSkillIndex` 只有 `UseDurationSkillAttack`（`SkillManager.cpp:955`）会设。
   也就是「先 0x1E 开技能 → 再用 0x1D 报最多 5 批、每批最多 5 个目标」。
   单独发 0x1D 一定被丢。`serial` 服务端不读，发 0。

### 三、顺带补上的：在线施法

之前本 port 的技能**只有离线沙盘一条路**（`castSkill`），在线点技能什么都不发。
现在有了统一入口：

```ts
castOnlineSkill(skillId, targetId?)   // __MU_APP__.castOnline(...)
```

- `DURATION_SKILLS`（5 火焰 / 8 龙卷风 / 9 恶魔之眼 / 10 地狱火 / 12 冰封 /
  14 烈火 / 41 旋风斩 / 42 狂暴斩 / 52 三连射 / 55 致命一击 / 56）→ **0x1E**
- 其余 → **0x19**

服务端会把包回给自己一份，但 `playRemoteSkill` 对自己一律跳过（防双播），
所以这里主动用 `allowSelf` 播一次 —— 和原版「本地先演、服务端再判定」一致。

`playRemoteSkill` 同时支持了**落点**：`SkillCastEvent` 新增 `x / y / dir`，
0x1E 用包里的格子放特效，`dir` 只在非 0 时覆盖朝向
（41/42/55/56 靠目标索引定方向、`dir` 发 0，覆盖了会把朝向转回 0°）。

### 四、验证

```bash
node tools/skill-packet-probe.mjs   # 28 项
```

```
✓ 0x1E = c3 0b 1e 29 85 83 40 00 00 1f 40（11 字节，索引 big-endian）
✓ 0x19 = c3 06 19 03 1f 40
✓ 0x1D = c3 0c 1d 05 85 83 00 02 1f 40 0b b8（size = 8 + count*2，目标封顶 5）
✓ 0xB0 = c3 07 b0 40 1f 85 83（little-endian；C1 会被断开）
✓ 0x1E 下行：落点用包里的 x/y（150,120），不是施法者脚下
✓ 0x1E 下行：地狱火真生了特效（Inferno01.bmd）
✓ castOnline(41) → 0x1E、castOnline(3) → 0x19
✓ 0x1B / 0x1D / 0xB0 三条上行发完连接不断
✓ 自身施法：skillDebug.count 增加，没被当成「自己 → 跳过」
```

### 五、文件

- 改：`src/net/game.ts`（0x1B/0x1D/0x1E/0xB0 编解码 + `DURATION_SKILLS`）、
  `src/main.ts`（`castOnlineSkill` / `recallAlly`、0x1E / 0x1B 收包、
  `playRemoteSkill` 的 `allowSelf` 与落点、调试口
  `castOnline/multiSkill/cancelSkill/recallAlly/testDurationSkill/testSkillCancel/skillPacketHex`）
- 新增：`tools/skill-packet-probe.mjs`
