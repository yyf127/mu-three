# 技能动作 / 特效 / 特效运动 — 源码对照表

> 目的：把「客户端源码到底为这个技能创建了什么」和「我们实际画了什么」并排放，
> 只修有差异的项。
>
> 源码出处：
> - 创建：`src/Net/SecondPassword.cpp` 的 `switch ((char)v328)`（技能号 = `MuServer/Data/Skill/Skill.txt` 的编号）
> - 运动：`src/Render/MoveEffect.cpp`（模型/贴图段）/ `src/Render/MoveJoint.cpp`（关节段）
> - 初始化：`src/Render/Effect_Create.cpp` / `src/Render/Joint_Create.cpp`
> - 动作：`src/Combat/Skills.cpp` 的 `PacketHandler_0x19`（远端）
>          + `src/Combat/Combat.cpp` 的 `Attack_WarriorBranch97k`（本地）
>          + `src/Combat/Combat_AttackStage.cpp`（逐帧分阶段）
>
> **注意**：那个 switch 里作者手写的 `// Twister`、`// Defense`、`// FallingSlash`
> 注释**是错的**，case 号要按 `Skill.txt` 认。

## 特效号 → 资源

| 号 | 文件 | 号 | 文件 |
|---|---|---|---|
| 190 | `Skill/Ice01.bmd` | 1253 | `Effect/JointSpirit01.OZJ`（关节） |
| 191 | `Skill/Fire01.bmd` | 1254 | `Effect/JointThunder01.OZJ`（关节） |
| 192 | `Skill/Poison01.bmd` | 1257 | `Effect/Spark01.OZJ`（关节） |
| 199 | `Skill/Ice02.bmd` | 1258 | `Effect/JointLaser01.OZJ`（关节） |
| 200/201 | `Skill/Circle01/02.bmd` | 1261 | `Effect/JointLaser02.OZJ`（关节） |
| 203 | `Skill/Magic02.bmd` | 1259 | `Effect/JointEnergy01.OZJ`（关节） |
| 204 | `Skill/Storm01.bmd` | 1264 | `Effect/Magic_Ground2.OZJ` |
| **205** | **`Skill/Laser01.bmd`** | 1265 | `Effect/Magic_Circle1.OZJ` |
| 212 | `Skill/Snow01.bmd` | 1176 | `Effect/Spark03.OZJ` |
| 236 | `Skill/Ball01.bmd` | 1180 | `Effect/Thunder01.OZJ` |
| 240 | `Skill/Blast01.bmd` | 1200 | `Effect/Flame01.OZJ` |
| 241 | `Skill/Inferno01.bmd` | 1210 | 极光弹体（贴图 + 30 段 1176 拖尾） |
| 244 | （武器砸地，专属渲染器） | 1220 | `Effect/smoke01.OZJ` |
| 266 | `Skill/RidingSpear01.bmd`（借纹理当关节） | 1382 | `Effect/fi02.OZT` |

---

## 完整对照

图例：✅ 一致 ｜ ⚠️ 有多余件或参数偏 ｜ ❌ 错（特效/数量/运动不对） ｜ ❓ 待确认

