/**
 * 任务窗口（0xA0 / 0xA1 / 0xA2 / 0xA3）。
 *
 * 服务端只发**状态位**，任务的名字/条件/目标/奖励全在 `Data/Quest/*.txt` 里
 * （解析见 `src/data/quests.ts`）。窗口左边是任务列表（按数据表里的顺序），
 * 右边是当前选中任务的详情 + 一个「接取 / 完成」按钮。
 *
 * 为什么按钮只有两个状态：服务端 `CGQuestStateRecv` **只看任务号**，
 * 由它按当前状态决定「未接 → 接取」还是「进行中 → 完成」，
 * 所以客户端不需要（也不应该）自己编状态，点一下让服务端判就行。
 */
import type { UiLayer } from './frame';
import { itemAttr } from '../data/itemAttrs';
import {
  QUEST_STATE,
  QUEST_STATE_LABEL,
  objectivesOf,
  rewardsOf,
  rowOf,
  type QuestDef,
} from '../data/quests';

const PANEL = { x: 196, y: 20, w: 250, h: 372 };
const LIST_W = 108;
const ROW_H = 16;

export class QuestPanel {
  private el: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private listEl: HTMLDivElement;
  private detailTitle: HTMLDivElement;
  private detailBody: HTMLDivElement;
  private actionBtn: HTMLButtonElement;
  private emptyEl: HTMLDivElement;

  private quests: QuestDef[] = [];
  private states = new Map<number, number>();
  private selected = -1;
  private open = false;

  /** 点「接取 / 完成」（由上层发 0xA2） */
  onAction: ((index: number) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'quest-panel hidden';
    this.el.style.left = `${PANEL.x}px`;
    this.el.style.top = `${PANEL.y}px`;
    this.el.style.width = `${PANEL.w}px`;
    this.el.style.height = `${PANEL.h}px`;

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'quest-title';
    this.titleEl.textContent = '任务';

    const close = document.createElement('button');
    close.className = 'quest-close';
    close.textContent = '×';
    close.addEventListener('click', () => this.onClose?.());

    this.listEl = document.createElement('div');
    this.listEl.className = 'quest-list';
    this.listEl.style.width = `${LIST_W}px`;

    this.detailTitle = document.createElement('div');
    this.detailTitle.className = 'quest-detail-title';

    this.detailBody = document.createElement('div');
    this.detailBody.className = 'quest-detail-body';

    this.actionBtn = document.createElement('button');
    this.actionBtn.className = 'quest-action';
    this.actionBtn.addEventListener('click', () => {
      if (this.selected >= 0) this.onAction?.(this.selected);
    });

    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'quest-empty';
    this.emptyEl.textContent = '没有可接的任务';

    this.el.append(this.titleEl, close, this.listEl, this.detailTitle, this.detailBody, this.actionBtn, this.emptyEl);
    layer.root.appendChild(this.el);
  }

  get isOpen() {
    return this.open;
  }

  get currentIndex() {
    return this.selected;
  }

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    this.paintList();
    this.paintDetail();
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  /** 更新整份数据（0xA0 到达时） */
  setQuests(quests: QuestDef[], states: Map<number, number>) {
    this.quests = quests;
    this.states = states;
    if (this.selected < 0 || !quests.some(q => q.index === this.selected)) {
      this.selected = quests[0]?.index ?? -1;
    }
    if (this.open) {
      this.paintList();
      this.paintDetail();
    }
  }

  /** 单个任务状态变化（0xA1 / 0xA2） */
  setState(index: number, state: number) {
    this.states.set(index, state);
    if (this.open) {
      this.paintList();
      if (index === this.selected) this.paintDetail();
    }
  }

  select(index: number) {
    this.selected = index;
    this.paintList();
    this.paintDetail();
  }

