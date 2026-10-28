/**
 * 地面物品：模型解析 + 场景管理。
 *
 * 模型路径的对应关系来自 0.97 客户端源码：
 *
 *   `Model_Players.cpp::Model_LoadItemMeshes`（IDA: OpenItems @ 0x005079D0）
 *   `Model_Items.cpp`（防具在 Data/Player 下）
 *
 * 关键恒等式（客户端 `structs.h` 与服务端 `ItemManager.h` 完全一致）：
 *
 *   type  = GET_ITEM(group, index) = group * 32 + index
 *   model = type + ITEM_BASE_MODEL(400)
 *
 * 所以 group 0（剑）的 model 槽从 400 起，group 1（斧）从 432 起……
 * 每个 group 正好 32 个槽位，模型文件名就是「类别前缀 + 两位序号」，
 * 序号基本等于 index + 1，个别 group（药水/宝石）有跳跃，见 GROUP14_SPECIAL。
 */
import * as THREE from 'three';
import { parseBmd, Bmd } from '../core/bmd';
import { MODEL_SCALE, createRig, getBoneMatrices, createStaticMeshes } from '../core/model';
import { fetchBytes, loadTexture } from '../core/texture';
import { modelBlend } from '../core/blendHeuristic';
import type { GroundItem } from '../net/game';
import { TYPE_MONEY } from '../net/game';
import { itemNameSync } from '../data/localText';
import { radialGlow } from './objectFx';
import { additiveProps, fxAlpha } from '../core/additive';

const ITEM_DIR = '/Data/Item/';
const PLAYER_DIR = '/Data/Player/';

interface ModelGroup {
  dir: string;
  prefix: string;
}

/**
 * group → 模型前缀。下标就是 item group（0..15）。
 *
 * 型号槽位 = group*32 + 400 与这里的顺序一一对应：
 *   400 Sword / 432 Axe / 464 Mace / 496 Spear / 528 Bow / 560 Staff / 592 Shield
 *   624 HelmMale / 656 ArmorMale / 688 PantMale / 720 GloveMale / 752 BootMale
 *   784 Wing / 816 Helper / 848 Potion / 880 Book
 *
 * 防具那 5 组的前缀**不带性别**，由 `itemModelPath(type, body)` 拼上
 * （`Model_Items.cpp:246-262`：男 1..10 + 0x10/0x11、精灵只有 1..5）。
 */
const GROUPS: (ModelGroup | null)[] = [
  { dir: ITEM_DIR, prefix: 'Sword' }, // 0
  { dir: ITEM_DIR, prefix: 'Axe' }, // 1
  { dir: ITEM_DIR, prefix: 'Mace' }, // 2
  { dir: ITEM_DIR, prefix: 'Spear' }, // 3
  { dir: ITEM_DIR, prefix: 'Bow' }, // 4
  { dir: ITEM_DIR, prefix: 'Staff' }, // 5
  { dir: ITEM_DIR, prefix: 'Shield' }, // 6
  { dir: PLAYER_DIR, prefix: 'Helm' }, // 7
  { dir: PLAYER_DIR, prefix: 'Armor' }, // 8
  { dir: PLAYER_DIR, prefix: 'Pant' }, // 9
  { dir: PLAYER_DIR, prefix: 'Glove' }, // 10
  { dir: PLAYER_DIR, prefix: 'Boot' }, // 11
  { dir: ITEM_DIR, prefix: 'Wing' }, // 12
  { dir: PLAYER_DIR, prefix: 'Helper' }, // 13
  { dir: ITEM_DIR, prefix: 'Potion' }, // 14（8 以后是特例）
  { dir: ITEM_DIR, prefix: 'Book' }, // 15
];

/** 这 5 组按穿戴者性别拼前缀（Male / Elf） */
const BODY_GROUPS = new Set([7, 8, 9, 10, 11]);

