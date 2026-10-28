/**
 * headless Edge 的临时 profile 管理。
 *
 * 为什么需要：`--user-data-dir` 每个实例会写 60~170 MB。
 * 早期脚本只 `edge.kill()` 不删目录，跑十几次就是 1 GB 垃圾
 * （实测 10 个目录 893 MB），而且 Edge 的临时目录散在 %TEMP% 根下，
 * 前缀还是 edge-a / edge-b / fc / sk 各写各的，根本没法一次清干净。
 *
 * 现在的约定：
 *   - 所有 profile 统一放在 `%TEMP%/mu-probe/<prefix>-<pid>-<n>/`
 *   - `makeProfile()` 先清扫历史残留，再建自己的
 *   - 进程退出时同步删自己的（`process.on('exit')` 会拦截脚本里的 `process.exit()`）
 *   - 删不掉（Edge 还没放开句柄）就留在那，下次谁跑探针谁扫
 *
 * 用固定 profile 复用确实能让磁盘只占一份，但登录态、localStorage、
 * 上次的 WebSocket 连接会串味，测试结果就不干净了 —— 宁可每次新建再删。
 */
import { mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(tmpdir(), 'mu-probe');

/** 5 分钟内还在动的目录可能是别的探针在跑，别抢着删 */
const LIVE_WINDOW_MS = 5 * 60 * 1000;

const mine = new Set();
let seq = 0;
let swept = false;

/** 清掉历史残留（上次跑到一半被 Ctrl+C 或者删失败留下的） */
function sweep() {
  if (swept) return;
  swept = true;
  let names;
  try {
    mkdirSync(ROOT, { recursive: true });
    names = readdirSync(ROOT);
  } catch {
    return;
  }
  for (const name of names) {
    const dir = join(ROOT, name);
    if (mine.has(dir)) continue;
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (Date.now() - st.mtimeMs < LIVE_WINDOW_MS) continue;
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
    } catch {
      /* Edge 还占着，下次再说 */
    }
  }
}

/** 建一个本次运行专用的 profile 目录，返回绝对路径 */
export function makeProfile(prefix = 'run') {
  sweep();
  const dir = join(ROOT, `${prefix}-${process.pid}-${++seq}`);
  mkdirSync(dir, { recursive: true });
  mine.add(dir);
  return dir;
}

/** 主动删（一般不用调，退出时会自动删） */
export function dropProfile(dir) {
  mine.delete(dir);
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
  } catch {
    /* 留给下次 sweep */
  }
}

// 注意：这里只能用同步 API。`process.exit()` 触发 exit 事件后
// 事件循环已经不再跑了，异步删除一定会丢失。
process.on('exit', () => {
  for (const dir of mine) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    } catch {
      /* Edge 还没放开句柄 → 下次 sweep 兜底 */
    }
  }
  mine.clear();
});

/** 当前 profile 根目录（调试/清理脚本用） */
export const PROFILE_ROOT = ROOT;