  /** 标题：数据表没有名字，用「目标/奖励」拼一个可读的 */
  private titleOf(def: QuestDef): string {
    const state = this.states.get(def.index) ?? 0;
    const obj = objectivesOf(def, state)[0];
    if (obj) {
      if (obj.type === 2) return `支付 ${obj.value.toLocaleString('en-US')} Zen`;
      return `${itemAttr(obj.index).name} ×${obj.value}`;
    }
    const reward = rewardsOf(def, state)[0];
    if (reward?.type === 2) return '职业进化';
    if (reward?.type === 1) return `升级点 +${reward.value}`;
    return `任务 ${def.index}`;
  }

  private paintList() {
    this.listEl.textContent = '';
    this.emptyEl.classList.toggle('hidden', this.quests.length > 0);

    for (const def of this.quests) {
      const state = this.states.get(def.index) ?? 0;
      const row = document.createElement('div');
      row.className = `quest-row${def.index === this.selected ? ' active' : ''} state-${state}`;
      row.style.top = `${4 + this.quests.indexOf(def) * ROW_H}px`;

      const name = document.createElement('span');
      name.className = 'quest-row-name';
      name.textContent = this.titleOf(def);

      const tag = document.createElement('span');
      tag.className = 'quest-row-tag';
      tag.textContent = QUEST_STATE_LABEL[state] ?? '';

      row.append(name, tag);
      row.addEventListener('click', () => this.select(def.index));
      this.listEl.appendChild(row);
    }
  }

  private paintDetail() {
    const def = this.quests.find(q => q.index === this.selected);
    if (!def) {
      this.detailTitle.textContent = '';
      this.detailBody.textContent = '';
      this.actionBtn.classList.add('hidden');
      return;
    }
    const state = this.states.get(def.index) ?? 0;
    const row = rowOf(def, state);

    this.detailTitle.textContent = `任务 ${def.index} · ${QUEST_STATE_LABEL[state]}`;
    this.detailTitle.className = `quest-detail-title state-${state}`;

    const lines: string[] = [];
    if (row) {
      if (row.minLevel > 0) lines.push(`需求等级：${row.minLevel}`);
      if (row.requireIndex >= 0) lines.push(`前置：任务 ${row.requireIndex}（${QUEST_STATE_LABEL[row.requireState] ?? '-'}）`);
    }
    const objs = objectivesOf(def, state);
    if (objs.length) {
      lines.push('');
      lines.push('目标：');
      for (const o of objs) {
        lines.push(
          o.type === 2
            ? `  · 持有 ${o.value.toLocaleString('en-US')} Zen`
            : `  · ${itemAttr(o.index).name} ×${o.value}`
        );
      }
    }
    /*
     * 奖励挂的是 **RequireState = ACCEPT(1)** 那一行 —— 服务端在「进行中 → 完成」
     * 这一步才发奖（`InsertQuestReward` 按 requireState 过滤）。
     * 所以未接取时也要把「完成后能拿到什么」显示出来，否则详情里没有奖励一栏。
     */
    const rws = rewardsOf(def, QUEST_STATE.ACCEPT);
    if (rws.length) {
      lines.push('');
      lines.push('奖励：');
      for (const r of rws) {
        lines.push(r.type === 2 ? '  · 职业进化' : `  · 升级点 +${r.value}`);
      }
    }
    this.detailBody.textContent = lines.join('\n');

    // 已完成 / 已取消（取消可以重新接，按服务端语义仍走「接取」）
    const actionable = state === QUEST_STATE.NORMAL || state === QUEST_STATE.ACCEPT || state === QUEST_STATE.CANCEL;
    this.actionBtn.classList.toggle('hidden', !actionable);
    this.actionBtn.textContent = state === QUEST_STATE.ACCEPT ? '完成' : '接取';
    this.actionBtn.disabled = !actionable;
  }

  /** 探针用快照 */
  snapshot() {
    return {
      open: this.open,
      selected: this.selected,
      quests: this.quests.map(q => ({
        index: q.index,
        npc: q.npcClass,
        state: this.states.get(q.index) ?? 0,
        title: this.titleOf(q),
      })),
      detail: this.detailBody.textContent,
      action: this.actionBtn.classList.contains('hidden') ? null : this.actionBtn.textContent,
    };
  }
}