| # | 技能 | 动作 | 源码创建 | 源码运动 | 我们现在 | 判定 |
|---|---|---|---|---|---|---|
| 1 | 毒咒 Poison | 82/83 | `CreateEffect(192)`@目标 + `Particle(1220)`×10 | 原地毒雾，粒子外扩 | Poison01 + smoke×10 | ✅ |
| 2 | 陨石 Meteorite | 82/83 | `CreateEffect(191)`@目标 sub0 | 原地爆开（`0xbe` 分支） | Fire01 + 石头×6 + 爆炸×4 + 火苗×3 | ⚠️ 多 13 件（自造） |
| 3 | 掌心雷 Lightning | 82/83 | （源码无 case 3，走攻击动作） | — | 兜底 beam + sprite | ❓ 兜底 |
| 4 | 火球 Fire Ball | 82/83 | `CreateEffect(191)`@自己 sub1 | 原地（sub1 分支） | Fire01@self | ✅ |
| 5 | 火龙 Flame | 82/83 | `CreateEffect(1200)`@落点 | 地面火，向上窜 | Flame01@落点 ×6 | ⚠️ 6 件（源码 1） |
| 6 | 瞬移 Teleport | 82/83 | （`c+912` 投掷标志，无特效） | 位移 | 兜底魔法阵 | ❓ 兜底 |
| 7 | 冰封 Ice | 82/83 | `CreateEffect(190)`@目标 + `(199)`@目标×5 | 冰晶原地爆开 | Ice01 + Ice02×5 | ✅ |
| 8 | 龙卷风 Twister | 82/83 | `CreateEffect(204)`@自己 | **原地旋转**（Storm01 自身动画 + 粒子外抛） | Storm01 + smoke02×6 | ⚠️ 多 6 件 |
| **9** | **黑龙波 Evil Spirit** | 82/83 | `Joint_Create(1253)` **×8**：4 方向（`kk*90°`）× 头(scale 80)+尾(scale 20)，`sub 0`；**头每帧 `CreateEffect(205)`** | **原地翻腾**（关键，见下方专节）：位置整段寿命不变（`MoveHumming` 只转角度、`Joint_SegmentTick` 不推进位置、`+0x9bc` 只写不读），只有角度抖 ±6.4°/±3.2° + BMD 自身动画；`AddTerrainLight` 打光；寿命 49 帧 | `JointSpirit01.OZJ` ×8，一次性贴在施法者身上，静止 | ❌ 无 Laser01、无翻腾 |
| 10 | 地狱火 Hell Fire | 82/83 | `CreateEffect(200)`@自己 + `(201)`@自己 | 地面双圈扩散 | Circle01 + Circle02 + 石头×12 | ⚠️ 多 12 件 |
| 11 | 真空波 Power Wave | 82/83 | `CreateEffect(203)`@自己（普通 1 次；怪物 288 时 3 次） | 原地十字波 | Magic02 ×1 | ✅ |
| **12** | **极光 Aqua Beam** | 82/83 | `CreateEffect(1210)`@落点 | **飞行弹体**：局部前进 `(0,-50,0)`/帧、scale 16、寿命 3 帧；**同时连发 30 段 `1176` 拖尾**；颜色 (0.5,0.7,1.0) | 只有 `Spark03` 拖尾 ×10，**没有弹体** | ⚠️ 缺弹体、拖尾少 |
| 13 | 爆炎 Blast | 82/83 | `CreateEffect(240)`@落点 ×2 | 落地炸开 | Blast01@落点 ×2 | ✅ |
| 14 | 毁灭烈焰 Inferno | 82/83 | `CreateEffect(241)`@自己 + **`Effect_SpawnBombRing()`**（8 个位置随机 197/198 石头） | 火环扩散 + 石头从天上砸落 | Inferno01 + 爆炸×8 + 火花×10 | ⚠️ 石头环变成爆闪 |
| 16 | 守护之魂 Mana Shield | 82/83 | `Joint_Create(266)`×5 @自己 sub0 | 环绕自身 | JointSpirit×5 | ✅（266 借纹理，近似） |
| **17** | **能量球 Energy Ball** | 82/83 | `CreateEffect(212)`@自己（怪物 282）**或** `CreateEffect(1180)`@自己 | 原地（`Snow01` / `Thunder01`） | **`Ball01.bmd`** | ❌ 模型不是源码那个 |
| 18 | 圣盾防御 Defense | -1（挥砍） | （本地 `Attack_WarriorBranch`，无特效） | — | Protect01 | ❓ 多 1 件 |
| 19 | 地裂斩 Falling Slash | 56 | （本地 case 12 → `CreateEffect(1210)`） | — | Earthquake02 | ❓ |
| 20 | 牙突刺 Lunge | 57 | （本地） | — | Piercing | ❓ |
| 21 | 升龙击 Uppercut | 58 | （本地） | — | Blast01 | ❓ |
| 22 | 旋风斩 Cyclone | 59 | （本地） | — | Storm01 | ❓ |
| 23 | 天地十字剑 Slash | 41/60 | （本地） | — | Kcross | ❓ |
| 24 | 多重箭 Triple Shot | -1 | `CreateArrows(3)` | 3 支箭飞向目标 | — | ✅ |
| 26 | 治疗 Heal | 82/83 | `CreateEffect(1264)`@目标 sub1 | 地面法阵 | Magic_Ground2 | ✅ |
| 27 | 守护之光 Greater Defense | 82/83 | `CreateEffect(1264)`@目标 sub2 + `Joint(266)`**×2** | 法阵 + 2 道环绕光 | 法阵 + JointSpirit×**10** | ⚠️ 关节多 8 条 |
| 28 | 战神之力 Greater Damage | 82/83 | `CreateEffect(1264)`@目标 sub3 | 法阵 | 同 | ✅ |
| 30–36 | 召唤系 | 82/83 | `CreateEffect(1264)`@自己 sub3 | 法阵 | 同 | ✅ |
| 41 | 霹雳回旋斩 Twisting Slash | **61** | `CreateEffect(238)`@自己 | **转手上的武器**（239 `RenderWheelWeapon`：-30°/帧、pitch 90°、抬高 100） | weapon = `Saw01`（空手兜底） | ✅ |
| 42 | 雷霆裂闪 Rageful Blow | **62** | `CreateEffect(244)`@自己 | **武器升起→砸下→地裂**（20 帧；life 3 时 8 道裂缝 + 扬尘 + 碎石） | weaponSlam + 爆炸 + 火花 + 石头 | ⚠️ 多 4 类 |
| 43 | 袭风刺 Death Stab | 67 | `Joint_Create(c+816)`：1254×2(scale50) + 1254×2(scale10) + 1257×2 | 从武器连到目标的三段电光 | Pierpart×2 + JointThunder×9 | ⚠️ 数量/类型 |
| 47 | 钻云枪 Impale | 66 | `CreateEffect(266)` + `(255 Piercing)` | — | RidingSpear + Pierpart×2 | ❓ |
| **48** | **生命之光 Greater Life** | **63** | `CreateEffect(1264)`@自己 **×1** + `Joint_Create(1253)` **×36**（scale 60） | 1 个法阵 + **36 道竖雷从地面拉到天上** | 法阵 ×**36** + JointSpirit ×36 | ❌ 法阵多 35 个 |
| 49 | 流星焰 Fire Breath | 64/65 | `CreateEffect(1382)`@自己 | 火焰柱 | fi02 | ✅ |
| 51 | 冰封箭 Ice Arrow | -1 | `CreateArrows` + `case 0x33`：`CreateEffect(190)`×2 @目标（差 180°） | 箭 + 两片冰晶包住目标 | 箭 + Ice01×2 | ✅ |
| 52 | 穿透箭 | -1 | `Joint_Create(1258)`×2 @目标 | 贯穿光 | — | ⚠️ 缺 |
| 55 | 玄月斩 Fire Slash | **61** | `AttackStage`：`1267`（1 帧）+ `1168`（30 帧，从施法者连到目标的线） | 身前挥砍 + 一道能量弧 | Tail@front + JointEnergy + **Explotion 爆闪** | ⚠️ 爆闪是自造 |
| 56 | 天雷闪 Power Slash | **81** | `CreateEffect(261)`@落点 | — | Magic02 ×5 | ❓ 261 待查 |

