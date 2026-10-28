/**
 * 角色属性面板 —— 照抄 0.97 客户端的 `RenderCharacterInfoWindow`。
 *
 * 来源：`Render/HUD_Pass6.cpp:773`（IDA 0x004ECC60，9398 字节）。
 * 调用点 `Render/HUD_Pass4.cpp:414`：
 *
 *     if (CharacterOpened) RenderCharacterInfoWindow(450, 0);
 *
 * 也就是说它和背包**共用同一块右侧底板**（`Item_Back01` + `Item_Back02`，
 * 宽 190，贴右边缘），只是内容不同 —— 游戏里 C 和 V 切的就是这个面板。
 *
 * 版面（全部相对面板左上角，原版是 640×480 绝对坐标减 450）：
 *
 *   底板        (0, 0)     190×256  Item_Back01
 *   底板        (0, 256)   190×177  Item_Back02
 *   名字        (35, 12)   宽 120 居中，bold
 *   职业/服务器 (22, 22)   bold，两者按 sin 互补淡入淡出（周期 2π s）
 *   5 条属性底  (13, 56 + i*60)  75×21  `Level_box.ozj`（原版 sprite 245）
 *
 * 每组两行：标签在上、数值在下，行距 60：
 *
 *   i=0  等级 (14, 60)   / 经验  (24, 80)
 *   i=1  力量 (14, 120)  / 攻击力 (24, 140)
 *   i=2  敏捷 (14, 180)  / 防御力 (24, 200) + 防御率 (24, 215)
 *   i=3  体力 (14, 240)  / 生命   (24, 260)
 *   i=4  能量 (14, 300)  / 魔法   (24, 320)
 *
 * 「点数」在 (95, 49)，蓝底黑字，只在有点数时才画；
 * 「重置点数」在 (24, 95)，橙色。
 * 加号按钮（`Level_01.ozj` / 悬停 `Level_02.ozj`）在 (125, 115 + 60*row)，
 * 24×24 —— 命中框就是原版 `sub_4E5DE0 L94-98` 的
 * `x ∈ [startX+125, +149)`、`y ∈ [startY+115+60*row, +24)`。
 *
 * 注意原版**不画关闭按钮**（`HUD_Pass6.cpp` 末尾的注释写得很清楚：
 * 关面板走底栏的 C 按钮）。H5 里鼠标用户需要一个显式出口，所以沿用背包
 * 右上角那个 exit_01/02。
 *
 * 文案：全部按原版索引从 `Data/Local/Text.bmd` 取（`GlobalText[200..217]`），
 * 职业名取 `GlobalText[20 + 职业号]` —— 见 `src/data/localText.ts`。
 * 原来这里写死的中文只是为了在文本层做完之前能看，现在都换掉了。
 */
import { uiSprite, preloadUi } from './ozj';
import { UiLayer, spriteBox } from './frame';
import { itemAttr } from '../data/itemAttrs';
import { loadTextPool, type TextPool } from '../data/localText';
import type { CharacterInfo } from '../net/session';
import type { InventoryItem } from '../net/game';

/** 面板原点：和背包一样写死 450（640 - 190） */
const PANEL_X = 450;
const PANEL_Y = 0;
/** 面板内容高：256 + 177 */
const PANEL_H = 433;

/** 5 条属性行底板的位置（原版 `xb = +19-6`、`yb = +60-4`，步长 60） */
const ROW_BG_X = 13;
const ROW_BG_Y = 56;
const ROW_BG_STEP = 60;
const ROW_BG_W = 75;
const ROW_BG_H = 21;
const ROW_COUNT = 5;

/** 加号按钮：x 固定 125，y = 115 + 60*row，24×24 */
const PLUS_X = 125;
const PLUS_Y = 115;
const PLUS_STEP = 60;
const PLUS_SIZE = 24;

const SPRITES = [
  'Item_Back01',
  'Item_Back02',
  'Level_box',
  'Level_01',
  'Level_02',
  'exit_01',
  'exit_02',
];

/** 文本行定义：id → 位置 / 样式 */
interface TextRowDef {
  /** data-row，调试与刷新时定位 */
  id: string;
  x: number;
  y: number;
  /** 最大像素宽度（原版 RenderText 第 4 参数就是这个） */
  w: number;
  /** bold = 原版 `SelectObject(g_hFontBold)` */
  bold?: boolean;
  /** 底色（原版 `m_dwBackColor`），null = 透明 */
  bg?: string;
  color?: string;
  align?: 'left' | 'center';
}

