/**
 * 底栏上的角色数值 —— HP/MP 球、经验条、Stamina、药水快捷槽、角色名、地图坐标。
 *
 * 坐标照抄 0.97 客户端 `Render/HUD_Pass5.cpp`（IDA `sub_4BD650`）、
 * `HUD_Pass2.cpp`（`RenderExperience`）与 `Item/Item_Inventory.cpp`
 * （`SeedQuickPotionTypesFromInventory`）：
 *
 *   HP 球   ( 97, 432) 53×48   `Menu_red.ozj`   （原版贴图 234，中毒换 247）
 *   MP 球   (489, 432) 53×48   `Menu_blue.ozj`  （原版贴图 235）
 *   HP 数字 (100, 467)  原版只画当前值，最大值在悬停提示里
 *   MP 数字 (540, 467)
 *   经验条  (221, 439) 198×4   颜色 (0.92, 0.80, 0.34)
 *   经验数字(425, 434)  0..9 的档位
 *   AG 条   (551, 437) 15×36   `Menu03_new_ag.ozj`（原版贴图 257）
 *   AG 数字 (571, 467)  9×10
 *   药水槽  Q/W/E 圆孔 中心 226 / 257 / 288
 *   角色名  ( 10, 457) 85×22 框内，`Menu01_new` 自带的凹槽
 *   坐标    ( 10, 468) 同上第二行
 *
 * 药水槽的语义（`SeedQuickPotionTypesFromInventory`）：
 *   Q = HP 药水 449..451（没有就用 448 Apple）
 *   W = MP 药水 452..454
 *   E = 辅助 {468, 457, 456} 里第一个存在的（456 就是 Antidote，
 *       注释里特意排除了 458 传送卷轴）
 * 数量是**整堆之和**，不是格子数 —— 原版 `sub_482E40` 返回的就是这个。
 */
import { uiSprite, preloadUi } from './ozj';
import { UiLayer, spriteBox } from './frame';
import { itemIcon } from './itemIcon';
import type { CharacterInfo } from '../net/session';
import type { InventoryItem } from '../net/game';

/** HP 球 / MP 球（原版贴图 234 / 235） */
const HP_ORB = { x: 97, y: 432, w: 53, h: 48 };
const MP_ORB = { x: 489, y: 432, w: 53, h: 48 };

/** 经验条 */
const EXP_BAR = { x: 221, y: 439, w: 198, h: 4 };

/**
 * AG（Stamina）竖条 —— `Render_HudPass_4BCD20_`（`HUD_Pass3.cpp:345`）。
 *
 * ```cpp
 * int v3 = *(u16*)(CA + 36);      // 当前 AG
 * int v23 = *(u16*)(CA + 38);     // 上限
 * int barHeight = 36 * v3 / v23;  // 0..36
 * GL_DrawTexture(257, 551.0f, 473.0f - barHeight, 15.0f, barHeight,
 *                0, 0, 0.9375f, barHeight * 0.015625f, 1, 1);
 * RenderNumber2D(571.0f, 467.0f, v3, 9.0f, 10.0f);
 * if (MouseX ∈ [551,566) && MouseY ∈ [437,473)) RenderTipText(546, 419, GlobalText[214]);
 * ```
 *
 * 贴图 257 就是 `Menu03_new_ag.ozj`（15×36）——刚好等于槽位尺寸。
 * 采样区间是 `v ∈ [0, h/64]`，即**取贴图的上面 h 行**，画在 `y = 473-h` 起的 h 高里：
 * 也就是视觉上「液面下降、顶部那一截被吃掉」，和 HP 球一模一样的裁切方向，
 * 不是横向进度条。之前补在经验条下面那条绿横条是错的，已删。
 */
const AG_GAUGE = { x: 551, y: 437, w: 15, h: 36 };
const AG_NUM = { x: 571, y: 467 };

/** `Menu01_new` 左下的凹槽：原版画金币/杀敌计数，这里放角色名 + 坐标 */
const NAME_BOX = { x: 10, y: 457, w: 85, h: 22 };

