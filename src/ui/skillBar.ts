/**
 * 技能栏 —— 0.97 客户端底栏上那排技能图标。
 *
 * 出处：`Render/HUD_Pass5.cpp:341-386`（`sub_4BD650` 里技能栏那一段）
 * + `UI/UI_SkillHotkeys.cpp`（`RenderSkillIcon` / `FindHotKey`）
 * + `UI/Chat_InputTick.cpp:584-655`（点击、Ctrl+数字设键位、数字键选技能）。
 *
 * 原版版式（640×480 逻辑坐标，数字全是绝对值）：
 *
 *   主技能（当前选中）： (304, 444) 32×36 —— 压在 Menu02 那个圆孔上
 *   展开的一排：          y = 370，32×36，**居中**：
 *                         x = 320 - count*16 + i*32   （i 只数「有技能」的格子）
 *   展开条件：            点主技能图标（命中框 x 304..335 / y 444..479）
 *   点某一格：            把它设成主技能，同时收起这一排
 *   Ctrl + 数字（悬停时）：把该数字设成这格的快捷键（同一数字只留一个）
 *   数字键 1..0：         按快捷键选中技能（`SelectSkillByHotkey`）
 *
 * 图标是**一张 256×256 的图集** `Interface/Skill.ozj`，8 列 × 7 行，
 * 每格 32×36（第 7 行后面剩 4 px 是纯黑填充 —— 这正是原版按 36 步进 V 的原因）。
 * 原版是 `atlasIndex = skillId - 1`，所以技能号 1..56 恰好铺满 7 行。
 *
 * 上色：非主技能格原版用 `glColor3f(0.6, 0.7, 0.8)` 压暗（叠乘），
 * 这里用一个 `mix-blend-mode: multiply` 的色块实现同一效果。
 */

import { preloadUi, uiSprite } from './ozj';

/** 图集格尺寸（= 原版 RenderSkillIcon 的 width/height 参数） */
const CELL_W = 32;
const CELL_H = 36;
/** 图集列数（原版 `atlasIndex % 8`） */
const COLS = 8;

/** 主技能图标位置（`HUD_Pass5.cpp:346`） */
const MAIN_X = 304;
const MAIN_Y = 444;
/** 展开一排的 y（`HUD_Pass5.cpp:365`） */
const ROW_Y = 370;
/** 居中基准（屏幕宽 640 的一半） */
const CENTER_X = 320;

export interface SkillBarEntry {
  /** 服务端技能槽位（0..59），用作 Key */
  slot: number;
  /** 技能号（1..56） */
  skill: number;
  /** 技能等级（0..3） */
  level: number;
  /** 技能名（`skill.bmd`，用来做悬停提示） */
  name?: string;
  /** 蓝耗（`skill.bmd` 的 ManaUse） */
  mana?: number;
}

/** 图集里一格的位置：技能号 → 列/行 */
function atlasPos(skill: number) {
  const idx = Math.max(0, skill - 1);
  return { col: idx % COLS, row: Math.floor(idx / COLS) };
}

export class SkillBar {
  private root: HTMLDivElement;
  private row: HTMLDivElement;
  private mainBtn: HTMLButtonElement;
  private tip: HTMLDivElement;
  private mainArt: HTMLDivElement;
  private mainKey: HTMLSpanElement;

  private atlasUrl: string | null = null;
  private skills: SkillBarEntry[] = [];
  /** 主技能槽位（原版 `Hero+913`） */
  private selected = 0;
  /** slot → 快捷键（1..9、10 表示「0」键） */
  private hotkeys = new Map<number, number>();
  private open = false;
  /** 鼠标当前悬停的槽位（Ctrl+数字 设键位要按它走，-1 = 没悬停） */
  private hoveredSlot = -1;

  /** 点了某个技能格（选中它） */
  onSelect: ((slot: number) => void) | null = null;
  /** 展开/收起（原版点主图标那个动作） */
  onToggle: ((open: boolean) => void) | null = null;
  /** Ctrl+数字：把快捷键写到这个槽位 */
  onHotkey: ((slot: number, key: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    // 这一层始终存在（整层由 `UiLayer` 的 hidden 控制）；没有技能时
    // 主图标和那排格子自己 `hidden`，和原版「`CA[86] != 0` 才画」一致
    this.root.className = 'skill-bar';
    parent.appendChild(this.root);

    this.row = document.createElement('div');
    this.row.className = 'skill-row';
    this.root.appendChild(this.row);

    this.tip = document.createElement('div');
    this.tip.className = 'skill-tip hidden';
    this.root.appendChild(this.tip);

    // 主技能图标 = 展开/收起的开关（原版命中框就是它的矩形）
    this.mainBtn = document.createElement('button');
    this.mainBtn.type = 'button';
    this.mainBtn.className = 'skill-main hidden';
    this.mainBtn.title = '技能栏（点击展开）';
    this.mainBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.setOpen(!this.open);
      this.onToggle?.(this.open);
    });