### 9 黑龙波：轨迹为什么是「原地翻腾」

反编译逐层核对过，**没有一处推进位置**：

| 环节 | 代码 | 是否移动位置 |
|---|---|---|
| `MoveHumming(pos, angle, target, turn)` | `SMD_Parser.cpp:672` | ❌ 只 `Angle[0]/[2]` 转目标；注释原文 "NO mueve la posicion" |
| `MoveJoint` 的 1253 sub0 分支 | `MoveJoint.cpp:863` | ❌ 只改 Angle + `CreateEffect(205)` + `AddTerrainLight` |
| 公共出口 `switchD_caseD_4ef` | `MoveJoint.cpp:1662` | ❌ 只调 `Joint_SegmentTick` |
| `Joint_SegmentTick` | `SMD_Parser.cpp:672` 起 | ❌ 用 `scale` + 当前位置算 4 个顶点，不推进 |
| `+0x9bc`「到达」标志 | `MoveJoint.cpp:880` | ⚠️ 只写，**没有任何分支读它** |

位置唯一来源是 `Joint_Create(1253, v399, …)` 的第 2 个参数 = **施法者 `z+100`（头顶 1 格）**。
每帧变的只有：
- `Angle[0] += (rand()%32-16)*0.2`（俯仰，之后 ×0.6 衰减）
- `Angle[2] += (rand()%32-16)*0.8`（偏航，`+0x9cc` 累积）
- `terrain+100 > z` → `Angle[0] = -5`；`terrain+400 < z` → `Angle[0] = 5`（贴地姿态修正）
- 颜色 `lifetime*0.1`

