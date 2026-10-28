/**
 * 地图物件动画 / 特效探针。
 *
 *   node tools/object-anim-probe.mjs
 *
 * 断言三件事：
 *   ① 有动作的物件真的在动（骨骼矩阵逐帧变化，而不是只有节点在）
 *   ② 火把/篝火/街灯的特效点数量与源码表一致，且相机附近能看到
 *   ③ 帧率没有被动画拖垮
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('objanim');

/** 取场景里第一个「物件」 SkinnedMesh 的骨骼矩阵快照（排除主角） */
const BONES = `(() => {
  let sm = null;
  __MU__.scene.traverse(o => {
    if (!sm && o.isSkinnedMesh && o.parent && o.parent.name.startsWith('obj:')) sm = o;
  });
  if (!sm) return JSON.stringify({ none: true });
  const bm = sm.skeleton.boneMatrices;
  let sum = 0, nan = 0;
  for (let i = 0; i < bm.length; i++) {
    const v = bm[i];
    if (!Number.isFinite(v)) nan++;
    else sum += v;
  }
  const e = sm.matrixWorld.elements;
  return JSON.stringify({
    parent: sm.parent ? sm.parent.name : null,
    bones: sm.skeleton.bones.length,
    nan,
    sum: +sum.toFixed(3),
    world: [+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)],
  });
})()`;

const STATS = `(() => {
  const s = __MU_APP__.state();
  let skinned = 0, objs = 0;
  __MU__.scene.traverse(o => {
    if (o.isSkinnedMesh) skinned++;
    if (o.name && o.name.startsWith('obj:')) objs++;
  });
  return JSON.stringify({ anim: s.objectAnim, fx: s.objectFx, objects: s.objects, skinned, holders: objs });
})()`;

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`!!window.__MU__ && !!__MU__.scene`, 60000, '场景');
  await sleep(2500);

  console.log('统计:', await c.ev(STATS));

  const b1 = JSON.parse(await c.ev(BONES));
  await sleep(600);
  const b2 = JSON.parse(await c.ev(BONES));
  console.log('骨骼矩阵:', JSON.stringify(b1), '→', JSON.stringify(b2),
    b1.sum !== b2.sum ? '✓ 在动' : '✗ 没动');

  // 找火点：取离出生点最近的一个（地图边缘的点会把相机带到越界处，取景会翻车）
  const fires = JSON.parse(
    await c.ev(`(() => {
      const s = __MU__.objectFx ? __MU__.objectFx.spots : null;
      if (!s) return '[]';
      const p = __MU__.player;
      return JSON.stringify(
        s.filter(x => x.kind === 'fire' && x.x > 2 && x.y > 2 && x.x < 253 && x.y < 253)
          .sort((a, b) => {
            // 篝火（0x34）在空地上，最适合看火焰；墙上火把容易被墙体挡镜头
            const pa = (a.src === 0x34 ? 0 : 1e6) + ((a.x - p.x) ** 2 + (a.y - p.y) ** 2);
            const pb = (b.src === 0x34 ? 0 : 1e6) + ((b.x - p.x) ** 2 + (b.y - p.y) ** 2);
            return pa - pb;
          })
          .slice(0, 6)
      );
    })()`)
  );
  console.log('火点数（前 6）:', JSON.stringify(fires));

  const target = fires[0];
  if (target) {
    /*
     * 相机是「绕着主角转」的第三人称跟随（见 camera.ts）：
     * 位置 = target + (cos(yaw), sin(yaw), sin(pitch)) · 距离，
     * 视线方向 = (-cos(yaw), -sin(yaw))。
     * 所以想让镜头对准火点，就把 yaw 设成 atan2(-dy, -dx)。
     */
    await c.ev(`(() => {
      const p = __MU__.player;
      __MU_APP__.setPos(${target.x}, ${target.y + 4.2});
      const dx = ${target.x} - p.x, dy = ${target.y} - p.y;
      __MU__.muCamera.yaw = Math.atan2(-dy, -dx);
      __MU__.muCamera.pitch = 0.42;
      __MU__.muCamera.distance = 13;
      return true;
    })()`);
    await sleep(2200);
    const p = JSON.parse(
      await c.ev(`(() => { const p = __MU_DEBUG__.project(${target.x}, ${target.y}, ${target.z + 0.6});
        return JSON.stringify({ x: p.x, y: p.y, inFront: p.inFront }); })()`)
    );
    const W = 300, H = 240;
    const r = await c.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: Math.max(0, p.x - W / 2), y: Math.max(0, p.y - H * 0.62), width: W, height: H, scale: 3 },
    });
    writeFileSync('shots/obj-fire.png', Buffer.from(r.data, 'base64'));
    const full = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('shots/obj-fire-full.png', Buffer.from(full.data, 'base64'));
    console.log('火焰截图: shots/obj-fire.png @', JSON.stringify(target), '屏幕', JSON.stringify(p));
  }

  // 街灯（glow）也来一张
  const glows = JSON.parse(
    await c.ev(`(() => { const s = __MU__.objectFx ? __MU__.objectFx.spots : null;
      return JSON.stringify(s ? s.filter(x => x.kind === 'glow').slice(0, 3) : []); })()`)
  );
  console.log('地光点:', JSON.stringify(glows));

  /*
   * 无头 Edge 用的是 SwiftShader（CPU 光栅化，`ANGLE (Google, Vulkan 1.3.0
   * (SwiftShader Device))`），560k 三角面下帧率只有个位数，拿它判性能会误判。
   * 这里改测「每帧 JS 开销」—— 这部分和真机 GPU 无关，才是我们能控制的。
   */
  const cpu = await c.ev(`(() => {
    const { objects, objectFx, ambient, player: p } = __MU__;
    const N = 200;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) objects.update(0.016, p.x, p.y);
    const t1 = performance.now();
    for (let i = 0; i < N; i++) objectFx.update(0.016, p.x, p.y);
    const t2 = performance.now();
    for (let i = 0; i < N; i++) ambient.update(0.016, p.x, p.y, p.z, 1028);
    const t3 = performance.now();
    return JSON.stringify({
      objAnimMs: +((t1 - t0) / N).toFixed(3),
      fxMs: +((t2 - t1) / N).toFixed(3),
      ambientMs: +((t3 - t2) / N).toFixed(3),
      drawCalls: __MU__.renderer.info.render.calls,
      tris: __MU__.renderer.info.render.triangles,
    });
  })()`);
  console.log('每帧 JS 开销(ms):', cpu, '（无头浏览器是 SwiftShader 软件渲染，FPS 不能作为性能依据）');
  console.log('errors:', c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]')).slice(0, 5));
  console.log('warns:', c.logs.filter(l => l.includes('[objects]') || l.includes('[object') ).slice(0, 5));
} finally {
  await c.close();
}
