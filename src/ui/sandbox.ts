/**
 * 离线演示的「角色 / 装备 / 技能」面板。
 *
 * 版式照参考图：三张卡片 —— CHARACTER（职业下拉）、EQUIPMENT（8 个部位下拉）、
 * SKILL（技能下拉 + Cast），深蓝底 + 青色描边，标签在框上方。
 * 装备数据全部来自 `Data/Local/item.bmd`（见 `src/data/equipCatalog.ts`），
 * 技能数据来自 `Data/Local/skill.bmd`（见 `src/data/skills.ts`），都不是写死的清单。
 *
 * 交互约定：
 *   - 点开某个部位只能选 item.bmd 里 `RequireXxx` 允许该职业、且模型文件存在的装备；
 *   - 换职业时会把「新职业穿不了」的已选部位清空（否则会挂一件看不见的装备）；
 *   - 技能卡片的 Cast 只负责「请求释放」，具体打谁 / 怎么打由 main.ts 决定；
 *   - 任何改动都通过 `onChange` 一次性抛出完整状态，main.ts 只负责套用 + 重建外观。
 */
import {
  EQUIP_SLOTS,
  SANDBOX_CLASSES,
  loadEquipCatalog,
  optionsForSlot,
  type EquipOption,
  type EquipSlotKey,
} from '../data/equipCatalog';
import {
  JOB_LABEL,
  JOB_ORDER,
  canUse,
  jobOfClassId,
  loadSkills,
  skillSource,
  type SkillEntry,
} from '../data/skills';
import { castOf } from '../data/skillFx';

export interface SandboxState {
  cls: number;
  slots: Record<EquipSlotKey, number | undefined>;
}

type Slots = Record<EquipSlotKey, number | undefined>;

function emptySlots(): Slots {
  return Object.fromEntries(EQUIP_SLOTS.map(s => [s.key, undefined])) as Slots;
}

export class SandboxPanel {
  private readonly root: HTMLDivElement;
  private readonly selects = new Map<EquipSlotKey, HTMLSelectElement>();
  private readonly collapse = new Set<HTMLElement>();
  private catalog: EquipOption[] = [];
  private cls = 0;
  private slots = emptySlots();
  private loadSeq = 0;

  private skills: SkillEntry[] = [];
  private skillSel: HTMLSelectElement | null = null;
  private castBtn: HTMLButtonElement | null = null;
  private hintEl: HTMLElement | null = null;
  /** 技能 id → 下拉里的 option，切职业时只改这几项的 disabled/文案，不重建 DOM */
  private readonly skillOpts = new Map<number, HTMLOptionElement>();

  /** 状态变化回调（职业/装备任一改动） */
  onChange: (state: SandboxState) => void = () => {};
  /** 点了 Cast：把选中的技能抛给 main.ts（那里才知道目标是谁） */
  onCast: (skill: SkillEntry) => void = () => {};

  /**
   * 用户是否主动展开面板（跨会话记忆）。
   *
   * 手机上这堆下拉框会挡掉半个屏幕，所以默认**收起**；点右下角那个小按钮才展开。
   * 注意它和 `show()` 不是一回事：`show()` 是「此刻能不能显示」（进图 / 离线沙盘 /
   * 读条中），这里记的是「用户想不想看」。
   */
  private userOpen = false;
  /** 展开/收起按钮（挂在 stage 上，不在 `this.root` 里 —— 面板隐藏时按钮要留着） */
  private toggleBtn: HTMLButtonElement;
  /** 此刻是否允许显示（离线沙盘 && 已进图 && 不在读条） */
  private available = false;

