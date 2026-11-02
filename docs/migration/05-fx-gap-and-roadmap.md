# 特效体系差距盘点与提升路线（2026-11-02）

> 目的：回应「H5 特效整体没达到 Win 端」——先量化差距，再定优先级。
> 证据等级：`CONFIRMED_SOURCE`（源码） / `CONFIRMED_RUNTIME`（运行对照） / `INFERRED` / `UNKNOWN`

## 一、原版特效体系 = 五类渲染器，各有专属运动学

| 原版渲染器 | 规模 | mu-three 对应 | 覆盖状态 |
|---|---|---|---|
| `Effect_Create`（BMD 模型） | ~40 槽 | `src/world/effects.ts` | 🟢 已覆盖（含 BMD 动画、速度 0.3、贴地光斑近似） |
| `Particle_Spawn`（粒子） | **28 case** | 降级成静态 sprite | 🔴 **最大缺口（本轮已补第一刀）** |
| `Joint_Create`（连线关节） | ~10 | `src/world/beams.ts` | 🟡 有 beam；已支持 8 段链（55/1168） |
| `MoveEffect`（运动模型） | ~15 case | `effects.ts` 的 fly/vel/gravity | 🟡 部分覆盖 |
| `Trail_RenderAll`（武器拖尾） | 1 | `src/world/trails.ts` | 🟢 已覆盖 |

## 二、根因：粒子被降级成「静态贴纸」

- `MoveEffect.cpp` 里 **50+ 处**按帧调用 `Particle_Spawn`（技能存活期持续喷发火花/烟/尘）；
- mu-three 的 `skillFx.ts` 粒子分支（`isExtra && !EFFECT_MODELS`）只把它转成
  `{ kind: 'sprite', size: 0.9, life: 0.8 }` —— **没有速度、重力、缩放衰减**，
  所以「烟雾不飘、火花不炸、灰烬不落」。

## 三、已实施（commit ba415f3）：粒子物理系统 v1

- `sprites.ts`：SpriteOptions/SpriteFx 新增 `vel/velJitter/gravity/drag/grow/groundZ/rotVel`；
  `update()` 积分速度、重力、阻尼、落体吸附、动态缩放、自转；
  `snapshot()` 改报**实际渲染位置**（探针可测位移）。
- `skillFx.ts`：`PARTICLE_PHYS` 表，11 个高频粒子 type 的运动学近似
  （1195=0x4ab 烟、1197=0x4ad、1215=0x4bf 扬尘、1220=0x4c4 火花、
  1221=0x4c5 喷发、1241=0x4d9 飞舞、1430=0x596 火舌、1383=0x567 血雾、
  1176=0x498 血溅、1191=0x4a7 火花、1234=0x4d2 闪烁、1230=0x4ce 涟漪）。
- 验证：`tsc` / `build` / skill-fx-probe 44/44 / skill-beam-probe 8/8 /
  particle-phys-probe 6/6，全部通过。

## 四、剩余提升路线（按优先级）

### P1 —— 持续喷发（最大观感缺口，下一轮）
`MoveEffect.cpp` 的 50+ 处 `Particle_Spawn` 是**每帧调**（火柱每帧出烟、陨石
砸地持续喷火花），当前一键施法只放一批。方案：
- `FxPart` 加 `emit?: { countPerSec: number; type: number }`（持续发射器）；
- `SpriteLayer` 增加发射器节点（emit 阶段接管 spawn），寿命到自动停；
- 按 type 复用 `PARTICLE_PHYS`。

### P2 —— 关节动态化
`Joint_Create` 的 `MoveJoint.cpp` 每帧更新端点（雷/光带会**爬动**），
当前 beam 是静态线段。可加 `wobble`（每帧重算中间节点）。

### P3 —— MoveEffect 逐帧状态机
`MoveEffect.cpp` 的 case（191 陨石 ladder、244 武器砸地 timeline）目前只有
简化版（fly/vel/gravity），逐帧 stage 未照搬。适合给「观感最差的 3~5 个技能」
逐个做。

### P4 —— 视觉验收对照
所有改动视觉结论仍是 `VISUAL UNVERIFIED`。建议：Windows 原版录屏/截图同屏
对照（用 `Mu-97k-Client-Win32`），按 checklist 验收。

## 五、技术债

- `generated.ts` 的粒子 type 是十进制，`PARTICLE_PHYS` 键与之对齐；
  十六进制只出现在注释里，别混用。
- snapshot 已改真实位置，旧探针若断言 `pos === at` 会失败（当前无此断言）。