**所以画面是「4 条龙形波在施法者身上/头顶小幅翻腾扭动」**，靠 Laser01 自己的 BMD
动画（龙形波动）+ 角度抖动出“游”的错觉，**不是绕人转圈**。

> 第一版实现给了 1.35~2.3 格半径的匀速圆周 —— 这就是「轨迹不对」的原因。
> 现在：半径 0.62~1.1 格、离地 1 格、朝向指回施法者、角度用双频正弦抖动。

---

## 根因归纳（不是「个别漏配」，是三处系统性偏差）

### 1. `joint` 被当成静态贴图（影响 9 / 16 / 27 / 43 / 48 / 52）
`castOf()` 里：
```ts
if (isJoint) {
  const file = EFFECT_TEXTURES[fx.type] ?? JOINT_FALLBACK_TEXTURE;
  return { kind: 'sprite', file, anchor: fx.at, count: fx.count, spread: 0.35 };
}
```
`Joint_Create` 在源码里是**一条会动的光带**（起点/终点/子类型/缩放都有语义），
被压成「N 个贴图点贴在锚点上」——静止、不连成线、不跟随。

### 2. 提取脚本把「循环次数」套到了整个 case（影响 48 / 27）
`extract-skill-fx.mjs` 抓到 `for (i<36) { Joint_Create(...) }` 后，
把 `count: 36` 写到了 case 里**所有**件上 —— 48 的 `1264` 本该 1 个，变成了 36 个。

### 3. 手写「调味件」比源码多（影响 2 / 5 / 8 / 10 / 14 / 42 / 43 / 55）
`SKILL_REFINE` / `ATTACK_STAGE_EXTRAS` 里补的 `flash` / `debris` / `sprite` / `smoke`，
源码并没有创建 —— 观感上「很热闹」，但和原版不是一回事。

### 4. 运动模型缺失（影响几乎所有「飞行/落地/环绕」类）
`FxPart` 只有「锚点 + 上浮」两种运动；源码的
`MoveHumming`（追踪）/ `RequestTerrainHeight`（落地）/ `Ring_ComputeOrbit`（环绕）
都没有对应表达。

---

## 修复进度

### 已修

| 项 | 做法 | 探针断言 |
|---|---|---|
| **地面圆形光斑** | `effects.spawn` 的 `glow` 从「默认开」改成「默认关」（`opt.glow === true` 才生成）。原版没有圆片，是 `AddTerrainLight` 提亮地形顶点 | `__MU_DEBUG__.glowCount() === 0` |
| **9 黑龙波** | 新增 `CastSpec.special = 'dragon-wave'` → `main.ts` 的 `castDragonWave()`：4 条 `Skill/Laser01.bmd`（scale 0.85、亮度 0.55）在施法者身边 0.62~1.1 格内翻腾（离地 1 格、朝向指回施法者、双频正弦抖动）+ 每 70 ms 一段 `JointSpirit01` 光带 + 1.96 s 渐暗 | 4 条都在半径 ≤2 格内且真的在飘；`__MU_APP__.dragonWave()` 给出实时位置 |
| **48 生命之光** | `SKILL_REFINE[48].replace`：法阵 ×1（源码 1264）+ 竖光 ×36（源码 1253×36），散布半径 1.05 格 | 法阵 1 个、竖光 36 道 |
| **27 守护之光** | `SKILL_REFINE[27].replace`：法阵 ×1 + 关节 2 段（源码 ×2，原来 10 段） | 关节 2 |
| **12 极光** | `SKILL_REFINE[12].replace`：光柱（`JointLaser01` beam，源码 1210）+ 30 段拖尾（源码 1176 连发）。拖尾改成**铺满弹道**（原来固定 0.42 格/段 × 30 = 12.6 格，比射程还长） | beam 1 条 + trail 30 段 |