  constructor(stage: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'sandbox';
    this.root.className = 'hidden';
    // 面板上的点击不要漏给 3D 画面（点地板会走位）
    for (const type of ['pointerdown', 'mousedown', 'click', 'wheel'] as const) {
      this.root.addEventListener(type, e => e.stopPropagation());
    }

    this.root.append(this.buildClassCard(), this.buildEquipCard(), this.buildSkillCard());
    stage.appendChild(this.root);

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.type = 'button';
    this.toggleBtn.id = 'sandbox-toggle';
    this.toggleBtn.className = 'sb-toggle hidden';
    this.userOpen = localStorage.getItem('mu.sandboxOpen') === '1';
    this.paintToggle();
    this.toggleBtn.addEventListener('click', e => {
      // 别把点击漏给 3D 画面（否则点一下就走位）
      e.stopPropagation();
      this.toggleUser();
    });
    for (const type of ['pointerdown', 'mousedown', 'wheel'] as const) {
      this.toggleBtn.addEventListener(type, e => e.stopPropagation());
    }
    stage.appendChild(this.toggleBtn);

    this.installDrag(stage);
    this.restorePos();
  }

  /* ---------------- 展开 / 收起 ---------------- */

  /**
   * 用户点了按钮（或按 P）。
   *
   * 记到 `localStorage`，下次进来还是这个样子；手机用户不爱每次点。
   */
  toggleUser() {
    this.userOpen = !this.userOpen;
    localStorage.setItem('mu.sandboxOpen', this.userOpen ? '1' : '0');
    this.paintToggle();
    this.show(this.available && this.userOpen);
  }

  /** 「此刻能不能显示」：离线沙盘 && hud 可见 && 不在读条。由 `showScreens` 调用 */
  setAvailable(on: boolean) {
    this.available = on;
    this.toggleBtn.classList.toggle('hidden', !on);
    if (!on) this.show(false);
  }

  private paintToggle() {
    this.toggleBtn.textContent = this.userOpen ? '收起面板' : '演示面板';
    this.toggleBtn.classList.toggle('on', this.userOpen);
  }

  /* ---------------- 拖动 ----------------
   *
   * 面板是「卡片堆」，没有标题栏，所以**按住卡片标题**就能拖（`.sb-head`）。
   * 只认标题不认整块面板：卡片内容区是可滚动的，整块都能拖的话就没法滚了。
   *
   * 位置存 `localStorage['mu.sandbox.pos']`，下次打开还在原处；
   * 拖完那一下就松手时浏览器还会补一个 click，用 `justDragged` 吃掉，
   * 免得「拖一下顺便把卡片折叠了」。
   */

  private dragging: { dx: number; dy: number; sx: number; sy: number; moved: boolean } | null = null;
  private justDragged = false;

