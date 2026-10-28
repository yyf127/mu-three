/**
 * 场景物件：读取 EncTerrainN.obj，按对象 ID → 模型名（来自 Mu-97k-Client-Source 的
 * Lorencia 物件表）加载 Object1/*.bmd，并把所有静态物件按材质合并成少量 DrawCall。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Bmd, parseBmd } from '../core/bmd';
import {
  MODEL_SCALE,
  Rig,
  applyActionPose,
  buildGeometry,
  createRig,
  createStaticMeshes,
  getBmdMaterial,
  getBoneMatrices,
} from '../core/model';
import { modelBlend } from '../core/blendHeuristic';
import { fetchBytes, loadTexture } from '../core/texture';
import { parseTerrainObjects, TerrainObjectRecord } from './terrain';
import { getMapDefinition, mapObjectDir, mapWorldDir } from './maps';
import { ObjectFxSpot } from './objectFx';

/** Lorencia（Object1）对象 ID → BMD 文件名 */
export const LORENCIA_OBJECTS: Record<number, string> = {};

function fill(from: number, to: number, prefix: string, startAt = 1) {
  for (let id = from, i = startAt; id <= to; id++, i++) {
    LORENCIA_OBJECTS[id] = `${prefix}${String(i).padStart(2, '0')}`;
  }
}

// 树 0..12
fill(0, 12, 'Tree');
// 草 20..27
fill(20, 27, 'Grass');
// 石头 30..34
fill(30, 34, 'Stone');
// 雕像 40..42
fill(40, 42, 'StoneStatue');
// 钢雕像 43
LORENCIA_OBJECTS[43] = 'SteelStatue01';
// 墓碑 44..46
fill(44, 46, 'Tomb');
// 火把 50..51
fill(50, 51, 'FireLight');
// 篝火 52
LORENCIA_OBJECTS[52] = 'Bonfire01';
// 地牢门 55
LORENCIA_OBJECTS[55] = 'DoungeonGate01';
// 商队动物 56..57
fill(56, 57, 'MerchantAnimal');
// 宝箱/鼓 58..59
LORENCIA_OBJECTS[58] = 'TreasureDrum01';
LORENCIA_OBJECTS[59] = 'TreasureChest01';
// 船 60
LORENCIA_OBJECTS[60] = 'Ship01';
// 铁栅栏 65..67 / 铁门 68
fill(65, 67, 'SteelWall');
LORENCIA_OBJECTS[68] = 'SteelDoor01';
// 石墙 69..74
fill(69, 74, 'StoneWall');
// 城墙 75..78
fill(75, 78, 'StoneMuWall');
// 桥 80
LORENCIA_OBJECTS[80] = 'Bridge01';
// 篱笆 81..84
fill(81, 84, 'Fence');
// 石桥 85
LORENCIA_OBJECTS[85] = 'BridgeStone01';
// 路灯 90
LORENCIA_OBJECTS[90] = 'StreetLight01';
// 加农炮 91..93
fill(91, 93, 'Cannon');
// 窗帘 95
LORENCIA_OBJECTS[95] = 'Curtain01';
// 招牌 96..97
fill(96, 97, 'Sign');
// 马车 98..101
fill(98, 101, 'Carriage');
// 草堆 102..103
fill(102, 103, 'Straw');
// 水渠 105
LORENCIA_OBJECTS[105] = 'Waterspout01';
// 井 106..109
fill(106, 109, 'Well');
// 吊灯 / 楼梯 110..111
LORENCIA_OBJECTS[110] = 'Hanging01';
LORENCIA_OBJECTS[111] = 'Stair01';
// 房屋 115..119
fill(115, 119, 'House');
// 帐篷 120
LORENCIA_OBJECTS[120] = 'Tent01';
// 院墙 121..126
fill(121, 126, 'HouseWall');
// 房屋附件 127..129
fill(127, 129, 'HouseEtc');
// 光源 130..132 / 摆件 133
fill(130, 132, 'Light');
LORENCIA_OBJECTS[133] = 'PoseBox01';
// 家具 140..146
fill(140, 146, 'Furniture');
// 蜡烛 150 / 啤酒 151..153
LORENCIA_OBJECTS[150] = 'Candle01';
fill(151, 153, 'Beer');

/**
 * 非洛兰地图的物件命名规则。
 *
 * 客户端 Terrain_LegacyLoad.cpp 里对 World != 0 的做法是：
 *   AccessModel(i, "Data/Object{N}/", "Object", i + 1);
 * 也就是 **物件 ID i → Object{i+1}.bmd**，模型名不需要按地图维护表。
 * 只有洛兰（World 0）是用 OpenModel 逐个手写名字的。
 */
export function objectModelName(mapId: number, id: number): string | null {
  if (mapId === 0) return LORENCIA_OBJECTS[id] ?? null;
  return `Object${String(id + 1).padStart(2, '0')}`;
}

/**
 * 原客户端不渲染（或整只隐藏）的物件类型。
 * 依据 Scene_ObjectUpdate.cpp（World 0 = 洛兰）：
 *   0x82/0x83/0x84 → Light01/02/03，HiddenMesh = -2（8 顶点黑贴图小盒子，
 *                    只是烟雾/火光发射点，模型本身不可见）
 *   0x85          → PoseBox01，姿势锚点，muonlinejs 里同样不加载模型
 */
export const HIDDEN_OBJECT_IDS = new Set([0x82, 0x83, 0x84, 0x85]);

/**
 * 哪些模型整只不该画。
 *
 * 原版是靠 `HiddenMesh = -2` 逐类型标出来的（`Draw_RenderObject` 开头直接 return），
 * 语义上就是「这只是一个特效/交互锚点，没有可见模型」。我们按**模型名**判：
 *
 *   - `PoseBox*`：姿势锚点（玩家「倚靠墙壁」「坐下」这类动作的参考点）
 *   - `Light01/02/03`：洛兰的火光/烟雾发射器（8 顶点小黑盒）
 *   - `HiddenStick*`：隐藏用的木桩
 *
 * 洛兰那批还有明确 id（0x82..0x85，见 `HIDDEN_OBJECT_IDS`）；其它地图物件名是
 * `ObjectNN`，所以只能靠名字/几何判断，这套规则对所有地图都生效。
 */
const HIDDEN_NAME_RE = /^(PoseBox|HiddenStick|Light0[1-3])/i;

/**
 * 「特效模型」的贴图名 —— 这些模型要**叠加混合**画，不能当实心几何体。
 *
 * 典型：冰风谷的极光柱 `Object101 @ aurora.jpg`、地下城的蜘蛛网
 * `Object53 @ cobweb.jpg`，都是 6 顶点的三角柱 + 一张 JPEG（没有 alpha）。
 * 按不透明画出来就是地图上一根**直立的实心三棱柱** —— 实机上看着就像
 * 「多出来一个奇怪的姿势锚点」。原版对这类用 add 混合，是发光/半透明的。
 */
