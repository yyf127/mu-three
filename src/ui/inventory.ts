/**
 * 背包面板 —— 逐像素照抄 0.97 客户端的 `RenderInventoryWindow`。
 *
 * 坐标全部来自客户端源码（`Render/HUD_Pass6.cpp`）：
 *
 *   RenderInventoryWindow (0x4F0A50)
 *     sx = 450, sy = 0                     ← 面板永远贴右侧，宽 190
 *     RenderInventoryInterface(sx, 0, 0)
 *       Item_Back01 (0x104) @ (sx, sy)        190×256
 *       Item_Back02 (0x105) @ (sx, sy+256)    190×177
 *     RenderEquipmentBox (0x4E25A0)          ← 12 个装备槽占位图
 *     grid @ (sx+15, sy+200), 8×8, 每格 20px
 *     Item_Money   (0x10F) @ (sx+50, sy+367.7)  113×18
 *     标题 @ (sx+35, sy+12)
 *
 * 装备槽偏移常量（globals.cpp 里逐一确认过）：
 *   colLeft 15 / colRing 55 / colBody 75 / colPendant 115 / colRight 134
 *   rowTop  46 / rowMid  89 / rowBottom 152
 *
 * 槽位索引 0..11 与 `RenderEquipmentBox` 的顺序一致（0 左手武器、1 右手武器、
 * 2 头盔、3 铠甲、4 护腿、5 护手、6 战靴、7 翅膀、8 守护/宠物、9 戒指1、
 * 10 戒指2、11 项链）。
 *
 * 服务端 `INVENTORY_SIZE = 76`，但**方向容易搞反**（`Item.h:3` + `ItemManager.h:15`）：
 *   `INVENTORY_WEAR_SIZE = 12`，`INVENTORY_WEAR_RANGE(x) = (x < 12)`，
 *   所以 **0..11 是这 12 个装备槽**，**12..75 才是 8×8 背包**。
 *   `InventoryAddItem` 里 `x = (slot-12)%8; y = (slot-12)/8` 就是映射本身。
 *
 * 因此：装备槽 serverSlot = index（0..11）；
 *       背包格 serverSlot = 12 + row*8 + col（cell = slot - 12）。
 */
import { uiSprite, preloadUi } from './ozj';
import { UiLayer, spriteBox } from './frame';
import { itemIcon } from './itemIcon';
import { itemAttr } from '../data/itemAttrs';
import { itemStats } from './itemRules';
import type { InventoryItem } from '../net/game';
import { startItemDrag, type PanelId } from './itemDrag';
import { textSync } from '../data/localText';
import { hoverSpin, stopHoverSpin } from './itemSpin';
import { itemTipHtml, placeTipBeside, setHeroStats } from './itemTip';

/** 面板原点：原版写死的 450（640-190） */
const PANEL_X = 450;
const PANEL_Y = 0;
const GRID_X = PANEL_X + 15;
const GRID_Y = PANEL_Y + 200;
const CELL = 20;
const COLS = 8;
const ROWS = 8;
/** 服务端槽位里背包的起点：0..11 是装备槽（Item.h:3） */
const WEAR = 12;
/** 面板宽（原版 190，贴右边缘 450..640） */
const PANEL_W = 190;