/** 防具体型：男 / 精灵（0.97 只有这两套，`Model_Items.cpp:246` 与 `:256`） */
export type BodyGender = 'Male' | 'Elf';

/**
 * 防具的**文件序号与前缀**。
 *
 * 关键：精灵五套占的是**另一段模型槽**，不是男装的某几个号。
 * `Model_Items.cpp` 的 `OpenPlayers` 里：
 *
 *   Helm/Armor/Pant/Glove/Boot **Male**  `AccessModel(i + 0x26F, "HelmMale", i)` i=1..10
 *                                        → 槽 624..633（type 224..233）
 *   同一组 **Elf**                       `AccessModel(i + 0x279, "HelmElf",  i)` i=1..5
 *                                        → 槽 634..638（type 234..238）
 *
 * 而 `Player/` 目录里只有 `HelmMale01..10`、`HelmMale17..22`、`HelmElf01..05` ——
 * **没有 HelmMale11..15**。所以 type 234（藤盔 / Vine Helm）必须走 `HelmElf01`，
 * 之前按 `index + 1` 算成 `HelmMale11`，文件 404 → 掉落在地上看不见、
 * 背包和仓库那一格也是空的（精灵五套共 25 件，全是这个原因）。
 *
 * 之后 index 16..21 是补充的男装档（`AccessModel(0x29F, "ArmorMale", 0x10)` 起），
 * 文件号仍然 = index + 1（17..22）。
 */
function bodyModel(
  group: number,
  index: number,
  body: BodyGender
): { prefix: string; n: number } | null {
  const g = GROUPS[group];
  if (!g) return null;
  const elfSlot = index >= 10 && index <= 14;
  if (elfSlot) return { prefix: `${g.prefix}Elf`, n: index - 9 };
  return { prefix: `${g.prefix}${body}`, n: index + 1 };
}


/**
 * **模型槽（`type + 400`）→ 模型文件**，逐条照抄 `OpenItems`
 * （`Render/../Model/Model_Players.cpp`，IDA 0x005079D0）。
 *
 * 为什么必须有这张表：原版加载时就是**按槽号硬编码**的 ——
 * `AccessModel(0x317, "Gem", 1)`、`AccessModel(0x33E, "Quest", 4)`、
 * `AccessModel(0x360, "Jewel", 3)`… 槽号和文件名之间**没有任何算术关系**：
 *
 *   791..798 → Gem01..08        （group 12 的 index 7..14 是技能石，不是翅膀！）
 *   799      → Jewel15          （"Jewel of Chaos"，占掉 Gem09 的槽）
 *   800..803 → Gem10..13
 *   830      → Quest04          （Loch's Feather 洛克之羽）
 *   831      → Quest05          （Fruit 果实 —— 源码注释点名过：之前漏载，果实看不见）
 *   832..834 → EventBloodCastle00..02（血灵之书 / 血灵之骷 / 透明披风）
 *   864..874 → Jewel03 / Devil00..02 / Drink00 / ConChip00 / jewel22 / Quest00..03
 *              （生命宝石 / 恶魔之眼 / 恶魔之钥 / 恶魔广场通行证 / 爱情的魔力 /
 *               Rena 通宝 / 创造宝石 / 帝王之书 / 断魂之剑 / 精灵之泪 / 先知之魂）
 *
 * 之前只按「group 前缀 + index」拼名字，group 12/13/14 的尾部（index 7+/14+/16+）
 * 全部落到 Wing08 / Helper05 / Potion17 这种不存在的文件上 —— 表现就是
 * **掉落在地上一片空白、背包/仓库里那一格什么都没有**。
 */