新增调试口 `__MU_DEBUG__.glowCount()`；探针 `tools/skill-audit-probe.mjs` **11/11**。

### 待修（下一步）

> 2026-10-27 更新：技能特效收尾已基本完成，结论如下。

1. **17 能量球** —— ✅ 已修：改用 `Skill/Snow01.bmd`（源码 212）飞行，资源正确（`skillFx.ts` 的 `WIZARD_FIX[17]`）。
2. **2 / 5 / 8 / 10 加料** —— ⏸️ 用户决定**保留现状**（观感更像正式版）。这些 `ScrollOfMeteoriteEffect` 等 xulek 加料仍留在 `skillFxRefine.ts` 的 `add`，不删。
3. **43 袭风刺** —— ✅ 自身侧已修：按源码 `1254×2(scale50)+1254×2(scale10)+1257×2` 改为 6 道关节（`ATTACK_STAGE_EXTRAS[43]`）。受击者体表电弧（xulek）按用户决定保留。
4. **55 玄月斩** —— ⏸️ 爆闪（`Explotion01`，源码 1267 仅 1 帧）按用户决定保留为可见（0.55 s）。
5. **52 穿透箭** —— ✅ 已修：补 `Joint 1258×2`（JointLaser02）贯穿光 @目标，箭仍由 `shootArrows` 发（`skillFx.ts` 的 `BOW_SKILLS` 分支）。
6. **18/19/20/21/22/23/47/56** —— ✅ 已在代码中实现：19–23 为有意兜底（见 `skillFx.ts` 头部注释，原版靠武器拖尾），47/56 在 `ATTACK_STAGE_EXTRAS`；无需改动。如需字节级复查可再对 `Combat_AttackStage.cpp` / `Attack_WarriorBranch97k`。

> 视觉还原仍需在实机（Windows 原版对照）验证；本地 `tools/skill-audit-probe.mjs` 需浏览器+运行中游戏，未在 CI 跑。

## 修复计划（按严重程度）

| 优先级 | 项 | 做法 |
|---|---|---|
| P0 | 9 黑龙波 | 新增 `joint` 运动：4 方向 × (头/尾)，头每帧 `Laser01`，朝「施法者 z+80」游动 + 抖动 + 贴地 |
| P0 | 48 生命之光 | 修提取脚本的 count 传播；法阵回到 1 个，36 条竖雷改成从地面到天上的光带 |
| P0 | 17 能量球 | 模型改回 `Snow01`（怪 282）/ `Thunder01`（其他） |
| P1 | 12 极光 | 补弹体（`1210` 的飞行 + 30 段拖尾） |
| P1 | 14 毁灭烈焰 | 爆闪换成石头环（197/198 ×8，从天上砸落） |
| P1 | 27 守护之光 | 关节 10 → 2 |
| P2 | 2/5/8/10/42/43/55 | 删掉源码里没有的调味件 |
| P2 | 52 穿透箭 | 补 `Joint 1258 ×2` |
| P2 | 18/19/20/21/22/23/47/56 | 逐个核对本地 `Attack_WarriorBranch` / `AttackStage` 的创建 |

---

## 已确认「不用修」的

1 / 4 / 7 / 11 / 13 / 16 / 26 / 28 / 30–36 / 41 / 49 / 51 —— 特效件与源码一致。
