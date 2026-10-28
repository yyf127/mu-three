/**
 * MU 风格第三人称相机：固定俯角 + 可旋转的水平角，Z 轴朝上。
 */
import * as THREE from 'three';

export class MuCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3(0, 0, 0);
  private smoothTarget = new THREE.Vector3(0, 0, 0);

  /**
   * 参数取自 0.97 客户端 MoveMainCamera：
   *   FOV 35°，水平距离 1000（=10 格），相机高度 = 角色高度 + 850（=8.5 格）
   *   → 俯角约 40.4°，相机到角色距离 ≈ 13.1 格
   */
  yaw = -Math.PI * 0.25;
  pitch = Math.atan2(8.5, 10);
  distance = Math.hypot(10, 8.5);
  minDistance = 6;
  maxDistance = 24;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(36, aspect, 0.2, 700);
    this.camera.up.set(0, 0, 1);
  }

  setTarget(x: number, y: number, z: number) {
    this.target.set(x, y, z);
  }

  zoom(deltaY: number) {
    this.distance = THREE.MathUtils.clamp(
      this.distance + Math.sign(deltaY) * 0.9,
      this.minDistance,
      this.maxDistance
    );
  }

  rotate(dx: number, dy: number) {
    this.yaw -= dx * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, 0.45, 1.35);
  }

  update(dt: number) {
    // 跟随平滑
    const k = 1 - Math.pow(0.001, dt);
    this.smoothTarget.lerp(this.target, k);

    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.smoothTarget.x + Math.cos(this.yaw) * horizontal,
      this.smoothTarget.y + Math.sin(this.yaw) * horizontal,
      this.smoothTarget.z + Math.sin(this.pitch) * this.distance
    );
    this.camera.lookAt(
      this.smoothTarget.x,
      this.smoothTarget.y,
      this.smoothTarget.z + 0.6
    );
  }

  /** 相机在地面上的水平朝向（用于 WASD） */
  getForward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.cos(this.yaw), -Math.sin(this.yaw), 0).normalize();
  }

  getRight(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), Math.cos(this.yaw), 0).normalize();
  }
}

/** 屏幕坐标 → 地形上的落点（沿射线步进 + 二分细化） */
export function pickTerrainPoint(
  camera: THREE.Camera,
  ndcX: number,
  ndcY: number,
  getHeight: (x: number, y: number) => number
): THREE.Vector3 | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  const origin = ray.ray.origin;
  const dir = ray.ray.direction;

  let prevT = 0;
  let prevAbove = origin.z - getHeight(origin.x, origin.y);

  const MAX_T = 500;
  const STEP = 0.35;

  for (let t = STEP; t < MAX_T; t += STEP) {
    const px = origin.x + dir.x * t;
    const py = origin.y + dir.y * t;
    const pz = origin.z + dir.z * t;

    if (px < 0 || py < 0 || px > 255 || py > 255) {
      prevT = t;
      continue;
    }

    const above = pz - getHeight(px, py);

    if (above <= 0 && prevAbove > 0) {
      // 在 [prevT, t] 之间二分
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) * 0.5;
        const mx = origin.x + dir.x * mid;
        const my = origin.y + dir.y * mid;
        const mz = origin.z + dir.z * mid;
        if (mx < 0 || my < 0 || mx > 255 || my > 255) break;
        if (mz - getHeight(mx, my) > 0) lo = mid;
        else hi = mid;
      }
      const ft = (lo + hi) * 0.5;
      const x = origin.x + dir.x * ft;
      const y = origin.y + dir.y * ft;
      return new THREE.Vector3(x, y, getHeight(x, y));
    }

    prevT = t;
    prevAbove = above;
  }

  return null;
}
