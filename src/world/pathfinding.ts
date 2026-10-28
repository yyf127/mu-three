/**
 * 网格 A* 寻路（8 方向）。
 *
 * 代价公式照抄 0.97 客户端 `Game/PathFinder.cpp::PATH_FindPath`：
 *   - 每步 G：直线 +5，斜线 +7
 *   - 启发 H：`((|dx-dy| * 15 + 3 + minor * 21) / 4)`，minor = min(dx,dy)
 *     （dx、dy 都为 1 时 minor 取 0）
 *
 * 与客户端略有不同的一处：斜向移动时要求两个正交邻格**至少一个可走**，
 * 否则会从两堵墙的角缝里穿过去 —— 服务端不校验中间格，但看着很怪。
 */

export interface Cell {
  x: number;
  y: number;
}

/** 单次寻路的搜索上限，防止目标不可达时把整张图刷一遍 */
const DEFAULT_MAX_NODES = 9000;

const DIRS: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

const SQRT2_STEP = 7;
const STEP = 5;

/** 与客户端一致的启发值 */
function heuristic(dx: number, dy: number) {
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  const minor = dx === 1 && dy === 1 ? 0 : Math.min(dx, dy);
  const raw = Math.abs(dx - dy) * 15 + 3 + minor * 21;
  // C 里是 `(raw + (raw >> 31 & 3)) >> 2`，等价于整数除法
  return Math.floor(raw / 4);
}

/**
 * @param sx,sy  起点格
 * @param tx,ty  终点格
 * @param passable  该格是否可站（地形 + 单位占位，调用方决定）
 * @param blockDiag 可选：斜向移动的侧格是否被「单位」占用。给了就禁止擦人斜穿，
 *                 但允许擦墙（贴墙绕行是正常操作）
 * @returns 从起点到终点的格子序列（不含起点），不可达返回 null
 */
export function findPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  passable: (x: number, y: number) => boolean,
  maxNodes = DEFAULT_MAX_NODES,
  blockDiag?: (x: number, y: number) => boolean
): Cell[] | null {
  // 调用方传的是「格子坐标」，这里只做整数化，不做 round
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  tx = Math.floor(tx);
  ty = Math.floor(ty);

  if (sx === tx && sy === ty) return [];
  if (!inBounds(tx, ty)) return null;
  // 终点不可站时直接失败，由调用方找替代格
  if (!passable(tx, ty)) return null;

  const W = 256;
  const key = (x: number, y: number) => y * W + x;

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();

  // 简易二叉堆（按 f 排序）
  const heap: { id: number; f: number }[] = [];
  const push = (id: number, f: number) => {
    heap.push({ id, f });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };

  const startId = key(sx, sy);
  gScore.set(startId, 0);
  push(startId, heuristic(tx - sx, ty - sy));

  let expanded = 0;

  while (heap.length) {
    const cur = pop();
    if (closed.has(cur.id)) continue;
    closed.add(cur.id);

    const cx = cur.id % W;
    const cy = (cur.id / W) | 0;

    if (cx === tx && cy === ty) {
      // 回溯
      const out: Cell[] = [];
      let node = cur.id;
      while (node !== startId) {
        out.push({ x: node % W, y: (node / W) | 0 });
        const prev = cameFrom.get(node);
        if (prev === undefined) break;
        node = prev;
      }
      out.reverse();
      return out;
    }

    if (++expanded > maxNodes) break;

    const g = gScore.get(cur.id) ?? 0;

    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny)) continue;

      const nid = key(nx, ny);
      if (closed.has(nid)) continue;
      if (!passable(nx, ny)) continue;

      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal) {
        // 不让角色从两个墙角的缝隙里斜穿过去
        const sideA = passable(cx + dx, cy);
        const sideB = passable(cx, cy + dy);
        if (!sideA && !sideB) continue;
        // 单位占位（NPC / 怪 / 其他玩家）另算：斜向跨格时人会从侧格上
        // 掠过去，视觉上等于擦着对方身体走。任一侧格有单位就换条路。
        if (blockDiag && (blockDiag(cx + dx, cy) || blockDiag(cx, cy + dy))) continue;
      }

      const ng = g + (diagonal ? SQRT2_STEP : STEP);
      const old = gScore.get(nid);
      if (old !== undefined && old <= ng) continue;

      gScore.set(nid, ng);
      cameFrom.set(nid, cur.id);
      push(nid, ng + heuristic(tx - nx, ty - ny));
    }
  }

  return null;
}

function inBounds(x: number, y: number) {
  /*
   * 和 `terrain.isWalkable` 保持同一套边界：0..254。
   *
   * 以前这里写的是 `x >= 1 && y >= 1`，把地图最外一圈整条封死 ——
   * 站在 `x=0` 上点旁边那一格，A* 直接返回 null，表现就是
   * 「贴边的时候点地面没反应」。地形/服务端都允许站在 0 这一列。
   */
  return x >= 0 && y >= 0 && x < 255 && y < 255;
}

/**
 * 目标格被占时找一个最近的空邻格，用于「点到 NPC 脚下的地面」这种情况。
 *
 * 按**欧氏距离**取最近，而不是按扫描顺序取第一个：
 * 扫描顺序总是先返回左上角那一格，点 NPC 会莫名其妙绕到西北边去。
 */
export function nearestFree(
  x: number,
  y: number,
  passable: (x: number, y: number) => boolean,
  radius = 2,
  /**
   * 选格偏好：给了以后，在「离点击格不超过 radius」的候选里挑**离它最近**的那个。
   *
   * 用于「点的格被人占着」的情况：默认按离点击格最近来挑，会挑到对方
   * **背面**那一格 —— 界面上看就是「点了第二格，圆圈画在第三格、人还绕过去」。
   * 传玩家坐标进来，就会优先停在**自己这一侧**的空格。
   */
  prefer?: { x: number; y: number }
): Cell | null {
  if (passable(x, y)) return { x, y };

  let best: Cell | null = null;
  let bestD = Infinity;
  let bestP = Infinity;
  const r2 = radius * radius;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 === 0 || d2 > r2) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (!passable(nx, ny)) continue;
      const p2 = prefer ? (nx - prefer.x) ** 2 + (ny - prefer.y) ** 2 : 0;
      if (p2 < bestP - 1e-9 || (Math.abs(p2 - bestP) < 1e-9 && d2 < bestD)) {
        bestD = d2;
        bestP = p2;
        best = { x: nx, y: ny };
      }
    }
  }
  return best;
}
