/**
 * 地形：直接读取 WorldN/ 下的原版文件
 *   EncTerrainN.map  两层贴图索引 + 混合 alpha
 *   EncTerrainN.att  属性（是否可走、水面等）
 *   TerrainHeight.OZB 高度图（1084 偏移，factor 1.5/100）
 *   TerrainLight.OZJ  光照图
 *   Tile*.OZJ         14 个固定槽位（0x23..0x30）的 tile 贴图
 *
 * 贴图结构（Terrain_RenderFace.cpp `FaceTexture`）：一张 tile 只铺 **4 格**
 * （256px）或 2 格（128px），即地面纹理只占索引纹理的 1/4，每格恒为 64 texel。
 */
import * as THREE from 'three';
import { fetchBytes, fetchBytesOptional, loadImageData, loadTexture } from '../core/texture';
import { decryptMapFile, convertBux } from '../core/crypto';

export const TERRAIN_SIZE = 256;
export const TERRAIN_TILE = 1; // 一格 = 1 world unit

export const TW_SAFEZONE = 0x0001;
export const TW_CHARACTER = 0x0002;
export const TW_NOMOVE = 0x0004;
export const TW_NOGROUND = 0x0008;
export const TW_WATER = 0x0010;
export const TW_HEIGHT = 0x0040;

/**
 * 水面高度（世界单位）。
 *
 * 原版 `TerrainTile_Render` 的水面分支：`if (4 角高度都 <= DAT_00552580)`；
 * `globals.cpp` 里 `DAT_00552580 = 0`，而高度是无符号 byte × 1.5，
 * 也就是只有「高度字节 == 0」的格子才算水下 —— 河道/海床在数据里就是 0。
 * 我们的高度是 byte × 1.5/100（1 格 = 1 单位），水位同样是 0。
 */
export const WATER_LEVEL = 0;

/**
 * 水面比海床抬高多少。
 *
 * 不能正好等于 `WATER_LEVEL`：同高度的两个面会 z-fighting（闪条纹）。
 * 0.02 格 ≈ 2cm，肉眼看不出来，但足够拉开深度。
 */
const WATER_SURFACE_LIFT = 0.02;

export interface TerrainData {
  height: Float32Array;
  attribute: Uint16Array;
  layer1: Uint8Array;
  layer2: Uint8Array;
  alpha: Uint8Array;
  tileNames: string[];
}

/**
 * 地形光照的映射端点：`light = floor + gain × TerrainLight`。
 *
 * `TerrainLight.OZJ` 的分布很宽（洛兰 p05 0.10 / p50 0.53 / p95 1.00），
 * 「哪块地亮哪块地暗」本来就全在这张图里，直接用就有完整的明暗层次。
 *
 * 之前取 `0.75 + 0.30 × rl`（把 0..1 压到 0.75..1.05）是想「贴合原版
 * 0.84~0.94 的最终值域」，结果是把地面抬到接近全白：均值 0.92，
 * 明暗只剩 30% —— 画面上就是「又亮又平」。现在改成真正的乘法：
 *
 *   rl=0.00 → 0.16（阴影里）
 *   rl=0.53 → 0.65（洛兰路面）
 *   rl=1.00 → 1.08（日照面）
 *
 * 平均档位比原来低约 30%，明暗幅度从 1.3 倍拉到 6.8 倍。
 * `exposure` 留作整体微调（调亮/调暗不动对比度）。
 */
/**
 * 目标观感档位：每张图的光照图均值乘完 `LIGHT_TUNE` 后应该落到这个值。
 *
 * 0.68 就是洛兰/冰风谷现在的档位（`0.16 + 0.92 × 0.56`）——
 * 也就是"用户已经认可的那一版"的亮度。暗图（亚特兰蒂斯 0.44、失落塔 0.46、
 * 地下城 0.56）会被抬上来，亮图维持不动。
 */
export const LIGHT_LEVEL_TARGET = 0.68;

export const LIGHT_TUNE = {
  floor: 0.16,
  gain: 0.92,
  exposure: 1.0,
};

function parseHeight(buf: Uint8Array) {
  const INDEX = 1084;
  const factor = 1.5 / 100;
  const out = new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE);
  /*
   * 少数地图的 `TerrainHeight.OZB` 比 `1084 + 65536` 短几个字节
   * （地下城2 少 2 个），越界读到 `undefined`，×factor 就是 NaN。
   * 后果不是「裂个洞」而是**整张地形的包围盒变 NaN**
   * （`computeBoundingBox(): Computed min/max have NaN values`）。
   * 用前一个有效高度补上，边缘一两个顶点，肉眼看不出来。
   */
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const v = buf[INDEX + i];
    if (v === undefined) {
      out[i] = last;
      continue;
    }
    last = v * factor;
    out[i] = last;
  }
  return out;
}

function parseMapping(buf: Uint8Array) {
  const dec = decryptMapFile(buf);
  let p = 2; // version + map number
  const layer1 = dec.slice(p, p + TERRAIN_SIZE * TERRAIN_SIZE);
  p += TERRAIN_SIZE * TERRAIN_SIZE;
  const layer2 = dec.slice(p, p + TERRAIN_SIZE * TERRAIN_SIZE);
  p += TERRAIN_SIZE * TERRAIN_SIZE;
  const alpha = dec.slice(p, p + TERRAIN_SIZE * TERRAIN_SIZE);
  return { layer1, layer2, alpha };
}

function parseAttribute(buf: Uint8Array) {
  const dec = decryptMapFile(buf);
  convertBux(dec, dec.length);

  const out = new Uint16Array(TERRAIN_SIZE * TERRAIN_SIZE);
  const ext = buf.length === TERRAIN_SIZE * TERRAIN_SIZE * 2 + 4;
  if (ext) {
    const dv = new DataView(dec.buffer, dec.byteOffset + 4);
    for (let i = 0; i < out.length; i++) out[i] = dv.getUint16(i * 2, true);
  } else {
    for (let i = 0; i < out.length; i++) out[i] = dec[4 + i];
  }
  return out;
}

/** 地图物件记录（EncTerrainN.obj） */
export interface TerrainObjectRecord {
  id: number;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  scale: number;
}

export function parseTerrainObjects(buf: Uint8Array): TerrainObjectRecord[] {
  const dec = decryptMapFile(buf);
  const dv = new DataView(dec.buffer, dec.byteOffset, dec.byteLength);
  const count = dv.getInt16(2, true);
  const out: TerrainObjectRecord[] = [];

  for (let i = 0; i < count; i++) {
    const base = 4 + i * 30;
    if (base + 30 > dec.length) break;
    out.push({
      id: dv.getInt16(base, true),
      x: dv.getFloat32(base + 2, true),
      y: dv.getFloat32(base + 6, true),
      z: dv.getFloat32(base + 10, true),
      rx: dv.getFloat32(base + 14, true),
      ry: dv.getFloat32(base + 18, true),
      rz: dv.getFloat32(base + 22, true),
      scale: dv.getFloat32(base + 26, true),
    });
  }

  return out;
}

