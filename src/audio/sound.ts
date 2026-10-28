/**
 * 声音系统 —— WebAudio 版 `Sound_DS3D.cpp` + `Music.cpp`。
 *
 * 原版是 DirectSound8：
 *   音效  `PlayBuffer(id, owner, looped)`，走 `g_lpDSBuffer[420][4]`
 *         （`LoadWaveFile` 预载，`Enable3DSound` 的按 owner 坐标做 3D 衰减）
 *   BGM   `PlayMp3(name)` → 另起 `MuPlayer.exe` 播 mp3，切歌靠 `WM_CLOSE`
 *
 * 这里对应用 AudioContext + HTMLAudioElement：
 *   - **音效**：`fetch` → `decodeAudioData` → `AudioBufferSourceNode`。
 *     每个 id 有 `channels` 个并发上限（= `MaxBufferChannel`），超了就丢掉这一次，
 *     和原版「通道被占就不再开新的」一致。
 *   - **方位**：`setListener()` 每帧更新相机位置/朝向，
 *     `sfx(id, {x,y})` 按距离算增益、按左右算 pan（近似 `Sound_Update3DPositions`）。
 *   - **环境循环**：`aWind/aForest/...` 是 `looped=true` 的长音，切图时换。
 *   - **BGM**：mp3 太大不做 decode，直接 `<audio loop>`；切歌时淡出旧轨。
 *
 * 浏览器自动播放策略：AudioContext 必须在**用户手势**里创建/resume。
 * 调用方在登录按钮点击时调 `unlockAudio()`（`initAudio` 也可）。
 *
 * 静音开关存 `localStorage`（原版是注册表 `MusicOnOff`，默认 0 = 关；
 * 这里反过来默认**开**，因为网页端没有「选项菜单」可以打开它）。
 */

import { assetUrl } from '../core/base';
import {
  AMBIENT_BY_MAP,
  BGM_BY_MAP,
  BGM_LOGIN,
  MUSIC_DIR,
  SOUND_BY_ID,
  SOUND_DIR,
} from '../data/sounds';

/** 主音量分段（原版没有混音台，这里是拍出来的听感比例） */
const VOL = {
  sfx: 0.55,
  ambient: 0.2,
  bgm: 0.3,
};

/** 3D 衰减：24 格之内听得见，2 格内满音量（原版 DS3D 是 700/3000 单位） */
const NEAR = 2;
const FAR = 24;

interface Playing {
  src: AudioBufferSourceNode;
  at: number;
}

/** `<audio>` 播 BGM：单独一条，不走 WebAudio 图（mp3 太大的话 decode 太贵） */
let musicEl: HTMLAudioElement | null = null;
let musicFile: string | null = null;
/** 已加载的音频缓冲（按文件缓存） */
const buffers = new Map<string, Promise<AudioBuffer | null>>();
/** 每个 id 正在响的实例（对应原版 4 个通道） */
const active = new Map<number, Playing[]>();
/** 已占用但还在解码的槽位（防止同一 tick 连发 5 声都通过通道检查） */
const pending = new Map<number, number>();

let ctx: AudioContext | null = null;
/**
 * 解码专用上下文。
 *
 * `decodeAudioData` 在 **suspended** 的 AudioContext 上有可能一直不 resolve
 * （headless / 没有用户手势时就是 suspended —— 探针里实测 `played` 一直是 0，
 * `failed` 也是 0，就是这个原因）。`OfflineAudioContext` 永远不会 suspended，
 * 解出来的 `AudioBuffer` 可以直接给实时上下文用，所以统一走它解码。
 */
let decodeCtx: OfflineAudioContext | null = null;

function decoder(): BaseAudioContext | null {
  // 永远优先离线上下文（实时上下文可能是 suspended）
  try {
    if (!decodeCtx) decodeCtx = new OfflineAudioContext(1, 1, 44100);
    return decodeCtx;
  } catch {
    return ctx;
  }
}
let sfxBus: GainNode | null = null;
let ambientBus: GainNode | null = null;
let ambientSrc: AudioBufferSourceNode | null = null;
let ambientGain: GainNode | null = null;
let ambientId = -1;
let muted = false;
let unlocked = false;