const SLOT_FILES = new Map<number, { dir: string; file: string }>();
{
  const add = (slot: number, dir: string, file: string) => SLOT_FILES.set(slot, { dir, file });
  const seq = (base: number, dir: string, prefix: string, from: number, count: number) => {
    for (let i = 0; i < count; i++) add(base + i, dir, `${prefix}${pad2(from + i)}`);
  };
  /*
   * type 20「断月之光 / Knight Blade」→ 槽 420（0x1A4）。
   * `OpenItems` 只加载到 0x1A3（Sword18..20），但资源包里确实有这把剑的模型，
   * 文件名是**小写** `sword22.bmd`（和大写序列不是一个来源），直接点名取它。
   */
  add(420, ITEM_DIR, 'sword22');
  // 技能石（Orb of …）：0x317..0x322，跳过 0x31F（那是 Jewel15）
  seq(791, ITEM_DIR, 'Gem', 1, 8);
  add(799, ITEM_DIR, 'Jewel15');
  seq(800, ITEM_DIR, 'Gem', 10, 4);
  // 任务 / 血色城堡活动物品（0x33E..0x342）
  add(830, ITEM_DIR, 'Quest04');
  add(831, ITEM_DIR, 'Quest05');
  seq(832, ITEM_DIR, 'EventBloodCastle', 0, 3);
  // 宝石 / 恶魔广场 / 任务道具（0x360..0x36A）
  add(864, ITEM_DIR, 'Jewel03');
  seq(865, ITEM_DIR, 'Devil', 0, 3);
  add(868, ITEM_DIR, 'Drink00');
  add(869, ITEM_DIR, 'ConChip00');
  add(870, ITEM_DIR, 'jewel22');
  seq(871, ITEM_DIR, 'Quest', 0, 4);
  // 额外活动 / 宝箱槽（0x3B3、0x3B4、0x3B7..0x3BD）—— 0.97 的 item.txt 没这两组，
  // 但服务端/其它版本可能下发，补上免得又落到不存在的文件
  add(947, ITEM_DIR, 'Event02');
  add(948, ITEM_DIR, 'Event03');
  add(951, ITEM_DIR, 'MagicBox02');
  add(952, ITEM_DIR, 'MagicBox04');
  add(953, ITEM_DIR, 'MagicBox05');
  add(954, ITEM_DIR, 'Beer02');
  add(955, ITEM_DIR, 'MagicBox06');
  add(956, ITEM_DIR, 'MagicBox07');
  add(957, ITEM_DIR, 'MagicBox08');
  add(958, ITEM_DIR, 'EventBloodCastle03');
}

/** group 14 的 index ≥ 8 不是 Potion08/09…，客户端是逐个点名的 */
const GROUP14_SPECIAL: Record<number, string> = {
  8: 'Antidote01',
  9: 'Beer01',
  10: 'Scroll01',
  11: 'MagicBox01',
  12: 'Event01',
  13: 'Jewel01',
  14: 'Jewel02',
  15: 'Gold01',
};

/** group 12 翅膀在客户端只有 7 个文件，index 超了就当未知 */
const GROUP_LIMIT: Record<number, number> = { 12: 7, 13: 3, 14: 16, 15: 19 };

/** 两位补零。写成函数声明（会提升）—— `SLOT_FILES` 的初始化块在它上面就用到 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 地面物品的初始朝向，逐条照抄客户端 `ItemAngle`（IDA 0x005030C0）。
 *
 * 原版**不是自转**，是每类物品一个固定角度斜插在地上：
 *   默认            rz = -45°
 *   400..463 剑/斧/锤/矛   rx = 60°
 *   536..544 / 546 弓      rx = 90°
 *   464..591 弓/法杖       ry = 270°
 *   592..623 盾            ry = 270°, rz = 225°
 *   656..751 防具          rx = 270°
 *   784..815 翅膀          rx = 270°, rz = 45°
 * `m` 是模型槽（= type + 400），因为原版就是按模型槽判断的。
 */
