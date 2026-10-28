/**
 * 地图注册表。
 *
 * 关键约定（来自客户端 Terrain_LegacyLoad.cpp / Scene_OpenWorld.cpp）：
 *   - 资源目录是 `World{N}` / `Object{N}`，其中 **N = 地图号 + 1**
 *     （地图 0 = 洛兰 → World1/Object1；地图 3 = 诺利亚 → World4/Object4）
 *   - 血色城堡 11..16 共用 Object12（`if (World >= 11 && World <= 16) objFolder = 12`）
 *   - tile 贴图列表所有地图一致：客户端对每个 World 都按同一组文件名打开
 *     （OpenJPG 槽位 0x23..0x30），只是部分地图缺文件，缺的会退化成灰块
 */

/** 所有地图共用的 tile 名（对应 .map 里 layer 的索引 0..13） */
export const TILE_NAMES = [
  'TileGrass01',
  'TileGrass02',
  'TileGround01',
  'TileGround02',
  'TileGround03',
  'TileWater01',
  'TileWood01',
  'TileRock01',
  'TileRock02',
  'TileRock03',
  'TileRock04',
  'TileRock05',
  'TileRock06',
  'TileRock07',
];

export interface MapDefinition {
  /** 服务端/数据库里的地图号（F3 03 的 Map 字段） */
  id: number;
  /** 资源目录后缀：World{N} / Object{N} */
  folder: number;
  name: string;
  english: string;
}

/**
 * 中文名。
 *
 * 号段与英文名以服务端 `MuServer/Data/MapManager.txt` 为准：
 *
 *   0 Lorencia  1 Dungeon  2 Devias  3 Noria  4 Lost Tower  5 Dare Devil
 *   6 Arena     7 Atlans   8 Tarkan  9 Devil Square 1      10 Icarus
 *   11..16 Blood Castle 1..6
 *
 * 早期版本这里把 5/6 写成「地下城2/3」是错的 —— 地下城 1/2/3 其实是**同一张图**
 * （map 1）的不同区域，落点区别在 `Move.txt` 的 Gate 上，见 `src/world/warp.ts`。
 */
const NAMES: Record<number, [string, string]> = {
  0: ['洛兰', 'Lorencia'],
  1: ['地下城', 'Dungeon'],
  2: ['冰风谷', 'Devias'],
  3: ['诺利亚', 'Noria'],
  4: ['失落之塔', 'Lost Tower'],
  5: ['挑战地带', 'Dare Devil'],
  6: ['足球场', 'Arena'],
  7: ['亚特兰蒂斯', 'Atlans'],
  8: ['塔卡', 'Tarkan'],
  9: ['恶魔广场', 'Devil Square'],
  10: ['天空之城', 'Icarus'],
};

/** 已确认可加载的地图（本地资源 World1..World12 都存在） */
export const MAP_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export function getMapDefinition(id: number): MapDefinition {
  const folder = id >= 11 && id <= 16 ? 12 : id + 1;
  const [name, english] = NAMES[id] ?? [
    id >= 11 && id <= 16 ? `血色城堡 ${id - 10}` : `地图 ${id}`,
    id >= 11 && id <= 16 ? `Blood Castle ${id - 10}` : `World ${id}`,
  ];
  return { id, folder, name, english };
}

/**
 * 「移动命令」窗口的数据表**不在这里**。
 *
 * 那张表归服务端（`MuServer/Data/Move/Move.txt` + `Gate.txt`），
 * 编译期快照在 `src/data/warpTable.generated.ts`（`node tools/gen-warp-table.mjs` 生成），
 * 运行期用 `src/world/warp.ts` 的 `warpTable` —— 它能被服务端下发的表整表替换。
 */

export function mapWorldDir(id: number) {
  return `Data/World${getMapDefinition(id).folder}/`;
}

export function mapObjectDir(id: number) {
  return `Data/Object${getMapDefinition(id).folder}/`;
}