const debugState = {
  /** 成功播放次数 */
  played: 0,
  /** 因为通道占满 / 静音 / 未解锁而丢掉的次数 */
  dropped: 0,
  /** 缓冲加载失败次数 */
  failed: 0,
  /** 最近一次播放的 id */
  lastId: -1,
  /** 已解码的缓冲数 */
  buffers: 0,
  /** 走了 `Range: bytes=0-` 兜底的次数（环境代理把普通 GET 变成 204 时会涨） */
  ranged: 0,
};

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

function readMuted(): boolean {
  try {
    return localStorage.getItem('mu.muted') === '1';
  } catch {
    return false;
  }
}
muted = readMuted();

function persistMuted() {
  try {
    localStorage.setItem('mu.muted', muted ? '1' : '0');
  } catch {
    /* 隐私模式写不进去，忽略 */
  }
}

/**
 * 创建/恢复 AudioContext。必须在用户手势里调用一次（登录按钮点击）。
 * 重复调用是安全的。
 */
export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    unlocked = true;
    return;
  }
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    sfxBus = ctx.createGain();
    sfxBus.gain.value = muted ? 0 : VOL.sfx;
    sfxBus.connect(ctx.destination);
    ambientBus = ctx.createGain();
    ambientBus.gain.value = muted ? 0 : VOL.ambient;
    ambientBus.connect(ctx.destination);
    void ctx.resume();
    unlocked = true;
  } catch {
    ctx = null;
  }
}

export function audioReady() {
  return !!ctx && unlocked && !muted;
}

/* ------------------------------------------------------------------ */
/* 缓冲加载                                                            */
/* ------------------------------------------------------------------ */