/**
 * 文本行坐标表。数值一行一行对过 `HUD_Pass6.cpp`：
 * 标题 (35,12) / 经验 (24,80) / 点数 (95,49) / 重置 (24,95) /
 * 力量 (14,120) 攻击 (24,140) / 敏捷 (14,180) 防御 (24,200) 防御率 (24,215) /
 * 体力 (14,240) 生命 (24,260) / 能量 (14,300) 魔法 (24,320) / 魔法伤害 (24,335)
 */
const TEXT_ROWS: TextRowDef[] = [
  /*
   * 等级那行原版给的是 70px 上限（"Nivel: 10 / 400" 在西语 8px 字体下刚好塞下），
   * 换中文 + 11px 会被截成「10 / 40」。这里放到 104（14 → 118，
   * 正好停在加点按钮 125 之前）。
   */
  { id: 'level', x: 14, y: 60, w: 104, bold: true, color: '#e6e6e6' },
  { id: 'exp', x: 24, y: 80, w: 130, bg: 'rgba(0,0,0,.5)', color: '#ffffff' },
  { id: 'points', x: 95, y: 49, w: 80, bold: true, bg: '#1e6ec8', color: '#000000' },
  { id: 'reset', x: 24, y: 95, w: 130, bold: true, bg: 'rgba(0,0,0,.5)', color: '#ff9664' },
  { id: 'strength', x: 14, y: 120, w: 70, bold: true, color: '#66ccdf' },
  { id: 'damage', x: 24, y: 140, w: 130, bg: 'rgba(0,0,0,.5)', color: '#ffffff' },
  { id: 'agility', x: 14, y: 180, w: 70, bold: true, color: '#67bfdf' },
  { id: 'defense', x: 24, y: 200, w: 130, bg: 'rgba(0,0,0,.5)', color: '#ffffff' },
  { id: 'defrate', x: 24, y: 215, w: 130, bg: 'rgba(0,0,0,.5)', color: '#ffffff' },
  { id: 'vitality', x: 14, y: 240, w: 70, bold: true, color: '#67bfdf' },
  { id: 'life', x: 24, y: 260, w: 130, bg: 'rgba(0,0,0,.5)', color: '#ffffff' },
  { id: 'energy', x: 14, y: 300, w: 70, bold: true, color: '#67bfdf' },
  { id: 'mana', x: 24, y: 320, w: 130, bg: 'rgba(0,0,0,.5)', color: '#ffffff' },
  { id: 'magic', x: 24, y: 335, w: 130, bg: 'rgba(0,0,0,.5)', color: '#ffffff' },
];

/**
 * 等级上限。原版读全局 `g_MaxCharacterLevel`（`globals.cpp:1321`，默认 400），
 * 由 opcode 0xDF 下发；这个服务端没发，所以取默认值。
 */
const MAX_LEVEL = 400;

export class CharacterPanel {
  private el: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private classEl!: HTMLDivElement;
  private rows = new Map<string, HTMLDivElement>();
  private plusEls: HTMLDivElement[] = [];
  private ready: Promise<void>;
  private open = false;

  /** 当前渲染用的数据；`setInfo` 之前是 null，面板显示占位 */
  private info: CharacterInfo | null = null;
  private charName = '';
  private charLevel = 0;
  private charClass = 0;
  /** 装备槽 0..11 的物品（服务端槽位语义），用来算攻防加成 */
  private equipped: InventoryItem[] = [];
  /** Text.bmd 文本池（原版 GlobalText[]），build() 里就绪 */
  private text: TextPool | null = null;

  /** 加点回调：(属性槽位 0=力 1=敏 2=体 3=能) */
  onAddPoint: ((stat: number) => void) | null = null;

  constructor(private layer: UiLayer, private onClose?: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'chr-panel hidden';
    this.el.style.left = `${PANEL_X}px`;
    this.el.style.top = `${PANEL_Y}px`;
    this.el.style.width = '190px';
    this.el.style.height = `${PANEL_H}px`;
    layer.add(this.el);

    this.ready = this.build();
  }