export function itemTilt(type: number): { rx: number; ry: number; rz: number } {
  const m = type + 400;
  const DEG = Math.PI / 180;
  let rx = 0;
  let ry = 0;
  let rz = -45;

  if (m > 399 && m < 464) {
    rx = 60;
  } else if ((m > 535 && m < 545) || m === 546) {
    rx = 90;
  } else if (m >= 464 && m < 592) {
    ry = 270;
  } else if (m >= 592 && m < 624) {
    ry = 270;
    rz = 225;
  } else if (m >= 656 && m < 752) {
    rx = 270;
  } else if (m >= 784 && m <= 815) {
    rx = 270;
    rz = 45;
  }
  return { rx: rx * DEG, ry: ry * DEG, rz: rz * DEG };
}

/** type → 模型文件（含目录）；未知返回 null。`body` 只影响防具那 5 组的文件名。 */
export function itemModelPath(type: number, body: BodyGender = 'Male'): { dir: string; file: string } | null {
  const group = Math.floor(type / 32);
  const index = type % 32;

  /*
   * 先查**模型槽表**（原版 `OpenItems` 就是这么加载的）。
   * 这一步必须在 group 分支之前：group 12 的 index ≥ 7 是技能石而不是翅膀，
   * 按 group 前缀拼会得到不存在的 Wing08。
   */
  const fixed = SLOT_FILES.get(type + 400);
  if (fixed) return fixed;

  // 弓组在客户端里是**三段**，不是「Bow + index」：
  //   Model_Players.cpp:188  Bows       528..534 → Bow01..Bow07
  //   Model_Players.cpp:215  Arrows     535       → Arrows01
  //   Model_Players.cpp:197  Crossbows  536..542 → CrossBow01..CrossBow07
  //   Model_Players.cpp:200  Arrows     543       → Arrows02
  // 之后 544/545/546 是 CrossBow17 / Bow18 / Bow19。
  // 之前一律按 Bow(index+1) 拼，index≥7 全部 404（弩和箭在背包里是空白格）。
  if (group === 4) {
    if (index <= 6) return { dir: ITEM_DIR, file: `Bow${pad2(index + 1)}` };
    if (index === 7) return { dir: ITEM_DIR, file: 'Arrows01' };
    if (index >= 8 && index <= 14) return { dir: ITEM_DIR, file: `CrossBow${pad2(index - 7)}` };
    if (index === 15) return { dir: ITEM_DIR, file: 'Arrows02' };
    if (index === 16) return { dir: ITEM_DIR, file: 'CrossBow17' };
    if (index === 17) return { dir: ITEM_DIR, file: 'Bow18' };
    if (index === 18) return { dir: ITEM_DIR, file: 'Bow19' };
    return null;
  }

  // 守护/戒指/项链（Model_Players.cpp:210-222）：
  //   816..818 Helper01..03、819 Helper04
  //   824/825/826 Ring01/Ring02/Ring01（变形戒指复用 Ring01）
  //   828/829 Necklace01/02
  // 之前按 Helper(index+1) 拼，戒指项链全落到不存在的 Helper09+。
  if (group === 13) {
    if (index <= 2) return { dir: PLAYER_DIR, file: `Helper${pad2(index + 1)}` };
    if (index === 3) return { dir: PLAYER_DIR, file: 'Helper04' };
    if (index === 8) return { dir: ITEM_DIR, file: 'Ring01' };
    if (index === 9) return { dir: ITEM_DIR, file: 'Ring02' };
    if (index === 10) return { dir: ITEM_DIR, file: 'Ring01' };
    if (index === 12) return { dir: ITEM_DIR, file: 'Necklace01' };
    if (index === 13) return { dir: ITEM_DIR, file: 'Necklace02' };
    return null;
  }

  if (group === 14) {
    const special = GROUP14_SPECIAL[index];
    if (special) return { dir: ITEM_DIR, file: special };
  }

  const g = GROUPS[group];
  if (!g) return null;

  const limit = GROUP_LIMIT[group];
  if (limit !== undefined && index + 1 > limit) return null;

  // 序号从 1 起：group 0 / index 0 对应 Sword01（模型槽 400）
  if (BODY_GROUPS.has(group)) {
    const bm = bodyModel(group, index, body);
    if (!bm || bm.n < 1) return null;
    return { dir: g.dir, file: `${bm.prefix}${pad2(bm.n)}` };
  }
  return { dir: g.dir, file: `${g.prefix}${pad2(index + 1)}` };
}

