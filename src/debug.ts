/**
 * 自动化验证接口（无头浏览器里通过 __MU__ 调用）。
 * 提供：像素采样、角色蒙皮后包围盒、场景统计。
 */
import * as THREE from 'three';
import type { Actor } from './world/actor';
import type { TerrainMesh } from './world/terrain';
import { applyActionFrame } from './core/model';

export function installDebugApi(params: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  terrain: TerrainMesh;
  player: Actor;
  monsters: Actor[];
  objects: { group: THREE.Group; stats: any };
}) {
  const { renderer, scene, camera, terrain, player, monsters, objects } = params;

  function readPixel(x: number, y: number) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const ratio = renderer.getPixelRatio();
    const px = Math.round(x * ratio);
    const py = Math.round((window.innerHeight - y) * ratio);
    const buf = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return [buf[0], buf[1], buf[2]];
  }

  /** 采样一组屏幕坐标（CSS 像素） */
  function probePixels(points: { x: number; y: number }[]) {
    renderer.render(scene, camera);
    return points.map(p => ({ ...p, rgb: readPixel(p.x, p.y) }));
  }

  /** 把世界坐标投影到屏幕（CSS 像素） */
  function project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return {
      x: ((v.x + 1) / 2) * window.innerWidth,
      y: ((1 - v.y) / 2) * window.innerHeight,
      inFront: v.z < 1,
    };
  }

  /** 蒙皮后的真实包围盒（用骨骼矩阵变换顶点，最多采样 step 个点） */
  function skinnedBounds(actor: Actor, step = 7) {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();

    actor.rig.root.updateMatrixWorld(true);
    const bones = actor.rig.bones;

    for (const mesh of actor.meshes) {
      const pos = mesh.geometry.getAttribute('position');
      const skinIndex = mesh.geometry.getAttribute('skinIndex');
      if (!skinIndex) continue;

      for (let i = 0; i < pos.count; i += step) {
        const boneIndex = skinIndex.getX(i);
        const bone = bones[boneIndex];
        if (!bone) continue;
        m.copy(bone.matrixWorld);
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
        min.min(v);
        max.max(v);
      }
    }

    return {
      min: min.toArray().map(n => +n.toFixed(3)),
      max: max.toArray().map(n => +n.toFixed(3)),
      size: [
        +(max.x - min.x).toFixed(3),
        +(max.y - min.y).toFixed(3),
        +(max.z - min.z).toFixed(3),
      ],
    };
  }

  function terrainRaycast(x: number, y: number) {
    const ray = new THREE.Raycaster(
      new THREE.Vector3(x, y, 50),
      new THREE.Vector3(0, 0, -1)
    );
    const hits = ray.intersectObject(terrain.mesh, false);
    return hits.length
      ? { hit: true, z: +hits[0].point.z.toFixed(3), meshHeight: +terrain.getHeight(x, y).toFixed(3) }
      : { hit: false };
  }

  /**
   * 地形/水面统计。
   *
   * 高度是 `EncTerrain*.att` 的 byte × 1.5/100（0..3.825，1 格 = 1 世界单位），
   * 水面判定沿用原版 `TerrainTile_Render` 的口径：**四角高度都 <= 水面高度**。
   * 原版的 `DAT_00552580`（水位）是 0，而高度是无符号 byte 乘 1.5，
   * 所以「水位 0」等价于「这一格的高度字节是 0」。
   */
  function terrainInfo() {
    const h = terrain.data.height;
    const at = terrain.data.attribute;
    const l1 = terrain.data.layer1;
    const l2 = terrain.data.layer2;
    const wl = terrain.waterLevel;
    let hmin = Infinity;
    let hmax = -Infinity;
    let zero = 0;
    let attrWater = 0;
    let l1Water = 0;
    let l2Water = 0;
    let l1WaterH = { min: Infinity, max: -Infinity, sum: 0, n: 0 };
    let quads = 0;
    const hist = new Array(12).fill(0);
    const attrHist: Record<string, number> = {};
    const l2Alpha: Record<string, number> = {};
    for (let y = 1; y < 255; y++) {
      for (let x = 1; x < 255; x++) {
        const i = y * 256 + x;
        const v = h[i];
        if (v < hmin) hmin = v;
        if (v > hmax) hmax = v;
        if (v <= wl + 1e-4) zero++;
        if (at[i] & 0x10) attrWater++;
        attrHist[at[i]] = (attrHist[at[i]] ?? 0) + 1;
        if (l1[i] === 5) {
          l1Water++;
          const s = l1WaterH;
          s.min = Math.min(s.min, v);
          s.max = Math.max(s.max, v);
          s.sum += v;
          s.n++;
        }
        if (l2[i] === 5) {
          l2Water++;
          const a = terrain.data.alpha[i];
          const b = a < 32 ? 'a0_31' : a < 96 ? 'a32_95' : a < 200 ? 'a96_199' : 'a200_255';
          l2Alpha[b] = (l2Alpha[b] ?? 0) + 1;
        }
        hist[Math.min(11, Math.floor(v / 0.35))]++;
        if (terrain.isWaterCell(x, y)) quads++;
      }
    }
    // 属性值只留出现次数最多的几个，避免把 65536 种组合全倒出来
    const topAttr = Object.entries(attrHist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, n]) => `${k}×${n}`);
    return {
      lightStats: terrain.lightStats,
      lightLift: terrain.lightLift,
      waterLevel: wl,
      heightMin: +hmin.toFixed(4),
      heightMax: +hmax.toFixed(4),
      zeroCells: zero,
      attrWaterCells: attrWater,
      l1WaterCells: l1Water,
      l2WaterCells: l2Water,
      l2WaterAlpha: l2Alpha,
      l1WaterHeight: l1WaterH.n
        ? {
            min: +l1WaterH.min.toFixed(3),
            max: +l1WaterH.max.toFixed(3),
            avg: +(l1WaterH.sum / l1WaterH.n).toFixed(3),
          }
        : null,
      waterQuads: quads,
      topAttr,
      hist,
    };
  }

  /**
   * 按**贴图名**找物件材质（验证混合模式用）。
   *
   *   `__MU_DEBUG__.objectMaterial('38')`   → 诺利亚蝴蝶那几张
   *
   * 物件是静态合并的（一个材质一个 mesh，里面装了几百个实例），所以只能
   * 从材质反查，不能按实例找。贴图名就是 bmd 里写的那个路径。
   */
  function objectMaterial(needle: string) {
    const n = needle.toLowerCase();
    const out = new Map<string, Record<string, unknown>>();
    objects.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const m = mat as THREE.MeshBasicMaterial;
        const texName = m.map?.name ?? '';
        if (!texName || !texName.toLowerCase().includes(n)) continue;
        const key = `${texName}|${m.blending}`;
        const hit = out.get(key);
        if (hit) {
          hit.meshes = (hit.meshes as number) + 1;
          continue;
        }
        out.set(key, {
          texture: texName,
          blending: m.blending,
          blendSrc: m.blendSrc,
          blendDst: m.blendDst,
          transparent: m.transparent,
          depthWrite: m.depthWrite,
          fog: m.fog,
          opacity: m.opacity,
          color: m.color?.getHexString(),
          meshes: 1,
        });
      }
    });
    return [...out.values()];
  }

  /**
   * 场景里还剩几个「地面圆形光斑」（`fx:glow:` 前缀的 mesh）。
   *
   * 原版没有这种东西（是 `AddTerrainLight` 提亮地形顶点），
   * 所以正常情况下应该恒为 0 —— 探针用它守回归。
   */
  function glowCount() {
    let n = 0;
    scene.traverse(o => {
      if (o.name && o.name.startsWith('fx:glow')) n++;
    });
    return n;
  }

  /**
   * 按贴图名扫**整个场景**的材质（物件 + 怪 + NPC + 玩家 + 装备 + 地面物品）。
   *
   *   `__MU_DEBUG__.sceneMaterial('armor')`
   *
   * 用来核对「自动混合判定」有没有误伤：实体贴图必须是 `blending=1`（Normal）。
   */
  function sceneMaterial(needle: string) {
    const n = needle.toLowerCase();
    const out = new Map<string, Record<string, unknown>>();
    scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const m = mat as THREE.MeshBasicMaterial;
        const texName = m.map?.name ?? '';
        if (!texName || (n && !texName.toLowerCase().includes(n))) continue;
        const key = `${texName}|${m.blending}`;
        const hit = out.get(key);
        if (hit) {
          hit.meshes = (hit.meshes as number) + 1;
          continue;
        }
        out.set(key, {
          texture: texName,
          blending: m.blending,
          transparent: m.transparent,
          depthWrite: m.depthWrite,
          fog: m.fog,
          color: m.color?.getHexString(),
          meshes: 1,
        });
      }
    });
    return [...out.values()];
  }

  /** 逐帧采样某个动作：用于验证动作索引语义（走路腿会摆动等） */
  function sampleAction(actionIndex: number) {
    const bmd = player.rig.bmd;
    const action = bmd.actions[actionIndex];
    if (!action) return null;

    const findBone = (re: RegExp) =>
      player.rig.bones.findIndex(b => re.test(b.name));

    const lFoot = findBone(/L Foot$/);
    const rFoot = findBone(/R Foot$/);
    const lHand = findBone(/L Hand$/);
    const rHand = findBone(/R Hand$/);

    const frames: any[] = [];
    const v = new THREE.Vector3();
    const dist = (a: number, b: number) => {
      if (a < 0 || b < 0) return -1;
      const pa = player.rig.bones[a].getWorldPosition(new THREE.Vector3());
      const pb = player.rig.bones[b].getWorldPosition(v);
      return +pa.distanceTo(pb).toFixed(3);
    };

    for (let f = 0; f < action.numKeys; f++) {
      applyActionFrame(player.rig, actionIndex, f);
      player.rig.root.updateMatrixWorld(true);
      const rootW = player.rig.bones[0].getWorldPosition(new THREE.Vector3());
      frames.push({
        f,
        root: [+(rootW.x - player.x).toFixed(3), +(rootW.y - player.y).toFixed(3), +(rootW.z).toFixed(3)],
        feet: dist(lFoot, rFoot),
        hands: dist(lHand, rHand),
        handZ: lHand >= 0 ? +player.rig.bones[lHand].getWorldPosition(new THREE.Vector3()).z.toFixed(2) : -1,
        lHandPos: lHand >= 0 ? (() => { const w = player.rig.bones[lHand].getWorldPosition(new THREE.Vector3()); return [+(w.x - player.x).toFixed(3), +(w.y - player.y).toFixed(3), +(w.z - player.z).toFixed(3)]; })() : null,
        footZ: lFoot >= 0 ? +player.rig.bones[lFoot].getWorldPosition(new THREE.Vector3()).z.toFixed(2) : -1,
      });
    }

    // 恢复待机
    applyActionFrame(player.rig, player.action, Math.floor(player.frame));
    return { actionIndex, keys: action.numKeys, frames };
  }

  /**
   * 用骨骼几何判定模型本地正面：脚踝 → 脚趾的方向就是朝前方向。
   * 返回平均后的本地单位向量（未计入 yaw 旋转）。
   */
  function forwardAxis() {
    const savedYaw = player.yaw;
    const savedAction = player.action;
    const savedFrame = player.frame;

    player.yaw = 0;
    player.root.position.set(0, 0, 0);
    player.root.rotation.set(0, 0, 0);
    applyActionFrame(player.rig, 1, 0);
    player.rig.root.updateMatrixWorld(true);

    const find = (re: RegExp) => player.rig.bones.findIndex(b => re.test(b.name));
    const pairs = [
      [find(/L Foot$/), find(/L Toe0$/)],
      [find(/R Foot$/), find(/R Toe0$/)],
    ];

    const acc = new THREE.Vector3();
    const info: any[] = [];
    for (const [a, b] of pairs) {
      if (a < 0 || b < 0) continue;
      const pa = player.rig.bones[a].getWorldPosition(new THREE.Vector3());
      const pb = player.rig.bones[b].getWorldPosition(new THREE.Vector3());
      const d = pb.clone().sub(pa);
      d.z = 0;
      const len = d.length();
      if (len > 1e-5) {
        acc.add(d.divideScalar(len));
        info.push({ from: player.rig.bones[a].name, dir: [+(d.x).toFixed(3), +(d.y).toFixed(3)], len: +len.toFixed(3) });
      }
    }

    applyActionFrame(player.rig, savedAction, Math.floor(savedFrame));
    player.yaw = savedYaw;

    const n = acc.length() > 1e-5 ? acc.normalize() : acc;
    return { forward: [+n.x.toFixed(3), +n.y.toFixed(3)], feet: info };
  }

  /**
   * 用走路动作判定正面：腾空中的那只脚在水平面上的移动方向 = 前进方向。
   */
  function walkForward(actionIndex = 15) {
    const savedYaw = player.yaw;
    const savedAction = player.action;
    const savedFrame = player.frame;

    player.yaw = 0;
    player.root.position.set(0, 0, 0);
    player.root.rotation.set(0, 0, 0);

    const find = (re: RegExp) => player.rig.bones.findIndex(b => re.test(b.name));
    const lf = find(/L Foot$/);
    const rf = find(/R Foot$/);

    const keys = player.rig.bmd.actions[actionIndex].numKeys;
    const samples: { l: THREE.Vector3; r: THREE.Vector3 }[] = [];
    for (let f = 0; f < keys; f++) {
      applyActionFrame(player.rig, actionIndex, f);
      player.rig.root.updateMatrixWorld(true);
      samples.push({
        l: player.rig.bones[lf].getWorldPosition(new THREE.Vector3()),
        r: player.rig.bones[rf].getWorldPosition(new THREE.Vector3()),
      });
    }

    const acc = new THREE.Vector3();
    const steps: any[] = [];
    for (let f = 0; f < samples.length - 1; f++) {
      const a = samples[f];
      const b = samples[f + 1];
      const liftedIsL = a.l.z > a.r.z;
      const from = liftedIsL ? a.l : a.r;
      const to = liftedIsL ? b.l : b.r;
      const d = new THREE.Vector3(to.x - from.x, to.y - from.y, 0);
      const len = d.length();
      const lift = liftedIsL ? a.l.z - a.r.z : a.r.z - a.l.z;
      if (len > 0.01 && lift > 0.005) {
        acc.add(d.clone().divideScalar(len));
        steps.push({ f, lifted: liftedIsL ? 'L' : 'R', dir: [+(d.x / len).toFixed(3), +(d.y / len).toFixed(3)], len: +len.toFixed(3), lift: +lift.toFixed(3) });
      }
    }

    applyActionFrame(player.rig, savedAction, Math.floor(savedFrame));
    player.yaw = savedYaw;

    const n = acc.length() > 1e-5 ? acc.normalize() : acc;
    return { forward: [+n.x.toFixed(3), +n.y.toFixed(3)], steps };
  }

  /**
   * 朝向自检：把角色转到面向 (dx,dy)，播放攻击动作，
   * 返回手部相对「第 0 帧位置」的最大位移方向（应与朝向一致）。
   */
  function facingCheck(actionIndex = 37, dx = 1, dy = 0) {
    const savedYaw = player.yaw;
    const savedAction = player.action;
    const savedFrame = player.frame;

    player.yaw = Math.atan2(dy, dx) + Math.PI / 2; // 与 main.ts 的公式一致
    player.root.position.set(player.x, player.y, player.z);
    player.root.rotation.set(0, 0, player.yaw);

    const handIdx = (() => {
      const r = player.rig.bones.findIndex(b => /R Hand$/.test(b.name));
      return r >= 0 ? r : player.rig.bones.findIndex(b => /L Hand$/.test(b.name));
    })();

    const sample = (f: number) => {
      applyActionFrame(player.rig, actionIndex, f);
      player.rig.root.updateMatrixWorld(true);
      return player.rig.bones[handIdx].getWorldPosition(new THREE.Vector3());
    };

    const base = sample(0);
    let best = { f: 0, len: 0, dir: [0, 0] };
    for (let f = 0; f < player.rig.bmd.actions[actionIndex].numKeys; f++) {
      const w = sample(f);
      const off = new THREE.Vector3(w.x - base.x, w.y - base.y, 0);
      const len = off.length();
      if (len > best.len) {
        best = { f, len: +len.toFixed(3), dir: [+(off.x / len).toFixed(3), +(off.y / len).toFixed(3)] };
      }
    }

    applyActionFrame(player.rig, savedAction, Math.floor(savedFrame));
    player.yaw = savedYaw;
    return { handIdx, facing: [dx, dy], punchDir: best.dir, punchLen: best.len, frame: best.f };
  }

  const api = {
    walkForward,
    forwardAxis,
    facingCheck,
    sampleAction,
    probePixels,
    project,
    skinnedBounds: () => skinnedBounds(player),
    monsterCount: monsters.length,
    terrainRaycast,
    terrainInfo,
    objectMaterial,
    sceneMaterial,
    glowCount,
    stats() {
      const info = renderer.info;
      const mem = (performance as any).memory;
      return {
        heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        objects: objects.stats,
        camera: {
          pos: camera.position.toArray().map(n => +n.toFixed(2)),
          up: camera.up.toArray(),
        },
        player: {
          loopLen: [1, 15, 25, 37].map(a => ({ a, keys: player.rig.bmd.actions[a]?.numKeys, loop: player.rig.loopLen[a] })),
          pos: [player.x, player.y, player.z].map(n => +n.toFixed(2)),
          action: player.action,
          frame: +player.frame.toFixed(2),
          meshes: player.meshes.length,
          bones: player.rig.bones.length,
          actions: player.rig.bmd.actions.length,
        },
        terrainHeight: +terrain.getHeight(player.x, player.y).toFixed(3),
      };
    },
  };

  (window as any).__MU_DEBUG__ = api;
  return api;
}