export async function loadTerrainData(
  worldDir: string,
  mapNumber: number,
  tiles: string[],
  onProgress?: (msg: string) => void
): Promise<TerrainData> {
  onProgress?.('读取地形高度');
  const heightBuf = await fetchBytes(`${worldDir}TerrainHeight.OZB`);

  onProgress?.('读取地形贴图索引');
  const mapBuf = await fetchBytes(`${worldDir}EncTerrain${mapNumber}.map`);

  onProgress?.('读取地形属性');
  let attrBuf: Uint8Array | null = null;
  try {
    attrBuf = await fetchBytes(`${worldDir}EncTerrain${mapNumber}.att`);
  } catch {
    attrBuf = null;
  }

  const mapping = parseMapping(mapBuf);

  return {
    height: parseHeight(heightBuf),
    attribute: attrBuf
      ? parseAttribute(attrBuf)
      : new Uint16Array(TERRAIN_SIZE * TERRAIN_SIZE),
    layer1: mapping.layer1,
    layer2: mapping.layer2,
    alpha: mapping.alpha,
    tileNames: tiles,
  };
}

/* ------------------------------------------------------------------ */
/* 网格 + 着色器                                                       */
/* ------------------------------------------------------------------ */

const VERT = /* glsl */ `
  out vec2 vUv;
  out float vDepth;

  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler2DArray;

  in vec2 vUv;
  in float vDepth;

  uniform highp sampler2DArray tiles;
  uniform float uAtlasCols;
  uniform sampler2D layerMap;
  uniform sampler2D alphaMap;
  uniform sampler2D lightMap;
  uniform float uTileCount;
  /** 每张 tile 铺几格（256px → 4，128px → 2），按 tile 索引取 */
  uniform float uTileDiv[16];
  uniform float uExposure;
  /** 光照图的映射端点：light = floor + gain × rl（见 LIGHT_TUNE） */
  uniform float uLightFloor;
  uniform float uLightGain;
  /**
   * 按地图定标的整体提亮系数。
   *
   * TerrainLight.OZJ 每张图的明暗基准差得很远（洛兰 mean 0.56、
   * 亚特兰蒂斯 0.30、失落塔 0.33），如果所有图用同一套 floor + gain × rl，
   * 暗图就会整体被压到 0.44 —— 实机上亚特兰蒂斯就是"闷在深蓝里"。
   * 这里按各图自身的光照图均值把它抬到和洛兰一个观感档位（见 LIGHT_LEVEL_TARGET）。
   */
  uniform float uLightLift;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  out vec4 fragColor;

  void main() {
    // 层索引是**逐格**的（EncTerrain*.map 每格一个字节）
    vec2 t0 = floor(vUv);
    vec2 fr = vUv - t0;
    vec2 cell = (t0 + 0.5) / 256.0;

    vec4 lm = texture(layerMap, cell);
    float l1raw = floor(lm.r * 255.0 + 0.5);
    float l2raw = floor(lm.g * 255.0 + 0.5);

    /*
     * 混合权重：**四角双线性**（muonline-bmd-viewer 的做法）。
     *
     * 以前是直接取格心的 alpha —— 一格一个值，于是两种地面在格边界上
     * 是一道**硬切换**（斜着看能看到一格一格的锯齿边）。
     * 改成取本格四个角的 alpha 再按格内位置插值，两种地面就能渐变过渡，
     * 和原版 Terrain_Render 里那层 alpha 混合的观感一致。
     */
    vec2 tX  = min(t0 + vec2(1.0, 0.0), vec2(255.0));
    vec2 tY  = min(t0 + vec2(0.0, 1.0), vec2(255.0));
    vec2 tXY = min(t0 + vec2(1.0, 1.0), vec2(255.0));
    float a00 = texture(alphaMap, (t0  + 0.5) / 256.0).r;
    float a10 = texture(alphaMap, (tX  + 0.5) / 256.0).r;
    float a01 = texture(alphaMap, (tY  + 0.5) / 256.0).r;
    float a11 = texture(alphaMap, (tXY + 0.5) / 256.0).r;
    float a = mix(mix(a00, a10, fr.x), mix(a01, a11, fr.x), fr.y);
    /** 四角都是 255（= 纯第二层）时直接取第二层，省一次采样也避免半透明误差 */
    float aOpaque = step(0.998, min(min(a00, a10), min(a01, a11)));

    /*
     * 越界防御：EncTerrain1.map 的 layer2 有 43785 格是 **255**（表示「没有第二层」）。
     * 直接拿 255 当 texture array 的层号就是越界采样（WebGL 返回 0），
     * 于是 mix(c1, 黑, alpha) 把地面对应区域压暗 —— 表现就是「地面一块块发黑」。
     * 原版客户端是靠逐个 if 比较索引、255 不命中任何分支来跳过第二层的。
     */
    float ok1 = step(l1raw, uTileCount - 0.5);
    float ok2 = step(l2raw, uTileCount - 0.5);
    float l1 = ok1 > 0.5 ? l1raw : 0.0;
    float l2 = ok2 > 0.5 ? l2raw : l1;

    /*
     * 贴图覆盖范围：**一张 tile 铺 4 格**（128px 的那几张铺 2 格）。
     *
     * 依据 muonlinejs（getTerrainData.ts / terrainMaterial.ts）：
     *   scale = 256 → 256/4 = 64，然后 texture2D(tile, vUV * 64)。
     * vUV 覆盖整张 256×256 的索引图，重复 64 次 = **每 4 格一张 tile**。
     * 128px 的贴图 scale = 128（重复 128 次 = 每 2 格），
     * 这样两者的每格像素密度一致（64 texel/格）。
     *
     * 这里 vUv 是「格坐标」(0..255)，所以格内 UV = fract(vUv / 每格数)。
     */
    float div1 = max(1.0, uTileDiv[int(l1)]);
    float div2 = max(1.0, uTileDiv[int(l2)]);
    /*
     * 图集采样要**内缩半个纹素**：fract() 到 0/1 时若正好落在图集格边界，
     * 线性过滤会采到隔壁那张 tile 的边缘像素（表现为细缝/串色）。
     */
    /*
     * 采样：纹理数组，一层一张 tile。
     *
     * 不做 fract —— sampler2DArray 的每层都是 RepeatWrapping，
     * vUv / div 直接就能平铺。这样就没有「格边界断点」，
     * GPU 自动求导不会炸，mip 选择连续，接缝线也就不存在了。
     */
    vec2 uv1 = vUv / div1;
    vec2 uv2 = vUv / div2;
    vec3 c1 = texture(tiles, vec3(uv1, l1)).rgb;
    vec3 c2 = texture(tiles, vec3(uv2, l2)).rgb;
    vec3 base = mix(c1, c2, max(a, aOpaque) * ok2);

    /*
     * 光照：**恢复原版的明暗变化**（用户反馈：之前整体太亮、地面没有光暗）。
     *
     * TerrainLight.OZJ 本身分布很宽（洛兰 p05 0.10 / p50 0.53 / p95 1.00，
     * 亚特兰蒂斯中位 0.33、地下城中位 0.44），也就是说「哪块地亮、哪块地暗」
     * 全在这张图里。上一版取 0.75 + 0.30 × rl，把 0..1 压成 0.75..1.05
     * —— 均值 0.92，等于把地形抬到接近全白，明暗只剩 30%，所以看着又亮又平。
     *
     * 现在用 floor + gain × rl（见 LIGHT_TUNE）：暗部真的会暗下去，
     * 亮部仍能到 1.0 以上，明暗幅度接近 1:7；整体均值也从 0.92 降到 ~0.65。
     *
     * 另外原版有个 sanitize：光照图某些格子的通道会极端不平衡（R 高、G=0、B 高），
     * 直接乘会让地面出现**紫/品红色块**。这里对偏色做拉平（只影响色相，
     * 不影响明暗 —— 拉平取的是三通道均值）。
     */
    vec3 rl = texture(lightMap, vUv / 256.0).rgb;
    float mn = min(min(rl.r, rl.g), rl.b);
    float mx = max(max(rl.r, rl.g), rl.b);
    if (mx - mn > 0.4) rl = vec3((rl.r + rl.g + rl.b) / 3.0);
    vec3 light = (vec3(uLightFloor) + uLightGain * rl) * uLightLift;
    vec3 col = base * light * uExposure;

    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    col = mix(col, uFogColor, fog);

    fragColor = vec4(col, 1.0);
  }
`;