  /* ---------------------------------------------------------------- */
  /* 静态骨架                                                          */
  /* ---------------------------------------------------------------- */
  private async build() {
    // 所有文案都在 Data/Local/Text.bmd 里（原版 GlobalText[]），和贴图并行加载
    const [pool] = await Promise.all([loadTextPool(), preloadUi(SPRITES)]);
    this.text = pool;

    // 底板两段，和背包完全同一套素材（原版 RenderInventoryInterface 复用）
    for (const [y, h, key] of [
      [0, 256, 'Item_Back01'],
      [256, 177, 'Item_Back02'],
    ] as const) {
      const spr = await uiSprite(key);
      if (spr) {
        this.el.appendChild(
          spriteBox({ url: spr.url, x: 0, y, w: 190, h, className: 'chr-plate' })
        );
      }
    }

    // 名字（原版 (35,12) 宽 120，居中）
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'chr-title';
    this.titleEl.style.left = '35px';
    this.titleEl.style.top = '11px';
    this.titleEl.style.width = '120px';
    this.el.appendChild(this.titleEl);

    // 职业 / 服务器：原版两条文本叠在 (22,22)，α 按 sin 互补脉冲
    this.classEl = document.createElement('div');
    this.classEl.className = 'chr-class';
    this.classEl.style.left = '22px';
    this.classEl.style.top = '22px';
    this.el.appendChild(this.classEl);

    // 5 条属性行底板
    const rowBg = await uiSprite('Level_box');
    if (rowBg) {
      for (let i = 0; i < ROW_COUNT; i++) {
        this.el.appendChild(
          spriteBox({
            url: rowBg.url,
            x: ROW_BG_X,
            y: ROW_BG_Y + i * ROW_BG_STEP,
            w: ROW_BG_W,
            h: ROW_BG_H,
            className: 'chr-row-bg',
          })
        );
      }
    }

    // 文本行
    for (const def of TEXT_ROWS) {
      const div = document.createElement('div');
      div.className = 'chr-text' + (def.bold ? ' bold' : '');
      div.dataset.row = def.id;
      div.style.left = `${def.x}px`;
      div.style.top = `${def.y}px`;
      div.style.maxWidth = `${def.w}px`;
      // 不设 width：原版黑底只跟着文字宽度走（m_dwBackColor 是文字背景）
      if (def.bg) div.style.background = def.bg;
      if (def.color) div.style.color = def.color;
      if (def.align === 'center') div.style.textAlign = 'center';
      this.el.appendChild(div);
      this.rows.set(def.id, div);
    }

    // 加号按钮（原版 sprite 0x120 / 0x121，即 Level_01 / Level_02）
    const plusN = await uiSprite('Level_01');
    const plusH = await uiSprite('Level_02');
    if (plusN) {
      for (let row = 0; row < 4; row++) {
        const btn = document.createElement('div');
        btn.className = 'chr-plus';
        btn.dataset.stat = String(row);
        btn.style.left = `${PLUS_X}px`;
        btn.style.top = `${PLUS_Y + row * PLUS_STEP}px`;
        btn.style.width = `${PLUS_SIZE}px`;
        btn.style.height = `${PLUS_SIZE}px`;

        const img = document.createElement('img');
        img.src = plusN.url;
        img.draggable = false;
        img.style.imageRendering = 'pixelated';
        btn.appendChild(img);

        if (plusH) {
          btn.addEventListener('mouseenter', () => (img.src = plusH.url));
          btn.addEventListener('mouseleave', () => (img.src = plusN.url));
        }
        btn.addEventListener('click', e => {
          e.stopPropagation();
          this.onAddPoint?.(row);
        });
        this.el.appendChild(btn);
        this.plusEls.push(btn);
      }
    }

    // 关闭（H5 专用，原版靠底栏 C 按钮）
    const ex1 = await uiSprite('exit_01');
    const ex2 = await uiSprite('exit_02');
    if (ex1) {
      const close = document.createElement('img');
      close.src = ex1.url;
      close.className = 'chr-close';
      close.draggable = false;
      close.title = '关闭 (C)';
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

    this.paint();
  }

  /* ---------------------------------------------------------------- */
  /* 数据                                                              */
  /* ---------------------------------------------------------------- */

  /** 换角色 / 收到 0xF3 时调；`info` 传 null 表示还没拿到服务端数据 */
  /**
   * 职业名（`Text.bmd` 的转职列）。
   * `classId` 是**编码后的职业号**（低 3 位职业组、`>>3` 是转职次数）。
   */
  classNameOf(classId: number): string {
    return this.text ? this.text.className(classId) : '';
  }

  setInfo(
    name: string,
    level: number,
    charClass: number,
    info: CharacterInfo | null,
    equipped: InventoryItem[] = []
  ) {
    this.charName = name;
    this.charLevel = level;
    this.charClass = charClass;
    this.info = info;
    this.equipped = equipped;
    this.paint();
  }

  private setText(id: string, text: string) {
    const el = this.rows.get(id);
    if (el) el.textContent = text;
  }

  private paint() {
    if (!this.titleEl) return; // 骨架还没搭完（首帧）

    const info = this.info;
    const t = this.text;
    this.titleEl.textContent = this.charName || '—';

    // 职业名同样来自 Text.bmd：原版是 GlobalText[4*(CA[11]>>3) + 20 + (CA[11]&7)]
    const cls = t ? t.className(this.charClass) : '';
    this.classEl.textContent = info ? `(${cls})` : '(未连接)';
    this.classEl.style.opacity = info ? '' : '0.55';

    if (!info || !t) {
      for (const id of this.rows.keys()) this.setText(id, '');
      this.plusEls.forEach(el => (el.style.display = 'none'));
      return;
    }

    /*
     * 攻击力 / 防御力 / 防御率在原版面板里读的是 `CharacterAttribute` 的
     * CA+60/62（伤害区间）、CA+68（防御）、CA+56（防御率）—— 这些字段是
     * 客户端自己算的，服务端 0xF3/0x03 的 48 字节里并没有。
     *
     * 这里按 0.97 的经典派生式 + 装备基础值算：
     *   攻击 = STR/6 ～ STR/4，再加左右手武器的基础 DamageMin/Max
     *   防御 = AGI/3 + 所有防具的基础 Defense
     *   防御率 = AGI * 1.2
     * 装备强化（+N）按 每级 3% 折算 —— 原版 `Damage*（100+3*level)/100`。
     * 追加属性、卓越、套装加成都没算，所以这三行只是**近似值**，
     * 真值要等之后接完整属性计算链。
     */
    const str = info.strength;
    const agi = info.dexterity;

    let wMin = 0;
    let wMax = 0;
    let wDef = 0;
    for (const it of this.equipped) {
      const a = itemAttr(it.type);
      // 强化等级：每 +1 约 3%（0.97 的 `LevelConvert` 就是这个量级）
      const mul = (100 + 3 * Math.max(0, it.level | 0)) / 100;
      if (it.slot === 0 || it.slot === 1) {
        wMin += Math.round(a.dmgMin * mul);
        wMax += Math.round(a.dmgMax * mul);
      }
      wDef += Math.round(a.def * mul);
    }

    const dmgMin = Math.floor(str / 6) + wMin;
    const dmgMax = Math.floor(str / 4) + wMax;
    const defBase = Math.floor(agi / 3) + wDef;
    const defRate = Math.floor(agi * 1.2);

    /*
     * 文案全部按原版索引从 Text.bmd 取（`RenderCharacterInfoWindow` 的
     * `sprintf(Buffer, GlobalText[i], ...)`）：
     *
     *   200 "Level: %d / %d"       201 "Experience: %u / %u"
     *   202 "Strength: %d"         205 "Agility: %d"
     *   210 "Vitality: %d"         212 "Energy: %d"
     *   203 "Damage (rate): %d ~ %d (%d)"   204 "Damage: %d ~ %d"
     *   206/207/208/209 防御与防御率的四种组合
     *   211 "Health: %d / %d"      213 "Mana: %d / %d"
     *   215/216 魔法伤害          217 "Point: %u"     199 "Spare points: %d / %d"
     *
     * 注意 [64]：源码里 `sprintf(Buffer, GlobalText[64], defRate)` 打的其实是
     * 防御率，但这份 Text.bmd 的 [64] 是 "Attack speed: %d"（西语版行号偏了），
     * [67] 才是 "Defense rate: %d"，所以这里按语义取 67。
     */
    this.setText('level', t.fmt(200, this.charLevel, MAX_LEVEL));
    this.setText('exp', t.fmt(201, info.experience, info.nextExperience));
    this.setText('strength', t.fmt(202, str));
    // 有点数才带 (额外点数)，和原版 CA+58 的分支一致
    this.setText('damage', t.fmt(204, dmgMin, dmgMax));
    this.setText('agility', t.fmt(205, agi));
    this.setText('defense', t.fmt(209, defBase));
    this.setText('defrate', t.fmt(67, defRate));
    this.setText('vitality', t.fmt(210, info.vitality));
    this.setText('life', t.fmt(211, info.life, info.maxLife));
    this.setText('energy', t.fmt(212, info.energy));
    this.setText('mana', t.fmt(213, info.mana, info.maxMana));
    // 魔法伤害只对法系（DW=0 / MG=3）有意义，和原版 classFlag 判定一致
    this.setText(
      'magic',
      this.charClass === 0 || this.charClass === 3 ? t.fmt(216, 0, 0) : ''
    );

    const pts = info.levelUpPoint;
    this.setText('points', pts > 0 ? t.fmt(217, pts) : '');
    this.setText('reset', t.fmt(199, 0, 0));

    this.plusEls.forEach(el => (el.style.display = pts > 0 ? '' : 'none'));
  }

  /* ---------------------------------------------------------------- */
  /* 开关                                                              */
  /* ---------------------------------------------------------------- */

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    void this.ready.then(() => this.paint());
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
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