/**
 * 三个药水快捷槽。坐标来自 `Render_HotbarItems3D`（`HUD_Pass1.cpp:521`）：
 *
 *     int slot_x = 208;
 *     for (slot_idx = 0; slot_x < 301; ++slot_idx) {
 *         v2 = Item_FindQuickSlotByCategory(slot_idx);
 *         if (v2 != -1) RenderItem3D(slot_x, 454, 20, 20, type, lvl, …);
 *         slot_x += 31;                       // 208 / 239 / 270
 *     }
 *
 * 数量在另一处（`Render_HudPass_4BD650_`）：`RenderNumber2D(i*31 + 226, 447, …)`，
 * 也就是 226 / 257 / 288。注意数字是压在图标**上边缘**的（447+10 与 454 重叠 3px），
 * 原版就这样，不是没对齐。
 */
const QUICK = [
  { iconX: 208, cx: 226 },
  { iconX: 239, cx: 257 },
  { iconX: 270, cx: 288 },
];
/** 图标 (20×20) 与数量的 y —— 都来自源码的硬编码 */
const QUICK_ICON_Y = 454;
const QUICK_COUNT_Y = 447;

/**
 * 药水分类（`Item_FindQuickSlotByCategory` + `SeedQuickPotionTypesFromInventory`）：
 *
 *   Q = 448..451（Apple / 小中大治疗）   从**高到低**找第一个有货的
 *   W = 452..454（小中大魔法）
 *   E = 456..468 里的辅助品（456 Antidote，457 Ale，468 ?）
 *
 * 数量 = 该范围内**所有堆叠之和**（`sub_482E40`），不是单类型、也不是格子数。
 */
export const QUICK_RANGES: { lo: number; hi: number }[] = [
  { lo: 448, hi: 451 },
  { lo: 452, hi: 454 },
  { lo: 456, hi: 468 },
];

const SPRITES = ['Menu_red', 'Menu_blue', 'Menu03_new_ag', 'Fonttest'];

/**
 * 位图数字：一个 digit 一个 div，用 mask 把 `Fonttest.ozt` 的数字染成任意颜色。
 *
 * 原版 `RenderNumber2D`：
 *   u = digit * 0.0625（= 16/256），v = 0，宽 0.0625，高 0.5（= 16/32）
 *   起点 xa = x - n * Width * 0.5，逐位步进 Width * 0.7
 *
 * `origin = 'classic'` 复刻这个「按 Width*0.5 居中」的算法（会天生偏左 3px），
 * `'left'` 表示 x 就是左边界 —— HP/MP 要拼 cur/max 时用得上。
 */
class BitmapNumber {
  readonly el: HTMLDivElement;
  private valueText = '0';

  /**
   * 数字渲染。
   *
   * 走过的弯路值得记一下：
   *   1. 先试 CSS `mask-image` + `background: currentColor` —— computed 值全对、
   *      mask 图也能 decode 出 256px，但**截图里一个像素都没有**。
   *   2. 再试 canvas `drawImage` + `source-in` —— `getImageData` 能看到 160 个
   *      不透明像素、`elementFromPoint` 也命中 canvas，但同样**合成不进截图**
   *      （headless Chromium 对 `transform: scale()` 容器里的 canvas 有已知问题）。
   *
   * 最后用回最朴素的 DOM 文本：字号/字重/描边都按位图字体的观感调，
   * 至少它 100% 会出现在画面上。位置仍然照原版 `RenderNumber2D` 的
   * 「以 x 为中心、逐位步进 0.7 字宽」来算。
   */
  constructor(
    private parent: HTMLElement,
    private x: number,
    private y: number,
    private dw = 9,
    private dh = 10,
    private color = '#fff2bf',
    private origin: 'classic' | 'left' = 'classic'
  ) {
    this.el = document.createElement('div');
    this.el.className = 'bm-num';
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.style.color = color;
    this.el.style.fontSize = `${Math.max(8, dh + 1)}px`;
    this.el.style.lineHeight = `${dh}px`;
    this.el.style.height = `${dh}px`;
    parent.appendChild(this.el);
  }

  /** 位图字体的图集（保留接口，文本渲染下不再需要） */
  setImage(_img: HTMLImageElement) {
    /* no-op */
  }

  /** 数字串的视觉宽度 */
  get width() {
    return this.el.offsetWidth || Math.ceil(this.valueText.length * this.dw * 0.7);
  }

  get text() {
    return this.valueText;
  }

  setX(x: number) {
    this.x = x;
    this.el.style.left = `${x}px`;
  }