/**
 * 12 个装备槽：位置和槽位号逐字来自客户端 `FUN_004d1fc0`
 * （`Net/SecondPassword.cpp`，12 次 `FUN_004cdc70(x, y, w, h, slotIdx)` 调用），
 * 说明见 `Item/Item_Move.cpp`：
 *
 *   slot  0 @ ( 15,  89) 40x60  武器（左）
 *   slot  1 @ (134,  89) 40x60  副手 / 箭（右）
 *   slot  2 @ ( 75,  46) 40x40  头盔
 *   slot  3 @ ( 75,  89) 40x60  铠甲
 *   slot  4 @ ( 75, 152) 40x40  护腿
 *   slot  5 @ ( 15, 152) 40x40  护手
 *   slot  6 @ (134, 152) 40x40  战靴
 *   slot  7 @ (115,  46) 60x40  翅膀
 *   slot  8 @ ( 15,  46) 40x40  守护 / 宠物
 *   slot  9 @ ( 55,  89) 20x20  项链
 *   slot 10 @ ( 55, 152) 20x20  戒指 1
 *   slot 11 @ (115, 152) 20x20  戒指 2
 *
 * 「9 是项链、10/11 是戒指」由服务端 `Data/Item/Item.txt` 的 Slot 列定死：
 * `Pendant of Lightning` 是 `12 9 …`，`Ring of Ice` 是 `8 10 …`，
 * 而 `CheckItemMoveToInventory` 又特意放行 `slot 10 / 11` 互相换位（两枚戒指）。
 * 占位贴图也吻合：9 用 `Item_NeckLace`，10/11 用 `Item_Ring`。
 */
interface EquipSlotDef {
  /** 面板上的槽位号（0..11），服务端槽位就是它本身 */
  index: number;
  tex: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

const EQUIP_SLOTS: EquipSlotDef[] = [
  { index: 8, tex: 'Item_Fairy', x: 15, y: 46, w: 40, h: 40, label: '守护' },
  { index: 7, tex: 'Item_Wing', x: 115, y: 46, w: 60, h: 40, label: '翅膀' },
  { index: 2, tex: 'Item_Cap', x: 75, y: 46, w: 40, h: 40, label: '头盔' },
  { index: 0, tex: 'Item_Weapon01', x: 15, y: 89, w: 40, h: 60, label: '左手' },
  { index: 9, tex: 'Item_NeckLace', x: 55, y: 89, w: 20, h: 20, label: '项链' },
  { index: 3, tex: 'Item_Upper', x: 75, y: 89, w: 40, h: 60, label: '铠甲' },
  { index: 1, tex: 'Item_Weapon02', x: 134, y: 89, w: 40, h: 60, label: '右手' },
  { index: 5, tex: 'Item_Gloves', x: 15, y: 152, w: 40, h: 40, label: '护手' },
  { index: 10, tex: 'Item_Ring', x: 55, y: 152, w: 20, h: 20, label: '戒指 1' },
  { index: 4, tex: 'Item_Lower', x: 75, y: 152, w: 40, h: 40, label: '护腿' },
  { index: 11, tex: 'Item_Ring', x: 115, y: 152, w: 20, h: 20, label: '戒指 2' },
  { index: 6, tex: 'Item_Boots', x: 134, y: 152, w: 40, h: 40, label: '战靴' },
];

/** 面板用到的全部贴图，打开前一次性拉齐 */
const SPRITES = [
  'Item_Back01',
  'Item_Back02',
  'Item_box',
  'InventoryBox2',
  'Item_Money',
  'exit_01',
  'exit_02',
  'repair_01',
  'repair_02',
  ...EQUIP_SLOTS.map(s => s.tex),
];

/**
 * 取缩略图，永不抛。
 *
 * `itemIcon` 走的是离线 GL 渲染 + BMD 解析，任何一件物品出问题（模型缺失、
 * 贴图尺寸异常）都不该把整块 `paint()` 打断 —— 否则后面的格子和整个装备栏
 * 就停在上一帧状态，看起来像"物品消失了"（实测踩过：一件没有模型的物品
 * 卡住之后，装备栏后 4 个槽全都不刷新）。
 */
async function safeIcon(type: number, level = 0): Promise<string | null> {
  try {
    // level 也传进去：`modelId 860`（翅膀那类）的角度按 `(Level>>3)&0xF` 分三档
    return await itemIcon(type, level);
  } catch (err) {
    console.warn(`[ui] 缩略图渲染失败 type=${type}`, err);
    return null;
  }
}

export class InventoryPanel {
  private el: HTMLDivElement;
  private gridEl: HTMLDivElement;
  private equipEl: HTMLDivElement;
  private moneyEl: HTMLDivElement;
  private tipEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private ready: Promise<void>;
  private open = false;
  /** 当前背包数据，按服务端 slot 索引 */
  private items = new Map<number, InventoryItem>();
  /** 已占用的格子（0..63），由物品尺寸推导 */
  private occupied = new Set<number>();
  private iconEls = new Map<number, HTMLImageElement>();