/** 物品类型 → 界面显示名（尽量贴近原版英文名，未知则给编号） */
export function itemDisplayName(type: number): string {
  // 优先客户端原文（`Data/Local/chs/item.bmd`），没有再用模型名拼
  const official = itemNameSync(type);
  if (official) return official;
  const path = itemModelPath(type);
  if (!path) return `Item ${type}`;
  const base = path.file.replace(/\.bmd$/i, '').replace(/\d+$/, '');
  const zh: Record<string, string> = {
    Sword: '剑',
    Axe: '斧',
    Mace: '锤',
    Spear: '矛',
    Bow: '弓',
    Staff: '法杖',
    Shield: '盾',
    HelmMale: '头盔',
    ArmorMale: '铠甲',
    PantMale: '护腿',
    GloveMale: '护手',
    BootMale: '战靴',
    Wing: '翅膀',
    Helper: '饰品',
    Potion: '药水',
    Antidote: '解毒剂',
    Beer: '酒',
    Scroll: '卷轴',
    MagicBox: '宝箱',
    Event: '活动道具',
    Jewel: '宝石',
    Gold: '金币',
    Book: '魔法书',
  };
  return zh[base] ?? base;
}

/* ------------------------------------------------------------------ */
/* 模型加载                                                            */
/* ------------------------------------------------------------------ */

/** 解包后的物品模型：一组（几何 + 材质），已归一化到 1 格内 */
export interface ItemProto {
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
  /** 归一化后的包围盒（背包缩略图要用它算取景） */
  box: THREE.Box3;
}

const protoCache = new Map<number, Promise<ItemProto | null>>();
const missingTypes = new Set<number>();

/** 目标尺寸：0.7 格高（原版地面物品看着也差不多这么大） */
const TARGET_SIZE = 0.7;

async function fetchFirst(urls: string[]): Promise<Uint8Array | null> {
  for (const url of urls) {
    try {
      return await fetchBytes(url);
    } catch {
      /* 换下一个候选 */
    }
  }
  return null;
}

function buildProto(bmd: Bmd, dir: string): Promise<ItemProto> {
  return (async () => {
    const rig = createRig(bmd, MODEL_SCALE);
    const boneMatrices = getBoneMatrices(rig);
    const parts: ItemProto['parts'] = [];

    for (const mesh of bmd.meshes) {
      const tex = await loadTexture(dir, mesh.texturePath);
      // 混合方式统一由像素判定（`core/blendHeuristic`），和物件/怪物同一套
      const mb = modelBlend(tex?.texture ?? null, tex?.tag === 'blend', mesh.texturePath);
      const built = createStaticMeshes(
        { ...bmd, meshes: [mesh] },
        boneMatrices,
        tex?.texture ?? null,
        mb.cutout,
        MODEL_SCALE,
        mb.additive,
        mb.soft
      );
      for (const geometry of built.geometries) {
        parts.push({ geometry, material: built.material });
      }
    }

    // 归一化：以包围盒中心为原点，最大边长缩到 TARGET_SIZE。
    // 物品 BMD 的单位差得很远（戒指只有指甲盖大，翅膀比人还大），
    // 不归一化会出现「金币看不见、翅膀占满屏」。
    // 注意**不要**把底面贴到 z=0：模型接下来还要绕 X 轴立起来，
    // 按未旋转的底面算会把物品埋进地里。
    const box = new THREE.Box3();
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      if (p.geometry.boundingBox) box.union(p.geometry.boundingBox);
    }
    if (!box.isEmpty()) {
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const maxSide = Math.max(size.x, size.y, size.z, 1e-4);
      const scale = TARGET_SIZE / maxSide;
      const m = new THREE.Matrix4()
        .makeTranslation(-center.x, -center.y, -center.z)
        .premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
      for (const p of parts) {
        p.geometry.applyMatrix4(m);
        p.geometry.computeBoundingSphere();
      }
    }
    return { parts, box };
  })();
}