  private installDrag(stage: HTMLElement) {
    this.root.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const onHead = (e.target as HTMLElement).closest('.sb-head');
      if (!onHead) return;
      const rect = this.root.getBoundingClientRect();
      this.dragging = {
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
        sx: e.clientX,
        sy: e.clientY,
        moved: false,
      };
    });

    this.root.addEventListener('pointermove', e => {
      const d = this.dragging;
      if (!d) return;
      if (!d.moved) {
        // 3px 以内当点击（切换折叠），超过才开始拖
        if (Math.abs(e.clientX - d.sx) < 3 && Math.abs(e.clientY - d.sy) < 3) return;
        d.moved = true;
        this.root.classList.add('dragging');
        this.root.setPointerCapture(e.pointerId);
      }
      const sr = stage.getBoundingClientRect();
      const w = this.root.offsetWidth;
      const h = this.root.offsetHeight;
      // 夹在舞台上，别拖出画面
      const left = Math.max(0, Math.min(sr.width - w, e.clientX - d.dx - sr.left));
      const top = Math.max(0, Math.min(sr.height - h, e.clientY - d.dy - sr.top));
      this.root.style.left = `${Math.round(left)}px`;
      this.root.style.top = `${Math.round(top)}px`;
      this.root.style.right = 'auto';
    });

    const end = (e: PointerEvent) => {
      const d = this.dragging;
      if (!d) return;
      this.dragging = null;
      this.root.classList.remove('dragging');
      try {
        this.root.releasePointerCapture(e.pointerId);
      } catch {
        /* 没捕获过就忽略 */
      }
      if (!d.moved) return;
      this.justDragged = true;
      setTimeout(() => (this.justDragged = false), 0);
      try {
        localStorage.setItem(
          'mu.sandbox.pos',
          JSON.stringify([parseFloat(this.root.style.left), parseFloat(this.root.style.top)])
        );
      } catch {
        /* 隐私模式写不进去，忽略 */
      }
    };
    /*
     * 收尾挂在 **window** 上：拖到面板外面松手（甚至拖出可视区再回来）也要能结束，
     * 只挂 root 的话，指针一出面板就收不到事件，`dragging` 会一直留着 ——
     * 下一次随便动动鼠标面板就自己跟着跑。
     */
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    this.root.addEventListener('lostpointercapture', e => {
      if (this.dragging) end(e as PointerEvent);
    });
  }

  private restorePos() {
    try {
      const raw = localStorage.getItem('mu.sandbox.pos');
      if (!raw) return;
      const [left, top] = JSON.parse(raw) as [number, number];
      if (Number.isFinite(left) && Number.isFinite(top)) {
        this.root.style.left = `${Math.max(0, left)}px`;
        this.root.style.top = `${Math.max(0, top)}px`;
        this.root.style.right = 'auto';
      }
    } catch {
      /* 坏数据就当没存过 */
    }
  }

  /* ---------------- DOM ---------------- */

  private card(title: string, startCollapsed = false): { card: HTMLElement; body: HTMLElement } {
    const card = document.createElement('section');
    card.className = 'sb-card';

    const head = document.createElement('header');
    head.className = 'sb-head';
    const text = document.createElement('span');
    text.className = 'sb-title';
    text.textContent = title;
    const chev = document.createElement('span');
    chev.className = 'sb-chev';
    head.append(text, chev);

    const body = document.createElement('div');
    body.className = 'sb-body';
    card.append(head, body);
    this.collapse.add(body);
    head.addEventListener('click', () => {
      // 刚拖完：这一下 click 是拖动的尾巴，不要折叠
      if (this.justDragged) return;
      const off = body.classList.toggle('sb-collapsed');
      chev.classList.toggle('sb-chev-up', !off);
    });
    if (startCollapsed) body.classList.add('sb-collapsed');
    return { card, body };
  }

  private field(parent: HTMLElement, label: string): HTMLSelectElement {
    const wrap = document.createElement('label');
    wrap.className = 'sb-field';
    const span = document.createElement('span');
    span.className = 'sb-label';
    span.textContent = label;

    const box = document.createElement('div');
    box.className = 'sb-select';
    const sel = document.createElement('select');
    box.appendChild(sel);

    wrap.append(span, box);
    parent.appendChild(wrap);
    return sel;
  }

  private buildClassCard(): HTMLElement {
    const { card, body } = this.card('Character');
    const sel = this.field(body, 'Class');
    for (const c of SANDBOX_CLASSES) {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = c.name;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => void this.setClass(Number(sel.value)));
    return card;
  }

  /**
   * 装备卡片默认折叠。
   *
   * 三张卡片全展开有 756 px 高，而面板一屏只有 560 px（要躲开底栏的血蓝球），
   * 技能卡片会被挤到滚动区外面 —— 「点 Cast」就成了要滚 200 px 才能做的事。
   * 折叠后 Character + Equipment(标题) + Skill 一屏放得下，要用装备点一下标题即可。
   */
  private buildEquipCard(): HTMLElement {
    const { card, body } = this.card('Equipment', true);
    for (const s of EQUIP_SLOTS) {
      const sel = this.field(body, s.label);
      this.selects.set(s.key, sel);
      sel.addEventListener('change', () => {
        const v = sel.value === '' ? undefined : Number(sel.value);
        this.slots[s.key] = v;
        this.emit();
      });
    }
    return card;
  }

  /**
   * 技能卡片：下拉 + Cast 按钮。
   *
   * 下拉内容是 `skill.bmd` 里**所有有名字的技能**（45 个，最大编号 56），
   * 按职业分组。选项文本带上耗蓝和射程，因为这是离线演示，
   * 面板本身就是唯一的"技能描述"。
   */
  private buildSkillCard(): HTMLElement {
    const { card, body } = this.card('Skill');

    this.skillSel = this.field(body, 'Skill');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sb-cast';
    btn.textContent = 'Cast';
    btn.disabled = true;
    btn.addEventListener('click', () => {
      const skill = this.skills.find(s => s.id === Number(this.skillSel?.value));
      if (skill) this.onCast(skill);
    });
    body.appendChild(btn);
    this.castBtn = btn;

    const hint = document.createElement('p');
    hint.className = 'sb-hint';
    hint.textContent = 'Loading skills…';
    body.appendChild(hint);
    this.hintEl = hint;

    void this.fillSkills();
    return card;
  }

  private async fillSkills() {
    let list: SkillEntry[] = [];
    try {
      list = await loadSkills();
    } catch (err) {
      console.warn('[sandbox] skill.bmd 读取失败', err);
    }
    this.skills = list;
    const sel = this.skillSel;
    if (!sel) return;

    sel.textContent = '';
    this.skillOpts.clear();
    // 按职业分组（optgroup）：组按 **主职业**（jobs[0]）分，位置固定不随选中的职业跳动
    for (const job of JOB_ORDER) {
      const items = list.filter(s => s.job === job);
      if (!items.length) continue;
      const g = document.createElement('optgroup');
      g.label = `${JOB_LABEL[job]} · ${items.length}`;
      for (const s of items) {
        const opt = document.createElement('option');
        opt.value = String(s.id);
        this.skillOpts.set(s.id, opt);
        g.appendChild(opt);
      }
      sel.appendChild(g);
    }
    sel.disabled = list.length === 0;
    // 文案和可用性都由 refreshSkillAvailability 统一写（它知道当前职业）
    this.refreshSkillAvailability();
  }

  /**
   * 按当前沙盘职业刷新每个技能的可选状态。
   *
   * 职业归属来自服务端 `Skill.txt`（`skills.ts` 的 `SKILL_JOBS`），
   * 口径跟装备下拉一致：**不属于本职业的技能留在列表里但禁用**。
   * 不直接从列表里删掉 —— 删了会让人以为「这个技能没做」，
   * 而灰色 + ✕ 能看出「有，但这个职业用不了」。
   */
  private refreshSkillAvailability(): void {
    const sel = this.skillSel;
    if (!sel) return;
    const job = jobOfClassId(this.cls);
    let usable = 0;
    let firstUsable: string | null = null;
    let fromClient = 0;
    let noVis = 0;

    for (const s of this.skills) {
      const opt = this.skillOpts.get(s.id);
      if (!opt) continue;
      const ok = canUse(s, job);
      opt.disabled = !ok;
      /*
       * 前缀标出这件事的特效是从哪来的：
       *   ◆ = 客户端源码里查到了（MoveCharacter / AttackStage 的 CreateEffect）
       *   ○ = 源码没覆盖，走表现兜底
       *   — = 源码本来没有视觉（只播动作）
       *   ✕ = 当前职业用不了（和特效来源无关）
       */
      const spec = castOf(s);
      if (spec.source === 'client') fromClient++;
      if (spec.source === 'none') noVis++;
      const mark = !ok ? '✕' : spec.source === 'client' ? '◆' : spec.source === 'none' ? '—' : '○';
      const tail = spec.source === 'none' ? '无特效' : `${spec.parts.length} 件`;
      opt.textContent = `${mark} ${s.name}  ·  ${s.mana} MP  ·  ${tail}`;
      if (ok) {
        usable++;
        if (!firstUsable) firstUsable = String(s.id);
      }
    }

    // 选中的那个变成不可用了就跳到第一个可用的（否则按 Cast 会放一个本职业没有的技能）
    const cur = sel.selectedOptions[0];
    if ((!cur || cur.disabled) && firstUsable) sel.value = firstUsable;

    if (this.castBtn) this.castBtn.disabled = usable === 0;
    this.setHint(
      this.skills.length
        ? `${JOB_LABEL[job]} 可用 ${usable}/${this.skills.length} · ◆源码 ${fromClient} / ○兜底 ${
            this.skills.length - fromClient - noVis
          } / —无特效 ${noVis} · ${skillSource() === 'chs' ? 'chs/skill.bmd' : 'skill.bmd'}`
        : 'skill.bmd 里没有可用技能'
    );
  }

  /** 面板底部的说明文字（main.ts 用它写「目标在哪」） */
  setHint(text: string) {
    if (this.hintEl) this.hintEl.textContent = text;
  }

  /** 当前选中的技能（探针用） */
  selectedSkill(): SkillEntry | null {
    return this.skills.find(s => s.id === Number(this.skillSel?.value)) ?? null;
  }

  /* ---------------- 状态 ---------------- */

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }

  /** 用户想不想看（跟「此刻能不能显示」无关，见 `setAvailable`） */
  get userOpened() {
    return this.userOpen;
  }

  state(): SandboxState {
    return { cls: this.cls, slots: { ...this.slots } };
  }

  /**
   * 装一把默认武器（离线演示用）。
   *
   * 41 霹雳回旋斩 / 42 雷霆裂闪 的视觉都是「转 / 砸 **玩家手上的武器**」——
   * 源码取的是 `owner[136] + 400`（当前武器模型），空手时这两个技能**什么都不画**。
   * 而离线演示默认就是空装，第一次点会以为技能坏了，所以进图前先给一把。
   */
  equipDefaultWeapon(): number | undefined {
    const opt = optionsForSlot(this.catalog, 0)[0];
    if (!opt) return undefined;
    this.setSlot('weapon', opt.type);
    return opt.type;
  }

  /** 只改某个部位（探针/快捷键用），不重建整个列表 */
  setSlot(key: EquipSlotKey, type: number | undefined) {
    this.slots[key] = type;
    const sel = this.selects.get(key);
    if (sel) sel.value = type === undefined ? '' : String(type);
    this.emit();
  }

  /** 切职业：重新拉该职业的目录，清掉穿不了的部位 */
  async setClass(cls: number) {
    this.cls = cls & 7;
    const seq = ++this.loadSeq;
    this.catalog = await loadEquipCatalog(this.cls);
    if (seq !== this.loadSeq) return; // 期间又切了职业，这次结果作废

    for (const s of EQUIP_SLOTS) {
      const cur = this.slots[s.key];
      if (cur !== undefined && !this.catalog.some(o => o.type === cur)) this.slots[s.key] = undefined;
    }
    this.rebuildOptions();
    // 技能下拉也要跟着职业走：不属于新职业的技能禁用掉
    this.refreshSkillAvailability();
    this.emit();
  }

  private rebuildOptions() {
    for (const s of EQUIP_SLOTS) {
      const sel = this.selects.get(s.key);
      if (!sel) continue;
      const keep = this.slots[s.key];
      sel.textContent = '';

      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'None';
      sel.appendChild(none);

      for (const opt of optionsForSlot(this.catalog, s.slot)) {
        const el = document.createElement('option');
        el.value = String(opt.type);
        el.textContent = opt.name;
        sel.appendChild(el);
      }

      sel.value = keep === undefined ? '' : String(keep);
      // 目录为空（比如魔剑士没有头盔）时把下拉禁用，别让人以为是卡了
      sel.disabled = sel.options.length <= 1;
    }
  }

  private emit() {
    this.onChange(this.state());
  }
}