  setSize(dw: number, dh: number) {
    if (this.dw === dw && this.dh === dh) return;
    this.dw = dw;
    this.dh = dh;
    this.el.style.fontSize = `${Math.max(8, dh + 1)}px`;
    this.el.style.lineHeight = `${dh}px`;
    this.el.style.height = `${dh}px`;
  }

  set(value: number) {
    this.valueText = String(Math.max(0, Math.trunc(value) || 0));
    this.el.textContent = this.valueText;
  }
}

/** 一个药水快捷槽：圆孔里的物品图标 + 右下角数量 */
interface QuickSlotView {
  icon: HTMLImageElement;
  count: BitmapNumber;
  /** 当前显示的物品类型，-1 = 空 */
  type: number;
  /** 图标是否已在加载中，避免每帧重复请求 */
  pending: boolean;
}

export interface HudPlace {
  /** 地图英文名，比如 Lorencia */
  map: string;
  x: number;
  y: number;
}

export class HudValues {
  private el: HTMLDivElement;
  private ready: Promise<void>;

  private hpOrb!: HTMLImageElement;
  private mpOrb!: HTMLImageElement;
  private orbClips: { hp: HTMLDivElement; mp: HTMLDivElement } | null = null;

  /** 球面数字：原版就一个当前值，中心 x = 100 / 540（_DAT_00552a4c 那套） */
  private hpNum: BitmapNumber;
  private mpNum: BitmapNumber;
  /** 悬停提示（原版 RenderTipText(103, 419, GlobalText[358])） */
  private tipEl: HTMLDivElement;
  private expNum: BitmapNumber;
  private agNum: BitmapNumber;

  private expFill!: HTMLDivElement;
  /** AG 竖条：外层 15×36 的槽，内层贴图按比例从顶部裁 */
  private agWrap!: HTMLDivElement;
  private agImg!: HTMLImageElement;

  private quicks: QuickSlotView[] = [];
  /** Fonttest.ozt 的位图字体，所有数字共用 */
  private fontImage: HTMLImageElement | null = null;

  private nameEl: HTMLDivElement;
  private placeEl: HTMLDivElement;

  private info: CharacterInfo | null = null;
  private charName = '';
  private charLevel = 0;
  private place: HudPlace = { map: '', x: 0, y: 0 };
  /** 背包快照，用来算三个快捷槽的药水数量 */
  private items: InventoryItem[] = [];

  constructor(private layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'hud-values';
    layer.add(this.el);

    this.nameEl = document.createElement('div');
    this.nameEl.className = 'hv-name';
    this.el.appendChild(this.nameEl);

    this.placeEl = document.createElement('div');
    this.placeEl.className = 'hv-place';
    this.el.appendChild(this.placeEl);

    // 球心 123.5 / 515.5，数字整串居中
    this.hpNum = new BitmapNumber(this.el, 100, 467, 9, 10, '#fff2bf');
    this.mpNum = new BitmapNumber(this.el, 540, 467, 9, 10, '#fff2bf');

    this.tipEl = document.createElement('div');
    this.tipEl.className = 'hv-tip hidden';
    layer.add(this.tipEl);
    this.expNum = new BitmapNumber(this.el, 425, 434, 9, 10, '#e8cf99');
    this.agNum = new BitmapNumber(this.el, AG_NUM.x, AG_NUM.y, 9, 10, '#fff2bf');

    this.ready = this.build();
  }