/*
 * 只认真正的「光/网」贴图：`light.jpg` / `streetlight.jpg` / `flower2.jpg` 是路灯、蜡烛、
 * 真花这些**实体**贴图，
 * 把整根灯柱设成叠加混合会亮成一团白 —— 这些必须排除。
 */
const EFFECT_TEX_RE = /(aurora|cobweb|fire_light|light_r|shine|glow|spark|beam)/i;

/**
 * **指定**某些物件必须用加法混合（按资源目录编号）。
 *
 *   `4: Object38` —— 诺利亚（`World4`/`Object4`）的**蝴蝶**。
 *
 * 模型内部名是 `Data2\Object4\寝蝴`（GBK，糊了，就是「蝴蝶」），整个 bmd 只有
 * 932 字节、一张 JPEG 贴图（没有 alpha）。按不透明画出来是一块**实心方片**，
 * 原版用 add 混合，翅膀才是半透明发光的。
 *
 * 它不符合 `isEffectPrism` 的几何判据（不是 6 顶点三棱柱），像素启发式
 * （`blendHeuristic`）也认不出「该加色」—— 所以只能显式点名。
 *
 * 键是**资源目录编号**（用户口中的「world4」= `Data/Object4`），不是 mapId：
 * mapId 3（诺利亚）→ folder 4。这样同一个 `Object38.bmd` 在
 * `Object5`（失落之塔）里不会被误改。
 */
const ADDITIVE_OBJECTS_BY_FOLDER: Record<number, Set<string>> = {
  /*
   * `Object8/Object41.bmd` —— 亚特兰蒂斯的**蝴蝶**（模型内部名 `Data2\Object8\蝴`，
   * 8 顶点、273×273×50 的扁片段，贴图 `ioi01.jpg`）。
   *
   * 为什么自动判据没吃下它：它**像素那一关是过的**（`glowRaw` 0.77、
   * 边框纯黑 0.93、亮点能量 0.46），卡在"贴图名要带特效词"这一条上 ——
   * `ioi01` 这个名字没有任何光/火的词。而去掉名字这一条的话，同一张图里的
   * `gearB.jpg`（0.91 / 外壳 0.91）、`R.jpg`（0.98 / 0.98）会一起被翻成加色，
   * 它们是有体积的实体道具，翻过去就错了。像素上这三张分不开，
   * 所以这里点名 —— 只影响 `Data/Object8` 这一个模型。
   *
   * 对照：诺利亚的蝴蝶 `Object4/Object38.bmd`（贴图 `light01.jpg`）名字带 light，
   * 自动判据已经能认，不需要写在表里。
   */
  8: new Set(['object41']),
};

/** 这个物件是不是被点名要求加法混合（`name` 一律转小写比较） */
export function isForcedAdditive(folder: number, name: string): boolean {
  return ADDITIVE_OBJECTS_BY_FOLDER[folder]?.has(name.toLowerCase()) ?? false;
}

/**
 * 几何判据：**6 顶点、竖直的三棱柱**。
 *
 * 各张图里都有一根这样的"柱子"，贴的是一张 JPEG：
 *
 *   `Object2/Object53` 100×100×300 @ cobweb.jpg   （地下城·蛛网）
 *   `Object3/Object101` 98×85×232 @ aurora.jpg    （冰风谷·极光）
 *   `Object4/Object39`  98×85×232 @ flower2.jpg   （诺利亚·花）
 *
 * 尺寸/顶点数几乎一模一样，本质是"贴了图的效果面片"。原版按 add 混合画，
 * 我们按不透明画就成了实心三棱柱（实机看着像"倚靠墙壁的姿势锚点"）。
 * 贴图名不一定能覆盖所有地图，所以再加一条几何判据兜底。
 */
function isEffectPrism(bmd: Bmd): boolean {
  let verts = 0;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const m of bmd.meshes) {
    verts += m.vertices.length;
    for (const v of m.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  }
  /*
   * 判据就是「**总共 6 个顶点**」—— 一个三角柱。全工程扫下来，6 顶点的模型只有这 9 个，
   * 除了`Object12/Object07`（596×625×594 的血堡大方块）以外全是这类"贴图面片"：
   *
   *   Object1/PoseBox01   100×200×100 @ ston03      ← 姿势锚点（原版就是隐形）
   *   Object2/Object53    100×100×300 @ cobweb      ← 地下城蛛网
   *   Object3/Object101   98×85×232   @ aurora      ← 冰风谷极光
   *   Object3/Object92    98×85×232   @ aurora
   *   Object4/Object39    98×85×232   @ flower2     ← 诺利亚
   *   Object7/Object39    100×200×100 @ au_09       ← World7
   *   Object8/Object40    100×200×100 @ bfish072    ← World8
   *   Object2/DungeonStone01  6×6×6   @ deep_wall01 ← 6 厘米小石子，藏了也无所谓
   *
   * 所以再加一条尺寸上限（≤ 3.5m），把血堡那个大方块排除掉。
   */
  if (verts !== 6) return false;
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  return maxDim <= 350;
}

/**
 * **原版真正的"特殊标记"**：`Scene_ObjectUpdate.cpp` 按 (World, 物件类型)
 * 把 `HiddenMesh`（对象 +0x58）写成 **-2**，`Draw_RenderObject` 一开头
 * `if (HiddenMesh == -2) return;` —— 整只不画。这张表就是从那份 switch 里抽出来的：
 *
 *   World 0（洛兰）  0x82 0x83 0x84  ← Light01/02/03（火/烟发射器）
 *   World 1（地下城）0x27 0x28 0x33
 *   World 4（失落塔）0x18 0x19
 *   World 6（足球场）0x26
 *   World 7（亚特兰）0x16
 *
 * 注意：`.obj` 记录里**没有**任何标记位（30 字节 = id + 位置 + 旋转 + 缩放），
 * 所以只能按「地图 + 类型」查，不能指望数据文件自己标出来。
 * 以后加新地图，只要这里补一行，命中类型的实例就自动隐形。
 */
export const HIDDEN_TYPE_BY_WORLD: Record<number, Set<number>> = {
  0: new Set([0x82, 0x83, 0x84, 0x85]),
  1: new Set([0x27, 0x28, 0x33]),
  4: new Set([0x18, 0x19]),
  6: new Set([0x26]),
  7: new Set([0x16]),
};