export function loadProto(type: number): Promise<ItemProto | null> {
  const hit = protoCache.get(type);
  if (hit) return hit;

  const task = (async () => {
    const path = itemModelPath(type);
    if (!path) {
      missingTypes.add(type);
      return null;
    }
    const file = path.file.toLowerCase().endsWith('.bmd') ? path.file : `${path.file}.bmd`;
    const bytes = await fetchFirst([
      `${path.dir}${file}`,
      `${path.dir}${file.toLowerCase()}`,
      `${path.dir}${capitalizeExt(file)}`,
    ]);
    if (!bytes) {
      if (!missingTypes.has(type)) {
        missingTypes.add(type);
        console.warn(`[items] 缺模型 ${path.dir}${file}（type=${type}）`);
      }
      return null;
    }
    try {
      return await buildProto(parseBmd(bytes), path.dir);
    } catch (err) {
      console.warn(`[items] 解析失败 ${file}（type=${type}）`, err);
      return null;
    }
  })();

  protoCache.set(type, task);
  return task;
}

/** 首字母大写 + 其余小写，覆盖 Sword01.bmd 这类命名 */
function capitalizeExt(file: string) {
  const dot = file.lastIndexOf('.');
  const stem = dot >= 0 ? file.slice(0, dot) : file;
  const ext = dot >= 0 ? file.slice(dot) : '';
  return stem.charAt(0).toUpperCase() + stem.slice(1).toLowerCase() + ext;
}

let fallback: ItemProto | null = null;

/**
 * 未知类型的兜底模型：一个发光小方块。
 * 宁可难看，也不能「掉了东西地上什么都没有」—— 那样玩家会以为拾取坏了。
 * 只建一次，所有未知物品共用（几何由调用方 clone）。
 */
function fallbackProto(): ItemProto {
  if (fallback) return fallback;
  const geometry = new THREE.BoxGeometry(TARGET_SIZE * 0.6, TARGET_SIZE * 0.6, TARGET_SIZE * 0.6);
  geometry.translate(0, 0, TARGET_SIZE * 0.3);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffcc55,
    transparent: true,
    opacity: 0.85,
  });
  fallback = { parts: [{ geometry, material }], box: new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute) };
  return fallback;
}

/* ------------------------------------------------------------------ */
/* 场景管理                                                            */
/* ------------------------------------------------------------------ */

/**
 * 地面物品的**发光底斑**。
 *
 * 原版 `Render/ItemDrop_Render.cpp`：掉落物除了模型还会画一圈加色混合的光斑
 * （`GL_SetBlendAdditive` → `glBlendFunc(GL_ONE, GL_ONE)`，并且 `glDisable(GL_FOG)`）。
 * 我们之前只有模型，地上东西在草地/暗处几乎看不见。
 *
 * 这里用一张程序生成的径向渐变（`objectFx.radialGlow`）贴在一个水平面上，
 * 加色混合、不写深度、不吃雾，缓慢呼吸。
 */
let glowGeo: THREE.PlaneGeometry | null = null;
let glowMat: THREE.MeshBasicMaterial | null = null;
function glowRig() {
  if (!glowGeo) glowGeo = new THREE.PlaneGeometry(1, 1);
  if (!glowMat) {
    glowMat = new THREE.MeshBasicMaterial({
      map: radialGlow(),
      color: 0xffd8a0,
      transparent: true,
      depthWrite: false,
      fog: false,
      ...additiveProps(),
      toneMapped: false,
      opacity: 0.6,
    });
    glowMat.name = 'item-glow';
  }
  return { geo: glowGeo, mat: glowMat };
}