/** 取一段字节；`range` 给 `bytes=0-` 时走 206 全量（见下面那个 204 的坑） */
async function fetchBytes(rawUrl: string, opt: { range?: string } = {}): Promise<ArrayBuffer> {
  const res = await fetch(assetUrl(rawUrl), opt.range ? { headers: { range: opt.range } } : undefined);
  // 204 = 「没内容」，此时也走兜底
  if (res.status === 204) return new ArrayBuffer(0);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

function loadBuffer(file: string): Promise<AudioBuffer | null> {
  const hit = buffers.get(file);
  if (hit) return hit;
  const task = (async () => {
    const dc = decoder();
    if (!dc) return null;
    try {
      // 文件名里有括号（pWalk(Grass).wav），统一编码一次
      const url = `/${SOUND_DIR}${encodeURIComponent(file)}`;
      let raw = await fetchBytes(url);
      /*
       * 有的本地代理/网关对**音频 MIME 的普通 GET** 会回 `204 No Content`
       * （本机环境实测：curl 直连 200，浏览器里却是 204，`.ozj` / `.bmd` 都正常）。
       * 加一个 `Range: bytes=0-` 就变成 206 + 完整字节，所以这里做一次兜底重试 ——
       * 不影响正常环境（只有拿到空 body 才会重试）。
       */
      if (raw.byteLength === 0) {
        raw = await fetchBytes(url, { range: 'bytes=0-' });
        if (raw.byteLength) debugState.ranged++;
      }
      if (raw.byteLength === 0) throw new Error('empty body');
      const buf = await dc.decodeAudioData(raw);
      debugState.buffers++;
      return buf;
    } catch {
      debugState.failed++;
      return null;
    }
  })();
  buffers.set(file, task);
  return task;
}

/** 预载一组 id（进图前把环境音/常用音效拉好，避免第一声有延迟） */
export async function preloadSounds(ids: number[]) {
  await Promise.all(
    ids.map(id => {
      const def = SOUND_BY_ID.get(id);
      return def ? loadBuffer(def.file) : Promise.resolve(null);
    })
  );
}

/* ------------------------------------------------------------------ */
/* 听者（相机）                                                        */
/* ------------------------------------------------------------------ */

const listener = { x: 0, y: 0, yaw: 0, on: false };

/** 每帧喂一次相机位置与朝向（`Sound_Update3DPositions`） */
export function setListener(x: number, y: number, yaw: number) {
  listener.x = x;
  listener.y = y;
  listener.yaw = yaw;
  listener.on = true;
}

/* ------------------------------------------------------------------ */
/* 音效                                                                */
/* ------------------------------------------------------------------ */

export interface SfxOptions {
  /** 世界坐标（格）。不传 = 2D（自己身上/界面），满音量居中 */
  x?: number;
  y?: number;
  /** 额外增益（0..1，默认 1） */
  volume?: number;
  /** 播放速率（1 = 原速） */
  rate?: number;
  /** 允许超过并发上限（用于「必须听见」的，比如自己挨打） */
  force?: boolean;
}

/**
 * 播一个音效。返回 false 表示没响（静音 / 通道满 / 缓冲还没好）。
 *
 * `id` 就是 `PlayBuffer(id)`，表见 `src/data/sounds.ts`。
 */
export function sfx(id: number, opt: SfxOptions = {}): boolean {
  if (!audioReady() || !ctx || !sfxBus) {
    debugState.dropped++;
    return false;
  }
  const def = SOUND_BY_ID.get(id);
  if (!def) {
    debugState.dropped++;
    return false;
  }

  /*
   * 通道上限：原版 4 个通道，这里按表里的 channels 算；解码中的也算占位。
   *
   * 计时用 `performance.now()` 而不是 `ctx.currentTime` ——
   * AudioContext 被挂起（无手势/headless）时 `currentTime` 是**冻结**的，
   * 拿它算「这条还在响吗」会让通道永远不释放，第二次就再也发不出声。
   */
  const list = active.get(id) ?? [];
  const now = performance.now() / 1000;
  const alive = list.filter(p => now - p.at < 2.5);
  const busy = alive.length + (pending.get(id) ?? 0);
  if (!opt.force && busy >= def.channels) {
    debugState.dropped++;
    return false;
  }
  pending.set(id, (pending.get(id) ?? 0) + 1);

  const bufTask = loadBuffer(def.file);
  void bufTask.then(buf => {
    pending.set(id, Math.max(0, (pending.get(id) ?? 1) - 1));
    if (!buf || !ctx || !sfxBus) return;

    /* 距离/方位（只有 3D 音才做，界面上那几声固定居中） */
    let gain = 1;
    let pan = 0;
    if (def.pos3d && listener.on && opt.x !== undefined && opt.y !== undefined) {
      const dx = opt.x - listener.x;
      const dy = opt.y - listener.y;
      const d = Math.hypot(dx, dy);
      if (d >= FAR) return;
      gain = Math.max(0, Math.min(1, (FAR - d) / (FAR - NEAR))) ** 1.5;
      /*
       * 听者右向量：世界是 Z-up，朝向 (cosθ, sinθ) 时
       *   right = forward × up = (sinθ, -cosθ)
       * 于是「声音在右边」= dot(delta, right) > 0。
       */
      const c = Math.cos(listener.yaw);
      const sn = Math.sin(listener.yaw);
      const right = dx * sn - dy * c;
      pan = d > 0.01 ? Math.max(-1, Math.min(1, (right / d) * 0.8)) : 0;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opt.rate ?? 1;

    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, gain)) * (opt.volume ?? 1);
    src.connect(g);

    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(sfxBus!);
    } else {
      g.connect(sfxBus!);
    }

    src.start();
    src.onended = () => {
      const arr = (active.get(id) ?? []).filter(q => q.src !== src);
      if (arr.length) active.set(id, arr);
      else active.delete(id);
    };
    debugState.played++;
    debugState.lastId = id;
    const t = performance.now() / 1000;
    const arr = (active.get(id) ?? []).filter(q => t - q.at < 2.5);
    arr.push({ src, at: t });
    active.set(id, arr);
  });

  return true;
}

/** 一组里随机取一个（原版大量用 `rand()%n` 选变体） */
export function sfxRandom(ids: number[], opt: SfxOptions = {}): boolean {
  if (!ids.length) return false;
  return sfx(ids[Math.floor(Math.random() * ids.length)], opt);
}

/* ------------------------------------------------------------------ */
/* 环境循环音                                                          */
/* ------------------------------------------------------------------ */

/** 停掉当前环境循环（切图用），`fade` 秒淡出 */
export function stopAmbient(fade = 0.25) {
  if (!ctx) return;
  const src = ambientSrc;
  const g = ambientGain;
  ambientSrc = null;
  ambientGain = null;
  ambientId = -1;
  if (!src) return;
  try {
    if (g) {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
    }
    src.stop(ctx.currentTime + fade + 0.02);
  } catch {
    /* 已经停了 */
  }
}