function isHiddenObject(mapId: number, id: number, name?: string | null) {
  if (HIDDEN_TYPE_BY_WORLD[mapId]?.has(id)) return true;
  if (mapId === 0 && HIDDEN_OBJECT_IDS.has(id)) return true;
  if (name && HIDDEN_NAME_RE.test(name)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* 物件动画                                                            */
/* ------------------------------------------------------------------ */

/**
 * 物件动画速度：源码 `CreateObject`（0x004FF5A0）给每个物体写
 * `+0x0cc = 0.16`（单位是「帧/帧」），25 fps 基准 → 4 帧/秒。
 *
 * `MoveObject_PerWorld` 每帧 `BMD__PlayAnimation(model, frame, …, animSpeed)`，
 * 也就是物件永远播 **action 0**、速度 0.16 —— 洛兰的树是 31 帧 ≈ 7.5 秒一轮，
 * 窗帘 26 帧、船 30 帧，都慢悠悠的，和原版一致。
 */
export const OBJECT_ANIM_SPEED = 0.16;
const BASE_FPS = 25;

/**
 * 单个模型最多允许多少个「蒙皮实例」。超过就退回静态合并。
 *
 * 蒙皮网格没法合批：一个实例的一个 mesh = 一个 draw call。洛兰的
 * Tree11 有 165 个、Tree01 有 80 个，全做蒙皮直接多出 490 个 draw call，
 * 实测 60fps → 10fps。这批树保持静态（原版远景也看不出摆动），
 * 只给船/马车/动物/窗帘/吊灯/街灯/蜡烛/围墙这些「件数少、动作明显」的做。
 */
const ANIM_MAX_INSTANCES = 40;

/** 同 id 的实例共享一套骨骼（原版同相：同时创建、同速、同 action） */
interface AnimRig {
  rig: Rig;
  frame: number;
  /** 循环长度（帧） */
  len: number;
}

/* ------------------------------------------------------------------ */
/* 物件特效点（世界 0 = 洛兰）                                          */
/* ------------------------------------------------------------------ */

interface FxDef {
  kind: 'fire' | 'smoke' | 'glow';
  /** 本地偏移（世界单位，/100 = 米；源码 `FUN_0046c7f0` 的 dx/dy/dz） */
  ox: number;
  oy: number;
  oz: number;
  /** 火焰面片尺寸（米） */
  size: number;
  /** 火焰上升高度 / 地面光半径（米） */
  range: number;
  color: number;
}

const fire = (ox: number, oy: number, oz: number, size = 0.42, range = 1.0, color = 0xffffff): FxDef =>
  ({ kind: 'fire', ox, oy, oz, size, range, color });
const smoke = (ox: number, oy: number, oz: number, size = 0.8, range = 1.9, color = 0x9a9a9a): FxDef =>
  ({ kind: 'smoke', ox, oy, oz, size, range, color });
const glow = (range = 3, color = 0xffd8a0): FxDef =>
  ({ kind: 'glow', ox: 0, oy: 0, oz: 0, size: 0.5, range, color });

/**
 * 洛兰物件的火焰/烟/地光，逐条对应源码 `Scene_ObjectUpdate.cpp`（World 0）。
 *
 * | id | 模型 | 源码 |
 * |---|---|---|
 * | 0x32 50 | FireLight01 | `FUN_0046c7f0(0, o, 0, 0, 200)` |
 * | 0x33 51 | FireLight02 | `(0, -30, 60)` |
 * | 0x34 52 | Bonfire01 | `(0, 0, 60)` |
 * | 0x37 55 | DoungeonGate01 | `(±150, -150, 140)` 两簇 |
 * | 0x50 80 | Bridge01 | `(90, ±200, 30)` 两簇 |
 * | 0x5A 90 | StreetLight01 | `AddTerrainLight(r=3)` |
 * | 0x82..0x84 130..132 | Light01..03 | `kind = id - 0x82` → 火 / 烟 / 烟 |
 * | 0x96 150 | Candle01 | `AddTerrainLight(r=3)` |
 *
 * 灯柱/蜡烛的地光在原版是 `AddTerrainLight`（给地形顶点加亮），我们用一张
 * 朝上的加色光斑代替（见 `objectFx.ts`）。
 */
const LORENCIA_FX: Record<number, FxDef[]> = {
  0x32: [fire(0, 0, 200, 0.45, 1.15)],
  0x33: [fire(0, -30, 60, 0.4, 0.95)],
  0x34: [fire(0, 0, 60, 0.62, 1.6)],
  0x37: [fire(-150, -150, 140, 0.5, 1.2), fire(150, -150, 140, 0.5, 1.2)],
  0x50: [fire(90, -200, 30, 0.5, 1.1), fire(90, 200, 30, 0.5, 1.1)],
  0x5a: [glow(3.2, 0xffd8a0)],
  0x82: [fire(0, 0, 0, 0.5, 1.25)],
  0x83: [smoke(0, 0, 0)],
  0x84: [smoke(0, 0, 0, 0.72, 1.6)],
  0x96: [glow(2.6, 0xffb864)],
};

/**
 * 其它地图的物件特效点（洛兰用 `LORENCIA_FX`）。
 *
 * 这些 id 在客户端 `Scene_ObjectUpdate.cpp` 的 `switch (World)` 里都有对应分支：
 *
 *   World 1（地下城）  0x29 → `FUN_0046c7f0(0, o, 0, -30, 240)` 火
 *                     0x2a → `FUN_0046c7f0(0, o, 0, 0, 190)`  火
 *                     0x34 → 1/3 概率 `CreateEffect(215)`（闪一下就隐形）→ 当一个光点
 *   World 4（失落塔）  0x18 → 1/64 概率 `CreateEffect(1200)` → 光点
 *   World 7（亚特兰）  0x16 → `Particle_Spawn(1241)` → 光点
 *
 * 它们大多同时被 `HiddenMesh = -2` 隐形（见 `HIDDEN_TYPE_BY_WORLD`）——
 * 也就是说：**模型不画，但特效要出现**。这里就是补那一半。
 */
const FX_BY_MAP: Record<number, Record<number, FxDef[]>> = {
  1: {
    0x29: [fire(0, -30, 240, 0.5, 1.15)],
    0x2a: [fire(0, 0, 190, 0.45, 1.05)],
    0x34: [glow(1.3, 0xffe0b0)],
  },
  4: { 0x18: [glow(2.0, 0xb0d0ff)] },
  7: { 0x16: [glow(1.8, 0xa8e8ff)] },
};

/**
 * 「进屋收屋顶」的物件 —— **只有酒馆的屋顶板**。
 *
 *   125 HouseWall05 / 126 HouseWall06
 *
 * 这两组模型的 mesh 全是**平铺的屋顶瓦片**（模型空间 z 只有 ±0.45，
 * x/y 各 4 米见方），一个实例就是一整块屋顶板；洛兰酒馆的顶由 4+4 块拼成，
 * 范围正好是 `120.5..129.5 × 120.5..137.5`。
 *
 * 为什么不做 House01/03/04/05：它们的内部格子 `.att` 里全是 `TW_NOMOVE`
 * （实测可走 0/30、0/40、0/35、0/30）—— 玩家根本走不进去，收顶没有意义。
 * 酒馆那一片可走 90/170，里面还有家具、蜡烛、啤酒桶，是真正能进的室内。
 *
 * 这和 muonlinejs 的实现完全一致：它也只处理 `MODEL_HOUSE_WALL05/06`
 * （`loadMapIntoScene.ts` 的 `interactiveArea`，区域 `120..129 × 120..136`）。
 */
const ROOF_OBJECT_IDS = new Set([125, 126]);

/**
 * 「进屋收屋顶」的逐地图规则 —— 照抄客户端 `Scene_ObjectUpdate.cpp`：
 *
 *   World 0（洛兰）  类型 125 / 126，`HeroTile == 4` 时把 alpha 设 0
 *   World 2（冰风谷）类型 81/82/96/98/99，`HeroTile == 3 || HeroTile >= 10` 时设 0
 *
 * `HeroTile` 就是**脚下那一格的 `TerrainMappingLayer1`**（地面贴图索引），
 * 不是 .att 的属性位。所以「是不是在屋里」由地形数据本身决定，
 * 不需要我们用包围盒去猜。其它地图 0.97 没有这条规则（原版只有这两张图收顶）。
 */
export interface RoofRule {
  ids: Set<number>;
  /** 站在这种 tile 上就把屋顶收起来（原版 `HeroTile` 判定） */
  inside: (tile: number) => boolean;
}

export const ROOF_RULES: Record<number, RoofRule> = {
  0: { ids: new Set([125, 126]), inside: t => t === 4 },
  2: { ids: new Set([81, 82, 96, 98, 99]), inside: t => t === 3 || t >= 10 },
};

function roofRule(mapId: number): RoofRule | null {
  return ROOF_RULES[mapId] ?? null;
}

/** 一块屋顶板（一个实例），放置阶段收集，放完再按空间连通性拼成「房间」 */
interface RoofPiece {
  /** 世界坐标 AABB（也就是格坐标，1 单位 = 1 格） */
  box: THREE.Box3;
  meshes: THREE.Mesh[];
  name: string;
}

/** 一间「可收顶」的屋子（一块或多块屋顶板拼成） */
interface RoofHouse {
  /** 足迹（世界坐标 AABB，由**非屋顶**的 mesh 算出来） */
  box: THREE.Box3;
  /** 需要在进屋时隐藏的 mesh */
  roof: THREE.Mesh[];
  /** 上一帧的「在屋里」状态，用来只在变化时写 visible */
  inside: boolean;
  /** 模型名（调试用） */
  name: string;
}

export interface WorldObjectsResult {
  group: THREE.Group;
  stats: StaticObjectStats;
  /** 火把/地光等特效点（世界坐标，米） */
  fx: ObjectFxSpot[];
  /** 有骨骼动画的物件统计 */
  anim: { ids: number[]; instances: number; bones: number };
  /** 每帧推进物件动画；远于 `maxDist` 的实例整体隐藏；进出房屋时收/放屋顶 */
  update(dt: number, cx: number, cy: number): void;
  /** 玩家此刻是否在某间「有顶的屋子」里（酒馆换 BGM 用，轻量、不分配） */
  insideRoof(): boolean;
  /** 特效面片（极光/蛛网/花那几根三棱柱）的网格，可整体显隐 */
  effectMeshes: THREE.Mesh[];
  /** 特效面片整体显隐（`false` = 隐藏，`true` = 按叠加混合显示） */
  setEffectVisible(visible: boolean): void;
  /** 已放置实例清单（诊断：站在奇怪模型旁边看它是什么） */
  placed: { id: number; name: string; x: number; y: number }[];
  /**
   * **不渲染但存在**的锚点物件（PoseBox01 / Light01-03 这些 `HiddenMesh=-2`）。
   *
   * 原版照样把它们注册进 `DAT_083a2370`，坐下/倚靠就是靠 PoseBox 当锚点
   * （`Combat.cpp` 的 operate 分支里 `case 133` 就是洛兰的 PoseBox）。
   * 我们为了好看不画它们，但位置得留着，否则「坐椅子」找不到锚点。
   */
  hiddenPlaced: { id: number; name: string; x: number; y: number }[];
  /**
   * 每个模型 id 的规模（顶点数 / mesh 数 / 模型空间包围盒）。
   * 诊断用：区分「贴在空中的小面片」和「有体积的实体道具」。
   */
  modelStats: {
    id: number;
    name: string;
    meshes: number;
    verts: number;
    box: [number, number, number];
  }[];
  /** 收屋顶的统计（探针/调试用） */
  roofs(): {
    houses: number;
    roofMeshes: number;
    hidden: number;
    list: { name: string; x: number; y: number; inside: boolean; meshes: number; box: [number, number, number, number] }[];
  };
}

/**
 * 「物件还在后台加载」时的空壳。
 *
 * 进场景已经提前到「地形 + 地面纹理 + 主角就绪」，物件继续在后台加载；
 * 这期间 `world.objects` 必须可调用（tick 每帧 `update()`、点地面要 `placed`），
 * 所以给一份空实现，加载完成后原地替换字段（引用不变，tick 自动用新的）。
 */
export function emptyWorldObjects(): WorldObjectsResult {
  const group = new THREE.Group();
  group.name = 'world-objects(loading)';
  return {
    group,
    stats: {
      total: 0,
      placed: 0,
      hidden: 0,
      missing: new Set<number>(),
      triangles: 0,
      drawCalls: 0,
      bad: 0,
      hiddenIds: {},
    },
    fx: [],
    anim: { ids: [], instances: 0, bones: 0 },
    update() {},
    insideRoof: () => false,
    effectMeshes: [],
    setEffectVisible() {},
    placed: [],
    hiddenPlaced: [],
    modelStats: [],
    roofs: () => ({ houses: 0, roofMeshes: 0, hidden: 0, list: [] }),
  };
}

export interface StaticObjectStats {
  total: number;
  placed: number;
  hidden: number;
  missing: Set<number>;
  triangles: number;
  drawCalls: number;
  /** 变换非法（坐标/角度/缩放是 NaN）被丢掉的记录数 */
  bad: number;
  /** 每个被整只隐藏的物件 id 有多少个实例（诊断：哪些是占位模型/坏数据） */
  hiddenIds: Record<number, number>;
}

interface Bucket {
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
}

/**
 * 一个物件模型 id 的资产。
 *
 * `animated` 决定 `geometries` 的含义：
 *   - false：静态烘焙（`boneMatrices` 已经把第 0 帧烘进顶点），直接 clone+合并；
 *   - true ：蒙皮模板（带 skinIndex/skinWeight），每个实例一个 SkinnedMesh，
 *            骨骼由 `createRig` 单独驱动（同 id 共享一套骨骼）。
 */
interface ObjectAsset {
  bmd: Bmd;
  animated: boolean;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  /** 每块 mesh 在**模型空间**的包围盒（只对可收顶的房屋算，用来分屋顶/墙体） */
  meshBoxes?: THREE.Box3[];
}

/**
 * 有界并发跑一批任务（默认 8 路）。
 *
 * 不用 `Promise.all` 全量并发：300 多个请求一起打出去，浏览器会把同域连接
 * 排到 6 条 pipeline 上，反而更容易超时；固定 8 路既不排队太久也不打爆。
 */
async function runPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * 物件资源预载（BMD + 贴图），只写缓存，不动场景。
 *
 * 主循环照样按原来的顺序执行，只是每个 `fetchBytes` / `loadTexture` 都命中缓存，
 * 所以这个函数即使部分失败（网络抖动）也不影响正确性 —— 主循环会重新取。
 */
async function prewarmObjectAssets(
  mapId: number,
  counts: Map<number, number>,
  objectDir: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const CONCURRENCY = 8;
  const names: string[] = [];
  for (const id of counts.keys()) {
    const name = objectModelName(mapId, id);
    if (!name) continue;
    // 占位/锚点模型主循环根本不加载，别浪费请求
    if (isHiddenObject(mapId, id, name)) continue;
    names.push(name);
  }
  if (!names.length) return;

  // 1) BMD 字节
  const parsed: Bmd[] = [];
  let done = 0;
  await runPool(names, CONCURRENCY, async name => {
    let bytes: Uint8Array | null = null;
    for (const candidate of [`${objectDir}${name}.bmd`, `${objectDir}${name}.BMD`]) {
      try {
        bytes = await fetchBytes(candidate);
        break;
      } catch {
        /* 换下一个后缀 */
      }
    }
    if (bytes) {
      try {
        parsed.push(parseBmd(bytes));
      } catch {
        /* 坏模型留给主循环去报 */
      }
    }
    onProgress?.(`预载模型 ${++done}/${names.length}（${name}）`);
  });

  // 2) 贴图（要先解析 BMD 才知道 TexturePath）
  const paths = new Set<string>();
  for (const bmd of parsed) for (const mesh of bmd.meshes) paths.add(mesh.texturePath);
  if (!paths.size) return;
  done = 0;
  await runPool([...paths], CONCURRENCY, async tp => {
    try {
      await loadTexture(objectDir, tp);
    } catch {
      /* 缺图/坏图：主循环里会退化成默认材质 */
    }
    onProgress?.(`预载贴图 ${++done}/${paths.size}`);
  });
}

export async function createWorldObjects(
  mapId: number,
  onProgress?: (msg: string) => void,
  /**
   * 取某格的地面贴图索引（`TerrainMappingLayer1`）。
   *
   * 原版 `HeroTile` 就是它，用来判断「人是不是站在屋里」（洛兰 tile 4、
   * 冰风谷 tile 3 / >=10）。不传的话就只按我们自己的屋顶包围盒判断。
   */
  tileAt?: (x: number, y: number) => number
): Promise<WorldObjectsResult> {
  const { folder } = getMapDefinition(mapId);
  const worldDir = mapWorldDir(mapId);
  const objectDir = mapObjectDir(mapId);
  /** 资源目录编号（`Data/Object{N}`），「强制加色」表按它查 */
  const objectFolder = getMapDefinition(mapId).folder;
  const objBuf = await fetchBytes(`${worldDir}EncTerrain${folder}.obj`);
  const rawRecords = parseTerrainObjects(objBuf);
  /*
   * 少数 .obj 里有坐标是 NaN 的记录（冰风谷 2144 条里有 2 条，id=86，y = NaN）。
   * 这类记录一旦参与合并，`composite(pos=NaN)` 会把**整桶**顶点的那个分量
   * 全变成 NaN —— 一个坏记录就能让整张图的物件包围盒刷
   * `computeBoundingBox(): Computed min/max have NaN values`。
   * 它本来就画不出来，直接丢掉最干净。
   */
  const finite = (v: number) => Number.isFinite(v);
  const records = rawRecords.filter(
    r =>
      finite(r.x) &&
      finite(r.y) &&
      finite(r.z) &&
      finite(r.rx) &&
      finite(r.ry) &&
      finite(r.rz) &&
      finite(r.scale) &&
      r.scale !== 0
  );

  const stats: StaticObjectStats = {
    total: records.length,
    placed: 0,
    hidden: 0,
    hiddenIds: {},
    missing: new Set(),
    triangles: 0,
    drawCalls: 0,
    bad: rawRecords.length - records.length,
  };

  const counts = new Map<number, number>();
  for (const r of records) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);

  /*
   * ── 并行预载 ──────────────────────────────────────────────────────
   *
   * 主循环是「一个 id 一个 await」：取 BMD → 逐张 await 贴图 → 下一个。
   * 本地磁盘 8~15s，但 GH Pages 是单文件一个请求、RTT 150-400ms，
   * 109 个物件 + 200 多张贴图串下来实录 4-5 分钟。
   *
   * 这里先开 8 路并发，把所有 BMD 拉进 `bufferCache`，再按 BMD 里的
   * TexturePath 并发把贴图灌进 `textureCache`；主循环就基本不再等网络，
   * 只剩解析几何。缓存按 URL / 候选名去重，同贴图不会重复下载。
   */
  await prewarmObjectAssets(mapId, counts, objectDir, onProgress);

  const buckets = new Map<string, Bucket>();
  const assets = new Map<number, ObjectAsset>();
  /** 有动画的 id → 共享骨骼 */
  const animRigs = new Map<number, AnimRig>();
  /** 动画实例的外层 holder（提供位置/朝向，也用于距离剔除） */
  const holders: { node: THREE.Group; x: number; y: number }[] = [];
  /** 可收顶的房屋（进屋就隐藏 `roof` 里那几块 mesh） */
  const houses: RoofHouse[] = [];
  /** 「三棱柱特效面片」用到的材质（默认不显示，见下面 effectMeshes） */
  const prismMaterials = new Set<THREE.Material>();
  /** 已放置的实例（id/名字/位置），只给诊断用，不进渲染 */
  const placedList: { id: number; name: string; x: number; y: number }[] = [];
  /** 不渲染的锚点物件位置（PoseBox / Light…）：见接口里的 `hiddenPlaced` */
  const hiddenList: { id: number; name: string; x: number; y: number }[] = [];
  /**
   * 每个模型 id 的规模（诊断用）：顶点数 / mesh 数 / 模型空间包围盒。
   * 用来判断「这是不是一张贴在空中的小面片」（蝴蝶、火星、蛛网），
   * 还是「有体积的实体道具」（木桩、铁栅、马车）。
   */
  const modelStats: {
    id: number;
    name: string;
    meshes: number;
    verts: number;
    box: [number, number, number];
  }[] = [];
  /** 这张地图的收顶规则（洛兰 / 冰风谷有，其它地图原版没有） */
  const rule = roofRule(mapId);
  /** 屋顶板（放置阶段收集，循环结束后拼房间） */
  const roofPieces: RoofPiece[] = [];

  const matrix = new THREE.Matrix4();
  const DEG2RAD = Math.PI / 180;
  const euler = new THREE.Euler();
  const IDENTITY = new THREE.Matrix4();

  /** 世界物件总节点：静态合并网格 + 动画实例 holder 都挂这里 */
  const group = new THREE.Group();
  group.name = 'world-objects';

  let done = 0;
  for (const [id, count] of counts) {
    const name = objectModelName(mapId, id);
    if (!name) {
      stats.missing.add(id);
      continue;
    }
    // 占位/锚点模型（PoseBox / Light01-03 / HiddenStick）整只不画，
    // 但把**实例位置**留下来 —— 坐下/倚靠要拿 PoseBox 当锚点
    if (isHiddenObject(mapId, id, name)) {
      stats.hidden += count;
      stats.hiddenIds[id] = (stats.hiddenIds[id] ?? 0) + count;
      for (const record of records) {
        if (record.id !== id) continue;
        hiddenList.push({ id, name, x: record.x / 100, y: record.y / 100 });
      }
      continue;
    }

    onProgress?.(
      `加载物件 ${name} (${++done}/${counts.size}, ×${count})`
    );

    /** 这一 id 是不是「可收顶」的屋顶（洛兰 125/126、冰风谷 81/82/96/98/99） */
    const isRoofHouse = roofRule(mapId)?.ids.has(id) ?? false;

    /**
     * 点名要求加法混合的物件（`ADDITIVE_OBJECTS_BY_FOLDER`）。
     * 例如诺利亚的蝴蝶 `Object4/Object38.bmd`：一张无 alpha 的 JPEG，
     * 不透明画是实心方片，加色才是发光翅膀。
     */
    const forceAdditive = isForcedAdditive(objectFolder, name);

    let asset = assets.get(id);
    if (!asset) {
      const bytes = await (async () => {
        for (const candidate of [
          `${objectDir}${name}.bmd`,
          `${objectDir}${name}.BMD`,
        ]) {
          try {
            return await fetchBytes(candidate);
          } catch {
            /* try next */
          }
        }
        return null;
      })();

      if (!bytes) {
        stats.missing.add(id);
        assets.set(id, { bmd: null as never, animated: false, geometries: [], materials: [] });
        continue;
      }

      let bmd: Bmd;
      try {
        bmd = parseBmd(bytes);
      } catch (err) {
        console.error(
          `[objects] 解析 ${name} 失败 (id=${id}, len=${bytes.length}, head=${Array.from(
            bytes.subarray(0, 8)
          )
            .map(b => b.toString(16))
            .join(' ')})`,
          err
        );
        stats.missing.add(id);
        assets.set(id, { bmd: null as never, animated: false, geometries: [], materials: [] });
        continue;
      }

      /*
       * 有多个关键帧才算「会动」。洛兰 2870 个实例里 334 个属于这类：
       * 树（31 帧）、窗帘（26）、船（30）、马车（21）、街灯（21）、蜡烛（7）……
       * 其余（草、石头、墙、房子）都是单帧，走原来的静态合并路径。
       *
       * ⚠️ 实例数超过 `ANIM_MAX_INSTANCES` 的模型**不做蒙皮**：
       * 每个实例的每个 mesh 都是一个独立 draw call，Tree11（165 个）和
       * Tree01（80 个）光树就 490 个 draw call，实测帧率从 60 掉到 10。
       * 这两种树保持静态合并；数量少的（船、马车、窗帘、街灯）才值得蒙皮。
       */
      /*
       * 可收顶的房屋**强制走静态烘焙**：蒙皮网格要逐实例绑骨骼，进屋时没法
       * 干净地「只藏屋顶那几块」；而且房子本来也不动（HouseEtc02 的马车虽然是
       * 骨骼模型，但烘焙第 0 帧和现在看起来一样）。
       */
      const animated =
        !isRoofHouse &&
        count <= ANIM_MAX_INSTANCES &&
        bmd.bones.length > 0 &&
        bmd.actions.some(a => a.numKeys > 1);

      /** 那根「6 顶点竖直三棱柱」—— 原版里是特效面片，我们默认不画 */
      const prism = isEffectPrism(bmd);

      const built: ObjectAsset = { bmd, animated, geometries: [], materials: [] };
      if (animated) {
        const identityRemap = (i: number) => i;
        for (const mesh of bmd.meshes) {
          const tex = await loadTexture(objectDir, mesh.texturePath);
          /*
           * 混合模式**看像素**判（`core/blendHeuristic`，从 muonline-bmd-viewer 移植）：
           * 透明比例、边缘黑边、亮度分布 → opaque / normal(软透明) / additive。
           * 比按文件名正则猜稳得多（`flower2.jpg` 是真花，`bfish072.jpg` 才是特效）。
           *
           * 加色有两条路：像素判出来的 `mb.additive`（黑底发光），
           * 或显式指定（`forceAdditive` 名单 / `prism` 三棱柱特效面片）。
           */
          const mb = modelBlend(tex?.texture ?? null, tex?.tag === 'blend', mesh.texturePath);
          const geo = buildGeometry(mesh, { scale: MODEL_SCALE, boneIndexRemap: identityRemap });
          built.geometries.push(geo);
          built.materials.push(
            getBmdMaterial(
              tex?.texture ?? null,
              mb.cutout,
              true,
              forceAdditive || prism || mb.additive,
              mb.soft
            )
          );
        }
        const rig = createRig(bmd, MODEL_SCALE);
        const len = Math.max(2, rig.loopLen[0] || bmd.actions[0]?.numKeys || 2);
        animRigs.set(id, { rig, frame: 0, len });
      } else {
        const rig = createRig(bmd, MODEL_SCALE);
        const boneMatrices = getBoneMatrices(rig);
        for (const mesh of bmd.meshes) {
          const tex = await loadTexture(objectDir, mesh.texturePath);
          const mb = modelBlend(tex?.texture ?? null, tex?.tag === 'blend', mesh.texturePath);
          const one = { ...bmd, meshes: [mesh] };
          const s = createStaticMeshes(
            one,
            boneMatrices,
            tex?.texture ?? null,
            mb.cutout,
            undefined,
            forceAdditive || prism || mb.additive,
            mb.soft
          );
          for (const geo of s.geometries) {
            built.geometries.push(geo);
            built.materials.push(s.material);
          }
        }
      }
      /*
       * 空模型 / 坏数据（顶点坐标 4e8 那种）直接当「没有」：
       * 画出来要么是空 draw call，要么是一大片撕裂的黑影 —— 实机上就是
       * 「地图上多出来一个奇怪的东西」。
       */
      const verts = bmd.meshes.reduce((n, m) => n + m.vertices.length, 0);
      /*
       * 坏数据：模型空间坐标单位是厘米，正常值在 ±1000 以内。
       * 冰风谷的 `Object84/85/86` 有几个顶点是 4e8（BMD 里本来就是坏的），
       * 画出来是一大片撕裂的黑影 —— 实机上看着就是「地图上多了个怪东西」。
       */
      let broken = !verts;
      for (const m of bmd.meshes) {
        for (const v of m.vertices) {
          if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z) ||
              Math.abs(v.x) > 1e4 || Math.abs(v.y) > 1e4 || Math.abs(v.z) > 1e4) {
            broken = true;
            break;
          }
        }
        if (broken) break;
      }
      if (broken) {
        if (verts) console.warn(`[objects] ${name} 顶点数据异常，整只跳过（id=${id}）`);
        stats.hidden += count;
        stats.hiddenIds[id] = (stats.hiddenIds[id] ?? 0) + count;
        assets.set(id, { bmd: null as never, animated: false, geometries: [], materials: [] });
        continue;
      }
      {
        let vx = 0;
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (const m of bmd.meshes) {
          vx += m.vertices.length;
          for (const v of m.vertices) {
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.y < minY) minY = v.y;
            if (v.y > maxY) maxY = v.y;
            if (v.z < minZ) minZ = v.z;
            if (v.z > maxZ) maxZ = v.z;
          }
        }
        modelStats.push({
          id,
          name,
          meshes: bmd.meshes.length,
          verts: vx,
          box: [maxX - minX, maxY - minY, maxZ - minZ].map(n => +n.toFixed(1)) as [number, number, number],
        });
      }
      if (prism) for (const m of built.materials) prismMaterials.add(m);
      if (isRoofHouse) {
        built.meshBoxes = built.geometries.map(g => {
          g.computeBoundingBox();
          return (g.boundingBox ?? new THREE.Box3()).clone();
        });
      }
      assets.set(id, built);
      asset = built;
    }

    for (const record of records) {
      if (record.id !== id) continue;

      // .obj 里的角度单位是「度」（客户端 Matrix_BuildFromEuler 会先 ×π/180），
      // 且 X 轴旋转在客户端实现里是反向的。
      euler.set(-record.rx * DEG2RAD, -record.ry * DEG2RAD, record.rz * DEG2RAD, 'ZYX');
      const quat = new THREE.Quaternion().setFromEuler(euler);
      const px = record.x / 100;
      const py = record.y / 100;
      const pz = record.z / 100;

      // 实例矩阵先算出来：可收顶的房屋要拿它把模型空间包围盒变成世界 AABB
      matrix.compose(
        new THREE.Vector3(px, py, pz),
        quat,
        new THREE.Vector3(record.scale, record.scale, record.scale)
      );

      /*
       * 带屋顶的房屋**不参与合批** —— 合进去就再也拆不开，进屋时没法单独隐藏屋顶。
       * 洛兰这类房屋一共十来栋、每栋 3~9 块 mesh，单独成 mesh 只多十几个 draw call，
       * 换来「走进屋里抬头能看见天」。
       */
      if (isRoofHouse && asset.meshBoxes) {
        const holder = new THREE.Group();
        holder.name = `roof:${name}:${stats.placed}`;
        holder.position.set(px, py, pz);
        holder.quaternion.copy(quat);
        holder.scale.setScalar(record.scale);

        const meshes: THREE.Mesh[] = [];
        // 整块实例的 AABB（所有 mesh 的盒子并起来，再乘实例矩阵）
        const pieceBox = new THREE.Box3();
        const tmp = new THREE.Box3();
        for (let i = 0; i < asset.geometries.length; i++) {
          const mesh = new THREE.Mesh(asset.geometries[i], asset.materials[i]);
          holder.add(mesh);
          meshes.push(mesh);
          stats.drawCalls++;
          tmp.copy(asset.meshBoxes[i]).applyMatrix4(matrix);
          pieceBox.union(tmp);
          stats.triangles += (asset.geometries[i].index?.count ?? 0) / 3;
        }

        group.add(holder);
        roofPieces.push({ box: pieceBox, meshes, name });
        stats.placed++;
      placedList.push({ id, name, x: px, y: py });
        placedList.push({ id, name, x: px, y: py });
        continue;
      }

      if (asset.animated) {
        const anim = animRigs.get(id);
        if (!anim) continue;

        /*
         * 蒙皮网格**不能挂在骨骼下面**：Three 的顶点 = mesh.matrixWorld ×
         * (boneWorld × boneInverse) × p，骨骼的世界矩阵已经含了实例变换，
         * 再乘一次 mesh 的世界矩阵就会被应用两遍。
         * 所以骨骼（rig.root）留在原点、不入场景，只当「姿态」用；
         * 每个实例用一层 holder 提供位置/朝向/缩放。
         *
         * ⚠️ 还必须切到 `DetachedBindMode`：
         * 默认的 `AttachedBindMode` 会在每帧 `updateMatrixWorld` 里把
         * `bindMatrixInverse` 覆盖成 `inverse(mesh.matrixWorld)` —— 也就是
         * `inverse(holder)`，顶点着色器里再把 holder 乘回去时正好抵消，
         * 于是所有动画物件都被钉在模型原点（世界 0,0）上。
         */
        const holder = new THREE.Group();
        holder.name = `obj:${name}:${stats.placed}`;
        holder.position.set(px, py, pz);
        holder.quaternion.copy(quat);
        holder.scale.setScalar(record.scale);
        for (let i = 0; i < asset.geometries.length; i++) {
          const sm = new THREE.SkinnedMesh(asset.geometries[i], asset.materials[i]);
          sm.bindMode = THREE.DetachedBindMode;
          sm.bind(anim.rig.skeleton, IDENTITY);
          sm.frustumCulled = false;
          sm.matrixAutoUpdate = false;
          sm.updateMatrix();
          holder.add(sm);
          stats.drawCalls++;
        }
        group.add(holder);
        holders.push({ node: holder, x: px, y: py });
        stats.triangles += asset.geometries.reduce(
          (s, g) => s + (g.index?.count ?? 0) / 3,
          0
        );
      } else {
        for (let i = 0; i < asset.geometries.length; i++) {
          const geo = asset.geometries[i];
          const material = asset.materials[i];
          const g = geo.clone().applyMatrix4(matrix);
          const key = material.uuid;
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = { material, geometries: [] };
            buckets.set(key, bucket);
          }
          bucket.geometries.push(g);
        }
      }
      stats.placed++;
      placedList.push({ id, name, x: px, y: py });
    }
  }

  for (const bucket of buckets.values()) {
    if (bucket.geometries.length === 0) continue;

    const merged = mergeGeometries(bucket.geometries, false);
    bucket.geometries.forEach(g => g.dispose());
    if (!merged) continue;

    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    stats.drawCalls++;
    stats.triangles += (merged.index?.count ?? 0) / 3;
  }

  /*
   * 把屋顶板拼成「房间」。
   *
   * 洛兰酒馆的顶是 8 块 4×4 的板拼出来的（4 块 HouseWall05 + 4 块 HouseWall06），
   * 每块板的 AABB 只盖住屋子的一角 —— 直接按板判断的话，玩家走一步就会看到
   * 屋顶一块一块地消失。这里按「XZ 上相接」聚成一组，进屋时整片一起收。
   */
  {
    const roomOf = new Array<number>(roofPieces.length).fill(-1);
    let roomCount = 0;
    for (let i = 0; i < roofPieces.length; i++) {
      if (roomOf[i] >= 0) continue;
      const idx = roomCount++;
      roomOf[i] = idx;
      const queue = [i];
      while (queue.length) {
        const a = roofPieces[queue.pop() as number];
        for (let j = 0; j < roofPieces.length; j++) {
          if (roomOf[j] >= 0) continue;
          const b = roofPieces[j];
          // 0.35 格的容差：拼板之间本来就贴边，浮点误差会差一点点
          const touchX = a.box.min.x - 0.35 <= b.box.max.x && b.box.min.x - 0.35 <= a.box.max.x;
          const touchY = a.box.min.y - 0.35 <= b.box.max.y && b.box.min.y - 0.35 <= a.box.max.y;
          if (touchX && touchY) {
            roomOf[j] = idx;
            queue.push(j);
          }
        }
      }
    }
    const rooms: { box: THREE.Box3; roof: THREE.Mesh[]; name: string }[] = [];
    for (let i = 0; i < roofPieces.length; i++) {
      const r = roomOf[i];
      if (!rooms[r]) rooms[r] = { box: new THREE.Box3(), roof: [], name: roofPieces[i].name };
      rooms[r].box.union(roofPieces[i].box);
      rooms[r].roof.push(...roofPieces[i].meshes);
    }
    for (const r of rooms) {
      houses.push({ box: r.box, roof: r.roof, inside: false, name: r.name });
    }
    roofPieces.length = 0;
  }

  /* ---- 特效点（火把/篝火/街灯/蜡烛） ---- */
  const fx: ObjectFxSpot[] = [];
  const fxTable = mapId === 0 ? LORENCIA_FX : FX_BY_MAP[mapId];
  if (fxTable) {
    for (const r of records) {
      const defs = fxTable[r.id];
      if (!defs) continue;
      const ang = r.rz * DEG2RAD;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      for (const d of defs) {
        const lx = (d.ox / 100) * r.scale;
        const ly = (d.oy / 100) * r.scale;
        fx.push({
          x: r.x / 100 + lx * cos - ly * sin,
          y: r.y / 100 + lx * sin + ly * cos,
          z: r.z / 100 + (d.oz / 100) * r.scale,
          kind: d.kind,
          size: d.size * r.scale,
          range: d.range * r.scale,
          color: d.color,
          src: r.id,
        });
      }
    }
  }

  /* ---- 每帧：推进骨骼 + 远处实例隐藏 ---- */
  const stepPerFrame = OBJECT_ANIM_SPEED;
  const HIDE_DIST2 = 150 * 150;

  const animIds = [...animRigs.keys()];
  const animInstances = holders.length;
  const animBones = animIds.reduce((s, id) => s + (animRigs.get(id)?.rig.bones.length ?? 0), 0);

  function update(dt: number, cx: number, cy: number) {
    /*
     * 进屋收屋顶：
     *   ① 足迹判定 —— 屋顶板聚类出来的那间屋子，人站进去就收（我们自己的实现）；
     *   ② 原版判定 —— 脚下这格的 `TerrainMappingLayer1` 命中 `ROOF_RULES[map].inside`
     *      （洛兰 tile 4、冰风谷 tile 3 或 >=10），且人在屋顶群的整体范围内。
     * 两条取并集：哪条成立都收，避免某些地图只剩「站屋里却没进足迹」的边角。
     * 只在状态翻转时写 `visible`，平时每帧几次浮点比较。
     */
    const tile = tileAt ? tileAt(cx, cy) : -1;
    const tileInside = rule ? rule.inside(tile) : false;
    for (const h of houses) {
      const inBox = cx >= h.box.min.x && cx <= h.box.max.x && cy >= h.box.min.y && cy <= h.box.max.y;
      // tile 判定只对本屋**外扩 1.5 格**的范围生效 —— 否则一张图里所有屋顶会一起消失
      const nearBox =
        tileInside &&
        cx >= h.box.min.x - 1.5 &&
        cx <= h.box.max.x + 1.5 &&
        cy >= h.box.min.y - 1.5 &&
        cy <= h.box.max.y + 1.5;
      const inside = inBox || nearBox;
      if (inside === h.inside) continue;
      h.inside = inside;
      for (const m of h.roof) m.visible = !inside;
    }

    if (animRigs.size === 0 && holders.length === 0) return;

    // 帧推进按 25fps 基准换算：源码每帧 +0.16 帧，dt 秒 → dt*25*0.16 帧
    const step = stepPerFrame * BASE_FPS * Math.min(dt, 0.1);
    for (const a of animRigs.values()) {
      if (!Number.isFinite(a.frame) || !Number.isFinite(a.len) || a.len <= 0) {
        console.warn('[objects] 动画帧异常，重置', { frame: a.frame, len: a.len, step });
        a.frame = 0;
        a.len = 2;
      }
      a.frame += step;
      if (a.frame >= a.len) a.frame %= a.len;
      /*
       * 必须用插值版：`applyActionFrame` 是按整数帧下标取数组的，
       * 传 0.37 这种小数会 `posArr[1.11]` 读到 undefined，被兜底成 0，
       * 结果所有骨骼停在绑定姿态（矩阵求和恒等于 24 个单位阵 = 96）。
       */
      applyActionPose(a.rig, 0, a.frame, true);
      a.rig.root.updateMatrixWorld(true);
      a.rig.skeleton.update();
    }

    for (const h of holders) {
      const dx = h.x - cx;
      const dy = h.y - cy;
      h.node.visible = dx * dx + dy * dy < HIDE_DIST2;
    }
  }

  function roofs() {
    let roofMeshes = 0;
    let hidden = 0;
    for (const h of houses) {
      roofMeshes += h.roof.length;
      if (h.inside) hidden += h.roof.length;
    }
    return {
      houses: houses.length,
      roofMeshes,
      hidden,
      list: houses.map(h => ({
        name: h.name,
        x: +((h.box.min.x + h.box.max.x) / 2).toFixed(1),
        y: +((h.box.min.y + h.box.max.y) / 2).toFixed(1),
        inside: h.inside,
        meshes: h.roof.length,
        box: [+h.box.min.x.toFixed(1), +h.box.min.y.toFixed(1), +h.box.max.x.toFixed(1), +h.box.max.y.toFixed(1)] as [number, number, number, number],
      })),
    };
  }

  function insideRoof() {
    for (const h of houses) if (h.inside) return true;
    return false;
  }

  /*
   * 特效面片（叠加混合材质的那几个）单独收一份：用户如果觉得"还是在"，
   * 一句 `__MU_APP__.effects(false)` 就能整类藏掉，不用等改代码。
   */
  const effectMeshes: THREE.Mesh[] = [];
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some(mm => prismMaterials.has(mm))) effectMeshes.push(m);
  });
  /*
   * 默认**不显示**这几根三棱柱：0.97 原版对这类"特效面片"是当隐形处理
   * （`HiddenMesh = -2`），我们在实机上看到的是一根突兀的实心柱。
   * 想恢复成叠加混合的光柱/花，运行 `__MU_APP__.effects(true)`。
   */
  for (const m of effectMeshes) m.visible = false;

  return {
    group,
    stats,
    fx,
    effectMeshes,
    setEffectVisible(visible: boolean) {
      for (const m of effectMeshes) m.visible = visible;
    },
    placed: placedList,
    hiddenPlaced: hiddenList,
    /** 每个模型 id 的规模（顶点数 / mesh 数 / 包围盒），诊断用 */
    modelStats,
    anim: { ids: animIds, instances: animInstances, bones: animBones },
    update,
    roofs,
    insideRoof,
  };
}