  /**
   * 拖放结束的回调：(源槽位, 目标槽位)。
   * 上层负责发 0x24 —— 面板本身不碰网络。
   */
  onMove: ((from: number, to: number) => void) | null = null;

  /**
   * 单击（按下后没拖动就松手）回调，参数是物品的槽位。
   *
   * 商店/仓库打开时用它做「点一下 = 卖出 / 存入」—— 原版是拖到商店窗口里卖，
   * H5 里拖拽已经被「背包内换位」占了，所以改成单击，操作更短。
   * 参数是物品真实槽位（不是被点中的覆盖格），多格物品不会算错。
   */
  /**
   * 单击回调。`mods.shift` 用来区分「单击 = 用/卖/存」和「Shift+单击 = 拆堆叠」。
   *
   * 为什么不用右键拆：右键已经被「丢弃」占了（原版也是右键丢），
   * 而拆堆叠在原版是**Shift + 左键拖到空格**（`CGItemStackUnstackRecv`），
   * 这里简化成「Shift + 左键 → 问数量」。
   */
  onClick: ((slot: number, mods: { shift: boolean }) => void) | null = null;

  /**
   * 右键丢弃（上行 0x23）—— 保留成快捷方式，主要入口改成「拖到地面上」。
   */
  onDiscard: ((slot: number) => void) | null = null;

  /**
   * 拖到**别的面板**上（仓库 / 商店 / 混沌箱）。
   *
   * 语义由上层决定（原版 `Item_Move.cpp` 里就是按「源 flag → 目标 flag」分的）：
   *   拖到仓库面板 = 存入（0x24 0→2）
   *   拖到商店面板 = 卖出（0x33）
   *   拖到混沌箱   = 放入（0x24 0→3）
   */
  onDropPanel: ((slot: number, panel: PanelId) => void) | null = null;

  /** 拖到 3D 画面上 = 丢在地上（0x23）。原版就是「拖到地上松手」 */
  onDropFloor: ((slot: number) => void) | null = null;

  constructor(private layer: UiLayer, private onClose?: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'inv-panel hidden';
    this.el.style.left = `${PANEL_X}px`;
    this.el.style.top = `${PANEL_Y}px`;
    this.el.style.width = '190px';
    this.el.style.height = '433px';
    // 跨面板拖拽靠这个属性认「落在哪个面板上」（见 ui/itemDrag.ts）
    this.el.dataset.dragPanel = 'inventory';
    layer.add(this.el);

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'inv-grid';
    this.gridEl.style.left = `${GRID_X - PANEL_X}px`;
    this.gridEl.style.top = `${GRID_Y - PANEL_Y}px`;
    this.gridEl.style.width = `${COLS * CELL}px`;
    this.gridEl.style.height = `${ROWS * CELL}px`;
    this.el.appendChild(this.gridEl);

    this.equipEl = document.createElement('div');
    this.equipEl.className = 'inv-equip';
    this.el.appendChild(this.equipEl);

    this.moneyEl = document.createElement('div');
    this.moneyEl.className = 'inv-money';
    this.el.appendChild(this.moneyEl);

    this.tipEl = document.createElement('div');
    this.tipEl.className = 'ui-tip hidden';
    this.el.appendChild(this.tipEl);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'inv-toast hidden';
    this.el.appendChild(this.toastEl);

    this.ready = this.build();

    // 右键丢弃时不要弹浏览器菜单
    this.el.addEventListener('contextmenu', e => e.preventDefault());
  }