    this.mainArt = document.createElement('div');
    this.mainArt.className = 'skill-art';
    this.mainBtn.appendChild(this.mainArt);

    this.mainKey = document.createElement('span');
    this.mainKey.className = 'skill-key';
    this.mainBtn.appendChild(this.mainKey);

    this.root.appendChild(this.mainBtn);

    void this.build();
  }

  private async build() {
    await preloadUi(['Skill']);
    const spr = await uiSprite('Skill');
    if (!spr) {
      console.warn('[skillbar] Interface/Skill.ozj 载入失败，技能图标将只有色块');
      return;
    }
    this.atlasUrl = spr.url;
    this.root.dataset.atlas = `${spr.width}x${spr.height}`;
    this.paint();
  }

  /* ---------------------------------------------------------------- */
  /* 数据                                                              */
  /* ---------------------------------------------------------------- */

  /** 整表替换（`0xF3/0x11` 的 list / add / del 三种语义由调用方先合并好） */
  setSkills(list: SkillBarEntry[]) {
    this.skills = list.filter(s => s.skill > 0);
    if (!this.skills.some(s => s.slot === this.selected)) {
      this.selected = this.skills[0]?.slot ?? 0;
    }
    this.paint();
  }

  /** 主技能槽位（= 右侧那一个图标） */
  setSelected(slot: number) {
    this.selected = slot;
    this.paint();
  }

  get selectedSlot() {
    return this.selected;
  }

  /** 当前选中的技能号（0 = 没有） */
  selectedSkillId(): number {
    return this.skills.find(s => s.slot === this.selected)?.skill ?? 0;
  }

  /** 整表替换快捷键映射（slot → 1..10） */
  setHotkeys(map: Map<number, number>) {
    this.hotkeys = new Map(map);
    this.paint();
  }

  /** 按快捷键找槽位（`SelectSkillByHotkey`：找不到返回 -1） */
  slotByHotkey(key: number): number {
    for (const [slot, k] of this.hotkeys) {
      if (k === key && this.skills.some(s => s.slot === slot)) return slot;
    }
    return -1;
  }

  /**
   * Ctrl+数字：把 `key`（1..10，10 = 「0」键）设成当前悬停那一格的快捷键。
   *
   * 原版（`Chat_InputTick.cpp:628-646`）会先把别处同一个数字清成 0xFF 再写 ——
   * 一个数字只绑一个技能。没悬停时返回 false，调用方可以放行按键。
   */
  assignHotkey(key: number): boolean {
    if (this.hoveredSlot < 0) return false;
    for (const [slot, k] of [...this.hotkeys]) {
      if (k === key && slot !== this.hoveredSlot) this.hotkeys.delete(slot);
    }
    this.hotkeys.set(this.hoveredSlot, key);
    this.onHotkey?.(this.hoveredSlot, key);
    this.paint();
    return true;
  }

  /** 悬停中的槽位（-1 = 没悬停） */
  get hovered() {
    return this.hoveredSlot;
  }

  setOpen(on: boolean) {
    this.open = on;
    this.row.classList.toggle('hidden', !on);
    if (!on) this.hideTip();
    this.layout();
  }

  get isOpen() {
    return this.open;
  }

  toggle() {
    this.setOpen(!this.open);
  }

  setVisible(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  /** 收起展开的一排（切面板 / 换图时用，别把旧技能留在画面上） */
  clear() {
    this.setSkills([]);
    this.setOpen(false);
  }

  /* ---------------------------------------------------------------- */
  /* 绘制                                                              */
  /* ---------------------------------------------------------------- */

  /** 造一个 32×36 的技能格（图集切片 + 压暗层 + 快捷键数字） */
  private cell(entry: SkillBarEntry, isMain: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'skill-cell';
    btn.dataset.slot = String(entry.slot);
    btn.dataset.skill = String(entry.skill);
    if (isMain) btn.classList.add('is-main');

    const art = document.createElement('div');
    art.className = 'skill-art';
    this.applyAtlas(art, entry.skill);
    btn.appendChild(art);

    if (!isMain) {
      // 原版 glColor3f(0.6, 0.7, 0.8)：叠乘一层 rgb(153,178,204)
      const dim = document.createElement('div');
      dim.className = 'skill-dim';
      btn.appendChild(dim);
    }

    const key = this.hotkeys.get(entry.slot);
    if (key) {
      const k = document.createElement('span');
      k.className = 'skill-key';
      k.textContent = String(key % 10);
      btn.appendChild(k);
    }

    btn.addEventListener('mouseenter', () => {
      this.hoveredSlot = entry.slot;
      this.showTip(entry);
    });
    btn.addEventListener('mouseleave', () => {
      if (this.hoveredSlot === entry.slot) this.hoveredSlot = -1;
      this.hideTip();
    });
    btn.addEventListener('click', e => {
      e.stopPropagation();
      this.selectFromClick(entry.slot, e.ctrlKey || e.metaKey);
    });
    return btn;
  }

  private applyAtlas(el: HTMLElement, skill: number) {
    const { col, row } = atlasPos(skill);
    if (this.atlasUrl) el.style.backgroundImage = `url(${this.atlasUrl})`;
    el.style.backgroundPosition = `-${col * CELL_W}px -${row * CELL_H}px`;
  }

  /** 点格子：普通点击 = 选中；Ctrl+点击 = 什么都不做（Ctrl 是配合数字键设键位） */
  private selectFromClick(slot: number, ctrl: boolean) {
    if (ctrl) return;
    this.selected = slot;
    this.setOpen(false);
    this.onSelect?.(slot);
    this.paint();
  }

  private paint() {
    // 展开的一排：先清空再按「有技能的格子」顺序铺（原版 `v92` 只数非空格）
    this.row.replaceChildren();
    const filled = this.skills;
    filled.forEach((entry, i) => {
      const btn = this.cell(entry, false);
      const x = CENTER_X - filled.length * 16 + i * CELL_W;
      btn.style.left = `${x}px`;
      btn.style.top = `${ROW_Y}px`;
      this.row.appendChild(btn);
    });
    this.row.classList.toggle('hidden', !this.open);

    // 主技能图标
    const main = this.skills.find(s => s.slot === this.selected) ?? null;
    this.mainBtn.classList.toggle('hidden', !filled.length);
    if (main) {
      this.applyAtlas(this.mainArt, main.skill);
      const key = this.hotkeys.get(main.slot);
      this.mainKey.textContent = key ? String(key % 10) : '';
      this.mainBtn.dataset.skill = String(main.skill);
      this.mainBtn.title = `${main.name ?? `技能 ${main.skill}`}（点击${this.open ? '收起' : '展开'}技能栏）`;
      this.layout();
    } else {
      this.mainArt.style.backgroundImage = 'none';
      this.mainKey.textContent = '';
    }
  }

  private layout() {
    this.mainBtn.style.left = `${MAIN_X}px`;
    this.mainBtn.style.top = `${MAIN_Y}px`;
  }

  /* ---------------------------------------------------------------- */
  /* 悬停提示                                                          */
  /* ---------------------------------------------------------------- */

  private showTip(entry: SkillBarEntry) {
    const name = entry.name ?? `技能 ${entry.skill}`;
    const lv = entry.level > 0 ? ` +${entry.level * 1}` : '';
    const mana = entry.mana ? ` · ${entry.mana} 蓝` : '';
    this.tip.textContent = `${name}${lv}${mana}`;
    const cell = this.root.querySelector<HTMLElement>(`.skill-cell[data-slot="${entry.slot}"]`);
    const left = cell ? parseFloat(cell.style.left || '0') : MAIN_X;
    this.tip.style.left = `${Math.min(560, Math.max(4, left - 8))}px`;
    this.tip.style.top = `${ROW_Y - 20}px`;
    this.tip.classList.remove('hidden');
  }

  private hideTip() {
    this.tip.classList.add('hidden');
  }

  /** 探针用：当前状态的快照 */
  snapshot() {
    return {
      open: this.open,
      selected: this.selected,
      skills: this.skills.map(s => ({ ...s })),
      hotkeys: Object.fromEntries(this.hotkeys),
      cells: Array.from(this.row.querySelectorAll<HTMLElement>('.skill-cell')).map(el => ({
        slot: Number(el.dataset.slot),
        skill: Number(el.dataset.skill),
        left: parseFloat(el.style.left || '0'),
        top: parseFloat(el.style.top || '0'),
      })),
    };
  }
}