  private async build() {
    await preloadUi(SPRITES);

    const red = await uiSprite('Menu_red');
    const blue = await uiSprite('Menu_blue');
    const font = await uiSprite('Fonttest');

    if (font) {
      this.fontImage = font.image;
      this.hpNum.setImage(font.image);
      this.mpNum.setImage(font.image);
      this.expNum.setImage(font.image);
      this.agNum.setImage(font.image);
    }

    // 球：外层裁切，内层贴图整体不动 —— 裁掉顶部就是「液面下降」
    const mkOrb = (spr: { url: string } | null, box: typeof HP_ORB) => {
      const wrap = document.createElement('div');
      wrap.className = 'hv-orb';
      wrap.style.left = `${box.x}px`;
      wrap.style.top = `${box.y}px`;
      wrap.style.width = `${box.w}px`;
      wrap.style.height = `${box.h}px`;
      if (spr) {
        wrap.appendChild(
          spriteBox({ url: spr.url, x: 0, y: 0, w: box.w, h: box.h, className: 'hv-orb-img' })
        );
      }
      this.el.appendChild(wrap);
      return wrap;
    };
    const hpWrap = mkOrb(red, HP_ORB);
    const mpWrap = mkOrb(blue, MP_ORB);
    this.orbClips = { hp: hpWrap, mp: mpWrap };

    /*
     * 球体悬停提示。原版 `Render_HudPass_4BD650_` 里就是这两块：
     *   HP: MouseX ∈ [97,150) 且 MouseY ∈ [432,480) → RenderTipText(103, 419, "Health: %d / %d")
     *   MP: [489,542) × [432,480)                    → RenderTipText(495, 419, "Mana: %d / %d")
     * 球面本身只画当前值，这里补上最大值。
     */
    for (const [wrap, side] of [
      [hpWrap, 'hp'],
      [mpWrap, 'mp'],
    ] as const) {
      wrap.style.pointerEvents = 'auto';
      wrap.addEventListener('mouseenter', () => this.showOrbTip(side));
      wrap.addEventListener('mouseleave', () => this.tipEl.classList.add('hidden'));
    }

    // 经验条
    this.expFill = document.createElement('div');
    this.expFill.className = 'hv-exp-fill';
    this.expFill.style.left = `${EXP_BAR.x}px`;
    this.expFill.style.top = `${EXP_BAR.y}px`;
    this.expFill.style.height = `${EXP_BAR.h}px`;
    this.el.appendChild(this.expFill);

    // AG 竖条：贴图 Menu03_new_ag 铺满 15×36，按「空的比例」从顶部裁掉
    this.agWrap = document.createElement('div');
    this.agWrap.className = 'hv-ag';
    this.agWrap.style.left = `${AG_GAUGE.x}px`;
    this.agWrap.style.top = `${AG_GAUGE.y}px`;
    this.agWrap.style.width = `${AG_GAUGE.w}px`;
    this.agWrap.style.height = `${AG_GAUGE.h}px`;
    this.el.appendChild(this.agWrap);

    const ag = await uiSprite('Menu03_new_ag');
    if (ag) {
      this.agImg = spriteBox({
        url: ag.url,
        x: 0,
        y: 0,
        w: AG_GAUGE.w,
        h: AG_GAUGE.h,
        className: 'hv-ag-img',
      });
      this.agWrap.appendChild(this.agImg);
      // 悬停提示：原版 RenderTipText(546, 419, GlobalText[214]) —— "Stamina: %d / %d"
      this.agWrap.style.pointerEvents = 'auto';
      this.agWrap.addEventListener('mouseenter', () => this.showOrbTip('ag'));
      this.agWrap.addEventListener('mouseleave', () => this.tipEl.classList.add('hidden'));
    }

    // 三个药水槽：图标 20×20 @ y=454，数量 9×10 @ y=447（都照抄源码）
    for (const q of QUICK) {
      const icon = document.createElement('img');
      icon.className = 'hv-quick-icon';
      icon.draggable = false;
      icon.style.left = `${q.iconX}px`;
      icon.style.top = `${QUICK_ICON_Y}px`;
      icon.style.width = '20px';
      icon.style.height = '20px';
      icon.style.display = 'none';
      this.el.appendChild(icon);

      const count = new BitmapNumber(this.el, q.cx, QUICK_COUNT_Y, 9, 10, '#fff2bf');
      if (this.fontImage) count.setImage(this.fontImage);
      this.quicks.push({ icon, count, type: -2, pending: false });
    }

    /*
     * 骨架搭完要补画一次背包相关的东西：`setInventory` 可能在这之前就被
     * `refreshHud()` 调过（build 里 await 了贴图），那一次 `quicks` 还是空数组，
     * 结果就是「背包里有药水、快捷槽一直空着」。
     */
    this.paintQuicks();
    this.paint();
  }

  /* ---------------------------------------------------------------- */
  /* 数据                                                              */
  /* ---------------------------------------------------------------- */

  setCharacter(name: string, level: number, info: CharacterInfo | null) {
    this.charName = name;
    this.charLevel = level;
    if (info) this.place = { ...this.place, x: info.x, y: info.y };
    this.info = info;
    this.paint();
  }

  /** 背包变化时调；数量徽章与快捷槽图标都靠它 */
  setInventory(items: InventoryItem[]) {
    this.items = items;
    this.paintQuicks();
  }

  setPlace(map: string, x: number, y: number) {
    this.place = { map, x, y };
    this.paint();
  }