  /* ---------------------------------------------------------------- */
  /* 构建静态骨架                                                      */
  /* ---------------------------------------------------------------- */
  private async build() {
    await preloadUi(SPRITES);

    const back1 = await uiSprite('Item_Back01');
    const back2 = await uiSprite('Item_Back02');

    if (back1) {
      this.el.appendChild(
        spriteBox({ url: back1.url, x: 0, y: 0, w: 190, h: 256, className: 'inv-plate' })
      );
    }
    if (back2) {
      this.el.appendChild(
        spriteBox({ url: back2.url, x: 0, y: 256, w: 190, h: 177, className: 'inv-plate' })
      );
    }

    // 标题：原版 GlobalText[223]，字号 120*W/640 缩放到 640 基线后约 12px
    const title = document.createElement('div');
    title.className = 'inv-title';
    // 原版 `RenderText(InventoryStartX + 35, InventoryStartY + 12, GlobalText[223])` =「装  备」
    title.textContent = textSync(223, '装  备');
    title.style.left = '35px';
    title.style.top = '11px';
    title.style.width = '120px';
    this.el.appendChild(title);

    // 关闭按钮：原版没有（靠底栏图标），但 H5 里鼠标用户需要一个显式出口
    const ex1 = await uiSprite('exit_01');
    const ex2 = await uiSprite('exit_02');
    if (ex1) {
      const close = document.createElement('img');
      close.src = ex1.url;
      close.className = 'inv-close';
      close.draggable = false;
      close.title = '关闭 (I)';
      close.style.left = '161px';
      close.style.top = '4px';
      close.style.width = '24px';
      close.style.height = '24px';
      close.style.imageRendering = 'pixelated';
      if (ex2) {
        close.addEventListener('mouseenter', () => (close.src = ex2!.url));
        close.addEventListener('mouseleave', () => (close.src = ex1.url));
      }
      close.addEventListener('click', e => {
        e.stopPropagation();
        this.hide();
        this.onClose?.();
      });
      this.el.appendChild(close);
    }

    await this.buildEquip();
    await this.buildGridChrome();
    await this.buildMoney();
  }

  private async buildEquip() {
    for (const def of EQUIP_SLOTS) {
      const sp = await uiSprite(def.tex);
      if (!sp) continue;
      const box = document.createElement('div');
      box.className = 'inv-equip-slot';
      box.style.left = `${def.x}px`;
      box.style.top = `${def.y}px`;
      box.style.width = `${def.w}px`;
      box.style.height = `${def.h}px`;
      box.dataset.slot = String(def.index);
      box.dataset.label = def.label;

      // 占位图：原版是「物品剪影」，尺寸按贴图原始比例拉伸到槽框
      const img = spriteBox({ url: sp.url, x: 0, y: 0, w: def.w, h: def.h, className: 'equip-ghost' });
      box.appendChild(img);

      // 装备本体（有装备时才显示）
      const icon = document.createElement('img');
      icon.className = 'equip-icon hidden';
      icon.draggable = false;
      icon.style.imageRendering = 'pixelated';
      box.appendChild(icon);
      (box as HTMLElement & { _icon?: HTMLImageElement })._icon = icon;

      box.addEventListener('mouseenter', () => {
        // 有装备就显示词条，空槽显示槽位名
        const worn = this.items.get(def.index);
        if (worn) {
          this.showItemTip(box, worn, true);
          // 悬停旋转（原版 `RenderObjectScreen` 的 Select==1 分支）
          hoverSpin(icon, worn.type, worn.level);
        } else {
          this.showTip(box, def.label);
          stopHoverSpin();
        }
      });
      box.addEventListener('mouseleave', () => {
        this.hideTip();
        stopHoverSpin();
      });
      box.addEventListener('pointerdown', e => this.onPointerDown(e, def.index));

      this.equipEl.appendChild(box);
    }
  }

