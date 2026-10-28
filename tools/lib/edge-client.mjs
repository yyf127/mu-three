/**
 * headless Edge + CDP 的单页客户端封装。
 *
 * 双账号探针要同时开两个互不干扰的浏览器，所以把「起进程 → 连 CDP →
 * navigate → 等 __MU_APP__ 就绪」这套样板抽出来，两个脚本共用。
 *
 * profile 统一走 `tools/lib/profile.mjs`，退出时自己删，不会在 %TEMP% 里堆垃圾。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeProfile } from './profile.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DEFAULT_URL = 'http://127.0.0.1:5180/';

/**
 * @param {string} label  日志前缀 / profile 前缀
 * @param {{url?: string, width?: number, height?: number}} [opts]
 */
export async function createClient(label, opts = {}) {
  const url = opts.url || DEFAULT_URL;
  const width = opts.width || 1280;
  const height = opts.height || 760;
  mkdirSync('shots', { recursive: true });

  const port = 9700 + Math.floor(Math.random() * 200);
  const profile = makeProfile(`cdp-${label}`);
  /*
   * 默认走 swiftshader（软件渲染）—— 不依赖显卡、结果稳定，但帧率只有个位数，
   * `dt` 会被钳到 0.1，测「按秒算」的时序（走路速度、转身）会失真。
   * 需要真实帧率时设 `MU_GPU=1`，用硬件 ANGLE 跑。
   */
  const gpu = process.env.MU_GPU === '1';
  const edge = spawn(
    EDGE,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      // 本地资源直连：不继承系统代理（代理会把 .wav/.mp3 这类大文件挡成 204）
      '--no-proxy-server',
      ...(gpu ? ['--use-angle=d3d11', '--enable-gpu-rasterization'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']),
      '--no-first-run',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let ws = null;
  let seq = 0;
  const pend = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++seq;
      pend.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  const ev = async expr => {
    const r = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result.value;
  };

  /**
   * 发一条真实鼠标事件。CDP 的 Input.* 走的是浏览器输入管线，
   * 页面里 `pointerdown/pointermove/pointerup` 会照常触发，
   * 适合验证背包拖拽这类只监听 PointerEvent 的 UI。
   */
  const ptr = (type, x, y, extra = {}) =>
    send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      pointerType: 'mouse',
      ...extra,
    });

  /** 从 (x1,y1) 拖到 (x2,y2)，坐标是视口 CSS 像素 */
  const dragTo = async (x1, y1, x2, y2, steps = 10) => {
    await ptr('mouseMoved', x1, y1, { buttons: 0 });
    await ptr('mousePressed', x1, y1);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await ptr('mouseMoved', x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      await sleep(16);
    }
    await ptr('mouseReleased', x2, y2);
  };

  const waitFor = async (expr, timeoutMs = 60000, tag = expr) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if ((await ev(expr)) === true) return true;
      await sleep(400);
    }
    throw new Error(`[${label}] 等待超时: ${tag}`);
  };

  let targets = null;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await r.json();
      if (targets && targets.length) break;
    } catch {}
    await sleep(300);
  }
  if (!targets) {
    edge.kill();
    throw new Error(`[${label}] CDP 端口没起来`);
  }

  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', j);
  });

  const logs = [];
  ws.addEventListener('message', e => {
    const d = JSON.parse(e.data);
    if (d.id && pend.has(d.id)) {
      const { res, rej } = pend.get(d.id);
      pend.delete(d.id);
      d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
      return;
    }
    if (d.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${d.params.type}] ${(d.params.args || []).map(a => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (d.method === 'Runtime.exceptionThrown') {
      logs.push('[exc] ' + (d.params.exceptionDetails.exception?.description || ''));
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  try {
    await waitFor('!!window.__MU_APP__', 25000, '页面初始化');
  } catch (err) {
    /*
     * 页面挂了的时候，`__MU_APP__` 永远不会出现 —— 光看「等待超时」没法定位。
     * 把这一路收集到的 console / 未捕获异常打出来，直接指向出错的文件和行号。
     */
    console.error(`[${label}] 页面初始化失败，最近的日志（${logs.length} 条）：`);
    for (const l of logs.slice(-30)) console.error('   ' + l);
    try {
      const where = await ev(`location.href + ' | body=' + (document.body ? document.body.innerHTML.length : -1)`);
      console.error(`[${label}] ${where}`);
    } catch {
      /* CDP 也断了就算了 */
    }
    edge.kill();
    throw err;
  }

  /**
   * 取元素中心点的视口坐标。selector 支持复合写法，
   * 比如 `[data-slot="12"]`，用来定位背包格子。
   */
  const centerOf = async selector => {
    const raw = await ev(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height });
    })()`);
    return raw ? JSON.parse(raw) : null;
  };

  return {
    label,
    logs,
    ev,
    waitFor,
    send,
    ptr,
    dragTo,
    center: centerOf,
    /** 把 fromSel 拖到 toSel；返回两端中心点，找不到则抛错 */
    drag: async (fromSel, toSel, steps = 10) => {
      const a = await centerOf(fromSel);
      const b = await centerOf(toSel);
      if (!a || !b) throw new Error(`[${label}] 拖拽定位失败: ${!a ? fromSel : toSel}`);
      await dragTo(a.x, a.y, b.x, b.y, steps);
      return { from: a, to: b };
    },
    /** 截图存到 shots/<name>.png */
    shot: async name => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
      return `shots/${name}.png`;
    },
    close: async () => {
      try {
        await ev('__MU_APP__.close()');
        await sleep(400);
      } catch {}
      try {
        ws?.close();
      } catch {}
      edge.kill();
    },
  };
}

/** 登录 + 选第一个角色 + 等进图；返回 { name, mapId } */
export async function loginAs(client, account, password) {
  await client.ev(`__MU_APP__.login(${JSON.stringify(account)}, ${JSON.stringify(password)})`);
  await client.waitFor(`__MU_APP__.state().screen === 'charselect'`, 40000, `${client.label} 角色列表`);
  const names = JSON.parse(await client.ev('JSON.stringify(__MU_APP__.charNames())'));
  if (!names.length) throw new Error(`${client.label}: 账号 ${account} 没有角色`);
  await client.ev(`__MU_APP__.select(${JSON.stringify(names[0])})`);
  await client.waitFor(`__MU_APP__.state().screen === 'game'`, 120000, `${client.label} 进图`);
  const st = JSON.parse(await client.ev('JSON.stringify(__MU_APP__.state())'));
  return { name: names[0], mapId: st.mapId, player: st.player };
}