interface GroundEntry {
  item: GroundItem;
  /** 地面上那圈光斑 */
  glow: THREE.Mesh;
  root: THREE.Group;
  /** 承担 -90° 倾斜的内层节点：BMD 里物品是「躺」在 XY 平面上的 */
  tilt: THREE.Group;
  /** 旋转/浮动相位，避免所有物品同步摆动 */
  phase: number;
  /** 是否已发起过拾取（避免每帧重复发包） */
  picking: boolean;
  born: number;
}

export class GroundItems {
  private entries = new Map<number, GroundEntry>();
  private root = new THREE.Group();
  private time = 0;
  /** 玩家拾取半径（服务端 `CheckItemGive` 是 ±2 格，这里留 1 格余量） */
  static readonly PICK_RANGE = 2;

  constructor(
    private scene: THREE.Scene,
    private heightAt: (x: number, y: number) => number
  ) {
    this.root.name = 'ground-items';
    scene.add(this.root);
  }

  /** 视野包到达：新增或刷新位置 */
  upsert(items: GroundItem[]) {
    for (const item of items) {
      const exist = this.entries.get(item.id);
      if (exist) {
        exist.item = item;
        exist.root.position.set(
          item.x + 0.5,
          item.y + 0.5,
          this.heightAt(item.x + 0.5, item.y + 0.5) + TARGET_SIZE * 0.35 + 0.05
        );
        exist.glow.position.set(
          item.x + 0.5,
          item.y + 0.5,
          this.heightAt(item.x + 0.5, item.y + 0.5) + 0.03
        );
        continue;
      }
      // 模型是异步的，先占坑再补 —— 否则同一件东西可能被加载两次
      const root = new THREE.Group();
      root.name = `item-${item.id}`;
      root.position.set(
        item.x + 0.5,
        item.y + 0.5,
        this.heightAt(item.x + 0.5, item.y + 0.5) + TARGET_SIZE * 0.35 + 0.05
      );
      this.root.add(root);

      // BMD 里物品（剑、斧、弓…）的长轴在 Y，直接放就是横躺在地上。
      // 按客户端的 ItemAngle 给每类一个固定倾角（剑 60°、弓 90°、盾 225°…），
      // 不是自转 —— 原版地上那些东西是静置的。
      const tilt = new THREE.Group();
      const ang = itemTilt(item.isMoney ? TYPE_MONEY : item.type);
      tilt.rotation.x = ang.rx;
      tilt.rotation.y = ang.ry;
      root.rotation.z = ang.rz;
      root.add(tilt);

      const rig = glowRig();
      const glow = new THREE.Mesh(rig.geo, rig.mat);
      glow.name = `item-glow-${item.id}`;
      glow.rotation.x = -Math.PI / 2;
      glow.scale.setScalar(1.4);
      glow.renderOrder = 3;
      glow.position.set(
        item.x + 0.5,
        item.y + 0.5,
        this.heightAt(item.x + 0.5, item.y + 0.5) + 0.03
      );
      this.root.add(glow);

      const entry: GroundEntry = {
        item,
        root,
        glow,
        tilt,
        phase: Math.random() * Math.PI * 2,
        picking: false,
        born: this.time,
      };
      this.entries.set(item.id, entry);

      void this.attachModel(entry);
    }
  }

  private async attachModel(entry: GroundEntry) {
    const type = entry.item.isMoney ? 0 : entry.item.type;
    let proto = await loadProto(type);
    if (!proto) proto = fallbackProto();
    // 加载期间可能已经被捡走 / 切图清空了
    if (this.entries.get(entry.item.id) !== entry) return;
    for (const part of proto.parts) {
      // 每个实例独立几何，避免后面单独做缩放（金币堆大小）时互相影响
      const mesh = new THREE.Mesh(part.geometry.clone(), part.material);
      mesh.frustumCulled = true;
      entry.tilt.add(mesh);
    }
    // 金币堆按金额放大：原版也是钱越多堆越大
    if (entry.item.isMoney) {
      const s = Math.min(1.8, 0.7 + Math.log10(Math.max(10, entry.item.money)) * 0.25);
      entry.root.scale.setScalar(s);
    }
  }