  private async buildGridChrome() {
    const empty = await uiSprite('Item_box');
    const filled = await uiSprite('InventoryBox2');
    this.emptyUrl = empty?.url ?? null;
    this.filledUrl = filled?.url ?? null;

    for (let i = 0; i < COLS * ROWS; i++) {
      const cell = document.createElement('div');
      cell.className = 'inv-cell';
      cell.style.left = `${(i % COLS) * CELL}px`;
      cell.style.top = `${Math.floor(i / COLS) * CELL}px`;
      cell.style.width = `${CELL}px`;
      cell.style.height = `${CELL}px`;
      // data-slot 一律用服务端槽位（背包 = 12 + 格子序号），拖拽回调直接拿它发 0x24
      cell.dataset.slot = String(WEAR + i);
      cell.dataset.cell = String(i);

      const bg = document.createElement('img');
      bg.draggable = false;
      bg.className = 'cell-bg';
      bg.style.imageRendering = 'pixelated';
      if (this.emptyUrl) bg.src = this.emptyUrl;
      cell.appendChild(bg);
      (cell as HTMLElement & { _bg?: HTMLImageElement })._bg = bg;

      cell.addEventListener('mouseenter', () => {
        /*
         * 取物品必须用**矩形覆盖**（`itemAt`），不能按 `items.get(格槽位)`：
         * 多格物品只在左上角那一格有记录，按槽位查的话只有那一格能触发，
         * 其余格（剑的 1×3、铠甲的 2×3……）悬停上去什么都不弹。
         * 仓库/商店那边（`npcPanel.itemAtCell`）一直是覆盖判定，这里补齐。
         */
        const item = this.itemAt(WEAR + i);
        if (!item) {
          this.hideTip();
          stopHoverSpin();
          return;
        }
        this.showItemTip(cell, item);
        // 图标是叠在格子上的一层 <img>，按**物品自己的槽位**取；悬停时让它转起来
        hoverSpin(this.iconEls.get(item.slot), item.type, item.level);
      });
      cell.addEventListener('mouseleave', () => {
        this.hideTip();
        stopHoverSpin();
      });
      cell.addEventListener('pointerdown', e => this.onPointerDown(e, WEAR + i));

      this.gridEl.appendChild(cell);
    }
  }

  private emptyUrl: string | null = null;
  private filledUrl: string | null = null;

  private async buildMoney() {
    const sp = await uiSprite('Item_Money');
    const wrap = document.createElement('div');
    wrap.className = 'inv-money-strip';
    wrap.style.left = '50px';
    wrap.style.top = '367px';
    wrap.style.width = '113px';
    wrap.style.height = '18px';
    if (sp) {
      const img = spriteBox({ url: sp.url, x: 0, y: 0, w: 113, h: 18 });
      wrap.appendChild(img);
    }
    const label = document.createElement('span');
    label.className = 'inv-money-label';
    // 原版 `RenderText(x - 30, y, GlobalText[224])` =「金」；以前写死成 'Zen'
    label.textContent = textSync(224, '金');
    wrap.appendChild(label);
    const value = document.createElement('span');
    value.className = 'inv-money-value';
    value.textContent = '0';
    wrap.appendChild(value);
    this.moneyValueEl = value;
    this.moneyEl.appendChild(wrap);
  }

  private moneyValueEl: HTMLSpanElement | null = null;

  /* ---------------------------------------------------------------- */
  /* 数据                                                              */
  /* ---------------------------------------------------------------- */
  setItems(list: InventoryItem[]) {
    this.items.clear();
    for (const it of list) this.items.set(it.slot, it);

    // 重新算占用格：物品左上角在 slot（12..75），按 w×h 铺开
    this.occupied.clear();
    for (const it of list) {
      if (it.slot < WEAR) continue;
      const attr = itemAttr(it.type);
      const cell = it.slot - WEAR;
      const col = cell % COLS;
      const row = Math.floor(cell / COLS);
      for (let dy = 0; dy < attr.h; dy++) {
        for (let dx = 0; dx < attr.w; dx++) {
          const c = col + dx;
          const r = row + dy;
          if (c < COLS && r < ROWS) this.occupied.add(r * COLS + c);
        }
      }
    }

    void this.paint();
  }

  /** 只更新金币数字（0xFE / 0xF3 变化时调用） */
  setMoney(zen: number) {
    if (!this.moneyValueEl) return;
    this.moneyValueEl.textContent = zen.toLocaleString('en-US');
  }