export interface TerrainMesh {
  mesh: THREE.Mesh;
  data: TerrainData;
  getHeight(x: number, y: number): number;
  isWalkable(x: number, y: number): boolean;
  tilesTexture: THREE.DataArrayTexture;
  /** 每张 tile 的原始像素尺寸（诊断用，决定铺几格） */
  tileSizes: number[];
  /** 每张 tile 铺几格（256px → 4、128px → 2） */
  tileDiv: number[];
  /** 水面高度（世界单位，与 `height` 同口径）；水面网格整体贴着它走 */
  waterLevel: number;
  /** 这一格是不是水面（`layer1` 或 `layer2` 是 `TileWater01`） */
  isWaterCell(x: number, y: number): boolean;
  /** 光照图的统计（诊断/调参用）：均值、分位数 */
  lightStats: { mean: number; p05: number; p50: number; p95: number };
  /** 这张图按均值定标得到的整体提亮系数（1 = 不动，>1 = 抬亮） */
  lightLift: number;
  /** 水面网格；这张地图没有水面时为 null */
  water: THREE.Mesh | null;
  /** 每帧调用：推进水面 UV 滚动与顶点波动 */
  updateWater(time: number): void;
  /**
   * 生成小地图底图：`256×256`，**一格一个像素**（客户端自己合成，不依赖服务端）。
   *
   * 颜色取每格 `layer1/layer2` 两张 tile 的平均色按 `alpha` 混合，再叠一层
   * 由高度差算出来的山体阴影（光源在西北），水面用 `TW_WATER` 染蓝。
   */
  buildMinimap(): HTMLCanvasElement;
}