/**
 * 按地图号起环境循环音（`AMBIENT_BY_MAP`）。
 *
 * 原版在 `Game_MainLoop` 的 BGM 状态机里 `PlayBuffer(x, 0, 1)` 长放，
 * 切图时把不相干的 `Sound_StopBuffer` 掉。
 */
export function setAmbientForMap(mapId: number) {
  if (!audioReady() || !ctx || !ambientBus) return;
  const id = AMBIENT_BY_MAP[mapId] ?? 0x00;
  if (id === ambientId && ambientSrc) return;
  stopAmbient();

  const def = SOUND_BY_ID.get(id);
  if (!def) return;
  void loadBuffer(def.file).then(buf => {
    if (!buf || !ctx || !ambientBus || muted) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 1;
    src.connect(g);
    g.connect(ambientBus);
    src.start();
    ambientSrc = src;
    ambientGain = g;
    ambientId = id;
  });
}

/* ------------------------------------------------------------------ */
/* BGM                                                                 */
/* ------------------------------------------------------------------ */

function ensureMusicEl(): HTMLAudioElement {
  if (!musicEl) {
    musicEl = new Audio();
    musicEl.loop = true;
    musicEl.preload = 'auto';
    musicEl.volume = muted ? 0 : VOL.bgm;
  }
  return musicEl;
}

/**
 * 切 BGM。传 `null` 停。
 *
 * 文件名对应 `Data/Music/*.mp3`，表见 `BGM_BY_MAP` / `BGM_LOGIN`。
 */
export function playBgm(file: string | null) {
  if (file === musicFile) {
    // 同一首：只在被静音过之后恢复音量，不重头播
    if (musicEl) musicEl.volume = muted ? 0 : VOL.bgm;
    return;
  }
  const el = ensureMusicEl();
  musicFile = file;
  if (!file) {
    el.pause();
    return;
  }
  el.src = assetUrl(`${MUSIC_DIR}${encodeURIComponent(file)}`);
  el.volume = muted ? 0 : VOL.bgm;
  const p = el.play();
  // 自动播放被拒是正常的（还没解锁），解锁后由 `setAmbientForMap`/`playBgm` 重试
  if (p && typeof p.catch === 'function') p.catch(() => undefined);
}

/** 进图/切图：BGM + 环境音一起切 */
export function setSceneAudio(mapId: number | null) {
  if (mapId === null) {
    playBgm(BGM_LOGIN);
    stopAmbient();
    return;
  }
  const bgm = BGM_BY_MAP[mapId] ?? null;
  playBgm(bgm);
  setAmbientForMap(mapId);
}

/* ------------------------------------------------------------------ */
/* 开关                                                                */
/* ------------------------------------------------------------------ */

export function isMuted() {
  return muted;
}

export function setMuted(on: boolean) {
  muted = on;
  persistMuted();
  if (sfxBus) sfxBus.gain.value = on ? 0 : VOL.sfx;
  if (ambientBus) ambientBus.gain.value = on ? 0 : VOL.ambient;
  if (musicEl) musicEl.volume = on ? 0 : VOL.bgm;
  if (!on) {
    // 取消静音时把 BGM 续上（可能之前被 pause 或被策略挡了）
    if (musicFile && musicEl) {
      const p = musicEl.play();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    }
  }
  return muted;
}

export function toggleMuted() {
  return setMuted(!muted);
}

/* ------------------------------------------------------------------ */
/* 调试                                                                */
/* ------------------------------------------------------------------ */

export function audioDebug() {
  return {
    ...debugState,
    muted,
    unlocked,
    contextState: ctx?.state ?? 'none',
    ambient: ambientId,
    bgm: musicFile,
    active: Object.fromEntries([...active.entries()].map(([id, l]) => [id, l.length])),
  };
}

/** 探针用：把 `debugState` 计数清零 */
export function resetAudioDebug() {
  debugState.played = 0;
  debugState.dropped = 0;
  debugState.failed = 0;
  debugState.ranged = 0;
  debugState.lastId = -1;
}