  /**
   * 灌角色等级 / 四维（tooltip 的「所需力量」那几行要拿它比）。
   *
   * 原版这几个数在 `CharacterAttribute` 里，客户端自己维护；我们只有
   * `F3/03` 的角色包，所以由 `main.ts::refreshHud()` 每次收到包就同步一次。
   */
  setHero(stats: { level: number; str: number; agi: number; ene: number; cls?: number }) {
    // 实际存在 `itemTip.ts::HERO`（商店/仓库的 tooltip 也用同一份）
    setHeroStats(stats);
  }

  private async paint() {
    await this.ready;
    if (!this.renderPainted) {
      this.renderPainted = true;
    }

    // 1) 格子底色：空的 Item_box / 占用的 InventoryBox2
    const cells = this.gridEl.children;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i] as HTMLElement & { _bg?: HTMLImageElement };
      const taken = this.occupied.has(i);
      const url = taken ? this.filledUrl : this.emptyUrl;
      if (url && cell._bg && cell._bg.src !== url) cell._bg.src = url;
      cell.classList.toggle('taken', taken);
    }

    // 2) 背包里的物品图标
    for (const el of this.iconEls.values()) el.remove();
    this.iconEls.clear();
    // 堆叠数标签每帧重建（数量和图标是一体的，分开清理容易漏）
    this.gridEl.querySelectorAll('.inv-count').forEach(el => el.remove());

    for (const [slot, item] of this.items) {
      if (slot < WEAR) continue;
      const attr = itemAttr(item.type);
      const cell = slot - WEAR;
      const img = document.createElement('img');
      img.className = 'inv-item-icon';
      img.draggable = false;
      img.style.left = `${(cell % COLS) * CELL}px`;
      img.style.top = `${Math.floor(cell / COLS) * CELL}px`;
      img.style.width = `${attr.w * CELL}px`;
      img.style.height = `${attr.h * CELL}px`;
      img.style.imageRendering = 'pixelated';
      this.gridEl.appendChild(img);
      this.iconEls.set(slot, img);

      /*
       * 堆叠数。原版只在**药水**上画（`Item/Item_InventoryRender.cpp:387`）：
       *
       *     if (p6 && itemType > 0x1bf && itemType < 0x1c9 && cell->Durability > 1) {
       *         glColor3f(1.0f, 0.9f, 0.7f);
       *         RenderNumber2D(x + 13.0f, y, cell->Durability, 9, 10);   // _DAT_005527dc = 13
       *     }
       *
       * `0x1BF < type < 0x1C9` 就是 **448..456**（Apple / 小中大治疗 / 小中大魔法 /
       * 圣水 / Antidote）。装备的 `Durability` 是**耐久**不是数量，绝不能画数字 ——
       * 之前按 `durability > 1` 一刀切，结果剑和铠甲上全是数字。
       */
      const stack = Math.round(item.durability || 0);
      if (item.type >= 448 && item.type <= 456 && stack > 1) {
        const num = document.createElement('span');
        num.className = 'inv-count';
        num.textContent = String(stack);
        // 原版是「数字中心 x = 格子左边界 + 13」，y 顶到格子顶部
        num.style.left = `${(cell % COLS) * CELL + 13}px`;
        num.style.top = `${Math.floor(cell / COLS) * CELL}px`;
        this.gridEl.appendChild(num);
      }

      const url = await safeIcon(item.type, item.level);
      if (url) img.src = url;
      else {
        img.classList.add('missing');
        console.warn(`[ui] 物品图标缺失 type=${item.type}（${attr.name}）`);
      }
    }