export async function createTerrain(
  worldDir: string,
  mapNumber: number,
  tiles: string[],
  fog: { color: THREE.Color; near: number; far: number },
  onProgress?: (msg: string) => void
): Promise<TerrainMesh> {
  const data = await loadTerrainData(worldDir, mapNumber, tiles, onProgress);

  onProgress?.('构建地形网格');

  const size = TERRAIN_SIZE;
  const positions = new Float32Array(size * size * 3);
  const uvs = new Float32Array(size * size * 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      positions[i * 3 + 0] = x * TERRAIN_TILE;
      positions[i * 3 + 1] = y * TERRAIN_TILE;
      positions[i * 3 + 2] = data.height[i];
      uvs[i * 2 + 0] = x;
      uvs[i * 2 + 1] = y;
    }
  }

  const indexCount = (size - 1) * (size - 1) * 6;
  const indices = new Uint32Array(indexCount);
  let p = 0;
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const a = y * size + x;
      const b = a + 1;
      const c = a + size;
      const d = c + 1;
      // 逆时针（从 +Z 方向看），保证正面朝上
      indices[p++] = a;
      indices[p++] = b;
      indices[p++] = c;
      indices[p++] = b;
      indices[p++] = d;
      indices[p++] = c;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();

  // ---- tile 贴图统一成 256 的图集 ----
  const TILE_SIZE = 256;
  const layerPixels = new Uint8Array(TILE_SIZE * TILE_SIZE * 4 * tiles.length);
  /** 这个 World 目录里没找到的 tile（原版也是缺的，不是 shader 的问题） */
  const missingTiles: string[] = [];
  /** 每张 tile 的**原始**像素尺寸（决定它铺几格） */
  const tileSizes: number[] = [];

  /*
   * 缺 tile 时的**借图**顺序。
   *
   * 每个 World 目录都只带自己用到的那几张（World8 连 `TileWater01` 都没有，
   * 但它的 `.map` 里 layer2 = 5 有 6974 格 —— 也就是说亚特兰蒂斯的海床
   * 叠着一层水瓦片，而这张瓦片的文件就压根没打包进 World8）。
   * 原版 `OpenJPG` 失败时槽位保留上一次的绑定，正好就是上一张图的水贴图，
   * 所以它看起来「碰巧是对的」；我们这里显式去别的目录借同一张。
   */
  const TILE_BORROW_DIRS = ['World1/', 'World4/', 'World7/', 'World2/', 'World3/'];
  const tileFile = (dir: string, name: string) =>
    dir.startsWith('/') ? `${dir}${name}.OZJ` : `/Data/${dir}${name}.OZJ`;

  /*
   * 并行预取瓦片**字节**（`fetchBytesOptional` 带缓存，后面的 `loadImageData` 直接命中）。
   *
   * 以前是逐张 `await loadImageData`：GH Pages 上 20 张 tile 就是 20 个串行 RTT，
   * 缺图的还要再串行试 5 个借用目录。先把字节并发拉下来，循环里只剩解码和拼图。
   */
  const tileBytes = await Promise.all(
    tiles.map(async t => [t, await fetchBytesOptional(`${worldDir}${t}.OZJ`)] as const)
  );
  /** 本地没有的瓦片：把「借图」的候选也一次性并发探掉，别在循环里逐个等 404 */
  const missingTilesBytes = tileBytes.filter(([, b]) => !b).map(([t]) => t);
  if (missingTilesBytes.length) {
    await Promise.all(
      missingTilesBytes.flatMap(t => TILE_BORROW_DIRS.map(d => fetchBytesOptional(tileFile(d, t))))
    );
  }

  for (let i = 0; i < tiles.length; i++) {
    onProgress?.(`解码地形贴图 ${tiles[i]}`);
    let img = await loadImageData(`${worldDir}${tiles[i]}.OZJ`);
    let borrowed = '';
    const offset = i * TILE_SIZE * TILE_SIZE * 4;
    if (!img) {
      for (const dir of TILE_BORROW_DIRS) {
        const alt = await loadImageData(tileFile(dir, tiles[i]));
        if (alt) {
          img = alt;
          borrowed = dir;
          break;
        }
      }
    }
    if (!img) {
      /*
       * 缺文件的地图不少（World7 没有 TileGround01/02、World8 没有 TileWater01…），
       * 原版这些槽位是「OpenJPG 失败 → 纹理留空」，但留空在我们的着色器里
       * 就是一块**纯灰**，落在草地上非常刺眼。
       * 这里退化成 0 号 tile（草地）—— 纹理重复总比灰块自然。
       */
      missingTiles.push(tiles[i]);
      tileSizes.push(TILE_SIZE);
      if (i > 0) layerPixels.set(layerPixels.subarray(0, TILE_SIZE * TILE_SIZE * 4), offset);
      else layerPixels.fill(128, offset, offset + TILE_SIZE * TILE_SIZE * 4);
      continue;
    }
    if (borrowed) console.log(`[terrain] ${tiles[i]} 本地缺失，借用 Data/${borrowed}`);
    tileSizes.push(img.height);
    // 统一缩放到 256×256（原版都是 256，个别地图可能不同）
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d')!;
    const tmp = document.createElement('canvas');
    tmp.width = img.width;
    tmp.height = img.height;
    const tctx = tmp.getContext('2d')!;
    const id = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    tctx.putImageData(id, 0, 0);
    ctx.drawImage(tmp, 0, 0, TILE_SIZE, TILE_SIZE);
    layerPixels.set(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data, offset);
  }

  if (missingTiles.length) {
    console.warn(`[terrain] ${worldDir} 缺 ${missingTiles.length} 张 tile（已用草地顶上）：${missingTiles.join(', ')}`);
  }

  /*
   * **一张 tile 铺几格？** —— 这是之前理解错的地方。
   *
   * muonlinejs（`getTerrainData.ts` + `terrainMaterial.ts`）的做法：
   *
   *     const size = texture.getSize().height;      // 256 或 128
   *     let scale = size;
   *     if (scale === 256) scale /= 4;              // → 64
   *     ...
   *     texture2D(textures[i], vUV * scale)         // vUV 是整张地形的 0..1
   *
   * vUV 覆盖 256 格：
   *   256px 贴图 → 重复 **64** 次 → 每 **4 格**一张 tile
   *   128px 贴图 → 重复 **128** 次 → 每 **2 格**一张 tile
   *
   * 也就是「地面纹理是索引纹理的 1/4」：索引图 256×256（每格一个索引），
   * 纹理只铺 64×64 次。128px 那张铺 2 格是为了保持**同样的每格像素密度**
   * （两种都是 64 texel / 格）。
   *
   * 之前我按 `#if 0` 里的 fallback（逐格 quad、texCoord 0..1）当成正式实现，
   * 改成了「每格一张」，纹理密度变成原版的 4 倍 —— 地面又碎又花。
   */
  const TEXELS_PER_CELL = 64;
  const tileDiv: number[] = tiles.map((_, i) => {
    const size = tileSizes[i] ?? TILE_SIZE;
    return Math.max(1, Math.round(size / TEXELS_PER_CELL));
  });
  // uniform 数组长度要固定，补齐到 16（最多 16 槽 = 0x23..0x32）
  while (tileDiv.length < 16) tileDiv.push(4);

  /*
   * tile 贴图用 **纹理数组（sampler2DArray）**，一层一张 tile。
   *
   * 之前为了绕 three 的 `DataTexture is too big (18432x0)` 报错拼成了 4×4 图集，
   * 但图集拼接本身带来一串接缝问题：
   *   ① `fract(vUv/div)` 在格边界是断点 → GPU 自动求导炸掉 → **每格一条暗线**；
   *   ② 开了 mipmap 之后，图集相邻格子在高 mip 层互相渗透 → 又一种暗带；
   *   ③ 为了防渗透还得把 UV 内缩半纹素，边缘一圈被拉伸。
   *
   * 纹理数组没有这些事：每层独立、Wrap 用 Repeat、mipmap 也按层生成。
   * 采样就一句 `texture(tiles, vec3(vUv / div, layer))` —— 不需要 fract。
   */
  const tilesTexture = new THREE.DataArrayTexture(
    layerPixels,
    TILE_SIZE,
    TILE_SIZE,
    tiles.length
  );
  tilesTexture.format = THREE.RGBAFormat;
  tilesTexture.type = THREE.UnsignedByteType;
  // 与 muonlinejs / 原版一致：贴图按 sRGB 数值直接用，不做解码
  tilesTexture.colorSpace = THREE.NoColorSpace;
  tilesTexture.magFilter = THREE.LinearFilter;
  tilesTexture.minFilter = THREE.LinearMipmapLinearFilter;
  tilesTexture.generateMipmaps = true;
  tilesTexture.wrapS = THREE.RepeatWrapping;
  tilesTexture.wrapT = THREE.RepeatWrapping;
  tilesTexture.anisotropy = 8;
  tilesTexture.needsUpdate = true;

  // ---- layer / alpha / light 贴图 ----
  const layerPixels2 = new Uint8Array(size * size * 4);
  const alphaPixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    layerPixels2[i * 4 + 0] = data.layer1[i];
    layerPixels2[i * 4 + 1] = data.layer2[i];
    layerPixels2[i * 4 + 2] = 0;
    layerPixels2[i * 4 + 3] = 255;
    alphaPixels[i * 4 + 0] = data.alpha[i];
    alphaPixels[i * 4 + 1] = data.alpha[i];
    alphaPixels[i * 4 + 2] = data.alpha[i];
    alphaPixels[i * 4 + 3] = 255;
  }

  const layerMap = new THREE.DataTexture(
    layerPixels2,
    size,
    size,
    THREE.RGBAFormat
  );
  layerMap.magFilter = THREE.NearestFilter;
  layerMap.minFilter = THREE.NearestFilter;
  layerMap.generateMipmaps = false;
  layerMap.needsUpdate = true;

  const alphaMap = new THREE.DataTexture(
    alphaPixels,
    size,
    size,
    THREE.RGBAFormat
  );
  alphaMap.magFilter = THREE.LinearFilter;
  alphaMap.minFilter = THREE.LinearFilter;
  alphaMap.generateMipmaps = false;
  alphaMap.needsUpdate = true;

  const lightImg = await loadImageData(`${worldDir}TerrainLight.OZJ`);
  const lightPixels = new Uint8Array(size * size * 4);
  if (lightImg) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const tmp = document.createElement('canvas');
    tmp.width = lightImg.width;
    tmp.height = lightImg.height;
    tmp.getContext('2d')!.putImageData(
      new ImageData(new Uint8ClampedArray(lightImg.data), lightImg.width, lightImg.height),
      0,
      0
    );
    ctx.drawImage(tmp, 0, 0, size, size);
    lightPixels.set(ctx.getImageData(0, 0, size, size).data);
  } else {
    lightPixels.fill(160);
  }

  /*
   * 光照**真乘**（`color = tile × TerrainLight` 的线性变形，见 LIGHT_TUNE）。
   *
   * 早先这里算过一个「自动定标」的 `uLight`，想让平均亮度落在 0.35，
   * 结果一直被 clamp 在上限 2.6（tile 的线性亮度只有 0.05 左右），
   * 等于把一个失控的系数乘进画面 —— 换地图就过曝。那套逻辑已删：
   * 现在只保留三个稳定参数（floor / gain / exposure），与地图无关。
   *
   * 保持 `tilesTexture.colorSpace = NoColorSpace`：tile 贴图**不做 sRGB→线性
   * 解码**，与 muonlinejs（Babylon 默认按 sRGB 数值直用）同一套算法。
   */
  const uExposure = LIGHT_TUNE.exposure;

  /* 光照图统计：均值和分位数，用来判断这张图整体偏亮还是偏暗（调 LIGHT_TUNE 用） */
  const lum: number[] = [];
  for (let i = 0; i < lightPixels.length; i += 4 * 7) {
    lum.push((0.2126 * lightPixels[i] + 0.7152 * lightPixels[i + 1] + 0.0722 * lightPixels[i + 2]) / 255);
  }
  lum.sort((a, b) => a - b);
  const pick = (q: number) => +(lum[Math.min(lum.length - 1, Math.floor(lum.length * q))] ?? 0).toFixed(3);
  const lightStats = {
    mean: +(lum.reduce((a, b) => a + b, 0) / Math.max(1, lum.length)).toFixed(3),
    p05: pick(0.05),
    p50: pick(0.5),
    p95: pick(0.95),
  };

  /*
   * 按地图定标：把"光照图均值"统一抬到 `LIGHT_LEVEL_TARGET`。
   *
   * 为什么不能用常数：`TerrainLight.OZJ` 的基准值是各图自带的
   * （实测 mean：洛兰 0.56 / 冰风谷 0.57 / 死亡沙漠 0.61 都在"白天"档；
   *   地下城 0.43 / 失落塔 0.33 / 亚特兰蒂斯 0.30 明显更暗）。
   * 定值映射会把暗图压死，而每张图写一个手调常数又会越加越乱 ——
   * 直接按均值归一，既保住各图自己的明暗对比曲线，也保证换图不会忽明忽暗。
   *
   * `marioLift` 只往上抬（≥1），不做压暗：亮图维持原样，避免出现
   * 「刚调好的洛兰又被改回去」。
   */
  const lightBase = LIGHT_TUNE.floor + LIGHT_TUNE.gain * lightStats.mean;
  const uLightLift = +Math.max(1, Math.min(1.65, LIGHT_LEVEL_TARGET / Math.max(0.05, lightBase))).toFixed(3);

  const lightMap = new THREE.DataTexture(
    lightPixels,
    size,
    size,
    THREE.RGBAFormat
  );
  // 光照图按原始数值使用（不做 sRGB 解码），与客户端一样当作亮度系数相乘
  lightMap.colorSpace = THREE.NoColorSpace;
  lightMap.magFilter = THREE.LinearFilter;
  lightMap.minFilter = THREE.LinearMipmapLinearFilter;
  lightMap.generateMipmaps = true;
  lightMap.needsUpdate = true;

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      tiles: { value: tilesTexture },
      layerMap: { value: layerMap },
      alphaMap: { value: alphaMap },
      lightMap: { value: lightMap },
      uTileCount: { value: tiles.length },
      uTileDiv: { value: tileDiv },
      uExposure: { value: uExposure },
      /** 光照图端点：light = floor + gain × rl（见 LIGHT_TUNE） */
      uLightFloor: { value: LIGHT_TUNE.floor },
      uLightGain: { value: LIGHT_TUNE.gain },
      uLightLift: { value: uLightLift },
      /*
       * 雾色要传 **sRGB 分量**。
       * three 的 `new THREE.Color(0x9db6cc)` 在 colorManagement 打开时会转成线性
       * （0.71 → 0.46），而我们的 fragColor 是直接写进帧缓冲（不做 linear→sRGB 编码，
       * 因为地形贴图本身就是按 sRGB 数值用的）。直接用线性雾色会让远景整整暗一档。
       */
      uFogColor: { value: fog.color.clone().convertLinearToSRGB() },
      uFogNear: { value: fog.near },
      uFogFar: { value: fog.far },
    },
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;

  const getHeight = (x: number, y: number) => {
    const fx = Math.min(Math.max(x, 0), size - 1.001);
    const fy = Math.min(Math.max(y, 0), size - 1.001);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const h = data.height;
    const h00 = h[y0 * size + x0];
    const h10 = h[y0 * size + x0 + 1];
    const h01 = h[(y0 + 1) * size + x0];
    const h11 = h[(y0 + 1) * size + x0 + 1];
    return (
      h00 * (1 - tx) * (1 - ty) +
      h10 * tx * (1 - ty) +
      h01 * (1 - tx) * ty +
      h11 * tx * ty
    );
  };

  const isWalkable = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= size - 1 || iy >= size - 1) return false;
    const flag = data.attribute[iy * size + ix];
    if (flag & (TW_NOGROUND | TW_NOMOVE)) return false;
    return true;
  };

  /*
   * ── 小地图底图 ─────────────────────────────────────────────────────
   *
   * 0.97 客户端**没有小地图**（这是给 H5 版加的体验功能，素材用 Data/Interface
   * 里那套 `MiniMap.OZT` 边框）。地图本身从地形数据现算，不需要服务端：
   *
   *   1. 每张 tile 算一个平均色（草地绿、道路黄、岩石灰、水蓝…）
   *   2. 逐格按 `layer1/layer2/alpha` 混出底色（和着色器的 mix 同一套规则）
   *   3. 叠山体阴影：西北光，`1 + (h(x-1)-h(x+1)) + (h(y-1)-h(y+1))`
   *   4. 水面（`TW_WATER`）压成蓝色
   *
   * 结果是一张 256×256 的「示意图」，不是原版截图 —— 但配色/地形起伏都是真的。
   */
  // 哪几张 tile 是水面 —— 小地图上要单独染蓝（洛兰的河是用 `TileWater01`
  // 画的但 `.att` 里标的是 `TW_NOMOVE`，光看属性位是认不出水面的）
  const isWaterTile = tiles.map(t => /water/i.test(t));
  const tileAvg = new Uint8Array(tiles.length * 3);
  for (let t = 0; t < tiles.length; t++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const layerBase = t * TILE_SIZE * TILE_SIZE * 4;
    for (let y = 0; y < TILE_SIZE; y += 2) {
      for (let x = 0; x < TILE_SIZE; x += 2) {
        const o = layerBase + (y * TILE_SIZE + x) * 4;
        r += layerPixels[o];
        g += layerPixels[o + 1];
        b += layerPixels[o + 2];
        n++;
      }
    }
    tileAvg[t * 3] = Math.round(r / n);
    tileAvg[t * 3 + 1] = Math.round(g / n);
    tileAvg[t * 3 + 2] = Math.round(b / n);
  }

  /* ------------------------------------------------------------------ */
  /* 水面                                                               */
  /* ------------------------------------------------------------------ */

  /*
   * 水面贴图：**复用已经解码好的 TileWater01**（就是 tile 数组里那层），
   * 不重新读文件 —— 这样连「这张地图缺 TileWater01」的情况都自动继承了
   * （World8 没有这张图，草地那层会顶上来，那就干脆不做水面）。
   */
  const waterTileIdx = tiles.findIndex(t => /^TileWater01$/i.test(t));
  const waterLayerMissing = waterTileIdx >= 0 && missingTiles.includes(tiles[waterTileIdx]);

  /**
   * 这一格是不是水面。
   *
   * **不是**按高度判的 —— 实测两张图的 `.att` 里高度字节几乎都不是 0
   * （洛兰 64516 格里只有 6 格是 0，河床平均 0.32；亚特兰蒂斯海床 2.1~2.45），
   * 而 `TW_WATER(0x10)` 位两张图**一格都没置**。真正可靠的判据是瓦片索引：
   *
   *   - 洛兰的河：`layer1 == TileWater01`（7461 格，河床本身就是水瓦片）
   *   - 亚特兰蒂斯：`layer2 == TileWater01`（6974 格，水是叠在海床上的一层）
   *
   * 这正好对上反编译里那两句：水面贴图取 `TerrainMappingLayer1[tile]`；
   * 而 `World == 7 && attrib2 == 5` 时再在瓦片上画一层水面（layer2 是水）。
   */
  const isWaterCell = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= size - 1 || y >= size - 1) return false;
    if (waterTileIdx < 0) return false;
    const i = y * size + x;
    return data.layer1[i] === waterTileIdx || data.layer2[i] === waterTileIdx;
  };

  /**
   * 这一格水面的不透明度。
   *
   * `layer1` 是水 = 整格都是水（洛兰的河）→ 不透明。
   * `layer2` 是水 = 水只是叠在海床上的一层，`.map` 里的 alpha 就是它的浓度
   * （亚特兰蒂斯 6974 格里 4246 格 alpha < 32、2459 格 32..95 —— 确实很淡）。
   * 完全照 alpha 走的话水面几乎看不见在动，所以压了个 0.45 的下限；
   * 上限留 1.0，岸边 alpha 高的地方照旧是实水。
   */
  const waterAlphaAt = (i: number) => {
    if (data.layer1[i] === waterTileIdx) return 1;
    return Math.min(1, Math.max(0.45, data.alpha[i] / 255));
  };

  const WATER_VERT = /* glsl */ `
    in float aAlpha;

    out vec2 vCell;
    out float vDepth;
    out float vWave;
    out float vAlpha;

    uniform float uTime;
    // 波动幅度（世界单位）。原版 DAT_00552488 = 10（1 格 = 100 单位）= 0.1 格
    uniform float uAmp;

    void main() {
      vCell = uv;
      vAlpha = aAlpha;
      /*
       * 原版 Terrain_FrameUpdate：
       *   water_wave[tile] = sin(tile_col * freq + sun_angle) * amplitude
       * 并且**只往上抬**（水面低于海床就会出现破洞 / 和海床打架），
       * 所以这里把正弦抬到 0..1 再乘幅度。
       * 两个方向叠一层，波长/速度都不一致，看起来是缓慢起伏而不是整齐的波浪。
       */
      float w = sin(uv.x * 0.55 + uTime * 1.7) + sin(uv.y * 0.43 - uTime * 1.3);
      vWave = w * 0.5 + 0.5;
      vec3 p = position;
      p.z += vWave * uAmp;

      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      vDepth = -mvPosition.z;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const WATER_FRAG = /* glsl */ `
    precision highp float;

    in vec2 vCell;
    in float vDepth;
    in float vWave;
    in float vAlpha;

    uniform sampler2D waterMap;
    uniform sampler2D lightMap;
    uniform float uDiv;
    uniform float uTime;
    uniform float uAlpha;
    uniform float uExposure;
    uniform float uLightFloor;
    uniform float uLightGain;
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;

    out vec4 fragColor;

    void main() {
      /*
       * UV 滚动：水面在「流」。用 RepeatWrapping + 累加时间偏移，
       * 不做 fract（fract 会让 GPU 自动求导在 0/1 处炸掉，mip 选错 → 一道亮线）。
       */
      vec2 scroll = vec2(uTime * 0.013, uTime * 0.021);
      vec3 base = texture(waterMap, vCell / uDiv + scroll).rgb;

      vec3 rl = texture(lightMap, (floor(vCell) + 0.5) / 256.0).rgb;
      float mn = min(min(rl.r, rl.g), rl.b);
      float mx = max(max(rl.r, rl.g), rl.b);
      if (mx - mn > 0.4) rl = vec3((rl.r + rl.g + rl.b) / 3.0);
      vec3 light = vec3(uLightFloor) + uLightGain * rl;

      // 波峰稍微亮一点：水面的高光是最能"看出在动"的线索
      vec3 col = base * light * uExposure * (1.0 + 0.18 * vWave);

      float fog = smoothstep(uFogNear, uFogFar, vDepth);
      col = mix(col, uFogColor, fog);

      fragColor = vec4(col, uAlpha * vAlpha);
    }
  `;

  let water: THREE.Mesh | null = null;
  let waterUniforms: {
    uTime: { value: number };
    uAmp: { value: number };
    uAlpha: { value: number };
    [k: string]: THREE.IUniform;
  } | null = null;

  if (waterTileIdx >= 0 && !waterLayerMissing) {
    const cellBase = new Map<number, number>();
    const wpos: number[] = [];
    const wuv: number[] = [];
    const widx: number[] = [];
    const walpha: number[] = [];

    /*
     * 顶点透明度 = 相邻水格里**最大**的那个（顶点被最多 4 格共用）。
     * 这样岸边的淡水和河心的实水之间是渐变，不会出现一格一格的硬边。
     */
    const vAlpha = new Float32Array(size * size);
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        if (!isWaterCell(x, y)) continue;
        const a = waterAlphaAt(y * size + x);
        const k00 = y * size + x;
        if (a > vAlpha[k00]) vAlpha[k00] = a;
        if (a > vAlpha[k00 + 1]) vAlpha[k00 + 1] = a;
        if (a > vAlpha[k00 + size]) vAlpha[k00 + size] = a;
        if (a > vAlpha[k00 + size + 1]) vAlpha[k00 + size + 1] = a;
      }
    }

    const vertAt = (x: number, y: number) => {
      const key = y * size + x;
      const found = cellBase.get(key);
      if (found !== undefined) return found;
      const idx = wpos.length / 3;
      /*
       * 水面高度 = **河床高度 + 一点抬高**。
       *
       * 原版是 `water_wave[tile]` 加到水面顶点上，水面本身铺在瓦片的高度上，
       * 所以这里也让水面贴着地形走 —— 河床低水面就低，不会出现
       * 「水面悬在半空、岸边一圈漏空」的问题。
       */
      wpos.push(x, y, data.height[key] + WATER_SURFACE_LIFT);
      wuv.push(x, y);
      walpha.push(vAlpha[key] || 1);
      cellBase.set(key, idx);
      return idx;
    };

    let quads = 0;
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        if (!isWaterCell(x, y)) continue;
        const a = vertAt(x, y);
        const b = vertAt(x + 1, y);
        const c = vertAt(x, y + 1);
        const d = vertAt(x + 1, y + 1);
        // 与地形同样的绕序：从 +Z 看是逆时针
        widx.push(a, b, c, b, d, c);
        quads++;
      }
    }

    if (quads > 0) {
      const wgeo = new THREE.BufferGeometry();
      wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      wgeo.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
      wgeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(walpha, 1));
      wgeo.setIndex(widx);
      wgeo.computeBoundingSphere();

      const waterPixels = layerPixels.slice(
        waterTileIdx * TILE_SIZE * TILE_SIZE * 4,
        (waterTileIdx + 1) * TILE_SIZE * TILE_SIZE * 4
      );
      const waterTex = new THREE.DataTexture(
        new Uint8Array(waterPixels),
        TILE_SIZE,
        TILE_SIZE,
        THREE.RGBAFormat
      );
      waterTex.colorSpace = THREE.NoColorSpace;
      waterTex.magFilter = THREE.LinearFilter;
      waterTex.minFilter = THREE.LinearMipmapLinearFilter;
      waterTex.generateMipmaps = true;
      waterTex.wrapS = THREE.RepeatWrapping;
      waterTex.wrapT = THREE.RepeatWrapping;
      waterTex.anisotropy = 8;
      waterTex.needsUpdate = true;

      waterUniforms = {
        waterMap: { value: waterTex },
        lightMap: { value: lightMap },
        uDiv: { value: Math.max(1, tileDiv[waterTileIdx]) },
        uTime: { value: 0 },
        uAmp: { value: 0.05 },
        /*
         * 整体不透明度上限。逐顶点的浓度在 `aAlpha` 里（见 `waterAlphaAt`），
         * 这里再乘一层，让河床/海床透出来一点 —— 既有「水很浅」的观感，
         * 也不至于把站在水里的角色糊成蓝色。
         */
        uAlpha: { value: 0.82 },
        uExposure: { value: uExposure },
        uLightFloor: { value: LIGHT_TUNE.floor },
        uLightGain: { value: LIGHT_TUNE.gain },
        uFogColor: { value: fog.color.clone().convertLinearToSRGB() },
        uFogNear: { value: fog.near },
        uFogFar: { value: fog.far },
      };

      const wmat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: WATER_VERT,
        fragmentShader: WATER_FRAG,
        uniforms: waterUniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      water = new THREE.Mesh(wgeo, wmat);
      water.name = 'water';
      water.frustumCulled = false;
      water.renderOrder = 1;
      water.userData.quads = quads;
      console.log(`[terrain] 水面 ${quads} 格（贴图 ${tiles[waterTileIdx]}，顶点 ${wpos.length / 3}）`);
    }
  }

  const updateWater = (time: number) => {
    if (!waterUniforms) return;
    waterUniforms.uTime.value = time;
  };

  let minimapCache: HTMLCanvasElement | null = null;
  function buildMinimap(): HTMLCanvasElement {
    if (minimapCache) return minimapCache;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const out = img.data;
    const tileCount = tiles.length;
    const at = (i: number) => (i < tileCount ? i : 0);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const t1 = at(data.layer1[i]);
        const t2raw = data.layer2[i];
        const t2 = t2raw === 255 ? t1 : at(t2raw);
        const a = data.alpha[i] / 255;
        let r = tileAvg[t1 * 3] * (1 - a) + tileAvg[t2 * 3] * a;
        let g = tileAvg[t1 * 3 + 1] * (1 - a) + tileAvg[t2 * 3 + 1] * a;
        let b = tileAvg[t1 * 3 + 2] * (1 - a) + tileAvg[t2 * 3 + 2] * a;

        // 山体阴影：西北方向的光（左/上更高 → 更亮）
        const hl = data.height[i - (x > 0 ? 1 : 0)];
        const hr = data.height[i + (x < size - 1 ? 1 : 0)];
        const hu = data.height[i - (y > 0 ? size : 0)];
        const hd = data.height[i + (y < size - 1 ? size : 0)];
        const shade = Math.max(0.66, Math.min(1.45, 1 + (hl - hr) * 1.6 + (hu - hd) * 1.6));
        // 1.15 = 整体提亮一点：tile 平均色本身偏暗，直接铺在小面板上看不清路
        r *= shade * 1.15;
        g *= shade * 1.15;
        b *= shade * 1.15;

        /*
         * 水：压成蓝色。两条判据都要 ——
         *   - `.att` 的 `TW_WATER`（亚特兰蒂斯这种真正的水地图）
         *   - tile 名里带 Water 的格（洛兰的河：属性是 `TW_NOMOVE`，只有 tile 名能认）
         */
        const waterTile = a >= 0.5 ? isWaterTile[t1] : isWaterTile[t2];
        const water = waterTile || (data.attribute[i] & TW_WATER) !== 0;
        if (water) {
          // 保留一点原色（tile 明暗差异），只往蓝绿方向压
          r = r * 0.35 + 18;
          g = g * 0.45 + 42;
          b = b * 0.55 + 78;
        }

        const o = i * 4;
        out[o] = Math.max(0, Math.min(255, r));
        out[o + 1] = Math.max(0, Math.min(255, g));
        out[o + 2] = Math.max(0, Math.min(255, b));
        out[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    minimapCache = cv;
    return cv;
  }

  return {
    mesh,
    data,
    getHeight,
    isWalkable,
    tilesTexture,
    tileSizes,
    tileDiv,
    lightStats,
    lightLift: uLightLift,
    waterLevel: WATER_LEVEL,
    isWaterCell,
    water,
    updateWater,
    buildMinimap,
  };
}

/**
 * 传送落点矩形，对应服务端 `Gate.txt` 的 `X Y TX TY`（含两端）。
 *
 * 服务端 `CGate` 就是拿这个矩形随机挑一格当落点 —— 所以这里不要「取中心」，
 * 中心常常是喷泉/雕像/墙。
 */
export interface SpawnRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 这格能不能站人（墙 / 虚空 / 水都不行） */
function standable(terrain: TerrainMesh, ix: number, iy: number) {
  const size = TERRAIN_SIZE;
  if (ix < 1 || iy < 1 || ix > size - 2 || iy > size - 2) return false;
  // 水也算不能站：亚特兰蒂斯整张图都是水，落水里比落墙上更难受
  return (terrain.data.attribute[iy * size + ix] & (TW_NOGROUND | TW_NOMOVE | TW_WATER)) === 0;
}

/**
 * 在 Gate 落点矩形里随机挑一格能站的（服务端 `CGate::GetGateMapNumber` 的行为）。
 *
 * - 矩形里有能站的格 → 随机一格（每次传送落点不同，和原版一致）
 * - 矩形的格全被墙/水占了 → 从矩形中心向外螺旋找最近的可站格（最多 24 格）
 * - 实在没有 → null，交回 `findSpawnTile` 兜底
 *
 * `rand` 可注入，探针要确定性结果时传 `() => 0`。
 */
export function findSpawnTileInRect(
  terrain: TerrainMesh,
  rect: SpawnRect,
  rand: () => number = Math.random
): { x: number; y: number } | null {
  const size = TERRAIN_SIZE;
  const x1 = Math.max(1, Math.min(size - 2, Math.min(rect.x1, rect.x2)));
  const y1 = Math.max(1, Math.min(size - 2, Math.min(rect.y1, rect.y2)));
  const x2 = Math.max(1, Math.min(size - 2, Math.max(rect.x1, rect.x2)));
  const y2 = Math.max(1, Math.min(size - 2, Math.max(rect.y1, rect.y2)));

  const pool: number[] = [];
  for (let iy = y1; iy <= y2; iy++) {
    for (let ix = x1; ix <= x2; ix++) {
      if (standable(terrain, ix, iy)) pool.push(iy * size + ix);
    }
  }
  if (pool.length) {
    const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rand() * pool.length)));
    const c = pool[i];
    return { x: c % size, y: Math.floor(c / size) };
  }

  /* 矩形整个不可站：以中心为原点一圈圈往外找（地下城/天空之城的 Gate 偶尔落在墙里） */
  const cx = Math.round((x1 + x2) / 2);
  const cy = Math.round((y1 + y2) / 2);
  for (let r = 0; r <= 24; r++) {
    let best: { d: number; x: number; y: number } | null = null;
    for (let iy = cy - r; iy <= cy + r; iy++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) !== r) continue;
        if (!standable(terrain, ix, iy)) continue;
        const d = (ix - cx) * (ix - cx) + (iy - cy) * (iy - cy);
        if (!best || d < best.d) best = { d, x: ix, y: iy };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return null;
}

/**
 * 挑一个能站的出生格（**没有 Gate 表时**的兜底）。
 *
 * 服务端下发的坐标一律尊重 —— 只要那格是陆地就原样返回，绝不替玩家挑位置。
 * 只有「窗口自己挑点」（`x < 0`）或者坐标落在墙/虚空/水里时才自己找：
 *
 *   1. 城镇安全区（`TerrainWall & 1`，`Entity_Spawn.cpp:110`）的**重心**附近
 *      —— 用重心而不是「离地图中心最近的安全格」，否则像冰风谷这种城镇偏在
 *      一角的地图，会被丢到城门外
 *   2. 没有安全区（地下城、天空之城）就退化成全部陆地格的重心
 *
 * 现在有了服务端的 `Gate.txt`，移动命令优先走 `findSpawnTileInRect`；
 * 这里只负责「Gate 缺表 / 服务端坐标落在墙里」的兜底。
 */
export function findSpawnTile(
  terrain: TerrainMesh,
  x: number,
  y: number
): { x: number; y: number } {
  const size = TERRAIN_SIZE;
  const attr = terrain.data.attribute;
  const ok = (ix: number, iy: number) => {
    if (ix < 1 || iy < 1 || ix > size - 2 || iy > size - 2) return false;
    const flag = attr[iy * size + ix];
    // 水也算不能站：亚特兰蒂斯整张图都是水，落水里比落墙上更难受
    return (flag & (TW_NOGROUND | TW_NOMOVE | TW_WATER)) === 0;
  };

  if (x >= 0 && y >= 0 && ok(Math.floor(x), Math.floor(y))) return { x, y };

  /* 两遍扫描：先求重心，再找离重心最近的可用格（重心中间常常是雕像/喷泉） */
  const pick = (wantSafe: boolean) => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let iy = 1; iy < size - 1; iy++) {
      for (let ix = 1; ix < size - 1; ix++) {
        if (!ok(ix, iy)) continue;
        if (wantSafe && (attr[iy * size + ix] & TW_SAFEZONE) === 0) continue;
        sx += ix;
        sy += iy;
        n++;
      }
    }
    if (!n) return null;
    const cx = sx / n;
    const cy = sy / n;
    let best: { d: number; x: number; y: number } | null = null;
    for (let iy = 1; iy < size - 1; iy++) {
      for (let ix = 1; ix < size - 1; ix++) {
        if (!ok(ix, iy)) continue;
        if (wantSafe && (attr[iy * size + ix] & TW_SAFEZONE) === 0) continue;
        const d = (ix - cx) * (ix - cx) + (iy - cy) * (iy - cy);
        if (!best || d < best.d) best = { d, x: ix, y: iy };
      }
    }
    return best;
  };

  return pick(true) ?? pick(false) ?? { x: 128, y: 128 };
}