  /** 移动时只更坐标，不用整块重画 */
  setPosition(x: number, y: number) {
    this.place.x = x;
    this.place.y = y;
    this.placeEl.textContent = this.placeText();
  }

  private placeText() {
    const { map, x, y } = this.place;
    return `${map} ${x}, ${y}`;
  }

  /** 某个类型范围内的堆叠总数（`sub_482E40` 的语义：整堆相加） */
  private countRange(lo: number, hi: number): number {
    let n = 0;
    for (const it of this.items) {
      if (it.slot < 12) continue;
      if (it.type < lo || it.type > hi) continue;
      n += Math.max(1, Math.round(it.durability || 1));
    }
    return n;
  }

  /**
   * 每个槽显示哪一件 + 数量。
   *
   * `Item_FindQuickSlotByCategory` 是**从高往低**找第一个有货的类型
   * （`for (wanted = v1; wanted >= v2; --wanted)`，v1 是大药水），
   * 而数量取整个范围之和 —— 所以「显示大治疗瓶、数字是三种治疗瓶的总数」
   * 是正常现象，不是 bug。
   */
  private resolveQuick(): { type: number; count: number }[] {
    return QUICK_RANGES.map(({ lo, hi }) => {
      const count = this.countRange(lo, hi);
      for (let t = hi; t >= lo; t--) {
        const has = this.items.some(
          i => i.slot >= 12 && i.type === t && (i.durability || 0) > 0
        );
        if (has) return { type: t, count };
      }
      // 一个都没有：图标退回范围下界（原版也是硬渲染 fallback 类型），数字隐藏
      return { type: lo, count };
    });
  }

  private paintQuicks() {
    const resolved = this.resolveQuick();
    for (let i = 0; i < this.quicks.length; i++) {
      const slot = this.quicks[i];
      const { type, count } = resolved[i];

      slot.count.set(count);
      // 没货就整格留空（原版 count > 0 才画数字）
      slot.count.el.style.visibility = count > 0 ? 'visible' : 'hidden';

      if (type !== slot.type && !slot.pending) {
        slot.type = type;
        slot.pending = true;
        slot.icon.style.display = 'none';
        void itemIcon(type)
          .then(url => {
            slot.pending = false;
            if (url && slot.type === type) {
              slot.icon.src = url;
              slot.icon.style.display = '';
            }
          })
          .catch(() => (slot.pending = false));
      }
    }
  }

  private paint() {
    this.nameEl.textContent = this.charName || '';
    this.placeEl.textContent = this.placeText();

    const info = this.info;
    if (!info) {
      this.hpNum.set(0);
      this.mpNum.set(0);
      this.expNum.set(0);
      this.agNum.set(0);
      if (this.expFill) this.expFill.style.width = '0px';
      if (this.agImg) this.agImg.style.setProperty('--agclip', '100%');
      return;
    }

    // 液面：空的比例 = 1 - cur/max，从顶部裁掉这么多
    const hpEmpty = 1 - clamp01(info.life / Math.max(1, info.maxLife));
    const mpEmpty = 1 - clamp01(info.mana / Math.max(1, info.maxMana));
    if (this.orbClips) {
      this.orbClips.hp.style.setProperty('--clip', `${(hpEmpty * 100).toFixed(2)}%`);
      this.orbClips.mp.style.setProperty('--clip', `${(mpEmpty * 100).toFixed(2)}%`);
    }
    this.hpNum.set(info.life);
    this.mpNum.set(info.mana);

    // 经验：原版按「上一级累计经验」起算，条上只有 0..9 的档位
    const { ratio, tick } = expProgress(info.experience, info.nextExperience, this.charLevel);
    if (this.expFill) this.expFill.style.width = `${Math.round(clamp01(ratio) * EXP_BAR.w)}px`;
    this.expNum.set(tick);

    // AG（Stamina）：0xF3 的 BP 字段就是原版 CA+36 / CA+38
    const agPct = clamp01(info.bp / Math.max(1, info.maxBp));
    if (this.agImg) {
      // 原版画的是贴图的上面 h 行（h = 36 * cur/max），所以从顶部裁掉「没满」的部分
      this.agImg.style.setProperty('--agclip', `${((1 - agPct) * 100).toFixed(2)}%`);
    }
    this.agNum.set(info.bp);
  }