  remove(id: number) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.root.remove(entry.root);
    this.root.remove(entry.glow);
    entry.root.traverse(obj => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    this.entries.delete(id);
  }

  /** 复位（切图 / 重登）—— 材质是共享缓存，只丢几何与挂点 */
  clear() {
    for (const id of [...this.entries.keys()]) this.remove(id);
    this.entries.clear();
  }

  get(id: number) {
    return this.entries.get(id)?.item ?? null;
  }

  list() {
    return [...this.entries.values()].map(e => ({
      ...e.item,
      wx: e.root.position.x,
      wy: e.root.position.y,
      /** 模型当前的世界 z（含呼吸浮动），物品名标签要贴在它上方 */
      wz: e.root.position.z,
    }));
  }

  get size() {
    return this.entries.size;
  }

  /** 最近的可拾取物品（按格心算距离） */
  nearest(x: number, y: number, range = GroundItems.PICK_RANGE) {
    let best: GroundEntry | null = null;
    let bestD = range + 1e-6;
    for (const e of this.entries.values()) {
      const d = Math.hypot(e.item.x + 0.5 - x, e.item.y + 0.5 - y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best
      ? { id: best.item.id, x: best.item.x, y: best.item.y, dist: bestD, item: best.item }
      : null;
  }

  /** 屏幕坐标命中测试（用物品在相机里的投影，和怪物拾取同一套做法） */
  pickAt(
    camera: THREE.Camera,
    clientX: number,
    clientY: number,
    rect: DOMRect,
    tolerance = 26
  ) {
    const v = new THREE.Vector3();
    let bestId: number | null = null;
    let bestDist = tolerance;
    for (const e of this.entries.values()) {
      v.set(e.root.position.x, e.root.position.y, e.root.position.z + 0.08);
      v.project(camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestDist) {
        bestDist = d;
        bestId = e.item.id;
      }
    }
    return bestId;
  }

  /** 标记某件物品已经发过拾取包（防重复） */
  markPicking(id: number, on = true) {
    const e = this.entries.get(id);
    if (e) e.picking = on;
  }

  isPicking(id: number) {
    return this.entries.get(id)?.picking ?? false;
  }

  /**
   * 某件地面物品身上挂了几个模型 mesh。
   *
   * `0` 说明只建出了光斑、模型没挂上（`loadProto` 失败或异步还没回来）。
   * 探针用它确认「东西真的画出来了」，比看像素稳。
   */
  meshCount(id: number) {
    const e = this.entries.get(id);
    if (!e) return 0;
    let n = 0;
    e.tilt.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) n++;
    });
    return n;
  }

  /** 发光底斑统计（探针用） */
  glowStats() {
    let total = 0;
    let visible = 0;
    for (const e of this.entries.values()) {
      total++;
      if (e.glow.visible) visible++;
    }
    return { total, visible };
  }

  update(dt: number) {
    this.time += dt;
    for (const e of this.entries.values()) {
      // 原版物品是静置的（ItemAngle 只给一次初始角度），这里只留一点
      // 极轻微的上下呼吸，让它在草地上不至于完全和背景糊在一起。
      const bob = Math.sin(this.time * 1.6 + e.phase) * 0.02;
      const base = this.heightAt(e.item.x + 0.5, e.item.y + 0.5) + TARGET_SIZE * 0.35 + 0.05;
      e.root.position.z = base + bob;
      // 光斑：大小/亮度都轻轻呼吸（原版这圈光也是跟着生命周期变的）
      const pulse = 1 + Math.sin(this.time * 2 + e.phase) * 0.12;
      e.glow.scale.setScalar(1.4 * pulse);
    }
  }
}