    // 3) 装备栏
    for (const box of this.equipEl.children) {
      const el = box as HTMLElement & { _icon?: HTMLImageElement };
      const slot = Number(el.dataset.slot);
      const item = this.items.get(slot);
      const icon = el._icon;
      if (!icon) continue;
      if (!item) {
        icon.classList.add('hidden');
        icon.removeAttribute('src');
        el.classList.remove('equipped');
        continue;
      }
      el.classList.add('equipped');
      icon.classList.remove('hidden');
      icon.style.width = el.style.width;
      icon.style.height = el.style.height;
      const url = await safeIcon(item.type, item.level);
      if (url) icon.src = url;
    }
  }

  private renderPainted = false;

  /* ---------------------------------------------------------------- */
  /* 提示                                                              */
  /* ---------------------------------------------------------------- */
  private showTip(anchor: HTMLElement, text: string) {
    this.tipEl.textContent = text;
    this.tipEl.classList.remove('hidden');
    this.tipEl.style.left = `${anchor.offsetLeft}px`;
    this.tipEl.style.top = `${anchor.offsetTop - 14}px`;
  }

  /**
   * 元素相对**面板**的逻辑矩形（除以缩放比，得到 640×480 逻辑坐标）。
   * 装备槽和背包格都能用这一份，不用记各自的常量。
   */
  private localRect(el: HTMLElement): { x: number; y: number; w: number; h: number } {
    const p = this.el.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const s = p.width / PANEL_W || 1;
    return { x: (r.left - p.left) / s, y: (r.top - p.top) / s, w: r.width / s, h: r.height / s };
  }

  private showItemTip(anchor: HTMLElement, item: InventoryItem, anchored = false) {
    /*
     * 内容交给 `itemTip.ts`（和商店/仓库共用同一套 `GlobalText` 模板）。
     * `withPrice = false`：背包 tooltip 不显示买卖价 —— 原版那句价格行包在
     * `if (ShopOpened != 0)` 里，只有站在商人面前才有。
     */
    this.tipEl.innerHTML = itemTipHtml(item, false);
    // 先显示出来才量得到尺寸（`placeTipBeside` 要按自身宽高避让）
    this.tipEl.classList.remove('hidden');

    const attr = itemAttr(item.type);
    let rect: { x: number; y: number; w: number; h: number };
    if (anchored) {
      rect = this.localRect(anchor);
    } else {
      const cell = Math.max(0, item.slot - WEAR);
      rect = {
        x: GRID_X - PANEL_X + (cell % COLS) * CELL,
        y: GRID_Y - PANEL_Y + Math.floor(cell / COLS) * CELL,
        w: attr.w * CELL,
        h: attr.h * CELL,
      };
    }

    /*
     * 摆到物品**左边**（放不下就右边、再不行上方），不再压在物品上。
     * 以前是「钉在物品所在格的上方」，竖向物品（剑 1×3、弓 2×3）直接被盖住。
     */
    const pos = placeTipBeside(
      { w: this.tipEl.offsetWidth, h: this.tipEl.offsetHeight },
      rect,
      { w: PANEL_W, h: 433 },
      PANEL_X
    );
    this.tipEl.style.left = `${pos.left}px`;
    this.tipEl.style.top = `${pos.top}px`;
  }

  private hideTip() {
    this.tipEl.classList.add('hidden');
  }

  /**
   * 面板底部的一行提示（服务端拒绝移动时用）。
   * 原版没有这东西 —— 但原版服务端不会拒，这里的 0.97k 二进制会，
   * 不给反馈的话玩家只会觉得「拖了没反应」。
   */
  toast(text: string, ms = 1800) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), ms) as unknown as number;
  }

  private toastTimer: number | null = null;

  /* ---------------------------------------------------------------- */
  /* 拖拽                                                              */
  /* ---------------------------------------------------------------- */
  /**
   * 原版是「按住物品 → 拖到目标格 → 松手发 0x24」。
   * 这里用 pointer 事件重做：移动超过 4px 才算拖拽（否则当点击），
   * 松手时用 elementFromPoint 找落点，交给上层发协议。
   */
  /**
   * 按下 = 可能开始拖拽。
   *
   * 走过的语义（原版 `Item_Move.cpp` 的鼠标状态机）：
   *   - 左键按住拖到别的格 / 别的面板 / 地面上 → 换位 / 存仓 / 卖出 / 丢弃
   *   - 左键按住不动就松手 → 单击（由 `click` 事件处理：双击使用、Shift 拆分…）
   *   - 右键 → 丢弃（快捷方式，原版是拖到地上）
   *
   * 具体拖拽过程交给 `ui/itemDrag.ts` 统一处理 —— 以前这套状态机只认
   * 自己面板里的 `[data-slot]`，鼠标一到仓库/商店面板上就丢了目标，
   * 所以那时候只能做成「点一下存取」。
   */
  private onPointerDown(e: PointerEvent, slot: number) {
    if (e.button === 2) {
      // 右键 = 丢弃（装备栏也允许，服务端 `INVENTORY_RANGE` 两者都收）
      const item = this.itemAt(slot);
      if (item) {
        e.preventDefault();
        this.onDiscard?.(item.slot);
      }
      return;
    }
    if (e.button !== 0) return;
    // 多格物品只在自己的左上角格里有记录，从覆盖格的任意处按下都要能拖
    const item = this.itemAt(slot);
    if (!item) return;
    e.preventDefault();

    startItemDrag(
      e,
      {
        panel: 'inventory',
        slot: item.slot,
        type: item.type,
        iconSrc: this.iconSrcOf(item),
      },
      {
        onStart: () => this.el.classList.add('dragging'),
        onEnd: () => {
          this.el.classList.remove('dragging');
          this.markDropTarget(null);
        },
        onDrop: (dragItem, target) => {
          if (target.kind === 'cell' && target.panel === 'inventory') {
            // 背包内换位（原来那套 0x24 0→0）
            if (target.slot !== dragItem.slot) this.onMove?.(dragItem.slot, target.slot);
            return;
          }
          // 落在别的面板上（货架格 / 仓库格 / 面板空白处都算）
          if ((target.kind === 'panel' || target.kind === 'cell') && target.panel !== 'inventory') {
            this.onDropPanel?.(dragItem.slot, target.panel);
            return;
          }
          if (target.kind === 'floor') {
            this.onDropFloor?.(dragItem.slot);
            return;
          }
          // 落在自己的面板空白处 = 没动
        },
      },
      this.layer.scaleFactor
    );
  }

  /** 某个服务端槽位（0..75）被哪件物品压着；空格返回 null */
  private itemAt(slot: number): InventoryItem | null {
    const direct = this.items.get(slot);
    if (direct) return direct;
    if (slot < WEAR) return null;

    const cell = slot - WEAR;
    const col = cell % COLS;
    const row = Math.floor(cell / COLS);
    for (const it of this.items.values()) {
      if (it.slot < WEAR) continue;
      const attr = itemAttr(it.type);
      const c0 = (it.slot - WEAR) % COLS;
      const r0 = Math.floor((it.slot - WEAR) / COLS);
      if (col >= c0 && col < c0 + attr.w && row >= r0 && row < r0 + attr.h) return it;
    }
    return null;
  }

  /** 已渲染的图标（拖拽 ghost 直接复用，避免再渲一遍） */
  private iconSrcOf(item: InventoryItem): string | null {
    const fromGrid = this.iconEls.get(item.slot);
    if (fromGrid?.src) return fromGrid.src;
    const equip = this.equipEl.querySelector<HTMLImageElement>(
      `[data-slot="${item.slot}"] .equip-icon`
    );
    return equip?.src || null;
  }

  private markDropTarget(slot: number | null) {
    for (const el of this.el.querySelectorAll('.drop-hover')) {
      el.classList.remove('drop-hover');
    }
    if (slot === null) return;
    const holder =
      this.gridEl.querySelector(`[data-slot="${slot}"]`) ??
      this.equipEl.querySelector(`[data-slot="${slot}"]`);
    holder?.classList.add('drop-hover');
  }

  /* ---------------------------------------------------------------- */
  /* 开关                                                              */
  /* ---------------------------------------------------------------- */
  /**
   * 打开。骨架是异步（贴图要走网络）搭的，但开关状态必须**同步**生效 ——
   * 否则 debug 接口 / 上层逻辑拿到的 isOpen 会慢一拍。
   */
  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    void this.ready.then(() => this.paint());
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
    this.hideTip();
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
    return this.open;
  }

  get isOpen() {
    return this.open;
  }
}