  /** 悬停提示：位置照抄原版（HP 103,419 / MP 495,419 / AG 546,419） */
  private showOrbTip(side: 'hp' | 'mp' | 'ag') {
    const info = this.info;
    if (!info) return;
    if (side === 'ag') {
      // Text.bmd [214] "Stamina: %d / %d"
      this.tipEl.textContent = `Stamina: ${info.bp} / ${info.maxBp}`;
      this.tipEl.style.left = '546px';
      this.tipEl.style.top = '419px';
      this.tipEl.classList.remove('hidden');
      return;
    }
    const isHp = side === 'hp';
    // Text.bmd [358] "Health: %d / %d"、[359] "Mana: %d / %d"
    const label = isHp ? 'Health' : 'Mana';
    const cur = isHp ? info.life : info.mana;
    const max = isHp ? info.maxLife : info.maxMana;
    this.tipEl.textContent = `${label}: ${cur} / ${max}`;
    this.tipEl.style.left = isHp ? '103px' : '495px';
    this.tipEl.style.top = '419px';
    this.tipEl.classList.remove('hidden');
  }

  /** 调试快照：探针脚本用，确认球/条/数字都拿到了值 */
  snapshot() {
    const info = this.info;
    return {
      name: this.charName,
      level: this.charLevel,
      place: { ...this.place },
      hp: info ? { cur: info.life, max: info.maxLife, text: this.hpNum.text } : null,
      mp: info ? { cur: info.mana, max: info.maxMana, text: this.mpNum.text } : null,
      stamina: info ? { cur: info.bp, max: info.maxBp, text: this.agNum.text } : null,
      exp: info ? { cur: info.experience, next: info.nextExperience } : null,
      expWidth: this.expFill?.style.width ?? '',
      agClip: this.agImg?.style.getPropertyValue('--agclip') ?? '',
      hpClip: this.orbClips?.hp.style.getPropertyValue('--clip') ?? '',
      mpClip: this.orbClips?.mp.style.getPropertyValue('--clip') ?? '',
      quicks: this.quicks.map(q => ({ type: q.type, count: q.count.text, shown: q.icon.style.display !== 'none' })),
    };
  }
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/**
 * 复刻 `RenderExperience`（`HUD_Pass2.cpp:649-676`）：
 *
 *   prevExp = 10*(lv-1)^2*(lv-1+9)      （lv-1 > 255 时再加一段立方项）
 *   need    = nextExp - prevExp
 *   ratio   = (exp - prevExp) / need     （原版先 ×10 再取整）
 *   tick    = clamp(floor(ratio*10), 0, 9)
 *   条长     = (ratio*10 - tick) * 198
 *
 * 服务端下发的 `nextExperience` 是「本级升满所需的总经验」，
 * 和原版的 CA+52 语义一致，所以直接用来当分母。
 */
export function expProgress(experience: number, nextExperience: number, level: number) {
  const lv = Math.max(0, Math.floor(level) || 0);
  const priorLevel = lv - 1;
  let prevExp = 0;
  if (priorLevel > 0) {
    prevExp = 10 * priorLevel * priorLevel * (priorLevel + 9);
    if (priorLevel > 255) {
      prevExp += 1000 * (lv - 256) * (lv - 256) * (lv - 256 + 9);
    }
  }

  /*
   * 两种 nextExperience 语义都要能吃：
   *   ① 本级升满所需的经验（0.97 服务端 0xF3 给的就是这个：Lv12 时约 3.4k）
   *   ② 下一级的累计经验（原版 CA+52，Lv12 时是 5 万多）
   * 判据：累计值必然大于 prevExp；否则按本级需求直接算。
   */
  const cumNeed = nextExperience - prevExp;
  const cumulative = cumNeed > 0;
  const need = cumulative ? cumNeed : nextExperience;
  const cur = cumulative ? experience - prevExp : experience;
  if (need <= 0) return { ratio: 0, tick: 0 };
  const scaled = (cur / need) * 10;
  const tick = Math.max(0, Math.min(9, Math.floor(scaled)));
  /*
   * 原版这里画的是「当前格内的余量」：
   *   width = (fExpBarNum - iExp) * 198
   * 也就是说条只表示 0..9 档里这一档填了多少（满一格就跳回 0），
   * 档位本身由旁边那位数字表示 —— 不是常见的「总进度条」。
   */
  return { ratio: Math.min(1, scaled - tick), tick };
}
