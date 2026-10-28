import { assetUrl } from './core/base';
import './style.css';
import * as THREE from 'three';
import {
  createTerrain,
  findSpawnTile,
  findSpawnTileInRect,
  LIGHT_TUNE,
  TerrainMesh,
  TERRAIN_SIZE,
  TW_SAFEZONE,
  TW_WATER,
  type SpawnRect,
} from './world/terrain';
import { createWorldObjects, emptyWorldObjects, StaticObjectStats, WorldObjectsResult } from './world/objects';
import { ObjectFxLayer } from './world/objectFx';
import { AmbientLayer, createAmbient } from './world/ambient';
import {
  PlayerAction,
  Actor,
  MODEL_YAW_OFFSET,
  createPlayer,
  createCreatureByClass,
  applyEquipment,
  setBackPose,
  BACK_FLIP,
  setWingPose,
  applyWingPose,
  type EquipSet,
} from './world/actor';
import {
  attackAction,
  idleAction,
  isFlying as isFlyingAnim,
  moveAction,
  warmPlayerAnimTables,
  weaponInfo,
  type AnimInput,
} from './world/playerAnim';
import { RemoteManager, setSelfName } from './world/remotes';
import { GroundItems, itemDisplayName, itemModelPath, loadProto } from './world/items';
import {
  buildAttackPacket,
  buildActionPacket,
  parseItemStackList,
  parseItemValueList,
  parseMoveList,
  buildBuyPacket,
  buildDropPacket,
  buildItemGetPacket,
  buildItemUsePacket,
  buildUnstackPacket,
  buildSkillAttackPacket,
  buildDurationSkillAttackPacket,
  parseDurationSkillCast,
  buildMultiSkillAttackPacket,
  buildSkillCancelPacket,
  parseSkillCancel,
  buildTeleportAllyPacket,
  DURATION_SKILLS,
  buildItemMovePacket,
  buildMovePacket,
  buildNpcClosePacket,
  buildViewportEnablePacket,
  buildNpcTalkPacket,
  buildRepairPacket,
  REPAIR_ALL_SLOT,
  buildSellPacket,
  buildWarehouseClosePacket,
  buildWarehouseMoneyPacket,
  buildWarehousePasswordPacket,
  dirFromDelta,
  DIR_VECTORS,
  NPC_TALK,
  parseBuyResult,
  parseContainerList,
  parseDropResult,
  parseItemGetResult,
  parseItemList,
  parseItemModify,
  parseEventTime,
  parseQuestInfo,
  parseQuestResult,
  parseQuestReward,
  decodeQuestClass,
  QUEST_REWARD_POINT,
  QUEST_REWARD_CLASS,
  QUEST_REWARD_CLASS_POINT,
  QUEST_REWARD_CLASS_ONLY,
  parseQuestStateUpdate,
  buildQuestStatePacket,
  buildPartyInvitePacket,
  buildPartyResponsePacket,
  buildPartyListRequest,
  buildPartyKickPacket,
  buildTradeRequestPacket,
  buildTradeResponsePacket,
  buildTradeMoneyPacket,
  buildTradeOkPacket,
  buildTradeCancelPacket,
  parseTradeRequest,
  parseTradeResponse,
  parseTradeItemDel,
  parseTradeItemAdd,
  parseTradeMoneyResult,
  parseTradeMoney,
  parseTradeOk,
  parseTradeResult,
  buildGoldenArcherRegisterPacket,
  buildGoldenArcherExchangePacket,
  buildGoldenArcherRegisterLuckyPacket,
  buildGoldenArcherExchangeLuckyPacket,
  parseGoldenArcherOpen,
  parseGoldenArcherRegister,
  parseGoldenArcherLuckyNumber,
  parseGoldenArcherInfo,
  parseGoldenArcherList,
  parseGoldenArcherRegisterLuckyResult,
  parseGoldenArcherExchangeLuckyResult,
  isGoldenArcherClose,
  GOLDEN_ARCHER_TYPE,
  GOLDEN_ARCHER_ITEM,
  type GoldenArcherInfo,
  buildGuildJoinRequestPacket,
  buildGuildJoinAnswerPacket,
  buildGuildListRequestPacket,
  buildGuildDeletePacket,
  buildGuildOpenCreatePacket,
  buildGuildCreatePacket,
  buildGuildCreateCancelPacket,
  buildGuildWarAnswerPacket,
  parseGuildRequest,
  parseGuildResult,
  parseGuildList,
  parseGuildDeleteResult,
  parseGuildCreateOpen,
  parseGuildCreateResult,
  parseGuildViewportCreate,
  parseGuildViewportDelete,
  parseGuildWarResult,
  parseGuildWarDeclare,
  parseGuildWarStart,
  parseGuildWarEnd,
  parseGuildWarScore,
  packGuildMark,
  type GuildListReply,
  buildChaosMixPacket,
  buildChaosClosePacket,
  buildDevilSquareEnterPacket,
  buildBloodCastleEnterPacket,
  buildEventRemainTimePacket,
  parseEventEnterResult,
  parseEventRemainTime,
  parseEventRequiredLevels,
  parseMatchState,
  parseMatchCountDown,
  parseDevilSquareRank,
  EVENT_TYPE,
  type EventLevelRange,
  buildChaosRatePacket,
  parseChaosMixResult,
  parseChaosRate,
  CHAOS_MIX_TYPES,
  parsePartyRequest,
  parsePartyResult,
  parsePartyList,
  parsePartyLife,
  type PartyMember,
  parseItemMoveResult,
  parseNpcTalk,
  parseSkillCast,
  parseSkillList,
  parseEffectState,
  parseLevelUp,
  calcNextLevelExp,
  parseWeather,
  parseMapAttr,
  type MapAttrChunk,
  parseSpecialTime,
  parseFruitResult,
  type FruitResult,
  SKILL_CANCEL_MASK,
  STATE_BIT,
  stateNames,
  type SkillListEntry,
  parseRepairResult,
  parseSellResult,
  parseViewportItemDestroy,
  parseViewportItems,
  parseWarehouseMoney,
  parseWarehouseState,
  yawFromDir,
  INVENTORY_SIZE,
  INVENTORY_WEAR_SIZE,
  TYPE_MONEY,
  type GroundItem,
  type InventoryItem,
  type SkillCastEvent,
} from './net/game';
import { DamageTexts } from './ui/damageText';
import { WorldTags, type TagItem } from './ui/worldTags';
import { EscMenu } from './ui/escMenu';
import { monsterMaxLifeOf, monsterNameOf } from './data/monsters';
import { ItemLabels, type GroundLabel } from './ui/itemLabels';
import { MinimapPanel, type MinimapMark } from './ui/minimapPanel';
import { UiLayer } from './ui/frame';
import { InventoryPanel } from './ui/inventory';
import { CharacterPanel } from './ui/character';
import { BottomBar } from './ui/bottomBar';
import { HudValues, QUICK_RANGES } from './ui/hudValues';
import { ChatBox, type ChatChannel } from './ui/chatBox';
import { NpcDialog } from './ui/npcDialog';
import { HelpWindow } from './ui/helpWindow';
import { SandboxPanel, type SandboxState } from './ui/sandbox';
import { MoveCommandPanel } from './ui/moveCommand';
import { NpcPanel } from './ui/npcPanel';
import { EventTimerPanel } from './ui/eventTimer';
import { PromptDialog } from './ui/dialog';
import { QuestPanel } from './ui/questPanel';
import { PartyPanel } from './ui/partyPanel';
import { TradePanel } from './ui/tradePanel';
import { ChaosPanel } from './ui/chaosPanel';
import { EventPanel } from './ui/eventPanel';
import { GoldenArcherPanel, formatLucky } from './ui/goldenArcherPanel';
import { SkillBar, type SkillBarEntry } from './ui/skillBar';
import { GuildPanel } from './ui/guildPanel';
import { checkMixRecipe, MIX_LABEL, mixErrorText } from './data/chaosRecipe';
import { loadQuests, questStateFromMask, setQuestStateInMask, type QuestData, type QuestDef } from './data/quests';
import { EffectLayer } from './world/effects';
import { SpriteLayer } from './world/sprites';
import { BeamLayer } from './world/beams';
import { TrailLayer } from './world/trails';
import { BuffLayer } from './world/buffs';
import {
  audioDebug,
  isMuted,
  playBgm,
  preloadSounds,
  resetAudioDebug,
  setListener,
  setMuted,
  setSceneAudio,
  sfx,
  sfxRandom,
  toggleMuted,
  unlockAudio,
} from './audio/sound';
import { BGM_LOGIN, SKILL_SOUND } from './data/sounds';
import { WeaponSlamLayer, WeaponWheelLayer } from './world/wheels';
import { MONSTER_ACTION } from './world/monsterModels';
import { SKILL_FX, loadSkills, type SkillEntry } from './data/skills';
import { BOW_SKILLS, castOf, sourceTag as fxTag, type CastSpec, type FxPart } from './data/skillFx';
import { attachIconRenderer, itemIcon, iconDebug, clearItemIcons } from './ui/itemIcon';
import { attachCharPreviewRenderer, charPreview } from './ui/charPreview';
import { initLoginSkin, initCharSkin } from './ui/loginSkin';
import { runIntro, initLoadingArt } from './ui/splash';
import { ServerDivisionPanel } from './ui/serverDivisionPanel';
import { setItemStackList, setItemValueList, setMoveList, itemValueOf, itemMaxStack, serverTablesSnapshot } from './data/serverTables';
import { setNpcNameTable, npcNameTableSize } from './data/monsters';
import { createLoginScene, type LoginSceneHandle } from './login/loginScene';
import { createCharScene, type CharSceneHandle } from './login/charScene';
import { createServerSelect } from './login/serverSelect';
import { uiSprite } from './ui/ozj';
import { initCursors, setCursor, tickCursor, rescaleCursors, cursorInfo } from './ui/cursor';
import { itemAttr, refreshItemNames } from './data/itemAttrs';
import { spinState } from './ui/itemSpin';
import { blendMetrics, detectBlend } from './core/blendHeuristic';
import { setAdditiveMode, useAdditiveBlend, additiveInfo, fxAlpha } from './core/additive';
import { loadTexture, resolveTextureCandidates } from './core/texture';
import {
  loadTextPool,
  textAt,
  textSync,
  textSource,
  loadItemNames,
  questDialogForNpc,
  questForNpc,
  loadQuests as loadQuestTable,
  loadNpcNames,
  itemNamesSize,
  questByIndex,
  questTextFor,
  type QuestDialogInfo,
} from './data/localText';
import { checkEquip, canPlaceInGrid } from './ui/itemRules';
import { findPath, nearestFree, type Cell } from './world/pathfinding';
import { MuCamera, pickTerrainPoint } from './world/camera';
import { loadSkyTexture } from './core/texture';
import { installDebugApi } from './debug';
import { TILE_NAMES, getMapDefinition, mapWorldDir } from './world/maps';
import { warpTable, syncWarpTable, applyServerMoveList, type WarpEntry } from './world/warp';
import { bridgeUrls, loadNetKeys, MuConnection, NetKeys } from './net/connection';
import { MuSession, LoginResult, CharacterSummary, CharacterInfo } from './net/session';
import { decodeServerText, encodeServerText, textCodecInfo } from './net/text';

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */
const DATA_ROOT = 'Data';
const PLAYER_DIR = `${DATA_ROOT}/Player/`;
const MONSTER_DIR = `${DATA_ROOT}/Monster/`;
// 目录名是大写 NPC：Vite 的静态服务在 Windows 上按字符串精确匹配，写 Npc 会回落成 index.html
const NPC_DIR = `${DATA_ROOT}/NPC/`;
const GAME_SERVER_PORT = 55901;
/** 桥上取到的服务端地址（只用于显示） */
const SERVER_LABEL = `127.0.0.1:${GAME_SERVER_PORT}`;

/** 离线演示的出生点（洛兰城内） */
const OFFLINE_SPAWN = { x: 133, y: 131 };

/**
 * 离线演示模式。
 *
 * 访问 `/demo`（或任意页面加 `?demo=1`）时整条流程**不碰网络**：
 *
 * ```
 * 选线路（假列表）→ 账号密码（随便填）→ 角色选择（假角色）→ 进游戏（沙盘）
 * ```
 *
 * - 假线路：`createServerSelect({ demo: true })`，不然本机没 44405 时
 *   第一屏要等连接超时，还刷一屏 WebSocket 错误。
 * - 假角色：4 个职业各一只（`DEMO_CHARS`），点「进入游戏」直接进洛兰。
 * - 进图后走的是**离线沙盘**（`sandbox.on`），职业/装备由沙盘面板决定，
 *   和服务端无关 —— 这条路径 `btn-offline`（现在叫「结束游戏」）以前就在用。
 *
 * 之所以用 `/demo` 这个路径而不是 `?demo=1`：后面要整站挂到 GitHub Pages，
 * 那个环境没有后端，用 `404.html` 兜底就能让 `/demo` 落到同一份 index.html。
 */
const DEMO = (() => {
  const path = location.pathname.replace(/\/+$/, '').toLowerCase();
  if (path === '/demo' || path.endsWith('/demo') || path.endsWith('/demo/index.html')) return true;
  return new URLSearchParams(location.search).has('demo');
})();

/** 各地图的雾/背景色（原版没有雾，这里按地图气质给一个远景色） */
const MAP_FOG: Record<number, number> = {
  0: 0x9db6cc,
  1: 0x1b2430,
  2: 0xa8c4d8,
  3: 0x8fb48f,
  4: 0x4a4034,
  5: 0x3a2f2a,
  6: 0x33262a,
  7: 0x2f6f8f,
  8: 0xc0a077,
  9: 0x503a5a,
  10: 0x9fc0e0,
};

const DEFAULT_FOG = 0x9db6cc;
const WALK_SPEED = 2.6; // 由走路动作反推，见 README

/* ------------------------------------------------------------------ */
/* DOM 工具                                                            */
/* ------------------------------------------------------------------ */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const loginScreen = $('login');
const charScreen = $('charselect');
const loadingEl = $('loading');
const loadingFill = $('loading-fill');
const loadingMsg = $('loading-msg');
const hudEl = $('hud');
/** 水下滤镜层（亚特兰蒂斯）；`updateWaterLayer` 每帧改它的 opacity */
const waterTintEl = $('water-tint');
const loginMsg = $('login-msg');
const charMsg = $('char-msg');
const charListEl = $('char-list');
const stageEl = $('stage');
const fxLayer = $('fx');
const targetEl = $('target');
const targetName = $('target-name');
const targetFill = $('target-fill');
const statEnts = $('stat-ents');

/** 伤害飘字 */
const damageTexts = new DamageTexts(fxLayer);
/** 头顶名字 + 队友 10 格血条（原版 Render_HPBars / Render_CharNameTags） */
const worldTags = new WorldTags(fxLayer);
/** 调试口 `spawnItem` 的分散序号（放第几件 → 摆到第几格） */
let spawnSeq = 0;
/** 地面物品名（原版 `RenderItemName`：悬停那一件 / 按住 Alt 全部） */
const itemLabels = new ItemLabels(fxLayer);

/**
 * Alt 键状态。
 *
 * 原版 `Target_Render` 在 Alt 按下时给**所有**地面物品画名字（`Sort = 1`）。
 * 这里单独维护，不走 `keys` 集合：`keydown` 里有一堆提前 `return` 的分支
 * （F1 帮助、NPC 对话、聊天输入），走那条路会漏掉 Alt 的按下。
 */
let altHeld = false;
window.addEventListener(
  'keydown',
  e => {
    if (e.key === 'Alt') altHeld = true;
  },
  true
);
window.addEventListener(
  'keyup',
  e => {
    if (e.key === 'Alt') altHeld = false;
  },
  true
);
// 切窗口回来时 Alt 的 keyup 可能丢了，统一清掉，免得名字一直挂着
window.addEventListener('blur', () => {
  altHeld = false;
});

let progress = 0;
function setProgress(msg: string, pct?: number) {
  loadingMsg.textContent = msg;
  if (pct !== undefined) progress = pct;
  loadingFill.style.width = `${Math.min(100, progress)}%`;
}

/**
 * 登录/选角界面的原版贴图（`Data/Logo`）。
 *
 * 提前加载一次，避免第一次显示时闪一下空白；失败只打日志，界面照样能用
 * （CSS 里留了深色底 + 文字，纯 DOM 也能操作）。
 */
void initLoginSkin();
void initCharSkin();
/** 读条那三张 `Loading01..03`（原版 `Scene_Loading`）先预热，进图时才不用等 */
initLoadingArt();

/**
 * 怪物 / NPC 的中文名牌表（`Data/Local/NPCName.txt`）。
 *
 * 原版 `NPCName_LoadTextData`（`Item/NPC_Data.cpp`，调用点 `Scene_AssetLoad.cpp:152`）
 * 在启动阶段就读进 `MonsterScript[]`，之后 `CreateMonster` 用
 * `getMonsterName(Type)` 查它填 `c+0x1c1`（悬停显示的名字）。
 * 这里同样最早加载：登录界面期间就完成，进图刷 NPC / 怪时表已经就位，不用回填。
 */
const npcNamesReady: Promise<void> = loadNpcNames().then(table => setNpcNameTable(table));

/* ------------------------------------------------------------------ */
/* 登录第一步：选择线路                                                */
/* ------------------------------------------------------------------ */
/**
 * 原版是「先选服（ConnectServer 44405）→ 拿解析到的 GameServer 地址 → 再登录」。
 * 这里照做：`gameServer` 由线路选择写进来，`connectAndLogin` 用它去连网关，
 * 不再是写死的 127.0.0.1:55901。
 */
let gameServer: { host: string; port: number } = { host: '127.0.0.1', port: GAME_SERVER_PORT };
/** 登录界面当前阶段：原版 `DAT_083a7c14` 的 0（选服）/ 2（账号密码） */
let loginStage: 'servers' | 'account' = 'servers';

const loginLayerEl = document.getElementById('login-layer');

/**
 * 切换登录界面的两步。
 *
 * 背景、MU 标志、底部版本号都是共用的（原版也是同一张背景），
 * 只有中间那块换：选线路是一张列表，账号密码是 `0account_new.ozt`。
 */
function showLoginStage(stage: 'servers' | 'account') {
  loginStage = stage;
  loginLayerEl?.setAttribute('data-stage', stage);
  if (stage === 'servers') serverSelect.show();
  else serverSelect.hide();
}

const serverSelect = createServerSelect({
  demo: DEMO,
  setStatus: (text, kind) => setMsg(loginMsg, text, kind),
  onPicked: srv => {
    gameServer = { host: srv.host, port: srv.port };
    console.log(`[server-select] 选用线路 ${srv.host}:${srv.port}（code=${srv.code}）`);
    showLoginStage('account');
    // 焦点给账号框：原版进这一步光标就在账号输入位
    window.setTimeout(() => {
      const acc = document.getElementById('login-account') as HTMLInputElement | null;
      acc?.focus();
      acc?.select();
    }, 60);
  },
});


/**
 * 登录界面的 3D 背景（夕阳海面 + 三条船 + 立体 MU 字标）。
 *
 * ⚠️ 暂时关掉：`loginScene.ts` 的构图还没调准（船的大小/海平线跟原版差得多），
 * 先退回 2D 天空（= shots/login-v3.png 的样子）。想再试就把下面改成 `true`，
 * 或者临时在控制台跑 `__MU_APP__.login3dOn()`。
 */
const LOGIN_3D = false;
let login3d: LoginSceneHandle | null = null;

async function bootLogin3d() {
  const host = document.getElementById('login-3d');
  if (!host || login3d) return;
  try {
    login3d = await createLoginScene(host);
    if (login3d) {
      loginScreen.classList.add('has3d');
      login3d.resize();
    }
  } catch (err) {
    console.warn('[login3d] 初始化失败，退回 2D 背景', err);
  }
}

if (LOGIN_3D) void bootLogin3d();

/**
 * 选角界面的 3D 背景：`Data/Logo/Logo05.bmd`（原版 0xA4 槽，全屏背景模型）。
 * 加载失败就不加 `has3d`，界面继续用 2D 天空。
 */
let char3d: CharSceneHandle | null = null;
async function bootChar3d() {
  const host = document.getElementById('char-3d');
  if (!host || char3d) return;
  try {
    char3d = await createCharScene(host);
    if (char3d) {
      charScreen.classList.add('has3d');
      char3d.resize();
      // 3D 比角色列表晚就位时补一次：把已经拿到的角色站到场上
      charListEl.classList.remove('no3d');
      if (charSummaries.length) void syncCharModels();
    }
  } catch (err) {
    console.warn('[char3d] 初始化失败，退回 2D 背景', err);
  }
}
void bootChar3d();

function showScreens({ login = false, charselect = false, loading = false, hud = false }) {
  loginScreen.classList.toggle('hidden', !login);
  charScreen.classList.toggle('hidden', !charselect);
  loadingEl.classList.toggle('hidden', !loading);
  hudEl.classList.toggle('hidden', !hud);
  /*
   * 沙盘面板：`setAvailable` 管「此刻能不能显示」（离线演示 + 已进图 + 不在读条），
   * `show` 再叠一层用户意愿 —— 手机上默认收起，点右下角「演示面板」才展开。
   */
  const sandboxReady = sandbox.on && hud && !loading;
  sandboxPanel.setAvailable(sandboxReady);
  sandboxPanel.show(sandboxReady && sandboxPanel.userOpened);
  // 原版 UI 层只在游戏内出现
  if (uiLayer) uiLayer.show(hud);
  /*
   * 头顶名字 / 伤害飘字那一层（`#fx`）同样只在游戏内出现。
   * 它不在 `#mu-ui` 里（要按舞台像素定位，不能吃 640×480 的缩放），
   * 所以必须单独收 —— 少了这一句，回选角之后场面上的名字还浮在选角画面上。
   */
  fxLayer.classList.toggle('hidden', !hud);
  // 移动命令窗口不能跨「画面切换」活着（回选角/读条时要收掉）
  if (!hud) movePanel.hide();
  /*
   * ESC 菜单的独立层：游戏内 + 选角都要能按 ESC（原版选角场景没有这个菜单，
   * 是网页端补的出口）。读条/登录时整层收掉，并且把菜单状态复位
   * —— 否则从选角按 ESC 又点了「返回线路选择」，回来菜单还挂着。
   */
  if (!hud) svdPanel.hide();
  if (charselect) escMenu.setHost(charLayerEl);
  else if (hud) escMenu.setHost(uiLayer.root);
  else escMenu.hide();
  // 聊天框只在进图后显示（选角/登录时原版也不画）
  if (chatBox) chatBox.setVisible(hud);
  // 底栏是「进图就一直在」的那一条，登录/选角/读条时都不该露出来
  if (bottomBar) {
    if (hud) bottomBar.show();
    else bottomBar.hide();
  }
  /*
   * 登录界面自己还有两步（选线路 / 账号密码）。这里统一跟一次：
   * 登录画面出来时按 `loginStage` 展示对应那一步，其它画面一律把选服层收掉，
   * 免得它压在选角/游戏画面上（`.mu-layer` 是同一层）。
   */
  if (login) showLoginStage(loginStage);
  else serverSelect.hide();
}

function setMsg(el: HTMLElement, text: string, kind: '' | 'error' | 'ok' = '') {
  el.textContent = text;
  el.classList.remove('error', 'ok');
  if (kind) el.classList.add(kind);
}

/**
 * 离开游戏 —— ESC 菜单里那三项「结束游戏 / 回到选择服务器画面 / 回到选择角色画面」
 * 共用这一条出口。
 *
 * 对应原版 `UI_InGameMenu.cpp` case 0x6e 的三个 action：
 *
 * | 菜单项 | 原版动作 | 这里 |
 * |---|---|---|
 * | 结束游戏 | 存选项 + `F1/02/00`，关 socket，5 秒倒计时后退出程序 | 断 socket + 回登录界面 |
 * | 回到选择服务器画面 | `F1/02/02`，等服务端倒计时 | 回登录界面（选服也在登录界面之后） |
 * | 回到选择角色画面 | `F1/02/01`，等 ack 再发 `F3/00` | 回选角界面 |
 *
 * 原版这三条都要服务端确认才切画面，但服务端那 5 秒倒计时在网页端只会让人
 * 干等一排「还剩 N 秒」的系统提示 —— 这里直接本地切，包照发（服务端该处理的
 * 状态它自己会处理）。
 */
function leaveGame(target: 'login' | 'charselect', f1Sub: 0 | 1 | 2, note: string) {
  // 停自动攻击、清锁定、收起菜单，否则回来时角色还在原地砍
  autoAttackId = -1;
  pendingTargetId = -1;
  focusId = -1;
  playerDead = false;
  escMenu.hide();

  /*
   * 演示模式没有 socket 要关，但沙盘/角色要复位：不然回到选角再进图时
   * 沙盘还挂着上一场职业，头顶名字也还是上一个角色。
   */
  if (DEMO) {
    sandbox.on = false;
    currentChar = null;
  }

  session?.closeClient(f1Sub);
  if (target === 'login') {
    // 原版 Exit 会关掉 socket（`closesocket`），登录界面也就不用这条连接了
    window.setTimeout(() => connection?.close(), 150);
  }

  setSceneAudio(null); // 回登录/选角：换回 MuTheme，停掉地图环境音
  /*
   * 原版「结束游戏 / 回到选择服务器画面」都会退到**选服**那一步（再走一遍
   * ConnectServer）。这里同样回到 servers 阶段，且每次都重拉列表。
   */
  if (target === 'login') loginStage = 'servers';
  showScreens(target === 'login' ? { login: true } : { charselect: true });
  if (note) setMsg(loginMsg, note);

  if (target === 'charselect') {
    /*
     * 演示模式没有服务端：角色表就是本地那几只，重画一遍就够，
     * 别留一句「正在刷新角色列表…」在界面上（没有 ack 会永远挂着）。
     */
    if (DEMO) {
      renderCharList(charSummaries);
      setMsg(charMsg, '');
      return;
    }
    /*
     * `F1/02/01` 之后服务端要过一会儿才把角色从世界里摘掉（`CloseCount` 那套），
     * 立刻点「进入」会被拒（角色还在线）。原版就是等 ack 到了再发 `F3/00`
     * 重新拉一次列表 —— 这里等 2 秒补一次，顺便把列表刷新成服务端的最新状态。
     */
    setMsg(charMsg, '已退出角色，正在刷新角色列表…');
    window.setTimeout(() => void refreshCharListAfterLogout(0), 2500);
  }
}

/**
 * 退出角色后重新拉一次角色列表（`0xF3/00`）。
 *
 * 服务端处理 `F1/02/01` 是**异步**的（`CloseCount` 那个倒计时），在它把角色
 * 从世界里摘掉之前，`CGCharacterListRecv` 会直接 early-return —— 也就是这一包
 * 会被静默丢掉。所以这里重试几次，直到真的拿到列表为止（每次 1.6s 超时）。
 */
async function refreshCharListAfterLogout(attempt = 0) {
  if (!session || charScreen.classList.contains('hidden')) return;
  try {
    const chars = await session.requestCharacterList(2200);
    renderCharList(chars);
    setMsg(charMsg, '');
  } catch (err) {
    if (attempt < 5 && !charScreen.classList.contains('hidden')) {
      window.setTimeout(() => void refreshCharListAfterLogout(attempt + 1), 1300);
      return;
    }
    setMsg(charMsg, `角色列表刷新失败：${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* 渲染器 / 场景（全局只建一次）                                        */
/* ------------------------------------------------------------------ */
/**
 * 舞台固定 4:3（和 0.97 客户端一致），随窗口等比缩放。
 * 渲染尺寸跟着舞台走，而不是 window：这样宽屏下只是左右留黑边，画面不被拉伸。
 */
const ASPECT = 4 / 3;
function stageSize() {
  const w = stageEl.clientWidth || window.innerWidth;
  return { w, h: w / ASPECT };
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const initialSize = stageSize();
renderer.setSize(initialSize.w, initialSize.h);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('app').appendChild(renderer.domElement);

/*
 * 原版光标：`Data/Interface/Cursor*.ozt` 共 9 种（+ Cursoreye 备用）。
 * 贴图烘焙成 CSS `cursor: url(...)`，尺寸跟 UI 缩放走 —— 详见 `ui/cursor.ts`。
 */
const canvasEl = renderer.domElement;
void initCursors(1);
/*
 * 登录/选角 2D 背景的天空图。
 *
 * 原来写死在 `style.css` 里的 `url('/Data/World1/Sky.bmp')`：绝对路径在根路径托管下
 * 没问题，但 GH Pages 项目站点是 `/mu-three/`，根路径拿不到 → 背景掉成纯黑。
 * 改成运行时用 `assetUrl()` 拼，`.screen` 里读 `--mu-sky`。
 */
document.documentElement.style.setProperty('--mu-sky', `url("${assetUrl('Data/World1/Sky.bmp')}")`);
/*
 * 预热 `Data/Local/chs/item.bmd` 的中文物品名（Kris → 波刃剑）。
 * 不预热的话第一次打开背包/tooltip 还是英文，要等表加载完才变。
 *
 * 表读完要 `refreshItemNames()` 清一次 `itemAttr` 的缓存 —— 那是同步 API，
 * 之前打开过的物品已经把英文名缓存进去了，不清就永远显示英文。
 */
void loadItemNames().then(() => refreshItemNames());
/** 预热 `Data/Local/chs/Text.bmd`（按钮/面板文案用 `textSync` 同步取） */
void loadTextPool();

/* ------------------------------------------------------------------ */
/* 原版 UI 层                                                          */
/* ------------------------------------------------------------------ */
/**
 * 640×480 逻辑坐标的一层，盖在 3D 画面之上，跟着舞台整体缩放。
 * 面板坐标直接抄客户端源码（见 src/ui/inventory.ts 的注释），不做自适应重排。
 */
const uiLayer = new UiLayer(stageEl);

/**
 * ESC 菜单（原版 `UI_StatsPanel.cpp` state 0x6e）+「选项」子菜单（0x96）。
 *
 * 挂在**独立的** `#esc-layer` 上，不是 `#mu-ui`：后者只在游戏内显示，
 * 而选角界面也要能按 ESC 出菜单（原版选角场景没有这个菜单，是网页端补的出口）。
 * 两层都是 `.mu-layer`（640×480 + scale），所以菜单坐标完全一致。
 */
/** 选角界面的逻辑层（`.mu-layer` 640×480），ESC 菜单在选角时要搬进这里 */
const charLayerEl = $('char-layer');
const escMenu = new EscMenu(uiLayer.root);
escMenu.onExit = () =>
  leaveGame('login', 0, DEMO ? '已结束本次演示，重新选择线路' : '已断开连接（结束游戏）');
escMenu.onJoinServer = () =>
  leaveGame('login', 2, DEMO ? '已返回线路选择' : '回到选择服务器');
escMenu.onJoinChar = () => leaveGame('charselect', 1, '');
/** 选角那套精简菜单的「返回线路选择」 */
escMenu.onBackToServer = () => leaveGame('login', 2, '已返回线路选择');
// 菜单在 Text.bmd 读完之前就构造好了，表到位后补一次文案（否则是硬编码兜底串）
void loadTextPool().then(() => escMenu.refreshText());

/**
 * 服务器传送窗口（原版 `RenderServerDivision`）。
 *
 * 服务端 `CNpcTalk::NpcServerTransfer` 在 NPC **234** 身上回 `0x30 result=5`，
 * 客户端就开这个面板 —— 勾「同意上述条款」再点确定，会先弹一次确认
 * （原版 `ShowCheckBox(1, 448, 151)`），确认后才算同意。
 */
const svdPanel = new ServerDivisionPanel(uiLayer.root);

/**
 * 关掉服务器传送窗口时发的那一包。
 *
 * 两种情况都发 `C1 03 31`（`CGNpcTalkCloseRecv`）—— `NpcServerTransfer` 里把
 * `Interface.use` 置成了 1，不释放的话之后聊天和 `/move` 会被服务端整包吞掉
 * （和仓库/商店同一个坑）。原版 `ServerTransfer_HitTest` 的取消 / X 也是发它。
 */
function closeServerDivision() {
  if (connection?.connected) connection.send(buildNpcClosePacket());
  svdPanel.hide();
}

svdPanel.onAccept = () => {
  closeServerDivision();
  // 真正的账号迁移是服务端的事（本机这份 GameServer 的 NpcServerTransfer 只置标志）
  chatBox.push('系统', '服务器传送：已提交（账号迁移由服务端处理）', 1);
};
svdPanel.onCancel = () => closeServerDivision();
// UI 缩放 = 舞台宽 / 640（原版逻辑分辨率），光标尺寸跟着它走
void rescaleCursors(uiLayer.scaleFactor);

/** 服务端下发的背包快照（0..63 背包格，64..75 装备栏） */
let inventoryItems: InventoryItem[] = [];

const inventoryPanel = new InventoryPanel(uiLayer);
inventoryPanel.setMoney(0);

/** 角色属性面板 / 底栏（原版 C 键那块 190 宽面板 + 屏幕底部那一条） */
const bottomBar = new BottomBar(uiLayer);
const characterPanel = new CharacterPanel(uiLayer, () => bottomBar.setActive(null));
/** 底栏数值：HP/MP 球、经验条、AG 条、角色名、地图坐标（全部原版坐标） */
const hudValues = new HudValues(uiLayer);
/**
 * 小地图（左上角 151×173）。
 *
 * 0.97 客户端没有这功能，是给 H5 版加的：边框用 `Interface/MiniMap.OZT`，
 * 地图内容由 `terrain.buildMinimap()` 现场合成，**不依赖服务端**。
 */
const minimap = new MinimapPanel(uiLayer);

/**
 * 技能栏（`0xF3/0x11` 的整表 + 增量）。
 *
 * 原版没有独立的「技能列表窗口」：技能就是底栏上那排 32×36 的图标，
 * 点主图标展开、点某一格设为当前技能、Ctrl+数字设快捷键、数字键切换。
 * 坐标和交互见 `src/ui/skillBar.ts` 的文件头。
 */
const skillBar = new SkillBar(uiLayer.root);
/** 服务端下发/增删后的技能表（slot → skill + level） */
let skillList: SkillListEntry[] = [];
/** 技能表元数据（名字/蓝耗），`skill.bmd` 解析完才有 */
let skillTable = new Map<number, SkillEntry>();
/** 快捷键：slot → 1..10（10 表示「0」键），持久化在 localStorage */
const skillHotkeys = new Map<number, number>();

function skillHotkeyStorageKey() {
  return `mu.skillHotkeys.${currentChar?.name ?? 'default'}`;
}

function loadSkillHotkeys() {
  skillHotkeys.clear();
  try {
    const raw = localStorage.getItem(skillHotkeyStorageKey());
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, number>;
    for (const [slot, key] of Object.entries(obj)) {
      const s = Number(slot);
      const k = Number(key);
      if (Number.isFinite(s) && Number.isFinite(k) && k >= 1 && k <= 10) skillHotkeys.set(s, k);
    }
  } catch {
    /* 存的东西坏了就当没有 */
  }
  skillBar.setHotkeys(skillHotkeys);
}

function saveSkillHotkeys() {
  try {
    localStorage.setItem(
      skillHotkeyStorageKey(),
      JSON.stringify(Object.fromEntries(skillHotkeys))
    );
  } catch {
    /* 隐私模式写不进去，忽略 */
  }
}

// 点技能格 = 选中（原版写 `Hero+913`）；Ctrl+数字 = 设键位
skillBar.onSelect = slot => {
  const id = skillBar.selectedSkillId();
  const meta = skillTable.get(id);
  console.log(`[skill] 选中槽位 ${slot} → 技能 ${id}${meta ? ` ${meta.name}` : ''}`);
};
skillBar.onHotkey = (slot, key) => {
  skillHotkeys.set(slot, key);
  saveSkillHotkeys();
};
skillBar.onToggle = open => {
  console.log(`[skill] 技能栏${open ? '展开' : '收起'}`);
};

/** 把 `skillList` + `skill.bmd` 的元数据拼成面板用的条目 */
function syncSkillBar() {
  const entries: SkillBarEntry[] = skillList
    .filter(s => s.skill > 0)
    .map(s => {
      const meta = skillTable.get(s.skill);
      return { slot: s.slot, skill: s.skill, level: s.level, name: meta?.name, mana: meta?.mana };
    });
  skillBar.setSkills(entries);
}

async function ensureSkillTable() {
  if (skillTable.size) return;
  const list = await loadSkills();
  skillTable = new Map(list.map(s => [s.id, s]));
  syncSkillBar();
}

/**
 * 0xF3/0x11 三种语义合并：
 *   `list` → 整表替换；`add` → 按 slot 覆盖一个；`del` → 按 slot 删掉一个。
 * 原版把 0xFE/0xFF 当「超大整表」丢掉，所以「学了新技能要重登才看得见」。
 *
 * 只留 `slot < 20`：原版技能栏是 `for (slotIdx = 0; slotIdx < 20; …)`，
 * 服务端的 `MAX_SKILL_LIST` 是 60，20 号以后的技能**从来没画过**（也没有地方画）。
 */
function applySkillList(pkt: Uint8Array) {
  const reply = parseSkillList(pkt);
  if (!reply) return;
  if (reply.mode === 'list') {
    skillList = reply.entries.filter(e => e.skill > 0 && e.slot < 20);
  } else if (reply.mode === 'add') {
    for (const e of reply.entries) {
      if (e.slot >= 20) continue;
      skillList = skillList.filter(s => s.slot !== e.slot);
      if (e.skill > 0) skillList.push(e);
    }
  } else {
    for (const e of reply.entries) skillList = skillList.filter(s => s.slot !== e.slot);
  }
  void ensureSkillTable();
  syncSkillBar();
  console.log(
    `[skill] 技能表 ${reply.mode} ${reply.entries.length} 条，共 ${skillList.length} 个：` +
      skillList.map(s => `${s.slot}:${s.skill}`).join(' ')
  );
}

/** 当前选中的技能号（0 = 没选，走普通攻击） */
function selectedSkillId(): number {
  return skillBar.selectedSkillId();
}

/** 按技能号取元数据（名字/蓝耗/射程） */
function skillMeta(id: number): SkillEntry | undefined {
  return skillTable.get(id);
}

/**
 * 用「当前选中的技能」打一个目标。
 *
 * 和原版一致：蓝不够就什么都不发（`Attack_UseManaScroll97k` 那套卷轴兜底
 * 这里不做 —— 0.97 的技能卷轴本 port 还没接）。
 * 目标超出技能射程时不硬发，先记下来走过去（`pendingSkillTargetId`），
 * 到了主循环里自动补一发 —— 行为和普通攻击的 `pendingTargetId` 对称。
 * 返回 false 表示「这次没放技能」，调用方退回普通攻击。
 */
function useSelectedSkill(targetId: number): boolean {
  const id = selectedSkillId();
  if (!id || playerDead || !loggedIn) return false;
  if (!connection?.connected) return false;
  /*
   * 安全区：`Attack()` 的第二道门禁按技能号判定（事件地图里放行 16/26/27/28/48）。
   * 右键施法、技能栏点击、数字键、走近补发（pendingSkillTargetId）都汇到这里。
   */
  if (loggedIn && !sandbox.on && safeZoneBlocksCombat(id)) {
    warnSafeZone();
    return false;
  }
  const meta = skillMeta(id);
  const mana = currentChar?.info?.mana ?? 0;
  if (meta && meta.mana > 0 && mana < meta.mana) {
    if (Date.now() - lastManaWarnAt > 1500) {
      lastManaWarnAt = Date.now();
      chatBox.push('系统', `魔法值不足（${meta.name} 需要 ${meta.mana}）`, 1);
    }
    return false;
  }

  const tgt = targetId > 0 ? remotes.get(targetId) : null;
  // 指定了目标但视野里没有 → 不发包（否则会把一个不存在的索引发给服务端）
  if (targetId > 0 && !tgt) return false;
  if (tgt && player) {
    const range = Math.max(1, meta?.range ?? 6);
    const d = Math.hypot(tgt.tx - player.x, tgt.ty - player.y);
    if (d > range + 0.6) {
      pendingSkillTargetId = targetId;
      return true;
    }
  }
  return castOnlineSkill(id, targetId);
}
let lastManaWarnAt = 0;
/** 技能射程外的待施法目标（走近了自动补一发） */
let pendingSkillTargetId = -1;

/** 数字键 1..0 选技能（`SelectSkillByHotkey`）；返回 true 表示吃掉了这个按键 */
/** 键盘事件 → 技能快捷键的数字（1..9，`0` 键算 10）；不是数字键返回 0 */
function digitKeyOf(code: string): number {
  if (code === 'Digit0' || code === 'Numpad0') return 10;
  const d = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return d ? Number(d[1]) : 0;
}

/** 数字键 1..0 选技能（`SelectSkillByHotkey`）；返回 true 表示吃掉了这个按键 */
function selectSkillByHotkey(key: number): boolean {
  const slot = skillBar.slotByHotkey(key);
  if (slot < 0) return false;
  skillBar.setSelected(slot);
  // 原版对 6（瞬移）/15（小挪移）会顺手清掉当前目标
  const id = skillBar.selectedSkillId();
  if (id === 6 || id === 15) {
    focusId = -1;
    pendingTargetId = -1;
  }
  console.log(`[skill] 快捷键 ${key % 10} → 槽位 ${slot}（技能 ${id}）`);
  return true;
}
/**
 * 移动命令窗口（M 键）。列表/价格/门槛来自服务端 `Move.txt` + `Gate.txt`
 * （`src/world/warp.ts`，可被服务端整表替换），这里只负责把
 * 「当前角色的等级、金币、有没有翅膀」喂给它。
 */
const movePanel = new MoveCommandPanel(uiLayer);
movePanel.onWarp = entry => void warpTo(entry);

/**
 * NPC 货架 / 仓库（点 NPC 打开）。
 *
 * 服务端 0x31 一个报文同时用于商店和仓库（`Warehouse.cpp:270` 复用了
 * `PMSG_SHOP_ITEM_LIST_SEND`），所以这里也是一个面板两种模式：
 * 收到 0x30 的 result=0 就是商店，result=2 就是仓库。
 */
const npcPanel = new NpcPanel(uiLayer);
npcPanel.onBuy = slot => buyFromShop(slot);
npcPanel.onTakeOut = slot => takeFromWarehouse(slot);
npcPanel.onClose = () => closeNpcPanel();
/**
 * 全部修理：`0x34 slot=0xFF type=0`。
 *
 * **以前这里发的是 `(0, 1)`，两个参数都错了**：
 *   - `slot=0` 只是武器槽 —— 服务端 `if (lpMsg->slot == 0xFF)` 才逐件修；
 *   - `type=1` 是 auto-repair 标志，`GetItemRepairMoney` 收 **2.5 倍**价，
 *     而且 `CGItemRepairRecv` 要求 `Level >= 50`。
 * 结果就是「点一下全部修理，zen 全没了」：只修了一把武器，还按 2.5 倍收，
 * 武器买价高的时候正好把钱清零。
 *
 * 另外**加一次二次确认**：全修是逐件按服务端价格扣，总价可能超过身上的钱
 * （服务端 `RepairItem` 里钱不够就跳过那件，所以不会负），但玩家在点之前
 * 完全不知道会花多少 —— 客户端拿不到 `m_BuyMoney`，算不出准确价格，
 * 所以只能明说「可能花光」让他再点一次。
 */
let repairAllArmedAt = 0;
npcPanel.onRepairAll = () => {
  if (!connection?.connected) return;
  const now = performance.now();
  const worn = inventoryItems.filter(i => i.slot < 12);
  if (!worn.length) {
    npcPanel.toast('身上没有可修的装备', 'error');
    return;
  }
  if (now - repairAllArmedAt > 2500) {
    repairAllArmedAt = now;
    npcPanel.toast(
      `全部修理会按服务端价格逐件扣 zen（${worn.length} 件），可能花光余额 —— 再点一次确认`,
      'error'
    );
    return;
  }
  repairAllArmedAt = 0;
  connection.send(buildRepairPacket(REPAIR_ALL_SLOT, 0));
  npcPanel.toast('请求修理全部装备…');
  console.log(`[shop] 0x34 全部修理（slot=0xFF, type=0，共 ${worn.length} 件）`);
};
npcPanel.onDepositAll = () => {
  const money = currentChar?.info?.money ?? 0;
  if (money <= 0) {
    npcPanel.toast('身上没有金币', 'error');
    return;
  }
  connection?.send(buildWarehouseMoneyPacket(0, money));
};
npcPanel.onWithdrawAll = () => {
  if (warehouseMoney <= 0) {
    npcPanel.toast('仓库里没有金币', 'error');
    return;
  }
  connection?.send(buildWarehouseMoneyPacket(1, warehouseMoney));
};
/**
 * 通用输入框：拆堆叠问数量、仓库密码问密码/个人码。
 * 见 `src/ui/dialog.ts` 顶部注释（为什么不用 `window.prompt`）。
 */
const dialog = new PromptDialog(uiLayer);

/**
 * 仓库密码（0x83）。服务端 `CWarehouse::CGWarehousePasswordRecv` 的三种 type：
 *
 *   type 0 → 用密码解锁（`WarehousePW == password` → state 12，否则 10）
 *   type 1 → 设置密码（要求当前未上锁；**要账号个人码**，错了回 13）
 *   type 2 → 取消密码（同样要个人码）
 *
 * 个人码是**账号**级的 7 位数字（注册时填的），服务端拿
 * `gObjCheckPersonalCode` 比对，客户端拿不到、也不该缓存 —— 每次让玩家输。
 */
function openWarehousePasswordDialog() {
  if (!connection?.connected) return;
  const locked = warehouseState === 1;

  if (locked) {
    dialog.open({
      title: '仓库已上锁',
      hint: '输入密码解锁；「取消密码」只需个人码',
      fields: [
        { key: 'pw', label: '密码', maxLength: 4, numeric: true, mask: true },
        { key: 'code', label: '个人码', maxLength: 7, numeric: true, mask: true },
      ],
      okText: '解锁',
      altText: '取消密码',
      onOk: v => {
        const pw = Number(v.pw);
        if (!v.pw) {
          npcPanel.toast('请输入密码', 'error');
          return;
        }
        connection?.send(buildWarehousePasswordPacket(0, pw));
        console.log(`[warehouse] 0x83 type=0 解锁`);
      },
      /*
       * 服务端 type=2 **只校验个人码**（不看旧密码），所以锁着也能取消密码 ——
       * 这正是「忘了密码怎么办」的出路，UI 必须给。
       */
      onAlt: v => {
        if (!v.code) {
          npcPanel.toast('取消密码需要个人码', 'error');
          return;
        }
        connection?.send(buildWarehousePasswordPacket(2, 0, v.code));
        console.log(`[warehouse] 0x83 type=2 取消密码`);
      },
    });
    return;
  }

  dialog.open({
    title: '仓库密码',
    hint: '设置后存取需要密码（需要账号个人码）',
    fields: [
      { key: 'pw', label: '新密码', maxLength: 4, numeric: true, mask: true },
      { key: 'code', label: '个人码', maxLength: 7, numeric: true, mask: true },
    ],
    okText: '设置',
    // 已经设过密码（state 12 = 有密码但本次已解锁）时，额外给一个「取消密码」
    altText: warehouseState === 12 ? '取消密码' : undefined,
    onOk: v => {
      if (!v.pw || !v.code) {
        npcPanel.toast('密码和个人码都要填', 'error');
        return;
      }
      connection?.send(buildWarehousePasswordPacket(1, Number(v.pw), v.code));
      console.log(`[warehouse] 0x83 type=1 设置密码`);
    },
    onAlt: v => {
      if (!v.code) {
        npcPanel.toast('取消密码需要个人码', 'error');
        return;
      }
      connection?.send(buildWarehousePasswordPacket(2, 0, v.code));
      console.log(`[warehouse] 0x83 type=2 取消密码`);
    },
  });
}

npcPanel.onToggleLock = () => openWarehousePasswordDialog();

/**
 * 混沌机器（238）。版式见 `src/ui/chaosPanel.ts`。
 *
 * 服务端交互和商店/仓库长得像但语义完全不同：
 *   0x30 result=3  服务端切进 `INTERFACE_CHAOS_BOX`（**不带物品列表**，
 *                  箱子初始为空，要自己往里放）
 *   0x31 type=3    箱内物品清单（`GCChaosBoxSend`，复用商店列表报文）
 *   0x24 0→3       背包 → 箱子；3→0 取回；3→3 箱内换位
 *   0x88           查成功率 + 费用（**服务端算**，客户端不重算）
 *   0x86 type      合成；回 0x86 result + ItemInfo
 *   0x87           关闭（**会清空箱子**，所以有东西时先拦下）
 */
const chaosPanel = new ChaosPanel(uiLayer);
chaosPanel.onTakeOut = slot => takeFromChaosBox(slot);
chaosPanel.onMix = type => mixChaos(type);
chaosPanel.onQueryRate = type => queryChaosRate(type);
chaosPanel.onClose = () => closeChaosPanel();

/**
 * 背包里的单击 / 右键：
 *   商店开着 + 左键单击 → 卖（0x33）
 *   仓库开着 + 左键单击 → 存（0x24 flag 0→2）
 *   任何时候右键 → 丢在地上（0x23）
 */
inventoryPanel.onClick = (slot, mods) => {
  /*
   * Shift + 左键 = 拆堆叠（0x2B）。
   * 原版是「Shift + 拖到空格」，这里简化为「Shift + 点一下 → 问数量」，
   * 因为拖拽在 H5 里已经有「换位」的语义，再叠一层 Shift 判定容易误触。
   * 放在最前面：商店里也能拆（服务端只要求仓库/NPC 界面没占用 Interface）。
   */
  if (mods.shift) {
    openSplitDialog(slot);
    return;
  }
  // 混沌机器开着：单击背包物品 = 放进箱子（0x24 flag 0→3）
  if (chaosPanel.isOpen) {
    putIntoChaosBox(slot);
    return;
  }
  // 交易窗口开着：单击背包物品 = 放进交易格（0x24 flag 0→1）
  if (tradePanel.isOpen) {
    moveItemToTrade(slot);
    return;
  }
  /*
   * 商店 / 仓库开着：单击**不再**直接卖/存，只给一句提示。
   *
   * 原版这两件事都是拖拽（`Item_Move.cpp` 那套「按住物品拖到目标窗口」）：
   * 背包 → 商店窗口 = 卖，背包 → 仓库窗口 = 存。以前为了省事做成单击，
   * 结果「想看一下词条」都变成卖出去了。现在统一走拖拽（见下面的 onDropPanel）。
   */
  if (npcPanel.isOpen) {
    inventoryPanel.toast(
      npcMode === 'shop' ? '拖到商店面板出售（按住左键拖过去）' : '拖到仓库面板存入（按住左键拖过去）'
    );
    return;
  }
  // 平时：双击 = 使用（原版是双击装备/喝药）
  const now = performance.now();
  if (lastInvClick && lastInvClick.slot === slot && now - lastInvClick.at < 400) {
    lastInvClick = null;
    useItem(slot);
    return;
  }
  lastInvClick = { slot, at: now };
};

/**
 * 右键：商店开着 = **单件修理**（0x34 type=0），否则 = 丢弃（0x23）。
 *
 * 为什么把修理挂在右键：商店里左键已经是「卖」，拖拽是换位，没有第三个
 * 手势了；原版是「把装备拖到修理按钮上」，H5 里拖拽被换位占掉，
 * 右键当上下文菜单最直观（背包面板底部本来也写着「右键丢弃」）。
 */
/**
 * 背包 → 别的面板（拖拽松手时）。
 *
 * 对应原版 `Item_Move.cpp` 的「源窗口 → 目标窗口」：
 *   拖到仓库面板 = 存入（0x24 flag 0→2）
 *   拖到商店面板 = 卖出（0x33）
 *   拖到混沌箱   = 放入（0x24 flag 0→3）
 */
inventoryPanel.onDropPanel = (slot, panel) => {
  if (panel === 'warehouse') {
    if (npcMode !== 'warehouse') {
      inventoryPanel.toast('仓库没开着');
      return;
    }
    storeToWarehouse(slot);
    return;
  }
  if (panel === 'shop') {
    if (npcMode !== 'shop') {
      inventoryPanel.toast('商店没开着');
      return;
    }
    sellToShop(slot);
    return;
  }
  if (panel === 'chaos') {
    putIntoChaosBox(slot);
  }
};

/** 背包 → 3D 画面 = 丢在地上（0x23）。原版就是「拖到地上松手」 */
inventoryPanel.onDropFloor = slot => discardItem(slot);

/**
 * 商店货架 / 仓库格子 → 背包面板（拖拽松手时）：买 / 取回。
 *
 * 这一条以前挂在「单击格子」上，现在改回原版的手势。
 */
npcPanel.onDropToInventory = slot => {
  if (npcMode === 'shop') buyFromShop(slot);
  else if (npcMode === 'warehouse') takeFromWarehouse(slot);
};

inventoryPanel.onDiscard = slot => {
  /*
   * 右键点事件票（467 恶魔广场邀请函 / 434 隐身斗篷）= **查还有多久开**（0x91），
   * 不是丢弃。原版 `Item_ClickHandler.cpp:1017` 就是这个映射，而且这时候
   * 连「丢弃」都不给 —— 一张票动辄几百万 zen，右键手滑直接掉地上太惨。
   */
  const item = inventoryItems.find(i => i.slot === slot);
  if (item && (item.type === TICKET.DS || item.type === TICKET.BC)) {
    queryEventRemainTime(item);
    return;
  }
  if (npcPanel.isOpen && npcMode === 'shop') {
    repairOne(slot);
    return;
  }
  discardItem(slot);
};

/**
 * 单件修理：`0x34 [slot] type=0`。
 *
 * `type=0` 是「找 NPC 修」（原价）；`type=1` 是 auto-repair（2.5 倍价、
 * 还要 Level ≥ 50），不是「全部修理」—— 全部修理靠 `slot = 0xFF`。
 */
function repairOne(slot: number) {
  const item = inventoryItems.find(i => i.slot === slot);
  if (!item) return;
  if (!connection?.connected) return;
  connection.send(buildRepairPacket(slot, 0));
  console.log(`[shop] 修理单件 slot=${slot}（type=${item.type}）`);
}

/**
 * 拆堆叠（0x2B）：问数量 → 发 `slot + count`。
 *
 * 服务端约束（`CGItemStackUnstackRecv`）：`count < durability` 且
 * `count < MaxStack`，每个拆出来的各占一格（背包得有地方）。所以本地先挡一次，
 * 免得白发一个被静默丢弃的包。
 */
function openSplitDialog(slot: number) {
  const item = inventoryItems.find(i => i.slot === slot);
  if (!item) return;
  const stack = item.durability || 1;
  const name = itemAttr(item.type).name;
  if (slot < INVENTORY_WEAR_SIZE) {
    inventoryPanel.toast('装备不能拆分');
    return;
  }
  if (stack <= 1) {
    inventoryPanel.toast(`${name} 数量只有 ${stack}，不能拆分`);
    return;
  }
  dialog.open({
    title: '拆分堆叠',
    hint: `${name} ×${stack}`,
    fields: [{ key: 'count', label: '拆出数量', maxLength: 3, numeric: true, value: '1' }],
    okText: '拆分',
    onOk: v => {
      const n = Number(v.count);
      if (!Number.isFinite(n) || n <= 0) {
        inventoryPanel.toast('请输入 1 以上的数量');
        return;
      }
      if (n >= stack) {
        inventoryPanel.toast(`最多拆 ${stack - 1} 个（不能整堆拆走）`);
        return;
      }
      connection?.send(buildUnstackPacket(slot, n));
      console.log(`[items] 0x2B 拆堆叠 slot=${slot} count=${n}`);
    },
  });
}
/** 当前 NPC 界面的上下文（决定 0x31 是商店 / 仓库 / 混沌箱） */
let npcMode: 'shop' | 'warehouse' | 'chaos' | null = null;
/** 正在对话的 NPC 索引（关面板时要发 0x31 告诉服务端） */
let npcTargetId = -1;
/** 距离不够时先走过去，到了自动开口 */
let pendingNpcId = -1;
/** 仓库金币（0x81 下发） */
let warehouseMoney = 0;
/** 仓库物品缓存（0x31 仓库模式下发时同步；存取后本地维护） */
let warehouseItems: InventoryItem[] = [];
/** 等待回执的仓库存/取操作 */
let pendingContainerMove: { kind: 'store' | 'take'; invSlot: number; whSlot: number } | null = null;
/**
 * 混沌箱缓存（格子 0..31 = 8×4）。
 *
 * 服务端在每次移动回执里只回「一件物品 + 落点」，所以整表由本地维护：
 * 放入/取出成功就改这一份，0x31（type=3）到达时整表覆盖。
 */
let chaosItems: InventoryItem[] = [];
/** 上一次发出的混沌合成类型（0x86 回执里没有 type，只能自己记） */
let pendingChaosType = 0;
/** 等待回执的混沌箱搬运 */
let pendingChaosMove: { kind: 'in' | 'out'; invSlot: number; chaosSlot: number } | null = null;

/*
 * 移动表同步（预留接口）。
 *
 * 现在没有注册 `setWarpTableLoader`，所以这一句是空转 —— 表还是编译期快照。
 * 等服务端能下发 `Move.txt`/`Gate.txt` 之后，在登录成功处注册一个 loader：
 *
 *   setWarpTableLoader(async () => ({ moveText, gateText }));
 *
 * 然后这里的 `syncWarpTable()` 就会把表整表替换掉，窗口自己重画。
 */
void syncWarpTable();

/**
 * 事件倒计时（左上角）。服务端 `0xF3/0xE6` 推一次整表，
 * 之后本地每秒递减 —— 0.97 的 Win 端没有这块 UI，位置是本 port 自己定的。
 */
const eventTimer = new EventTimerPanel(uiLayer);

/* ------------------------------------------------------------------ */
/* 任务（0xA0 状态位 + Data/Quest/*.txt 数据表）                       */
/* ------------------------------------------------------------------ */

const questPanel = new QuestPanel(uiLayer);
/** 服务端下发的 50 字节 bitmask（192 个任务 × 2 bit） */
let questMask: Uint8Array<ArrayBufferLike> = new Uint8Array(50);
/** 数据表（第一次打开任务窗口时懒加载） */
let questData: QuestData | null = null;
/** 任务号 → 状态（由 bitmask 展开，面板直接用） */
let questStates = new Map<number, number>();

/**
 * 把 bitmask 展开成「任务号 → 状态」。
 * 只展开数据表里存在的任务 —— 服务端 bitmask 有 192 格，配置里只有 2 个。
 */
function syncQuestStates() {
  if (!questData) return;
  const m = new Map<number, number>();
  for (const d of questData.quests) m.set(d.index, questStateFromMask(questMask, d.index));
  questStates = m;
  questPanel.setQuests(questData.quests, questStates);
}

async function ensureQuestData() {
  if (!questData) questData = await loadQuests();
  syncQuestStates();
}

/** J 键：开关任务窗口 */
async function toggleQuestPanel() {
  if (questPanel.isOpen) {
    questPanel.hide();
    return;
  }
  try {
    await ensureQuestData();
    questPanel.show();
    console.log(`[quest] 窗口打开：${questData?.quests.length ?? 0} 个任务`);
  } catch (e) {
    chatBox.push('系统', `任务数据读取失败：${(e as Error).message}`, 1);
  }
}

/**
 * 0xA2 回执的统一处理（收包与探针注入共用）。
 *
 * `result = 0` 成功、`0xFF` 失败（目标没达成 / 条件不足 / 已经做过）。
 * 成功时 `state` 就是操作后的状态，直接写回本地 bitmask，不用等 0xA1。
 */
function applyQuestResult(r: { index: number; result: number; state: number }) {
  if (r.result === 0) {
    setQuestStateInMask(questMask, r.index, r.state);
    questStates.set(r.index, r.state);
    questPanel.setState(r.index, r.state);
    /*
     * 原版 `Net_Process.cpp:7223`：`0xA2` 且 `Msg[4] == 0` 时同样
     * `ShowQuestNpcWindow(-1)` —— 接取/提交成功就把对话按新状态重开。
     */
    if (pendingQuestDialogRefresh === r.index) {
      pendingQuestDialogRefresh = -1;
      void reopenQuestDialog(r.index, r.state);
    }
    const label = ['未接取', '进行中', '已完成', '已取消'][r.state] ?? String(r.state);
    chatBox.push('系统', `任务 ${r.index} → ${label}`, 1);
  } else {
    chatBox.push('系统', `任务 ${r.index} 条件不足（需要先满足目标）`, 1);
  }
  console.log(`[quest] 0xA2 回执 index=${r.index} result=0x${r.result.toString(16)} state=${r.state}`);
}

questPanel.onClose = () => questPanel.hide();

/**
 * 发 0xA2 接取 / 完成。
 * 服务端只看任务号（`CGQuestStateRecv`），自己判断「未接→接取 / 进行中→完成」。
 */
function requestQuestState(index: number) {
  if (!connection?.connected) return false;
  connection.send(buildQuestStatePacket(index));
  const st = questStates.get(index) ?? 0;
  console.log(`[quest] 0xA2 index=${index}（当前状态 ${st}，服务端自行判断接取/完成）`);
  return true;
}

questPanel.onAction = index => requestQuestState(index);


/* ------------------------------------------------------------------ */
/* 组队（0x40 邀请 / 0x41 应答 / 0x42 列表 / 0x43 踢人 / 0x44 血量）   */
/* ------------------------------------------------------------------ */

const partyPanel = new PartyPanel(uiLayer);
/** 当前队伍成员（0x42 下发） */
let partyMembers: PartyMember[] = [];
/**
 * 队友血量十等分（`0x44` 下发，`number → 0..10`）。
 *
 * 原版就存在 `DAT_07e11e98` 这张表里（stride 0x24），`Render_HPBars` 直接读它画
 * 头顶那 10 个红格。这里照抄一份给 `WorldTags` 用 —— 面板/紧凑血条走的是同一份数据。
 */
const partyLife = new Map<number, number>();

/** 视野内的其他玩家（用来做「邀请」列表） */
function refreshNearbyPlayers() {
  const me = remotes.selfId;
  const list = remotes
    .list()
    .filter(e => e.kind === 'player' && e.id !== me && !e.dying)
    .slice(0, 5)
    .map(e => ({ id: e.id, name: e.name || `#${e.id}` }));
  partyPanel.setNearby(list);
  return list;
}

/**
 * 邀请某人入队（0x40）。
 *
 * 不传名字 = 邀请**面前 3 格内最近的那个玩家**，这是原版 `/party` 的语义
 * （`Chat_InputTick.cpp::Chat_TrySendPartyRequest` 拿的就是 `Hero` 面前的对象）。
 * 传名字则从视野里找人 —— 方便远一点的队友。
 *
 * 服务端 `CGPartyRequestRecv` 会自己校验：对方是否已有队伍、是否已 5 人、
 * 双方等级差、是否在战盟战里。任一不过就回 0x41 带原因，所以这里不做本地拦截。
 */
function partyInvite(name?: string): boolean {
  if (!connection?.connected) return false;
  const me = player;
  const players = remotes.list().filter(e => e.kind === 'player' && e.id !== remotes.selfId && !e.dying);

  let target: (typeof players)[number] | null = null;
  if (name) {
    const lower = name.toLowerCase();
    target = players.find(p => p.name.toLowerCase() === lower) ?? null;
  } else if (me) {
    target =
      players
        .map(e => ({ e, d: Math.hypot(e.tx - me.x, e.ty - me.y) }))
        .filter(x => x.d <= 3)
        .sort((a, b) => a.d - b.d)[0]?.e ?? null;
  }

  if (!target) {
    chatBox.push(
      '系统',
      name ? `视野里没有玩家「${name}」` : '附近 3 格内没有玩家：走到他面前再打 /party',
      1
    );
    return false;
  }
  connection.send(buildPartyInvitePacket(target.id));
  chatBox.push('系统', `已邀请 ${target.name} 组队`, 1);
  console.log(`[party] 0x40 邀请 ${target.name} index=${target.id}`);
  return true;
}

/**
 * 开/关队伍面板。
 *
 * 原版（`Player_InputTick.cpp:289-300` + `HUD_PanelTail97k(TAIL_PARTY)`）：
 * 开面板时 `PartyNumber = 0; send 0x42; PartyOpened = 1`，并且**关掉背包和人物面板**
 * （它们和队伍面板是同一块 190 宽底板，都在 450,0）。关闭只是清标志，不发包。
 */
function togglePartyPanel() {
  if (partyPanel.isOpen) {
    partyPanel.hide();
    bottomBar.setActive(null);
    return;
  }
  // TAIL_PARTY：InventoryOpened = 0 / CharacterOpened = 0（交易在 0x3D 那条路里单独处理）
  if (inventoryPanel.isOpen) inventoryPanel.hide();
  characterPanel.hide();
  if (guildPanel.isOpen) guildPanel.hide();
  if (eventPanel.isOpen) closeEventWindow();

  refreshNearbyPlayers();
  partyPanel.setSelf(currentChar?.name ?? '');
  partyPanel.show();
  bottomBar.setActive('party');
  syncPartyHud(true);
  // 主动要一次列表：不在队伍里时服务端不回（本地保持空）
  if (connection?.connected) {
    connection.send(buildPartyListRequest());
    console.log('[party] 0x42 请求队伍列表');
  }
}

/**
 * 右侧面板的起点 x —— 原版 `GetScreenWidth()`。
 *
 * 紧凑血条贴在 `GetScreenWidth() - 50`，所以面板一开它就得左移，
 * 不然会压在背包/仓库上。本 port 的右侧面板都在 x=450（190 宽），
 * 没开任何面板时整个 640 都是画面。
 */
function partyRightEdge(): number {
  const anyRight =
    inventoryPanel.isOpen ||
    characterPanel.isOpen ||
    partyPanel.isOpen ||
    guildPanel.isOpen ||
    npcPanel.isOpen ||
    chaosPanel.isOpen ||
    eventPanel.isOpen;
  return anyRight ? 450 : 640;
}

/**
 * 紧凑血条的数据源。**节流到 400ms**：`remotes.list()` 每次都要重新映射数组，
 * 而它只在「有人进出视野 / 血量变了」时才可能影响显示。
 */
let partyHudAt = 0;
function syncPartyHud(force = false) {
  /*
   * 右缘位置**每帧都算**：`partyRightEdge()` 只是几个布尔读，`setRightEdge`
   * 在值没变时直接返回。所以开/关背包那一刻紧凑血条就跟着挪，
   * 不用等节流窗口（玩家眼里「盾牌一跳」比晚 400ms 自然）。
   */
  partyPanel.setRightEdge(partyRightEdge());
  // 右上角是小地图：队友紧凑血条整体下移，别糊在图上（缩放后高度 173×0.8≈139）
  partyPanel.setTopOffset(minimap.isOpen ? 146 : 0);

  // 视野名单要遍历 remotes，节流到 400ms
  const now = performance.now();
  if (!force && now - partyHudAt < 400) return;
  partyHudAt = now;
  partyPanel.setSelf(currentChar?.name ?? '');
  partyPanel.setViewport(
    remotes
      .list()
      .filter(e => e.kind === 'player' && !e.dying)
      .map(e => e.name)
  );

  // 黄金弓箭手的「已收集」= 背包里 469 的件数，登记后服务端会重发物品
  const col = gaCollectedCount();
  gaPanel.setCollected(col.rena, col.stone);
}

/*
 * ── 头顶标签（原版 Render_HPBars + Render_CharNameTags） ────────────────
 */

/** 每个模型的身高（Box3 只算一次；换皮/换装会换 actor，WeakMap 自动回收） */
const headHeightCache = new WeakMap<object, { h: number; meshes: number; t: number; n: number }>();

/**
 * 角色头顶离地多高（世界单位）。
 *
 * 原版是 `entity[+300] + entity[+0x18]` —— `+300` 就是模型高度字段。
 * 我们这边没有那个字段，用包围盒量一次。
 *
 * ⚠️ 用 `max.z - min.z` 而不是 `max.z - actor.z`：`actor.z` 是**地形高度**，
 * 而模型局部原点在脚下，两者一减会把地形高度算进身高里（实测多出 1.65 个世界
 * 单位，标签飘在头顶上方近 100px）。包围盒的 Z 跨度才是模型真正的身高。
 */
function headHeightOf(actor: Actor, groundZ: number, fallback: number): number {
  /*
   * 缓存里记着「量的时候有几块网格」—— 角色/怪物是分部件异步挂上来的，
   * 第一帧经常只有身体（量出来 1.67），头盔晚一步才到（1.91）。
   * 件数变了就重量一次，顺便也就处理了换装。
   */
  const cached = headHeightCache.get(actor);
  if (cached && cached.meshes === actor.meshes.length) {
    /*
     * 前 1.6 秒里重量两次：模型是分部件异步挂上来的，第一帧往往只有身体
     * （玩家实测 1.67），头盔/披风晚一步才蒙好（1.91）。量满三次就锁死，
     * 之后不再算（`computeBoundingBox` 要遍历顶点，每帧算会掉帧）。
     */
    if (cached.n >= 3 || performance.now() - cached.t < 800) return cached.h;
  }

  /*
   * 量的是**蒙皮后**的真实包围盒（`SkinnedMesh.computeBoundingBox()` 会把每个
   * 顶点按骨骼矩阵算一遍，结果就是我们眼睛看到的那个形状）。
   *
   * 踩过的两个坑，记在这里免得再走一遍：
   *
   *   ① `Box3().setFromObject(actor.root)` —— 蒙皮网格**不在 root 下面**
   *      （`Actor.attachMeshes` 把它们挂到场景根，bindMatrix 是单位阵），
   *      root 里只剩骨骼和**手里的武器**：量出来是剑的长度（1.18~1.4），
   *      再被 `Math.max(1.2, …)` 兜成 1.2 —— 名字正好贴在胸口。
   *
   *   ② 只取骨骼的世界高度 —— 骨头最高点是**脖子/头骨底座**，头盔、头发、
   *      角那一截根本不在骨架上（实测玩家骨架顶 1.68，模型顶 2.26，
   *      差 0.58 ≈ 38px，名字会压在头顶上）。
   *
   * 蒙皮包围盒没有这两个毛病：脚在 0、头顶就是真的头顶。
   */
  const box = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  for (const m of actor.meshes) {
    if (typeof m.computeBoundingBox === 'function') m.computeBoundingBox();
    const bb = m.boundingBox;
    if (!bb || bb.isEmpty()) continue;
    /*
     * 玩家的蒙皮网格挂在场景根（matrixWorld 是单位阵），怪物/模型的网格挂在
     * 自己的 group 里（带位置和缩放）—— 所以包围盒必须乘一遍 matrixWorld
     * 才是世界坐标，否则怪物量出来只有 0.6（被夹到 0.9，名字压在脸上）。
     */
    tmpBox.copy(bb).applyMatrix4(m.matrixWorld);
    box.union(tmpBox);
  }

  let h = box.isEmpty() ? 0 : box.max.z - groundZ;

  // 骨架顶点：网格还没蒙皮好时的兜底（比不画强）
  if (!(h > 0.4)) {
    const v = new THREE.Vector3();
    let top = -Infinity;
    actor.root.traverse(o => {
      if ((o as THREE.Bone).isBone) {
        o.getWorldPosition(v);
        if (v.z > top) top = v.z;
      }
    });
    h = Number.isFinite(top) ? top - groundZ : 0;
  }

  /*
   * 0.8 是「明显没量准」的门槛：MU 里最矮的小怪也有 1 个世界单位高。
   * 低于它的说明模型刚进场、网格还没全部挂上 —— 这时候**不能写缓存**，
   * 否则这只怪以后一直顶着 0.9 的高度（实测出现过一次，名字压在脸上）。
   */
  if (!(h > 0.8)) return fallback;
  const clamped = Math.min(6, h + HEAD_TOP_PAD);
  headHeightCache.set(actor, {
    h: clamped,
    meshes: actor.meshes.length,
    t: performance.now(),
    n: (cached?.n ?? 0) + 1,
  });
  return clamped;
}

/**
 * 进酒馆换 BGM（muonlinejs 的同款行为：`loadMapIntoScene` 里 `onEnter` 放 `Music/Pub`）。
 *
 * 只在洛兰有效 —— 其它地图没有这种「可进入的室内」。节流 400ms，
 * 采集的是 `objects.insideRoof()`（就是收屋顶那套房间判定，不额外算几何）。
 */
let pubBgmOn = false;
let lastPubCheck = 0;
function syncPubMusic() {
  if (!world || world.mapId !== 0) return;
  const now = performance.now();
  if (now - lastPubCheck < 400) return;
  lastPubCheck = now;
  const inside = world.objects.insideRoof();
  if (inside === pubBgmOn) return;
  pubBgmOn = inside;
  if (inside) playBgm('Pub.mp3');
  else setSceneAudio(world.mapId);
}

/**
 * 每帧刷新小地图（内部 25fps 节流）。
 *
 * 标记只画「玩家自己关心的东西」：队友、NPC、当前目标 —— 不画全部怪物，
 * 那等于开透视（0.97 没有小地图，这个功能本身就该克制）。
 */
function syncMinimap() {
  // 小地图是纯客户端功能（离线演示也画），所以只看「有没有世界和玩家」
  if (!player || !world) return;
  if (!minimap.isOpen) return;

  const marks: MinimapMark[] = [];
  // 一帧只取一次快照（`list()` 会复制装备表，别调三次）
  const all = remotes.list();
  const selfName = currentChar?.name ?? '';

  // 队友：优先用视野里实体的实时坐标，不在视野里就退回 0x42 记下的最后位置
  for (const m of partyMembers) {
    if (!m.name || m.name === selfName) continue;
    const e = all.find(x => x.kind === 'player' && x.name === m.name);
    if (e && !e.dying) marks.push({ x: e.x, y: e.y, kind: 'party' });
    else if (m.map === world.mapId && m.x > 0 && m.y > 0) marks.push({ x: m.x, y: m.y, kind: 'party' });
  }

  for (const e of all) {
    if (!e.dying && e.kind === 'npc') marks.push({ x: e.x, y: e.y, kind: 'npc' });
  }

  const tgt = focusId >= 0 ? remotes.get(focusId) : null;
  if (tgt && !tgt.dying) marks.push({ x: tgt.actor.x, y: tgt.actor.y, kind: 'target' });

  minimap.update(player.x, player.y, player.yaw, marks, MODEL_YAW_OFFSET);
}

/**
 * 每帧刷新头顶标签。
 *
 * 显示规则：
 *   1. **队友** —— 名字 + `cur/max` + 10 格血条（`0x44` 的十等分，
 *      几何照 `Render_HPBars`：42×5、暗红底、10 段 3×2 红格）。
 *   2. **其他玩家** —— 名字（原版 `Render_CharNameTags`）。
 *   3. **怪物** —— 名字 + 实心血条（名字查 `data/monsters.ts`，血量上限查同一张表，
 *      当前血量来自 `0x15` 的 `Life`；没挨过打按满血画）。
 *      当前目标用冷色（原版目标名那档 `0xFFC8E6FF`）。
 *   4. **NPC 不画**（原版明确排除）。
 */
function syncWorldTags() {
  if (!loggedIn || !currentChar || !world) {
    worldTags.setEnabled(false);
    return;
  }
  worldTags.setEnabled(true);

  const me = remotes.selfId;
  const selfName = currentChar.name;
  const terrain = world.terrain;

  const partyNumberOf = new Map<string, PartyMember>();
  for (const m of partyMembers) {
    if (m.name && m.name !== selfName) partyNumberOf.set(m.name, m);
  }

  const items: TagItem[] = [];
  for (const e of remotes.list()) {
    // 自己的角色也画名字（只有名字，不画血条 —— 自己的血在 HUD 上）
    if (e.dying) continue;
    // NPC 不画（原版明确排除）
    if (e.kind === 'npc') continue;

    const member = partyNumberOf.get(e.name);
    const focused = e.id === focusId;

    const ent = remotes.get(e.id);
    const fallback = e.kind === 'player' ? 2.15 : 1.9;
    const groundZ = terrain.getHeight(e.x, e.y);
    const h = ent ? headHeightOf(ent.actor, groundZ, fallback) : fallback;
    const z = groundZ + h + 0.08;

    /*
     * 怪物：名字 + 血条。
     *
     * 服务端**不下发**怪物血量，只有挨打时 `0x15` 里带一个 `Life`（`remotes.applyDamage`
     * 会顺便反推 maxLife = life + damage）；所以：
     *   - 上限：优先用反推出来的 `maxHp`，没有就查 `Monster.txt` 的 `MaxLife`；
     *   - 当前：没挨过打（hp 还是 0）就按满血画，不然一进图全是空血条。
     */
    let hpRatio: number | undefined;
    let name = e.name;
    if (e.kind === 'monster') {
      name = monsterNameOf(e.cls, e.name) || e.name || `怪物 ${e.cls}`;
      const maxLife = e.maxHp > 0 ? e.maxHp : monsterMaxLifeOf(e.cls);
      if (maxLife > 0) {
        hpRatio = Math.max(0, Math.min(1, (e.hp > 0 ? e.hp : maxLife) / maxLife));
      }
    }

    items.push({
      id: e.id,
      name,
      x: e.x,
      y: e.y,
      z,
      kind: e.kind,
      focused,
      hpRatio,
      // 队友才画十格条：`0x44` 的十等分；还没收到过就按满血画（原版初始也是 10）
      tenths: member ? (partyLife.get(member.number) ?? 10) : undefined,
      hpText: member ? `${Math.round(member.life)}/${Math.round(member.maxLife)}` : undefined,
    });
  }

  /*
   * 自己头上也挂一个名字（只有名字）。
   * `remotes` 里没有自己这条（自己的实体是 `player`），所以单独补一条，
   * id 用 -1 当键，不会和远程实体撞。
   */
  if (player && currentChar) {
    const selfGround = terrain.getHeight(player.wx, player.wy);
    const h = headHeightOf(player, selfGround, 2.15);
    items.push({
      id: -1,
      name: currentChar.name,
      x: player.wx,
      y: player.wy,
      z: selfGround + h + 0.08,
      kind: 'player',
    });
  }

  worldTags.update(muCamera.camera, items);
}

/**
 * 一件地面物品的名字与颜色（原版 `RenderItemName`，`Item/Item_Display.cpp`）。
 *
 * 名字：`item.bmd` 的官方名（`Data/Local/chs/item.bmd`，中文）+ `+N` + 后缀。
 * 金币按源码走后缀 `"%s %d"`（名字 + 数量）。
 *
 * 颜色档位照抄源码那几档 `glColor3f`（**不是**常见的「+1..+4 白」那种说法）：
 *   卓越 → 绿；+0 → 灰；+1..2 → 白；+3..4 → 橙；+5..6 → 淡蓝；+7.. → 金。
 * 宝石 / 翅膀 / 恶魔广场 / 任务道具另有一组「一律金色」的特例（模型槽 799、830、
 * 831、861、862、864、865..867、870）。
 */
function groundItemLabelOf(g: GroundItem): { text: string; color: string } {
  const model = g.type + 400;

  // 金币：`sprintf("%s %d", name, ItemLevel)` —— 名字来自 item.bmd，数量是 level 字段
  if (g.isMoney) {
    return { text: `${itemDisplayName(TYPE_MONEY)} ${g.money.toLocaleString('en-US')}`, color: '#ffcc1a' };
  }

  let text = itemDisplayName(g.type);
  if (g.level > 0) text += ` +${g.level}`;
  // 后缀顺序照源码：技能(176) → 属性(177) → 幸运(178)
  if (g.skill) text += ' +技能';
  if (g.option > 0) text += ' +属性';
  if (g.luck) text += ' +幸运';

  // 特例组：宝石/翅膀/恶魔广场/任务道具，源码里固定金色
  if (model === 799 || model === 830 || model === 831 || model === 861 || model === 862 ||
      model === 864 || (model >= 865 && model <= 867) || model === 870) {
    return { text, color: '#ffcc1a' };
  }

  if (g.excellent) return { text, color: '#1aff80' };
  if (g.level >= 7) return { text, color: '#ffcc1a' };
  if (g.level >= 5) return { text, color: '#66b3ff' };
  if (g.level >= 3) return { text, color: '#ff8033' };
  if (g.level >= 1) return { text, color: '#e6e6e6' };
  return { text, color: '#b3b3b3' };
}

/**
 * 刷新地面物品名。
 *
 * **默认全部显示**（按需求改的，不是原版行为）：
 * 原版 `Target_Render` 只在「鼠标指着」或「按住 Alt」时画名字；
 * 这里改成地上每件物品都常驻显示自己的名字，画在物品上方，
 * 鼠标指着的那件加粗高亮（原来那套 `Alt` 逻辑保留在 `altHeld` 里，但不再用作过滤条件）。
 */
function syncItemLabels() {
  if (!world || !player) {
    itemLabels.setEnabled(false);
    return;
  }
  itemLabels.setEnabled(true);

  const rect = fxLayer.getBoundingClientRect();
  /*
   * 指针位置用 `hoverX/hoverY`（`pointermove` 一直在刷）。
   * 不能用 `lastPointer` —— 那个只在按下/拖动转镜头时才更新，
   * 平时一直停在最后按下的位置，悬停会「看着别处」。
   */
  const hoverId = groundItems.pickAt(muCamera.camera, hoverX, hoverY, rect, 30);
  const labels: GroundLabel[] = [];

  for (const g of groundItems.list()) {
    const { text, color } = groundItemLabelOf(g);
    labels.push({
      id: g.id,
      x: g.wx,
      y: g.wy,
      // 物品模型自身有 0.35 格的抬升 + 最大 0.7 的尺寸，名字压在它顶上刚好
      z: g.wz + 0.55,
      text,
      color,
      atItem: true,
      focused: g.id === hoverId,
    });
  }

  itemLabels.update(muCamera.camera, labels, { x: hoverX, y: hoverY });
}

partyPanel.onClose = () => partyPanel.hide();
partyPanel.onInvite = id => {
  if (!connection?.connected) return;
  connection.send(buildPartyInvitePacket(id));
  console.log(`[party] 0x40 邀请 index=${id}`);
};
partyPanel.onKick = number => {
  if (!connection?.connected) return;
  connection.send(buildPartyKickPacket(number));
  console.log(`[party] 0x43 踢/退 number=${number}`);
};
partyPanel.onAccept = index => {
  // 面板自己的按钮会先 hideInvite；探针/其它入口直接调回调时也要清掉邀请条
  partyPanel.hideInvite();
  if (!connection?.connected) return;
  connection.send(buildPartyResponsePacket(index, true));
  console.log(`[party] 0x41 接受 index=${index}`);
};
partyPanel.onDecline = index => {
  partyPanel.hideInvite();
  if (!connection?.connected) return;
  connection.send(buildPartyResponsePacket(index, false));
  console.log(`[party] 0x41 拒绝 index=${index}`);
};

/* ------------------------------------------------------------------ */
/* 黄金弓箭手（0x94-0x9D）                                             */
/* ------------------------------------------------------------------ */

/**
 * 黄金弓箭手窗口。
 *
 * 链路（`GoldenArcher.cpp`）：对话 NPC 236 → 服务端 `NpcGoldenArcher`
 * **直接发 0x94**（不是 0x30！）→ 客户端弹面板 →
 *   0x95 登记一件 Rena/Stone（计数 +1，背包扣 1 件）
 *   0x97/0x02 兑换（count 是**档位下标**，不是数量）
 *   0x97/0x03 登记幸运号码 / 0x9D 用号码领奖
 *   0x97/0x01 查看已登记的号码（C2 长包）
 * 关闭发 0x31（服务端要清 `Interface.use`）。
 */
const gaPanel = new GoldenArcherPanel(uiLayer);
/** 最近一次 0x97/0x00 的兑换配置 */
let gaInfo: GoldenArcherInfo | null = null;

/**
 * 背包里 Rena（level 0）/ Stone（level 1）各有多少。
 *
 * 服务端 `GetInventoryItemCount` 的规则：可叠加的按 `durability` 累加，
 * 不可叠加的每件算 1。Rena/Stone 就是同一个物品号 469 的两个等级。
 */
function gaCollectedCount(): { rena: number; stone: number } {
  let rena = 0;
  let stone = 0;
  for (const i of inventoryItems) {
    if (i.type !== GOLDEN_ARCHER_ITEM) continue;
    const n = Math.max(1, Math.floor(i.durability));
    if (i.level === 0) rena += n;
    else if (i.level === 1) stone += n;
  }
  return { rena, stone };
}

/** 关窗口：0x31 必须发，否则服务端 `Interface.use` 一直占着 */
function closeGoldenArcher() {
  if (!gaPanel.isOpen) return;
  gaPanel.hide();
  if (connection?.connected) connection.send(buildNpcClosePacket());
  bottomBar.setActive(null);
  console.log('[ga] 0x31 关闭黄金弓箭手');
}

/** 说明按钮：原版弹 `CreateDialogInterface(713, 5)`，这里摊到聊天框 */
function gaExplain(type: number) {
  const lines =
    type === 0
      ? [
          '雷娜收集器：背包里的「雷娜」可以在这里登记，',
          '登记后累积成「已登记雷娜」，按档位兑换奖励。',
          '雷娜只在洛兰的黄金弓箭手处登记。',
        ]
      : type === 1
        ? [
            '宝石收集器：背包里的「宝石」可以在这里登记，',
            '登记后累积成「已登记宝石」，可以换 VIP 或幸运号码。',
            '宝石只在诺利亚的黄金弓箭手处登记。',
          ]
        : [
            '幸运号码是 12 位字母数字（例如 AUS919DKL2J9）。',
            '注意区分字母 O 和数字 0、字母 I 和数字 1。',
          ];
  for (const t of lines) chatBox.push('系统', t, 1);
}

gaPanel.onRegister = type => {
  if (!connection?.connected) return;
  connection.send(buildGoldenArcherRegisterPacket(type));
  console.log(`[ga] 0x95 登记 ${type === 0 ? '雷娜' : '宝石'}`);
};

gaPanel.onExchange = (type, index) => {
  if (!connection?.connected) return;
  connection.send(buildGoldenArcherExchangePacket(type, index));
  console.log(`[ga] 0x97/0x02 兑换 type=${type} 档位=${index}`);
};

gaPanel.onRegisterLucky = number => {
  if (!connection?.connected) return;
  connection.send(buildGoldenArcherRegisterLuckyPacket(number));
  console.log(`[ga] 0x97/0x03 登记幸运号码 ${number}`);
};

gaPanel.onExchangeLucky = number => {
  if (!connection?.connected) return;
  if (number.length !== 12) {
    gaPanel.toast('幸运号码必须是 12 位', 'error');
    return;
  }
  connection.send(buildGoldenArcherExchangeLuckyPacket(number));
  console.log(`[ga] 0x9D 用号码领奖 ${number}`);
};

gaPanel.onExplain = () => gaExplain(gaPanel.type);
gaPanel.onClose = () => closeGoldenArcher();

/** 打开窗口（0x94 到达时调用）：先收掉占着右侧的其它面板 */
function openGoldenArcher(data: { type: number; count: number; lucky: string }) {
  if (inventoryPanel.isOpen) inventoryPanel.hide();
  characterPanel.hide();
  if (partyPanel.isOpen) partyPanel.hide();
  if (guildPanel.isOpen) guildPanel.hide();
  bottomBar.setActive(null);

  const col = gaCollectedCount();
  gaPanel.setCollected(col.rena, col.stone);
  if (gaInfo) gaPanel.setInfo(gaInfo);
  gaPanel.show(data);
  console.log(
    `[ga] 0x94 打开 type=${data.type}（${['雷娜收集器', '宝石收集器', '幸运号码兑换', '号码查看'][data.type] ?? '?'}）` +
      ` 已登记 ${data.count} 背包 ${data.type === 1 ? col.stone : col.rena} 号码「${data.lucky}」`
  );
}

/* ------------------------------------------------------------------ */
/* 事件入场（恶魔广场 0x90 / 血色城堡 0x9A）                            */
/* ------------------------------------------------------------------ */

/**
 * 事件入场窗口。两个事件共用一套 UI（原版 `RenderEventWindow` 就是一套，
 * 靠 `EventType` 切 4 行 / 6 行）。
 *
 * 链路：
 *   0x30 对话 Charon 237 / Angel Messenger 233
 *     → 服务端先发 0x8E（恶魔广场）/ 0x8F（血色城堡）等级表
 *     → 再回 0x30 result=4 / 6
 *     → 客户端弹这个窗口
 *   → 点某一档 → 0x90 / 0x9A（带票的背包槽位）
 *   → 服务端回 0x90 / 0x9A result（0 成功，同时会 0x1C 换图）
 *
 * 右键点票（467 恶魔广场邀请函 / 434 隐身斗篷）→ 0x91 问「还有多久开」。
 */
const eventPanel = new EventPanel(uiLayer);

/** 0x8E 解出来的恶魔广场等级表（4 档） */
let dsRanges: EventLevelRange[] = [];
/** 0x8F 解出来的血色城堡等级表（12 档：0-5 普通、6-11 魔剑士） */
let bcRanges: EventLevelRange[] = [];
/** 当前打开的是哪个事件的窗口（回执/关闭时要用） */
let eventKind: 'ds' | 'bc' | null = null;
/** 上一次 0x30 是哪个 NPC（窗口关掉时要发 0x31） */
let pendingEventKind: 'ds' | 'bc' | null = null;
/** 最近一次 0x9B 的赛事状态（调试 + HUD） */
let matchState: ReturnType<typeof parseMatchState> = null;

/** 票的物品号（`GET_ITEM(14,19)` / `GET_ITEM(13,18)`） */
const TICKET = { DS: 467, BC: 434 } as const;

/**
 * 角色是不是魔剑士（血堡用第二组等级表，原版 `Hero[444] & 7 == 3`）。
 *
 * 职业要按 `Net_Process.cpp:1643` 那套比特算（见 `syncCharacterPanel`）：
 * 直接拿 `charSet[0]` 当职业号会得到 0/32/64，全落空。
 * 服务端 `CLASS_MG = 3`（`DefaultClassInfo.h:10`）。
 */
function isMagicGladiator(): boolean {
  const cs = currentChar?.charSet?.[0] ?? 0;
  return (((cs >> 4) | (cs & 0x10)) >> 1) === 3;
}

/** 角色等级（`F3/00` 角色列表里那条的 Level；`F3/03` 不带等级字段） */
function charLevel(): number {
  return currentChar?.level ?? 0;
}

/** 背包里某类票的绝对槽位（找不到 = -1） */
function findTicketSlot(type: number, preferLevel?: number): number {
  const list = inventoryItems.filter(i => i.type === type);
  if (!list.length) return -1;
  if (preferLevel != null) {
    const exact = list.find(i => i.level === preferLevel);
    if (exact) return exact.slot;
  }
  return list[0].slot;
}

/**
 * 打开事件窗口（0x30 result=4/6 时调用）。
 *
 * 等级表还没收到就先用空表（界面照常弹，行文字显示 `0 - 0`）——
 * 服务端一定是先发 0x8E/0x8F 再发 0x30，正常不会走到这个分支。
 */
function openEventWindow(kind: 'ds' | 'bc') {
  eventKind = kind;
  pendingEventKind = kind;
  const ranges = kind === 'ds' ? dsRanges : bcRanges;
  const count = kind === 'ds' ? 4 : 6;
  const slots: number[] = [];
  for (let i = 0; i < count; i++) {
    // 血堡 level 1-based，票的 m_Level 就是 level
    slots.push(
      kind === 'ds' ? findTicketSlot(TICKET.DS, i + 1) : findTicketSlot(TICKET.BC, i + 1)
    );
  }
  eventPanel.show({
    kind,
    ranges: ranges.length ? ranges : Array.from({ length: count }, () => ({ min: 0, max: 0 })),
    slots,
    charLevel: charLevel(),
    magicGladiator: isMagicGladiator(),
  });
  console.log(
    `[event] 打开${kind === 'ds' ? '恶魔广场' : '血色城堡'}窗口 等级表 ${ranges.length} 行 ` +
      `角色 ${charLevel()} 级${isMagicGladiator() ? '（魔剑士）' : ''} 票 ${JSON.stringify(slots)}`
  );
}

/**
 * 关事件窗口：要发 0x31，否则服务端 `Interface.use` 一直占着，
 * 下一次对话/用物品都会被拒（和仓库/商店同一个坑）。
 */
function closeEventWindow() {
  eventPanel.hide();
  eventKind = null;
  pendingEventKind = null;
  if (connection?.connected) connection.send(buildNpcClosePacket());
  console.log('[event] 0x31 关闭事件窗口');
}

/** 点了某一档：找票 → 发 0x90 / 0x9A */
eventPanel.onPick = level => {
  if (!connection?.connected || !eventKind) return;
  const isDs = eventKind === 'ds';
  const slot = isDs ? findTicketSlot(TICKET.DS, level + 1) : findTicketSlot(TICKET.BC, level);
  if (slot < 0) {
    // 原版：恶魔广场 `GlobalText[677]`「Bring the Devil's invitation to enter.」
    //       血色城堡 `GlobalText[854]`「The level of the invisibility cloak is incorrect.」
    eventPanel.toast(
      isDs ? '需要恶魔广场邀请函（467）' : '隐身斗篷等级不对（需要 434）',
      'error'
    );
    return;
  }
  if (isDs) {
    connection.send(buildDevilSquareEnterPacket(level, slot));
    console.log(`[event] 0x90 进恶魔广场 档 ${level} 票槽 ${slot}`);
  } else {
    connection.send(buildBloodCastleEnterPacket(level, slot));
    console.log(`[event] 0x9A 进血色城堡 档 ${level} 票槽 ${slot}`);
  }
};

eventPanel.onClose = () => closeEventWindow();

/**
 * 0x90 / 0x9A 回执。
 *
 * 原版（`Net_Events.cpp:84-116`）在这里做三件事：
 *   1. 关背包相关窗口；
 *   2. **主动发 `C1 03 31`**（服务端要清 Interface）；
 *   3. 按 result 弹一个 Ok 消息框。
 * result 的语义两边一样（0 成功 / 1 票不对 / 2 时间不对 / 3 等级太高 /
 * 4 等级太低 / 5 人数满 / 6 PK 值太高），只有文案索引不同。
 */
function onEventEnterResult(result: number, kind: 'ds' | 'bc') {
  const ok = result === 0;
  if (connection?.connected) {
    connection.send(buildNpcClosePacket());
    // 服务端成功后会把角色 0x1C 传进事件地图，这里先把本地面板收掉
  }
  eventPanel.hide();
  eventKind = null;
  pendingEventKind = null;
  inventoryPanel.hide();
  bottomBar.setActive(null);

  const text = ok
    ? kind === 'ds'
      ? '已进入恶魔广场'
      : '已进入血色城堡'
    : eventResultText(result, kind);
  chatBox.push('系统', text, 1);
  console.log(`[event] ${kind === 'ds' ? '0x90' : '0x9A'} result=${result} → ${text}`);
}

/** 入场失败码（`Net_Events.cpp:96-115` 的 GlobalText 表） */
function eventResultText(result: number, kind: 'ds' | 'bc'): string {
  // [677] 恶魔广场没票 / [854] 血堡斗篷等级不对 —— 都在点票之前挡掉了
  switch (result) {
    case 1:
      return kind === 'ds' ? '恶魔广场邀请函等级不对' : '隐身斗篷等级不对';
    case 2:
      return kind === 'ds' ? '现在不是恶魔广场的入场时间' : '现在不是血色城堡的入场时间';
    case 3:
      return '你的等级太高了，换下一档';
    case 4:
      return '你的等级太低了，换下一档';
    case 5:
      return kind === 'ds' ? '恶魔广场人数已满' : '血色城堡人数已满';
    case 6:
      return 'PK 值太高，不能进入';
    default:
      return `无法进入（result=${result}）`;
  }
}

/**
 * `F3/40` ServerCommand 的文案。
 *
 * 服务端总共只发这 8 种组合（`grep GCServerCommandSend`，见
 * BloodCastle.cpp / DevilSquare.cpp / NpcTalk.cpp），所以直接一张表覆盖完，
 * 不做「GlobalText 索引 + 原文」那种半英文的兜底。
 *
 * 索引对照（`Text.bmd`）：
 *   (1,2)  → 652  恶魔广场没票   (1,3)  → 653  恶魔广场时间不对
 *   (1,20) → 830  血堡时间不对   (1,21) → 831  血堡没斗篷
 *   (1,23) → 833  血堡已完成     (1,24) → 834  血堡资格不符
 *   (1,46) → 856  血堡武器已拿到 (6,0)  → 449  有战盟不能传送
 */
function serverCommandText(type: number, cmd1: number): string | null {
  if (type === 1) {
    switch (cmd1) {
      case 2:
        return '你还没有恶魔广场邀请函。打怪掉「恶魔之眼」和「恶魔之钥」，去诺利亚找混沌哥布林合成。';
      case 3:
        return '你来早了。等到入场时间再来找 Charon。';
      case 20:
        return '你有隐身斗篷，但大门还没开，等到入场时间再来。';
      case 21:
        return '你需要一件「隐身斗篷」才能进血色城堡。';
      case 23:
        return '血色城堡已经结束了。';
      case 24:
        return '你现在的状态不能进血色城堡（等级不符 / 不在参战名单里）。';
      case 46:
        return '大天使的武器已经被取走了，这一场结束了。';
      default:
        return `【提示】${cmd1 < 20 ? 650 + cmd1 : 810 + cmd1}`;
    }
  }
  if (type === 3) return `【提示】${710 + cmd1}`;
  if (type === 6) return '你有战盟，不能使用服务器传送。';
  return null;
}

/** 右键点票：0x91 问「还有多久开」（原版 `Item_ClickHandler.cpp:1017`） */
function queryEventRemainTime(item: { type: number; level: number }) {
  if (!connection?.connected) return;
  const eventType = item.type === TICKET.DS ? EVENT_TYPE.DEVIL_SQUARE : EVENT_TYPE.BLOOD_CASTLE;
  connection.send(buildEventRemainTimePacket(eventType, item.level));
  const label = item.type === TICKET.DS ? '恶魔广场' : '血色城堡';
  chatBox.push('系统', `${label} 第 ${item.level} 档：正在查询开场时间…`, 1);
  console.log(`[event] 0x91 查询 ${label} type=${eventType} level=${item.level}`);
}

/* ------------------------------------------------------------------ */
/* 战盟（0x50-0x64）                                                   */
/* ------------------------------------------------------------------ */

/**
 * 战盟窗口（底栏「战盟」按钮 / `O` 键）。
 *
 * 服务端链路（`Guild.cpp`）：
 *   0x52 拉成员表 → 0x52 下行（**成员表在 +16 偏移**，见 `parseGuildList`）
 *   0x54 申请开「创建战盟」框 → 服务端等级/转身校验 → 只回一个 3 字节 0x55
 *   0x55 建盟（名字 8 + 标志 32）→ DataServer `WZ_GuildCreate` → 0x56 结果
 *   0x50 在会长面前 `/guild` 申请入盟 → 会长收 0x50 → 会长回 0x51
 *   0x53 退出 / 驱逐 / 解散（同一个包，服务端按名字和身份自己判断）
 *   0x5C / 0x5D 某人的战盟名 + 标志进/出视野（自己的那份登录时也会到）
 */
const guildPanel = new GuildPanel(uiLayer);
/** 最近一次 0x52 的原始回执（调试/探针用） */
let lastGuildList: GuildListReply | null = null;
/** 待在服务端回 0x56 的建盟名字（回执里没有名字，只能自己记） */
let pendingGuildCreate: string | null = null;
/** 有没有收到过「自己的」0x5C（盟名可能是空串，不能拿名字判有没有收到） */
let sawSelfGuildViewport = false;

function toggleGuildPanel() {
  if (guildPanel.isOpen) {
    guildPanel.hide();
    bottomBar.setActive(null);
    return;
  }
  // 战盟面板在 450，和背包完全重叠（原版就是这个位置）
  if (inventoryPanel.isOpen) {
    inventoryPanel.hide();
    bottomBar.setActive(null);
  }
  if (partyPanel.isOpen) partyPanel.hide();
  guildPanel.setSelf(currentChar?.name ?? '');
  guildPanel.show();
  bottomBar.setActive('guild');
  if (connection?.connected) {
    connection.send(buildGuildListRequestPacket());
    console.log('[guild] 0x52 请求战盟成员表');
  }
}

guildPanel.onRefresh = () => {
  if (!connection?.connected) return;
  connection.send(buildGuildListRequestPacket());
  console.log('[guild] 0x52 刷新');
};

/** 点「创建战盟」：先 0x54 让服务端校验等级/转身，通过了它才回 0x55 */
guildPanel.onOpenCreate = () => {
  if (!connection?.connected) return;
  if (guildPanel.members.length > 0) {
    guildPanel.toast('已经在战盟里了', 'error');
    return;
  }
  connection.send(buildGuildOpenCreatePacket());
  console.log('[guild] 0x54 申请打开创建框');
};

guildPanel.onCreate = (name, mark) => {
  if (!connection?.connected) return;
  pendingGuildCreate = name;
  connection.send(buildGuildCreatePacket(name, packGuildMark(mark)));
  console.log(`[guild] 0x55 创建战盟 name=${name}`);
};

guildPanel.onCreateCancel = () => {
  if (!connection?.connected) return;
  connection.send(buildGuildCreateCancelPacket());
  console.log('[guild] 0x57 取消创建');
};

/**
 * 退盟 / 驱逐 / 解散：0x53。**要账号个人码**（不是仓库密码），
 * 服务端 `gObjCheckPersonalCode` 比对，错了 result≠1。
 */
guildPanel.onDelete = name => {
  if (!connection?.connected) return;
  const self = currentChar?.name ?? '';
  const isSelf = name === self;
  const master = guildPanel.members.find(m => m.name === self)?.master === true;
  const title = isSelf ? (master ? '解散战盟' : '退出战盟') : `驱逐 ${name}`;
  const hint = isSelf && master ? '解散后战盟和标志都会消失，且不可恢复。' : `目标：${name}`;
  dialog.open({
    title,
    hint: `${hint}\n需要账号个人码（7 位数字）`,
    fields: [{ key: 'code', label: '个人码', mask: true, maxLength: 7, numeric: true }],
    okText: isSelf ? (master ? '解散' : '退出') : '驱逐',
    onOk: v => {
      if (!v.code) {
        guildPanel.toast('请输入个人码', 'error');
        return false;
      }
      connection?.send(buildGuildDeletePacket(name, v.code));
      console.log(`[guild] 0x53 ${title} name=${name}`);
      return true;
    },
  });
};

guildPanel.onJoinAnswer = (accept, index) => {
  if (!connection?.connected) return;
  connection.send(buildGuildJoinAnswerPacket(accept, index));
  console.log(`[guild] 0x51 ${accept ? '接受' : '拒绝'} index=${index}`);
  guildPanel.clearRequest();
};

/**
 * `/guild`：向「面前的玩家」申请入盟（0x50）。
 *
 * 服务端 `CGGuildRequestRecv` 会校验：
 *   目标必须是**会长**、目标开着「允许加入」（`Option & 1`）、
 *   自己没有战盟、双方都没开界面、目标不在战盟战里、等级 ≥ 6、战盟没满。
 * 任一不满足就回 0x51 带具体原因（不是静默丢弃），所以先把包发出去，
 * 失败原因由 0x51 那一条统一显示。
 */
function guildApplyNearestPlayer(): boolean {
  const me = player;
  if (!me) return false;
  const near = remotes
    .list()
    .filter(e => e.kind === 'player' && e.id !== remotes.selfId && !e.dying)
    .map(e => ({ e, d: Math.hypot(e.tx - me.x, e.ty - me.y) }))
    .filter(x => x.d <= 3)
    .sort((a, b) => a.d - b.d)[0];
  if (!near) {
    chatBox.push('系统', '附近 3 格内没有玩家：走到会长面前再打 /guild', 1);
    return false;
  }
  if (!connection?.connected) return false;
  connection.send(buildGuildJoinRequestPacket(near.e.id));
  chatBox.push('系统', `已向 ${near.e.name || `玩家 ${near.e.id}`} 申请加入战盟`, 1);
  console.log(`[guild] 0x50 申请入盟 target=${near.e.id} dist=${near.d.toFixed(1)}`);
  return true;
}

/** 战盟战申请结果文案（`GCGuildWarRequestResultSend` 的 result） */
function guildWarText(result: number): string {
  switch (result) {
    case 0:
      return '战盟战申请失败';
    case 1:
      return '战盟战申请已发出，等待对方应答';
    case 2:
      return '对方拒绝/无法应战';
    case 3:
      return '战盟战开始';
    case 4:
      return '战盟战取消';
    default:
      return `战盟战：result=${result}`;
  }
}

/* ------------------------------------------------------------------ */
/* 交易（0x36-0x3D）                                                   */
/* ------------------------------------------------------------------ */

const tradePanel = new TradePanel(uiLayer);
/** 我放进交易格的物品（本地维护：服务端只给对方发 0x39，自己这边靠 0x24 回执） */
let tradeMine: InventoryItem[] = [];
/** 对方放进来的物品（0x39 / 0x38） */
let tradeTheirs: InventoryItem[] = [];
/** 等待回执的交易格搬运 */
let pendingTradeMove: { kind: 'in' | 'out'; invSlot: number; tradeSlot: number } | null = null;
/** 双方「确定」状态 */
let tradeOk = { mine: false, theirs: false };

/** 交易格（8×4=32，服务端 `TRADE_SIZE 32`）里第一个放得下的空位 */
function firstFreeTradeSlot(w: number, h: number): number | null {
  const used = new Set<number>();
  for (const it of tradeMine) {
    const attr = itemAttr(it.type);
    const c0 = it.slot % 8;
    const r0 = Math.floor(it.slot / 8);
    for (let dy = 0; dy < attr.h; dy++) {
      for (let dx = 0; dx < attr.w; dx++) used.add((r0 + dy) * 8 + (c0 + dx));
    }
  }
  for (let y = 0; y + h <= 4; y++) {
    for (let x = 0; x + w <= 8; x++) {
      let free = true;
      for (let dy = 0; dy < h && free; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (used.has((y + dy) * 8 + x + dx)) {
            free = false;
            break;
          }
        }
      }
      if (free) return y * 8 + x;
    }
  }
  return null;
}

/** 背包 → 交易格（0x24 flag 0→1） */
function moveItemToTrade(slot: number) {
  if (!connection?.connected) return;
  const item = inventoryItems.find(i => i.slot === slot);
  if (!item) return;
  if (slot < INVENTORY_WEAR_SIZE) {
    tradePanel.snapshot();
    chatBox.push('系统', '先脱下装备再交易', 1);
    return;
  }
  const attr = itemAttr(item.type);
  const dest = firstFreeTradeSlot(attr.w, attr.h);
  if (dest === null) {
    chatBox.push('系统', '交易格已满', 1);
    return;
  }
  pendingTradeMove = { kind: 'in', invSlot: slot, tradeSlot: dest };
  connection.send(
    buildItemMovePacket(slot, dest, { type: item.type, level: item.level, option: item.option, durability: item.durability }, {
      from: 0,
      to: 1,
    })
  );
  console.log(`[trade] 放入 背包 ${slot} → 交易格 ${dest}`);
}

/** 交易格 → 背包（0x24 flag 1→0） */
function moveItemFromTrade(tradeSlot: number) {
  if (!connection?.connected) return;
  const item = tradeMine.find(i => i.slot === tradeSlot);
  if (!item) return;
  const attr = itemAttr(item.type);
  const dest = firstFreeGrid(inventoryItems, INVENTORY_WEAR_SIZE, 8, 8, attr.w, attr.h);
  if (dest === null) {
    chatBox.push('系统', '背包已满', 1);
    return;
  }
  pendingTradeMove = { kind: 'out', invSlot: dest, tradeSlot };
  connection.send(
    buildItemMovePacket(tradeSlot, dest, { type: item.type, level: item.level, option: item.option, durability: item.durability }, {
      from: 1,
      to: 0,
    })
  );
  console.log(`[trade] 取回 交易格 ${tradeSlot} → 背包 ${dest}`);
}

function refreshTradePanel() {
  tradePanel.setMine(tradeMine);
  tradePanel.setTheirs(tradeTheirs);
  tradePanel.setMoney(currentChar?.info?.money ?? 0, 0);
}

tradePanel.onTakeBack = slot => moveItemFromTrade(slot);
tradePanel.onSetMoney = money => {
  if (!connection?.connected) return;
  connection.send(buildTradeMoneyPacket(money));
  console.log(`[trade] 0x3A 放入金币 ${money}`);
};
tradePanel.onOk = flag => {
  if (!connection?.connected) return;
  tradeOk.mine = flag;
  connection.send(buildTradeOkPacket(flag));
  tradePanel.setOk(tradeOk.mine, tradeOk.theirs);
  console.log(`[trade] 0x3C 确定 flag=${flag ? 1 : 0}`);
};
tradePanel.onCancel = () => {
  if (connection?.connected) connection.send(buildTradeCancelPacket());
  tradeMine = [];
  tradeTheirs = [];
  tradeOk = { mine: false, theirs: false };
  tradePanel.hide();
};
tradePanel.onAccept = () => {
  if (!connection?.connected) return;
  connection.send(buildTradeResponsePacket(true));
  console.log('[trade] 0x37 接受交易');
};
tradePanel.onDecline = () => {
  if (!connection?.connected) return;
  connection.send(buildTradeResponsePacket(false));
  console.log('[trade] 0x37 拒绝交易');
};

/**
 * 按名字对视野里的玩家发起交易（`/trade 名字` 走这里）。
 *
 * 服务端会另外校验**同图 + X/Y 相差 ≤ 2 格**，太远时它会回 `0x37 response=0`
 * 并在聊天框提示，所以这里不做距离过滤，只负责把 id 找对。
 */
function tradeWithName(name: string) {
  const hit = remotes
    .list()
    .find(e => e.kind === 'player' && e.name.toLowerCase() === name.toLowerCase());
  if (!hit) {
    chatBox.push('系统', `视野里没有玩家「${name}」`, 1);
    return false;
  }
  if (!connection?.connected) return false;
  connection.send(buildTradeRequestPacket(hit.id));
  console.log(`[trade] 0x36 请求交易 index=${hit.id} name=${hit.name}`);
  chatBox.push('系统', `已向 ${hit.name} 发送交易请求`, 1);
  return true;
}

/**
 * 聊天框：6 行历史（x=196，y=404-13*row）+ 输入条（Dialogue1/Dialogue2，
 * 186,415 与 320,415）。收包解析见 applyChatPacket()。
 */
const chatBox = new ChatBox(uiLayer);
/** NPC 对话窗（`Data/Local/chs/Dialog.bmd`） */
const npcDialog = new NpcDialog(uiLayer);
/**
 * 对话窗答案的「特殊动作」——`Dialog.bmd` 的 `m_iReturnForAnswer`：
 *
 *   1 = 接受 / 检查目标（`CSQuest_CheckRequestCondition` 通过就 `Quest_SendState`）
 *   2 = 关闭对话（只关窗）
 *   3 = 提交 / 完成
 *
 * 客户端 `CSQuest_ShowDialogText` 之后点答案走的就是 `Quest_SendState`，
 * 也就是我们这里的 `requestQuestState()`（上行 `C3 05 A2 index state`）。
 */
npcDialog.onAnswer = (ret, dlg, slot) => {
  console.log(`[quest] 对话 ${dlg.index} 选 ${slot + 1} → return=${ret}`);
  if (ret === 2) return; // 关闭
  if (ret !== 1 && ret !== 3) return;
  const q = activeQuestDialog;
  if (!q) return;
  if (requestQuestState(q.index)) {
    /*
     * 原版 `Quest_SendState` 之后服务端回 0xA1/0xA2 时，客户端会走
     * `CSQuest::ShowQuestNpcWindow(-1)` → `CheckQuestState` 把对话**按新状态**
     * 重新打开（接完就变成「进行中」的文案）。记下这次是对话框发起的，
     * 回执到了就照做；从任务面板点的按钮不重开（原版没有那个面板）。
     */
    pendingQuestDialogRefresh = q.index;
    chatBox.push('系统', `任务「${q.name}」：${ret === 3 ? '提交' : '接取'}（等待服务端回执）`, 1);
  }
};
/** 帮助窗（F1，文案来自 Text.bmd 120..157） */
const helpWindow = new HelpWindow(uiLayer);
/**
 * 发一句话（聊天框 onSend 和调试口 `chat()` 共用）。
 *
 * 额外拦截一个**客户端侧**命令（服务端没有）：
 *   `/trade 玩家名` → 对视野里那个玩家发 0x36 交易请求。
 * 原版是「点玩家 → 交易按钮」，H5 里点玩家已经用于选中目标，
 * 用一条本地拦截的命令最省事，也不会和服务端 CommandManager 冲突
 * （服务端收到未知命令只会回一句提示）。
 *
 * 其它内容照原版 `PMSG_CHAT_SEND` 发（名字 10 字节 + 正文 60 字节），
 * 服务端广播回来时自己也会收到一份，所以这里不做本地回显。
 */
function sendChatText(text: string): boolean {
  if (!session || !currentChar) return false;
  const tradeCmd = /^\/trade\s+(.+)$/i.exec(text.trim());
  if (tradeCmd) return tradeWithName(tradeCmd[1].trim());
  /*
   * `/guild` —— 0.97 原版就是这么申请入盟的（`Chat_InputTick.cpp`
   * `Chat_TrySendGuildRequest`）：**不需要名字**，作用对象是「站在我面前的
   * 那个人」，服务端会自己判断他是不是会长。所以这里找最近的一个玩家。
   */
  if (/^\/guild$/i.test(text.trim())) return guildApplyNearestPlayer();
  /*
   * `/party` —— 0.97 的组队入口就是这条聊天命令（`Chat_InputTick.cpp`
   * `Chat_TrySendPartyRequest`），作用对象是**面前的玩家**；也可以 `/party 名字`
   * 指定视野里的人。服务端 `CGPartyRequestRecv` 自己校验等级/人数/是否已在队伍。
   */
  const partyCmd = /^\/party(?:\s+(.+))?$/i.exec(text.trim());
  if (partyCmd) return partyInvite(partyCmd[1]?.trim());
  session.sendChat(currentChar.name, text);
  return true;
}

chatBox.onSend = text => {
  sendChatText(text);
};

/** 上一次发出的 0x24（等服务端回执时才落地，避免被服务端拒绝后本地已经挪了） */
let pendingMove: { from: number; to: number } | null = null;

/* ------------------------------------------------------------------ */
/* 离线演示沙盘：手动指定职业 + 每个部位穿什么                          */
/* ------------------------------------------------------------------ */
/**
 * 离线演示没有服务端，背包永远是空的，也就没法验证穿戴效果。
 * 这块面板直接覆盖「职业 + 8 个穿戴槽」，和真实背包互不干扰：
 * `sandbox.on` 为真时 `currentEquip()` 读这里，否则照旧读服务端下发的背包。
 */
const sandboxPanel = new SandboxPanel(stageEl);
let sandbox: { on: boolean } & SandboxState = { on: false, cls: 0, slots: sandboxPanel.state().slots };

sandboxPanel.onChange = state => {
  if (!sandbox.on) return;
  sandbox = { on: true, ...state };
  void refreshPlayerEquipment();
};


/** 调试：最近一次拖拽落点（确认面板算出来的槽位对不对） */
let lastMove: { from: number; to: number; fail?: string; reason?: string } | null = null;

/**
 * 一次「把物品从 from 放到 to」的完整流程：本地判定 → 发包 → 乐观更新。
 *
 * 服务端对 0x24 失败只回 0xFF，不带原因（`ItemManager.cpp:2531` 起所有
 * early-return 都是同一个值），所以这里先按 `CheckItemMoveToInventory`
 * 的顺序判一遍：判不过就不发包，直接把原因写进 toast。
 *
 * 返回 false 表示被本地拦下了。
 */
function requestItemMove(from: number, to: number): boolean {
  lastMove = { from, to };
  const item = inventoryItems.find(i => i.slot === from);
  if (!item || from === to) {
    lastMove.fail = !item ? 'no-item' : 'same-slot';
    return false;
  }

  const cur = currentChar;
  const info = cur?.info;
  if (cur && info) {
    const cs = cur.charSet?.[0] ?? 0;
    const ch = {
      level: cur.level || 0,
      strength: info.strength,
      dexterity: info.dexterity,
      vitality: info.vitality,
      energy: info.energy,
      charClass: cs,
    };

    if (to < INVENTORY_WEAR_SIZE) {
      /*
       * 服务端 `InventoryAddItem` 第一句就是
       * `if (lpObj->Inventory[slot].IsItem() != 0) return 0xFF;`
       * —— 装备槽被占时**不会帮你换**，必须先脱下来。
       * 不判这条的话，玩家拖第二把武器上去只会看到「服务端拒绝」。
       */
      const occupied = inventoryItems.find(i => i.slot === to);
      if (occupied) {
        lastMove.fail = 'slot-occupied';
        lastMove.reason = '该部位已有装备，先脱下来';
        inventoryPanel.toast('该部位已有装备，先把它脱到背包里', 2000);
        return false;
      }
      const check = checkEquip(item.type, to, ch);
      if (!check.ok) {
        lastMove.fail = 'equip';
        lastMove.reason = check.reason;
        inventoryPanel.toast(check.reason ?? '无法装备', 2200);
        return false;
      }
    } else if (!canPlaceInGrid(item.type, to, inventoryItems, from)) {
      lastMove.fail = 'no-space';
      lastMove.reason = '空间不足';
      inventoryPanel.toast('这里放不下（格子被占或超出背包）');
      return false;
    }
  }

  if (connection) {
    pendingMove = { from, to };
    connection.send(buildItemMovePacket(from, to, item));
  }
  // 本地先挪（乐观更新）。这台 0.97k 服务端对 0x24 不一定回执，
  // 等回执再刷新会让拖拽看起来「没反应」；回执回来时只用来纠错。
  applyItemMove(from, to);
  return true;
}

inventoryPanel.onMove = (from, to) => {
  requestItemMove(from, to);
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(DEFAULT_FOG);
const muCamera = new MuCamera(ASPECT);
const clock = new THREE.Clock();
/**
 * 水面动画用的累计时间（秒）。
 *
 * 不用 `performance.now()`：一来换图/暂停后要能重新起步，
 * 二来 `dbgTimeScale` 的减速调试要作用到水面上（方便看清水波）。
 */
let waterTime = 0;
/** 水下滤镜当前不透明度（0..1，缓动到目标值，避免进出水时闪一下） */
let waterTint = 0;
attachIconRenderer(renderer);
attachCharPreviewRenderer(renderer);

/** 视野内的其它玩家 / 怪物 */
const remotes = new RemoteManager(scene, PLAYER_DIR, MONSTER_DIR, NPC_DIR);

/* ------------------------------------------------------------------ */
/* 世界状态                                                            */
/* ------------------------------------------------------------------ */
interface WorldState {
  mapId: number;
  terrain: TerrainMesh;
  objects: WorldObjectsResult;
  /** 物件特效层（火把/篝火/街灯/蜡烛） */
  objectFx: ObjectFxLayer;
  /** 环境粒子（飞鸟 / 花瓣 / 萤火 / 落叶，源码 `Weather_Update`） */
  ambient: AmbientLayer;
  /** 本世界所有临时对象（天空球等）都塞进这个 group，切图时整体丢弃 */
  root: THREE.Group;
}

let world: WorldState | null = null;

/**
 * 「氛围粒子还在后台加载」时的空壳。
 *
 * 和 `emptyWorldObjects()` 一个用途：进场景提前到「地形 + 主角」就绪，
 * 氛围层随后补上，这期间 `world.ambient.setRain/update/dispose` 都被每帧/协议调到。
 */
/** 最近一次天气包给的雨强度（0=停）。氛围层晚到时用它补一次 `setRain` */
let rainTarget = 0;

function emptyAmbient(): AmbientLayer {
  const group = new THREE.Group();
  group.name = 'ambient(loading)';
  return {
    group,
    stats: [],
    setRain() {},
    rainLevel: () => rainTarget,
    update() {},
    dispose() {
      group.removeFromParent();
    },
  };
}

let player: Actor | null = null;
let monsters: Actor[] = [];
let monsterShadows: { mesh: THREE.Mesh; actor: Actor }[] = [];

/* ------------------------------------------------------------------ */
/* 技能特效                                                            */
/* ------------------------------------------------------------------ */
/** 技能特效层之「模型半场」：`Data/Skill/*.bmd`；切图时只清实例，模型缓存留着 */
const effects = new EffectLayer(scene);
/**
 * 技能特效层之「贴图半场」：`Data/Effect/*.ozj|ozt`。
 *
 * 0.97k 里一半技能根本不是模型，而是往槽位 0x4ab..0x596 挂一张贴图面片
 * （火焰、魔法阵、雷电、灵魂连线），只有模型层的话这些技能会「什么都不出」。
 */
const spriteLayer = new SpriteLayer(scene);
/** 关节 / 连线（源码 `Joint_Create`）：两点之间的一道光 */
const beamLayer = new BeamLayer(scene);
/**
 * 武器拖尾（源码 `Trail_RenderAll`）：挥砍时刀尖划过的那条弧。
 * 点是每帧从**持械手骨骼**采样来的（源码里是 `m_vPosSword`）。
 */
const trailLayer = new TrailLayer(scene);
const tmpHand = new THREE.Vector3();
/**
 * 「武器旋转」层（源码 `RenderWheelWeapon` 0x0046B7C0）。
 * 技能 41 霹雳回旋斩的视觉不在 238 号特效槽上（那个槽 `RenderEffects` 直接 break），
 * 而是 238 每帧生成的 239 —— 转的是**玩家手上的武器**。
 */
const wheelLayer = new WeaponWheelLayer(scene);
/** 244 雷霆裂闪：武器举起来砸下去（源码 `ItemDrop_RenderGroundWeapon` 0x0046B980） */
const slamLayer = new WeaponSlamLayer(scene);

/**
 * buff（持续技能效果）层 —— 挂在角色身上的那些光环/冰壳/护盾。
 *
 * 数据来自三条通道：`0x07` 效果状态包、视野包的 `ViewSkillState`、
 * `0x1B` 取消技能效果（技能号 → 掩码）。语义和原版
 * `ApplyPersistentSkillEffect97k` 一致：**只处理变化的那几位**。
 */
const buffLayer = new BuffLayer(scene);

/**
 * buff 视觉的跟随点：角色**脚下**的世界坐标。
 *
 * `BuffLayer` 里所有子节点都以「地面 = z 0」为基准摆（冰壳 1.0、护盾球 0.95…），
 * 所以这里必须给地面高度，不能给模型中心。
 */
function buffActorPos(id: number): { x: number; y: number; z: number } | null {
  if (id === remotes.selfId) {
    return player ? { x: player.x, y: player.y, z: player.z } : null;
  }
  const e = remotes.get(id);
  if (!e) return null;
  const z = world ? world.terrain.getHeight(e.actor.wx, e.actor.wy) : 0;
  return { x: e.actor.wx, y: e.actor.wy, z };
}

/**
 * 预热技能资源：模型（`Data/Skill`）与贴图（`Data/Effect`）一起拉。
 *
 * 清单**从源码表反推** —— 遍历 `castOf()` 的 parts，而不是手写一张表。
 * `SKILL_FX` 只用来补「源码没覆盖到、靠表现兜底」的那几个模型。
 * 第一次放某个技能要 `parseBmd` + 纹理解码，几百毫秒到一秒；
 * 进图后串行预热一遍，之后点 Cast 就是即时的（两层都有缓存）。
 */
async function warmUpSkillAssets() {
  let list: SkillEntry[] = [];
  try {
    list = await loadSkills();
  } catch (err) {
    console.warn('[skill] 预热拿不到技能表', err);
    return;
  }

  const models = new Set<string>();
  const sprites = new Set<string>();
  const beams = new Set<string>();
  for (const skill of list) {
    for (const part of castOf(skill).parts) {
      /*
       * 只预热**真的会按文件名加载**的件。
       * `weapon` / `weaponSlam` 用的是玩家当前武器（不读 part.file），
       * 以前它们落到 else 分支，被当成贴图去 `Data/Effect/Saw01.bmd` 找 ——
       * 控制台里那条 `[texture] 未找到 Skill/Saw01.bmd (dir=Data/Effect/)`
       * 就是这么来的。
       */
      if (part.kind === 'model') models.add(modelName(part.file));
      else if (part.kind === 'beam') beams.add(part.file);
      else if (part.kind === 'sprite' || part.kind === 'trail') sprites.add(part.file);
    }
  }
  for (const f of Object.values(SKILL_FX)) models.add(f.file);

  await effects.warmUp([...models]);
  await spriteLayer.warmUp([...sprites]);
  await beamLayer.warmUp([...beams]);
}

/** 技能测试点：洛兰 (186,129)，离线演示在这里固定刷一只怪物 */
const SKILL_TEST_SPOT = { gx: 186, gy: 129 };
/** 那只怪物（技能菜单打它） */
let skillTarget: Actor | null = null;
/** 施法冷却（秒），防止连点刷屏 */
let castCd = 0;
/**
 * 全局时间缩放（调试用）。
 *
 * 技能特效里短命的件（袭风刺的体表电弧 0.5 s、爆闪 0.55 s、爆裂火花 0.45 s）
 * 在软渲染下根本截不到 —— 一次 `snap()` 本身就要 2~3 秒，等拍到的时候早就灭了。
 * 把它调到 ~0 就能「冻住」再拍，拍完调回 1。
 * 用极小值而不是 0：几处 `k = 1 - pow(a, dt)` 的插值在 dt=0 时虽然等于 0、
 * 无害，但别的地方有 `dt <= 0 return`，容易把「一帧」当成「没这一帧」。
 */
let dbgTimeScale = 1;
let playerShadow: THREE.Mesh | null = null;
let shadowTexture: THREE.Texture | null = null;
let marker: THREE.Mesh | null = null;
let markerLife = 0;

/**
 * 地面物品。挂到 `scene` 而不是 `world.root` ——
 * `disposeWorld()` 会遍历 `world.root` 把材质一起 dispose，
 * 而物品材质是跨图共享的缓存，被 dispose 一次后续所有物品都会变黑。
 */
const groundItems = new GroundItems(scene, (x, y) => world?.terrain.getHeight(x, y) ?? 0);

/** 玩家点中后正在去捡的物品 id（-1 = 没有） */
let pendingPickupId = -1;
/** 已经发过 0x22、正在等服务端回执 */
let pickupSentAt = 0;
/** 等待拾取回执的超时（服务端正常 100ms 内就回，超时说明丢了） */
const PICKUP_TIMEOUT = 3;

/** 当前角色信息（服务端下发的，用于 HUD） */
let currentChar: { name: string; level: number; charSet: number[]; info: CharacterInfo | null } | null =
  null;

/* ------------------------------------------------------------------ */
/* 网络                                                                */
/* ------------------------------------------------------------------ */
let netKeys: NetKeys | null = null;
let connection: MuConnection | null = null;
let session: MuSession | null = null;
let loggedIn = false;

/**
 * 「已经在游戏世界里」的判据。
 *
 * 真实登录靠 `session`（WebSocket 会话）；`/demo` 和离线沙盘没有 socket，
 * 但一样站在洛兰城里。ESC 菜单、面板开关这些只该看「进没进图」，
 * 不该因为没 socket 就整体失效 —— `/demo` 里按 ESC 毫无反应就是这个原因。
 */
function inGameWorld() {
  return loggedIn && (!!session || sandbox.on);
}

/** 调试：最近收到的报文头 */
const recentHeads: string[] = [];
/** 调试：0xF3 的每个子码只打印一次首包，避免刷屏 */
const f3Seen = new Set<number>();
/** 最近 40 个完整报文（头/子码/长度/十六进制），探针定位字段偏移用 */
const pktLog: { head: number; sub: number; size: number; hex: string }[] = [];

async function connectAndLogin(account: string, password: string) {
  const btn = $<HTMLButtonElement>('btn-login');
  btn.disabled = true;
  try {
    setMsg(loginMsg, '读取加密密钥…');
    if (!netKeys) netKeys = await loadNetKeys('/Data/');

    setMsg(loginMsg, '连接 WebSocket 桥…');
    connection?.close();
    remotes.selfId = -1;
    connection = new MuConnection(netKeys);
    session = new MuSession(connection);

    session.onClose = reason => {
      loggedIn = false;
      console.warn(`[MU] 服务端断开 F1/02 reason=${reason}`);
    };

    // 进图后的实体同步都从这里进来（0x12/0x13/0x14/0x11）
    session.onPacket = pkt => {
      // 调试：记录最近收到的报文头（0x12/0x13 是否到达一眼就能看出来）
      const hs = pkt[0] === 0xc2 || pkt[0] === 0xc4 ? 3 : 2;
      recentHeads.push(`0x${pkt[hs].toString(16)}:${pkt.length}`);
      if (recentHeads.length > 80) recentHeads.shift();

      const head = pkt[hs];
      const sub = pkt[hs + 1];

      // 最近 40 个完整包（探针定位字段偏移用；只在内存里转十六进制）
      pktLog.push({
        head,
        sub,
        size: pkt.length,
        hex: Array.from(pkt).map(n => n.toString(16).padStart(2, '0')).join(' '),
      });
      if (pktLog.length > 40) pktLog.shift();

      // 0xF3/06 加点回执：GAMESERVER_EXTRA=1 时带完整四维，直接覆盖本地值
      if (head === 0xf3 && sub === 0x06) {
        applyAddPointReply(pkt);
      }

      /*
       * 0x26 / 0x27 是服务端主动推的 HP / MP 同步包 —— 吃药、被打、自然恢复、
       * 捡到加血装备，全都走这两个。之前完全没处理，所以球上的数字永远停在
       * 进图那一刻的数值，看起来像「没有实时显示」。
       *
       * 格式（`Protocol.h:249` `PMSG_LIFE_SEND` / `PMSG_MANA_SEND`，C1 头 3 字节）：
       *
       *   0x26  [3]=sub  [4..5]=life 或 maxLife（**大端** WORD）
       *         0xFD 锁物品栏  0xFE MaxLife  0xFF Life  其他 = 该槽耐久--
       *   0x27  [3]=sub  [4..5]=mana/maxMana  [6..7]=bp/maxBp
       *         0xFE MaxMana+MaxBP  0xFF Mana+BP
       */
      if ((head === 0x26 || head === 0x27) && pkt.length >= 8) {
        applyVitalReply(head, pkt);
      }

      // 0x00 聊天 / 0x02 密语与 /post / 0x0D 服务端公告（聊天框的三个入口）
      if (head === 0x00 && pkt.length >= hs + 11) {
        applyChatPacket(pkt);
      } else if (head === 0x02 && pkt.length >= hs + 11) {
        // `PMSG_CHAT_WHISPER_SEND`：密语，以及 CommandPostType=0 时 `/post` 的金色公告
        // （`CommandManager::GCPostMessageGold`）。原版 `ReceiveWhisper` 用频道 0。
        const name = readChatStr(pkt, hs + 1, 10);
        const text = readChatStr(pkt, hs + 11);
        if (text) chatBox.push(name, text, 0);
      } else if (head === 0x0d) {
        applyNoticePacket(pkt);
      }

      if (head === 0xf3 && !f3Seen.has(sub)) {
        f3Seen.add(sub);
        console.log(
          `[pkt] 0xF3/0x${sub.toString(16)} 首次到达，${pkt.length}B: ` +
            Array.from(pkt.subarray(0, Math.min(pkt.length, 12)))
              .map(n => n.toString(16).padStart(2, '0'))
              .join(' ')
        );
      }

      // 0x20 地面物品视野 / 0x21 物品离场 / 0x22 拾取回执
      if (head === 0x20) {
        const list = parseViewportItems(pkt);
        if (list && list.length) {
          groundItems.upsert(list);
          itemDebug.last20 = list.length;
        }
      } else if (head === 0x21) {
        for (const id of parseViewportItemDestroy(pkt)) {
          groundItems.remove(id);
          if (pendingPickupId === id) pendingPickupId = -1;
        }
      } else if (head === 0x22) {
        itemDebug.recv22++;
        itemDebug.raw22 = Array.from(pkt.subarray(0, Math.min(pkt.length, 12)));
        handleItemGetResult(pkt);
      } else if (head === 0x24 && pkt[0] === 0xc3) {
        handleItemMoveResult(pkt);
      } else if (head === 0x28 && pkt.length >= 5) {
        /*
         * 0x28 物品消失（`GCItemDeleteSend`，ItemManager.cpp:3256）：`C1 05 28 slot flag`。
         * `/clearinv` 逐格发这个；吃掉地上的东西消失、卖出、合成消耗也走它。
         */
        const slot = pkt[3];
        const next = inventoryItems.filter(i => i.slot !== slot);
        if (next.length !== inventoryItems.length) {
          inventoryItems = next;
          syncInventoryViews();
        }
      } else if (head === 0x2a && pkt.length >= 5) {
        /*
         * 0x2A 耐久/堆叠数变化（`GCItemDurSend`）：`C1 05 2A slot dur flag`。
         * 药水的 `dur` 就是堆叠数 —— 喝一瓶这里就少一，背包角标和 Q/W/E 数量
         * 都得跟着走，否则看起来「喝了不扣」。装备耐久不掉界面，跳过刷新。
         */
        const slot = pkt[3];
        const it = inventoryItems.find(i => i.slot === slot);
        if (it && it.durability !== pkt[4]) {
          it.durability = pkt[4];
          if (Math.round(it.durability) > 1 || it.type >= 448) syncInventoryViews();
        }
      }

      /*
       * —— NPC 对话 / 商店 / 仓库（阶段 AE）——
       *
       * 这一段和上面那批「物品」包共用同一个 switch，所以每个分支都带上
       * 包头类型判断：0x32/0x33 上下行**同号**，只有长度和方向不同，
       * 判错就会把自己发出去的包当成回执处理一遍。
       */
      if (head === 0x30 && pkt[0] === 0xc3) {
        onNpcTalkReply(pkt);
      } else if (head === 0x31 && (pkt[0] === 0xc2 || pkt[0] === 0xc4)) {
        onContainerList(pkt);
      } else if (head === 0x32 && pkt[0] === 0xc1 && pkt.length >= 8) {
        /*
         * 购买回执。成功时服务端**不重发背包表**，只回「落点槽位 + ItemInfo」，
         * 所以这里自己把它插进背包（原版 `case 0x32` 的 InsertInventoryItem 就是这个）。
         *
         * result === 0xFF 有两种完全不同的情况：
         *   a) 真的失败（钱不够 / 背包满 / 接口没开）
         *   b) 买药水叠到已有堆叠 —— `InventoryInsertItemStack` 先扣钱再回 0xFF
         * 判据：金币包 0x22/0xFE 刚刚到过（800ms 内）就是 (b)。
         */
        const r = parseBuyResult(pkt);
        if (r) {
          console.log(
            `[shop] 0x32 回执 result=0x${r.result.toString(16)} ok=${r.ok} item=${r.item ? `type=${r.item.type}` : 'null'}`
          );
          if (r.ok && r.item) {
            inventoryItems = inventoryItems
              .filter(i => i.slot !== r.item!.slot)
              .concat({ ...r.item, slot: r.result });
            syncInventoryViews();
            npcPanel.toast(`购买成功：${itemAttr(r.item.type).name}`, 'ok');
          } else if (performance.now() - lastMoneySyncAt < 800) {
            npcPanel.toast('已购买（叠加到已有堆叠）', 'ok');
          } else {
            npcPanel.toast(`购买失败（result=${r.result}，钱不够或背包满了）`, 'error');
          }
        }
      } else if (head === 0x33 && pkt[0] === 0xc1 && pkt.length >= 8) {
        /*
         * 出售回执：`pMsg.money = lpObj->Money`（**出售后的总金币**，不是这次赚了多少，
         * 见 ItemManager.cpp:3154），而且服务端**不会**再发 0x22 金币包 ——
         * 所以这里必须自己覆盖 `info.money`，否则界面上的钱永远不动。
         * 物品同样要自己删（原版 `case 0x33` 也是拿包里的 slot 自己删，
         * 服务端只发 `UpdateInventoryViewport` 给**周围玩家**，不给自己发背包表）。
         */
        const r = parseSellResult(pkt);
        if (r) {
          if (r.ok) {
            if (currentChar?.info) currentChar.info.money = r.money;
            const sold = pendingSellSlot;
            if (sold >= 0) {
              inventoryItems = inventoryItems.filter(i => i.slot !== sold);
              pendingSellSlot = -1;
              syncInventoryViews();
            }
            refreshHud();
            npcPanel.toast(`出售成功，现有 ${r.money.toLocaleString('en-US')} Zen`, 'ok');
          } else {
            pendingSellSlot = -1;
            npcPanel.toast('出售失败（这件东西商人不要）', 'error');
          }
        }
      } else if (head === 0x34 && pkt[0] === 0xc1) {
        const money = parseRepairResult(pkt);
        if (money !== null) {
          // 修理回执的 money 是**修理后的新余额**，与 0x33 出售、0x22 金币同步同语义
          // （服务端 RepairItem 内部扣完，把 lpObj->Money 原样带回来，并非「本次花费」）。
          // 以前这里用 `balance - money` 相减：
          //   当服务端在 0x34 之前/之后又推一条 0x22 金币同步时，
          //   本地先被 0x22 设成新余额，再被 0x34 减一次 → 余额归零（「点修理全部，zen 全没了」）。
          // 正确做法跟卖东西一样：直接覆盖成服务端给的新余额，不要相减。
          if (money > 0 && currentChar?.info) {
            const before = currentChar.info.money;
            currentChar.info.money = money;
            refreshHud();
            const spent = before > money ? before - money : 0;
            npcPanel.toast(
              spent > 0
                ? `修理花费 ${spent.toLocaleString('en-US')} Zen（余额 ${money.toLocaleString('en-US')}）`
                : `余额 ${money.toLocaleString('en-US')} Zen`,
              spent > 0 ? 'ok' : ''
            );
          } else {
            npcPanel.toast('无需修理', '');
          }
        }
      } else if (head === 0x23 && pkt[0] === 0xc1) {
        onDropReply(pkt);
      } else if (head === 0x81 && pkt[0] === 0xc1) {
        // 仓库金币（C1 09 81 result warehouse[4] inventory[4]）
        const w = parseWarehouseMoney(pkt);
        if (w) {
          warehouseMoney = w.warehouse;
          if (currentChar?.info) currentChar.info.money = w.inventory;
          npcPanel.setWarehouseInfo({
            money: warehouseMoney,
            tax: warehouseTax(),
            locked: warehouseState === 1,
          });
          inventoryPanel.setMoney(w.inventory);
        }
      } else if (head === 0x82 && pkt[0] === 0xc1) {
        // 服务端确认仓库已关闭（它已经把仓库写库并清空内存）
        if (npcMode === 'warehouse') {
          hideNpcPanel();
          chatBox.push('系统', '仓库已关闭', 1);
        }
      } else if (head === 0x19 && pkt.length >= 8) {
        /*
         * 技能广播（`GCSkillAttackSend`）。服务端**也会给自己发一份**，
         * 所以 caster 是自己时直接跳过 —— 本地 `castSkill` 早播过动作和特效，
         * 不跳过就会双播（动作闪两下、特效叠两层）。
         */
        const ev = parseSkillCast(pkt);
        if (ev) playRemoteSkill(ev);
      } else if (head === 0x1e && pkt.length >= 9) {
        /*
         * 持续技能广播（`GCDurationSkillAttackSend`，C3 09）。
         *
         *   `C3 09 1E [skill][idxHi][idxLo][x][y][dir]`
         *
         * 和 0x19 的区别：这条**带落点格号**，绝大多数持续技能（火焰/龙卷风/
         * 地狱火…）没有目标实体，特效要放在 (x,y) 而不是某个实体头上。
         */
        const ev = parseDurationSkillCast(pkt);
        if (ev) {
          skillDebug.duration++;
          playRemoteSkill(ev);
        }
      } else if (head === 0x1b && pkt.length >= 6) {
        /*
         * 某人的技能效果没了（`GCSkillCancelSend`，C1 06）。
         *
         *   `C1 06 1B [skill][idxHi][idxLo]`
         *
         * 服务端在 buff 到期 / 角色死亡时清 `DelEffect`。包里带的是**技能号**，
         * 客户端自己映射成状态位（`Net_Process.cpp:4841` 那个 switch），
         * 然后把对应的那一位从实体身上摘掉。
         */
        const c = parseSkillCancel(pkt);
        if (c) {
          skillDebug.cancels++;
          const bit = SKILL_CANCEL_MASK[c.skill] ?? 0;
          if (bit) buffLayer.applyBit(c.index, bit, false);
          console.log(
            `[skill] 0x1B 取消技能效果 skill=${c.skill} index=${c.index}` +
              (bit ? ` → 清 ${stateNames(bit).join('+')}` : '（该技能没有状态位）')
          );
        }
      } else if (head === 0x07 && pkt.length >= 8) {
        /*
         * 效果状态（`C1 08 07 [state] [mask:LE16] [index:BE16]`，
         * `EffectManager.cpp:816` `GCEffectStateSend`）。
         *
         * 这是 buff 起/停的**权威通道**：守护之魂、战神之力、守护之光、
         * 生命之光、冰封箭、中毒……全部走它。`state` 1 = 加、0 = 撤。
         */
        const ev = parseEffectState(pkt);
        if (ev) {
          const id = ev.index;
          buffLayer.applyBit(id, ev.mask, ev.state === 1);
          const names = stateNames(ev.mask);
          console.log(
            `[buff] 0x07 ${ev.state ? '加' : '撤'} ${names.join('+') || `0x${ev.mask.toString(16)}`}` +
              ` index=${ev.index} → 现有 0x${buffLayer.maskOf(id).toString(16)}`
          );
        }
      } else if (head === 0x0f) {
        /*
         * 天气（`GCWeatherSend`，`Protocol.cpp:1584`）：`C1 04 0F [weather]`。
         *
         * 高半字节 = 类型（0 晴 / 1 雨），低半字节 = 强度；
         * 原版 `RainTarget = 6 * intensity`（`ProtocolCore` case 0xF）。
         * 服务端每 10~20 秒可能换一次（`CMap::WeatherVariationProcess`）。
         */
        const w = parseWeather(pkt);
        if (w !== null) {
          const wType = (w >> 4) & 0x0f;
          const intensity = w & 0x0f;
          applyWeather(wType, intensity);
        }
      } else if (head === 0x46) {
        /*
         * 地图属性变化（`GCMapAttrSend`）：`C1 size 46 [type][attr][flag][count] (x,y,tx,ty)×n`。
         * 血堡/恶魔广场用它把一片区域改成「可传送 / 禁传送」。
         */
        const chunk = parseMapAttr(pkt);
        if (chunk) applyMapAttr(chunk);
      } else if (head === 0x29) {
        /*
         * 特殊物品计时（`GCItemUseSpecialTimeSend`，C3）：`[number][time:int32]`。
         * 原版用它显示「还剩多少秒」，这里只给一条提示 + 记账。
         */
        const st = parseSpecialTime(pkt);
        if (st) {
          itemSpecialTime = { number: st.number, until: performance.now() + st.time * 1000 };
          chatBox.push('系统', `特殊物品生效：剩余 ${Math.max(0, st.time)} 秒`, 2);
          console.log(`[item] 0x29 number=${st.number} time=${st.time}s`);
        }
      } else if (head === 0x2c) {
        /*
         * 果实结果（`PMSG_FRUIT_RESULT_SEND`）：`result` 低两位 0 成功 / 1 类型错 / 3 失败，
         * 长包带加完之后的四维（`ViewStrength` 等），直接覆盖本地值。
         */
        const fr = parseFruitResult(pkt);
        if (fr) applyFruitResult(fr);
      } else if (head === 0xf3 && sub === 0x40) {
        /*
         * ServerCommand（`Protocol.cpp:2131` `GCServerCommandSend`）。
         *
         *   C1 07 F3 40 [type] [cmd1] [cmd2]
         *
         * `type` 区分用途（`Net_Process.cpp:3235`）：
         *   0 = 烟花（cmd1/cmd2 是坐标）
         *   1 = **文本提示**：`GlobalText[cmd1 < 20 ? cmd1 + 650 : cmd1 + 810]`
         *   2 = 音效
         *   3 = 文本：`GlobalText[cmd1 + 710]`
         *   5 = 推进商店对话
         *   6 = `GlobalText[449]`
         *
         * 事件 NPC 拒绝入场时走的就是**这个包**（不是 0x30 result），
         * 比如没票 / 时间不对。之前本 port 完全不认它，表现就是
         * 「点 Charon 什么都不发生」。
         */
        const type = pkt[hs + 2] ?? 0;
        const cmd1 = pkt[hs + 3] ?? 0;
        const cmd2 = pkt[hs + 4] ?? 0;
        const text = serverCommandText(type, cmd1);
        if (text) chatBox.push('系统', text, 1);
        console.log(`[cmd] 0xF3/0x40 type=${type} cmd1=${cmd1} cmd2=${cmd2} → ${text ?? '（无文案）'}`);
      } else if (head === 0xf3 && sub === 0xe3) {
        /*
         * 堆叠上限表（`CItemStack::GCItemStackListSend`）。
         * 参考客户端把这条注释成「任务表」，实际是 DLL 的 `CItemStack`。
         * 拿到之后背包 tooltip 能显示「可堆叠 N」，拆分堆叠也才有依据。
         */
        const list = parseItemStackList(pkt);
        if (list) setItemStackList(list);
      } else if (head === 0xf3 && sub === 0xe4) {
        /*
         * 固定价格表（`CItemValue::GCItemValueListSend`）。
         * MuEmu 的算价公式和 0.97 客户端内建的不一样，服务端按自己那份收钱，
         * 所以要显示价格就必须用它推过来的表。
         */
        const list = parseItemValueList(pkt);
        if (list) setItemValueList(list);
      } else if (head === 0xf3 && sub === 0xe5) {
        /*
         * `/move` 列表（`CMove::GCMoveListSend`）。
         *
         * 服务端每个条目都带**按角色算好**的 MinLevel/MinReset/CanMove
         * （`gGate.GetMoveLevel` 会看 VIP 账号等级），比本地 `Move.txt` 准。
         * 这里只覆盖字段，不替换整表 —— 服务端不给 Gate 落点矩形。
         */
        const list = parseMoveList(pkt);
        if (list) {
          setMoveList(list);
          const hit = applyServerMoveList(list);
          console.log(`[move] F3/E5 ${list.length} 条，匹配本地 ${hit} 条（价格/门槛已用服务端值）`);
          refreshMovePanel();
        }
      } else if (head === 0xf3 && sub === 0xe6) {
        /*
         * 事件时间整表（血色城堡 / 恶魔广场 / 入侵 …）。
         * **服务端每秒推一次**，每次都只改倒计时 —— 全量打日志会把控制台刷满
         * （调试其它功能时根本看不到有效信息），所以只在「状态/条目」变化时打。
         */
        const list = parseEventTime(pkt);
        if (list) {
          eventTimer.setEvents(list);
          skillDebug.events = list;
          const sig = list.map(e => `${e.name}:${e.status}`).join('|');
          if (sig !== lastEventSig) {
            lastEventSig = sig;
            console.log(
              `[event] 0xE6 ${list.length} 条：` +
                list.map(e => `${e.name}=${e.status}/${e.time}s`).join(' ')
            );
          }
        }
      } else if (head === 0x36) {
        /*
         * 有人请求交易（`PMSG_TRADE_REQUEST_SEND`，C3 头）。
         * 包里只有**对方名字** —— 回复 0x37 不需要索引，服务端用自己记的
         * `TargetNumber`，所以这里 index 传 0。
         */
        const req = parseTradeRequest(pkt);
        if (req) {
          tradePanel.showRequest(0, req.name);
          chatBox.push('系统', `${req.name} 请求交易（T 打开窗口应答）`, 1);
          console.log(`[trade] 0x36 收到请求 name=${req.name}`);
        }
      } else if (head === 0x37) {
        // response 1 = 交易开始（name/level 是对方的）；0 = 被拒绝 / 中断
        const r = parseTradeResponse(pkt);
        if (r) {
          if (r.response === 1) {
            tradeMine = [];
            tradeTheirs = [];
            tradeOk = { mine: false, theirs: false };
            tradePanel.show(r.name, r.level);
            refreshTradePanel();
            tradePanel.setOk(false, false);
            chatBox.push('系统', `与 ${r.name} 的交易开始`, 1);
          } else {
            tradePanel.hide();
            chatBox.push('系统', '交易未开始（对方拒绝或距离太远）', 1);
          }
          console.log(`[trade] 0x37 response=${r.response} name=${r.name} lv=${r.level}`);
        }
      } else if (head === 0x38) {
        // 对方拿走一件
        const d = parseTradeItemDel(pkt);
        if (d) {
          tradeTheirs = tradeTheirs.filter(i => i.slot !== d.slot);
          tradePanel.setTheirs(tradeTheirs);
          console.log(`[trade] 0x38 对方取回交易格 ${d.slot}`);
        }
      } else if (head === 0x39) {
        // 对方放进一件
        const a = parseTradeItemAdd(pkt);
        if (a) {
          tradeTheirs = tradeTheirs.filter(i => i.slot !== a.slot).concat(a.item);
          tradePanel.setTheirs(tradeTheirs);
          console.log(`[trade] 0x39 对方放入交易格 ${a.slot} type=${a.item.type}`);
        }
      } else if (head === 0x3a) {
        const r = parseTradeMoneyResult(pkt);
        if (r) {
          if (r.result !== 1) chatBox.push('系统', '金币放入失败（超出上限或余额不足）', 1);
          console.log(`[trade] 0x3A 金币结果 result=${r.result}`);
        }
      } else if (head === 0x3b) {
        const m = parseTradeMoney(pkt);
        if (m) {
          tradePanel.setMoney(currentChar?.info?.money ?? 0, m.money);
          console.log(`[trade] 0x3B 交易金币 ${m.money}`);
        }
      } else if (head === 0x3c) {
        /*
         * 确定状态：服务端把「对方是否已确定」发给我（flag 1 = 对方确定了）。
         * flag 0 = 有人改动物品/金币 → 双方状态清零。
         */
        const ok = parseTradeOk(pkt);
        if (ok) {
          if (ok.flag === 0) {
            tradeOk = { mine: false, theirs: false };
          } else {
            tradeOk.theirs = true;
          }
          tradePanel.setOk(tradeOk.mine, tradeOk.theirs);
          console.log(`[trade] 0x3C flag=${ok.flag}`);
        }
      } else if (head === 0x3d) {
        // 结果：0 取消 / 1 成功 / 2 背包放不下 / 5 金币超上限
        const r = parseTradeResult(pkt);
        if (r) {
          const text =
            r.result === 1
              ? '交易完成'
              : r.result === 2
                ? '交易失败：背包放不下'
                : r.result === 5
                  ? '交易失败：金币超过上限'
                  : '交易已取消';
          chatBox.push('系统', text, 1);
          if (r.result !== 1) {
            tradeMine = [];
            tradeTheirs = [];
          }
          tradeOk = { mine: false, theirs: false };
          tradePanel.hide();
          console.log(`[trade] 0x3D 结果 ${r.result}`);
        }
      } else if (head === 0x8e && pkt[0] === 0xc1) {
        // 恶魔广场等级表（Charon 237 对话时，紧接在 0x30 之前）
        const r = parseEventRequiredLevels(pkt, 'ds');
        if (r) {
          dsRanges = r;
          console.log(`[event] 0x8E 恶魔广场等级表 ` + r.map((x, i) => `${i + 1}:${x.min}-${x.max}`).join(' '));
        }
      } else if (head === 0x8f && pkt[0] === 0xc1) {
        // 血色城堡等级表：12 行（0-5 普通 / 6-11 魔剑士）
        const r = parseEventRequiredLevels(pkt, 'bc');
        if (r) {
          bcRanges = r;
          console.log(
            `[event] 0x8F 血色城堡等级表 ` + r.map((x, i) => `${i + 1}:${x.min}-${x.max}`).join(' ')
          );
        }
      } else if (head === 0x90 && pkt[0] === 0xc1) {
        // 恶魔广场入场结果（0 成功）
        const r = parseEventEnterResult(pkt, 0x90);
        if (r) onEventEnterResult(r.result, 'ds');
      } else if (head === 0x91 && pkt[0] === 0xc1) {
        // 「还有多久开」。RemainTime 是**分钟**，0 = 现在就能进
        const r = parseEventRemainTime(pkt);
        if (r) {
          /*
           * `EventType = 0` 不是「恶魔广场」也不是「血色城堡」——
           * 服务端在 `ItemLevel - 1` 越界时会把它**改成 0** 再回
           * （`Protocol.cpp:935 / 959`），意思是「你问的那一档不存在」。
           * 最常见的成因是票的 `m_Level` 是 0（GM 造物没给等级）。
           */
          const text =
            r.eventType === 0
              ? '这张票没有等级信息（服务端不认这一档）'
              : r.eventType === EVENT_TYPE.DEVIL_SQUARE
                ? r.minutes
                  ? `恶魔广场 还有 ${r.minutes} 分钟开放`
                  : '恶魔广场 现在就可以进入'
                : r.minutes
                  ? `血色城堡 还有 ${r.minutes} 分钟开放`
                  : '血色城堡 现在就可以进入';
          chatBox.push('系统', text, 1);
          console.log(`[event] 0x91 type=${r.eventType} 剩余 ${r.minutes} 分钟 → ${text}`);
        }
      } else if (head === 0x92 && pkt[0] === 0xc1) {
        // 赛事倒计时开始（type 0-based，客户端 +1 = 1 恶魔广场 / 2 血色城堡）
        const r = parseMatchCountDown(pkt);
        if (r) {
          const label = r.type === EVENT_TYPE.DEVIL_SQUARE ? '恶魔广场' : '血色城堡';
          chatBox.push('活动', `【${label}】30 秒后开始，准备入场`, 1);
          console.log(`[event] 0x92 倒计时 type=${r.type}`);
        }
      } else if (head === 0x93 && pkt[0] === 0xc1) {
        // 恶魔广场排名（count=0xFF 表示只更新一条）
        const r = parseDevilSquareRank(pkt);
        if (r) {
          chatBox.push(
            '活动',
            `【恶魔广场】#${r.rank} ${r.name} 分数 ${r.score}（经验 ${r.exp} / 金币 ${r.money}）`,
            1
          );
          console.log(
            `[event] 0x93 rank=${r.rank} count=${r.count} ${r.name} score=${r.score}`
          );
        }
      } else if (head === 0x9a && pkt[0] === 0xc1) {
        // 血色城堡入场结果（0 成功）
        const r = parseEventEnterResult(pkt, 0x9a);
        if (r) onEventEnterResult(r.result, 'bc');
      } else if (head === 0x9b && pkt[0] === 0xc1) {
        /*
         * 赛事状态（只有血色城堡发）：state / 剩余秒数 / 怪物进度 / 事件道具持有者。
         * 进图、阶段切换各推一次；之后本地自己按秒递减。
         */
        const r = parseMatchState(pkt);
        if (r) {
          matchState = r;
          eventTimer.setMatch({
            kind: 'bc',
            state: r.state,
            seconds: r.time,
            maxMonster: r.maxMonster,
            curMonster: r.curMonster,
            itemOwner: r.itemOwner === remotes.selfId ? '你' : '',
            itemLevel: r.itemLevel,
          });
          console.log(
            `[event] 0x9B state=${r.state} ${r.time}s 怪物 ${r.curMonster}/${r.maxMonster} ` +
              `道具持有 ${r.itemOwner}(${r.itemLevel})`
          );
        }
      } else if (head === 0x50 && pkt[0] === 0xc1) {
        /*
         * 有人在我面前打了 `/guild`：他的入盟申请到了我这里。
         * 只有会长会收到（服务端校验过），回 0x51。
         */
        const req = parseGuildRequest(pkt);
        if (req) {
          const name = remotes.get(req.index)?.name ?? `玩家 ${req.index}`;
          guildPanel.showRequest(name, req.index);
          if (!guildPanel.isOpen) toggleGuildPanel();
          chatBox.push('系统', `${name} 申请加入战盟（战盟窗口里应答）`, 1);
          console.log(`[guild] 0x50 入盟申请 index=${req.index} name=${name}`);
        }
      } else if (head === 0x51 && pkt[0] === 0xc1) {
        const r = parseGuildResult(pkt);
        if (r) {
          const text =
            r.result === 1
              ? '已加入战盟'
              : r.result === 2
                ? '战盟人数已满'
                : r.result === 4
                  ? '对方不是战盟会长（或没有战盟）'
                  : r.result === 5
                    ? '你已经在战盟里了'
                    : r.result === 6
                      ? '对方正在忙 / 战盟战中'
                      : r.result === 7
                        ? '等级不足（需要 6 级以上）'
                        : '入盟申请被拒绝';
          chatBox.push('系统', text, 1);
          if (r.result === 1) {
            guildPanel.clearRequest();
            connection?.send(buildGuildListRequestPacket());
          }
          console.log(`[guild] 0x51 结果 result=${r.result} ${text}`);
        }
      } else if (head === 0x52 && (pkt[0] === 0xc2 || pkt[0] === 0xc4)) {
        const list = parseGuildList(pkt);
        if (list) {
          lastGuildList = list;
          guildPanel.setList(list);
          console.log(
            `[guild] 0x52 成员 ${list.count} 人 总分 ${list.totalScore} 贡献 ${list.playScore}` +
              (list.count ? `：${list.members.map(m => `${m.master ? '*' : ''}${m.name}`).join(' ')}` : '（无战盟）')
          );
        }
      } else if (head === 0x53 && pkt[0] === 0xc1) {
        const r = parseGuildDeleteResult(pkt);
        if (r) {
          const ok = r.result === 1;
          chatBox.push('系统', ok ? '战盟操作成功' : `战盟操作失败（result=${r.result}，个人码错了？）`, 1);
          // 成功就重新拉一次成员表：退盟/被驱逐/解散都会让表变
          if (ok && connection?.connected) connection.send(buildGuildListRequestPacket());
          console.log(`[guild] 0x53 结果 result=${r.result}`);
        }
      } else if (head === 0x55 && pkt[0] === 0xc1) {
        // 服务端同意开创建框（等级 / 转身都够）
        if (parseGuildCreateOpen(pkt)) {
          guildPanel.openCreate();
          console.log('[guild] 0x55 服务端允许创建战盟');
        }
      } else if (head === 0x56 && pkt[0] === 0xc1) {
        const r = parseGuildCreateResult(pkt);
        if (r) {
          const ok = r.result === 1;
          if (ok) {
            guildPanel.closeCreate(false);
            guildPanel.toast(`战盟「${pendingGuildCreate ?? ''}」创建成功`, 'ok');
            chatBox.push('系统', `战盟「${pendingGuildCreate ?? ''}」创建成功`, 1);
            connection?.send(buildGuildListRequestPacket());
          } else {
            const why =
              r.result === 0
                ? '名字已被占用'
                : r.result === 2
                  ? '名字长度必须是 2~8 个字符'
                  : r.result === 3
                    ? '你已经属于某个战盟'
                    : r.result === 4
                      ? '名字里不能有空格'
                      : r.result === 5
                        ? '名字里有非法字符'
                        : `创建失败（result=${r.result}）`;
            guildPanel.toast(why, 'error');
            chatBox.push('系统', why, 1);
          }
          console.log(`[guild] 0x56 建盟结果 result=${r.result}`);
          pendingGuildCreate = null;
        }
      } else if (head === 0x5c && pkt[0] === 0xc1) {
        // 某人（含自己）的战盟名 + 标志
        const g = parseGuildViewportCreate(pkt);
        if (g) {
          if (g.index === remotes.selfId) {
            sawSelfGuildViewport = true;
            guildPanel.setMyGuild(g.name, g.mark);
          }
          else remotes.setGuild(g.index, g.name, g.mark);
          console.log(`[guild] 0x5C index=${g.index} 战盟「${g.name}」`);
        }
      } else if (head === 0x5d && pkt[0] === 0xc1) {
        const g = parseGuildViewportDelete(pkt);
        if (g) {
          if (g.index === remotes.selfId) guildPanel.setMyGuild('');
          else remotes.setGuild(g.index, '');
          console.log(`[guild] 0x5D 清除 index=${g.index} 的战盟标记`);
        }
      } else if (head === 0x60 && pkt[0] === 0xc1) {
        const r = parseGuildWarResult(pkt);
        if (r) chatBox.push('系统', guildWarText(r.result), 1);
      } else if (head === 0x61 && pkt[0] === 0xc1) {
        const w = parseGuildWarDeclare(pkt);
        if (w) chatBox.push('战盟', `【战盟战】${w.name} ${w.type ? '接受了战盟战' : '宣战'}`, 1);
      } else if (head === 0x62 && pkt[0] === 0xc1) {
        const w = parseGuildWarStart(pkt);
        if (w) {
          chatBox.push('战盟', `【战盟战】与 ${w.name} 开战（${w.team === 0 ? '蓝队' : '红队'}）`, 1);
          connection?.send(buildGuildWarAnswerPacket(1));
        }
      } else if (head === 0x63 && pkt[0] === 0xc1) {
        const w = parseGuildWarEnd(pkt);
        if (w) chatBox.push('战盟', `【战盟战】与 ${w.name} 结束（result=${w.result}）`, 1);
      } else if (head === 0x64 && pkt[0] === 0xc1) {
        const w = parseGuildWarScore(pkt);
        if (w) chatBox.push('战盟', `【战盟战】当前比分 ${w.score}`, 1);
      } else if (head === 0x94 && pkt[0] === 0xc1) {
        /*
         * 0x94 打开收集器界面。**服务端不发 0x30** —— 对话 NPC 236 之后
         * 直接来这一条（`NpcGoldenArcher → NpcGoldenArcherOpenSend`），
         * 所以「面板该弹了」只能靠它判断。
         */
        const d = parseGoldenArcherOpen(pkt);
        if (d) openGoldenArcher(d);
      } else if (head === 0x95 && pkt[0] === 0xc1) {
        // 登记回执：`count` 是 short，-1 = 背包里没有对应物品
        const r = parseGoldenArcherRegister(pkt);
        if (r) {
          if (r.count < 0) {
            const what = gaPanel.type === 1 ? '宝石' : '雷娜';
            gaPanel.toast(`背包里没有${what}`, 'error');
            chatBox.push('系统', `背包里没有${what}（物品 469 的等级 ${gaPanel.type}）`, 1);
          } else {
            gaPanel.setCount(r.count);
            gaPanel.toast(`已登记 ${r.count}`, 'ok');
          }
          console.log(`[ga] 0x95 回执 count=${r.count}`);
        }
      } else if (head === 0x96 && pkt[0] === 0xc1) {
        // 服务端推来的幸运号码（12 位字母数字）
        const r = parseGoldenArcherLuckyNumber(pkt);
        if (r) {
          gaPanel.setLucky(r.lucky);
          console.log(`[ga] 0x96 幸运号码「${r.lucky}」`);
        }
      } else if (head === 0x97) {
        /*
         * 0x97 有四个子码（C1 时子码在 +3、C2 长包在 +4，`sub` 已经算好了）：
         *   0x00 兑换配置 / 0x01 已登记号码列表 / 0x03 登记号码回执 / 0x04 关闭
         */
        if (sub === 0x00) {
          const inf = parseGoldenArcherInfo(pkt);
          if (inf) {
            gaInfo = inf;
            gaPanel.setInfo(inf);
            console.log(
              `[ga] 0x97/0x00 兑换配置 雷娜 ${inf.renaRequired.join('/')} ` +
                `宝石 ${inf.stoneRequired.join('/')} VIP ${inf.stoneVipHours.join('/')}h ` +
                `幸运号码 ${inf.luckyRequired}`
            );
          }
        } else if (sub === 0x01) {
          const l = parseGoldenArcherList(pkt);
          if (l) {
            gaPanel.setLuckyNumbers(l.numbers);
            gaPanel.showList();
            console.log(`[ga] 0x97/0x01 已登记号码 ${l.numbers.length} 个`);
          }
        } else if (sub === 0x03) {
          const r = parseGoldenArcherRegisterLuckyResult(pkt);
          if (r) {
            const text =
              ['幸运号码登记成功', '登记幸运号码时出错', '你需要先有一个幸运号码', '幸运号码不正确'][
                r.result
              ] ?? `登记失败（result=${r.result}）`;
            gaPanel.toast(text, r.result === 0 ? 'ok' : 'error');
            chatBox.push('系统', text, 1);
            console.log(`[ga] 0x97/0x03 result=${r.result} → ${text}`);
          }
        } else if (sub === 0x04 || isGoldenArcherClose(pkt)) {
          // 服务端要求关窗：它自己已经把 Interface 清了，客户端只收起界面
          gaPanel.hide();
          bottomBar.setActive(null);
          console.log('[ga] 0x97/0x04 服务端要求关闭');
        }
      } else if (head === 0x9d && pkt[0] === 0xc1) {
        // 用幸运号码领奖的结果（0..3 → GlobalText[911..914]）
        const r = parseGoldenArcherExchangeLuckyResult(pkt);
        if (r) {
          const text =
            ['恭喜！请领取你的奖励。', '这个幸运号码没有奖励。', '你没有登记过任何幸运号码。', '输入的幸运号码不正确。'][
              r.result
            ] ?? `领奖失败（result=${r.result}）`;
          gaPanel.toast(text, r.result === 0 ? 'ok' : 'error');
          chatBox.push('系统', text, 1);
          console.log(`[ga] 0x9D result=${r.result} → ${text}`);
        }
      } else if (head === 0x86 && pkt[0] === 0xc1) {
        onChaosMixResult(pkt);
      } else if (head === 0x87) {
        /*
         * 关闭确认：`PBMSG_HEAD` 3 字节，没有 payload。
         * 注意**不能**用 `npcMode === 'chaos'` 判断 —— `closeChaosPanel()` 发完包
         * 就把 npcMode 清了（界面即时收掉），回执这时候才到，条件永远不成立。
         */
        onChaosClosed();
      } else if (head === 0x88 && pkt[0] === 0xc1) {
        onChaosRateReply(pkt);
      } else if (head === 0x40) {
        /*
         * 有人邀请你组队（`CParty::PMSG_PARTY_REQUEST_SEND`）。
         * 服务端同时把双方的 `Interface` 置成 PARTY，所以在应答之前
         * 双方都开不了商店/仓库 —— 这一步别拖太久。
         */
        const req = parsePartyRequest(pkt);
        if (req) {
          const name = remotes.get(req.index)?.name ?? `玩家 ${req.index}`;
          partyPanel.showInvite(req.index, name);
          if (!partyPanel.isOpen) partyPanel.show();
          chatBox.push('系统', `${name} 邀请你组队（P 打开面板应答）`, 1);
          console.log(`[party] 0x40 收到邀请 index=${req.index} name=${name}`);
        }
      } else if (head === 0x41) {
        // 组队结果：1 = 对方拒绝 / 邀请失败，2 = 组队失败（队伍满）
        const r = parsePartyResult(pkt);
        if (r) {
          const text =
            r.result === 1 ? '组队失败：对方拒绝或当前无法邀请' : r.result === 2 ? '组队失败：队伍已满' : `组队失败（${r.result}）`;
          chatBox.push('系统', text, 1);
          console.log(`[party] 0x41 结果 result=${r.result}`);
        }
      } else if (head === 0x42) {
        /*
         * 队伍列表。`result = 0` 表示自己没队伍（服务端只在有队伍时发成员）。
         * 每次成员变化服务端都会重发整表，客户端整份替换即可。
         */
        const list = parsePartyList(pkt);
        if (list) {
          partyMembers = list.result === 0 ? [] : list.members;
          partyPanel.setMembers(partyMembers);
          partyLife.clear();
          refreshNearbyPlayers();
          console.log(
            `[party] 0x42 列表 result=${list.result} 成员 ${partyMembers.length}：` +
              partyMembers.map(m => `${m.number}:${m.name}`).join(' ')
          );
        }
      } else if (head === 0x44) {
        // 队伍血量（每字节高 4 bit 位置、低 4 bit 十等分血量）
        const life = parsePartyLife(pkt);
        if (life) {
          partyPanel.setLife(life);
          // 同一份数据也进头顶血条（原版 `DAT_07e11e98` 就是被这两处共用的）
          for (const l of life) partyLife.set(l.number, Math.max(0, Math.min(10, l.tenths)));
        }
      } else if (head === 0xa0) {
        /*
         * 任务状态整表（`GCQuestInfoSend`）：登录时服务端会推一次，
         * 之后只有单条 0xA1/0xA2 更新。50 字节 bitmask = 192 个任务 × 2 bit。
         */
        const mask = parseQuestInfo(pkt);
        if (mask) {
          questMask = mask;
          const active = Array.from(mask).filter(b => b !== 0).length;
          console.log(`[quest] 0xA0 任务表 ${pkt.length}B，非零字节 ${active}`);
          void ensureQuestData().catch(() => undefined);
        }
      } else if (head === 0xa1) {
        // 单个任务状态变化
        const upd = parseQuestStateUpdate(pkt);
        if (upd) {
          setQuestStateInMask(questMask, upd.index, upd.state);
          questStates.set(upd.index, upd.state);
          questPanel.setState(upd.index, upd.state);
          console.log(`[quest] 0xA1 index=${upd.index} → 状态 ${upd.state}`);
          // 原版 `Net_Process.cpp:7213`：0xA1 之后一定 ShowQuestNpcWindow(-1)
          if (pendingQuestDialogRefresh === upd.index) {
            pendingQuestDialogRefresh = -1;
            void reopenQuestDialog(upd.index, upd.state);
          }
        }
      } else if (head === 0xa2) {
        // 接取/完成回执（处理逻辑见 applyQuestResult，探针复用同一条路径）
        const r = parseQuestResult(pkt);
        if (r) applyQuestResult(r);
      } else if (head === 0xa3) {
        const rw = parseQuestReward(pkt);
        if (rw) handleQuestReward(rw);
      } else if (head === 0x83 && pkt[0] === 0xc1) {
        /*
         * 0x83 下行（`GCWarehouseStateSend`）：state 就是「锁状态/结果码」。
         * 打开仓库时服务端也会发一次当前状态（PW>0 且未锁 = 12，锁着 = 1，无密码 = 0）。
         */
        const st = parseWarehouseState(pkt);
        if (st !== null) {
          warehouseState = st;
          if (npcPanel.isOpen && npcMode === 'warehouse') {
            npcPanel.setWarehouseInfo({
              money: warehouseMoney,
              tax: warehouseTax(),
              locked: st === 1,
            });
          }
          const text =
            st === 0
              ? '仓库密码未设置'
              : st === 1
                ? '仓库已上锁（取物需要密码）'
                : st === 10
                  ? '仓库密码错误'
                  : st === 11
                    ? '仓库已上锁，请先解锁再设置'
                    : st === 12
                      ? '仓库已解锁'
                      : st === 13
                        ? '个人码错误'
                        : '';
          if (text) {
            chatBox.push('系统', text, 1);
            npcPanel.toast(text, st === 12 || st === 0 ? 'ok' : 'error');
          }
        }
      }

      /*
       * 0xF3/0x14 单格物品更新（PSBMSG_HEAD 4 字节 + slot + ItemInfo[4] = 9B）。
       * 服务端「物品被改动」时只发这一条，不重发整张表：GM 的 /make、/makeset、
       * 追加等级变化、耐久变化都走它。之前没接，所以 /make 明明回
       * 「Item created」而背包里是空的。
       */
      if (head === 0xf3 && sub === 0x14) {
        const one = parseItemModify(pkt);
        if (one) {
          inventoryItems = inventoryItems.filter(i => i.slot !== one.slot).concat(one);
          syncInventoryViews();
        }
      }

      // 0xF3/0x05 升级：等级 / 可分配点 / 属性上限 / 经验，外加那套升级特效
      if (head === 0xf3 && sub === 0x05) {
        applyLevelUp(pkt);
      }

      /*
       * 0xF3/0x11 技能列表（`GCSkillListSend` / `GCSkillAddSend` / `GCSkillDelSend`）。
       * 同一个包三种语义靠 `count` 区分（0xFE 学、0xFF 忘、其余=条数），
       * 细节见 `game.ts` 的 `parseSkillList`。
       */
      if (head === 0xf3 && sub === 0x11) {
        applySkillList(pkt);
      }

      // 0xF3/0x10 背包物品列表（进图时下发一次，之后每次拾取/移动后可能重发）
      if (head === 0xf3 && sub === 0x10) {
        const list = parseItemList(pkt);
        const raw = Array.from(pkt.subarray(0, Math.min(pkt.length, 16)))
          .map(n => n.toString(16).padStart(2, '0'))
          .join(' ');
        if (list) {
          inventoryItems = list;
          syncInventoryViews();
          console.log(`[MU] 背包同步：${list.length} 件（${pkt.length}B: ${raw}）`);
        } else {
          console.warn(`[MU] 背包包解析失败（${pkt.length}B: ${raw}）`);
        }
      }

      // 0x17 玩家死亡：C1 08 17 [idHi] [idLo] skill [killerHi] [killerLo]
      if (head === 0x17) {
        const id = (pkt[hs + 1] << 8) | pkt[hs + 2];
        if (id === remotes.selfId) {
          playerDead = true;
          movePath = [];
          if (player) {
            player.play(12, false); // 玩家死亡动作
            damageTexts.spawn(
              { x: player.x, y: player.y, z: player.z + 2.4 },
              'YOU DIED',
              'hurt'
            );
          }
        }
      }

      // F3/04 重生：C3 F3 04 X Y Map Dir Life(2) Mana(2) ...
      if (head === 0xf3 && sub === 0x04 && pkt.length >= 10) {
        playerDead = false;
        const x = pkt[hs + 2];
        const y = pkt[hs + 3];
        // 死亡时可能被送回主城（map 变了），所以走统一的「按服务端坐标落地」
        void serverTeleport(pkt[hs + 4], x, y, pkt[hs + 5]);
        if (currentChar?.info) {
          currentChar.info.life = pkt[hs + 6] | (pkt[hs + 7] << 8);
          refreshHud();
        }
        console.log(`[MU] 角色重生 ${x},${y} map=${pkt[hs + 4]}`);
      }

      /*
       * 0x1C 传送 / 换图（`CMove::GCTeleportSend`）：
       *   `C3 08 1C gate map x y dir`
       *
       * 走过 Gate（`gObjMoveGate`）、被 GM 踢去别的地图、血色城堡入场都会发它。
       * **必须按服务端给的 map 重载场景** —— 只改坐标的话，人在诺利亚，
       * 客户端还画着洛兰的地形和碰撞，之后所有寻路和点击都会错。
       */
      if (head === 0x1c && pkt[0] === 0xc3 && pkt.length >= 8) {
        console.log(
          `[MU] 0x1C 传送 gate=${pkt[3]} map=${pkt[4]} (${pkt[5]},${pkt[6]}) dir=${pkt[7]}`
        );
        void serverTeleport(pkt[4], pkt[5], pkt[6], pkt[7]);
      }

      if (head === 0x12 || head === 0x13 || head === 0x14) lastViewportAt = performance.now();
      remotes.handle(pkt);
    };

    // 网关候选：dev server 内嵌的 /mu 优先，连不上再退到 5181 的独立进程
    // 目标地址来自「选择线路」那一步（ConnectServer 的 F4/03 回包），
    // 没走选服（离线/探针直连）时就是常量 127.0.0.1:55901。
    let bridgeUrl = '';
    for (const url of bridgeUrls(gameServer.host, gameServer.port)) {
      try {
        await connection.connect(url);
        bridgeUrl = url;
        break;
      } catch {
        /* 试下一条 */
      }
    }
    if (!bridgeUrl) throw new Error('网关连接失败（/mu 与 5181 都不通）');
    console.log(`[MU] 网关 ${bridgeUrl.split('?')[0]}`);

    setMsg(loginMsg, '握手中…');
    const version = await session.waitGreeting();
    /*
     * 自己的对象索引只能从握手包拿：服务端不会把自己放进 0x12 视野包
     * （`CreateViewportPlayer` 里 `n == aIndex` 跳过），所以「按名字匹配」
     * 那条路永远不成立，selfId 会一直是 -1。没有它，「别人打我」「自己放技能
     * 被抄送一份」这些判断全失效。
     */
    if (session.selfIndex >= 0) {
      remotes.selfId = session.selfIndex;
      console.log(`[MU] selfId=${remotes.selfId}（来自 F1/00）`);
    }

    setMsg(loginMsg, `登录中（服务端版本 ${version}）…`);
    const result = await session.login({
      account,
      password,
      // 固定指纹，避免每次登录都被当成新设备触发黑名单逻辑
      hwid: 'H5MU0001-1A2B3C4D-5E6F7081-92A3B4C5',
      clientVersion: version,
      clientSerial: 'TbYehR2hFUPBKgZj',
      lang: 0,
    });

    if (result !== 1) {
      throw new Error(`登录失败：${LoginResult[result] ?? `result=${result}`}`);
    }

    const chars = await session.requestCharacterList();
    loggedIn = true;
    setMsg(loginMsg, '');
    renderCharList(chars);
    showScreens({ charselect: true });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    setMsg(loginMsg, `✗ ${text}（先确认 MuServer 已启动）`, 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

/** 选角列表缓存：面板要显示等级，0xF3/04 角色包里不带等级 */
let charSummaries: CharacterSummary[] = [];
/**
 * 账号最多几个角色（原版 0.97 是 5 个槽）。
 * ⚠️ 改的话要同步 `src/login/charScene.ts` 里的 `CHAR_MAX`（场上最多站几只）。
 */
const MAX_CHARS = 5;

/** 当前选中的角色（原版 `DAT_005616ac`，-1 表示没选） */
let selectedCharName: string | null = null;

/** 把角色列表同步到选角 3D 场景（模型 + 头顶标签的投影锚点） */
async function syncCharModels() {
  if (!char3d) return;
  await char3d.setChars(
    charSummaries.map(c => ({
      name: c.name,
      cls: classIdOfCharSet(c.charSet[0]) & 3,
      level: c.level,
      // 原版站位/朝向按槽位算：x = slot*100, y = slot*50-50, rotate = (slot-1)*15°
      slot: c.slot & 0xff,
      // 原版 ChangeCharacterExt(slot, &CharSet[1])：选角界面穿的是角色自己的装备
      charSet: c.charSet,
    }))
  );
}

function paintSelected() {
  for (const el of charListEl.querySelectorAll<HTMLElement>('.char-card')) {
    el.classList.toggle('selected', el.dataset.name === selectedCharName);
  }
  const okBtn = $<HTMLButtonElement>('btn-char-ok');
  okBtn.disabled = !selectedCharName;
  const delBtn = $<HTMLButtonElement>('btn-char-delete');
  delBtn.disabled = !selectedCharName;
  // 原版：没选角色时左右两块銘牌是滑出屏幕外的（DAT_005616a8 = -205）
  charScreen.classList.toggle('has-sel', !!selectedCharName);
  // 选中的那只打光：材质副本提亮（见 charScene.setHighlight）
  char3d?.setSelected(selectedCharName);
}

/** `CharSet[0]` → 编码职业号（和 `playerClassId()` 同一套位运算） */
function classIdOfCharSet(cs: number | undefined): number {
  const b = cs ?? 0;
  return ((b >> 4) | (b & 0x10)) >> 1;
}

/**
 * 角色名单。原版选角界面没有面板，是 3D 角色头顶两行字：
 * 名字（粗体）+「职业 等级」。我们照着做成竖排，点一条就进图。
 */
function renderCharList(chars: CharacterSummary[]) {
  charSummaries = chars;
  charListEl.innerHTML = '';

  for (const c of chars) {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.dataset.name = c.name;
    card.innerHTML = `
      <div class="cslot">${c.slot + 1}</div>
      <div class="cname">${c.name}</div>
      <div class="cinfo">${textSync(classIdOfCharSet(c.charSet[0]) + 20, '职业')} ${c.level}</div>
    `;
    // 原版是「先选中、再点右边 OK 进场」，双击也直接进（省事）
    card.addEventListener('click', () => {
      selectedCharName = c.name;
      paintSelected();
    });
    card.addEventListener('dblclick', () => void selectCharacter(c.name));
    charListEl.appendChild(card);
  }

  // 进选角时**不预选**：原版要你点一下角色，左右两块銘牌才从两边伸进来
  if (selectedCharName && !chars.some(c => c.name === selectedCharName)) {
    selectedCharName = null;
  }
  paintSelected();

  // 原版没有「空槽位」的显示：点上面的 NEW CHARACTER 銘牌才能建
  const free = Math.max(0, MAX_CHARS - chars.length);
  const createBtn = $<HTMLButtonElement>('btn-char-create');
  createBtn.disabled = free === 0;
  createBtn.title = free === 0 ? `最多 ${MAX_CHARS} 个角色` : '新建角色';
  // 5 个槽满了就把这块銘牌整块收掉（原版也是这样，没有空位就不该出现）
  charScreen.classList.toggle('slots-full', free === 0);

  // 让 3D 场景把这些角色站到场上（标签由 charScene 每帧投影到头顶）
  if (char3d) void syncCharModels();
  else charListEl.classList.add('no3d');
}

/* ------------------------------------------------------------------ */
/* 新建角色                                                            */
/* ------------------------------------------------------------------ */
/*
 * 面板是原版 `New_character01.oZT`(213×256) + `02`(213×119)，坐标见
 * `Scene_CharSelect.cpp`：名字输入 (285, y+180) 宽 0x49、职业名 (285, y+200)、
 * 换职业箭头 (363/384, y+196)、OK (235, y+349) / 取消 (335, y+349)。
 *
 * 建角走 `0xF3/0x01`（`C1 F3 01 name[10] class`，见 GameServer/Protocol.cpp 的
 * `CGCharacterCreateRecv`），成功后重新拉一次角色列表。
 */

/** `DB_CLASS_*`：0 魔法师 / 1 剑士 / 2 弓箭手 / 3 魔剑士 */
const CREATE_CLASSES = [0, 1, 2, 3];
let createClassIdx = 0;

const createPanelEl = $('create-panel');
const createNameEl = $<HTMLInputElement>('create-name');
const createClassEl = $('create-class');
const createMsgEl = $('create-msg');
const createPreviewEl = $<HTMLImageElement>('create-preview');

function setCreateMsg(text: string) {
  createMsgEl.textContent = text;
  createMsgEl.classList.toggle('on', !!text);
}

function paintCreateClass() {
  const cls = CREATE_CLASSES[createClassIdx];
  createClassEl.textContent = textSync(cls + 20, '魔法师');
  // 面板上那块 74×79 的框里是实时渲出来的职业模型（见 ui/charPreview.ts）
  void charPreview(cls).then(url => {
    if (url && CREATE_CLASSES[createClassIdx] === cls) createPreviewEl.src = url;
  });
}

function openCreatePanel() {
  if (charSummaries.length >= MAX_CHARS) return;
  createPanelEl.classList.remove('hidden');
  charScreen.classList.add('creating');
  createNameEl.value = '';
  createClassIdx = 0;
  paintCreateClass();
  setCreateMsg('');
  setTimeout(() => createNameEl.focus(), 30);
}

function closeCreatePanel() {
  createPanelEl.classList.add('hidden');
  charScreen.classList.remove('creating');
  setCreateMsg('');
}

/** 原版 `CheckName`：4~10 位字母/数字 */
function validCharName(name: string): string | null {
  if (name.length < 4) return '名字至少 4 位';
  if (name.length > 10) return '名字最多 10 位';
  if (!/^[A-Za-z0-9]+$/.test(name)) return '只能用字母和数字';
  return null;
}

async function submitCreate() {
  if (!session) return;
  const name = createNameEl.value.trim();
  const bad = validCharName(name);
  if (bad) {
    setCreateMsg(bad);
    return;
  }
  if (charSummaries.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    setCreateMsg('这个名字已经用过了');
    return;
  }

  setCreateMsg('创建中…');
  const ok = await session.createCharacter(name, CREATE_CLASSES[createClassIdx]);
  if (!ok) {
    setCreateMsg('创建失败（重名或职业不可用）');
    return;
  }
  setCreateMsg('');
  closeCreatePanel();
  try {
    renderCharList(await session.requestCharacterList());
    setMsg(charMsg, `已创建 ${name}`);
  } catch (err) {
    setMsg(charMsg, `角色列表刷新失败：${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

function setupCreatePanel() {
  $('btn-char-create').addEventListener('click', () => {
    // 演示模式不建角色（要走 0xF3/01 + 名字查重，全靠服务端）
    if (DEMO) {
      setMsg(charMsg, '离线演示不提供创建角色，直接选一个进入游戏');
      return;
    }
    openCreatePanel();
  });
  // 右侧「OK」銘牌 = 进入游戏（原版 0x14/0x15）
  $('btn-char-ok').addEventListener('click', () => {
    if (!selectedCharName) {
      setMsg(charMsg, '先选一个角色', 'error');
      return;
    }
    // 演示模式没有服务端：直接开沙盘进洛兰（不选角发包）
    void (DEMO ? selectCharacterOffline(selectedCharName) : selectCharacter(selectedCharName));
  });
  // 左侧「DELETE」銘牌 = 删除角色（原版要走 0xF3/02 + 7 位安全码，这里先留提示）
  $('btn-char-delete').addEventListener('click', () => {
    setMsg(charMsg, '删除角色要安全码，接口还没接');
  });
  $('cp-cancel').addEventListener('click', () => closeCreatePanel());
  $('cp-ok').addEventListener('click', () => void submitCreate());
  $('cp-prev').addEventListener('click', () => {
    createClassIdx = (createClassIdx + CREATE_CLASSES.length - 1) % CREATE_CLASSES.length;
    paintCreateClass();
  });
  $('cp-next').addEventListener('click', () => {
    createClassIdx = (createClassIdx + 1) % CREATE_CLASSES.length;
    paintCreateClass();
  });
  createNameEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') void submitCreate();
    if (e.key === 'Escape') closeCreatePanel();
  });
}

async function selectCharacter(name: string) {
  if (!session) return;
  // 联机时外观只认服务端下发的背包，沙盘必须让位（否则会盖掉真实穿戴）
  sandbox.on = false;
  sandboxPanel.show(false);
  setMsg(charMsg, '进入游戏…');
  try {
    // 必须在选角请求之前设好：服务端紧接着就会下发 0x12，
    // 里面包含「自己」这一条，靠名字判断哪些该忽略
    setSelfName(name);
    playerDead = false;
    const info = await session.selectCharacter(name);
    /*
     * 进图 = 真正「在线」了。
     *
     * 以前 `loggedIn` 只在登录那一步置 true，可是 `F1/02/01`（回选角）的 ack 会把它
     * 清成 false —— 于是「回到选择角色画面」再进来一次之后：
     *   · 头顶名字 / 地面物品名整层不画（`syncWorldTags` 第一句就 return）
     *   · 攻击包也发不出去（`if (loggedIn && connection?.connected)`）
     * 换角色这个循环就废了。这里补回来。
     */
    loggedIn = true;
    // 进图后必须定期发 0x0E，否则约 60 秒后服务端会回收 socket
    session.startLive();
    const summary = charSummaries.find(c => c.name === name);
    currentChar = {
      name,
      level: summary?.level ?? 0,
      charSet: summary?.charSet ?? [],
      info,
    };

    refreshHud();

    await loadWorld(info.map, info.x, info.y, { offline: false });
    setMsg(charMsg, '');
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    setMsg(charMsg, `✗ ${text}`, 'error');
    console.error(err);
  }
}

/* ------------------------------------------------------------------ */
/* 离线演示（/demo）                                                   */
/* ------------------------------------------------------------------ */

/**
 * 演示用的假角色（一个职业一只）。
 *
 * `charSet` 的布局见 `data/charSet.ts`：`[0]` 是职业位，`[1..]` 是装备字节。
 * 这里只填职业位、装备字节留 0 → 解出来是 0 号套装（青铜系列），
 * 正好是「新建角色」的样子。
 *
 * 职业位编码：`classOfCharSet(cs0) = ((cs0>>4)|(cs0&0x10))>>1`
 *   → 0x00 魔法师 / 0x20 剑士 / 0x40 弓箭手 / 0x60 魔剑士
 */
const DEMO_CHARS: CharacterSummary[] = [
  { slot: 0, name: '演示·魔法师', level: 120, ctlCode: 0, charSet: [0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { slot: 1, name: '演示·剑士', level: 120, ctlCode: 0, charSet: [0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { slot: 2, name: '演示·弓箭手', level: 120, ctlCode: 0, charSet: [0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { slot: 3, name: '演示·魔剑士', level: 60, ctlCode: 0, charSet: [0x60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
];

/** 假角色属性：等级越高四维越多，够 HUD/属性面板显示就行 */
function demoCharInfo(summary: CharacterSummary | undefined): CharacterInfo {
  const lv = summary?.level ?? 1;
  const base = 18 + Math.floor(lv * 1.2);
  const hp = 60 + lv * 6;
  const mp = 30 + lv * 5;
  return {
    x: OFFLINE_SPAWN.x,
    y: OFFLINE_SPAWN.y,
    map: 0,
    dir: 3,
    experience: 0,
    nextExperience: lv * 1000,
    levelUpPoint: 0,
    strength: base,
    dexterity: base,
    vitality: base,
    energy: base,
    life: hp,
    maxLife: hp,
    mana: mp,
    maxMana: mp,
    bp: 20,
    maxBp: 20,
    money: 1234567,
    pkLevel: 0,
    ctlCode: 0,
    fruitAddPoint: 0,
    maxFruitAddPoint: 0,
    raw: new Uint8Array(0),
  };
}

/**
 * 演示模式「登录」：完全不碰网络，直接拿假角色表进选角。
 *
 * 真实流程是 `connectAndLogin()` → ConnectServer 选线路 → `F1/01` 加密登录 →
 * `F3/00` 取角色表。这里把中间全跳过，账号密码只做非空校验。
 */
async function demoLogin(account: string) {
  setMsg(loginMsg, '演示模式：准备角色列表…');
  // 角色名/职业名要走 Text.bmd + item.bmd，先把表读起来
  await Promise.all([loadTextPool(), loadItemNames().catch(() => null)]).catch(() => null);
  refreshItemNames();
  charSummaries = DEMO_CHARS.map(c => ({ ...c, charSet: [...c.charSet] }));
  selectedCharName = null;
  renderCharList(charSummaries);
  paintSelected();
  setMsg(loginMsg, '');
  console.log(`[demo] 登录（账号 ${account || '-'}）→ 选角，${charSummaries.length} 个角色`);
  showScreens({ charselect: true });
}

/**
 * 演示模式「进入游戏」：不选角发包，直接开沙盘进洛兰。
 *
 * 和以前账号面板上那个「离线演示」按钮走同一条路（`sandbox.on` + `loadWorld`），
 * 只是职业从选角界面来；装备用 `equipDefaultWeapon()` 给一把默认武器，
 * 不然 41（转武器）/42（砸武器）那些特效没有模型可挂。
 */
async function selectCharacterOffline(name: string) {
  const summary = charSummaries.find(c => c.name === name);
  if (!summary) return;
  const cls = classIdOfCharSet(summary.charSet[0]) & 3;

  sandbox.on = true;
  /*
   * `setClass` 要解一堆 BMD，慢的时候好几秒。期间如果有人换了图
   * （调试口 / 传送 / 任何 `loadWorld`），下面那句会把新图盖回洛兰 ——
   * 用加载代号判断，和以前那个「离线演示」按钮同一套写法。
   */
  const seq = worldLoadSeq;
  await sandboxPanel.setClass(cls);
  if (seq !== worldLoadSeq) return;
  if (sandbox.slots.weapon === undefined) sandboxPanel.equipDefaultWeapon();

  setSelfName(name);
  playerDead = false;
  // 演示里没有 socket，但 `loggedIn` 决定头顶名字 / HUD 走不走「在线」那套；
  // 所有发包都在 `connection?.connected` 后面，置 true 不会真的发出去
  loggedIn = true;
  currentChar = {
    name,
    level: summary.level,
    charSet: summary.charSet,
    info: demoCharInfo(summary),
  };
  refreshHud();
  console.log(`[demo] 进入游戏 cls=${cls} → 洛兰 ${OFFLINE_SPAWN.x},${OFFLINE_SPAWN.y}`);
  await loadWorld(0, OFFLINE_SPAWN.x, OFFLINE_SPAWN.y, { offline: true });
  setMsg(charMsg, '');
}

/**
 * 进入离线沙盘（不经过登录/选角）。
 *
 * 以前这是账号面板上「离线演示」按钮的实现，现在那个按钮改成了「结束游戏」，
 * 离线演示改走 `/demo` 的完整流程。这个函数留给**调试口和探针**
 * （`__MU_APP__.offline()`）—— 老探针全是靠点那个按钮进图的。
 */
async function enterOfflineSandbox(cls?: number) {
  sandbox.on = true;
  currentChar = null;
  refreshHud();
  // 加载代号：`setClass` 期间如果有人换了图，不要把新图盖回洛兰
  const seq = worldLoadSeq;
  await sandboxPanel.setClass(cls ?? sandboxPanel.state().cls);
  if (seq !== worldLoadSeq) return;
  if (sandbox.slots.weapon === undefined) sandboxPanel.equipDefaultWeapon();
  await loadWorld(0, OFFLINE_SPAWN.x, OFFLINE_SPAWN.y, { offline: true });
}

/**
 * 背包快照变了就一起刷三处：格子、底栏药水槽、属性面板的装备加成。
 * 之前是两个调用点各写一遍，漏一个就会出现「背包有药水但快捷槽是空的」。
 */
function syncInventoryViews() {
  inventoryPanel.setItems(inventoryItems);
  hudValues.setInventory(inventoryItems);
  syncCharacterPanel();
  void refreshPlayerEquipment();
}

/**
 * 背包穿脱 + 所处地形 → 角色外观 / 动作。
 *
 * 服务端槽位（`INVENTORY_WEAR_RANGE` 0..11）和模型部件的对应照抄原版
 * `RenderCharacter`：0 武器 / 1 盾 / 2 头盔 / 3 铠甲 / 4 护腿 / 5 护手 /
 * 6 战靴 / 7 翅膀（8 守护、9-11 戒指项链不改外观）。
 *
 * 空槽不再「什么都不画」——退回职业默认身体（`CreateHero` 的 BodyPart[1..5]），
 * 否则 player.bmd 只有骨架，脱光就整人隐形。
 *
 * 安全区也进签名：进出城门时武器要在「背上 ↔ 手里」之间切换。
 */
function currentEquip(): EquipSet {
  const safeZone = isSafeZoneAt(player?.x ?? 0, player?.y ?? 0);
  // 离线演示：沙盘上选什么就穿什么（面板本身已经按 item.bmd 的 RequireXXX 过滤过）
  if (sandbox.on) {
    return { ...sandbox.slots, cls: sandbox.cls, safeZone };
  }
  const at = (slot: number) => inventoryItems.find(i => i.slot === slot)?.type;
  return {
    weapon: at(0),
    shield: at(1),
    helm: at(2),
    armor: at(3),
    pants: at(4),
    gloves: at(5),
    boots: at(6),
    wing: at(7),
    cls: playerClass(),
    safeZone,
  };
}

/** 职业索引（服务端 `Class & 7`）—— 空槽挑职业默认身体用 */
function playerClass(): number {
  if (sandbox.on) return sandbox.cls;
  // 职业组（0=魔法师 1=剑士 2=弓箭手 3=魔剑士）；转职只改高位，组不变
  return playerClassId() & 7;
}

/** 地形安全区：`TerrainWall[idx] & 1`（`Entity_Spawn.cpp:110`） */
/*
 * ── 0x0F 天气 / 0x46 地图属性 / 0x29 特殊物品计时 / 0x2C 果实 ──────────
 */

/** 特殊物品剩余时间（`0x29`）：只记账，到点清掉 */
let itemSpecialTime: { number: number; until: number } | null = null;

/**
 * 天气（`0x0F`）。
 *
 * 服务端只给「类型 + 强度」两个半字节：0 = 晴、1 = 雨（其余原版也没实现）。
 * 雨交给 `AmbientLayer.setRain` —— 强度直接映射成透明度/落速，
 * 和原版 `RainTarget = 6 × intensity` 是同一个量纲。
 */
function applyWeather(type: number, intensity: number) {
  const rain = type === 1 ? Math.max(0.05, intensity / 15) : 0;
  // 氛围层可能还在后台加载，先记下来，替换时重放（见 loadWorld 的后台块）
  rainTarget = rain;
  world?.ambient.setRain(rain);
  console.log(`[weather] 0x0F type=${type} intensity=${intensity} → rain ${rain.toFixed(2)}`);
}

/**
 * 地形格属性更新（`0x46`，客户端叫 `Terrain_TileUpdate`，`Party.cpp:229`）。
 *
 * 之前按「地图属性矩形表」理解是错的 —— 它是**直接改地形属性位**：
 *
 *   pkt[3] = 0：矩形批量（每条 4 字节 `x,y,tx,ty`）
 *   pkt[3] = 1：单格（每条 2 字节 `x,y`）
 *   pkt[4] = 属性位（`TW_*`：1 安全区 / 2 角色 / 4 不可走 / 8 不可落地）
 *   pkt[5] = 0 置位 / 1 清位
 *
 * 血色城堡就是靠它开关大门（attr=4 的矩形置位/清位）和桥（attr=8）。
 * 直接写进 `terrain.data.attribute`，`canEnterAt` 每次寻路都现读，
 * 所以门一开，走位立刻就能过去。
 */
function applyMapAttr(chunk: MapAttrChunk) {
  const data = world?.terrain.data.attribute;
  if (!data) return;
  const set = chunk.flag === 0;
  const write = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= TERRAIN_SIZE || y >= TERRAIN_SIZE) return;
    const i = y * TERRAIN_SIZE + x;
    data[i] = set ? data[i] | chunk.attr : data[i] & ~chunk.attr;
  };

  for (const c of chunk.cells) {
    if (chunk.type === 0) {
      // 矩形：服务端给的是两个角，顺序不保证
      const x0 = Math.min(c.x, c.tx);
      const x1 = Math.max(c.x, c.tx);
      const y0 = Math.min(c.y, c.ty);
      const y1 = Math.max(c.y, c.ty);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) write(x, y);
    } else {
      write(c.x, c.y);
    }
  }
  console.log(
    `[map] 0x46 ${chunk.type === 0 ? '矩形' : '单格'} attr=${chunk.attr} ${set ? '置位' : '清位'} 条数=${chunk.cells.length}`
  );
}

/**
 * 果实结果（`0x2C`）。
 *
 * `result & 0x3F`：0 成功 / 1 类型不对 / 3 失败（等级 <10 或该属性到上限）。
 * 长包带加完之后的四维，直接覆盖最省事（和 `F3/06` 加点回执一个思路）。
 */
function applyFruitResult(fr: FruitResult) {
  const info = currentChar?.info;
  const ok = fr.result === 0;
  if (!ok) {
    const why = fr.result === 1 ? '类型无效' : '等级不足或该属性已达上限';
    chatBox.push('系统', `使用果实失败：${why}`, 1);
    return;
  }
  if (info) {
    if (fr.strength !== undefined) info.strength = fr.strength;
    if (fr.dexterity !== undefined) info.dexterity = fr.dexterity;
    if (fr.vitality !== undefined) info.vitality = fr.vitality;
    if (fr.energy !== undefined) info.energy = fr.energy;
    if (fr.point !== undefined) info.levelUpPoint = fr.point;
    refreshHud();
  }
  chatBox.push('系统', '果实生效：属性 +1', 2);
  console.log(`[item] 0x2C 果实成功 四维=${fr.strength}/${fr.dexterity}/${fr.vitality}/${fr.energy}`);
}

function isSafeZoneAt(x: number, y: number): boolean {
  const attr = world?.terrain.data.attribute;
  if (!attr) return false;
  /*
   * 入参是角色的**格号坐标**（`player.x`），渲染位置是 `x + 0.5`，
   * 所以「在哪一格」要 round 不要 floor —— 详见 `playerCellX` 的注释。
   */
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= TERRAIN_SIZE || iy >= TERRAIN_SIZE) return false;
  return (attr[iy * TERRAIN_SIZE + ix] & TW_SAFEZONE) !== 0;
}

/* ------------------------------------------------------------------ */
/* 安全区禁止攻击 / 施法                                                */
/* ------------------------------------------------------------------ */
/**
 * 站在安全区里能不能出手 —— 照抄 `Combat.cpp::Attack()` 的两道门禁
 * （IDA `Attack` L1280 / L1314）：
 *
 * ```c
 * // ① L1280：死亡，或「安全区 + 非事件地图」→ 直接 return（连普攻都不给）
 * if (c[765] || (c[846] && (World < 11 || World > 16))) return;
 * // ② L1314：事件地图（血色/恶魔 11..16）的安全区里只放这几个辅助技能
 * if (c[846] && iType != 26 && iType != 27 && iType != 28 && iType != 16 && iType != 48) return;
 * ```
 *
 * `c[846]` 就是 SafeZone（`MoveCharacterVisual` 每帧按
 * `TerrainWall[Terrain_Load(x,y)] & 1` 写回，见 `SecondPassword.cpp:4147`），
 * 和这里的 `isSafeZoneAt` 同一个判据。
 *
 * 左键侧是同一套规则的另一处写法（`Player_InputTick.cpp` L1303 / L1523：
 * `if (!SafeZone && CheckAttack())`），所以点击怪物、按住连击、自动攻击
 * 全部走这一个判据就够了。
 *
 * 服务端也会挡（`Attack.cpp:52`、`SkillManager.cpp:1810` 的
 * `CheckAttr(x, y, 1)`），所以客户端这层**不是权威判定**，只为在
 * 「点下去毫无反应」时给玩家一个原因。
 */
const SAFE_ZONE_SKILLS = new Set([16, 26, 27, 28, 48]);
let lastSafeZoneWarnAt = 0;

/**
 * @param skillId 0 = 普通攻击；其它 = 要放的技能号
 * @param x,y 不给就用角色当前格（探针要问「别的格」时传）
 */
function safeZoneBlocksCombat(skillId = 0, x = player?.x ?? 0, y = player?.y ?? 0): boolean {
  if (!player || !isSafeZoneAt(x, y)) return false;
  const map = world?.mapId ?? 0;
  // ① 非事件地图：安全区里什么都不能打
  if (map < 11 || map > 16) return true;
  // ② 事件地图：只放行 生命之光/守护之光/攻击/防御/治疗 这几个辅助
  return !SAFE_ZONE_SKILLS.has(skillId);
}

/** 被安全区挡下时给一句提示（原版是静默 return，网页端不给反馈会被当成卡了） */
function warnSafeZone() {
  const now = performance.now();
  if (now - lastSafeZoneWarnAt < 1500) return;
  lastSafeZoneWarnAt = now;
  chatBox.push('系统', '安全区内不能攻击或施放技能', 1);
}

/** 动作选择的输入（武器/翅膀/职业/安全区） */
/**
 * 脚下这格是不是水面。
 *
 * 判据统一放在地形里（`terrain.isWaterCell`）：洛兰的河是 `layer1 == TileWater01`，
 * 亚特兰蒂斯的水是 `layer2 == TileWater01` —— 两种写法都得认，
 * 之前这里只看 `layer1`，亚特兰蒂斯整张图都判成"干地"。
 */
function isWaterCell(x: number, y: number): boolean {
  if (!world) return false;
  return world.terrain.isWaterCell(Math.floor(x), Math.floor(y));
}

/**
 * 水面 + 水下滤镜，每帧一次。
 *
 * - 水面：推进 `uTime`（UV 滚动 + 顶点波动都在着色器里，CPU 只送一个数）
 * - 水下滤镜：亚特兰蒂斯 + 非安全区时整屏压一层蓝绿，判据与游泳姿势**完全一致**
 *   （`animInput().inWater`），保证「人在游 = 画面在水下」不会错位
 */
function updateWaterLayer(dt: number) {
  waterTime += dt;
  world?.terrain.updateWater(waterTime);

  const underwater =
    world?.mapId === 7 && player !== null && !isSafeZoneAt(player.x, player.y);
  const target = underwater ? 1 : 0;
  // 指数缓动：进出水约 0.25 秒过渡完，不会硬切
  waterTint += (target - waterTint) * Math.min(1, dt * 6);
  if (Math.abs(target - waterTint) < 0.004) waterTint = target;

  if (!waterTintEl) return;
  if (waterTint <= 0.002) {
    if (waterTintEl.style.display !== 'none') {
      waterTintEl.style.display = 'none';
      waterTintEl.style.opacity = '0';
    }
    return;
  }
  waterTintEl.style.display = 'block';
  waterTintEl.style.opacity = waterTint.toFixed(3);
}

function animInput(): AnimInput {
  const equip = currentEquip();
  /*
   * 亚特兰蒂斯（World 7）非安全区 → 待机浮空(9/10)、走动游泳(21)。
   *
   * 原版两处判据都是「世界 7 + 不在安全区」：
   *   `SetPlayerWalk`: `if (!bSafeZone && World == 7) → 21/29`
   *   `SetPlayerStop`: `if (SceneFlag == 5 && World == 7) { tile = 脚下瓦片;
   *                     if (!(TileFlags[tile] & 1)) 浮空 }` —— 而 `TileFlags & 1`
   *                     正是"这张瓦片是安全区"（见 `Entity_Spawn.cpp` 用它判定
   *                     `SafeZone`），所以等价于"不在安全区就浮空"。
   * 安全区里照常站着/走。
   */
  const inWater =
    world?.mapId === 7 && player !== null && !isSafeZoneAt(player.x, player.y);
  return {
    weapon: equip.weapon,
    shield: equip.shield,
    wing: equip.wing,
    cls: equip.cls,
    safeZone: equip.safeZone,
    inWater,
    staminaLow: stamina >= STAMINA_MAX,
  };
}

let equipSig = '';
let equipTask: Promise<void> = Promise.resolve();
/** 上次写进 equipSig 的安全区状态：跨城门时要重算 */
let lastSafeZone = false;

function refreshPlayerEquipment(): Promise<void> {
  if (!player) return equipTask;
  const equip = currentEquip();
  const sig = JSON.stringify(equip);
  if (sig === equipSig) return equipTask;
  equipSig = sig;
  lastSafeZone = equip.safeZone === true;

  // 串行化：穿脱很快连点时，避免两次重建交叉删对方的网格
  equipTask = equipTask
    .then(async () => {
      const self = player;
      if (!self) return;
      const out = await applyEquipment(self, PLAYER_DIR, equip);
      console.log(
        `[player] 换装：身体 ${out.skinned.length} 个网格（` +
          `${[...new Set(out.skinned.map(n => n.split(':')[0]))].join(',') || '裸'}）` +
          `，手持 ${out.held.map(h => `${h.name}→${h.mount}`).join(',') || '无'}` +
          `，${equip.safeZone ? '安全区' : '野外'}`
      );
    })
    .catch(err => console.warn('[player] 换装失败', err));
  return equipTask;
}


/**
 * 底栏数值 / 属性面板 / 背包金币 —— 全部从同一份 0xF3 角色包刷新。
 *
 * 之前这里是三个函数（updateOrbs / updateStatPanel / syncCharacterPanel），
 * 数据源一样，合并成一条，省得漏掉某个调用点导致球和面板数值不一样。
 */
function refreshHud() {
  const info = currentChar?.info ?? null;
  hudValues.setCharacter(currentChar?.name ?? '', currentChar?.level ?? 0, info);

  const mapId = info?.map ?? 0;
  const def = getMapDefinition(mapId);
  const px = player ? playerCellX() : info?.x ?? 0;
  const py = player ? playerCellY() : info?.y ?? 0;
  hudValues.setPlace(def.english, px, py);

  inventoryPanel.setMoney(info?.money ?? 0);
  // tooltip 的「所需力量/敏捷/智力/等级」要拿角色自己的值去比（原版 `CA+0x0E` 那四个）
  inventoryPanel.setHero({
    level: currentChar?.level ?? 0,
    str: info?.strength ?? 0,
    agi: info?.dexterity ?? 0,
    ene: info?.energy ?? 0,
    // 职业：tooltip 的「XXX 可以使用」那几行要拿它标红/标白
    cls: playerClassId(),
  });
  // 药水快捷槽（Q/W/E 图标 + 数量）吃的是背包快照
  hudValues.setInventory(inventoryItems);
  syncCharacterPanel();
}

/**
 * `0x26` / `0x27` —— 服务端推的 HP / MP+BP 同步。
 *
 * 数值是**大端 WORD**（原版 `(Msg[4] << 8) | Msg[5]`），和 0xF3 那些小端字段不一样，
 * 抄错的话 3228 会读成 0x1C0x98 之类的天书。
 *
 * 只处理 0xFE / 0xFF 两个子码：
 *   0xFE = 更新上限（MaxLife / MaxMana + MaxBP）
 *   0xFF = 更新当前值
 * 0xFD（锁物品栏）和「其他 = 背包槽耐久--」跟 HUD 无关，直接跳过。
 */
/*
 * 聊天 / 公告解析。
 *
 * `ReceiveChat`（`Net/Net_LegacyRuntime.cpp:189`）逐字对应：
 *
 *   C1 | size | 00 | name[10] | msg…
 *                              ^ msg[0] 是频道前缀
 *   '~' 队伍   → 正文从 +1 字节开始，频道 4
 *   '@' 战盟   → 正文从 +1 字节开始，频道 5
 *   '#'        → 只出头上的气泡，不进日志
 *   其他       → 正文从 msg[0] 开始（不减一），频道 3（近白色）
 *
 * 0x0D 是服务端公告 `PMSG_NOTICE_SEND`：header(3) + type(1) + message，频道 1。
 */
/** 读一个以 0 结尾的字符串（服务端是 GBK/ASCII 混排，见 `net/text.ts`） */
function readChatStr(buf: Uint8Array, off: number, max = buf.length - off) {
  let end = off;
  const limit = Math.min(buf.length, off + max);
  while (end < limit && buf[end] !== 0) end++;
  return decodeServerText(buf.subarray(off, end));
}

function applyChatPacket(pkt: Uint8Array) {
  const hs = pkt[0] === 0xc2 || pkt[0] === 0xc4 ? 3 : 2;
  if (pkt.length < hs + 11) return;
  const name = readChatStr(pkt, hs + 1, 10);
  const rest = pkt.subarray(hs + 11);
  if (!rest.length) return;

  const first = rest[0];
  let text: string;
  let channel: ChatChannel;
  if (first === 0x7e) {
    text = readChatStr(rest, 1);
    channel = 4;
  } else if (first === 0x40) {
    text = readChatStr(rest, 1);
    channel = 5;
  } else if (first === 0x23) {
    return; // '#'：原版只画头顶气泡，不写日志
  } else {
    text = readChatStr(rest, 0);
    channel = 3;
  }
  chatBox.push(name, text, channel);
}

/** 0x0D 公告：header(3) + type(1) + message（type 0 普通 / 1 蓝 / 2 绿 / 3 白） */
function applyNoticePacket(pkt: Uint8Array) {
  const hs = pkt[0] === 0xc2 || pkt[0] === 0xc4 ? 3 : 2;
  const text = readChatStr(pkt, hs + 2);
  if (text) chatBox.push('', text, 1);
}

function applyVitalReply(head: number, pkt: Uint8Array) {
  const info = currentChar?.info;
  if (!info) return;
  const sub = pkt[3];
  const be16 = (o: number) => ((pkt[o] ?? 0) << 8) | (pkt[o + 1] ?? 0);

  if (head === 0x26) {
    if (sub === 0xff) info.life = be16(4);
    else if (sub === 0xfe) info.maxLife = be16(4);
    else return;
  } else {
    if (sub === 0xff) {
      info.mana = be16(4);
      info.bp = be16(6);
    } else if (sub === 0xfe) {
      info.maxMana = be16(4);
      info.maxBp = be16(6);
    } else {
      return;
    }
  }
  refreshHud();
}

/**
 * `0xF3/0x05` 升级（`GCLevelUpSend`）。
 *
 * 原版在这个包里做四件事，一件都不能省：
 *   1. 等级 / 可分配点 / 三条上限
 *   2. **当前血蓝回满**（`CA+28 = CA+32`、`CA+30 = CA+34`）
 *   3. 经验与下一级经验（`GAMESERVER_EXTRA` 长包直接给，短包才用公式算）
 *   4. 升级特效：**15 道 joint 1249 + 光环 1264**（`Net_Process.cpp:2373-2385`）
 */
function applyLevelUp(pkt: Uint8Array) {
  const ev = parseLevelUp(pkt);
  if (!ev) return;
  const info = currentChar?.info ?? null;
  const before = currentChar?.level ?? 0;

  if (currentChar) currentChar.level = ev.level;
  if (info) {
    info.maxLife = ev.maxLife;
    info.maxMana = ev.maxMana;
    info.maxBp = ev.maxBp;
    // 升级回满：原版就是直接把上限写进当前值
    info.life = ev.maxLife;
    info.mana = ev.maxMana;
    info.bp = ev.maxBp;
    info.levelUpPoint = ev.levelUpPoint;
    if (ev.experience !== undefined) info.experience = ev.experience;
    if (ev.nextExperience !== undefined && ev.nextExperience > 0) {
      info.nextExperience = ev.nextExperience;
    } else {
      info.nextExperience = calcNextLevelExp(ev.level);
    }
  }

  refreshHud();
  playLevelUpFx();
  if (player) {
    damageTexts.spawn(
      { x: player.x, y: player.y, z: player.z + 2.8 },
      `LEVEL ${ev.level}`,
      'exp'
    );
  }
  chatBox.push(
    '系统',
    `等级提升！Lv ${before || '?'} → ${ev.level}（可分配点 ${ev.levelUpPoint}）`,
    2
  );
  console.log(
    `[level] 0xF3/05 升级 ${before} → ${ev.level} 点=${ev.levelUpPoint} ` +
      `HP=${ev.maxLife} MP=${ev.maxMana} BP=${ev.maxBp} exp=${ev.experience}/${ev.nextExperience}`
  );
}

/**
 * 转职后的职业号覆盖（原版编码：低 3 位职业组 + `>>3` 是转职次数）。
 *
 * `null` = 用 `currentChar.charSet[0]` 现算。为什么要单独存：
 * 0xA3 下发的是**编码后的职业号**（如 8 = 魔法师一转），
 * 而 `charSet[0]` 是它的"来源字节"（0x10），已经把转职次数压掉了；
 * 直接拿 `klass` 覆盖 `charSet[0]` 会让 `playerClass()` 算回 8&7 = 0（等于没变化），
 * 所以另开一个字段，优先级高于 charSet。
 */
let playerClassRaw: number | null = null;

/** 当前职业号（编码后，0..31）：低 3 位是职业组，`>>3` 是转职次数 */
function playerClassId(): number {
  if (playerClassRaw !== null) return playerClassRaw;
  const cs = currentChar?.charSet?.[0] ?? 0;
  return ((cs >> 4) | (cs & 0x10)) >> 1;
}

/**
 * 任务奖励 `0xA3` 的统一处理（收包与探针注入共用）。
 *
 * 子类型见 `net/game.ts` 的 `QUEST_REWARD_*`：
 *   0xC8 只加点 / 0xC9 转职 / 0xCA 转职+加点 / 0xCB 转职（加点由别处结算）
 *
 * 三个转职分支原版都会播同一套特效（15 束 joint + `CreateEffect(1264)`），
 * 这里复用 `playLevelUpFx()`（它就是照那段写的），再补一声升级音效。
 */
function handleQuestReward(rw: {
  reward: number;
  value: number;
  viewPoint: number | null;
}) {
  const isPoint = rw.reward === QUEST_REWARD_POINT || rw.reward === QUEST_REWARD_CLASS_POINT;
  const isClass =
    rw.reward === QUEST_REWARD_CLASS ||
    rw.reward === QUEST_REWARD_CLASS_POINT ||
    rw.reward === QUEST_REWARD_CLASS_ONLY;

  if (!isPoint && !isClass) {
    console.log(`[quest] 0xA3 未知奖励子类型 0x${rw.reward.toString(16)}`);
    return;
  }

  if (isPoint) {
    // GAMESERVER_EXTRA 的结算值优先（服务端已经算好了，别自己 += 又算一遍）
    const add = rw.viewPoint !== null ? rw.viewPoint : rw.value;
    const info = currentChar?.info;
    if (info) {
      info.levelUpPoint = rw.viewPoint !== null ? rw.viewPoint : (info.levelUpPoint ?? 0) + add;
    }
    chatBox.push('系统', `任务奖励：可分配点数 +${add}`, 1);
    refreshHud();
  }

  if (isClass) {
    const klass = decodeQuestClass(rw.value);
    applyClassChange(klass);
  }

  playLevelUpFx();
  sfx(71);
  console.log(
    `[quest] 0xA3 reward=0x${rw.reward.toString(16)} value=${rw.value} ` +
      `point=${isPoint} class=${isClass} → classId=${playerClassId()}`
  );
}

/**
 * 应用转职：更新职业号 + 刷新面板/底栏。
 *
 * 注意**不用换模型**：一转/二转只改职业号（`ChangeUp`），
 * 身体部件是按职业组（`classId & 7`）挑的，组没变就不会换模型；
 * 变的是职业名（`Text.bmd` 的转职列）、可穿装备/可学技能的门槛（`ChangeUp+1`）。
 */
function applyClassChange(klass: number) {
  const before = playerClassId();
  playerClassRaw = klass;
  if (currentChar) {
    // 让选角卡片/其它读 charSet 的地方也看到新职业（编码成对应的字节）
    const group = klass & 7;
    const stage = klass >> 3;
    currentChar.charSet = [...(currentChar.charSet ?? [])];
    currentChar.charSet[0] = ((stage * 16) | (group * 32)) & 0xff;
  }
  syncCharacterPanel();
  refreshHud();
  void refreshPlayerEquipment();
  const name = textPoolName(playerClassRaw);
  chatBox.push('系统', `职业进化：${name || '新职业'}`, 1);
  console.log(`[quest] 转职 ${before} → ${klass}（${name}）`);
}

/** 只取职业名（不依赖 UI 是否已加载文本池） */
function textPoolName(classId: number | null): string {
  if (classId === null) return '';
  return characterPanel.classNameOf(classId);
}

/** 调试/探针用：当前职业的快照 */
function app_questClass() {
  const id = playerClassId();
  return {
    classId: id,
    group: id & 7,
    stage: id >> 3,
    name: characterPanel.classNameOf(id),
    fromPacket: playerClassRaw !== null,
  };
}

/**
 * 升级特效 —— 照 `Recv_LevelUp` 的两个调用：
 *
 *   15 × `Joint_Create(1249, hero, hero, …, 40.0f, 2, 0)`
 *      → 一束束从脚下往上的能量柱（joint 就是两点间的光带，这里从脚到头顶再往上）
 *   `CreateEffect(1264, hero, …, hero)` → 角色身上一圈金色光环
 *
 * 1249/1264 是精灵池编号，对应素材没被反编译出来（同 buff 那批），
 * 这里用 `JointSpirit01` + 地面法阵 + 金色闪光重建。
 */
function playLevelUpFx() {
  if (!player || !world) return;
  const z = world.terrain.getHeight(player.wx, player.wy);
  const cx = player.x;
  const cy = player.y;

  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * Math.PI * 2 + Math.random() * 0.5;
    const r = 0.2 + Math.random() * 0.55;
    const from = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, z: z + 0.05 };
    const h = 2.2 + Math.random() * 1.6;
    void beamLayer.spawn(from, { x: from.x, y: from.y, z: from.z + h }, {
      file: 'JointSpirit01.OZJ',
      width: 0.2,
      life: 0.85 + Math.random() * 0.35,
      opacity: 0.9,
    });
  }

  // 光环：地面金环 + 一团顺着身子升起来的金色闪光
  void spriteLayer.spawn('Magic_Ground2.OZJ', { x: cx, y: cy, z }, {
    size: 3.2,
    life: 1.2,
    ground: true,
    spin: 1.2,
    tint: 0xffe6a0,
    opacity: 0.85,
  });
  void spriteLayer.spawn('Flare.OZJ', { x: cx, y: cy, z }, {
    size: 2.6,
    life: 1.0,
    lift: 0.4,
    rise: 2.4,
    tint: 0xffd77a,
    opacity: 0.9,
  });
}

/**
 * `0xF3/06` 加点回执 —— `GAMESERVER_EXTRA=1` 时带完整四维，直接覆盖本地值。
 *
 * 结构（`Protocol.h:467`，按 4 字节对齐，共 44 字节）：
 *
 *   4   result        = 16 + type（0力 1敏 2体 3能），0 = 失败
 *   8   MaxLifeAndMana (u16)  ← 只在 type 2/3 赋值，其他情况是未初始化的栈垃圾
 *   10  MaxBP (u16)
 *   12  ViewPoint (u32)
 *   16  ViewMaxHP  20 ViewMaxMP  24 ViewMaxBP
 *   28  ViewStrength  32 ViewDexterity  36 ViewVitality  40 ViewEnergy
 *
 * 实测：`c1 2c f3 06 10 …` + 12 起的 8 个 DWORD = 42/128/24/26/31/20/25/10，
 * 正好对上加点后的点数（45-3）和四维。所以不需要再拉 `0xF3/03` ——
 * 那个请求在游戏里根本不回包，之前加点后“没反应”就是卡在那儿超时。
 */
function applyAddPointReply(pkt: Uint8Array) {
  const u32 = (o: number) =>
    (pkt[o] | (pkt[o + 1] << 8) | (pkt[o + 2] << 16) | (pkt[o + 3] << 24)) >>> 0;
  const info = currentChar?.info;
  if (!info || pkt.length < 44) return;

  const result = pkt[4];
  if (result < 16) {
    inventoryPanel.toast('加点失败（服务端拒绝）', 1600);
    return;
  }

  info.levelUpPoint = u32(12);
  info.maxLife = u32(16);
  info.maxMana = u32(20);
  info.maxBp = u32(24);
  info.strength = u32(28);
  info.dexterity = u32(32);
  info.vitality = u32(36);
  info.energy = u32(40);
  refreshHud();

  const names = ['力量', '敏捷', '体力', '能量'];
  inventoryPanel.toast(`+1 ${names[Math.min(3, result - 16)]}`, 1000);
}

/** 背包开关（I / V，和原版 Player_InputTick.cpp:475 一致） */
function toggleInventory(show?: boolean) {
  if (show === true) inventoryPanel.show();
  else if (show === false) inventoryPanel.hide();
  else inventoryPanel.toggle();
  if (inventoryPanel.isOpen) {
    inventoryPanel.setMoney(currentChar?.info?.money ?? 0);
    // 原版这几个面板是同一块 190 宽底板（450,0），同时开会完全重叠，
    // 所以这边强制互斥：开背包就收掉属性 / 战盟面板。
    characterPanel.hide();
    if (guildPanel.isOpen) guildPanel.hide();
  }
  bottomBar.setActive(inventoryPanel.isOpen ? 'inventory' : null);
}

/**
 * 角色属性面板开关（C 键，原版 Player_InputTick.cpp:304-318 的
 * 「Personaje」分支；底栏按钮的命中框是 (379,452) 24×24）。
 */
function toggleCharacter(show?: boolean) {
  const next = show ?? !characterPanel.isOpen;
  if (next) {
    inventoryPanel.hide();
    characterPanel.show();
    syncCharacterPanel();
    bottomBar.setActive('character');
  } else {
    characterPanel.hide();
    bottomBar.setActive(null);
  }
  return characterPanel.isOpen;
}

/** 把当前角色数据推给属性面板（进图 / 收到 0xF3 / 加点后都要调） */
function syncCharacterPanel() {
  if (!currentChar) {
    characterPanel.setInfo('', 0, 0, null);
    return;
  }
  /*
   * 职业不是直接取 charSet[0]，而要比特（`Net_Process.cpp:1643`）：
   *
   *     klass = ((csByte0 >> 4) | (csByte0 & 0x10)) >> 1
   *
   * 实测三个角色印证：csByte0=0x20 → 1（Dark Knight）、0x00 → 0（Dark Wizard）、
   * 0x40 → 2（Fairy Elf）。直接拿字节当职业号会得到 0/32/64，全落空。
   */
  // 0xA3 转职后以 `playerClassRaw` 为准（它会带上转职次数）
  const cls = playerClassId();
  // 装备槽是服务端槽位 0..11（12 之后才是 8×8 背包格）
  const worn = inventoryItems.filter(i => i.slot < 12);
  characterPanel.setInfo(
    currentChar.name,
    currentChar.level,
    cls,
    currentChar.info ?? null,
    worn
  );
}

/**
 * 属性面板的 [+] 按钮 —— 只发 `0xF3/06`，等回执。
 *
 * 服务端 `CGLevelUpPointRecv` 的回包在 `GAMESERVER_EXTRA=1` 时带了**完整四维**
 * （`PMSG_LEVEL_UP_POINT_SEND`），所以不用再拉一次 `0xF3/03`：
 * 那个请求在游戏里不会回包，之前就是这么超时的。
 */
characterPanel.onAddPoint = stat => {
  if (!session || !currentChar) return;
  console.log(`[MU] 加点 type=${stat}`);
  session.sendAddPoint(stat);
};

/**
 * 底栏三个按钮。命中框和原版 Player_InputTick.cpp:280-330 完全一致，
 * 点下去的行为也照抄：角色/背包各自 toggle，互斥由上面两个函数保证。
 */
bottomBar.onButton = id => {
  if (id === 'character') {
    toggleCharacter();
  } else if (id === 'inventory') {
    toggleInventory();
  } else if (id === 'party') {
    togglePartyPanel();
  } else if (id === 'guild') {
    toggleGuildPanel();
  }
};


/* ------------------------------------------------------------------ */
/* 世界加载                                                            */
/* ------------------------------------------------------------------ */
/**
 * 地图加载代号。
 *
 * 加载是异步的（解码地形/物件要几秒），期间可能又有人发起新的加载
 * （调试口 `loadMap`、传送、离线按钮里排队的那次）。用自增代号让
 * 「后发起的」赢：调用方在 `await` 前后各取一次，不相等就说明自己过期了。
 */
let worldLoadSeq = 0;

function disposeWorld() {
  // 底图是按地图缓存的，换图/退出时一起丢掉
  minimap.clear();
  /*
   * 水下滤镜是 DOM，退出地图后 `updateWaterLayer` 不再被调用，
   * 不在这里清掉的话会一直挂在画面上（回到选角界面还是蓝的）。
   */
  waterTint = 0;
  if (waterTintEl) {
    waterTintEl.style.display = 'none';
    waterTintEl.style.opacity = '0';
  }
  if (!world) return;
  scene.remove(world.root);
  world.root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
    else mat?.dispose();
  });
  world.terrain.mesh.geometry.dispose();
  (world.terrain.mesh.material as THREE.Material).dispose();
  world.objectFx.dispose();
  world.ambient.dispose();
  world = null;
}

/**
 * 环境粒子的点精灵换算系数：`gl_PointSize` 是设备像素，
 * 世界尺寸 s 的粒子在距离 d 处的像素尺寸 = s · H / (2·d·tan(fov/2))。
 */
function ambientPointScale() {
  const h = renderer.domElement.height || window.innerHeight;
  const fov = THREE.MathUtils.degToRad(muCamera.camera.fov);
  return h / (2 * Math.tan(fov / 2));
}

/**
 * 把当前角色状态喂给移动命令窗口（等级 / 金币 / 有没有翅膀 / 转生）。
 *
 * 离线演示没有角色卡：`currentChar` 是 null，等级按 0（= 不校验）、
 * 金币按 -1（= 不校验）传下去，只有「天空之城要翅膀」这条仍然生效。
 * 0.97 的 `CharacterInfo` 里没有转生字段，`reset` 恒为 0（= 不校验）。
 */
/** 调试用：模拟角色卡（探针验证等级/金币门槛时用），null = 用真实角色 */
let moveStatusOverride: { level: number; money: number; wings: boolean; reset: number } | null = null;

function refreshMovePanel() {
  if (moveStatusOverride) {
    movePanel.status = { ...moveStatusOverride };
    movePanel.refresh();
    return;
  }
  const wing = player ? currentEquip().wing : undefined;
  movePanel.status = {
    level: currentChar?.level ?? 0,
    money: currentChar?.info?.money ?? -1,
    reset: 0,
    wings: wing !== undefined,
  };
  movePanel.refresh();
}

/** Gate 落点矩形 → 一个「中心格」，给兜底用的 `findSpawnTile` 当提示 */
function rectCenter(rect: SpawnRect | null): [number, number] {
  if (!rect) return [-1, -1];
  return [Math.round((rect.x1 + rect.x2) / 2), Math.round((rect.y1 + rect.y2) / 2)];
}

/**
 * 移动命令：把主角送到 `entry` 描述的地图/落点。
 *
 * 落点严格按服务端 `Gate.txt` 的矩形来（`entry.spawn`），在矩形里随机挑一格能站的
 * —— 和 `CGate` 的行为一致；矩形没用时再退回「安全区重心」那套猜测。
 * 朝向用 Gate 的 `Dir`（0..7，和 `DIR_VECTORS` 同一套）。
 *
 * 同图 = 直接挪人（不重载世界）；跨图 = 整张图重来（走 `loadWorld`）。
 *
 * 在线模式**不放行**：0.97 协议里跨图只有服务端 → 客户端的 `0xF3/0x03`，
 * 没有客户端发起的 Warp 包，本地硬切会让服务端坐标和客户端彻底对不上
 * （之后每次移动都会被判定成瞬移）。
 */
/**
 * M 键「移动命令」面板选了一个地点。
 *
 * 在线模式**没有专门的 Warp 上行包**：0x1C（`CMove::CGTeleportRecv`）是
 * 「我已经站在这个门的格子上，请确认换图」，服务端还会用
 * `gGate.IsInGate()` 复核，站在别处发它只会被拉回原地。
 * 真正的「付费传送」只有服务端命令一条路：
 *
 *     /move <Move.txt 的英文名>   → CCommandManager::CommandMove
 *                                 → CMove::GetInfoByName + CMove::Move
 *
 * `CMove::Move` 会按服务端自己的 `Move.txt` 校验等级 / 金币 / 转生，
 * 扣钱后走 `gObjMoveGate` 下发 0x1C —— 所以客户端只要把 key 发出去，
 * **价格、门槛、落点全部以服务端为准**，本地那份表只用来画界面。
 *
 * 离线演示（sandbox）仍然本地切图。
 */
async function warpTo(entry: WarpEntry) {
  if (!player || !world) return;
  movePanel.hide();

  /*
   * 先把会占 `Interface.use` 的界面关掉（并发 0x31）。
   *
   * `/move` 是**聊天命令**，而服务端 `CGChatRecv` 在 `Interface.use != 0`
   * 时会把整条聊天丢掉 —— 不关的话玩家点「移动」就**完全没有反应**，
   * 连拒绝提示都没有（仓库/商店/混沌/事件窗口都会占这个标志）。
   */
  if (npcPanel.isOpen) closeNpcPanel();
  if (chaosPanel.isOpen) closeChaosPanel();
  if (eventPanel.isOpen) closeEventWindow();

  if (loggedIn && session && !sandbox.on) {
    // `/move` 的参数是 Move.txt 的英文 key（不是中文显示名，也不是 Index）
    const ok = sendChatText(`/move ${entry.key}`);
    if (!ok) chatBox.notice('移动命令：发送失败（当前不在线）');
    console.log(`[warp] /move ${entry.key}（${entry.name}，服务端价 ${entry.money} zen）`);
    return;
  }

  const [cx, cy] = rectCenter(entry.spawn);
  const yaw = yawFromDir(entry.dir, MODEL_YAW_OFFSET);
  if (world.mapId === entry.mapId) {
    const terrain = world.terrain;
    const tile = (entry.spawn && findSpawnTileInRect(terrain, entry.spawn)) ?? findSpawnTile(terrain, cx, cy);
    // 整数格点（原版坐标恒为整数，见移动段注释）
    player.x = tile.x;
    player.y = tile.y;
    // 渲染在格心，高度也按格心取（斜坡上站格号会浮起/陷下去半格高差）
    player.z = terrain.getHeight(player.x + 0.5, player.y + 0.5);
    player.yaw = yaw;
    // 走位队列里的旧路径是按旧坐标算的，必须丢掉
    movePath = [];
    pathCursor = 0;
    resetMoveTracking(player.x, player.y);
    void refreshPlayerEquipment();
    chatBox.notice(`移动命令：${entry.name}（${tile.x},${tile.y}）`);
    return;
  }

  chatBox.notice(`移动命令：前往 ${entry.name}`);
  await loadWorld(entry.mapId, cx, cy, {
    offline: true,
    spawnRect: entry.spawn ?? undefined,
    dir: entry.dir,
  });
}

async function loadWorld(
  mapId: number,
  spawnX: number,
  spawnY: number,
  opts: {
    offline: boolean;
    /** 移动命令：服务端 Gate.txt 的落点矩形（优先于 spawnX/spawnY） */
    spawnRect?: SpawnRect;
    /** 落地朝向 0..7（Gate.Dir） */
    dir?: number;
  }
) {
  const def = getMapDefinition(mapId);
  const worldDir = mapWorldDir(mapId);
  const fogColor = new THREE.Color(MAP_FOG[mapId] ?? DEFAULT_FOG);
  // 加载代号：谁最后发起谁的图生效（见离线按钮里那段 race 说明）
  worldLoadSeq++;
  // 换角色/重连都要重新以服务端下发的 charSet 为准，别把上一个人物的转职带过来
  playerClassRaw = null;

  showScreens({ loading: true });
  setProgress(`载入 ${def.name}（World${def.folder}）`, 3);

  // 必须在加载**开始**时清：0x12/0x13 会在加载过程中到达，
  // 如果等加载结束再 clear 会把刚建好的实体全删掉
  remotes.clear();
  groundItems.clear();
  pendingPickupId = -1;
  pickupSentAt = 0;
  resetMoveTracking(-1, -1);
  // 换图时把还在播的技能特效收掉：它们的落点是上一张图的地面高度
  effects.clear();
  spriteLayer.clear();
  beamLayer.clear();
  trailLayer.clear();
  wheelLayer.clear();
  slamLayer.clear();
  buffLayer.clearAll();

  disposeWorld();
  scene.fog = new THREE.Fog(fogColor, 80, 210);
  scene.background = fogColor;

  const root = new THREE.Group();
  root.name = `world-${mapId}`;
  scene.add(root);

  /* ---- 天空（部分地图没有 Sky.bmp） ---- */
  try {
    const sky = await loadSkyTexture(`${worldDir}Sky.bmp`);
    sky.repeat.set(4, 1);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(420, 32, 20),
      new THREE.MeshBasicMaterial({
        map: sky,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
        toneMapped: false,
      })
    );
    dome.position.set(128, 128, 0);
    dome.rotation.x = -Math.PI / 2;
    dome.frustumCulled = false;
    root.add(dome);
  } catch {
    console.warn(`[MU] ${def.english} 没有 Sky.bmp，用纯色背景`);
  }

  /* ---- 地形 ---- */
  setProgress('构建地形', 12);
  const terrain = await createTerrain(worldDir, def.folder, TILE_NAMES, {
    color: fogColor,
    near: 80,
    far: 210,
  }, msg => setProgress(msg, 20));
  root.add(terrain.mesh);
  /*
   * 水面单独一层（`terrain.water`）：地形是不透明的，水面要半透明、
   * 还不能写深度（否则会挡住水里的人和物件），所以不能塞进地形材质里。
   * 地图没有水（World8 缺 TileWater01）时是 null。
   */
  if (terrain.water) root.add(terrain.water);

  /* ---- 物件 ---- */
  setProgress('放置场景物件', 48);
  /*
   * 第三个参数：脚下那格的 `TerrainMappingLayer1`（原版 `HeroTile`）。
   * 收屋顶的原版判定就是「这张瓦片索引对不对」（洛兰 4、冰风谷 3 或 >=10）。
   */
  const layer1 = terrain.data.layer1;
  const tileAt = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= TERRAIN_SIZE || iy >= TERRAIN_SIZE) return -1;
    return layer1[iy * TERRAIN_SIZE + ix];
  };
  /*
   * ── 主角先加载 ────────────────────────────────────────────────────
   *
   * 顺序是「地形（含地面纹理）→ 主角 → 进场景」，物件/氛围/怪物全部挪到后台。
   * 原来物件放在主角前面，洛兰 109 类物件在线上要 40-110 秒，读条一直卡在那里 ——
   * 现在进图只等一张地形图 + 一个角色模型。
   */
  const actor = await ensurePlayer();
  /*
   * 落点优先级：
   *   1. 服务端 `Gate.txt` 的矩形（移动命令）—— 在矩形里随机挑一格能站的
   *   2. 服务端下发的具体坐标 —— 能站就原样用，绝不替玩家挑位置
   *   3. 负数（= 让地形自己挑）—— 安全区重心
   * 只有落在墙/水里时才由 `findSpawnTile` 挪到最近的安全区。
   */
  const spawn =
    (opts.spawnRect ? findSpawnTileInRect(terrain, opts.spawnRect) : null) ??
    findSpawnTile(terrain, spawnX, spawnY);
  // 出生点用**整数格号**：`lpObj->X/Y` 就是格号，渲染直接画在 (X, Y)
  const x = THREE.MathUtils.clamp(Math.round(spawn.x), 1, 254);
  const y = THREE.MathUtils.clamp(Math.round(spawn.y), 1, 254);
  actor.x = x;
  actor.y = y;
  actor.z = terrain.getHeight(x, y);
  actor.yaw = opts.dir !== undefined ? yawFromDir(opts.dir, MODEL_YAW_OFFSET) : -Math.PI * 0.75;
  actor.play(PlayerAction.STOP_MALE, true);
  // 出生点就是服务端认为我们所在的格（服务端 X/Y 是格坐标）
  resetMoveTracking(x, y);

  /*
   * ── 占位 world：物件还在后台，字段得先能调 ──────────────────────
   *
   * tick 每帧会 `world.objects.update()`、点地面要读 `placed`、销毁要
   * `objectFx.dispose()` —— 用一个空壳顶着，后台加载完成后原地替换字段。
   */
  clearMonsters();
  const objects = emptyWorldObjects();
  const objectFx = new ObjectFxLayer(root, []);
  const ambient = emptyAmbient();
  root.add(objects.group);
  world = { mapId, terrain, objects, objectFx, ambient, root };
  remotes.setTerrain(terrain);

  /*
   * 小地图底图：切图就换一张。`buildMinimap()` 是纯客户端合成
   * （tile 平均色 + 山体阴影 + 水面），一次算 256×256，之后缓存。
   * 只依赖地形，所以留在进场景之前。
   */
  const mapDef = getMapDefinition(mapId);
  minimap.setMap(mapDef.name, terrain.buildMinimap());

  setProgress('进入场景', 88);
  showScreens({ hud: true });
  // 技能快捷键是按角色存的（原版 HotKey[4][64] 也是每个角色一份）
  loadSkillHotkeys();
  void ensureSkillTable();
  /*
   * 声音：进图/换图切 BGM + 环境循环音（原版 `Game_MainLoop` 的 BGM 状态机），
   * 顺手把常用的几个音效预解码 —— 第一次挨打/捡东西时才去 fetch 会有明显延迟。
   */
  setSceneAudio(mapId);
  void preloadSounds([0x08, 0x09, 0x0a, 0x1d, 0x1e, 0x20, 0x28, 0x29, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38]);
  installDebugApi({ renderer, scene, camera: muCamera.camera, terrain, player: actor, monsters, objects });

  /*
   * 视野加载完成。**联机时这一步是必须的**：服务端在每次传送后把
   * `RegenOk` 置 1，等到这条 `0xF3/0x12` 才继续推进（见 `game.ts`
   * `buildViewportEnablePacket` 的注释）。不发的话角色能聊天、能弹界面，
   * 但走不动、东西搬不动、视野里也没有 NPC。
   */
  if (!opts.offline) notifyViewportReady();

  (window as any).__MU__ = {
    renderer,
    scene,
    muCamera,
    terrain,
    objects,
    objectFx,
    ambient,
    player: actor,
    monsters,
    setProgress,
    world,
  };

  /*
   * ── 后台加载：物件 → 物件特效 → 氛围 → 离线怪物 ─────────────────
   *
   * 这里**不 await**：上面已经 `showScreens({ hud: true })` 进场景了，玩家可以
   * 立刻走动；地面物件在接下来几十秒里陆续出现（空 group 先挂着，加载完整体挂上）。
   * `worldLoadSeq` 做守卫：中途换图/重连就丢弃这一次的结果。
   */
  const loadSeq = worldLoadSeq;
  void (async () => {
    try {
      const real = await createWorldObjects(mapId, msg => setProgress(msg, 55), tileAt);
      if (loadSeq !== worldLoadSeq || world?.root !== root) {
        // 已经换图了：把这次白加载的几何丢掉
        real.group.traverse(o => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
        });
        return;
      }
      root.add(real.group);

      // 物件特效层：先撤掉占位（空 spot），再按真实 fx 点重建
      objectFx.dispose();
      const fx = new ObjectFxLayer(root, real.fx);

      const amb = await createAmbient(mapId, (xx, yy) => terrain.getHeight(xx, yy));
      if (loadSeq !== worldLoadSeq || world?.root !== root) {
        fx.dispose();
        amb.dispose();
        return;
      }
      root.add(amb.group);
      amb.setRain(rainTarget);
      ambient.dispose();

      world.objects = real;
      world.objectFx = fx;
      world.ambient = amb;
      installDebugApi({ renderer, scene, camera: muCamera.camera, terrain, player: actor, monsters, objects: real });
      const mu = (window as any).__MU__;
      if (mu) Object.assign(mu, { objects: real, objectFx: fx, ambient: amb });

      setProgress(
        `物件 ${real.stats.placed}/${real.stats.total}` +
          `${real.stats.hidden ? `（隐藏 ${real.stats.hidden}）` : ''} · ` +
          `${Math.round(real.stats.triangles)} 三角面 · ${real.stats.drawCalls} DrawCall` +
          `${real.anim.instances ? ` · 动画 ${real.anim.instances} 件/${real.anim.ids.length} 类` : ''}` +
          `${amb.stats.length ? ` · 氛围 ${amb.stats.map(x => `${x.kind}×${x.count}`).join('/')}` : ''}`,
        100
      );
      console.log(
        `[MU] ${def.english} 就绪：物件 ${real.stats.placed}/${real.stats.total}` +
          `，缺失 ID ${[...real.stats.missing].join(',') || '无'}，drawCall ${real.stats.drawCalls}`
      );

      /* ---- 怪物（仅离线演示）：也不挡进场景 ---- */
      if (opts.offline) {
        if (loadSeq !== worldLoadSeq) return;
        // 用服务端刷怪表里的真实 Class：3=Spider、2=Budge Dragon、7=Bull Fighter、255=Barmaid(NPC)
        const spots = [
          { cls: 3, dx: -6, dy: 5 },
          { cls: 2, dx: 5, dy: 7 },
          { cls: 7, dx: 2, dy: 11 },
          { cls: 255, dx: -4, dy: -5 },
          { cls: 248, dx: 6, dy: -6 },
        ];
        for (const spot of spots) {
          const created = await createCreatureByClass(
            scene,
            { monster: MONSTER_DIR, npc: NPC_DIR },
            spot.cls
          );
          if (!created) continue;
          const m = created.actor;
          m.x = x + spot.dx;
          m.y = y + spot.dy;
          m.z = terrain.getHeight(m.x, m.y);
          m.yaw = Math.random() * Math.PI * 2;
          monsters.push(m);
          if (playerShadow) addMonsterShadow(m);
        }
        await spawnSkillDummy(terrain);
        /*
         * 预热技能资源：面板随时可能点 Cast，别让第一次等一秒。
         * 清单**从源码表反推**（`castOf` 的 parts），不再手写：
         * 模型和贴图一起拉，`SKILL_FX` 只作为「源码没覆盖的技能」的补充。
         */
        void warmUpSkillAssets();
      }
    } catch (err) {
      console.warn('[MU] 物件/氛围后台加载失败（场景仍可玩）', err);
    }
  })();
}

/**
 * 上报「视野已加载完成」（`C1 04 F3 12`），带重发。
 *
 * 为什么要重发：服务端把 `RegenOk` 从 1 推到 2 只认**一次**包，
 * 但 2→3→0 是在主循环里推进的；如果这次包恰好赶上角色对象还在
 * `OBJECT_DELCMD`（刚登录/刚换图），它就白发了，角色会一直卡在
 * 「视野加载中」：0x24 全被拒、0x12 不再下发（视野空白）。
 * 判据用「视野里有没有实体」——有实体说明服务端已经在推 0x12，就停。
 */
function notifyViewportReady() {
  if (!connection?.connected) return;
  window.clearInterval(viewportHandshakeTimer);
  const deadline = performance.now() + 20000;
  let pings = 0;
  const ping = () => {
    if (!connection?.connected) {
      window.clearInterval(viewportHandshakeTimer);
      return;
    }
    // 已经收到视野包（0x12/0x13）就说明服务端在推实体了，握手结束
    if (performance.now() > deadline || performance.now() - lastViewportAt < 1200) {
      window.clearInterval(viewportHandshakeTimer);
      return;
    }
    pings++;
    connection.send(buildViewportEnablePacket());
    console.log(`[MU] 上报视野加载完成（0xF3/0x12）第 ${pings} 次`);
  };
  ping();
  viewportHandshakeTimer = window.setInterval(ping, 1000);
}

/**
 * 按服务端的坐标落地（0x1C 传送 / F3-04 重生共用）。
 *
 * 为什么在同一个图也要走这里：服务端是唯一权威，客户端自己走位时可能有
 * 几格偏差（0x10 被丢包/被墙挡住），传送回执正好用来对齐。
 *
 * 换图时必须 `loadWorld(..., { offline:false })`：
 *   - `offline:true` 会往场景里塞演示怪物，联机时是错的；
 *   - loadWorld 开头就 `remotes.clear()`，这样紧随其后的 0x12 视野包
 *     才会被当成新地图的实体（顺序反了会剩下一堆旧地图的鬼影）。
 */
async function serverTeleport(map: number, x: number, y: number, dir: number) {
  if (!world) return;

  if (map === world.mapId) {
    if (!player) return;
    // 整数格点（服务端下发的 x/y 本来就是格号）
    player.x = x;
    player.y = y;
    player.z = world.terrain.getHeight(player.wx, player.wy);
    player.yaw = yawFromDir(dir, MODEL_YAW_OFFSET);
    player.play(PlayerAction.STOP_MALE, true);
    movePath = [];
    pathCursor = 0;
    resetMoveTracking(player.x, player.y);
    /*
     * 同图传送（GM `/gmove`、回城、随机传送）也要回视野使能！
     * 服务端在 `gObjMoveGate` / `gObjTeleport` 里**不区分地图变没变**，
     * 一样是 `DestroyViewport → 0x1C → CreateViewport`，并且 `RegenOk = 1`。
     * 这里如果不发，角色就会卡在「视野加载中」：0x24 全被拒、0x12 也不再下发。
     */
    notifyViewportReady();
    return;
  }

  // 连续两条 0x1C（服务端重发 / 连点传送门）时别叠两次 loadWorld：
  // 后一次会在前一次还没建完 world 时 disposeWorld，留下半张地图
  if (teleporting) {
    console.warn(`[MU] 正在换图，忽略 map=${map}`);
    return;
  }
  teleporting = true;
  movePath = [];
  pathCursor = 0;
  try {
    await loadWorld(map, x, y, { offline: false, dir });
    chatBox.notice(`已进入 ${getMapDefinition(map).name}`);
  } catch (err) {
    console.error('[MU] 换图失败', err);
    chatBox.notice(`换图失败：${getMapDefinition(map).name}`);
  } finally {
    teleporting = false;
  }
}

/** 换图进行中（防止 0x1C 重入） */
let teleporting = false;

async function ensurePlayer(): Promise<Actor> {
  if (player) return player;
  setProgress('加载角色模型', 88);
  // 进图时背包可能已经同步过（0xF3/0x10 先到），直接用真实穿戴；
  // 还没到就是空的，等 syncInventoryViews 触发 refreshPlayerEquipment 补上
  const equip = currentEquip();
  await warmPlayerAnimTables();
  player = await createPlayer(scene, PLAYER_DIR, equip);
  equipSig = JSON.stringify(equip);
  lastSafeZone = equip.safeZone === true;

  if (!shadowTexture) shadowTexture = createRadialTexture();
  playerShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      color: 0x000000,
      fog: false,
    })
  );
  playerShadow.renderOrder = 1;
  scene.add(playerShadow);

  marker = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.46, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffd479,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    })
  );
  scene.add(marker);

  return player;
}

function addMonsterShadow(m: Actor) {
  if (!shadowTexture) return;
  const s = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.4),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      color: 0x000000,
      fog: false,
    })
  );
  scene.add(s);
  monsterShadows.push({ mesh: s, actor: m });
}

function clearMonsters() {
  for (const m of monsters) {
    scene.remove(m.root);
    for (const mesh of m.meshes) scene.remove(mesh);
  }
  monsters = [];
  for (const s of monsterShadows) {
    scene.remove(s.mesh);
    s.mesh.geometry.dispose();
  }
  monsterShadows = [];
  skillTarget = null;
}

/* ------------------------------------------------------------------ */
/* 技能                                                                */
/* ------------------------------------------------------------------ */

/** 测试怪用哪个 Class：7 = Giant（`Monster06.bmd`），洛兰最常见的近战怪 */
const SKILL_DUMMY_CLASS = 7;

/**
 * 技能测试怪：固定在洛兰 (186,129)。
 *
 * 技能菜单需要一个「站着不动、看得见」的靶子，所以不参与 AI，只播待机。
 * 玩家点 Cast 时若离得太远，`castSkill` 会先把人挪到它面前 2.6 格。
 */
async function spawnSkillDummy(terrain: TerrainMesh) {
  const created = await createCreatureByClass(
    scene,
    { monster: MONSTER_DIR, npc: NPC_DIR },
    SKILL_DUMMY_CLASS
  );
  if (!created) {
    console.warn('[skill] 测试怪模型缺失，技能菜单没有靶子');
    return;
  }
  const m = created.actor;
  m.x = SKILL_TEST_SPOT.gx + 0.5;
  m.y = SKILL_TEST_SPOT.gy + 0.5;
  m.z = terrain.getHeight(m.x, m.y);
  m.yaw = -Math.PI / 2;
  m.play(MONSTER_ACTION.STOP, true);
  monsters.push(m);
  if (playerShadow) addMonsterShadow(m);
  skillTarget = m;
  // 技能数一起报：面板加载完会先写一次，这里覆盖成「靶子在哪」，别把技能数弄丢
  const count = (await loadSkills()).length;
  sandboxPanel.setHint(
    `靶子：${m.name} @ ${SKILL_TEST_SPOT.gx},${SKILL_TEST_SPOT.gy} · ${count} 个技能`
  );
}

/** `Skill/Xxx.bmd` → `Xxx.bmd`（`EffectLayer` 自己带 `Data/Skill/` 前缀） */
function modelName(file: string): string {
  return file.replace(/^Skill\//i, '');
}

/**
 * 算一件特效的落点（游戏坐标：x/y 是格，z 是高度米）。
 *
 * 对应源码 `MoveCharacter` 里 `CreateEffect` 第三个实参的四种来历：
 *
 *   self          `(float*)(o + 16)`                  施法者脚下
 *   target        `(float*)(Owner + 16)`              目标脚下（命中特效）
 *   targetGround  `WorldPosition`                     目标格地面（地面轰击）
 *   front         `mc_AngleVectorOffset(o, -20, -90, 100, WorldPosition)`
 *                                                     施法者身前 100（= 1 格）
 *
 * `spread` 让同一次 `count > 1` 的多个实例散开 —— 源码那边是逐帧微调角度
 * （`angle += 20°`），这里用黄金角散点近似，至少不会叠成一坨白。
 */
function fxAnchor(
  at: FxPart['anchor'],
  me: Actor,
  /** 只要坐标就够（本地传 Actor、远端传一个 {x,y,z} 都行） */
  target: { x: number; y: number } | null,
  spread = 0,
  seed = 0
): { x: number; y: number; z: number } {
  let x = me.x;
  let y = me.y;

  if (at === 'front') {
    /*
     * 模型本地面朝 -Y，`Actor` 的 yaw 补了 MODEL_YAW_OFFSET(π/2)，
     * 所以世界朝向 = (cos(yaw - π/2), sin(yaw - π/2)) = (sin yaw, -cos yaw)。
     */
    x += Math.sin(me.yaw) * 1.0;
    y -= Math.cos(me.yaw) * 1.0;
  } else if (at !== 'self' && target) {
    x = target.x;
    y = target.y;
  }

  if (spread > 0) {
    // 黄金角（≈137.5°）：任意个数都能均匀散开，不会两两重合
    const a = seed * 2.399963 + Math.random() * 0.5;
    const r = spread * (0.45 + 0.55 * Math.random());
    x += Math.cos(a) * r;
    y += Math.sin(a) * r;
  }

  return { x, y, z: world?.terrain.getHeight(x, y) ?? me.z };
}

/**
 * 冰封箭（51）**命中时挂在目标身上**的两件 Ice01。
 *
 * 出处 `PacketHandler_0x19` 的 `case 0x33`：
 *
 *   DeleteEffect(190, target, 1);
 *   CreateEffect(190, target+16, angle,        target+232, sub=1, owner=target, …);
 *   angle[2] += 180;
 *   CreateEffect(190, target+16, angle,        target+232, sub=2, owner=target, …);
 *   SetPlayerStop(target);
 *   target[+120] |= 0x20;      // 冰冻状态位
 *
 * 也就是**两件互相差 180° 的冰晶包住被打的人**，不是施法者身上的一团。
 * 190 = `Skill/Ice01.bmd`（`EFFECT_MODELS`）。
 *
 * 箭要飞一会儿才到，所以这里等 `delay` 再挂；`life` 给 1.6 s —— 源码那两件的
 * 寿命是 100 帧上下（4 s），但沙盘里留太久会挡住下一次施法的观感。
 */
function spawnIceArrowHit(pos: { x: number; y: number; z: number }, delay = 300) {
  window.setTimeout(() => {
    if (!world) return;
    for (let k = 0; k < 2; k++) {
      void effects
        .spawn(modelName('Skill/Ice01.bmd'), { x: pos.x, y: pos.y, z: pos.z + 1.0 }, {
          scale: 1,
          yaw: k * Math.PI,
          life: 1.6,
          speed: 0.3,
        })
        .catch(err => console.warn('[skill] 冰封箭命中冰晶生成失败', err));
    }
  }, delay);
}

/**
 * 播一次**受击动作**（源码里由两条路给）：
 *
 *   怪物 / NPC —— `MONSTER_ACTION.SHOCK`（= 4；怪物 BMD 只有 0..5 组动作）
 *   玩家      —— `0x85 / 0x87 / 0x8B / 0x8C`（`PacketHandler_0x19` 的 `case 0x03`
 *                会 `SetPlayerStop(target)` 打断这四种「受击/后仰」动作）
 *
 * 播完回待机；中途被别的动作顶掉就不硬塞 STOP，否则会出现「正在走路却被按回站立」。
 * 模型里没有这组动作时直接跳过 —— 硬播一个不存在的 action 会让骨架姿势错乱。
 */
function playHurtAction(actor: Actor, kind: 'player' | 'monster' | 'npc') {
  if (kind === 'monster' || kind === 'npc') {
    if (!actor.rig.bmd.actions[MONSTER_ACTION.SHOCK]) return false;
    actor.play(MONSTER_ACTION.SHOCK, false);
    window.setTimeout(() => {
      if (actor.action === MONSTER_ACTION.SHOCK) actor.play(MONSTER_ACTION.STOP, true);
    }, 520);
    return true;
  }
  const candidates = [0x85, 0x87, 0x8b, 0x8c].filter(a => actor.rig.bmd.actions[a]);
  if (!candidates.length) return false;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  actor.play(pick, false);
  window.setTimeout(() => {
    if (actor.action === pick) actor.play(PlayerAction.STOP_MALE, true);
  }, 420);
  return true;
}


/**
 * 黑龙波（9 / Evil Spirit）—— 「4 条 `Laser01` 贴地游动」的专用渲染器。
 *
 * 源码 `SecondPassword.cpp` 的 `case 9`：
 *
 *   for (kk = 0; kk < 4; ++kk) {
 *     v394 = { 0, 0, kk * 90.0f };
 *     Joint_Create(1253, v399, o+16, v394, 0, o, 80.0f, target, hk);  // 头
 *     Joint_Create(1253, v399, o+16, v394, 0, o, 20.0f, -1, 0);      // 尾
 *   }
 *
 * 每帧（`MoveJoint.cpp` type 0x4E5 sub 0）：
 *   - 只有 `scale == 80` 的那 4 条会 `CreateEffect(205)` = `Skill/Laser01.bmd`
 *     （`Effect_Create case 0xcd`：寿命 1 帧、缩放 **1.3**），
 *     scale 20 的 4 条只画光带；
 *   - 目标点每帧写成「施法者 z + 80」→ 追着人游；
 *   - `MoveHumming(..., 10.0f)` 每帧转向；`+0x9c4 += (rand%32-16)*0.2` 抖动；
 *   - `terrain+100 > z` / `terrain+400 < z` 做贴地约束；
 *   - 颜色 = `lifetime * 0.1` 渐暗；`AddTerrainLight(..., 4)` 给脚下打光。
 *
 * 我们的架构没有「关节池 + 逐帧 tick」，所以这里直接：
 *   ① 4 条 `Laser01` 常驻（源码那 1 帧寿命本质就是「每帧重出」，视觉上连续）；
 *   ② 每条绕施法者游动（角速度/半径各不相同 + 正弦呼吸 + 随机抖动），贴地；
 *   ③ 每 70 ms 在当前位置留一段 `JointSpirit01`，连成光带（源码 1253 的段）。
 *
 * **不要地面光圈**：源码用 `AddTerrainLight` 提亮地形顶点，不是贴圆片。
 */
/** 黑龙波 4 条激光的实时位置（探针核对轨迹用） */
let dragonWaveLive: { x: number; y: number; z: number; r: number }[] = [];

function castDragonWave(caster: Actor) {
  if (!world) return;
  dragonWaveLive = [];

  /*
   * ── 轨迹：为什么是「原地翻腾」而不是「绕圈飞」─────────────────────
   *
   * 反编译核对（`MoveJoint.cpp` type 0x4E5 sub 0 + `SMD_Parser.cpp`）：
   *
   *   `MoveHumming(pos, angle, target, turn)` **只把角度转向目标，不动位置**
   *     （`SMD_Parser.cpp:672` 后面那段注释写得很明确：
   *      "NO mueve la posicion (de eso se encarga el tick generico del joint)"）
   *   公共出口 `switchD_caseD_4ef` 只调 `Joint_SegmentTick(o, mat)`，
   *     而 `Joint_SegmentTick` 是「拿 scale 和当前位置算 4 个顶点」——
   *     **也不推进位置**；
   *   `+0x9bc`（到达标志）只写不读，没有任何分支消费它。
   *
   * 也就是说这 4 条 joint 的位置**整段寿命里都不变**（就在 `CreateJoint` 给的
   * 起点 = 施法者 z+100 那儿），每帧变的只有：
   *   `Angle[0] += (rand%32-16)*0.2`（俯仰抖动，×0.6 衰减）
   *   `Angle[2] += (rand%32-16)*0.8`（偏航抖动，×0.8 累积）
   * 再加 `CreateEffect(205)` 每帧重建一条 Laser01（BMD 自己是龙形波动动画）。
   *
   * 所以原版的画面是「4 条龙形波在身上/头顶小幅翻腾扭动」，
   * 不是「4 个卫星绕人转」。上一版给了 1~1.7 格半径匀速圆周，轨迹就错了。
   *
   * 现在：半径收到 0.35~0.62 格、高度取源码的 z+1 格（100 单位），
   * 角度用「缓慢漂移 + 大幅随机摆动」，并让**朝向始终指回施法者**
   * （`MoveHumming` 的结果就是这样：目标点每帧写成「施法者 z+80」）。
   */
  const DUR = 1.96;          // 源码 `+0x9b8 = 49` 帧 @25fps
  /**
   * `Effect_Create case 0xcd` 给的是 `pfVar17[3] = 1.3`，但那是**效果槽**的缩放；
   * 我们的 `spawn(scale)` 是「BMD 的 0.01 倍」，1.3 会画出 2.4 m 长一条、白成一片。
   * 0.85（≈1.6 m）在游戏镜头下才对得上「身上翻腾的龙形波」。
   */
  const SCALE = 0.85;
  const BRIGHT = 0.55;
  /** 离地高度：源码起点 `z + 100`（1 格），目标点 `z + 80` */
  const LIFT = 1.0;
  const ter = world.terrain;

  const heads = Array.from({ length: 4 }, (_, k) => ({
    /** 源码 `v394 = { 0, 0, kk * 90.0f }` —— 4 个方向各差 90° */
    ang: caster.yaw + (k * Math.PI) / 2,
    /** 缓慢漂移的角速度：各不相同，避免 4 条同步得像齿轮 */
    drift: (k % 2 === 0 ? 1 : -1) * (0.32 + k * 0.11),
    /** 游动半径（格）—— 源码位置不动，这里只给很小的活动范围 */
    radius: 0.62 + k * 0.16,
    /** 半径/高度呼吸的相位 */
    phase: k * 1.73,
    /** 偏航抖动的相位（每帧随机的等效） */
    wob: k * 2.71,
    node: null as Awaited<ReturnType<typeof effects.spawn>> | null,
  }));

  void (async () => {
    for (const h of heads) {
      h.node = await effects.spawn(
        modelName('Skill/Laser01.bmd'),
        { x: caster.x, y: caster.y, z: ter.getHeight(caster.x, caster.y) + LIFT },
        { scale: SCALE, speed: 1.0, life: DUR, yaw: h.ang, lift: 0 }
      );
    }

    const t0 = performance.now();
    let lastTrail = 0;

    const tick = () => {
      const now = performance.now();
      const t = (now - t0) / 1000;
      if (t > DUR || !world) {
        clearInterval(timer);
        return;
      }

      // 源码 `color = lifetime * 0.1`（49 帧 → 4.9），末段 0.55 s 渐暗
      const fade = Math.max(0, Math.min(1, (DUR - t) / 0.55));

      dragonWaveLive.length = 0;
      for (const h of heads) {
        h.ang += h.drift * 0.033;
        /*
         * 抖动：源码 `+0x9c4 += (rand()%32-16)*0.2` / `+0x9cc` 累积，
         * 单位是「度」，量级 ±6.4°（偏航）/ ±3.2°（俯仰）。
         * 这里用两个不同频率的正弦叠出「不是圆周」的乱晃感。
         */
        const wobYaw =
          (Math.sin(t * 7.9 + h.wob) * 0.75 + Math.sin(t * 13.1 + h.wob * 2.3) * 0.35) * 0.42;
        const wobPitch = Math.sin(t * 6.3 + h.phase) * 0.22;

        const r = h.radius + Math.sin(t * 1.9 + h.phase) * 0.1;
        const a = h.ang + wobYaw;
        const x = caster.x + Math.cos(a) * r;
        const y = caster.y + Math.sin(a) * r;
        // 高度：源码 z 夹在 `terrain+100` / `terrain+400` 之间，取低档
        const z =
          ter.getHeight(x, y) + LIFT + h.phase * 0.06 + Math.sin(t * 2.3 + h.phase) * 0.12 + wobPitch * 0.3;

        dragonWaveLive.push({ x, y, z, r: Math.hypot(x - caster.x, y - caster.y) });
        if (h.node) {
          h.node.root.position.set(x, y, z);
          h.node.anchor = { x, y, z };
          /*
           * 朝向：**指回施法者**（`MoveHumming` 每帧把角度转向「施法者 z+80」），
           * 不是切线方向。`Laser01` 长轴在本地 +X，所以直接给世界角。
           */
          const toCenter = Math.atan2(caster.y - y, caster.x - x);
          h.node.root.rotation.z = toCenter + wobPitch;
          h.node.root.rotation.x += 1.7 * 0.033; // 龙身缓慢翻滚
          for (const m of h.node.mats) fxAlpha(m, fade * BRIGHT);
        }

        // 光带（源码 1253 的段）：每 70 ms 留一段在当前位置
        if (now - lastTrail >= 70) {
          void spriteLayer.spawn('Effect/JointSpirit01.OZJ', { x, y, z: z + 0.2 }, {
            // 光带只是「尾巴」的暗示，压小压暗，别和主体糊成一团白
            size: 0.34,
            life: 0.28,
            lift: 0,
            rise: 0,
            opacity: 0.45 * fade,
            fadeIn: 0.01,
            fadeOut: 0.6,
          });
        }
      }
      if (now - lastTrail >= 70) lastTrail = now;
    };

    const timer = setInterval(tick, 33);
    tick();
  })();
}

/**
 * 把 `CastSpec.parts` 变成场景里的东西 —— **本地施法和远端施法共用这一份**。
 *
 * 以前只有本地沙盘（`castSkill`）走 `castOf()` 的完整序列，远端/收包那条
 * （`playRemoteSkill`）还停在早期的单件映射 `SKILL_FX[skill]` 上：
 * 一份 3~10 件的技能，别人放的时候只有 1 件。
 *
 * 这里只负责「按 part 生成」，不碰伤害数字、不碰动作，也不判断该不该放 ——
 * 那些留在两个调用点各自处理（沙盘要飘伤害，联机由服务端 0x15 下发）。
 */
function playCastParts(opts: {
  spec: CastSpec;
  caster: Actor;
  aim: { x: number; y: number; z: number } | null;
  label: string;
}) {
  const { spec, caster, aim, label } = opts;

  // 专用渲染器：不走通用 part 循环
  if (spec.special === 'dragon-wave') {
    castDragonWave(caster);
    return;
  }

  let seed = 0;
    for (const part of spec.parts) {
      /*
       * 拖尾单独处理：`part.count` 就是**段数**本身（源码 1210..1212 连发 30 段），
       * 不能再套一层 `for (count)`，否则 10 段 × 10 段 = 100 个 sprite。
       */
      if (part.kind === 'trail') {
        const base = fxAnchor(part.anchor, caster, aim, 0, seed++);
        /*
         * 铺开方向：
         *   有目标点 → **从施法者指向落点**（源码 1176 的 30 段是沿弹道连发的，
         *   极光/闪电这类都是「朝目标射出去」，不是「朝自己脸前」）；
         *   没有 → 退回施法朝向（模型本地面朝 -Y，yaw 补了 π/2 → 世界朝向 (sin, -cos)）。
         */
        let dx = Math.sin(caster.yaw);
        let dy = -Math.cos(caster.yaw);
        if (aim) {
          const vx = aim.x - base.x;
          const vy = aim.y - base.y;
          const len = Math.hypot(vx, vy);
          if (len > 0.25) {
            dx = vx / len;
            dy = vy / len;
          }
        }
        /*
         * 段间距：有目标点时**铺满整条弹道**（`dist / (count-1)`），
         * 固定 0.42 格 × 30 段 = 12.6 格，比射程还长，看起来就是一串稀稀拉拉的点。
         */
        const dist = aim
          ? Math.min(9, Math.hypot(aim.x - base.x, aim.y - base.y))
          : part.count * 0.42;
        const gap = part.count > 1 ? dist / (part.count - 1) : 0;
        for (let k = 0; k < part.count; k++) {
          const step = gap * k;
          void spriteLayer
            .spawn(
              part.file,
              { x: base.x + dx * step, y: base.y + dy * step, z: base.z },
              {
                // 越远越小，才像「拖尾」而不是一排等大的点
                // 头部略大、尾部略小，但整体保持粗一些，才连得成「光带」
                size: (part.size ?? 0.55) * (1.15 - (k / part.count) * 0.55),
                life: part.life ?? 0.45,
                lift: (part.lift ?? 0.2) + k * 0.06,
                rise: 0.05,
              }
            )
            .catch(err => console.warn(`[skill] ${label} 拖尾生成失败`, err));
        }
        continue;
      }

      /*
       * 关节（`Joint_Create`）：从施法者身上向外连出 N 道光束。
       * `part.count` 是光束数，端点按 `spread` 随机散开（源码里是 ±300 单位）。
       */
      if (part.kind === 'beam') {
        const from = { x: caster.x, y: caster.y, z: caster.z + 1.0 };
        /*
         * `aim: true` = **一条从施法者连到目标的雷/光**（袭风刺命中那一下），
         * 不是 `Joint_Create` 那种在自己身上四散的关节。
         * 端点取目标胸口高度，否则雷会连到脚底、看起来像在「电地面」。
         */
        if (part.aim && aim) {
          void beamLayer
            .spawn(from, { x: aim.x, y: aim.y, z: aim.z + 1.2 }, {
              file: part.file,
              width: part.size ?? 0.4,
              life: part.life ?? 0.3,
            })
            .catch(err => console.warn(`[skill] ${label} 命中光束生成失败`, err));
          continue;
        }
        /*
         * `anchor: 'target'` 的非 aim 光束 = **贴在目标身上的短电弧**。
         *
         * 依据 `DeathStabVictimEffect.SpawnLightningBetweenBones()`：每 2 帧
         * 随机取两根骨骼，在**两点之间**挂一道 `JointThunderEffect`
         * （`Scale = 骨头间距 / 50`，最小 0.5），共 35 帧 —— 视觉上是
         * 「电在被打的人身上来回爬」，不是从施法者射过去的一道长光。
         * 我们拿不到骨骼，就用目标身体为球心随机连短线段近似。
         */
        if (part.anchor === 'target' && aim) {
          const h = part.lift ?? 1.0;
          const r = part.spread ?? 0.55;
          for (let k = 0; k < part.count; k++) {
            const a1 = Math.random() * Math.PI * 2;
            const a2 = a1 + Math.PI * (0.5 + Math.random());
            const d1 = r * (0.3 + Math.random() * 0.7);
            const d2 = r * (0.3 + Math.random() * 0.7);
            const z1 = aim.z + h + (Math.random() - 0.5) * 0.9;
            const z2 = aim.z + h + (Math.random() - 0.5) * 0.9;
            void beamLayer
              .spawn(
                { x: aim.x + Math.cos(a1) * d1, y: aim.y + Math.sin(a1) * d1, z: z1 },
                { x: aim.x + Math.cos(a2) * d2, y: aim.y + Math.sin(a2) * d2, z: z2 },
                { file: part.file, width: part.size ?? 0.3, life: part.life ?? 0.3 }
              )
              .catch(err => console.warn(`[skill] ${label} 体表电弧生成失败`, err));
          }
          continue;
        }
        const r = part.spread ?? 2.5;
        for (let k = 0; k < part.count; k++) {
          const ang = Math.random() * Math.PI * 2;
          const dist = r * (0.55 + Math.random() * 0.45);
          const to = {
            x: caster.x + Math.cos(ang) * dist,
            y: caster.y + Math.sin(ang) * dist,
            z: caster.z + 0.4 + Math.random() * Math.max(0.2, r * 0.5),
          };
          void beamLayer
            .spawn(from, to, {
              file: part.file,
              width: part.size ?? 0.36,
              life: part.life ?? 0.3,
            })
            .catch(err => console.warn(`[skill] ${label} 光束生成失败`, err));
        }
        continue;
      }

      /*
       * 武器旋转（源码 238 → 239 `RenderWheelWeapon`）：
       * 转的是**玩家当前手上的武器**，不是特效模型。
       * 武器是静态几何（`buildHeldItem` → `createStaticMeshes`），所以克隆一份、
       * 挂到绕竖轴转的 pivot 上就行，不用碰角色本体。
       */
      if (part.kind === 'weapon') {
        const pos0 = fxAnchor(part.anchor, caster, aim, 0, seed++);
        /*
         * 武器可能正在**重建**：进出安全区会触发 `refreshPlayerEquipment()`，
         * 它先 `removeFromParent` 再把新件挂上去，中间有几帧 `props` 是空的。
         * 这时如果立刻退化成替代模型，就会凭空多一个 Saw01 留在场上
         * （实测会把它算进下一个技能的件数断言里）。所以取不到就隔 120 ms 再试。
         */
        const trySpawn = (tries: number) => {
          /*
           * 武器不一定在手上：安全区会背到背上（`held:161@back`）。
           * 源码 `RenderWheelWeapon` 取的是 `owner[136]`（武器**类型**）+400，
           * 根本不关心挂在哪 —— 所以这里也按「任意挂载位置的武器」来找。
           */
          const weapon =
            caster.props.find(p => p.name.endsWith('@right')) ??
            caster.props.find(p => p.name.startsWith('held:'));
          if (weapon) {
            wheelLayer.spawn(weapon, pos0, {
              life: part.life,
              spin: part.spin,
              lift: part.lift,
            });
            return;
          }
          if (tries > 0) {
            window.setTimeout(() => trySpawn(tries - 1), 120);
            return;
          }
          /*
           * 真空手：源码 `model_id = owner 武器 + 400` 取不到，238/239 **什么都不画**。
           * 这里也不拿替代模型兜底 —— 兜底是延迟生成的，会漏过探针的 `fxClear()`，
           * 凭空多一件留在场上（实测把后面技能的件数断言全带歪）。
           */
          console.warn(`[skill] ${label}：空手，238 武器旋转跳过`);
        };
        trySpawn(3);
        continue;
      }

      /*
       * 武器砸地（源码 244 `ItemDrop_RenderGroundWeapon` 0x0046B980）：
       * 前半段是**武器**（举起来 → 砸下去），落地那一刻才出地裂。
       * 源码只在 life > 10（也就是前半段）画武器，落地后画的是裂缝。
       */
      if (part.kind === 'weaponSlam') {
        const pos0 = fxAnchor(part.anchor, caster, aim, 0, seed++);
        /*
         * 落地之后的东西（地裂、扬尘）**不在这里生成** —— 它们是独立的 `parts`，
         * 带 `delay: 0.68` 由下面的通用分支生成。这样 `parts` 和实际生成一一对应，
         * 探针不会把「延迟生成的地裂」当成多余的件。
         */
        const trySlam = (tries: number) => {
          // 同上：安全区武器在背上，也要能拿来砸
          const weapon =
            caster.props.find(p => p.name.endsWith('@right')) ??
            caster.props.find(p => p.name.startsWith('held:'));
          if (weapon) {
            slamLayer.spawn(weapon, pos0, {
              life: part.life,
              spin: part.spin,
              tilt: (50 * Math.PI) / 180,
            });
            return;
          }
          if (tries > 0) {
            window.setTimeout(() => trySlam(tries - 1), 120);
            return;
          }
          // 空手：源码取不到武器模型（`owner[136] + 400`），只有落地后的地裂
        };
        trySlam(3);
        continue;
      }

      const spread = part.spread ?? 0;
      const spawnOne = (i: number) => {
        const pos = fxAnchor(part.anchor, caster, aim, spread, seed++);

        /*
         * 碎石 / 图集爆闪（wiki 补充件，见 `skillFxRefine.ts`）：
         * 碎石本质是**普通的 BMD 模型**，只是带初速 + 重力，所以走特效模型层；
         * 爆闪是序列帧贴图，走贴图层。两者都不打地面光斑 —— 光斑由主件负责，
         * 否则一次陨石会在同一格叠 6 个光斑，地面直接过曝。
         */
        if (part.kind === 'debris') {
          void effects
            .spawn(modelName(part.file), pos, {
              scale: part.scale ?? 1,
              life: part.life,
              yaw: Math.random() * Math.PI * 2,
              spin: part.spin ?? (Math.random() * 6 - 3),
              vel: part.vel,
              velJitter: part.velJitter,
              gravity: part.gravity,
              glow: false,
            })
            .catch(err => console.warn(`[skill] ${label} 碎石生成失败`, err));
          return;
        }

        if (part.kind === 'flash') {
          void spriteLayer
            .spawn(part.file, pos, {
              size: part.size ?? 2.4,
              life: part.life ?? 0.6,
              lift: part.lift,
              frames: part.frames,
              fps: part.fps,
              tint: part.tint ?? 0xffb359,
              /*
               * 淡出曲线照源码：`alpha = _impactFlashFramesRemaining / 16`
               * —— 从第一帧就**线性衰减**，不是「亮满再灭」。
               * 早先写成 `fadeIn 0.06 / fadeOut 0.55`，前 45% 生命期都满亮度，
               * 4 层加色叠起来就成了一坨纯白（分不清是爆炸还是过曝）。
               */
              fadeIn: 0.04,
              fadeOut: 0.9,
            })
            .catch(err => console.warn(`[skill] ${label} 爆闪生成失败`, err));
          return;
        }

        if (part.kind === 'model') {
          void effects
            .spawn(modelName(part.file), pos, {
              // 源码语义：模型按自己单位画，不按包围盒缩到多少米
              scale: part.scale ?? 1,
              /*
               * 朝向：`CreateEffect` 的第 3 个实参是**角度**（`(float*)(o + 28)`）。
               *
               * 但这里不能直接传 `caster.yaw`：特效模型的角度约定是「**0 = +X**」
               * （`Laser01.bmd` 的包围盒中心在本地 +X 0.92 m、`Blast01`/`Magic02` 在 +Y），
               * 而 `caster.yaw` 是给**角色** BMD 用的，里面带了 `MODEL_YAW_OFFSET(π/2)`
               * （角色模型本地朝 -Y）。所以要用 MU 世界角度 `atan2(dy, dx)`：
               * 直接传 `caster.yaw` 会整体**多转 90°**，极光/爆炎/激光就打到侧面去了。
               */
              yaw: caster.yaw - MODEL_YAW_OFFSET,
              // 源码 `+0x33`；没登记的类型用 0.3（EffectLayer 的默认值）
              speed: part.speed,
              life: part.life,
              lift: part.lift,
              spin: part.spin,
              // 源码轨迹：陨石从离地 4 m 处以 -50 单位/帧 砸下来
              drop: part.drop,
              vel: part.vel,
              // 追踪弹：从落点直线飞到目标（源码 param_5=1 / param_6=Owner）
              // 落点高度默认取胸口 1.1 m；龙卷风这种贴地的用 `lift: 0`
              flyTo:
                part.homing && aim
                  ? { x: aim.x, y: aim.y, z: aim.z + (part.lift ?? 1.1) }
                  : undefined,
              /*
               * 追踪速度：源码龙卷风是**匀速推过去**（`MoveSpeed = 240` 单位/秒
               * = 2.4 m/s），而不是「固定 N 秒飞到」—— 目标远一点就变成飞弹。
               * 有 `flySpeed` 就按距离现算飞行时间。
               */
              flyTime:
                part.homing && part.flySpeed && aim
                  ? Math.max(0.2, Math.hypot(aim.x - pos.x, aim.y - pos.y) / part.flySpeed)
                  : part.flyTime,
            })
            // spawn 是异步的，失败时没人 await —— 不接住就是「点了没反应」且控制台干净
            .catch(err => console.warn(`[skill] ${label} 特效生成失败`, err));
        } else {
          void spriteLayer
            .spawn(part.file, pos, {
              size: part.size ?? 2.6,
              life: part.life ?? 0.8,
              ground: part.ground,
              lift: part.lift,
              // 火苗往上窜一点，地面法阵缓慢自转 —— 观感照原版
              rise: part.rise ?? (part.ground ? 0 : 0.18),
              spin: part.ground ? 0.7 : 0,
              frames: part.frames,
              fps: part.fps,
              tint: part.tint,
            })
            .catch(err => console.warn(`[skill] ${label} 贴图特效生成失败`, err));
        }
      };

      /*
       * `delay`：源码里有些件不是和技能同时出现，而是**某一帧**才生成
       * （244 的落地裂缝在 life==3 = 0.68 s）。放在这里而不是每个技能里写
       * `setTimeout`，是为了让 `parts` 与实际生成的东西**一一对应** ——
       * 探针按 parts 数件数，凭空多/少一件都会红。
       */
      if (part.delay) {
        window.setTimeout(() => {
          for (let i = 0; i < part.count; i++) spawnOne(i);
        }, part.delay * 1000);
      } else {
        for (let i = 0; i < part.count; i++) spawnOne(i);
      }
    }
}

/**
 * 放一个技能。
 *
 * 顺序照 MU 的手感来：**动作先起、特效跟手**。
 *   1. 转向目标 → 播技能动作；
 *   2. 几十毫秒后逐件生成特效，落点按源码给的锚点算；
 *   3. 目标播受击动作 + 飘伤害数字，0.8 秒后回待机。
 *
 * ── 数据从哪来 ─────────────────────────────────────────────────────
 * `castOf(skill)` 已经在 `src/data/skillFx.ts` 里把**客户端源码**翻译好了：
 * 动作号（法师 82 / 战士特例 67·66·64）、特效件数与落点、有的还带 `homing`
 * （源码 `CreateEffect(..., param_5=1, param_6=Owner)` = 追踪弹道）。
 * 这里只负责「把 parts 变成场景里的东西」，不再猜模型。
 *
 * 尺寸/速度这类纯观感参数仍然来自 `SKILL_FX`（`src/data/skills.ts`），
 * 它决定「多大、多快」，不影响「放什么」。
 *
 * 伤害没有真实战斗系统，只是拿 `skill.bmd` 里的 `Damage` 百分比折算一个数字，
 * 让「放了技能」有反馈。命中判定/减血/死亡都不在这里。
 */
async function castSkill(skill: SkillEntry) {
  if (!player || !world) return;
  if (playerDead) {
    sandboxPanel.setHint('角色已死亡，复活后再放技能');
    return;
  }
  /*
   * 这里以前是 `if (castCd > 0) return;` —— **静默返回**。
   * 沙盘是「点一下看一次」的演示工具，连续点几个技能时 0.85 s 内的点击全被吞掉，
   * 面板没有任何反馈，看起来就像「这些技能没有特效」。
   * 演示不需要战斗节流，只留一个极小值防止同一帧重复触发。
   */
  castCd = 0.05;

  const spec = castOf(skill);
  const fx = skill.fx;
  /*
   * 有没有「打出去」的特效：
   *   - 源码把 buff/召唤/治疗挂在目标身上，但 `SELF_CAST` 已经把它们改成落自己；
   *   - 追踪弹（火球）虽然**起点**在自己身上，但它要飞到目标那儿 ——
   *     也算「有目标」，否则玩家不会贴过去、伤害也不会结算。
   */
  const homing = spec.parts.some(p => p.homing);
  const noVisual = spec.source === 'none';
  /*
   * 源码里没有视觉的技能（地裂斩/牙突刺…）：仍然要贴到目标面前、打伤害，
   * 只是不生成特效 —— 所以这里不能按「没有 target 件」判成 atSelf。
   */
  const hasTargetPart =
    homing || spec.parts.some(p => p.anchor === 'target' || p.anchor === 'targetGround');
  const atSelf = noVisual ? false : !hasTargetPart || fx?.at === 'self';
  const target = atSelf ? null : skillTarget;

  /* 1. 打靶子的技能：贴身 + 转身（靶子离出生点 50 多格，不贴过去什么都看不见） */
  if (target) {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 3.2) {
      const ux = dx / (dist || 1);
      const uy = dy / (dist || 1);
      const px = THREE.MathUtils.clamp(target.x - ux * 2.6, 1.5, 254.5);
      const py = THREE.MathUtils.clamp(target.y - uy * 2.6, 1.5, 254.5);
      player.x = px;
      player.y = py;
      player.z = world.terrain.getHeight(px + 0.5, py + 0.5);
      resetMoveTracking(px, py);
      // 相机平滑是 lerp：给一个大 dt 让它一次到位，否则会从出生点飞半个地图过来
      muCamera.setTarget(px, py, player.z);
      muCamera.update(1.5);
    }
    player.yaw = Math.atan2(target.y - player.y, target.x - player.x) + MODEL_YAW_OFFSET;
  }

  /* 2. 施法动作（`action < 0` = 源码没给，按当前武器算挥砍） */
  const act = spec.action >= 0 ? spec.action : attackAction(animInput(), attackCombo++);
  player.play(act, false);

  /* 3. 延迟出特效（时间是毫秒，跟着角色挥手的节奏） */
  window.setTimeout(() => {
    const me = player;
    if (!me) return;
    /*
     * 靶子**照给**，不再按 `atSelf` 抹掉。
     *
     * `atSelf` 原本是「要不要跑过去打」的判定（技能 8 龙卷风的源码相位是
     * `self`，不用跑），但**特效本身仍然需要目标**：`ScrollOfTwisterEffect`
     * 会把风暴朝 `TargetPosition` 匀速推过去。以前这里跟着 `atSelf` 一起抹成
     * null，龙卷风就永远留在施法者脚下。
     * 现在每件特效自己决定用不用 —— `fxAnchor` 只看自己的 `anchor`，
     * `aim` / `homing` 也是显式标志，不会误伤其他技能。
     */
    const t = skillTarget;
    let seed = 0;

    /*
     * 弓箭类技能（24 多重箭 / 51 冰封箭 / 52 穿透箭）在源码里走的是
     * `CreateArrows`（投射物实体），不是原地特效：
     *
     *   case 24 → CreateArrows(..., Skill=1) → **三连**（中心 + ±8°）
     *   case 51/52 → CreateArrows(..., Skill=51/52) → 单箭
     *
     * 所以这里**不再**用 `SKILL_FX` 兜底的那个 Arrow 模型（它是"一坨飞过去"），
     * 而是真的放箭；放完直接 return，避免同时出现两份。
     */
    if (BOW_SKILLS.has(skill.id)) {
      const dest = t
        ? { x: t.x, y: t.y, z: t.z + 1.1 }
        : { x: me.x + Math.sin(me.yaw) * 3, y: me.y - Math.cos(me.yaw) * 3, z: me.z + 1.1 };
      shootArrows(skill.id === 24 ? 3 : 1, dest);
      // 冰封箭（51）：源码 case 0x33 会往目标身上挂两件 Ice01
      if (skill.id === 51) spawnIceArrowHit(dest);
      return;
    }

    playCastParts({ spec, caster: me, aim: t, label: skill.name });

    if (!t) return; // 纯自身技能：只有光效
    if (fx?.noDamage) return;

    // 追踪弹要飞 0.32 s 才命中，伤害数字等它到了再飘
    const hitAt = homing ? 320 : 0;
    window.setTimeout(() => {
      t.play(MONSTER_ACTION.SHOCK, false);
      const dmg = 12 + Math.round((skill.damage || 10) * (0.8 + Math.random() * 0.5));
      damageTexts.spawn(
        { x: t.x, y: t.y, z: t.z + 1.9 },
        String(dmg),
        skill.damage >= 60 ? 'crit' : ''
      );
      window.setTimeout(() => t.play(MONSTER_ACTION.STOP, true), 700);
    }, hitAt);
  }, fx?.delay ?? 240);

  // 面板提示：来源（源码/兜底/无视觉）+ 动作号，方便对照客户端
  const tag = fxTag(skill.id);
  const how = spec.action >= 0 ? `动作 ${spec.action}` : '挥砍动作';
  const fxPart = noVisual ? '无特效（源码只有动作）' : `${tag}(${spec.parts.length} 件)`;
  sandboxPanel.setHint(
    `${skill.name}${atSelf ? ' · 自身' : ` → ${target?.name ?? ''}`} · ${skill.mana} MP · ` +
      `${fxPart} · ${how}`
  );
}

sandboxPanel.onCast = skill => void castSkill(skill);

/* ------------------------------------------------------------------ */
/* 输入                                                                */
/* ------------------------------------------------------------------ */
/**
 * 移动上报（对齐服务端 `CGMoveRecv` 的真实语义）。
 *
 * 服务端收到 0x10 后做的是：
 *   PathX[0] = 包里的 x,y
 *   PathCount = (path[0] & 0x0F) + 1
 *   逐字节拆方向 → PathX[1..count]
 *   TX/TY = 最后一个节点，X/Y 直接改成包里的 x,y
 * 也就是说它**不逐格校验**，只在收包时检查终点格的 attr 和 ±15 范围。
 *
 * 所以正确的上报方式是「一段连续步序」：
 *   sentCell = 服务端当前认为我们所在的格
 *   outSteps = 已经走过、还没上报的方向序列
 * 一次最多塞 8 步（path[1..4]，每字节两步），走满 8 步再发下一段。
 * 逐格单步发不仅包多，还会因为服务端 100ms 的收包间隔被丢掉。
 */
/** 服务端认为我们所在的格（下个包的起点） */
let sentCell = { x: -1, y: -1 };
/** 已走过但没上报的方向序列 */
let outSteps: number[] = [];
/** 本地实际所在格（floor），用来检测「跨格」这件事 */
let lastCell = { x: -1, y: -1 };
/** 服务端要求两次移动包间隔 >= 100ms，留点余量 */
const MOVE_SEND_INTERVAL = 120;
let lastSendAt = 0;
/** 调试：最近发出的移动包 / 收到的回显 */
const sendLog: string[] = [];
const echoLog: string[] = [];

const keys = new Set<string>();

/** 寻路结果（格子序列，不含起点） */
let movePath: Cell[] = [];
let pathCursor = 0;
/** 每帧刷新的「被单位占用的格子」集合，key = (y << 8) | x */
let blockedCells = new Set<number>();
/** 追击时重算路径的节流 */
let lastRepathAt = 0;
/** 当前寻路目标（被挡住时用来重算，避免玩家要再点一次） */
let moveGoal: Cell | null = null;
/** 被完全挡住持续了多久 */
let stuckTimer = 0;
/** 调试：上一次路径被清空的原因 */
let moveClearReason = '';
/** 占位集合的刷新节流（实体不会每帧都换格） */
let blockedTimer = 0;
let rotating = false;
let lastPointer = { x: 0, y: 0 };

/**
 * 把积压的步序发给服务端。
 * @param force 忽略「至少攒几步」的判断（仍受 120ms 间隔限制）
 */
function flushMoves(force = false) {
  // connected 必须查：socket 断掉后 connection 对象还在，
  // 但 send 会抛「连接未建立」，而抛错会跳过下面的 outSteps.splice，
  // 队列永远清不掉 → 每帧抛一次，控制台瞬间刷满。
  if (!loggedIn || !connection || !connection.connected) {
    outSteps.length = 0;
    return;
  }
  if (sentCell.x < 0) return;
  if (!force && outSteps.length === 0) return;

  const now = performance.now();
  if (now - lastSendAt < MOVE_SEND_INTERVAL) return;
  // 服务端 path[0] 的低 4 位最多放 8 步
  const n = Math.min(outSteps.length, 8);
  if (n === 0) return;

  const dirs = outSteps.slice(0, n);
  connection.send(buildMovePacket(sentCell.x, sentCell.y, dirs));
  sendLog.push(`${sentCell.x},${sentCell.y}[${dirs.join('')}]`);
  if (sendLog.length > 40) sendLog.shift();

  for (const d of dirs) {
    sentCell.x += DIR_VECTORS[d][0];
    sentCell.y += DIR_VECTORS[d][1];
  }
  outSteps.splice(0, n);
  lastSendAt = now;
}

/**
 * 跨进一个新格子：把这一步记进上报队列。
 *
 * 一次可能跨多格（帧长时间或速度调整），逐格补齐，保证服务端的
 * PathX 链和本地实际走过的格完全一致。
 */
/**
 * 耐力计数器（原版 `c+0x300`，0..0x28 = 0..40）。
 *
 * 0.97 的"体力"不是服务端字段（`PMSG_CHARACTER_INFO_SEND` 里没有），
 * 而是**客户端本地的冲刺计数**：
 *   - `SetPlayerStop` 进来先 `stamina = 0`（一停就恢复）；
 *   - `SetPlayerWalk` 每 tick：安全区清零；否则未满 0x28 时按条件 +1；
 *   - 用它的地方：`stamina < 0x28` 才跑（走/跑的切换），以及亚特兰蒂斯游泳
 *     `21`（正常）↔ `29`（力竭）。
 *
 * 我们没有跑/走的区分（一直用走路动作），所以这里按"每跨一格 +1"推进，
 * 唯一的可见差异就是游泳的水花会变成力竭版。
 */
let stamina = 0;
const STAMINA_MAX = 0x28;

function onEnterCell(cx: number, cy: number) {
  if (lastCell.x < 0) {
    lastCell = { x: cx, y: cy };
    return;
  }
  // 走一格 +1 耐力（安全区里站住就清，和原版一致）
  if (player && isSafeZoneAt(player.x, player.y)) stamina = 0;
  else if (stamina < STAMINA_MAX) stamina++;

  // 脚步：原版是从**模型自带的脚步表**取（`DAT_05828d58 + 0xb2 + type*0xbc`），
  // 那张表不在反编译源码里，这里按地面材质近似：地牢/塔/血堡用土，其余用草。
  stepSound();
  let guard = 0;
  while ((lastCell.x !== cx || lastCell.y !== cy) && guard++ < 16) {
    const sx = Math.sign(cx - lastCell.x);
    const sy = Math.sign(cy - lastCell.y);
    outSteps.push(dirFromDelta(sx, sy));
    lastCell = { x: lastCell.x + sx, y: lastCell.y + sy };
  }
  flushMoves();
}

/** 重置上报状态（进图 / 重生 / 服务端纠偏） */
function resetMoveTracking(x: number, y: number) {
  // 入参是格号（服务端/传送给的整数），round 与 floor 等价，但语义统一
  const cx = Math.round(x);
  const cy = Math.round(y);
  sentCell = { x: cx, y: cy };
  lastCell = { x: cx, y: cy };
  outSteps = [];
  lastSendAt = 0;
}

/* ------------------------------------------------------------------ */
/* 占位与寻路                                                          */
/* ------------------------------------------------------------------ */
/**
 * 刷新「被单位占用的格子」。
 *
 * 地形本身只标了墙/悬崖（`TW_NOMOVE | TW_NOGROUND`），NPC、怪物、其他玩家
 * 是动态占位：客户端 `PATH::FindPath` 把它们写进 walkmap，寻路时当作障碍。
 * 数量不多（视野内几十个），每帧重建一个 Set 足够。
 */
function refreshBlocked() {
  const set = new Set<number>();
  // 远程实体统一走 blockerCells：它和模型解耦，守卫/传送门这类
  // NO_MODEL_CLASSES 也会挡路；用的是服务端下发的目标格，不是插值中的浮点位置
  for (const b of remotes.blockerCells()) {
    set.add((Math.floor(b.y) << 8) | Math.floor(b.x));
  }
  for (const m of monsters) {
    set.add((Math.floor(m.y) << 8) | Math.floor(m.x));
  }
  blockedCells = set;
}

/** 只问地形：墙 / 悬崖 / 水面之外都算可走 */
function terrainWalkable(tx: number, ty: number) {
  if (!world) return false;
  /*
   * 边界交给 `terrain.isWalkable`（它自己按 0..254 判），这里**不要**再加一层。
   *
   * 之前写的是 `tx < 1 || ty < 1` —— 把地图最外一圈（x=0 / y=0）整条封死。
   * 服务端是允许站在那一格上的（`.att` 里也可走），所以站在边上想往旁边走一格
   * （例如 `0,1 → 0,2`）会被判「不可走」，人一动不动，只有落点标记画出来。
   */
  return world.terrain.isWalkable(tx + 0.5, ty + 0.5);
}

/** 只问单位：NPC / 怪物 / 其他玩家占着这一格 */
function unitBlocked(tx: number, ty: number) {
  return blockedCells.has((ty << 8) | tx);
}

/** 该格能不能站：地形可走 + 没有单位占位 */
function canStand(tx: number, ty: number) {
  return terrainWalkable(tx, ty) && !unitBlocked(tx, ty);
}

/* ------------------------------------------------------------------ */
/* 点击诊断                                                            */
/* ------------------------------------------------------------------ */
/**
 * 最近若干次「点地面」的决策记录。
 *
 * 「点了地面人不动」可能断在四五个地方（点到 UI 面板、射线没打到地面、
 * 目标格不可站、A* 不连通、单帧位移被判不可进），光看截图看不出来。
 * 这里每一步留一行，探针和用户都能用 `__MU_APP__.clickLog()` 捞出来。
 */
const clickLog: string[] = [];
function logClick(entry: string) {
  clickLog.push(entry);
  if (clickLog.length > 30) clickLog.shift();
}
/** `walkToCell` 上一次失败的原因（成功时清空） */
let walkFail = '';
/**
 * 角色「现在在哪一格」。
 *
 * 坐标系只有一套，但要分清楚两个量：
 *   - `player.x` = **格号坐标的浮点**（静止时是整数，例如 133 = 第 133 格）
 *   - 渲染位置 = `player.x + 0.5`（世界坐标的格心，133.5）
 *
 * 所以「所在格」必须 `round(player.x)`，等价于 `floor(player.x + 0.5)`。
 * 之前这里用的是 `floor(player.x)` —— 视觉上已经踩过格线（133.5 → 世界 134.0）
 * 时它还认为在第 133 格，于是**跨格判定、上报服务端的 PathX、贴墙阻挡全都晚半格**。
 * 这就是 +0.5 改造留下的唯一后遗症：路线算法没变，但「哪一格」的判断整体错位半格。
 */
function playerCellX() {
  return player ? Math.round(player.x) : 0;
}
function playerCellY() {
  return player ? Math.round(player.y) : 0;
}
/** 卡住自检：上一次采样位置 / 时间 / 已自救次数 */
let stuckWatch: { x: number; y: number; t: number; tries: number } | null = null;

/**
 * 走到某一格。用 A* 绕开墙和 NPC，而不是直着怼上去。
 *
 * 起点取「实际所在格」而不是 `round(player.x)`：移动中重新点目标时，
 * round 会先把角色往回流半格，看着像卡了一下。
 */
function walkToCell(tx: number, ty: number, force = false) {
  if (!world || !player) return false;
  /*
   * 入参统一成「世界坐标」。
   *
   * 点击过来的本来就是世界坐标（格心是 x.5），但调试口 / 跟随 NPC / 跟随物品
   * 这几条路传的是**格号**（整数）。整数当世界坐标会被理解成格子左上角，
   * 于是「点自己这一格」的方向判定会歪向 +x+y。这里把整数补回格心
   * （floor 结果不变，格子不会选错）。
   */
  if (Number.isInteger(tx) && Number.isInteger(ty)) {
    tx += 0.5;
    ty += 0.5;
  }
  refreshBlocked();
  blockedTimer = 0;

  // 取格用 floor：点击传进来的是世界坐标，点在格中心是 x.5，
  // 用 round 会偏向 x+1 —— 格的归属和玩家、实体的 floor 口径就不一致了。
  const gx = Math.floor(tx);
  const gy = Math.floor(ty);
  const sx = lastCell.x >= 0 ? lastCell.x : playerCellX();
  const sy = lastCell.y >= 0 ? lastCell.y : playerCellY();

  /*
   * 目标格怎么定：
   *
   *   1. 点中的格自己能站 → 就是它（绝大多数点击走这条）。
   *   2. 地形能走、只是被单位占着（NPC / 怪 / 别人）→ 走到旁边最近的空格。
   *   3. 地形本身不能走（墙里 / 水里 / 建筑里）→ **什么都不做**。
   *      原版客户端也是点了没反应；以前这里会退到「附近某格」，经常
   *      选到身后那一格，看起来像「点前面、人往后退」。
   *
   * 另外 `nearestFree` 不能再把「自己脚下」当成备选：以前点墙边那块地，
   * 它会返回原地，于是目标 == 自己 → 直接 return false，
   * 玩家看到的就是「点了地面完全没反应」。
   */
  const isSelf = (x: number, y: number) => x === sx && y === sy;
  const free = (x: number, y: number) => canStand(x, y) && !isSelf(x, y);
  let dest: Cell | null = null;
  if (canStand(gx, gy)) dest = { x: gx, y: gy };
  else if (terrainWalkable(gx, gy)) {
    // 被单位占着：优先停在**自己这一侧**的空格（否则会绕到对方的背面，
    // 界面上就是「点第二格、圆圈却画在第三格」）
    const me = { x: playerCellX(), y: playerCellY() };
    dest = nearestFree(gx, gy, free, 2, me) ?? nearestFree(gx, gy, free, 3, me);
  }
  if (!dest) {
    walkFail = `blocked(${gx},${gy})`;
    return false;
  }

  /*
   * 点中的就是「自己脚下这一格」怎么办？
   *
   * 一格在屏幕上约 72px，角色自己站在格心，所以脚下 36px 半径内**全算自己这格**。
   * 实机反馈的「点地面连点都不行」大多落在这里：玩家点到角色身上/脚边，
   * 换算出来的格号还是自己那格，旧逻辑直接 return false —— 一点反馈都没有。
   * （对过 clickLog：click 屏幕 (870,635) → 世界 (139.47,134.39)，正是脚下。）
   *
   * 现在按「点击点相对脚下的方向」迈一步：
   *   - 离脚下 < 0.15 格 → 真的点在自己身上，什么都不做（原版也没反应）；
   *   - 否则取 8 方向里最接近的那个邻格走过去 —— **点哪都能走**。
   */
  if (dest.x === sx && dest.y === sy) {
    const vx = tx - player.wx;
    const vy = ty - player.wy;
    const len = Math.hypot(vx, vy);
    if (len < 0.08) {
      walkFail = 'self';
      return false;
    }
    const s = Math.max(Math.abs(vx), Math.abs(vy));
    const nx = Math.round(vx / s);
    const ny = Math.round(vy / s);
    // 主方向优先，被占/撞墙时再试同侧的两个斜向
    const tries: [number, number][] = [
      [nx, ny],
      [nx, 0],
      [0, ny],
    ];
    for (const [ox, oy] of tries) {
      if (!ox && !oy) continue;
      const cx = sx + ox;
      const cy = sy + oy;
      if (!canStand(cx, cy)) continue;
      dest = { x: cx, y: cy };
      break;
    }
    if (dest.x === sx && dest.y === sy) {
      walkFail = `self-blocked(${gx},${gy})`;
      return false;
    }
  }

  // 同一个目标还有路在走 → 保留，别每次点击都从头算。
  // force 用于「路上新出现占位」的场景：目标没变，但旧路径已经不能走了。
  if (!force && moveGoal && moveGoal.x === dest.x && moveGoal.y === dest.y && movePath.length > 0) {
    walkFail = '';
    return true;
  }

  // 走到这一步 dest 一定不是脚下这一格（上面已处理过）
  if (dest.x === sx && dest.y === sy) {
    walkFail = 'self';
    return false;
  }

  const path = findPath(sx, sy, dest.x, dest.y, canStand, undefined, unitBlocked);
  // 空数组 = 起点就是终点（上面那层已经挡过一次，这里兜底）
  if (!path || path.length === 0) {
    walkFail = `nopath(${sx},${sy}->${dest.x},${dest.y})`;
    return false;
  }

  movePath = path;
  pathCursor = 0;
  moveGoal = dest;
  stuckTimer = 0;
  walkFail = '';
  // 「先转身，再走过去」：路径一成立就把朝向掰到第一格
  faceToward(path[0].x, path[0].y);
  return true;
}

/**
 * 朝向某一格（瞬转）。
 *
 * 原版服务端收到移动包就直接改 `lpObj->Dir`，muonlinejs 也是每帧
 * `rot.y = atan2(vel)` —— 都是**瞬间**转身。之前这里是 `yaw += delta*dt*28`
 * 慢慢转：点身后那一格时人已经迈步了、身子还没转过来，看着像倒退着滑，
 * 而且第一帧的位移方向和新朝向对不上，探针里表现为「没走」。
 */
function faceToward(cx: number, cy: number) {
  if (!player) return;
  const dx = cx - player.x;
  const dy = cy - player.y;
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return;
  player.yaw = Math.atan2(dy, dx) + MODEL_YAW_OFFSET;
}

/* ------------------------------------------------------------------ */
/* 攻击                                                                */
/* ------------------------------------------------------------------ */
/**
 * 头顶名字再往上留多少（世界单位）。
 *
 * 蒙皮包围盒的 max.z 就是模型最高点（头盔尖/发梢），再留 0.22 ≈ 13px 的空隙，
 * 名字才像「浮在头顶」而不是「压在头上」。这个数是拿像素对出来的（见
 * `tools/head-pixel.mjs`）：差值落在 6~10px 之间，和实机截图的比例一致。
 */
const HEAD_TOP_PAD = 0.22;

/** 服务端的攻击距离校验是 3 格（Attack.cpp: distance > 3 → return） */
const ATTACK_RANGE = 2.9;
/** 两次攻击的最小间隔（服务端有封包频率校验，别打太快） */
const ATTACK_COOLDOWN = 0.45;

let attackCd = 0;
/** 上一次播放的攻击动作（0..）与连击计数（原版的 `c+771`） */
let lastAttackAction = 0;
let attackCombo = 0;
/** 角色死亡中：服务端会拒绝一切移动/攻击，本地也要锁住 */
let playerDead = false;
/** 点远处怪物时先走过去，进距离后自动开打 */
let pendingTargetId = -1;
/**
 * 自动连续攻击的目标（原版 `m_bAutoAttack` + `Attacking == 1`）。
 *
 * `Player_InputTick.cpp` 里那段注释把条件写得很清楚：
 *
 *   ```
 *   bAutoAttackGoOn = m_bAutoAttack && World != 6 && Attacking == 1
 *   if (SelectedCharacter > -1 && (bClickEdge || bClickHeld || bAutoAttackGoOn)) { …攻击… }
 *   ```
 *
 * 也就是说**点一下怪物就够了**：只要目标还活着、`Attacking` 还是 1，
 * 每帧都会再走一遍攻击逻辑（节拍由动画本身控制，不是靠按住鼠标）。
 * 以前我们只在点击那一帧打一下，所以要一直点 —— 实机手感就是「打不动」。
 */
let autoAttackId = -1;
/** 当前锁定的目标（HUD 用） */
let focusId = -1;

const projTmp = new THREE.Vector3();

/**
 * 屏幕坐标 → 怪物 id。
 *
 * 判定交给 `remotes.pickAt`（对模型做真射线求交）。以前这里是「投影点
 * 70px 以内就算点中」，1600×900 下 70px ≈ 1.7 格 —— 怪身边两格的地面
 * 全被吃掉，点地面变成打怪，人自然不走（实机反馈的「地面点不动」）。
 */
function pickMonsterAt(clientX: number, clientY: number): number | null {
  if (!world || !player) return null;
  return remotes.pickAt(muCamera.camera, clientX, clientY, canvas.getBoundingClientRect(), 'monster');
}

/**
 * 当前动作是不是「攻击中」—— 34..55 是空手/各武器/守护的攻击段，
 * 81 = 431 特殊双手剑，84/85 = 长柄双手。跑动和待机不能打断它们。
 */
/**
 * 「正在出手」= 主循环不要用待机动作覆盖它。
 *
 * 0.97 的动作号分段（见 `PlayerAction` 注释 + `PacketHandler_0x19`）：
 *   34..55  各武器挥砍（`SetPlayerAttack`）
 *   56..67  技能动作：56..59 战士四连、60 天地十字剑另一套、63 生命之光、
 *           64/65 流星焰、66/67 钻云枪/袭风刺
 *   81      天雷闪（Power Slash）
 *   82..85  施法（`SetPlayerMagic` 的 0x52+rand%2，以及 84/85）
 *
 * 少一段就会出现「点了 Cast，下一帧被待机动作顶掉」——82/83 当初就是这么丢的，
 * 56..67 也踩过同一个坑（天雷闪、地裂斩都一帧看不见）。
 */
function isAttacking(): boolean {
  if (!player || player.finished) return false;
  const a = player.action;
  return (a >= 34 && a <= 67) || (a >= 81 && a <= 85);
}

/**
 * 发起一次攻击。
 * 服务端只校验「目标在 3 格内」，所以太远时先走过去（pendingTargetId），
 * 走近后由主循环自动补一刀。
 *
 * 动作号不是写死的 —— 原版 `SetPlayerAttack` 按武器模型号挑（空手 34、
 * 单手剑 35/36、双手剑 39..41、弓 46、弩 47、带翅膀的弓 48…），
 * 这个号还会随 0x15 包发给服务端，别人看到的就是它。
 */
function tryAttack(targetId = -1) {
  if (!player || !world || attackCd > 0 || playerDead) return;
  /*
   * 安全区：原版 `Attack()` 的第一道门禁直接 return，连空挥动作都不播。
   * 放在最前面 —— 后面会 `player.play()` 并给服务端发 0x11/0x15。
   */
  if (loggedIn && !sandbox.on && safeZoneBlocksCombat(0)) {
    warnSafeZone();
    return;
  }
  restAction = 0; // 出手就把坐姿顶掉

  const target =
    targetId >= 0 ? remotes.get(targetId) : remotes.nearestMonster(player.x, player.y, ATTACK_RANGE);

  if (!target) {
    // 空挥（没有目标也要有动作反馈），只在联机时不上报
    if (player.finished || player.action !== lastAttackAction) {
      lastAttackAction = attackAction(animInput(), attackCombo++);
      player.play(lastAttackAction, false);
      attackCd = ATTACK_COOLDOWN;
    }
    return;
  }

  const dist = Math.hypot(target.tx - player.x, target.ty - player.y);
  if (dist > ATTACK_RANGE) {
    // 太远：记下来，先走位
    pendingTargetId = target.id;
    return;
  }

  pendingTargetId = -1;
  focusId = target.id;

  const dx = target.tx - player.x;
  const dy = target.ty - player.y;
  const yaw = Math.atan2(dy, dx) + MODEL_YAW_OFFSET;

  player.yaw = yaw;
  lastAttackAction = attackAction(animInput(), attackCombo++);
  player.play(lastAttackAction, false);
  attackCd = ATTACK_COOLDOWN;

  /*
   * 挥砍音（`eSwingWeapon1/2`、`eSwingLightSword`、`eBow`、`eCrossbow`）。
   * 原版按武器模型挑（41..47 的几段 case），这里按「有没有远程武器 / 有没有翅膀」
   * 粗分：弓 0x41、弩 0x42、普通 0x28/0x29 交替、光剑（翅膀跑）0x2a。
   */
  if (isRangedWeapon()) sfx(0x41, { volume: 0.6 });
  else sfxRandom([0x28, 0x29], { volume: 0.6 });

  /*
   * 弓 / 弩的普攻在客户端源码里是**投射物**（`MoveCharacter` 里动作 46..49/54/55
   * 时调 `CreateArrows`），不是原地特效。以前这里只有拉弓动作 + 服务端回的伤害
   * 数字，箭是凭空出现的 —— 精灵玩家最直观的「不对」就是这个。
   * 延迟 120 ms 等拉弓动作起手，再让箭离手。
   */
  if (isRangedWeapon()) {
    const tx = target.tx + 0.5;
    const ty = target.ty + 0.5;
    const tz = (world ? world.terrain.getHeight(tx, ty) : 0) + 1.1;
    window.setTimeout(() => shootArrows(1, { x: tx, y: ty, z: tz }), 120);
  }

  if (loggedIn && connection?.connected) {
    const dir = dirFromDelta(Math.round(dx), Math.round(dy));
    connection.send(buildAttackPacket(target.id, lastAttackAction, dir));
  }
}

// 服务端纠正位置时（撞墙/瞬移），本地跟着走，别让两边越差越远
const selfMoveLog: string[] = [];
remotes.onSelfMove = (x, y, dir, authoritative) => {
  if (!player) return;
  // 0x10 是服务端**接受**上行包后的广播：(x,y) = 它算出来的终点，dir<<4。
  // 坐标本身是对的，但一条 0x10 对应我刚发的那一包 ——
  // 连续发几包时它们会依次到达，每搬一次就打断当前路径（表现为「往回拽」）。
  // 所以这里只记录，不搬人；真正的硬纠偏只有 0x11（包被拒时 gObjSetPosition 发的）。
  if (!authoritative) {
    echoLog.push(`${x},${y}`);
    if (echoLog.length > 40) echoLog.shift();
    return;
  }

  // 服务端下发的就是格号，直接落整数（不再补 0.5 到格心）
  const wx = x;
  const wy = y;
  const d = Math.hypot(wx - player.x, wy - player.y);
  selfMoveLog.push(
    `纠偏 ${x},${y} Δ${d.toFixed(2)} last=${lastCell.x},${lastCell.y} ` +
      `sent=${sentCell.x},${sentCell.y} out=${outSteps.length}`
  );
  if (selfMoveLog.length > 30) selfMoveLog.shift();
  if (d < 0.6) return;

  player.x = wx;
  player.y = wy;
  player.z = world?.terrain.getHeight(wx, wy) ?? player.z;
  resetMoveTracking(wx, wy);

  /*
   * 服务端纠偏之后**别把玩家刚点的目标扔掉**。
   *
   * 以前这里是「清空路径 + 清空目标」：服务端偶尔拒掉一步（节流、贴墙、
   * 单位占位判定不一致都会拒），客户端收到的 0x11 就把刚点好的路清掉了 ——
   * 实机上就是「点了地面，人走半步又停住 / 完全没动」。
   *
   * 现在：纠偏幅度不大（< 1.5 格，属于「挪回一格」级别）且还有目标，
   * 就按新位置重新规划同一目标；只有大幅度瞬移（传送/重生）才真的清空。
   */
  if (moveGoal && d < 1.5) {
    const goal = { ...moveGoal };
    movePath = [];
    pathCursor = 0;
    moveGoal = null;
    walkToCell(goal.x, goal.y, true);
    logClick(`server-fix ${x},${y} Δ${d.toFixed(2)} → 重算到 ${goal.x},${goal.y}`);
    return;
  }

  movePath = [];
  pathCursor = 0;
  moveGoal = null;
  logClick(`server-fix ${x},${y} Δ${d.toFixed(2)} → 清空目标`);
  void dir;
};

remotes.onCountChange = (players, monsters) => {
  statEnts.textContent = `玩家 ${players} · 怪物 ${monsters}`;
};

/*
 * 视野包里带的状态位：进视野时身上已有的 buff 直接按它建，
 * 离开视野（0x14）时 remote 会回调 `mask = 0`，视觉跟着删。
 */
remotes.onSkillState = (id, mask) => {
  // 只加不减：原版对 `ViewSkillState` 只做 state=1，从不因它清位
  buffLayer.add(id, mask);
};
remotes.onEntityGone = id => buffLayer.clear(id);

/* 服务端下发的伤害 → 飘字；死亡 → 经验 */
remotes.onDamage = hit => {
  // damage 为 0 时不飘字（服务端对完全吸收/自己挨打会发 0，显示「-0」很怪）
  if (hit.damage <= 0) return;
  const cls = hit.type === 0x10 ? 'crit' : '';
  // 服务端的 x/y 是格号，飘字要落在格心（和角色渲染位置一致）
  damageTexts.spawn({ x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z }, String(hit.damage), cls);

  /*
   * 打击音：短击 `eShortBlow1..3`(0x32..0x34) / 重击 `eBlow1..4`(0x35..0x38)。
   * 这两组在表里 `pos3d = false`（原版是 2D），但满场怪一起打会吵，
   * 所以这里按**离自己多远**手动压音量 —— 是对原版行为的一点让步，注释留底。
   */
  if (player) {
    const d = Math.hypot(hit.x - player.x, hit.y - player.y);
    const vol = Math.max(0.12, Math.min(1, 1 - d / 18));
    const heavy = hit.type === 0x10 || hit.damage > 120;
    sfxRandom(heavy ? [0x35, 0x36, 0x37, 0x38] : [0x32, 0x33, 0x34], {
      volume: vol * 0.7,
    });
  }

  /*
   * ── 受击动作 ────────────────────────────────────────────────────
   *
   * 以前这里只飘数字 + 放打击音，被打的怪**动作不变** —— 画面上像在「隔空扣血」。
   * 源码里受击动作由两条路给：
   *   - 怪物：动作组 `MONSTER_ACTION.SHOCK`（= 4，怪物 BMD 只有 0..5 组）
   *   - 玩家：`0x85 / 0x87 / 0x8B / 0x8C`（`PacketHandler_0x19` 的 case 0x03 会
   *     `SetPlayerStop(target)` 打断这四种「受击/后仰」动作）
   *
   * 播完回到待机；但如果中途被打断（换动作了）就不硬塞 STOP，
   * 否则会出现「正在走路却被按回站立」的抖动。
   */
  const hurt = remotes.get(hit.id);
  if (hurt && !hurt.dying) playHurtAction(hurt.actor, hurt.kind);
};

remotes.onDie = (id, experience) => {
  const e = remotes.get(id);

  /*
   * 经验累加 —— 原版在 `0x9C` 里就是一句 `CharacterAttribute+16 += Exp`
   * （`Net_Process.cpp:6153`）。服务端**不会**每杀一只怪就同步一次经验，
   * 它只在升级时用 `0xF3/05` 校正。所以这里自己加，经验条才会动。
   * 0x9C 是 `DataSend(aIndex)`，只有杀怪的那个人收得到，不会记错人。
   */
  if (experience > 0 && currentChar?.info) {
    const info = currentChar.info;
    info.experience = Math.max(0, (info.experience ?? 0) + experience);
    if (!info.nextExperience || info.nextExperience <= 0) {
      info.nextExperience = calcNextLevelExp(currentChar.level);
    }
    refreshHud();
  }
  // 死亡音：骷髅系 0x5d/0x5e，其余用「男声死亡」0x4e（0.97 只有男女两套
  // 玩家死亡音，怪物全靠模型自带的叫声表，那张表不在源码里）
  if (e) {
    if (e.kind === 'monster') sfxRandom([0x5d, 0x5e, 0x4e], { x: e.actor.wx, y: e.actor.wy, volume: 0.8 });
    else sfx(0x4e, { x: e.actor.wx, y: e.actor.wy, volume: 0.8 });
  }
  if (e && experience > 0) {
    damageTexts.spawn(
      { x: e.actor.wx, y: e.actor.wy, z: e.actor.z + 1.9 },
      `+${experience} EXP`,
      'exp'
    );
  }
  if (id === focusId) focusId = -1;
};

let lastHurtSoundAt = 0;
remotes.onSelfDamage = (damage, life) => {
  // 挨打时那三声惨叫（`pMaleScream1..3`）；0.97 就是男/女两套，
  // 我们不分性别，用男声，节流 1.2 秒（否则连击时会糊成一片）
  if (damage > 0 && performance.now() - lastHurtSoundAt > 1200) {
    lastHurtSoundAt = performance.now();
    sfxRandom([0x4b, 0x4c, 0x4d], { volume: 0.55 });
  }
  if (player && damage > 0) {
    damageTexts.spawn({ x: player.wx, y: player.wy, z: player.z + 2.0 }, `-${damage}`, 'hurt');
  }
  if (currentChar?.info && life >= 0) {
    currentChar.info.life = life;
    refreshHud();
  }
};

/* ------------------------------------------------------------------ */
/* 地面物品：拾取                                                       */
/* ------------------------------------------------------------------ */

const itemDebug = {
  last20: 0,
  lastGet: null as ReturnType<typeof parseItemGetResult>,
  picked: 0,
  failed: 0,
  /** 收到的 0x22 条数（解析失败也算），用来区分「没回包」和「包格式不对」 */
  recv22: 0,
  /** 最近一条 0x22 的原始字节 */
  raw22: [] as number[],
};

/**
 * 处理 0x22 回执。
 *
 * 服务端**不回传物品 id**，只回 result 和物品信息，
 * 所以只能靠 `pendingPickupId` 认领 —— 一次只捡一件，够用。
 * result 语义（`ItemManager.cpp::CGItemGetRecv`）：
 *   0xFF 失败、0xFE 拾到金币、0xFD 叠加成功、其它值是放进背包的槽位。
 */
function handleItemGetResult(pkt: Uint8Array) {
  const r = parseItemGetResult(pkt);
  if (!r) return;
  itemDebug.lastGet = r;

  const id = pendingPickupId;
  pendingPickupId = -1;
  pickupSentAt = 0;
  console.log(
    `[items] 0x22 result=0x${r.result.toString(16)} pending=${id} ` +
      `money=${r.money} item=${JSON.stringify(r.item)}`
  );

  if (!r.ok) {
    itemDebug.failed++;
    // 失败要放开标记，否则这件物品永远捡不动
    if (id >= 0) groundItems.markPicking(id, false);
    console.warn('[items] 拾取被拒 result=0x' + r.result.toString(16));
    return;
  }

  // 拾到东西了（`pGetItem` 0x1d）；金币（0xFE）用另一声 `pDropMoney`
  sfx(r.result === 0xfe ? 0x1f : 0x1d, { volume: 0.8 });

  // 没有待拾取目标 → 这不是拾取回执，而是 `GCMoneySend` 的主动金币同步
  // （Protocol.cpp:1669，同样用 0x22 + result 0xFE，带的也是玩家**总金币**）。
  // 两者唯一的区别就是有没有 pending，认错了会把别人的物品从地上删掉。
  if (id < 0) {
    if (r.result === 0xfe && currentChar?.info) {
      currentChar.info.money = r.money;
      lastMoneySyncAt = performance.now();
      refreshHud();
      if (player) {
        damageTexts.spawn(
          { x: player.x, y: player.y, z: player.z + 2.1 },
          `Zen ${r.money}`,
          'exp'
        );
      }
    }
    return;
  }

  if (id >= 0) groundItems.remove(id);
  itemDebug.picked++;

  if (r.result === 0xfe) {
    if (currentChar?.info) {
      currentChar.info.money = r.money;
      refreshHud();
    }
    if (player) {
      damageTexts.spawn(
        { x: player.x, y: player.y, z: player.z + 2.1 },
        `+${r.money} Zen`,
        'exp'
      );
    }
    return;
  }

  const name = r.item ? itemDisplayName(r.item.type) : '物品';
  const level = r.item && r.item.level > 0 ? ` +${r.item.level}` : '';
  if (player) {
    damageTexts.spawn(
      { x: player.x, y: player.y, z: player.z + 2.1 },
      `${name}${level}`,
      'exp'
    );
  }

  // 服务端只在**进图时**发 0xF3/0x10 全量背包，之后捡东西只回这条 0x22
  // （`result` 就是放进去的槽位号）。所以客户端要自己把它塞进本地背包，
  // 否则 UI 里永远是空的 —— 原版 `ReceiveItemGet` 也是这么干的。
  // 槽位是服务端编号（12..75 才是背包，0..11 是装备），这里不做换算。
  if (r.item && r.result < INVENTORY_SIZE) {
    addInventoryItem({
      slot: r.result,
      type: r.item.type,
      level: r.item.level,
      skill: false,
      luck: false,
      option: 0,
      durability: r.item.durability,
      excellent: 0,
    });
  }
}

/** 把一件东西并进本地背包快照并刷新面板 */
function addInventoryItem(item: InventoryItem) {
  inventoryItems = inventoryItems.filter(i => i.slot !== item.slot).concat(item);
  syncInventoryViews();
}

/**
 * 0x24 移动回执。本地已经在拖拽松手时乐观更新过了，所以这里只处理两种例外：
 *   1) 服务端拒绝 → 把刚才那一步倒回去
 *   2) 落点槽位和服务端算的不一致 → 以服务端为准
 *
 * 实测这台 0.97k 服务端**只接受背包内换位**（12..75 ↔ 12..75），
 * 背包→装备槽一律回 `result=0xFF` + 一条 0x2A 耐久包。
 * 原因在服务端二进制：`InventoryAddItem` 把装备槽（< 12）判进了背包分支，
 * 于是拿 `(slot - 12)` 算出负数坐标去 `InventoryRectCheck`，必然失败。
 * 客户端没问题（包体和原版 `SendRequestEquipmentItem` 逐字节一致），
 * 所以这里如实把物品放回去，并给用户一条可见提示，不做假象。
 */
function handleItemMoveResult(pkt: Uint8Array) {
  const r = parseItemMoveResult(pkt);
  if (!r) return;

  /*
   * 仓库的存/取走的是**同一个 0x24**，但两边的物品表不一样：
   * 服务端只回一个 result（落点格号），**不会**重发背包表或 0x31 仓库表。
   * 所以这里自己搬 —— 背包数组 + 仓库缓存各改一处，UI 全量重画。
   */
  /*
   * 交易格的搬运也用 0x24（`SourceFlag/TargetFlag = 1`），
   * 服务端只回一个 result + 落点 slot，物品表要客户端自己搬。
   */
  if (pendingTradeMove) {
    const op = pendingTradeMove;
    pendingTradeMove = null;
    if (!r.ok) {
      console.warn(`[trade] ${op.kind} 被拒 result=0x${r.result.toString(16)}`);
      chatBox.push('系统', op.kind === 'in' ? '放入失败（交易格已满？）' : '取回失败（背包已满？）', 1);
      return;
    }
    if (op.kind === 'in') {
      const item = inventoryItems.find(i => i.slot === op.invSlot);
      inventoryItems = inventoryItems.filter(i => i.slot !== op.invSlot);
      if (item) tradeMine = tradeMine.filter(i => i.slot !== r.slot).concat({ ...item, slot: r.slot });
    } else {
      const item = tradeMine.find(i => i.slot === op.tradeSlot);
      tradeMine = tradeMine.filter(i => i.slot !== op.tradeSlot);
      if (item) inventoryItems = inventoryItems.concat({ ...item, slot: r.slot });
    }
    syncInventoryViews();
    refreshTradePanel();
    console.log(`[trade] 搬运完成 kind=${op.kind} 落点 ${r.slot}`);
    return;
  }

  /*
   * 混沌箱的搬运同样走 0x24（`SourceFlag/TargetFlag = 3`）。
   * 成功时 `result` 返回的就是 TargetFlag（3 或 0），落点在 `slot` 里。
   */
  if (pendingChaosMove) {
    const op = pendingChaosMove;
    pendingChaosMove = null;
    if (!r.ok) {
      console.warn(`[chaos] ${op.kind} 被拒 result=0x${r.result.toString(16)}`);
      chaosPanel.toast(
        op.kind === 'in' ? '放不进去（箱子满 / 该物品不允许）' : '取不回来（背包满了？）',
        'error'
      );
      return;
    }
    if (op.kind === 'in') {
      const item = inventoryItems.find(i => i.slot === op.invSlot);
      inventoryItems = inventoryItems.filter(i => i.slot !== op.invSlot);
      if (item) chaosItems = chaosItems.filter(i => i.slot !== r.slot).concat({ ...item, slot: r.slot });
    } else {
      const item = chaosItems.find(i => i.slot === op.chaosSlot);
      chaosItems = chaosItems.filter(i => i.slot !== op.chaosSlot);
      if (item) inventoryItems = inventoryItems.concat({ ...item, slot: r.slot });
    }
    syncInventoryViews();
    chaosPanel.setItems(chaosItems);
    // 材料变了：重算配方 + 重新问一次成功率
    const type = checkMixRecipe(chaosItems).type;
    chaosPanel.setRecipe(type);
    if (type > 0) queryChaosRate(type);
    console.log(`[chaos] 搬运完成 kind=${op.kind} → 格 ${r.slot}，配方 ${type}`);
    return;
  }

  if (pendingContainerMove) {
    const op = pendingContainerMove;
    pendingContainerMove = null;
    if (!r.ok) {
      console.warn(`[warehouse] ${op.kind} 被拒 result=0x${r.result.toString(16)}`);
      npcPanel.toast(op.kind === 'store' ? '存入被拒（仓库满了？）' : '取出被拒（背包满了？）', 'error');
      return;
    }
    /*
     * 落点用回执里的 `slot`（= 请求的 TargetSlot），**不是** `result`：
     * 仓库存取时 `MoveItemToWarehouseFromInventory` 成功只返回 2（表示「从背包进仓库」），
     * 槽位信息在 `pMsg.slot` 里。
     */
    if (op.kind === 'store') {
      const item = inventoryItems.find(i => i.slot === op.invSlot);
      inventoryItems = inventoryItems.filter(i => i.slot !== op.invSlot);
      if (item) warehouseItems = warehouseItems.concat({ ...item, slot: r.slot });
      console.log(`[warehouse] 存入 OK → 仓库格 ${r.slot}`);
    } else {
      const item = warehouseItems.find(i => i.slot === op.whSlot);
      if (!item) {
        console.warn(
          `[warehouse] 取出时找不到仓库格 ${op.whSlot}，本地缓存=${warehouseItems.map(i => i.slot).join(',') || '空'}`
        );
        return;
      }
      warehouseItems = warehouseItems.filter(i => i.slot !== op.whSlot);
      inventoryItems = inventoryItems.concat({ ...item, slot: r.slot });
      console.log(`[warehouse] 取出 OK → 背包槽 ${r.slot}`);
    }
    syncInventoryViews();
    npcPanel.setItems(warehouseItems);
    return;
  }

  const req = pendingMove;
  pendingMove = null;

  if (!r.ok) {
    console.warn(`[items] 移动被拒 result=0x${r.result.toString(16)}`);
    if (req) {
      applyItemMove(req.to, req.from);
      inventoryPanel.toast(
        req.to < INVENTORY_WEAR_SIZE
          ? '服务端拒绝了这次装备操作（0xFF）'
          : '服务端拒绝了这次移动（0xFF）'
      );
    }
    return;
  }
  if (req && r.slot !== req.to) {
    console.log(`[items] 服务端落点 ${r.slot}（本地算的是 ${req.to}），按服务端走`);
    applyItemMove(req.to, r.slot);
  }
}

/** 把背包快照里的 slot from 挪到 to（目标格已有东西就互换） */
function applyItemMove(from: number, to: number) {  if (from === to) return;
  const moving = inventoryItems.find(i => i.slot === from);
  if (!moving) return;
  const displaced = inventoryItems.find(i => i.slot === to);

  inventoryItems = inventoryItems.filter(i => i.slot !== from && i.slot !== to);
  inventoryItems.push({ ...moving, slot: to });
  if (displaced) inventoryItems.push({ ...displaced, slot: from });
  syncInventoryViews();
}

/* ================================================================== */
/* NPC 对话 / 商店 / 仓库                                              */
/* ================================================================== */
/*
 * 服务端一侧的完整链路（MuServer_Source/GameServer）：
 *
 *   点 NPC  → 0x30 (CGNpcTalkRecv)
 *             ├─ 距离 > 5 格 / 不同地图 / 不是 OBJECT_NPC  → **静默丢弃**，什么都不回
 *             ├─ 普通商人（ShopManager.GetShopNumber != -1）→ 0x30 result=0 + 0x31 货架
 *             ├─ 仓库 NPC(Class 240)                        → 0x82? 否，直接 0x31 + 0x83
 *             ├─ 混沌机器(238)                              → 0x30 result=3 + 0xF3/0x10
 *             ├─ 服务器传送(234)                            → 0x30 result=5
 *             └─ 血色城堡(232/233) / 恶魔广场(237) / 黄金弓箭手(236) → 各自的 result 码
 *
 *   买  → 0x32 [货架格号]   → 回 0x22 result=0xFE（金币）+ 0xF3/0x10（背包）
 *   卖  → 0x33 [背包槽位]   → 回 0x33（result + 钱）+ 0x22 金币
 *   修  → 0x34 [槽位][type] → 回 0x34（钱）
 *   仓库存/取 → 0x24 [flag 0↔2] → 回 0x24 + 0x81（仓库金币）
 *   关面板 → 0x31
 *
 * 注意「买」和「卖」用的是**同一个数字 0x32/0x33 的双向报文**：
 * 上行 4 字节、下行 9/8 字节，靠长度和方向区分（见 net/game.ts）。
 */

/** 服务端判定 ±5 格，客户端贴着 4.4 走，留一格余量（地形格中心取整的误差） */
const NPC_TALK_RANGE = 4.4;

/** 距离不够时先走过去，到位后自动开口（主循环 updateNpcTalk 轮询） */
let npcPendingId = -1;

/** 仓库密码状态（0x83）：0 未设 / 1 需要密码 / 12 已解锁 / 10 密码错 / 13 个人码错 */
let warehouseState = 0;

/**
 * 取出手续费 —— 与服务端 `CWarehouse::GetWarehouseTaxMoney`（Warehouse.cpp:19）
 * 和客户端 `RenderWarehouse`（HUD_Pass6.cpp:1727）是**同一条公式**：
 *
 *   tax = (int)(level² × 0.04) + (locked ? 2 × level : 0)
 *   tax < 1        → 1
 *   tax ≥ 1000     → 取整到百位
 *   tax ≥ 100      → 取整到十位
 *
 * 客户端只拿它显示（真正扣钱在服务端），所以算错也只是数字不好看，
 * 不会导致「显示免费但实际扣钱」。
 */
function warehouseTax(): number {
  const level = currentChar?.level ?? 1;
  const locked = warehouseState === 1;
  let tax = Math.floor(level * level * 0.04) + (locked ? 2 * level : 0);
  if (tax < 1) tax = 1;
  else if (tax >= 1000) tax = 100 * Math.floor(tax / 100);
  else if (tax >= 100) tax = 10 * Math.floor(tax / 10);
  return tax;
}

function npcNameOf(id: number): string {
  const e = remotes.get(id);
  if (!e) return 'NPC';
  /*
   * 名字优先级（和原版 `getMonsterName(Type)` 一致）：
   *   1. `NPCName.txt`（中文客户端原文：圣导士塞维娜 / 铁匠 汉斯 / 弓箭手洛斯…）
   *   2. 服务端 `0x13` 下发的 name（常常是空串）
   *   3. 职业号兜底
   */
  return monsterNameOf(e.cls, '') || (e.name && e.name.trim() ? e.name : `NPC #${e.cls}`);
}

/** 屏幕坐标 → 最近的 NPC id（判定半径 60px） */
function pickNpcAt(clientX: number, clientY: number): number | null {
  if (!world || !player) return null;
  // 同 `pickMonsterAt`：以前 60px 的「投影距离」会把 NPC 身边一大片地面吃掉
  return remotes.pickAt(muCamera.camera, clientX, clientY, canvas.getBoundingClientRect(), 'npc');
}

/** 和 NPC 说话：太远就先走过去（服务端静默丢弃，不纠错，容易以为「点了没反应」） */
function talkToNpc(id: number) {
  const npc = remotes.get(id);
  if (!npc || !player || !connection?.connected) return;

  const d = Math.hypot(npc.tx - player.x, npc.ty - player.y);
  npcTargetId = id;
  if (d > NPC_TALK_RANGE) {
    npcPendingId = id;
    walkToCell(npc.tx, npc.ty);
    return;
  }
  npcPendingId = -1;
  npcTalkReplied = false;
  connection.send(buildNpcTalkPacket(id));
  queueNpcGreeting(id);
}

/**
 * 点 NPC 之后补一句任务对话（原版 `CSQuest::ShowDialogText`）。
 *
 * **为什么要靠定时器**：0.97 的对话不是服务端下发的。任务 NPC（比如迪威斯的
 * 圣导士塞维娜 235）在服务端 `CNpcTalk::CGNpcTalkRecv` 里 `NpcTalk()` 返回 0
 * 且 `GetShopNumber() == -1`，于是**一包都不回**（连聊天提示都没有）；客户端
 * 只能自己在「说话请求之后」调 `ShowQuestNpcWindow` 把 `quest.bmd` 的
 * `QuestStartText[0]` 弹出来。所以这里等一小会儿，确认服务端确实没反应再弹。
 *
 * **踩过的坑（多余对话框）**：
 *   1. 以前不管什么 NPC 都兜底弹第 0 条「有什么需要帮助的吗？」，于是卫兵、
 *      铁匠、金弓这些 NPC 在服务端已经发过聊天提示 / 开了自己的窗口之后，
 *      还会**再叠一个对话框**。原版只有任务系统会开对话框 → 现在**没有任务的
 *      NPC 一律不弹**。
 *   2. 守卫只看了 `npcPanel / chaosPanel / npcDialog`，漏了金弓、血色/恶魔广场、
 *      交易、战盟、任务面板 —— 这些窗口都在对话窗之后 200~400ms 才由服务端
 *      打开，于是「窗口 + 对话框」同时出现。现在统一走 `anyNpcWindowOpen()`。
 *   3. 定时器是「盲等」：0x30 迟到（服务端慢 1 拍）时窗口还在路上，对话框已经
 *      弹出来了。现在 `0x30` 一到就 `cancelNpcGreeting()`，从根上掐掉这条竞态。
 */
let npcGreetingTimer: number | null = null;
/** 当前对话窗是哪条任务开出来的（`m_iReturnForAnswer` 要拿任务号发包） */
let activeQuestDialog: { index: number; name: string } | null = null;
/** 这一次「和 NPC 说话」服务端回过 0x30 没有（= 它已经自己给了窗口/提示） */
let npcTalkReplied = false;
/** 对话窗里点了接受/提交 → 等 0xA1/0xA2 回来按新状态重开同一条任务的对话 */
let pendingQuestDialogRefresh = -1;

/**
 * 背包里够不够这条任务要的东西（原版 `CSQuest::FindQuestItemsInInven`）。
 *
 * `Runtime_Medium.cpp:689` 那个函数就是「遍历背包 → 数 Type 匹配的件数 →
 * 够了返回 0，不够返回还差几个」；`CheckActCondition`（`Scene_CharSelect_Nav.cpp:103`）
 * 拿它的返回值决定 `CheckQuestState` 走 `FindQuestContext(act, 1)`（可以交了）
 * 还是 `(act, 2)`（还在进行中）：
 *
 * ```c
 * int iVar2 = CSQuest_FindQuestItemsInInven(itemType, count, -1);
 * // 返回非 0（还差几个）→ 落回「进行中」
 * ```
 *
 * 我们只数**背包格**（`slot >= INVENTORY_WEAR_SIZE`）—— 任务物品不可装备，
 * 但原版扫的是那 64 格纯背包区，装备栏里同名物品不该算。
 */
function questItemsSatisfied(info: { items: { type: number; count: number } | null }): boolean {
  const need = info.items;
  if (!need) return false;
  let got = 0;
  for (const it of inventoryItems) {
    if (it.slot < INVENTORY_WEAR_SIZE) continue;
    if (it.type === need.type) got++;
    if (got >= need.count) return true;
  }
  return false;
}

/** 当前任务状态 + 物品是否齐了 → 该显示哪条对话 */
function questDialogText(info: QuestDialogInfo, state: number): number {
  return questTextFor(info, state, state === 1 && questItemsSatisfied(info));
}

/**
 * 按「任务 + 状态」重开对话窗（原版 `CSQuest::ShowQuestNpcWindow(-1)`）。
 *
 * `0xA1`（状态变化）和 `0xA2`（接取/提交回执，`result == 0`）在原版里都会
 * 把当前任务的对话**重新打开**，文案由 `CheckQuestState` 按新状态挑
 * （开始 / 进行中 / 可交 / 完成）—— 少了这一步，接完任务再点 NPC
 * 还会看到「你愿意帮我吗」的开场白。
 */
async function reopenQuestDialog(index: number, state: number) {
  const info = await questByIndex(index, playerClassId());
  if (!info) return;
  activeQuestDialog = { index: info.index, name: info.name };
  const dlg = questDialogText(info, state);
  await npcDialog.show(dlg);
  console.log(`[quest] 按状态 ${state} 重开对话 ${info.index} → 对话 ${dlg}`);
}

/** 所有「NPC 说话会弹出来」的窗口；任何一个开着就不再叠对话框 */
function anyNpcWindowOpen(): boolean {
  return (
    npcPanel.isOpen ||
    chaosPanel.isOpen ||
    npcDialog.isOpen ||
    gaPanel.isOpen ||
    eventPanel.isOpen ||
    tradePanel.isOpen ||
    guildPanel.isOpen ||
    questPanel.isOpen ||
    svdPanel.isOpen
  );
}

/** 开服务器传送之前先把别的 NPC 界面收掉（原版 sub 5 也是 CloseInventoryRelatedWindows） */
function closeOtherNpcWindows() {
  if (npcPanel.isOpen) hideNpcPanel();
  if (chaosPanel.isOpen) closeChaosPanel();
  if (eventPanel.isOpen) closeEventWindow();
  if (gaPanel.isOpen) closeGoldenArcher();
}

/** 取消还没弹出来的兜底对话（0x30 到了 = 服务端自己处理了这次说话） */
function cancelNpcGreeting() {
  if (npcGreetingTimer !== null) {
    window.clearTimeout(npcGreetingTimer);
    npcGreetingTimer = null;
  }
}

function queueNpcGreeting(id: number) {
  cancelNpcGreeting();
  npcGreetingTimer = window.setTimeout(() => {
    npcGreetingTimer = null;
    if (!connection?.connected || npcTalkReplied) return;
    if (anyNpcWindowOpen()) return;
    const npc = remotes.get(id);
    if (!npc) return;
    /*
     * 按原版链路找对话：`quest.bmd` 里 `NpcNumber == NPC 的 Class` 那条任务，
     * `QuestStartText[0]` 就是第一句（比如圣导士塞维娜 235 → 第 52 条）。
     * **没有任务就不弹**（原版也只有任务系统会开这个窗）。
     */
    void questForNpc(npc.cls, playerClassId()).then(info => {
      if (!info || npcTalkReplied || anyNpcWindowOpen()) return;
      activeQuestDialog = { index: info.index, name: info.name };
      // 按任务当前状态挑文案（原版 `CheckQuestState`）；没接过就显示开场白
      const state = questStates.get(info.index) ?? 0;
      void npcDialog.show(questDialogText(info, state));
    });
  }, 900);
}

/** 主循环：走到位就开口（和 updatePickup 一个套路） */
function updateNpcTalk() {
  if (npcPendingId < 0 || !player || !connection?.connected) return;
  const npc = remotes.get(npcPendingId);
  if (!npc) {
    npcPendingId = -1;
    return;
  }
  const d = Math.hypot(npc.tx - player.x, npc.ty - player.y);
  if (d > NPC_TALK_RANGE) return;
  const id = npcPendingId;
  npcPendingId = -1;
  npcTalkReplied = false;
  movePath = [];
  connection.send(buildNpcTalkPacket(id));
  // 走到位才说话的情况也要补任务对话（以前只有「本来就在身边」那条路会弹）
  queueNpcGreeting(id);
}

/**
 * 0x30 对话回执。
 *
 * result 的语义是**逐 NPC 自己写的**（NpcTalk.cpp / BloodCastle.cpp /
 * DevilSquare.cpp 各有一份），所以这里只认三种真正的「界面」：
 * 0 商店、2 仓库、3 混沌机器。其余码要么已经被服务端用 `GCChatTargetSend`
 * 发过一句原因（聊天框里能看到），要么本 port 还没做对应窗口 ——
 * 都只往聊天框写一行，不弹空窗口。
 */
function onNpcTalkReply(pkt: Uint8Array) {
  const reply = parseNpcTalk(pkt);
  if (!reply) return;

  /*
   * 服务端回 0x30 = 这次说话它自己处理了（开商店/仓库/混沌/金弓/事件窗，或者
   * 只用聊天给了一句拒绝原因）。此时**立刻掐掉**那条「900ms 没反应就弹任务
   * 对话框」的兜底，否则服务端的窗口和我们的对话框会叠在一起。
   */
  npcTalkReplied = true;
  cancelNpcGreeting();

  const name = npcNameOf(npcTargetId);
  console.log(`[npc] ${name} result=${reply.result} levels=${reply.levels.join(',')}`);

  if (reply.result === NPC_TALK.SHOP) {
    npcMode = 'shop';
    npcPanel.show('shop');
    npcPanel.toast('点击物品购买 · 点背包物品出售', 'ok');
    return;
  }

  if (reply.result === NPC_TALK.WAREHOUSE) {
    npcMode = 'warehouse';
    npcPanel.show('warehouse');
    npcPanel.setWarehouseInfo({
      money: warehouseMoney,
      tax: warehouseTax(),
      locked: warehouseState === 1,
    });
    npcPanel.toast('点击仓库物品取出 · 点背包物品存入', 'ok');
    return;
  }

  if (reply.result === NPC_TALK.CHAOS_MACHINE) {
    /*
     * 混沌合成机（`CNpcTalk::NpcChaosGoblin`）：服务端只把 Interface 切成
     * `INTERFACE_CHAOS_BOX` 并回 result=3，**不下发任何物品列表** —— 箱子
     * 一定是空的，材料要玩家自己从背包点进去。
     */
    npcMode = 'chaos';
    chaosItems = [];
    chaosPanel.setItems([]);
    chaosPanel.setRecipe(0);
    chaosPanel.show();
    chaosPanel.toast('点背包物品放入材料 · 点箱子物品取回', 'ok');
    return;
  }

  if (reply.result === NPC_TALK.DEVIL_SQUARE) {
    // Charon 237：恶魔广场。服务端在此之前已经发过 0x8E（等级表）
    openEventWindow('ds');
    return;
  }

  if (reply.result === NPC_TALK.BLOOD_CASTLE) {
    // Messenger of Archangel 233：血色城堡。服务端在此之前已经发过 0x8F
    openEventWindow('bc');
    return;
  }

  if (reply.result === NPC_TALK.SERVER_TRANSFER) {
    /*
     * NPC 234（Server Transfer）：原版 `Net_Process.cpp:5226` 收到 sub 5 就
     * `g_bServerDivisionEnable = 1`，之后每帧由 `RenderServerDivision` 画面板。
     * 服务端的 `NpcServerTransfer` 同时还把 `Interface.use` 置了 1。
     */
    closeOtherNpcWindows();
    svdPanel.show();
    console.log('[svd] 0x30 result=5 → 打开服务器传送窗口');
    return;
  }

  // 血色城堡 / 恶魔广场 / 黄金弓箭手：服务端已经用聊天发过具体原因
  chatBox.push('系统', `${name}：${npcResultText(reply.result)}`, 1);
}

/** 各事件 NPC 的拒绝码（血缘见 BloodCastle.cpp:2092 起 / DevilSquare.cpp:1359 起） */
function npcResultText(result: number): string {
  switch (result) {
    case 1:
      return '条件不满足（等级/道具/人数）';
    case 2:
      return '仓库界面已打开';
    case 3:
      return '混沌合成机';
    case 4:
      // 恶魔广场入场（正常情况下会被 onNpcTalkReply 提前拦走）
      return '恶魔广场';
    case 5:
      return '传送菜单';
    case 6:
      // 血色城堡入场（同上）
      return '血色城堡';
    default:
      return `未处理的对话结果 result=${result}`;
  }
}

/**
 * 0x31 商品 / 仓库列表。
 *
 * **同一个报文**两种语义，靠 `npcMode` 区分（服务端靠 Interface.type，
 * 客户端只能靠「刚收到的 0x30 说我要开什么」）。没有上下文的 0x31
 * 一律按商店处理 —— 那只可能是打开商店时网络乱序丢掉了 0x30。
 */
function onContainerList(pkt: Uint8Array) {
  const list = parseContainerList(pkt);
  if (!list) return;

  /*
   * 混沌箱的列表用的是**同一个报文**，靠 `type` 区分：
   *   `CChaosBox::GCChaosBoxSend` 里 `pMsg.type = 3`（商店/仓库是 0）
   * 所以这里先看 type，再退回 `npcMode` —— 只靠 npcMode 的话，
   * 关掉混沌机后残留的 0x31 会把空列表塞给仓库面板。
   */
  if (list.type === 3 || npcMode === 'chaos') {
    chaosItems = list.items.slice();
    chaosPanel.setItems(chaosItems);
    const type = checkMixRecipe(chaosItems).type;
    chaosPanel.setRecipe(type);
    if (type > 0) queryChaosRate(type);
    console.log(`[chaos] 0x31 箱内 ${list.items.length} 件 → 配方 ${type}`);
    return;
  }

  if (!npcMode) npcMode = 'shop';
  console.log(`[npc] 0x31 ${npcMode} 物品 ${list.items.length} 件`);
  npcPanel.setItems(list.items);

  if (npcMode === 'warehouse') {
    // 服务端刚下发的整表：本地缓存也换一份，后面存取就在这上面改
    warehouseItems = list.items.slice();
    npcPanel.setWarehouseInfo({
      money: warehouseMoney,
      tax: warehouseTax(),
      locked: warehouseState === 1,
    });
  }
}

/** 买：0x32 + 货架格号。成功与否都只看 0x32 回执的 result */
function buyFromShop(shelfSlot: number) {
  if (!connection?.connected) return;
  const money = currentChar?.info?.money ?? 0;
  connection.send(buildBuyPacket(shelfSlot));
  console.log(`[shop] 购买货架格 ${shelfSlot}（身上 ${money}）`);
}

/** 卖：0x33 + 背包槽位。点背包物品触发 */
function sellToShop(slot: number) {
  if (!connection?.connected) return;
  const item = inventoryItems.find(i => i.slot === slot);
  if (!item) return;
  pendingSellSlot = slot;
  connection.send(buildSellPacket(slot));
  console.log(`[shop] 出售槽位 ${slot}（type=${item.type}）`);
}

/** 上一次发出的卖单槽位：服务端 0x33 回执里只有「总金币」，槽位要自己记 */
let pendingSellSlot = -1;
/** 最近一次收到金币同步（0x22 result=0xFE）的时刻，用来区分「买药水叠加」和「买失败」 */
let lastMoneySyncAt = 0;
/** 上一次 0xF3/0xE6 事件表的「名字:状态」签名（服务端每秒推一次，只给变化打日志） */
let lastEventSig = '';
/** 最近一次收到视野实体包（0x12/0x13/0x14）的时刻，视野握手用它判断「服务端已经在推了」 */
let lastViewportAt = 0;
/** 视野握手定时器（`notifyViewportReady`） */
let viewportHandshakeTimer = 0;

/**
 * 在容器网格里找第一个放得下这件物品的空位（原版拖拽时客户端自己算落点）。
 *
 * 为什么不能像背包内换位那样传 0xFF 让服务端自动摆：
 * `CItemManager::MoveItemToWarehouseFromInventory` 第一件事就是
 * `WAREHOUSE_RANGE(TargetSlot)`，**0xFF 直接判非法返回 0xFF** ——
 * 服务端根本不支持「仓库自动找位」。取仓也一样，得给具体背包槽。
 *
 * @param items 容器里已有的物品
 * @param base  容器第一个格号（仓库 0，背包 12）
 * @param cols  列数（两者都是 8）
 * @param rows  行数（仓库 15，背包 8）
 */
function firstFreeGrid(
  items: InventoryItem[],
  base: number,
  cols: number,
  rows: number,
  w: number,
  h: number
): number | null {
  const used = new Set<number>();
  for (const it of items) {
    if (it.slot < base) continue; // 背包场景下 0..11 是装备槽，不占格子
    const attr = itemAttr(it.type);
    const c0 = (it.slot - base) % cols;
    const r0 = Math.floor((it.slot - base) / cols);
    for (let dy = 0; dy < attr.h; dy++) {
      for (let dx = 0; dx < attr.w; dx++) used.add((r0 + dy) * cols + (c0 + dx));
    }
  }
  for (let y = 0; y + h <= rows; y++) {
    for (let x = 0; x + w <= cols; x++) {
      let free = true;
      for (let dy = 0; dy < h && free; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (used.has((y + dy) * cols + x + dx)) {
            free = false;
            break;
          }
        }
      }
      if (free) return base + y * cols + x;
    }
  }
  return null;
}

/** 存进仓库：0x24，SourceFlag=0 → TargetFlag=2（目标格自己算，见 firstFreeGrid） */
function storeToWarehouse(slot: number) {
  if (!connection?.connected) return;
  const item = inventoryItems.find(i => i.slot === slot);
  if (!item) return;
  if (item.slot < INVENTORY_WEAR_SIZE) {
    npcPanel.toast('先脱下装备再存仓', 'error');
    return;
  }
  const attr = itemAttr(item.type);
  const dest = firstFreeGrid(warehouseItems, 0, 8, 15, attr.w, attr.h);
  if (dest === null) {
    npcPanel.toast('仓库满了', 'error');
    return;
  }
  const info = { type: item.type, level: item.level, option: item.option, durability: item.durability };
  pendingContainerMove = { kind: 'store', invSlot: slot, whSlot: dest };
  connection.send(buildItemMovePacket(slot, dest, info, { from: 0, to: 2 }));
  console.log(`[warehouse] 存入槽位 ${slot} → 仓库格 ${dest}`);
}

/** 从仓库取出：0x24，SourceFlag=2 → TargetFlag=0（背包落点自己算） */
function takeFromWarehouse(warehouseSlot: number) {
  if (!connection?.connected) return;
  const item = npcPanelItem(warehouseSlot);
  if (!item) {
    console.warn(`[warehouse] take(${warehouseSlot}) 面板里没这件，面板现有格=${npcPanel.snapshot().items.map(i => i.slot).join(',') || '空'}`);
    return;
  }
  const attr = itemAttr(item.type);
  const dest = firstFreeGrid(inventoryItems, INVENTORY_WEAR_SIZE, 8, 8, attr.w, attr.h);
  if (dest === null) {
    console.warn('[warehouse] 背包找不到空位');
    npcPanel.toast('背包满了', 'error');
    return;
  }
  const info = { type: item.type, level: item.level, option: item.option, durability: item.durability };
  pendingContainerMove = { kind: 'take', invSlot: dest, whSlot: warehouseSlot };
  connection.send(buildItemMovePacket(warehouseSlot, dest, info, { from: 2, to: 0 }));
  console.log(`[warehouse] 取出仓库格 ${warehouseSlot} → 背包槽 ${dest}`);
}

/** 面板里某个格上的物品（npcPanel 自己维护一份，这里只是给发包找 ItemInfo） */
function npcPanelItem(slot: number): InventoryItem | null {
  return npcPanel.itemAt(slot);
}

/* ------------------------------------------------------------------ */
/* 混沌合成机（0x86 / 0x87 / 0x88，物品搬运走 0x24 flag 3）            */
/* ------------------------------------------------------------------ */

/**
 * 背包 → 混沌箱：0x24 `SourceFlag=0, TargetFlag=3`。
 *
 * 目标格**必须自己算**：`MoveItemToChaosBoxFromInventory` 第一句就是
 * `CHAOS_BOX_RANGE(TargetSlot)`，0xFF 直接判非法（和仓库同一个坑）。
 */
function putIntoChaosBox(invSlot: number) {
  if (!connection?.connected) return;
  const item = inventoryItems.find(i => i.slot === invSlot);
  if (!item) return;
  if (item.slot < INVENTORY_WEAR_SIZE) {
    chaosPanel.toast('先脱下装备再放进箱子', 'error');
    return;
  }
  const attr = itemAttr(item.type);
  const dest = firstFreeGrid(chaosItems, 0, 8, 4, attr.w, attr.h);
  if (dest === null) {
    chaosPanel.toast('混沌箱放不下了', 'error');
    return;
  }
  const info = { type: item.type, level: item.level, option: item.option, durability: item.durability };
  pendingChaosMove = { kind: 'in', invSlot, chaosSlot: dest };
  connection.send(buildItemMovePacket(invSlot, dest, info, { from: 0, to: 3 }));
  console.log(`[chaos] 放入背包槽 ${invSlot} → 箱子格 ${dest}`);
}

/** 混沌箱 → 背包：0x24 `SourceFlag=3, TargetFlag=0` */
function takeFromChaosBox(chaosSlot: number) {
  if (!connection?.connected) return;
  const item = chaosPanel.itemAt(chaosSlot);
  if (!item) return;
  const attr = itemAttr(item.type);
  const dest = firstFreeGrid(inventoryItems, INVENTORY_WEAR_SIZE, 8, 8, attr.w, attr.h);
  if (dest === null) {
    chaosPanel.toast('背包满了', 'error');
    return;
  }
  const info = { type: item.type, level: item.level, option: item.option, durability: item.durability };
  pendingChaosMove = { kind: 'out', invSlot: dest, chaosSlot };
  connection.send(buildItemMovePacket(chaosSlot, dest, info, { from: 3, to: 0 }));
  console.log(`[chaos] 取出箱子格 ${chaosSlot} → 背包槽 ${dest}`);
}

/** 0x88：让**服务端**算成功率和费用（客户端只负责显示） */
function queryChaosRate(type: number) {
  if (!connection?.connected) return;
  connection.send(buildChaosRatePacket(type));
}

/**
 * 0x86：发起合成。
 *
 * 只在本地配方非 0 时才允许发 —— 材料不对时服务端**一个包都不回**
 * （`GetChaosMixRates` 返回 false → `ChaosItemMix` 直接 return），
 * 而 `ChaosLock` 已经被置 true，会把混沌机卡住直到关闭重开。
 * 见 `src/data/chaosRecipe.ts` 顶部注释。
 */
function mixChaos(type: number) {
  if (!connection?.connected) return;
  const recipe = checkMixRecipe(chaosItems).type;
  if (recipe <= 0 || recipe !== type) {
    chaosPanel.toast(recipe < 0 ? mixErrorText(recipe) : '材料不匹配，无法合成', 'error');
    return;
  }
  pendingChaosType = type;
  chaosPanel.setPhase('mixing');
  connection.send(buildChaosMixPacket(type));
  console.log(`[chaos] 0x86 合成 type=${type}（${MIX_LABEL[type] ?? '?'}）`);
}

/**
 * 0x86 回执：`C1 06 86 result ItemInfo[4]`。
 *
 *   1 = 成功且产出物品（ItemInfo 是产物，+10/+11 时带新等级）
 *   0 = 失败 / 没产出（服务端已经把箱子清空并重发 0x31）
 *   2 = 金币不足
 *   8 = 材料等级超出上限
 */
function onChaosMixResult(pkt: Uint8Array) {
  const r = parseChaosMixResult(pkt);
  if (!r) return;
  const type = pendingChaosType;
  pendingChaosType = 0;
  chaosPanel.setPhase('result');

  console.log(
    `[chaos] 0x86 回执 result=${r.result} item=${r.item ? `type=${r.item.type} lv=${r.item.level}` : 'null'}`
  );

  if (r.result === 1 && r.item) {
    /*
     * 产物**不在背包**：`DGCreateItemRecv` 把箱子清空后只把它放进箱子第 0 格
     * （`ChaosBoxAddItem(…, item, 0)`）。所以这里直接覆盖本地箱子，
     * 玩家得自己点回背包 —— 关闭混沌机会把它一起 Clear 掉。
     */
    chaosItems = [{ ...r.item, slot: 0 }];
    chaosPanel.setItems(chaosItems);
    chaosPanel.setRecipe(0); // 材料已经被吃掉了，配方归零
    const name = itemAttr(r.item.type).name;
    chaosPanel.toast(`合成成功：${name}${r.item.level ? ` +${r.item.level}` : ''} —— 点它取回背包`, 'ok');
    chatBox.push('系统', `混沌合成成功：${name}（记得从箱子里取回）`, 1);
    return;
  }

  if (r.result === 2) {
    chaosPanel.toast('金币不足，无法合成', 'error');
    return;
  }
  if (r.result === 8) {
    chaosPanel.toast('材料等级超出上限', 'error');
    return;
  }

  // result 0：失败。服务端在失败分支里已经 `ChaosBoxInit` + 重发 0x31（空表），
  // 但那个 0x31 可能比这条 0x86 晚到，所以本地也清一次。
  chaosItems = [];
  chaosPanel.setItems([]);
  chaosPanel.setRecipe(0);
  chaosPanel.toast(`${MIX_LABEL[type] ?? '合成'}失败，材料已损失`, 'error');
  chatBox.push('系统', `混沌合成失败（${MIX_LABEL[type] ?? '?'}）`, 1);
}

/** 0x88 回执：`C1 0C 88 ?? rate(4) money(4)` —— `rate` 在 **+4**（对齐洞在 +3），见 `parseChaosRate` */
function onChaosRateReply(pkt: Uint8Array) {
  const r = parseChaosRate(pkt);
  if (!r) return;
  chaosPanel.setRate(r.rate, r.money);
  console.log(`[chaos] 0x88 成功率 ${r.rate}% 费用 ${r.money}`);
}

/**
 * 关混沌机：0x87。
 *
 * 界面**立刻收掉**，不等回执：服务端在 `CGChaosMixCloseRecv` 里只做
 * `ChaosBoxInit` + `Interface.use=0`，没有任何失败分支，回执只是确认。
 * 箱子里的东西会被服务端清空且**不退回背包**，所以 `requestClose` 已经在
 * 有物品时拦过一道了。
 */
function closeChaosPanel() {
  if (!chaosPanel.isOpen) return;
  if (connection?.connected) connection.send(buildChaosClosePacket());
  chaosPanel.hide();
  chaosItems = [];
  if (npcMode === 'chaos') {
    npcMode = null;
    npcTargetId = -1;
    npcPendingId = -1;
  }
  console.log('[chaos] 0x87 关闭混沌机');
}

/** 服务端确认关闭（0x87 回执，`PBMSG_HEAD` 只有 3 字节） */
function onChaosClosed() {
  chaosItems = [];
  chaosPanel.hide();
  if (npcMode === 'chaos') {
    npcMode = null;
    npcTargetId = -1;
    npcPendingId = -1;
  }
  chatBox.push('系统', '混沌合成机已关闭', 1);
}

/** 只关界面、不发包（服务端已经主动关了的情况，比如 0x82 回执） */
function hideNpcPanel() {
  npcPanel.hide();
  chaosPanel.hide();
  chaosItems = [];
  npcMode = null;
  npcTargetId = -1;
  npcPendingId = -1;
}

/** 关面板：服务端要收到 0x31（商店/仓库）/ 0x87（混沌机）才会清 Interface.use */
function closeNpcPanel() {
  if (npcMode === 'chaos') {
    // 箱子里还有东西时 chaosPanel 会拦下并提示（原版 ChaosBoxRequestClose 同款）
    chaosPanel.requestClose();
    return;
  }
  if (npcMode && connection?.connected) connection.send(buildNpcClosePacket());
  hideNpcPanel();
}

/* ------------------------------------------------------------------ */
/* 箭矢（源码 CreateArrow / CreateArrows）                             */
/* ------------------------------------------------------------------ */

/**
 * 弓 / 弩的 item type → 箭矢模型。
 *
 * 源码 `CreateArrow`（Combat_Projectiles.cpp:14）是**按武器模型号**选的，
 * 不是按技能：`adjType = type + 400`，然后
 *
 *   528/529 → ArrowSteel   530 → ArrowSaw     531 → ArrowLaser
 *   532 → ArrowThunder     533 → ArrowWing    534 → ArrowBomb
 *   536/538 → ArrowDouble   其余弓 → Arrow01
 *
 * 注意这里**不返回 null**：拿不到武器（离线沙盘默认是矛）也要能放箭，
 * 否则 `castSkill(24/51/52)` 在沙盘里会静默什么都不出，没法验证表现层。
 */
function arrowModelOf(weaponType: number | undefined): string {
  if (weaponType === undefined) return 'Arrow01.bmd';
  const m = weaponType + 400;
  if (m === 528 || m === 529) return 'Arrowsteel01.bmd';
  if (m === 530) return 'Arrowsaw01.bmd';
  if (m === 531) return 'Arrowlaser01.bmd';
  if (m === 532) return 'Arrowthunder01.bmd';
  if (m === 533) return 'Arrowwing01.bmd';
  if (m === 534) return 'Arrowbomb01.bmd';
  if (m === 536 || m === 538) return 'Arrowdouble01.bmd';
  return 'Arrow01.bmd';
}

/** 当前手上是不是弓/弩（决定普攻要不要放箭） */
function isRangedWeapon(): boolean {
  const kind = weaponInfo(animInput().weapon).kind;
  return kind === 'bow' || kind === 'crossbow';
}

/** 箭速（米/秒）。源码箭矢是匀速实体，约 30~40 m/s 的手感 */
const ARROW_SPEED = 34;
/** 三连/五连的水平散角（源码 `_DAT_00552834`，约 8°） */
const ARROW_SPREAD = 0.14;

/**
 * 箭矢模型自身的朝向修正（**Arrow 系列专用**）。
 *
 * `Arrow01.bmd` 的顶点长轴在模型空间是 **+Z**（`x=8.7cm  y=8.7cm  z=86cm`），
 * 但骨骼绑定把它转到了世界的 **-Y**（`Arrow` 那根骨的绑定旋转是 -90°）：
 * 把 `axis` 读出来看，`yaw = 0` 时箭头指向 `(0, -1)`，正好是屏幕上朝下。
 *
 * 而 `effects.spawn` 的 `yaw` 是「绕世界竖轴、0 = +X」。所以：
 *
 *   axis(θ) = (sinθ, -cosθ)
 *   想让它等于飞行方向 (cosφ, sinφ) → θ = φ + π/2
 *
 * 直接把 `atan2(dy, dx)` 传进去，箭身就歪 90°（现象：怪在右边，箭朝下飞）。
 *
 * 其它特效模型**不要**套这个偏移：`Laser01` 的长轴在 +X、`Ice01` 在 -Y，
 * 它们各自按 `SKILL_FX` 的配置走。
 */
const ARROW_YAW_OFFSET = Math.PI / 2;

/**
 * 箭矢的分轴缩放：横截面加粗 2 倍、长度 +15%。
 *
 * 原版箭矢按 1:1 画（直径 8.7 cm），在 Win 端 800×600 的近景镜头里刚好；
 * 这个 port 的默认镜头更远，1:1 的箭细得像根线。只放大横截面既能看清，
 * 又不会把箭拉成 1.7 m 的长矛。
 */
const ARROW_SCALE3: [number, number, number] = [2, 1.15, 2];

/**
 * 放箭（源码 `CreateArrows`，Combat_Projectiles.cpp:177）。
 *
 *   普攻 / 冰封箭 / 穿透箭 → 1 支
 *   多重箭（24）           → 3 支（中心 + ±8°；源码 `Skill == 1` 分支）
 *
 * 纯客户端表现：伤害由服务端算好（0x15 回执），这里只负责「看得见一支箭飞过去」。
 * 以前完全没做 —— 精灵用弓时只有拉弓动作和命中数字，箭是不存在的。
 */
function shootArrows(
  count: number,
  dest: { x: number; y: number; z: number },
  /**
   * 谁放的箭。默认是自己；联机时是视野里那个精灵（`playRemoteSkill` 传进来）。
   * 远程实体的武器拿不到（服务端不下发装备明细），所以箭矢模型用默认 `Arrow01`。
   */
  origin: { actor: Actor; weapon?: number } | null = null
) {
  if (!world) return 0;
  const actor = origin?.actor ?? player;
  if (!actor) return 0;
  const file = arrowModelOf(origin ? origin.weapon : animInput().weapon);
  const start = actor.handPosition(new THREE.Vector3());
  const baseYaw = Math.atan2(dest.y - start.y, dest.x - start.x);
  const dist = Math.hypot(dest.x - start.x, dest.y - start.y);
  const flyTime = Math.max(0.1, dist / ARROW_SPEED);

  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * ARROW_SPREAD;
    const yaw = baseYaw + ARROW_YAW_OFFSET + off;
    // 箭根贴着手，所以三连箭从同一个点出发、靠角度散开（源码也是只改 Angle[0]）
    void effects
      .spawn(modelName(file), { x: start.x, y: start.y, z: start.z }, {
        scale: 1,
        scale3: ARROW_SCALE3,
        // 箭身被骨骼绑成 -Y 长轴，补 +90° 才是飞行方向，见 ARROW_YAW_OFFSET
        yaw,
        life: flyTime + 0.12,
        flyTo: { x: dest.x, y: dest.y, z: dest.z },
        flyTime,
      })
      .catch(err => console.warn(`[arrow] ${file} 生成失败`, err));
  }
  arrowDebug.count += count;
  arrowDebug.last = {
    count,
    file,
    dist: +dist.toFixed(2),
    flyTime: +flyTime.toFixed(2),
    /** 飞行方向（世界角，0 = +X） */
    flyYaw: +baseYaw.toFixed(4),
    /** 传给特效的 yaw（应等于 flyYaw + π/2） */
    modelYaw: +(baseYaw + ARROW_YAW_OFFSET).toFixed(4),
    scale3: ARROW_SCALE3,
  };
  return count;
}

/** 探针用的箭矢诊断 */
const arrowDebug: {
  last: {
    count: number;
    file: string;
    dist: number;
    flyTime: number;
    flyYaw: number;
    modelYaw: number;
    scale3: [number, number, number];
  } | null;
  count: number;
} = { last: null, count: 0 };

/** 探针用的技能广播诊断（最近一次 0x19 与事件表） */
const skillDebug: {
  last:
    | (SkillCastEvent & {
        fx: string | null;
        skipped?: string;
        /** 这次实际生成了几件特效（源码序列的件数） */
        parts?: number;
        /** 实际播的动作号 */
        action?: number;
        /** 备注（源码无特效 / 走箭矢投射物 …） */
        note?: string;
      })
    | null;
  count: number;
  /** 0x1E 持续技能广播的次数（和 0x19 分开统计，探针要用） */
  duration: number;
  /** 0x1B 取消技能效果的次数 */
  cancels: number;
  events: { name: string; status: number; time: number }[];
} = { last: null, count: 0, duration: 0, cancels: 0, events: [] };

/** `Uint8Array` → `"c3 0b 1e …"`（探针核对线上字节用） */
function hexOf(pkt: Uint8Array): string {
  return Array.from(pkt, b => b.toString(16).padStart(2, '0')).join(' ');
}

/**
 * 在线施法：按技能号选 0x19 还是 0x1E，再把表现交回本地播一遍。
 *
 * 为什么需要这个函数：本 port 的技能一直只有「离线沙盘」一条路
 * （`castSkill`），在线点技能什么都没发出去。这里把上行补全：
 *
 *   - `DURATION_SKILLS` 里的（火焰/龙卷风/地狱火/旋风斩…）→ **0x1E**
 *     `C3 0B 1E skill x y dir dis angle idxHi idxLo`
 *   - 其余 → **0x19** `C3 06 19 skill hi lo`
 *
 * 服务端会把包**回给自己一份**，但 `playRemoteSkill` 对自己一律跳过（防双播），
 * 所以这里主动用 `allowSelf` 播一次 —— 和原版「本地先演、服务端再判定」一致。
 */
function castOnlineSkill(skillId: number, targetId = 0): boolean {
  if (!connection?.connected || !player) return false;
  const gx = playerCellX() & 0xff;
  const gy = playerCellY() & 0xff;
  const tid = targetId > 0 ? targetId : focusId >= 0 ? focusId : 0;
  const tgt = tid > 0 ? remotes.get(tid) : null;

  let dir = 0;
  if (tgt) {
    const a = Math.atan2(tgt.ty - player.y, tgt.tx - player.x);
    dir = Math.round((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 255) & 0xff;
  }

  // 施法音（`SKILL_SOUND`：技能号 → PlayBuffer id，出处见 data/sounds.ts）
  const snd = SKILL_SOUND[skillId];
  if (snd) sfx(snd, { volume: 0.8 });

  const isDuration = DURATION_SKILLS.has(skillId);
  if (isDuration) {
    connection.send(buildDurationSkillAttackPacket(skillId, gx, gy, dir, 0, 0, tid));
  } else {
    connection.send(buildSkillAttackPacket(skillId, tid));
  }

  playRemoteSkill(
    isDuration
      ? { skill: skillId, casterId: remotes.selfId, targetId: tid, success: true, x: gx, y: gy, dir }
      : { skill: skillId, casterId: remotes.selfId, targetId: tid, success: true },
    { allowSelf: true }
  );

  console.log(
    `[skill] 在线施法 ${skillId} → ${isDuration ? '0x1E' : '0x19'} target=${tid} (${gx},${gy}) dir=${dir}`
  );
  return true;
}

/**
 * 队友传送（0xB0）：把同队同图的一名队友拉到 (x,y)。
 *
 * 服务端 `CGSkillTeleportAllyRecv` 会校验同队 / 同图 / 目标格可传送 /
 * 自己有 `SKILL_TELEPORT_ALLY` 且蓝和 AG 够，任一不过静默丢弃。
 */
function recallAlly(index: number, x: number, y: number): boolean {
  if (!connection?.connected) return false;
  connection.send(buildTeleportAllyPacket(index, x, y));
  console.log(`[skill] 0xB0 传送队友 index=${index} → (${x},${y})`);
  return true;
}

/**
 * 远程实体的施法表现（0x19）。
 *
 * 只做「看得见」的部分：转身、施法动作、目标处的一发主特效。
 * 伤害数字由 0x15 单独下发，血量同步由 0x26/0x27 负责，这里不碰数值。
 *
 * 三个必须记住的点：
 *   1. **caster 是自己就跳过** —— 服务端 `DataSend(lpObj->Index, …)` 会抄送一份，
 *      本地 `castSkill` 已经播过，不跳过就是双播。
 *   2. 角色模型本地正面朝 **-Y**，所以 `yaw = atan2(dy, dx) + π/2`（`MODEL_YAW_OFFSET`）；
 *      而特效模型的角度约定是「0 = +X」，所以传给 `effects.spawn` 的 `yaw`
 *      要**去掉**这个偏移（直接用 `atan2`）。
 *   3. `targetId === 0` 表示没有目标（自身 buff / 群攻），特效落在施法者脚下，
 *      否则会莫名其妙出现在地图原点。
 */
function playRemoteSkill(ev: SkillCastEvent, opts: { allowSelf?: boolean } = {}) {
  if (!world) return;
  skillDebug.count++;

  /*
   * `allowSelf` = 「这次是我自己放的，本地先演一遍」。
   *
   * 服务端会把 0x19/0x1E 也回给自己一份，所以收包时自己一律跳过（否则双播）；
   * 但**在线施法**那条路（`castOnlineSkill`）需要立刻有反馈 ——
   * 它用同一个函数、带 `allowSelf` 调一次，表现和远端玩家完全一致。
   */
  const isSelf = ev.casterId === remotes.selfId;
  if (isSelf && !opts.allowSelf) {
    skillDebug.last = { ...ev, fx: null, skipped: 'self' };
    return;
  }
  const caster: { actor: Actor; tx: number; ty: number } | null = isSelf
    ? player
      ? { actor: player, tx: playerCellX(), ty: playerCellY() }
      : null
    : (remotes.get(ev.casterId) ?? null);
  if (!caster) {
    skillDebug.last = { ...ev, fx: null, skipped: isSelf ? 'no-player' : 'no-caster' };
    return;
  }

  /*
   * 别人的施法音：按施法者坐标做 3D（`Enable3DSound` 的那几个 sMagic/sFlame/…）。
   * 自己那条路已经在 `castOnlineSkill` 里放过一次，这里跳过防双声。
   */
  if (!isSelf) {
    const snd = SKILL_SOUND[ev.skill];
    if (snd) sfx(snd, { x: caster.actor.wx, y: caster.actor.wy, volume: 0.85 });
  }

  /*
   * ── 表现来源：和本地沙盘**同一份** ───────────────────────────────
   *
   * `castOf(skill)` 是 `data/skillFx.ts` 里从客户端源码翻译出来的完整序列
   * （`MoveCharacter` 的逐帧 `CreateEffect` / `Particle_Spawn` / `Joint_Create` 全在里面）。
   * 以前这里查的是早期的**单件**映射 `SKILL_FX[skill]` ——
   * 结果是「自己放技能一整套、别人放同一个技能只有一件」，而且动作号也不是源码的。
   * 现在两边共用 `playCastParts()`。
   *
   * `SKILL_FX` 只剩两个用途：源码没覆盖的技能兜底、以及延迟/观感参数。
   */
  const skill = skillTable.get(ev.skill) ?? null;
  const spec = skill ? castOf(skill) : null;
  const legacy = SKILL_FX[ev.skill] ?? null;

  const tgtEntity = ev.targetId ? remotes.get(ev.targetId) : null;
  const targetIsSelf = ev.targetId > 0 && ev.targetId === remotes.selfId && !!player;

  // 目标格中心（服务端的格号 +0.5 才是世界坐标）
  let tx = caster.tx + 0.5;
  let ty = caster.ty + 0.5;
  if (ev.x !== undefined && ev.y !== undefined) {
    // 0x1E：包里有明确的落点格号，优先用它（群攻技能根本没有目标实体）
    tx = ev.x + 0.5;
    ty = ev.y + 0.5;
  } else if (tgtEntity) {
    tx = tgtEntity.tx + 0.5;
    ty = tgtEntity.ty + 0.5;
  } else if (targetIsSelf && player) {
    tx = player.x;
    ty = player.y;
  }

  /*
   * 朝向：`dir` 是 0..255 对应 0..360°（源码 `dir = angle * 255/360`）。
   * 只有 5/52 这类「朝一个方向放」的技能会带非 0 值；41/42/55/56 靠目标索引
   * 定方向、`dir` 发 0，所以这里**只在非 0 时**覆盖，否则会把朝向转回 0°。
   */
  const hasDir = ev.dir !== undefined && ev.dir !== 0;
  let aimRad = Math.atan2(ty - caster.actor.y, tx - caster.actor.x);
  if (hasDir) aimRad = (ev.dir! / 255) * Math.PI * 2;
  if (tgtEntity || targetIsSelf || hasDir) {
    caster.actor.yaw = aimRad + MODEL_YAW_OFFSET;
  }

  /*
   * 动作：源码给的优先（`PacketHandler_0x19` 的 switch，见 `ACTION_BY_SKILL`），
   * 没有就用面板兜底表，最后退回魔法动作 82/83（`SetPlayerMagic`）。
   */
  /*
   * `spec.action === -1` 的意思是「源码不设动作，交给 `SetPlayerAttack` 按手上
   * 武器算挥砍」—— 要真的走挥砍动作，不能退回 `SKILL_FX` 里的 82（施法）。
   * 以前这里 `spec.action >= 0 ? … : legacy?.action ?? 82/83`，
   * 于是 18 圣盾防御、55/56 之外的近战技能全在**举手法师动作**。
   */
  const act =
    spec !== null
      ? spec.action >= 0
        ? spec.action
        : attackAction(animInput(), attackCombo++)
      : (legacy?.action ?? (Math.random() < 0.5 ? 82 : 83));
  caster.actor.play(act, false);

  /*
   * 精灵的弓箭三技能（24/51/52）在源码里走 `CreateArrows` —— 别人的多重箭
   * 也该看到三支箭飞出来。这三个技能 `castOf()` 故意返回空 parts，
   * 所以必须在下面 `parts.length === 0` 的分支之前处理。
   */
  if (BOW_SKILLS.has(ev.skill)) {
    const dest = { x: tx, y: ty, z: (world.terrain.getHeight(tx, ty) ?? caster.actor.z) + 1.1 };
    shootArrows(ev.skill === 24 ? 3 : 1, dest, { actor: caster.actor });
    if (ev.skill === 51) spawnIceArrowHit(dest);
    // 51 会额外挂两片冰晶，其余两招就是纯投射物
    skillDebug.last = { ...ev, fx: ev.skill === 51 ? 'CreateArrows + Ice01×2' : 'CreateArrows' };
    return;
  }

  /* 目标坐标（特效锚点用）；纯自身技能（没目标也没落点）传 null */
  const aim =
    tgtEntity || targetIsSelf || ev.x !== undefined
      ? { x: tx, y: ty, z: world.terrain.getHeight(tx, ty) }
      : null;

  /* ---------- 源码覆盖到的技能：完整序列 ---------- */
  if (spec && (spec.parts.length || spec.special)) {
    const delay = legacy?.delay ?? 240;
    skillDebug.last = {
      ...ev,
      fx: spec.special ? `专用:${spec.special}` : `源码 ${spec.parts.length} 件`,
      parts: spec.parts.length,
      action: act,
    };
    const label = skill?.name ?? `技能 ${ev.skill}`;
    window.setTimeout(() => {
      if (!world) return;
      playCastParts({ spec, caster: caster.actor, aim, label });
    }, delay);
    return;
  }

  /* ---------- 源码没有视觉的技能：只有动作 ---------- */
  if (spec && spec.source === 'none') {
    skillDebug.last = { ...ev, fx: null, action: act, note: '源码无特效' };
    return;
  }

  /* ---------- 源码没覆盖：退回早期的单件兜底 ---------- */
  if (!legacy) {
    skillDebug.last = { ...ev, fx: null, action: act };
    return;
  }
  const atSelf = legacy.at === 'self' || (ev.targetId === 0 && ev.x === undefined);
  const ax = atSelf ? caster.actor.wx : tx;
  const ay = atSelf ? caster.actor.wy : ty;
  skillDebug.last = { ...ev, fx: `兜底 ${legacy.file}`, action: act };

  window.setTimeout(() => {
    if (!world) return;
    const z = world.terrain.getHeight(ax, ay) + (legacy.lift ?? 0.6);
    void effects
      .spawn(modelName(legacy.file), { x: ax, y: ay, z }, {
        // 源码语义：特效按模型自己的单位画（`+0x1a` 默认 1.0），不按包围盒缩到多少米
        scale: 1,
        speed: legacy.speed,
        loops: legacy.loops,
        yaw: aimRad,
      })
      .catch(err => console.warn(`[skill] 远程特效 ${legacy.file} 失败`, err));
  }, legacy.delay ?? 260);
}

/**
 * 使用一件物品（0x26）：喝药、吃卷轴、双击装备。
 *
 * 服务端 `CGItemUseRecv` 按物品的 `ItemType` 分流：药水回 0x26/0x27 的
 * Life/Mana 包，卷轴回技能/属性变化，装备则等价于「穿上」。
 */
function useItem(slot: number) {
  if (!connection?.connected) return;
  const item = inventoryItems.find(i => i.slot === slot);
  if (!item) return;
  // 药水（14,0..6）才是「咕咚」一声（`pDrink` 0x20），其余物品不出声
  if (item.type >= 14 * 32 && item.type <= 14 * 32 + 6) sfx(0x20, { volume: 0.8 });
  connection.send(buildItemUsePacket(slot));
  console.log(`[items] 使用槽位 ${slot}（type=${item.type}）`);
}

/**
 * Q / W / E 喝药：范围与 HUD 快捷槽完全一致（`QUICK_RANGES`）。
 *
 * 原版 `Item_FindQuickSlotByCategory` 是**从高往低**找第一个有货的类型
 * （大药水优先），这里照抄；三种药水混着背的时候，喝的是最贵的那个。
 */
function useQuickSlot(index: number) {
  const range = QUICK_RANGES[index];
  if (!range) return;
  let hit: InventoryItem | null = null;
  for (let t = range.hi; t >= range.lo && !hit; t--) {
    hit =
      inventoryItems.find(
        i => i.slot >= INVENTORY_WEAR_SIZE && i.type === t && (i.durability || 0) > 0
      ) ?? null;
  }
  if (!hit) {
    inventoryPanel.toast('背包里没有对应的药水');
    return;
  }
  useItem(hit.slot);
}

/**
 * 脚步音（`PlayBuffer(8/9/10)`，土/草/雪）。
 *
 * 原版按**地形材质**选，材质来自 `.att` 的 tile 属性，这里先用地图近似：
 * 地牢/失落之塔/恶魔广场/血色城堡 = 土(0x08)，冰风谷 = 雪(0x0a)，其余 = 草(0x09)。
 * 节流 260ms —— 一格一步，跑步时也不会连成一片。
 */
let lastStepAt = 0;
function stepSound() {
  const now = performance.now();
  if (now - lastStepAt < 260) return;
  lastStepAt = now;
  const map = world?.mapId ?? 0;
  const id = map === 2 ? 0x0a : SOIL_MAPS.has(map) ? 0x08 : 0x09;
  sfx(id, { volume: 0.7, rate: 0.94 + Math.random() * 0.12 });
}

/** 石板/土质地面（脚步用土声）的地图号 */
const SOIL_MAPS = new Set([1, 4, 9, 11, 12, 13, 14, 15, 16]);

/** 背包单击的时间戳（用来识别双击 = 使用） */
let lastInvClick: { slot: number; at: number } | null = null;

/**
 * 丢弃：0x23 [x][y][槽位]。
 *
 * 服务端 `CGItemDropRecv` 要求目标格可站 + 与玩家相邻，所以直接发自己脚下。
 * 回执是 `C1 05 23 result slot`，result != 0 表示失败（通常是脚下不可放置）。
 */
function discardItem(slot: number) {
  if (!connection?.connected || !player) return;
  const item = inventoryItems.find(i => i.slot === slot);
  if (!item) return;
  const x = playerCellX();
  const y = playerCellY();
  connection.send(buildDropPacket(x, y, slot));
  console.log(`[items] 丢弃槽位 ${slot}（type=${item.type}）→ (${x},${y})`);
}

/**
 * 0x23 丢弃回执（`result` 1 = 成功、0 = 失败）。
 *
 * 成功时服务端**也不会**重发背包表（只给周围玩家发 0x25 物品变更），
 * 所以本地按回执里的 slot 自己删 —— 原版也是这么处理的。
 */
function onDropReply(pkt: Uint8Array) {
  const r = parseDropResult(pkt);
  if (!r) return;
  if (r.ok) {
    inventoryItems = inventoryItems.filter(i => i.slot !== r.slot);
    syncInventoryViews();
    sfx(0x1e, { volume: 0.8 });
    inventoryPanel.toast('已丢在地上');
  } else {
    inventoryPanel.toast('丢弃失败（+5 以上/卓越物品不能丢，或脚下不可放置）');
  }
}

/** 对某件地面物品发起拾取（距离够就直接发，太远则走过去） */
function tryPickup(itemId: number) {
  const item = groundItems.get(itemId);
  if (!item || !player) return false;
  if (groundItems.isPicking(itemId)) return true;

  pendingPickupId = itemId;
  const d = Math.hypot(item.x + 0.5 - player.x, item.y + 0.5 - player.y);
  // 服务端 `CMap::CheckItemGive` 的判定是 ±2 格，这里贴着 1.8 走，留点余量
  if (d > 1.8) {
    walkToCell(item.x, item.y);
  }
  return true;
}

function updatePickup(dt: number) {
  if (pendingPickupId < 0 || !player) return;

  const item = groundItems.get(pendingPickupId);
  if (!item) {
    pendingPickupId = -1;
    pickupSentAt = 0;
    return;
  }

  if (groundItems.isPicking(pendingPickupId)) {
    // 等回执；超时就放弃，允许再点一次
    pickupSentAt += dt;
    if (pickupSentAt > PICKUP_TIMEOUT) {
      groundItems.markPicking(pendingPickupId, false);
      pendingPickupId = -1;
      pickupSentAt = 0;
      console.warn('[items] 拾取回执超时');
    }
    return;
  }

  const d = Math.hypot(item.x + 0.5 - player.x, item.y + 0.5 - player.y);
  if (d <= 1.8 && !playerDead) {
    // 离线演示没有服务端，直接本地收走
    if (!connection || !connection.connected) {
      const name = itemDisplayName(item.type);
      groundItems.remove(pendingPickupId);
      pendingPickupId = -1;
      damageTexts.spawn(
        { x: player.x, y: player.y, z: player.z + 2.1 },
        name,
        'exp'
      );
      return;
    }
    groundItems.markPicking(pendingPickupId);
    pickupSentAt = 0;
    connection.send(buildItemGetPacket(pendingPickupId));
  }
}

/* ------------------------------------------------------------------ */
/* 光标 / 右键技能 / 按住左键续走                                       */
/* ------------------------------------------------------------------ */
/** 右键按下后还没定性：可能是拖动转镜头，也可能是一次点击放技能 */
let rightState: { x: number; y: number; dragged: boolean } | null = null;
/** 鼠标最后位置（窗口坐标） */
let hoverX = -1;
let hoverY = -1;
/** 左键是否按住（原版按住左键 = 一直朝光标走） */
let lmbDown = false;
let hoverAtMs = 0;
let lastHoldAt = 0;

type HoverKind = 'get' | 'talk' | 'attack';

/** 鼠标下面是哪一类东西（物品 > NPC > 怪，和原版 `Mouse_Hover` 的优先级一致） */
function hoverTarget(sx: number, sy: number): { kind: HoverKind; id: number } | null {
  if (!world || !player) return null;
  const rect = canvas.getBoundingClientRect();
  const item = groundItems.pickAt(muCamera.camera, sx, sy, rect, 22);
  if (item !== null) return { kind: 'get', id: item };
  const npc = remotes.hoverAt(muCamera.camera, sx, sy, rect, 'npc');
  if (npc !== null) return { kind: 'talk', id: npc };
  const mon = remotes.hoverAt(muCamera.camera, sx, sy, rect, 'monster');
  if (mon !== null) return { kind: 'attack', id: mon };
  return null;
}

/** 屏幕坐标 → 地面落点（和点击走同一条换算） */
function terrainPointAt(sx: number, sy: number) {
  if (!world) return null;
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((sx - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((sy - rect.top) / rect.height) * 2 + 1;
  return pickTerrainPoint(muCamera.camera, ndcX, ndcY, world.terrain.getHeight);
}

/**
 * 光标切换 + 按住左键续走。
 *
 * 原版 `Cursor_Render.cpp` 的优先级：物品(get) > NPC(talk) > 可交互物件 >
 * 怪物(attack) > 按住左键时 push / dontmove > 默认箭头。
 */
/* ------------------------------------------------------------------ */
/* 可交互世界物件（坐下 / 倚靠 / 诺利亚浮空球）                          */
/* ------------------------------------------------------------------ */
/**
 * 原版链路（CONFIRMED_SOURCE）：
 *
 *   `SpecialObject_HoverTest`（`Input/Mouse_Hover.cpp:586`）从 `DAT_083a2370`
 *   （`Entity_InitRenderState` 注册的可操作物件表）里挑第一个被鼠标射线打中的，
 *   写进 `SelectedOperate`；
 *   `Player_InputTick.cpp:1133-1195` 拿到它就置 `MOVEMENT_OPERATE`、寻路到物件旁，
 *   到了再 `Action()`；
 *   `Combat.cpp:2360` 的 operate 分支按 **World + 物件 Type** 决定动作：
 *
 *     v307（坐）      → 动作 133 / 精灵 135，发 `0x18 action=108`
 *     v309（倚靠）    → 动作 139 / 精灵 140，发 `0x18 action=109`
 *     诺利亚 38（浮空）→ 动作 137 / 精灵 138，发 `0x18 action=110`
 *
 * 哪些 Type 会被注册成 operable，来自 `Scene/Scene_EntityLifecycle.cpp::CreateObject`
 * 里 World/Type 的 switch（没列出来的类型不会被注册，也就点不了）。
 * 光标用哪张图看 `Cursor_Render.cpp:78`：World 0/1/2/3 里 Type 133/60/91/38 用
 * `Cursorleanagainst`（8），其余一律 `Cursorsitdown`（9）。
 */
/**
 * 名字兜底：这几种模型就算 Type 撞上了表格也不当可交互物件。
 *
 * 洛兰的 operate 表里有 `case 6`，但 .obj 里 Type 6 是 `Tree07`（36 棵），
 * 让树能坐下显然不对 —— 反编译那份 switch 的 6 大概率是抄错了一位
 * （同组的 146 = `Furniture07`、133 = `PoseBox01` 都是正常的坐具/锚点）。
 * 参考客户端里能坐的是**家具 + PoseBox**，所以按模型名把树/草/蘑菇挡掉。
 */
const NON_OPERABLE_NAME_RE = /^(Tree|Grass|Mushroom)/i;

const OPERABLE_BY_MAP: Record<number, Record<number, 'sit' | 'lean' | 'orb'>> = {
  0: { 6: 'sit', 145: 'sit', 146: 'sit', 133: 'lean' }, // 洛兰：长椅 / 椅子 / 栏杆
  1: { 59: 'sit', 60: 'lean' }, // 地下城
  2: { 22: 'sit', 25: 'sit', 40: 'sit', 45: 'sit', 55: 'sit', 73: 'sit', 91: 'lean' }, // 冰风谷
  3: { 8: 'sit', 38: 'orb' }, // 诺利亚：椅子 + 浮空球
  7: { 39: 'lean' }, // 亚特兰蒂斯
  8: { 78: 'sit' }, // 塔坎
};
/** `Cursor_Render.cpp:78` 的「这张图上哪个 Type 用倚靠光标」 */
const LEAN_CURSOR_TYPE: Record<number, number> = { 0: 133, 1: 60, 2: 91, 3: 38 };

interface Operable {
  /** 物件 Type（`CreateObject` 的 param_1，也是 .obj 里的 id） */
  id: number;
  name: string;
  /** 世界坐标（格） */
  x: number;
  y: number;
  kind: 'sit' | 'lean' | 'orb';
}

/** 当前地图的可交互物件（换图时重建） */
let operables: Operable[] = [];
let operableMapId = -1;
/** 鼠标这一帧指着的可交互物件 */
let operableHover: Operable | null = null;
/** 点了物件但还没走到（到位后播动作） */
let pendingOperate: Operable | null = null;
/**
 * 当前的「坐/倚靠/浮空」姿势动作号（0 = 没有）。
 *
 * 主循环里「站住 → 播待机动作」那条会每帧把动作顶回 1/9，坐下就被顶掉了。
 * 原版是 `entity+0x2ed` 的 operate 状态 + `SetPlayerStop` 的分支，这里是等价物：
 * 有值时待机动作换成它，一移动 / 攻击就清空。
 */
let restAction = 0;

/** 按当前地图从 `objects.placed` 里筛出 operable（原版由 CreateObject 注册） */
function syncOperables() {
  if (!world) {
    operables = [];
    operableMapId = -1;
    return;
  }
  if (operableMapId === world.mapId) return;
  operableMapId = world.mapId;
  const table = OPERABLE_BY_MAP[world.mapId] ?? {};
  // `placed` 是**看得见**的物件；`hiddenPlaced` 是 PoseBox 这类隐藏锚点 ——
  // 原版一样把它们注册成可交互（洛兰的 `case 133` 就是 PoseBox）
  const all = [...world.objects.placed, ...world.objects.hiddenPlaced];
  operables = all
    .filter(o => table[o.id] && !NON_OPERABLE_NAME_RE.test(o.name))
    .map(o => ({ id: o.id, name: o.name, x: o.x, y: o.y, kind: table[o.id] }));
}

/**
 * 屏幕坐标 → 最近的可交互物件。
 *
 * 原版是「鼠标射线 × 物件 OBB」（`Collision_SegmentToOBB`），我们的物件在渲染时
 * 已经按材质合批成几大块几何（为了 draw call），单个物件没有自己的 mesh 可射线，
 * 所以改成**把物件基座投影到屏幕，比屏距**：阈值 46px 大约等于一个椅子在
 * 默认镜头下的占屏尺寸，落在物件旁边一点也点得到，不会盖住地面点击。
 */
function pickOperableAt(clientX: number, clientY: number): Operable | null {
  if (!world || !player) return null;
  syncOperables();
  if (!operables.length) return null;
  const rect = canvas.getBoundingClientRect();
  const v = new THREE.Vector3();
  let best: Operable | null = null;
  let bestD = 46 * 46;
  for (const o of operables) {
    // 物件基座往上抬 0.35 格，投影点落在椅面附近而不是地面
    const z = world.terrain.getHeight(o.x, o.y) + 0.35;
    v.set(o.x, o.y, z).project(muCamera.camera);
    if (v.z > 1) continue; // 在相机背后
    const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
    const d = (sx - clientX) * (sx - clientX) + (sy - clientY) * (sy - clientY);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/** 这个物件该用哪张光标图（`Cursor_Render.cpp:78` 的 per-World 匹配） */
function cursorOfOperable(o: Operable): 'sit' | 'lean' {
  return LEAN_CURSOR_TYPE[world?.mapId ?? -1] === o.id ? 'lean' : 'sit';
}

/**
 * 坐下 / 倚靠 / 浮空：播动作 + 上行 `0x18`。
 *
 * 动作用循环（`loop=true`）——原版这几个姿势是一直保持的，松开就站起来是靠
 * 后续的移动/攻击动作把状态顶掉。
 */
function doOperate(o: Operable) {
  if (!player || !world) return;
  const elf = animInput().cls === 2;
  const anim = o.kind === 'sit' ? (elf ? 135 : 133) : o.kind === 'lean' ? (elf ? 140 : 139) : elf ? 138 : 137;
  const actionId = o.kind === 'sit' ? 108 : o.kind === 'lean' ? 109 : 110;

  // 面向物件
  player.yaw = Math.atan2(o.y - player.y, o.x - player.x) + MODEL_YAW_OFFSET;
  movePath = [];
  moveGoal = null;
  restAction = anim;
  player.play(anim, true);

  if (loggedIn && connection?.connected) {
    const dir = dirFromDelta(Math.round(o.x - player.x), Math.round(o.y - player.y));
    connection.send(buildActionPacket(dir, actionId));
  }
  console.log(`[operate] ${o.name}#${o.id} → 动作 ${anim}（0x18 action=${actionId}）`);
  logClick(`  → operate ${o.name}#${o.id} ${o.kind} 动作=${anim}`);
}

/** 点物件：够近就直接坐，远就走过去（原版 `MOVEMENT_OPERATE` 那套） */
function tryOperate(o: Operable) {
  if (!player || !world) return;
  autoAttackId = -1;
  pendingTargetId = -1;
  focusId = -1;
  pendingPickupId = -1;
  npcPendingId = -1;

  const d = Math.hypot(o.x - player.x, o.y - player.y);
  /*
   * 只有**已经站在物件格上/贴着一格**才原地坐下；否则一定走一次
   * （`walkToCell` 会让服务端也收到那几步，位置不会和服务器脱节）。
   */
  if (d <= 1.2) {
    pendingOperate = null;
    doOperate(o);
    return;
  }
  pendingOperate = o;
  // 物件本身那格通常不可站，走到它旁边最近的空格
  walkToCell(o.x, o.y);
}

function updateOperate() {
  if (!pendingOperate || !player) return;
  const d = Math.hypot(pendingOperate.x - player.x, pendingOperate.y - player.y);
  if (d <= 2.6 && movePath.length === 0) {
    const o = pendingOperate;
    pendingOperate = null;
    doOperate(o);
    return;
  }
  // 路走完了还没到（目标不可达）→ 放弃，别一直挂着
  if (movePath.length === 0) pendingOperate = null;
}

function updateHover(force = false) {
  if (!world || !player || hoverX < 0) return;
  const now = performance.now();
  if (!force && now - hoverAtMs < 60) return;
  hoverAtMs = now;

  const hit = hoverTarget(hoverX, hoverY);
  if (hit) {
    operableHover = null;
    setCursor(hit.kind);
    return;
  }

  /*
   * 可交互物件（椅子/栏杆/浮空球）：原版光标优先级是
   * 地面物品 > NPC > SelectedOperate > 攻击/箭头（`Cursor_Render.cpp:60-100`），
   * 所以放在实体之后、地面之前。
   */
  const op = pickOperableAt(hoverX, hoverY);
  operableHover = op;
  if (op) {
    setCursor(cursorOfOperable(op));
    return;
  }

  const p = terrainPointAt(hoverX, hoverY);
  const walkable = p ? terrainWalkable(Math.floor(p.x), Math.floor(p.y)) : false;

  if (lmbDown) {
    setCursor(walkable ? 'push' : 'dontmove');
    // 按住左键不放 → 每 250ms 把目标重设到光标下的格子（原版 / muonlinejs 的拖动走位）
    if (walkable && p && now - lastHoldAt > 250) {
      lastHoldAt = now;
      walkToCell(p.x, p.y);
    }
    return;
  }

  setCursor('arrow');
}

/**
 * 修理光标（`Cursorrepair.ozt` = 位图 7，原版那个转动的钻头）。
 *
 * 原版 `Cursor_Render.cpp:111` 的判据是 `RepairEnable_0 == 1|2` ——
 * 在铁匠那里进入「修理模式」后，光标整屏都变成钻头，点哪件就修哪件。
 *
 * 我们的修理入口是「商店面板开着时右键背包物品」（见 `inventoryPanel.onDiscard`），
 * 所以判据换成「商店开着 + 指向背包里**有损耗**的装备」：钻头只会出现在
 * 真的能修的东西上，其他地方保持普通箭头。`elementFromPoint` 找格子，
 * 和其他面板一样靠 `data-slot`，不需要每件物品各挂一个监听。
 */
window.addEventListener(
  'pointermove',
  e => {
    if (!npcPanel.isOpen || npcMode !== 'shop') return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cell = el?.closest('[data-drag-panel="inventory"] [data-slot]') as HTMLElement | null;
    if (!cell) return; // 不在背包格上（画布那半边交给 updateHover）
    const slot = Number(cell.dataset.slot);
    const item = inventoryItems.find(i => i.slot === slot);
    if (!item) {
      setCursor('arrow');
      return;
    }
    const attr = itemAttr(item.type);
    // 装备槽才算「能修」（药水/卷轴的 durability 是数量，不是耐久）
    const repairable = item.slot < INVENTORY_WEAR_SIZE && attr.dura > 0;
    const damaged = repairable && Math.round(item.durability || 0) < attr.dura;
    setCursor(damaged ? 'repair' : 'arrow');
  },
  { passive: true }
);

/**
 * 右键点击 = 放技能。
 *
 * 目标优先级：鼠标下的怪物/NPC → 当前锁定 → 视野里最近的怪 → 无目标(0，自施法)。
 * 和 Win 端一致：左键平砍、右键技能。
 */
function castSkillAtPointer(sx: number, sy: number) {
  if (!player || playerDead) return false;
  const hit = hoverTarget(sx, sy);
  let target = hit && (hit.kind === 'attack' || hit.kind === 'talk') ? hit.id : -1;
  if (target < 0) target = focusId;
  if (target < 0) {
    let best = -1;
    let bestD = Infinity;
    for (const e of remotes.list()) {
      if (e.kind !== 'monster' || e.dying) continue;
      const d = Math.hypot(e.x - player.wx, e.y - player.wy);
      if (d < bestD) {
        bestD = d;
        best = e.id;
      }
    }
    target = best;
  }
  const ok = useSelectedSkill(target > 0 ? target : 0);
  if (!ok) console.log('[skill] 右键施法没发出去（没选技能 / 蓝不够 / 没目标）');
  return ok;
}

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointerdown', e => {
  if (!world || !player) return;
  canvas.setPointerCapture(e.pointerId);
  lastPointer = { x: e.clientX, y: e.clientY };

  /*
   * 鼠标右键 = **放技能**（Win 端行为）；但右键拖动又是转镜头。
   * 折中：按下时先不定性，移动超过 6px 才算拖动转镜头，松开时没拖动就施法。
   */
  if (e.button === 2) {
    rightState = { x: e.clientX, y: e.clientY, dragged: false };
    return;
  }
  if (e.button === 1) {
    rotating = true;
    return;
  }

  if (e.button === 0) {
    lmbDown = true;
    hoverX = e.clientX;
    hoverY = e.clientY;
    /*
     * 按下这一下不要触发「按住续走」——点击本身已经会走一格，
     * 这里只是把光标切成 push/dontmove。续走从 250ms 之后才开始。
     */
    lastHoldAt = performance.now();
    updateHover(true);
    const rect = canvas.getBoundingClientRect();
    /** 这一下鼠标到底落在谁身上 —— 落在 HUD 面板上时 canvas 根本收不到事件 */
    const hitEl = document.elementFromPoint(e.clientX, e.clientY);
    const hitTag = hitEl ? `${hitEl.tagName.toLowerCase()}${hitEl.id ? '#' + hitEl.id : ''}` : 'null';
    logClick(`down ${e.clientX.toFixed(0)},${e.clientY.toFixed(0)} hit=${hitTag} btn=${e.button}`);

    // 商店/仓库/混沌机开着时点画面 = 想干别的：先按原版习惯把界面收掉
    // （混沌机里还有材料时会拒绝关闭，别让一次误点把材料清掉）
    if (chaosPanel.isOpen) chaosPanel.requestClose();
    else if (npcPanel.isOpen) closeNpcPanel();

    // 点地面物品 → 走过去捡（物品比怪物小，命中判定放前面，不然贴着怪掉的
    // 东西永远点不到）
    const itemId = groundItems.pickAt(muCamera.camera, e.clientX, e.clientY, rect);
    if (itemId !== null && tryPickup(itemId)) {
      logClick(`  → item#${itemId} 走过去捡`);
      pendingTargetId = -1;
      autoAttackId = -1;
      focusId = -1;
      return;
    }

    // 点到 NPC → 对话（服务端只认 ±5 格，太远先走过去，到了自动开口）
    const npcId = pickNpcAt(e.clientX, e.clientY);
    if (npcId !== null) {
      logClick(`  → npc#${npcId} 对话`);
      movePath = [];
      pendingTargetId = -1;
      autoAttackId = -1;
      focusId = -1;
      talkToNpc(npcId);
      return;
    }

    // 点到怪物 → 攻击（太远就先走过去），否则走位
    const monsterId = pickMonsterAt(e.clientX, e.clientY);
    if (monsterId !== null) {
      logClick(`  → monster#${monsterId} 攻击`);
      movePath = [];
      /*
       * Win 端：**左键 = 普通攻击，右键 = 技能**。
       *
       * 以前是「选了技能后左键就变施法」，导致选了技能再也没法平砍，
       * 而且和原版操作相反。现在左键永远平砍，技能走右键（见 pointerup）。
       */
      tryAttack(monsterId);
      // 点一下就一直打到它死（原版 m_bAutoAttack 默认开）
      autoAttackId = monsterId;
      return;
    }

    // 点到可交互物件（椅子/栏杆）→ 走过去坐下（原版 MOVEMENT_OPERATE）
    const op = pickOperableAt(e.clientX, e.clientY);
    if (op) {
      logClick(`  → operate#${op.id} ${op.kind}`);
      tryOperate(op);
      return;
    }

    pendingTargetId = -1;
    autoAttackId = -1;
    focusId = -1;
    pendingPickupId = -1;

    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const point = pickTerrainPoint(muCamera.camera, ndcX, ndcY, world.terrain.getHeight);
    if (point) {
      const ok = walkToCell(point.x, point.y);
      logClick(
        `  ground pt=${point.x.toFixed(2)},${point.y.toFixed(2)} cell=${Math.floor(point.x)},${Math.floor(
          point.y
        )} ok=${ok}${ok ? '' : ' why=' + walkFail} goal=${
          moveGoal ? `${moveGoal.x},${moveGoal.y}` : '-'
        } path=${movePath.length}`
      );
      if (marker) {
        /*
         * 标记只画在**真实目标格**上。
         *
         * 以前是 `moveGoal ? moveGoal : floor(point)` —— 走不到的时候（目标在墙里
         * 或者被占）就退回到「点下去的那一格」，于是圆圈画在墙里/水里、人却不动，
         * 看起来就是「明明点了这个圈，人却不来」。
         */
        if (ok && moveGoal) {
          const mx = moveGoal.x + 0.5;
          const my = moveGoal.y + 0.5;
          marker.position.set(mx, my, world.terrain.getHeight(mx, my) + 0.06);
          markerLife = 0.9;
        } else {
          markerLife = 0;
        }
      }
    } else {
      logClick('  ray-miss（射线没打到地面）');
    }
  }
});

canvas.addEventListener('pointermove', e => {
  hoverX = e.clientX;
  hoverY = e.clientY;

  // 右键：超过阈值才转成「拖动转镜头」
  if (rightState && !rightState.dragged) {
    if (Math.hypot(e.clientX - rightState.x, e.clientY - rightState.y) > 6) {
      rightState.dragged = true;
      rotating = true;
      lastPointer = { x: e.clientX, y: e.clientY };
    }
  }

  if (rotating) {
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    lastPointer = { x: e.clientX, y: e.clientY };
    muCamera.rotate(dx, dy);
    return;
  }

  updateHover();
});

/*
 * 离开画布：光标回到默认箭头（不然会停在"攻击"上看着怪）
 * —— leave 时 pointermove 不再触发，必须显式复位。
 */
canvas.addEventListener('pointerleave', () => {
  hoverX = -1;
  hoverY = -1;
  setCursor('arrow');
});

/*
 * 鼠标在 UI 面板上（背包/仓库/商店/聊天框）：
 * 原版是**自绘光标**，面板上照样画箭头，所以这里也统一回箭头，
 * 不然从怪身上划进面板会一直顶着个准星。
 */
window.addEventListener(
  'pointermove',
  e => {
    if (e.target === canvas) return;
    if (hoverX !== -1 || hoverY !== -1) {
      hoverX = -1;
      hoverY = -1;
    }
    setCursor('arrow');
  },
  true
);

canvas.addEventListener('pointerup', e => {
  rotating = false;
  if (e.button === 2) {
    const st = rightState;
    rightState = null;
    // 没拖动过 = 一次右键点击 → 放技能（对着鼠标下的目标）
    if (st && !st.dragged) castSkillAtPointer(st.x, st.y);
  }
  if (e.button === 0) {
    lmbDown = false;
    updateHover(true);
  }
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
});

/* 指针被系统取消（切窗口、触摸被打断）：把按压状态收干净，别让光标卡在 push */
canvas.addEventListener('pointercancel', () => {
  rotating = false;
  rightState = null;
  lmbDown = false;
  updateHover(true);
});

canvas.addEventListener(
  'wheel',
  e => {
    e.preventDefault();
    muCamera.zoom(e.deltaY);
  },
  { passive: false }
);

window.addEventListener('keydown', e => {
  // 聊天输入框开着：键盘全归它（Enter 发送、Esc 取消、上下翻历史）
  if (chatBox.isTyping) return;

  /*
   * NPC 对话窗（原版也是数字键选答案）：1..0 选一条，Esc 关掉。
   * 放在这里，别让下面的数字键选技能抢走。
   */
  /*
   * 帮助窗（原版 F1 = 帮助 On/Off，见 Text.bmd[121]「F1 : 帮助 On/Off」）
   * 开着的时候 Esc 也关，其它按键不拦。
   */
  /*
   * ESC 菜单开着：Esc 先退回上一层（选项 → 主菜单，主菜单 → 关掉），
   * 这一点和原版一致（菜单本身就是 `ErrorMessage = 110` 的 toggle）。
   */
  if (escMenu.isOpen && e.code === 'Escape') {
    e.preventDefault();
    autoAttackId = -1;
    escMenu.escKey();
    return;
  }
  if (e.code === 'F1') {
    e.preventDefault();
    void helpWindow.toggle();
    return;
  }
  if (helpWindow.isOpen && e.code === 'Escape') {
    e.preventDefault();
    helpWindow.hide();
    return;
  }

  if (npcDialog.isOpen) {
    if (e.code === 'Escape') {
      e.preventDefault();
      npcDialog.hide();
      return;
    }
    const d = digitKeyOf(e.code);
    if (d && npcDialog.pickByDigit(d)) {
      e.preventDefault();
      return;
    }
  }

  /*
   * 移动命令窗口开着：↑↓ 选项、Enter 传送、Esc/M 关闭。
   * 这一段必须在下面「Enter 开聊天」和 Escape「回选角」之前，
   * 否则按 Enter 会开聊天、按 Esc 会直接把人踢回选角界面。
   */
  if (movePanel.isOpen) {
    if (e.code === 'Escape' || e.code === 'KeyM') {
      e.preventDefault();
      movePanel.hide();
      return;
    }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      movePanel.move(e.code === 'ArrowUp' ? -1 : 1);
      return;
    }
    // 23 条一屏放不下：Home/End 直接跳首尾，PageUp/PageDown 翻一屏（12 行）
    if (e.code === 'Home' || e.code === 'End') {
      e.preventDefault();
      movePanel.jump(e.code === 'Home' ? -1 : 1);
      return;
    }
    if (e.code === 'PageUp' || e.code === 'PageDown') {
      e.preventDefault();
      movePanel.move(e.code === 'PageUp' ? -12 : 12);
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      e.preventDefault();
      movePanel.confirm();
      return;
    }
  }

  /*
   * 选角界面的 ESC（原版没有 → 网页端补的出口）。
   *
   * 只给三个选项：返回线路选择 / 选项 / 取消。这里同时要处理
   * 「新建角色面板开着」的情况：那时候 ESC 应该先关面板（和游戏内一致）。
   */
  if (e.code === 'Escape' && !charScreen.classList.contains('hidden')) {
    e.preventDefault();
    if (!document.getElementById('create-panel')?.classList.contains('hidden')) {
      closeCreatePanel();
      return;
    }
    if (escMenu.escKey()) return; // 菜单已开：选项 → 主菜单 → 关闭
    escMenu.show('charselect');
    return;
  }

  /*
   * 读条没结束（`#loading` 还盖着）时不吃 ESC：那会儿世界还在加载，
   * `showScreens({hud:true})` 随时会把菜单顶掉，按出来又消失很怪。
   * 原版读条期间也不响应 ESC。
   */
  if (e.code === 'Escape' && inGameWorld() && loadingEl.classList.contains('hidden')) {
    // 有面板开着就先关面板，别直接把人踢回选角
    if (svdPanel.isOpen) {
      svdPanel.escKey();
      return;
    }
    if (gaPanel.isOpen) {
      closeGoldenArcher();
      return;
    }
    if (eventPanel.isOpen) {
      closeEventWindow();
      return;
    }
    if (guildPanel.isOpen) {
      guildPanel.hide();
      bottomBar.setActive(null);
      return;
    }
    if (partyPanel.isOpen) {
      partyPanel.hide();
      bottomBar.setActive(null);
      return;
    }
    if (questPanel.isOpen) {
      questPanel.hide();
      return;
    }
    if (chaosPanel.isOpen) {
      // 箱子里有东西时会被拦下并提示（原版 ChaosBoxRequestClose 同款）
      chaosPanel.requestClose();
      return;
    }
    if (npcPanel.isOpen) {
      closeNpcPanel();
      return;
    }
    if (inventoryPanel.isOpen) {
      inventoryPanel.hide();
      bottomBar.setActive(null);
      return;
    }
    if (characterPanel.isOpen) {
      toggleCharacter(false);
      return;
    }
    /*
     * 没有面板开着 → 打开 ESC 菜单（原版 `UI_InGameMenu.cpp` L534-572：
     * `if (PressKey(27) && !EquipmentItem) ErrorMessage = 110;`）。
     *
     * 以前这里是「直接 closeClient(0) 回选角」，和原版差了一整层菜单 ——
     * 原版必须再点一次「回到选择角色画面」才走人。
     */
    autoAttackId = -1;
    pendingTargetId = -1;
    // 菜单已经开着就关掉（原版 toggle），否则打开
    if (!escMenu.escKey()) escMenu.show('game');
    return;
  }
  // 打字的时候别抢快捷键
  const tag = (e.target as HTMLElement | null)?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA';

  // Enter 开聊天（原版 Player_InputTick.cpp 里 Enter 就是 InputEnable=1）
  if (!typing && e.code === 'Enter' && loggedIn && session) {
    e.preventDefault();
    chatBox.open();
    return;
  }
  // 输入框里打字的按键不能再进 keys，否则 WASD 会一边打字一边跑
  if (typing) return;

  // M = 移动命令（0.97 没有这个键，是后期版本才有的跨图窗口）
  if (e.code === 'KeyM' && player && world) {
    e.preventDefault();
    refreshMovePanel();
    movePanel.show();
    return;
  }

  // C = 角色属性面板（原版 Player_InputTick.cpp:304-318）
  if (!typing && e.code === 'KeyC') {
    e.preventDefault();
    toggleCharacter();
    return;
  }
  // P = 收起/展开离线演示沙盘（原版没有这个键，纯调试用；和右下角按钮同一条路径）
  if (!typing && e.code === 'KeyP' && sandbox.on) {
    e.preventDefault();
    sandboxPanel.toggleUser();
    return;
  }
  // 原版 V 和 I 都开背包（Player_InputTick.cpp:475-476）
  if (!typing && e.code === 'KeyT') {
    e.preventDefault();
    if (tradePanel.isOpen) {
      tradePanel.onCancel?.();
    } else if (tradePanel.pendingRequest) {
      tradePanel.show('', 0);
    } else {
      chatBox.push('系统', '交易：聊天框输入 /trade 玩家名 发起', 1);
    }
    return;
  }
  if (!typing && e.code === 'KeyP') {
    e.preventDefault();
    togglePartyPanel();
    return;
  }
  if (!typing && e.code === 'KeyJ') {
    e.preventDefault();
    void toggleQuestPanel();
    return;
  }
  /*
   * 战盟窗口：原版快捷键是 **`G`**（`Player_InputTick.cpp:478` `PressKey(0x47)`），
   * 另一个入口是底栏 (582,459) 52×18 的 `Guild.jpg` 图标（打开时才亮）。
   * 之前这里用 `O` 是自己起的，和 Win 端不一致。
   */
  if (!typing && e.code === 'KeyG') {
    e.preventDefault();
    toggleGuildPanel();
    return;
  }
  if (!typing && (e.code === 'KeyI' || e.code === 'KeyV')) {
    e.preventDefault();
    toggleInventory();
    return;
  }
  /*
   * Tab = 小地图开关。
   *
   * 0.97 客户端没有小地图（这是 H5 版加的），所以没有「原版按键」可抄；
   * 用 Tab 是因为它和移动/技能/面板都不冲突，而且是地图类功能的通行键位。
   * `preventDefault` 必须加，否则浏览器会把焦点跳到下一个可聚焦元素。
   */
  if (!typing && e.code === 'Tab') {
    e.preventDefault();
    const on = minimap.toggle();
    if (on) syncMinimap();
    return;
  }
  if (!typing && e.code === 'KeyG' && player) {
    e.preventDefault();
    const near = groundItems.nearest(player.x, player.y, 3);
    if (near) tryPickup(near.id);
    return;
  }

  /*
   * Q / W / E 喝药：和 HUD 上那三个快捷槽一一对应
   * （`QUICK_RANGES`：Q 治疗、W 魔法、E 辅助/解毒）。
   * 只做「使用」不做「选中」—— 原版也是按一下喝一瓶。
   */
  if (!typing && (e.code === 'KeyQ' || e.code === 'KeyW' || e.code === 'KeyE') && loggedIn) {
    e.preventDefault();
    useQuickSlot(e.code === 'KeyQ' ? 0 : e.code === 'KeyW' ? 1 : 2);
    return;
  }

  /*
   * 数字键 1..0 选技能 —— 原版 `SelectSkillByHotkey`（`UI_LegacyGameHelpers.cpp:138`）。
   * 从 `Chat_InputTick.cpp:663-676` 抄过来的两个门：输入框没开、没按 Alt
   * （Alt+数字 是聊天宏，我们没做宏，但仍然让开）。
   *
   * **Ctrl + 数字** 是「把数字设成悬停那格的快捷键」
   * （`Chat_InputTick.cpp:628-646`），所以 Ctrl 优先、且只在技能栏展开时生效。
   */
  const digit = digitKeyOf(e.code);
  if (!typing && digit > 0 && loggedIn && !e.altKey) {
    if (e.ctrlKey && skillBar.assignHotkey(digit)) {
      e.preventDefault();
      return;
    }
    if (!e.ctrlKey && selectSkillByHotkey(digit)) {
      e.preventDefault();
      return;
    }
  }

  keys.add(e.code);
  /*
   * 空格**不再**当普通攻击。
   *
   * 以前这里绑了 `tryAttack()`，但它和聊天/移动命令面板抢键（那两处
   * 都把 Space 当「确认」），而且原版根本没有这个键位 —— 0.97 的左键
   * 才是普通攻击（`Player_InputTick.cpp` 的鼠标分支），顺手按空格砍怪
   * 纯属网页端自加。要连续攻击用「点住怪物」那套自动连击。
   */
});
window.addEventListener('keyup', e => keys.delete(e.code));

function onResize() {
  const { w, h } = stageSize();
  renderer.setSize(w, h);
  muCamera.camera.aspect = ASPECT;
  muCamera.camera.updateProjectionMatrix();
  // 原版 UI 层跟着舞台缩放，逻辑坐标不变
  uiLayer.resize();
  login3d?.resize();
  char3d?.resize();
  void rescaleCursors(uiLayer.scaleFactor);
}

window.addEventListener('resize', onResize);
// 舞台尺寸由 CSS 决定（min(100vw, 100vh*4/3)），窗口变化时也要跟着改渲染缓冲
new ResizeObserver(onResize).observe(stageEl);

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */
const moveDir = new THREE.Vector3();
const camForward = new THREE.Vector3();
const camRight = new THREE.Vector3();
const fpsEl = $('stat-fps');
const posEl = $('stat-pos');
let fpsAcc = 0;
let fpsFrames = 0;
let hudTimer = 0;

/** 目标血条（服务端只给当前 HP，上限是首次受伤时反推的） */
function updateTargetHud() {
  const e = focusId >= 0 ? remotes.get(focusId) : null;
  if (!e || e.dying) {
    targetEl.classList.add('hidden');
    return;
  }
  targetEl.classList.remove('hidden');
  targetName.textContent = e.name;
  const pct = e.maxLife > 0 ? Math.max(0, Math.min(1, e.life / e.maxLife)) : 1;
  targetFill.style.width = `${(pct * 100).toFixed(1)}%`;
}

function frame() {
  requestAnimationFrame(frame);

  const dt = Math.min(clock.getDelta(), 0.1) * dbgTimeScale;

  if (world && player) {
    /* ---- 死亡时锁住操作 ---- */
    if (playerDead) {
      keys.clear();
      movePath = [];
      player.update(dt);
      remotes.update(dt);
      groundItems.update(dt);
      syncItemLabels();
      damageTexts.update(dt, muCamera.camera);
      world.objects.update(dt, player.x, player.y);
      world.objectFx.update(dt, player.x, player.y);
      world.ambient.update(dt, player.x, player.y, player.z, ambientPointScale());
      updateWaterLayer(dt);
      return;
    }

    // 单位占位每 0.2 秒重建一次：NPC/怪走位后能及时让出格子
    blockedTimer += dt;
    if (blockedTimer >= 0.2) {
      blockedTimer = 0;
      refreshBlocked();
    }

    /* ---- 移动 ---- */
    moveDir.set(0, 0, 0);
    /*
     * 本帧最多走多远（格）。默认是一帧的位移，但如果离当前路径节点更近，
     * 就**正好走到节点**为止 —— 不然会冲过去 0.2 格，而到点判定要求 < 0.05，
     * 结果就是永远「差一点」，人卡在半路（intmove 探针抓到过）。
     */
    let stepLen = WALK_SPEED * dt;
    camForward.copy(muCamera.getForward());
    camRight.copy(muCamera.getRight());

    /*
     * 只留方向键：WASD 已按用户要求取消（W 现在是快捷栏 2，A/D 会和移动打架，
     * 手机上也没有键盘）。走位统一交给「左键点地板」。
     */
    if (keys.has('ArrowUp')) moveDir.add(camForward);
    if (keys.has('ArrowDown')) moveDir.sub(camForward);
    if (keys.has('ArrowRight')) moveDir.add(camRight);
    if (keys.has('ArrowLeft')) moveDir.sub(camRight);

    if (moveDir.lengthSq() > 0) {
      // 键盘操作优先，打断寻路
      moveDir.normalize();
      movePath = [];
      pathCursor = 0;
      moveGoal = null;
    } else if (movePath.length > 0) {
      /*
       * 沿 A* 路径走。
       *
       * 到点判定用**距离**（< 0.05 格），不用「所在格子（floor）已经是指定格」——
       * 后者在刚跨进格子边缘（还差将近一整格）时就算到达，紧接着又被对齐到格号，
       * 最后一步会硬跳 0.7~1.0 格。视觉上就是「人没走、位置滑过去」的滑步
       * （阶段 BE 试过「相邻格直接落位」，同一个毛病，已经回退）。
       *
       * 步序上报不靠这里：`onEnterCell` 在真正跨格（floor 变化）时才记一步，
       * 所以服务端收到的 PathX 链还是逐格正确的。
       */
      while (pathCursor < movePath.length) {
        const node = movePath[pathCursor];
        if (Math.hypot(node.x - player.x, node.y - player.y) < 0.05) {
          // 到点：吸附到整数格号（误差 < 0.05，看不出来）
          player.x = node.x;
          player.y = node.y;
          pathCursor++;
          continue;
        }
        break;
      }

      if (pathCursor >= movePath.length) {
        moveClearReason = 'end';
        movePath = [];
        pathCursor = 0;
        moveGoal = null;
      } else {
        // 前方的路被别的角色占住了 → 提前重算，别等撞上去再停。
        // 每帧都查一遍太贵，用 250ms 节流；只查最近 3 个节点，
        // 足够覆盖「一秒内会走到」的范围。
        const nowMs = performance.now();
        if (moveGoal && nowMs - lastRepathAt > 250) {
          let taken = false;
          const end = Math.min(pathCursor + 3, movePath.length);
          for (let i = pathCursor; i < end; i++) {
            if (unitBlocked(movePath[i].x, movePath[i].y)) {
              taken = true;
              break;
            }
          }
          if (taken) {
            lastRepathAt = nowMs;
            if (walkToCell(moveGoal.x, moveGoal.y, true)) {
              moveClearReason = 'repath-unit';
            }
          }
        }

        /*
         * 走向**整数格点**，不是格心。
         *
         * 原版（Win 客户端 / muonlinejs）里角色坐标恒为整数：`lpObj->X/Y` 是格号，
         * 渲染直接画在 `(X, Y)`，不额外加 0.5。我们的怪/NPC/其它玩家本来就落在
         * 服务端给的整数坐标上，只有玩家一直在 +0.5 的格心 —— 于是玩家跟所有人
         * 差半格，站墙边/挑物品时距离也算歪。
         */
        const node = movePath[pathCursor];
        const dx = node.x - player.x;
        const dy = node.y - player.y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-4) {
          moveDir.set(dx / d, dy / d, 0);
          // 这一帧能走到节点就正好停在节点上，不冲过头
          if (d < stepLen) stepLen = d;
        }
      }
    }

    const isMoving = moveDir.lengthSq() > 0;

    if (isMoving) {
      const stepX = moveDir.x * stepLen;
      const stepY = moveDir.y * stepLen;
      const nx = player.x + stepX;
      const ny = player.y + stepY;

      // 走位时既要看地形，也要看单位占位（NPC / 怪 / 其他玩家）
      const hereX = playerCellX();
      const hereY = playerCellY();
      /** 这一格是否只被单位挡着（地形本身能走） */
      const blockedByUnit = (cx: number, cy: number) => terrainWalkable(cx, cy) && unitBlocked(cx, cy);
      const canEnter = (x: number, y: number) => {
        // 同一套口径：位置 → 格号要 round（渲染在 x+0.5）
        const cx = Math.round(x);
        const cy = Math.round(y);
        // 还在本格内随便动，跨格才判定
        if (cx === hereX && cy === hereY) return true;
        if (!canStand(cx, cy)) return false;
        // 斜向跨格时人会从侧格上掠过去。侧格站着 NPC / 别的玩家时，
        // 这一帧的 floor 会短暂落进对方格子里，被判定成「撞人」——
        // 于是每帧清路径重算、又算出同一条斜线，原地抖个不停。
        // 干脆禁止擦人斜穿，让下面的滑动分支先走一轴绕过去。
        if (cx !== hereX && cy !== hereY) {
          if (unitBlocked(cx, hereY) || unitBlocked(hereX, cy)) return false;
        }
        return true;
      };

      // 某轴没有位移时，不要拿它当「滑动」分支：
      // dir.y == 0 时 canEnter(player.x, ny) 永远等于「还在本格」→ true，
      // 于是代码走进这一支却把 player.y 设成它自己，角色看着完全不动，
      // 也永远进不到「完全被挡」的重算分支。
      const tryX = Math.abs(stepX) > 1e-6;
      const tryY = Math.abs(stepY) > 1e-6;
      const aheadX = Math.round(nx);
      const aheadY = Math.round(ny);

      if (canEnter(nx, ny)) {
        player.x = THREE.MathUtils.clamp(nx, 0, 255);
        player.y = THREE.MathUtils.clamp(ny, 0, 255);
      } else if (blockedByUnit(aheadX, aheadY)) {
        // 撞到「人」不能像撞墙那样沿边滑 —— 沿边滑是绕墙用的，用在人身上
        // 会变成贴着对方横向蹭过去，既不绕路也不重新规划。
        // 正确做法：立刻按当前占位重算一条绕过他的路（250ms 节流，防止抖动）。
        moveClearReason = 'blocked-unit';
        movePath = [];
        pathCursor = 0;
        stuckTimer = 0;
        const nowMs = performance.now();
        if (moveGoal && nowMs - lastRepathAt > 250) {
          lastRepathAt = nowMs;
          walkToCell(moveGoal.x, moveGoal.y, true);
        }
      } else if (tryX && canEnter(nx, player.y)) {
        // 撞墙时沿墙滑动：只走能过的那一轴，避免斜着贴墙就完全卡死
        player.x = THREE.MathUtils.clamp(nx, 0, 255);
      } else if (tryY && canEnter(player.x, ny)) {
        player.y = THREE.MathUtils.clamp(ny, 0, 255);
      } else {
        // 完全被挡住：先停下，攒够 0.8 秒后用同一个目标重算一条路
        moveClearReason = 'blocked';
        movePath = [];
        pathCursor = 0;
        stuckTimer += dt;
        if (stuckTimer > 0.8) {
          stuckTimer = 0;
          if (moveGoal) walkToCell(moveGoal.x, moveGoal.y, true);
        }
      }

      /*
       * 朝向：**瞬转**，和原版一致（服务端收到移动包直接写 `lpObj->Dir`），
       * muonlinejs 也是每帧 `transform.rot.y = atan2(vel)`。
       *
       * 之前这里做的是 `yaw += delta * dt*28` 的插值：点身后那一格时，
       * 位移已经开始了、朝向还要 0.06 秒才转过来，观感就是「人先倒着滑、
       * 再慢慢转正」。改成一步到位以后，点击的同一帧就已经面向目标格
       * （`walkToCell` 里还会再提前掰一次），迈步方向和身体朝向永远是同一个。
       */
      player.yaw = Math.atan2(moveDir.y, moveDir.x) + MODEL_YAW_OFFSET;

      // 走/跑动作由武器和翅膀决定（SetPlayerWalk）：
      // 装翅膀且不在安全区 → 30/31 的飞行跑；否则按剑/弓/法杖分 13..20
      const walkAct = moveAction(animInput());
      restAction = 0; // 一旦迈步就不坐了（原版 SetPlayerWalk 直接换动作）
      if (!isAttacking() && player.action !== walkAct) player.play(walkAct, true);

      /* ---- 跨格：记一步并上报 ---- */
      const cx = playerCellX();
      const cy = playerCellY();
      if (cx !== lastCell.x || cy !== lastCell.y) {
        onEnterCell(cx, cy);

        // 被贴墙滑动挤出了 A* 路径（偏离超过 1 格）→ 按原目标重算
        if (moveGoal && movePath.length > 0 && performance.now() - lastRepathAt > 300) {
          const node = movePath[pathCursor];
          if (node && (Math.abs(node.x - cx) > 1 || Math.abs(node.y - cy) > 1)) {
            lastRepathAt = performance.now();
            walkToCell(moveGoal.x, moveGoal.y);
          }
        }
      }
    } else {
      // 坐着/倚靠时保持那个姿势（`restAction`），否则回待机
      const restAct = restAction || idleAction(animInput());
      // 站住 = `SetPlayerStop`：耐力清零（原版就在函数第一行）
      stamina = 0;
      if (!isAttacking() && player.action !== restAct) player.play(restAct, true);
      // 停下来也把最后几步发出去（服务端 120ms 收一包，别攒着）
      flushMoves();
    }

    // 攻击收招：回到当前装备对应的待机动作（装翅膀时是 9/10 的飞行待机）
    if (isAttacking() && player.finished && !isMoving) {
      player.play(idleAction(animInput()), true);
    }

    /*
     * ---- 卡住自检 ----
     *
     * 「有点击目标、也有路径，但人一动不动」是实机最难查的一类反馈：
     * 光看画面分不清是没生成路径、还是生成了一直走不动。
     * 这里每 0.7 秒量一次位移，没挪窝就把原因写进 clickLog 并自救：
     *   - 第一次：按原目标重算一条路；
     *   - 第二次还没动：放弃这个目标（免得一直原地抖）。
     */
    if (movePath.length > 0) {
      if (!stuckWatch) {
        stuckWatch = { x: player.x, y: player.y, t: performance.now(), tries: 0 };
      } else if (Math.hypot(player.x - stuckWatch.x, player.y - stuckWatch.y) > 0.08) {
        stuckWatch = { x: player.x, y: player.y, t: performance.now(), tries: 0 };
      } else if (performance.now() - stuckWatch.t > 700) {
        logClick(
          `stuck ${player.x.toFixed(2)},${player.y.toFixed(2)} cursor=${pathCursor}/${movePath.length} ` +
            `goal=${moveGoal ? `${moveGoal.x},${moveGoal.y}` : '-'} clear=${moveClearReason} ` +
            `fail=${walkFail || '-'}`
        );
        stuckWatch.tries++;
        if (stuckWatch.tries >= 2) {
          movePath = [];
          pathCursor = 0;
          moveGoal = null;
          moveClearReason = 'stuck-giveup';
          stuckWatch = null;
        } else if (moveGoal) {
          const goal = { ...moveGoal };
          movePath = [];
          pathCursor = 0;
          walkToCell(goal.x, goal.y, true);
          stuckWatch.t = performance.now();
        }
      }
    } else {
      stuckWatch = null;
    }

    // 进出安全区：武器要在「背上 ↔ 手里」之间换，翅膀的飞/走也要切换，
    // 所以一跨过边界就重建一次外观（equipSig 里带了 safeZone，不会白重算）
    const nowSafe = isSafeZoneAt(player.x, player.y);
    if (nowSafe !== lastSafeZone) {
      lastSafeZone = nowSafe;
      void refreshPlayerEquipment();
    }

    // 每帧兜一次：攒着的步序按 120ms 的节奏发出去
    flushMoves();

    player.z = world.terrain.getHeight(player.wx, player.wy);
    player.update(dt);

    /* ---- 武器拖尾：出手期间每帧把刀尖位置推进拖尾 ---- */
    if (isAttacking()) {
      trailLayer.begin();
      trailLayer.push(player.handPosition(tmpHand));
    } else {
      trailLayer.end();
    }
    trailLayer.update(dt);

    for (const m of monsters) m.update(dt);
    remotes.update(dt);
    groundItems.update(dt);
    updatePickup(dt);
    updateNpcTalk();
    effects.update(dt);
    spriteLayer.update(dt);
    beamLayer.update(dt);
    wheelLayer.update(dt);
    slamLayer.update(dt);
    // buff 视觉跟着角色走（自己 + 视野里的所有人）
    buffLayer.update(dt, buffActorPos);
    if (castCd > 0) castCd -= dt;

    /* ---- 战斗 ---- */
    if (attackCd > 0) attackCd -= dt;

    /*
     * ---- 自动连续攻击 ----
     *
     * 原版 `Player_InputTick.cpp` L1392：只要 `m_bAutoAttack` 开着、`Attacking == 1`、
     * 目标还有效，每帧都会再走一遍「够近就出手 / 不够近就走过去」。
     * 所以点一下怪就该一直打到它倒下 —— 以前只有 `pendingTargetId`，进距离打一下
     * 就清掉了，玩家得不停点。
     *
     * 节拍不是定时器：`attackCd`（0.45s）+「上一刀的动作还没收回来」（`isAttacking()`）
     * 两个都满足才补下一刀，和原版「拿动画当节拍」一个意思。
     *
     * 同时吃 ESC 菜单里那个「自动攻击 On/Off」（原版 `m_bAutoAttack`）。
     */
    if (autoAttackId >= 0) {
      const t = remotes.get(autoAttackId);
      if (!t || t.dying || playerDead || !escMenu.autoAttack) {
        // 目标没了 / 自己死了 / 选项里关掉了 → 取消锁定
        autoAttackId = -1;
      } else {
        const d = Math.hypot(t.tx - player.x, t.ty - player.y);
        if (d <= ATTACK_RANGE) {
          if (attackCd <= 0 && !isAttacking()) tryAttack(t.id);
        } else if (movePath.length === 0 && performance.now() - lastRepathAt > 400) {
          // 怪物在跑：没路径了就重算一次，别每帧都算 A*
          walkToCell(t.tx, t.ty);
          lastRepathAt = performance.now();
        }
      }
    }

    // 点了椅子/栏杆：走到旁边就坐下（原版 MOVEMENT_OPERATE → Action）
    updateOperate();

    // 点了远处的怪物：走过去，进 3 格自动出手
    if (pendingTargetId >= 0) {
      const t = remotes.get(pendingTargetId);
      if (!t || t.dying) {
        pendingTargetId = -1;
      } else {
        const d = Math.hypot(t.tx - player.x, t.ty - player.y);
        if (d <= ATTACK_RANGE) {
          pendingTargetId = -1;
          tryAttack(t.id);
        } else if (movePath.length === 0 && performance.now() - lastRepathAt > 400) {
          // 追击：没路径了就重算一次（怪物在动，别每帧都算 A*）
          walkToCell(t.tx, t.ty);
          lastRepathAt = performance.now();
        }
      }
    }

    // 技能射程外的目标：走近了（进射程）补一发，和上面那条对称
    if (pendingSkillTargetId >= 0) {
      const t = remotes.get(pendingSkillTargetId);
      if (!t || t.dying) {
        pendingSkillTargetId = -1;
      } else {
        const range = Math.max(1, skillMeta(selectedSkillId())?.range ?? 6);
        const d = Math.hypot(t.tx - player.x, t.ty - player.y);
        if (d <= range + 0.6) {
          pendingSkillTargetId = -1;
          useSelectedSkill(t.id);
        } else if (movePath.length === 0 && performance.now() - lastRepathAt > 400) {
          walkToCell(t.tx, t.ty);
          lastRepathAt = performance.now();
        }
      }
    }

    // 目标死了就取消锁定（自动攻击也一起收）
    if (focusId >= 0) {
      const t = remotes.get(focusId);
      if (!t || t.dying) {
        if (autoAttackId === focusId) autoAttackId = -1;
        focusId = -1;
      }
    }

    damageTexts.update(dt, muCamera.camera);
    /* 头顶名字 / 队友血条：世界坐标每帧都要跟着相机走，不能挂在 15fps 的 HUD 节流里 */
    syncWorldTags();
    /* 地面物品名（悬停 / 按住 Alt 全显） */
    syncItemLabels();
    syncPubMusic();
    syncMinimap();

    /* ---- 场景物件：骨骼动画 + 火把/地光 ---- */
    world.objects.update(dt, player.x, player.y);
    world.objectFx.update(dt, player.x, player.y);

    /* ---- 环境粒子：飞鸟 / 花瓣 / 萤火 / 落叶 ---- */
    world.ambient.update(dt, player.x, player.y, player.z, ambientPointScale());

    /* ---- 水面滚动 + 水下滤镜 ---- */
    updateWaterLayer(dt);

    hudTimer += dt;
    if (hudTimer >= 0.15) {
      hudTimer = 0;
      updateTargetHud();
      syncPartyHud();
    }

    /* ---- 影子 ---- */
    if (playerShadow) playerShadow.position.set(player.x, player.y, player.z + 0.03);
    for (const s of monsterShadows) {
      s.mesh.position.set(
        s.actor.x,
        s.actor.y,
        world.terrain.getHeight(s.actor.x, s.actor.y) + 0.03
      );
    }

    /* ---- 落点标记 ---- */
    if (marker) {
      const markerMat = marker.material as THREE.MeshBasicMaterial;
      if (markerLife > 0) {
        markerLife -= dt;
        markerMat.opacity = Math.max(0, markerLife);
        const sc = 1 + (0.9 - markerLife) * 0.6;
        marker.scale.set(sc, sc, 1);
      } else {
        markerMat.opacity = 0;
      }
    }

    /* ---- 相机 ---- */
    muCamera.setTarget(player.wx, player.wy, player.z + 0.9);
    muCamera.update(dt);

    /*
     * 声音听者 = 相机。原版 `Sound_Update3DPositions` 每帧用玩家朝向算一次
     * 相对方位；我们用相机的前向量（右键拖拽转过之后才是真正的「屏幕左右」）。
     */
    muCamera.camera.getWorldDirection(camForward);
    setListener(player.x, player.y, Math.atan2(camForward.y, camForward.x));

    /* ---- HUD ---- */
    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc > 0.5) {
      fpsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} FPS`;
      // 原版 HUD 显示的是 lpObj->X / lpObj->Y —— 整数格号，没有小数也没有 Z
      // （player.x 是格坐标的浮点插值，floor 才是所在格）
      posEl.textContent = `X ${playerCellX()}  Y ${playerCellY()}`;
      // 底栏左下的坐标跟着走（原版那块是金币/杀敌计数，这里给它换成坐标）
      hudValues.setPosition(playerCellX(), playerCellY());
      fpsAcc = 0;
      fpsFrames = 0;
    }
  }

  // talk / eye 是 2×2 图集动画（原版 100ms 一帧），这里逐帧换图
  tickCursor();
  // 登录/选角 3D 背景自己判「界面可不可见」，不可见直接 return
  login3d?.tick(dt);
  char3d?.tick(dt);
  renderer.render(scene, muCamera.camera);
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */
function boot() {
  showScreens({ login: true });
  if (DEMO) {
    document.title = 'MU Online · 离线演示';
    // 页脚那句「双击 启动游戏.bat」在演示站上没有意义
    const foot = document.querySelector<HTMLElement>('#login .mu-foot-right');
    if (foot) foot.textContent = '离线演示 · 无需服务端';
    setMsg(loginMsg, '离线演示：选线路 → 登录 → 选角 → 进游戏');
  }
  /*
   * 启动画面（原版 `Scene_Intro`）：Webzen logo + ESRB 角标，黑底。
   * 原版这一屏只画一帧就进登录（资产早加载完了），网页端正好拿它盖住
   * 登录背景 / 选角 3D 的首屏下载。点一下就跳过。
   */
  void runIntro();

  $('btn-login').addEventListener('click', () => {
    const account = $<HTMLInputElement>('login-account').value.trim();
    const password = $<HTMLInputElement>('login-password').value;
    if (!account) {
      setMsg(loginMsg, '请输入账号', 'error');
      return;
    }
    // 浏览器要求 AudioContext 在**用户手势**里创建 → 就是这一次点击
    unlockAudio();
    playBgm(BGM_LOGIN);
    // 演示模式没有服务端：直接"登录成功"，用假角色列表进选角
    if (DEMO) void demoLogin(account);
    else connectAndLogin(account, password);
  });

  $<HTMLInputElement>('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') $<HTMLButtonElement>('btn-login').click();
  });

  /*
   * 账号面板上的第二个按钮。
   *
   * 原版这里是「取消（`0on_botton2.ozj`）」—— 点了直接关客户端。网页端关不掉
   * 标签页（`window.close()` 对非脚本打开的窗口无效），所以退回**上一步**：
   * 回到「选择线路」。文案同样取自 `Text.bmd`（`GlobalText[381]`「结束游戏」）。
   *
   * 以前这个位子是「离线演示」（直接进沙盘），现在离线演示挪到 `/demo` 页面，
   * 走完整的 线路 → 登录 → 选角 → 进游戏 流程。
   */
  const quitBtn = $<HTMLButtonElement>('btn-quit');
  quitBtn.textContent = textSync(381, '结束游戏');
  quitBtn.addEventListener('click', () => {
    unlockAudio();
    showLoginStage('servers');
    setMsg(loginMsg, DEMO ? '已结束本次演示，重新选择线路' : '已结束游戏，重新选择线路');
  });

  /*
   * 声音开关。原版是选项菜单里的 `MusicOnOff`（注册表，默认关），
   * 网页端没有那套菜单，就放右上角一个小按钮；静音状态存 localStorage。
   */
  const audioBtn = $<HTMLButtonElement>('btn-audio');
  const paintAudioBtn = () => {
    audioBtn.textContent = isMuted() ? '声音 关' : '声音 开';
  };
  paintAudioBtn();
  audioBtn.addEventListener('click', () => {
    unlockAudio();
    toggleMuted();
    paintAudioBtn();
  });

  /*
   * 选角界面的「返回登录」。
   *
   * 以前只 `showScreens({ login: true })` —— socket 还连着、角色还挂在
   * 服务端世界里、`loginStage` 也还停在 account 那一步，回来就是个死界面
   * （点登录会被 `CloseCount` 挡、或者直接没反应）。现在统一走 `leaveGame`：
   * 发 `F1/02/01` 退出角色 → 关 socket → 回**选服**那一步（和 ESC 菜单
   * 的「返回线路选择」同一个出口）。
   */
  $('btn-back').addEventListener('click', () => {
    sandbox.on = false;
    closeCreatePanel();
    leaveGame('login', 2, '');
  });

  setupCreatePanel();

  $('btn-cancel-load').addEventListener('click', () => {
    showScreens({ login: true });
  });

  frame();

  // 自动化验证入口（无头浏览器用）
  (window as any).__MU_APP__ = {
    login: (account = '1234', password = '1234') => connectAndLogin(account, password),
    /** 调试：登录 3D 背景装载情况（物件数 / 相机位 / FOV） */
    login3d: () => login3d?.stats() ?? null,
    /** 调试：临时打开登录 3D 背景 */
    login3dOn: () => bootLogin3d(),
    /* ---- 选择线路（ConnectServer） ---- */
    /** 当前线路列表 + 选中项 */
    serverList: () => serverSelect.state(),
    /** 重新连 ConnectServer 拉一次列表 */
    serverRefresh: () => serverSelect.refresh(),
    /** 选中某组第 N 条线路（会走 F4/03 拿地址并切到账号密码界面） */
    serverPick: (group = 0, channel = 0) => serverSelect.pickChannel(group, channel),
    /** 强制切到某一阶段（'servers' / 'account'） */
    loginStage: (stage: 'servers' | 'account') => showLoginStage(stage),
    /** 调试：选角 3D 背景状态 */
    char3d: () => char3d?.stats() ?? null,
    /** 调试：布景每块 mesh 的世界包围盒 */
    char3dBoxes: () => char3d?.boxes() ?? null,
    /** 调试：布景亮度（1 = 原样） */
    char3dLight: (k: number) => char3d?.setStageLight(k),
    /** 调试：角色亮度（1 = 原样） */
    char3dCharLight: (k: number) => char3d?.setCharLight(k),
    /** 调试：角色贴图关 mipmap（看是不是糊在 mip 上） */
    char3dSharp: (on: boolean) => char3d?.setCharSharp(on),
    /** 调试：布景压平（不吃顶点光照） */
    char3dFlat: (on: boolean) => char3d?.setStageFlat(on),
    /** 调试：老 GL 的 gamma（不做 sRGB 输出） */
    char3dGamma: (on: boolean) => char3d?.setLegacyGamma(on),
    /** 调试：射线检测每只角色前面有没有布景挡着 */
    char3dProbe: () => char3d?.probe() ?? null,
    /** 调试：转选角布景（角度单位是度，绕角色脚下的 Z 轴；offsetY 是布景前后） */
    char3dScene: (o: { rot?: number; offsetY?: number }) => {
      char3d?.setScene(o);
      return char3d?.stats() ?? null;
    },
    /** 调试：清空 / 重设选角场景里的角色（不传就是了清空） */
    char3dSet: (list?: { name: string; cls: number; level: number; slot?: number; charSet?: number[] }[]) =>
      char3d?.setChars(
        (list ?? []).map((c, i) => ({ ...c, slot: c.slot ?? i, charSet: c.charSet ?? [] }))
      ),
    /** 调试：临时改选角相机（MU 单位的位置 + 三个角度） */
    char3dCam: (o: { x?: number; y?: number; z?: number; pitch?: number; yaw?: number; roll?: number; fov?: number }) => {
      char3d?.setCamera(o);
      return char3d?.stats() ?? null;
    },
    /** 调试：临时改登录相机（调构图用） */
    login3dCam: (o: { x?: number; y?: number; z?: number; tilt?: number; fov?: number }) => {
      login3d?.setCamera(o);
      return login3d?.stats() ?? null;
    },
    /** 调试：临时改登录天空盒缩放 */
    login3dSky: (k: number) => {
      login3d?.setSkyScale(k);
      return true;
    },
    characters: () => charListEl.querySelectorAll('.char-card').length,
    /** 调试：角色卡上的名字（双账号探针要按真实角色名选角） */
    charNames: () =>
      [...charListEl.querySelectorAll('.char-card .cname')].map(el => el.textContent?.trim() || ''),
    /** 调试：角色列表原始数据（charSet[0] 就是职业号，0=DW 1=DK 2=FE 3=MG） */
    chars: () => charSummaries,
    select: (name: string) => selectCharacter(name),
    loadMap: (mapId: number, x = 128, y = 128) => loadWorld(mapId, x, y, { offline: true }),
    /** 调试：移动命令窗口的当前列表（谁能走 / 为什么不能走） */
    moveCommand: () => movePanel.snapshot(),
    /** 探针：选中移动表的第 i 条（等价于 ↑↓ 走到那一行） */
    moveSelect: (i: number) => {
      movePanel.select(i);
      return movePanel.snapshot().sel;
    },
    /** 探针：确认当前选中的条目（等价于按 Enter） */
    moveConfirm: () => {
      movePanel.confirm();
      return true;
    },
    /** 探针：直接问某个 Interface 贴图能不能加载（返回 "WxH" 或 null） */
    uiProbe: async (name: string) => {
      const sp = await uiSprite(name);
      return sp ? `${sp.width}x${sp.height}` : null;
    },
    /** 调试：模拟角色卡（等级/金币/翅膀/转生）；传 null 恢复真实角色，返回走不通的条数 */
    setMoveStatus: (level: number | null, money = -1, wings = true, reset = 0) => {
      moveStatusOverride = level === null ? null : { level, money, wings, reset };
      refreshMovePanel();
      return movePanel.snapshot().entries.filter(e => e.problem).length;
    },
    /** 调试：移动命令的数据表（Move.txt + Gate.txt 的合并结果） */
    warpTable: () => warpTable.snapshot(),
    /** 调试：用服务端原文整表替换移动表（模拟服务端同步） */
    syncWarpTable: (moveText: string, gateText: string) => {
      warpTable.applyText(moveText, gateText, 'server');
      return warpTable.snapshot();
    },
    /** 调试：按 Move.txt 的 Index 传送（服务端要的就是这个号） */
    warpIndex: (index: number) => {
      const entry = warpTable.byIndex(index);
      if (!entry) return false;
      void warpTo(entry);
      return true;
    },
    /* ---------------- NPC / 商店 / 仓库 ---------------- */
    /** 身上金币（探针断言买卖前后的钱） */
    money: () => currentChar?.info?.money ?? 0,
    /** 视野内的 NPC（kind === 'npc'），带服务端 Class —— 商店/仓库靠它区分 */
    npcs: () =>
      remotes
        .list()
        .filter(e => e.kind === 'npc')
        .map(e => ({ id: e.id, cls: e.cls, name: e.name, x: e.tx, y: e.ty })),
    /** 和 NPC 说话（太远会自动走过去）；返回 false 表示视野里没有这个 id */
    talk: (id: number) => {
      if (!remotes.get(id)) return false;
      talkToNpc(id);
      return true;
    },
    /** 传 NPC 的职业号说话（探针找商人用，不用记 id） */
    talkClass: (cls: number) => {
      const npc = remotes.list().find(e => e.kind === 'npc' && e.cls === cls);
      if (!npc) return null;
      talkToNpc(npc.id);
      return npc.id;
    },
    /** 当前 NPC 面板（商店/仓库）内容 */
    npcPanel: () => npcPanel.snapshot(),
    /** 直接买货架格（等价于点那格） */
    buy: (slot: number) => buyFromShop(slot),
    sell: (slot: number) => sellToShop(slot),
    store: (slot: number) => storeToWarehouse(slot),
    take: (slot: number) => takeFromWarehouse(slot),
    /** 丢在地上 */
    drop: (slot: number) => discardItem(slot),
    /** 聊天框内容（验证 /post 之类的命令有没有被服务端回显） */
    chatLines: () => chatBox.snapshot(),

    /* ---------------- 0x19 技能 / 0xF3E6 事件 ---------------- */
    /* ---------------- 箭矢（CreateArrows） ---------------- */
    /** 最近一次放箭（几支 / 哪个模型 / 距离 / 飞行时间） */
    arrows: () => arrowDebug,
    /** 当前在空中飞的箭矢（按文件名过滤 effects 层） */
    fxArrows: () =>
      effects.snapshot().filter(f => /arrow/i.test(f.file)),
    /**
     * 探针：直接朝靶子放 N 支箭（不经过技能，验证飞行/朝向）。
     * `dist > 0` 时把目标点沿「施法者→靶子」的方向再延长 dist 米 ——
     * 靶子只离 2.6 m，箭 0.1 秒就到了，采样抓不到中间过程。
     */
    testArrows: (count = 1, dist = 0) => {
      const t = skillTarget;
      const p = player;
      if (!t) return 0;
      if (dist > 0 && p) {
        const yaw = Math.atan2(t.y - p.y, t.x - p.x);
        return shootArrows(count, {
          x: p.x + Math.cos(yaw) * dist,
          y: p.y + Math.sin(yaw) * dist,
          z: p.z + 1.2,
        });
      }
      return shootArrows(count, { x: t.x, y: t.y, z: t.z + 1.1 });
    },
    /** 最近一次 0x19 的处理结果（含 fx 文件名与跳过原因） */
    skillDebug: () => skillDebug,
    /**
     * 调试：给沙盘靶子播一次受击动作（验 `playHurtAction`）。
     *   `__MU_APP__.hurt('monster')` / `hurt('player')`
     */
    hurt: (kind: 'player' | 'monster' | 'npc' = 'monster') => {
      // `player` 要打在**本地角色**身上（靶子是怪物模型，没有 0x85 那组动作）
      const actor = kind === 'player' ? player : skillTarget;
      if (!actor) return null;
      const before = actor.action;
      const ok = playHurtAction(actor, kind);
      return { ok, before, after: actor.action, kind };
    },
    /**
     * 调试：手动演一次「别人放技能」—— 走的是**收包那条路**（`playRemoteSkill`）。
     *
     *   `__MU_APP__.remoteSkill(41, { targetId: 靶子id })`
     *
     * 用来验证「远端表现和本地沙盘一致」：以前远端只放 `SKILL_FX` 的单件。
     */
    remoteSkill: (
      skill: number,
      opts: { targetId?: number; x?: number; y?: number; dir?: number } = {}
    ) => {
      const hasPoint = opts.x !== undefined && opts.y !== undefined;
      playRemoteSkill(
        {
          skill,
          casterId: remotes.selfId,
          targetId: opts.targetId ?? 0,
          success: true,
          ...(hasPoint ? { x: opts.x, y: opts.y } : {}),
          ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        } as SkillCastEvent,
        { allowSelf: true }
      );
      return skillDebug.last;
    },
    /**
     * 探针：把四条技能上行按参数造出来（十六进制字符串）。
     *
     * 只为了核对**线上字节**（字段顺序 / big-endian 还是 little-endian），
     * 发不发由 `castOnline` / `cancelSkill` / `recallAlly` 决定。
     */
    skillPacketHex: {
      duration: (skill: number, x: number, y: number, dir: number, dis: number, angle: number, target: number) =>
        hexOf(buildDurationSkillAttackPacket(skill, x, y, dir, dis, angle, target)),
      attack: (skill: number, target: number) => hexOf(buildSkillAttackPacket(skill, target)),
      cancel: (skill: number, index: number) => hexOf(buildSkillCancelPacket(skill, index)),
      multi: (skill: number, x: number, y: number, serial: number, targets: number[]) =>
        hexOf(buildMultiSkillAttackPacket(skill, x, y, serial, targets)),
      ally: (index: number, x: number, y: number) => hexOf(buildTeleportAllyPacket(index, x, y)),
    },
    /** 事件倒计时（服务端 0xF3/0xE6 下发的表） */
    eventTimer: () => eventTimer.snapshot(),
    /**
     * 伪造一条 0x19，让指定实体「放技能」——走的是和真实收包**完全相同**的
     * 解析 + 表现路径，只是不经过网络。用来验证别人放技能时的动作/特效。
     */
    testSkill: (skill: number, casterId: number, targetId = 0, success = true) => {
      const pkt = new Uint8Array(8);
      pkt[0] = 0xc3;
      pkt[1] = 8;
      pkt[2] = 0x19;
      pkt[3] = skill & 0xff;
      pkt[4] = (casterId >> 8) & 0xff;
      pkt[5] = casterId & 0xff;
      pkt[6] = ((targetId >> 8) & 0x7f) | (success ? 0x80 : 0x00);
      pkt[7] = targetId & 0xff;
      const ev = parseSkillCast(pkt);
      if (!ev) return null;
      playRemoteSkill(ev);
      return ev;
    },
    /**
     * 真发一条技能上行。`DURATION_SKILLS` 里的走 0x1E、其余走 0x19
     * （安全区内服务端会拒绝，只在野外有用）。
     */
    castSkillAt: (skill: number, targetId: number) => castOnlineSkill(skill, targetId),
    /** 在线施法（同上，但 targetId 省略时用当前选中的目标） */
    castOnline: (skill: number, targetId = 0) => castOnlineSkill(skill, targetId),
    /**
     * 技能栏（0xF3/0x11）的调试口。
     *
     *   list()            当前技能表（slot / skill / level / 名字 / 蓝耗）
     *   bar()             技能栏 DOM 状态（展开、选中、每个格的 x/y）
     *   select(slot)      选技能（等价于点图标）
     *   toggle()          展开/收起
     *   hotkey(slot,key)  设快捷键（key 1..10，10 = 「0」键）
     *   use(targetId)     用当前选中的技能打一个目标（真发包）
     *   feed(pkt)         喂一条伪造的 0xF3/0x11（探针用，不经过网络）
     */
    skillBar: {
      list: () =>
        skillList.map(s => ({
          ...s,
          name: skillTable.get(s.skill)?.name ?? null,
          mana: skillTable.get(s.skill)?.mana ?? null,
        })),
      bar: () => skillBar.snapshot(),
      select: (slot: number) => {
        skillBar.setSelected(slot);
        return skillBar.selectedSkillId();
      },
      toggle: () => {
        skillBar.toggle();
        return skillBar.isOpen;
      },
      hotkey: (slot: number, key: number) => {
        skillHotkeys.set(slot, key);
        skillBar.setHotkeys(skillHotkeys);
        saveSkillHotkeys();
      },
      use: (targetId: number) => useSelectedSkill(targetId),
      selected: () => skillBar.selectedSkillId(),
      feed: (pkt: number[]) => {
        applySkillList(Uint8Array.from(pkt));
        return skillList.length;
      },
    },
    /** 0x1B 取消技能效果（0.97 客户端从不发，留着做 buff 条时用） */
    cancelSkill: (skill: number, index = 0) => {
      if (!connection?.connected) return false;
      connection.send(buildSkillCancelPacket(skill, index));
      return true;
    },
    /**
     * 0x1D 多目标技能（MuEmu 扩展）。**必须先发一次 0x1E 开技能**，
     * 服务端才认这条（见 `game.ts` 里 `buildMultiSkillAttackPacket` 的注释）。
     */
    multiSkill: (skill: number, targets: number[]) => {
      if (!connection?.connected || !player) return false;
      const gx = playerCellX() & 0xff;
      const gy = playerCellY() & 0xff;
      connection.send(buildMultiSkillAttackPacket(skill, gx, gy, 0, targets));
      console.log(`[skill] 0x1D 多目标 ${skill} → ${targets.join(',')}`);
      return true;
    },
    /** 0xB0 把队友拉到指定格 */
    recallAlly: (index: number, x: number, y: number) => recallAlly(index, x, y),
    /** 探针：伪造一条 0x1E 下行（走真实解析 + 表现路径） */
    testDurationSkill: (skill: number, casterId: number, x: number, y: number, dir = 0) => {
      const pkt = new Uint8Array(9);
      pkt[0] = 0xc3;
      pkt[1] = 9;
      pkt[2] = 0x1e;
      pkt[3] = skill & 0xff;
      pkt[4] = (casterId >> 8) & 0xff;
      pkt[5] = casterId & 0xff;
      pkt[6] = x & 0xff;
      pkt[7] = y & 0xff;
      pkt[8] = dir & 0xff;
      const ev = parseDurationSkillCast(pkt);
      if (!ev) return null;
      skillDebug.duration++;
      playRemoteSkill(ev);
      return ev;
    },
    /** 探针：伪造一条 0x1B 下行 */
    testSkillCancel: (skill: number, index: number) => {
      const pkt = new Uint8Array(6);
      pkt[0] = 0xc1;
      pkt[1] = 6;
      pkt[2] = 0x1b;
      pkt[3] = skill & 0xff;
      pkt[4] = (index >> 8) & 0xff;
      pkt[5] = index & 0xff;
      const c = parseSkillCancel(pkt);
      if (c) skillDebug.cancels++;
      return c;
    },
    /** 关面板 */
    closeNpc: () => closeNpcPanel(),
    /** 寻路走位（探针用：只有真走路，服务端才会更新它那边记的位置） */
    walkToNpc: (x: number, y: number) => walkToCell(x, y, true),
    /** 调试：不经窗口直接传送（走的是和按钮完全相同的路径） */
    warp: (mapId: number) => {
      const entry = warpTable.byMap(mapId);
      if (!entry) return false;
      void warpTo(entry);
      return true;
    },
    /** 模拟 0x14 离场 */
    removeRemote: (id: number) => {
      const pkt = new Uint8Array(6);
      pkt[0] = 0xc1;
      pkt[1] = 6;
      pkt[2] = 0x14;
      pkt[3] = 1;
      pkt[4] = (id >> 8) & 0xff;
      pkt[5] = id & 0xff;
      return remotes.handle(pkt);
    },
    /** 调试：伪造一条 0x12，在指定格放一个「玩家」（用来验证角色占位） */
    testPlayer: (name: string, x: number, y: number, id = 0x7e01) => {
      const pkt = new Uint8Array(5 + 32);
      pkt[0] = 0xc2;
      pkt[1] = 0x00;
      pkt[2] = pkt.length;
      pkt[3] = 0x12;
      pkt[4] = 1;
      const o = 5;
      pkt[o] = ((id >> 8) & 0x7f) | 0x80; // 高位 = 新建
      pkt[o + 1] = id & 0xff;
      pkt[o + 2] = x;
      pkt[o + 3] = y;
      // charSet 全 0（默认外观）
      for (let i = 0; i < Math.min(10, name.length); i++) {
        pkt[o + 18 + i] = name.charCodeAt(i);
      }
      pkt[o + 28] = x;
      pkt[o + 29] = y;
      pkt[o + 30] = 0x40;
      return remotes.handle(pkt);
    },
    /** 调试：在场实体（含目标格）与占位集合，用于双账号验证「绕过其他角色」 */
    remotesInfo: () => ({
      selfId: remotes.selfId,
      entities: remotes.list(),
      blockers: remotes.blockerCells(),
    }),
    testMonster: (type: number, x: number, y: number, id = 0x7f01) => {
      const pkt = new Uint8Array(17);
      pkt[0] = 0xc2;
      pkt[1] = 0x00;
      pkt[2] = 0x11;
      pkt[3] = 0x13;
      pkt[4] = 1;
      pkt[5] = (id >> 8) & 0x7f;
      pkt[6] = id & 0xff;
      pkt[7] = type;
      // 条目从 index 5 开始：+0..1 id, +2 type, +3 pad, +4..5 skill, +6 x, +7 y, +8 tx, +9 ty, +10 dirpk
      pkt[11] = x;
      pkt[12] = y;
      pkt[13] = x;
      pkt[14] = y;
      pkt[15] = 0x10;
      return remotes.handle(pkt);
    },
    close: () => {
      session?.closeClient(0);
      setTimeout(() => connection?.close(), 120);
    },
    /* ---- 地面物品 ---- */
    /** 调试：伪造一条 0x20，在指定格放一件地面物品（不依赖打怪掉落） */
    testItem: (type: number, x: number, y: number, id = 0x01, level = 0) => {
      const pkt = new Uint8Array(5 + 9);
      pkt[0] = 0xc2;
      pkt[1] = 0x00;
      pkt[2] = pkt.length;
      pkt[3] = 0x20;
      pkt[4] = 1;
      const o = 5;
      pkt[o] = ((id >> 8) & 0x7f) | 0x80; // 高位 = 服务端标记「新建」
      pkt[o + 1] = id & 0xff;
      pkt[o + 2] = x;
      pkt[o + 3] = y;
      pkt[o + 4] = type & 0xff; // ItemInfo[0]
      pkt[o + 5] = (level & 0x0f) << 3; // level<<3
      pkt[o + 6] = 40; // 耐久
      pkt[o + 7] = type & 0x100 ? 0x80 : 0; // 第 9 位
      pkt[o + 8] = 0;
      const list = parseViewportItems(pkt);
      if (list) groundItems.upsert(list);
      return list;
    },
    /** 调试：伪造一堆金币 */
    testMoney: (x: number, y: number, money = 1200, id = 0x02) => {
      const pkt = new Uint8Array(5 + 9);
      pkt[0] = 0xc2;
      pkt[1] = 0x00;
      pkt[2] = pkt.length;
      pkt[3] = 0x20;
      pkt[4] = 1;
      const o = 5;
      pkt[o] = ((id >> 8) & 0x7f) | 0x80;
      pkt[o + 1] = id & 0xff;
      pkt[o + 2] = x;
      pkt[o + 3] = y;
      // 金币数量 24 位：info[1] 高 8、info[2] 中 8、info[4] 低 8
      // 金币的 type 是 463（= GET_ITEM(14,15)），超过 255，
      // 所以第 9 位必须写进 info[3] 的 bit7，只写低 8 位会变成 207（其它物品）
      const moneyType = 14 * 32 + 15;
      pkt[o + 4] = moneyType & 0xff;
      pkt[o + 5] = (money >> 16) & 0xff;
      pkt[o + 6] = (money >> 8) & 0xff;
      pkt[o + 7] = moneyType & 0x100 ? 0x80 : 0;
      pkt[o + 8] = money & 0xff;
      const list = parseViewportItems(pkt);
      if (list) groundItems.upsert(list);
      return list;
    },
    items: () => groundItems.list(),
    itemCount: () => groundItems.size,
    nearestItem: (range = 3) =>
      player ? groundItems.nearest(player.x, player.y, range) : null,
    pickupItem: (id: number) => tryPickup(id),
    itemDebug: () => ({ ...itemDebug, pending: pendingPickupId }),
    /** 调试：让角色走到某格（等价于点地面；探针验脚步/寻路用） */
    walk: (x: number, y: number) => walkToCell(x, y),
    /** 调试：按槽位「使用」一件物品（0x26，等于双击背包格） */
    useSlot: (slot: number) => {
      useItem(slot);
      return inventoryItems.find(i => i.slot === slot) ?? null;
    },
    /* ---- 角色数值 ---- */
    stats: () =>
      currentChar
        ? { name: currentChar.name, level: currentChar.level, info: currentChar.info }
        : null,
    /** 调试：发一条聊天（服务端命令要用，比如 /drop 0 0 0 0 0 0 0） */
    chat: (msg: string) => sendChatText(msg),
    /* ---- 聊天框 ---- */
    /** 当前聊天日志快照（探针断言行数/频道/颜色用） */
    chatLog: () => chatBox.snapshot(),
    /** 开/关输入条；`text` 可以预填 */
    openChat: (text = '') => {
      chatBox.open(text);
      return chatBox.isTyping;
    },
    closeChat: () => chatBox.close(),
    /** 直接往日志里塞一条（不经过网络，验证配色/换行用） */
    pushChat: (name: string, text: string, channel: ChatChannel = 3) =>
      chatBox.push(name, text, channel),
    /** 最近收到的完整报文（调试字段偏移） */
    packets: (head?: number) =>
      pktLog.filter(p => head === undefined || p.head === head),
    /**
     * 调试：把一段十六进制报文塞进收包流程（不经过网络），用来验证解析。
     * 比如 `inject('c1 0b 26 ff 03 20 00 00 00 00 00')` 直接把 HP 改成 800。
     */
    inject: (hex: string) => {
      const bytes = hex
        .trim()
        .split(/\s+/)
        .map(h => parseInt(h, 16))
        .filter(n => Number.isFinite(n));
      if (!session || !bytes.length) return 0;
      session.onPacket?.(new Uint8Array(bytes));
      return bytes.length;
    },
    /** 直接套一组装备（只改外观，不动背包）—— 验证模型/骨骼映射用 */
    previewEquip: async (equip: EquipSet) => (player ? applyEquipment(player, PLAYER_DIR, equip) : null),
    /** 调试：运行时改背武器姿态（探针一次试多个候选） */
    backPose: (p: Record<string, unknown>) => setBackPose(p as never),
    /**
     * 调试：地形光照端点（`light = floor + gain × TerrainLight`）。
     * 探针一次性试几组 floor/gain，出图后挑观感最接近原版的一组。
     */
    lightTune: (t: { floor?: number; gain?: number; exposure?: number }) => {
      Object.assign(LIGHT_TUNE, t);
      const m = world?.terrain.mesh.material as THREE.ShaderMaterial | undefined;
      if (m) {
        m.uniforms.uLightFloor.value = LIGHT_TUNE.floor;
        m.uniforms.uLightGain.value = LIGHT_TUNE.gain;
        m.uniforms.uExposure.value = LIGHT_TUNE.exposure;
      }
    },
    /**
     * 调试：背挂翻转。
     *   传 `false` → 全部不翻（A/B 用）；传 `true` → 恢复默认；
     *   传数字数组 → 直接改「不翻的大类」集合（`Math.floor(type / 32)`），
     *   例如 `[0]` = 只有剑类不翻。
     */
    backFlip: (v: boolean | number[]) => {
      if (Array.isArray(v)) {
        BACK_FLIP.keep.clear();
        for (const g of v) BACK_FLIP.keep.add(g);
        BACK_FLIP.weapon = true;
        return;
      }
      BACK_FLIP.weapon = v;
    },
    /** 主角 Actor（换装探针用；直接返回对象，只在页面里访问） */
    playerActor: () => player,
    /**
     * 探针：临时隐藏/显示角色与技能靶子。
     *
     * 为什么需要：用「施法前后像素差」判断「这个技能有没有视觉」时，
     * 角色自己的挥砍动作就能造成 7~12% 的差异，会把「无特效的技能」误判成
     * 「有特效」。把两边模型都藏起来，画面里就只剩特效层，差分才可信。
     */
    setActorsVisible: (showPlayer: boolean, showTarget: boolean) => {
      if (player) player.root.visible = showPlayer;
      if (skillTarget) skillTarget.root.visible = showTarget;
      return true;
    },
    /**
     * 动作选择的当前快照：武器大类 → 待机/走跑/攻击动作号，以及安全区/飞行状态。
     * 换装动作探针用它断言「拿剑和拿弓攻击动作不同」。
     */
    anim: (over: Partial<AnimInput> & { wing?: number | null; weapon?: number | null; shield?: number | null } = {}) => {
      const input: AnimInput = { ...animInput(), ...over };
      // 探针用 wing: null 显式「摘掉翅膀」，undefined 在 JSON 里会被丢掉
      if (over.wing === null) input.wing = undefined;
      if (over.weapon === null) input.weapon = undefined;
      if (over.shield === null) input.shield = undefined;
      return {
        ...input,
        idle: idleAction(input),
        move: moveAction(input),
        attack: attackAction(input, attackCombo),
        flying: isFlyingAnim(input),
        safeZone: isSafeZoneAt(player?.x ?? 0, player?.y ?? 0),
        action: player?.action ?? -1,
      };
    },
    /** 调试：这个物品 type 属于哪类武器、是不是双手（动作表分支依据） */
    weaponInfo: (type: number) => weaponInfo(type),
    /** 调试：翅膀现状（挂点骨骼名、扇动帧、混合方式），探针据此断言 */
    wing: () => {
      const w = player?.wing;
      if (!w) return null;
      const bone = w.root.parent;
      const meshes = player?.meshes.filter(m => /Wing/i.test(m.name)) ?? [];
      // 瞬移 / 换装之后渲染器可能还没跑这一帧，先把矩阵刷到最新再量
      player?.root.updateMatrixWorld(true);
      w.root.updateMatrixWorld(true);
      // 蒙皮包围盒：逐顶点按 skinIndex 的骨骼矩阵变换（BMD 每顶点只挂一根骨）
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      const inv = new THREE.Matrix4();
      if (player) inv.copy(player.root.matrixWorld).invert();
      /** 主角某根骨头在角色局部坐标里的高度（米），找不到返回 null */
      const boneHeight = (name: string) => {
        const i = player?.rig.boneIndexByName.get(name);
        if (!player || i === undefined) return null;
        const t = new THREE.Vector3().setFromMatrixPosition(player.rig.bones[i].matrixWorld).applyMatrix4(inv);
        return Number(t.z.toFixed(3));
      };
      for (const m of meshes) {
        const pos = m.geometry.getAttribute('position');
        const si = m.geometry.getAttribute('skinIndex');
        for (let i = 0; i < pos.count; i++) {
          const b = w.rig.bones[si.getX(i)];
          if (!b) continue;
          v.fromBufferAttribute(pos, i).applyMatrix4(b.matrixWorld).applyMatrix4(inv);
          box.expandByPoint(v);
        }
      }
      return {
        parent: bone?.name ?? '',
        localPos: w.root.position.toArray(),
        /** 挂点（= 翼根）在角色局部坐标里的位置：x 左右 / y 前后 / z 高度（米） */
        rootWorld: (() => {
          const t = new THREE.Vector3().setFromMatrixPosition(w.root.matrixWorld).applyMatrix4(inv);
          return t.toArray().map(n => Number(n.toFixed(3)));
        })(),
        /** 对照用的主角骨骼高度：肩（左右 Clavicle 平均）/ 脊柱底 / 头 —— 断言「翼根在肩不在腰」 */
        jointZ: {
          spine: boneHeight('Bip01 Spine'),
          chest: boneHeight('Bip01 Spine1'),
          shoulder: (() => {
            const l = boneHeight('Bip01 L Clavicle');
            const r = boneHeight('Bip01 R Clavicle');
            return l === null || r === null ? null : Number(((l + r) / 2).toFixed(3));
          })(),
          head: boneHeight('Bip01 Head'),
        },
        frame: Number(w.frame.toFixed(3)),
        speed: w.speed,
        action: w.action,
        keys: w.rig.bmd.actions[w.action]?.numKeys ?? 0,
        bones: w.rig.bones.length,
        blend: w.blend,
        flip: w.flip,
        meshes: meshes.map(m => m.name),
        /** 相对角色根（x 左右 / y 前后 / z 上下，单位米）的包围盒 */
        bbox: meshes.length
          ? { min: box.min.toArray().map(n => Number(n.toFixed(2))), max: box.max.toArray().map(n => Number(n.toFixed(2))) }
          : null,
      };
    },
    /** 调试：改翅膀挂点（探针一次性试多个候选）；`flip` 可临时改写该模型的翻转 */
    wingPose: (p: Partial<{ offset: [number, number, number]; rx: number; ry: number; rz: number; flip: boolean }>) => {
      const { flip, ...pose } = p;
      setWingPose(pose);
      const w = player?.wing;
      if (!w) return null;
      if (flip !== undefined) w.flip = flip;
      applyWingPose(w);
      return {
        pos: w.root.position.toArray(),
        rot: [w.root.rotation.x, w.root.rotation.y, w.root.rotation.z],
        flip: w.flip,
      };
    },
    /**
     * 页面内截图（**技能特效计时专用**）。
     *
     * 为什么不用 CDP 的 `Page.captureScreenshot`：软渲染（SwiftShader）下一次
     * 截图要 **3~4 秒**，而技能特效的撞击/爆闪只有 0.3~0.6 s —— 等图出来已经散完了，
     * 拍到的永远是空场景，看起来像「特效没出」。
     * 这里在**同一次求值**里先 `render()` 再 `toDataURL()`，拿到的是当帧像素，
     * 往返只要几十毫秒。
     *
     * `box` 用 CSS 像素（左上角 + 宽高），内部按 devicePixelRatio 换算。
     */
    snap: (box?: { x: number; y: number; w: number; h: number }) => {
      renderer.render(scene, muCamera.camera);
      const src = renderer.domElement;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const sx = Math.max(0, Math.round((box?.x ?? 0) * dpr));
      const sy = Math.max(0, Math.round((box?.y ?? 0) * dpr));
      const sw = Math.min(src.width - sx, Math.round((box?.w ?? window.innerWidth) * dpr));
      const sh = Math.min(src.height - sy, Math.round((box?.h ?? window.innerHeight) * dpr));
      if (sw <= 0 || sh <= 0) return '';
      const out = document.createElement('canvas');
      out.width = sw;
      out.height = sh;
      const g = out.getContext('2d')!;
      g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
      return out.toDataURL('image/png');
    },

    /** 调试：把扇动冻在某一帧（frame 传 null 恢复播放），探针逐帧看翼面 */
    wingFrame: (frame: number | null) => {
      const w = player?.wing;
      if (!w) return null;
      if (frame === null) {
        w.paused = false;
      } else {
        w.paused = true;
        w.frame = frame;
      }
      return { paused: !!w.paused, frame: Number(w.frame.toFixed(2)) };
    },
    /** 安全区判定 + 地形属性（探针用来找安全区边界） */
    safeZone: (x?: number, y?: number) => isSafeZoneAt(x ?? player?.x ?? 0, y ?? player?.y ?? 0),
    /**
     * 调试：安全区门禁（原版 `Combat.cpp::Attack()` 的两道门）。
     * `blocked` = 这一刀/这个技能现在会不会被挡下；`skillId` 传 0 就是普攻。
     */
    safeZoneGate: (skillId = 0, x?: number, y?: number) => {
      const gx = x ?? player?.x ?? 0;
      const gy = y ?? player?.y ?? 0;
      return {
        map: world?.mapId ?? null,
        at: [Math.round(gx), Math.round(gy)],
        safe: isSafeZoneAt(gx, gy),
        blocked: safeZoneBlocksCombat(skillId, gx, gy),
        allowedSkills: [...SAFE_ZONE_SKILLS],
      };
    },
    /* ---- 离线演示沙盘 ---- */
    /** 面板当前状态 + 每个下拉里到底有几个选项（探针断言「数据来自 item.bmd」） */
    sandbox: () => {
      const dom = document.querySelector('#sandbox');
      const opts: Record<string, { count: number; value: string; label: string }> = {};
      dom?.querySelectorAll('.sb-field').forEach(f => {
        const label = f.querySelector('.sb-label')?.textContent ?? '?';
        const sel = f.querySelector('select') as HTMLSelectElement | null;
        opts[label] = {
          count: sel ? sel.options.length - 1 : -1, // 去掉 “None”
          value: sel?.value ?? '',
          label: sel?.selectedOptions[0]?.textContent ?? '',
        };
      });
      return {
        visible: !dom?.classList.contains('hidden'),
        on: sandbox.on,
        cls: sandbox.cls,
        slots: { ...sandbox.slots },
        options: opts,
      };
    },
    /** 探针：面板上每个下拉实际渲染出来的装备名（不含 None），用来和 item.bmd 逐条比对 */
    sandboxOptions: () => {
      const out: Record<string, string[]> = {};
      document.querySelectorAll('#sandbox .sb-field').forEach(f => {
        const label = f.querySelector('.sb-label')?.textContent ?? '?';
        const sel = f.querySelector('select');
        out[label] = sel ? [...sel.options].slice(1).map(o => o.textContent ?? '') : [];
      });
      return out;
    },
    /** 探针：等价于在面板上点职业下拉 */
    sandboxClass: (cls: number) => sandboxPanel.setClass(cls),
    /** 探针：等价于在面板上选某个部位的装备（type 传 null = None） */
    sandboxPick: (key: string, type: number | null) => {
      sandboxPanel.setSlot(key as 'helm', type === null ? undefined : type);
      return true;
    },
    /** 探针：面板可见性 */
    sandboxShow: (on: boolean) => {
      sandboxPanel.show(on);
      return sandboxPanel.visible;
    },
    /* ---- 技能 / 特效 ---- */
    /**
     * 面板里实际加载出来的技能清单。
     * `action` / `parts` / `source` 三项来自**客户端源码**（`castOf`）：
     * 以前这里只有手配的 `file/size`，探针没法验证「动作号对不对」。
     */
    /**
     * 调试：按技能号触发一次**本地沙盘**施法（`castSkill`：完整序列 + 伤害飘字）。
     *   `__MU_APP__.cast(42)`
     */
    cast: async (id: number) => {
      const list = await loadSkills();
      const s = list.find(x => x.id === id);
      if (!s) return null;
      await castSkill(s);
      return { id, name: s.name };
    },
    skills: async () =>
      (await loadSkills()).map(s => {
        const spec = castOf(s);
        return {
          id: s.id,
          name: s.name,
          mana: s.mana,
          range: s.range,
          damage: s.damage,
          /** 主职业（= jobs[0]，面板分组用） */
          job: s.job,
          /** 能学这个技能的职业，来自 SKILL_JOBS（= 服务端 Skill.txt 的 DW/DK/FE/MG） */
          jobs: s.jobs,
          /** 源码/兜底 */
          source: spec.source,
          /** 骨架动作号；-1 = 按当前武器算挥砍 */
          action: spec.action,
          actionNote: spec.actionNote,
          /** 这一技能实际会放几件特效、分别是什么 */
          parts: spec.parts.map(p => ({
            kind: p.kind,
            file: p.file,
            anchor: p.anchor,
            count: p.count,
            /** 模型的缩放（源码 +0x1a，默认 1）；贴图没有这个字段 */
            scale: p.scale ?? null,
            /** 贴图的边长（米）；模型是 null */
            size: p.size ?? null,
            /** 寿命（秒，源码 +0x18 帧 ÷ 25）；null = 按动画长度 */
            life: p.life ?? null,
            /** 动画速度（源码 +0x33）；null = 默认 0.3 */
            speed: p.speed ?? null,
            /** 离地高度（米，源码 [6] += 400） */
            drop: p.drop ?? null,
            /** 初速度（米/秒，源码 +0x30..32 单位/帧） */
            vel: p.vel ?? null,
            /** 多实例散开半径（探针按它放宽落点容差） */
            spread: p.spread ?? 0,
            lift: p.lift ?? 0,
            homing: p.homing === true,
            /** 追踪匀速（米/秒）：龙卷风 2.4 */
            flySpeed: p.flySpeed ?? null,
            /** 自转（弧度/秒） */
            spin: p.spin ?? null,
            /** 图集切分；null = 单张静态贴图 */
            frames: p.frames ?? null,
            /** 着色（0xRRGGBB）；null = 不染色 */
            tint: p.tint ?? null,
            /** 延迟生成（秒） */
            delay: p.delay ?? 0,
            /** 光束是否指向目标 */
            aim: p.aim === true,
            /** 重力（米/秒²） */
            gravity: p.gravity ?? null,
            note: p.note ?? null,
          })),
          /**
           * 第一件特效的文件名（截图脚本、探针用来命名/比对）。
           * `weapon` 件没有模型文件 —— 它转的是**玩家当前武器**，标成 `weapon` 更准确。
           */
          file:
            spec.parts[0]?.kind === 'weapon'
              ? 'weapon'
              : spec.parts[0]?.kind === 'weaponSlam'
                ? 'slam'
                : (spec.parts[0]?.file ?? s.fx?.file ?? null),
          size: s.fx?.size ?? null,
          at: s.fx?.at ?? 'target',
          noDamage: s.fx?.noDamage === true,
        };
      }),
    /** 探针：等价于在下拉里选技能再点 Cast */
    castSkill: async (id: number) => {
      const skill = (await loadSkills()).find(s => s.id === id);
      if (!skill) return { ok: false, reason: 'no-skill' };
      // 探针要连放几十个技能：清掉节流，否则一半请求会被冷却吞掉
      castCd = 0;
      await castSkill(skill);
      const spec = castOf(skill);
      return {
        ok: true,
        name: skill.name,
        source: spec.source,
        action: spec.action,
        parts: spec.parts.length,
        file: skill.fx?.file ?? null,
      };
    },
    /** 当前活着的模型特效（探针断言「点了就真的有特效在跑」） */
    fx: () => effects.snapshot(),
    /** 当前活着的贴图特效（`Data/Effect/*`，源码里那半技能全靠它） */
    fxSprites: () => spriteLayer.snapshot(),
    /** 当前活着的关节 / 光束（源码 `Joint_Create`） */
    fxBeams: () => beamLayer.snapshot(),
    /**
     * 时间缩放：`timeScale(0.001)` 冻住现场再截图，`timeScale(1)` 恢复。
     * 不带参数就只读当前值。
     */
    timeScale: (v?: number) => {
      if (typeof v === 'number' && Number.isFinite(v)) {
        dbgTimeScale = Math.max(0, Math.min(4, v));
      }
      return dbgTimeScale;
    },
    /** 武器拖尾状态（源码 `Trail_RenderAll`） */
    fxTrail: () => trailLayer.snapshot(),
    /** 武器旋转（源码 238 → 239 `RenderWheelWeapon`） */
    fxWheels: () => wheelLayer.snapshot(),
    /** 武器砸地（源码 244 `ItemDrop_RenderGroundWeapon`） */
    fxSlam: () => slamLayer.snapshot(),
    /**
     * buff 状态（`0x07` / `0x1B` / 视野 `ViewSkillState` 三条通道汇到同一张表）。
     *
     *   buffs()               每个实体当前的状态位
     *   buffSet(id, mask)     直接改（走和收包完全相同的增删逻辑）
     *   buffBit(id, bit, on)  加/撤一位
     *   buffNames()           位 → 中文名
     */
    buffs: () => buffLayer.snapshot(),
    buffSet: (id: number, mask: number) => {
      buffLayer.set(id, mask);
      return buffLayer.maskOf(id);
    },
    buffBit: (id: number, bit: number, on: boolean) => {
      buffLayer.applyBit(id, bit, on);
      return buffLayer.maskOf(id);
    },
    buffNames: (mask: number) => stateNames(mask),
    /** 位表（探针按名字取位，别写死 0x10 这种） */
    stateBits: () => ({ ...STATE_BIT }),
    /**
     * 声音（`src/audio/sound.ts`）。
     *
     *   audio()                计数/状态（played / dropped / failed / bgm / ambient）
     *   audioSfx(id, x?, y?)   直接播一个 `PlayBuffer(id)`
     *   audioMute(on?)         开关静音（不传 = 取反），返回当前状态
     *   audioBgm(file|null)    切 BGM（null 停）
     *   audioScene(mapId)      按地图切 BGM + 环境音（等价于进图那一下）
     *   audioReset()           计数清零（探针每段开头调）
     *   audioTable()           音效表（id / 文件 / 通道数 / 3D）
     */
    audioUnlock: () => {
      unlockAudio();
      return audioDebug().contextState;
    },
    audio: () => audioDebug(),
    audioSfx: (id: number, x?: number, y?: number) => sfx(id, { x, y }),
    audioMute: (on?: boolean) => (on === undefined ? toggleMuted() : setMuted(on)),
    audioBgm: (file: string | null) => {
      playBgm(file);
      return audioDebug().bgm;
    },
    audioScene: (mapId: number) => {
      setSceneAudio(mapId);
      return { bgm: audioDebug().bgm, ambient: audioDebug().ambient };
    },
    audioReset: () => {
      resetAudioDebug();
      return true;
    },
    audioTable: async () => (await import('./data/sounds')).SOUNDS,
    /** 技能号 → 音效号（探针核对每个值的 id 都在表里） */
    audioSkillSound: () => ({ ...SKILL_SOUND }),
    /* ---- 本批下行包（0x1F/0x25/0x45/0x46/0x0F/0x29/0x2C/0x5A/0x5B） ---- */
    /** 收屋顶：几栋、几块屋顶 mesh、当前藏了几块 */
    roofs: () => world?.objects.roofs() ?? null,
    /** 地形属性位（`TW_*`），`0x46` 改的就是这张表 */
    mapAttrAt: (x: number, y: number) => {
      const a = world?.terrain.data.attribute;
      if (!a) return -1;
      if (x < 0 || y < 0 || x >= TERRAIN_SIZE || y >= TERRAIN_SIZE) return -1;
      return a[Math.floor(y) * TERRAIN_SIZE + Math.floor(x)];
    },
    /** 天气：雨的强度 + 当前环境粒子统计 */
    weather: () => {
      const rain = (world?.root.getObjectByName('ambient:rain') as THREE.Points | undefined) ?? null;
      return {
        rain: world?.ambient.rainLevel() ?? 0,
        rainVisible: !!rain?.visible,
        ambient: world?.ambient.stats ?? [],
      };
    },
    /** 特殊物品计时（`0x29`）：剩余秒数按 `performance.now()` 现算 */
    specialTime: () =>
      itemSpecialTime
        ? {
            number: itemSpecialTime.number,
            remaining: Math.max(0, Math.round((itemSpecialTime.until - performance.now()) / 1000)),
          }
        : null,
    /** 视野里的战盟成员映射（`0x5B`） */
    guildMembers: () => remotes.guildMembers,
    /**
     * 头顶标签快照（`Render_HPBars` / `Render_CharNameTags`）。
     * 每条：`{ id, name, bar, tenths, focused, visible, pos }`。
     */
    worldTags: () => worldTags.snapshot(),
    /** 队友血量十等分表（`0x44`）：`number → 0..10` */
    partyLife: () => Object.fromEntries(partyLife),
    /* ---- 小地图（纯客户端合成，0.97 原版没有） ---- */
    /** 快照：开关 / 缩放档 / 底图尺寸 / 视口矩形 / 标记数 / 坐标文本 */
    minimap: () => minimap.snapshot(),
    /** 开关小地图（不传就取反），返回当前是否打开 */
    minimapToggle: (on?: boolean) => {
      if (on === undefined) minimap.toggle();
      else minimap.setVisible(on);
      if (minimap.isOpen) syncMinimap();
      return minimap.isOpen;
    },
    /** 切缩放档（整张 / 96 格 / 48 格），返回新的「横向格数」 */
    minimapZoom: () => minimap.cycleZoom(),
    /** 底图像素（探针核对配色用）：`[x, y]` → `[r,g,b]` */
    minimapPixel: (x: number, y: number) => {
      if (!world) return null;
      const cv = world.terrain.buildMinimap();
      const d = cv.getContext('2d')!.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    },
/** 当前特效数量（模型 + 贴图 + 光束 + 拖尾 + 武器）；探针用来验「真的生成了」 */
    fxCount: () =>
      effects.activeCount +
      spriteLayer.activeCount +
      beamLayer.activeCount +
      trailLayer.activeCount +
      wheelLayer.activeCount +
      slamLayer.activeCount,
    /** 清空两层特效（探针每次断言前先清，避免上一轮残留干扰计数） */
    fxClear: () => {
      effects.clear();
      spriteLayer.clear();
      beamLayer.clear();
      trailLayer.clear();
      wheelLayer.clear();
      slamLayer.clear();
      buffLayer.clearAll();
      return true;
    },
    /** 技能靶子：位置 / 名字 / 当前动作 */
    skillTarget: () =>
      skillTarget
        ? {
            name: skillTarget.name,
            x: +skillTarget.x.toFixed(2),
            y: +skillTarget.y.toFixed(2),
            z: +skillTarget.z.toFixed(2),
            action: skillTarget.action,
            spot: { ...SKILL_TEST_SPOT },
          }
        : null,
    attrAt: (x: number, y: number) => {
      const attr = world?.terrain.data.attribute;
      if (!attr) return -1;
      return attr[Math.floor(y) * TERRAIN_SIZE + Math.floor(x)] ?? -1;
    },
    /** 调试：把主角直接挪到某格（不改服务端状态，只用来测安全区/大地图表现） */
    setPos: (x: number, y: number) => {
      if (!player) return false;
      player.x = x;
      player.y = y;
      player.z = world?.terrain.getHeight(x + 0.5, y + 0.5) ?? 0;
      /*
       * 瞬移类操作必须重置移动跟踪：`lastCell` 还是旧格子的话，
       * 下一次寻路会从**旧位置**开始算，算出来的路径第一格可能在身后，
       * 角色就往反方向走（探针踩过这个坑）。
       */
      resetMoveTracking(x, y);
      movePath = [];
      pathCursor = 0;
      moveGoal = null;
      void refreshPlayerEquipment();
      return true;
    },
    /** 底栏数值（HP/MP/AG/经验/名字/坐标）当前快照，探针用 */
    hudValues: () => hudValues.snapshot(),
    /**
     * 调试：不连服务端也能看底栏版式 —— 塞一份假 0xF3 数据进 refreshHud。
     * 传 Partial 覆盖默认值，比如 `{ life: 10, maxLife: 320 }` 看半血球。
     */
    hudPreview: (over: Partial<CharacterInfo> = {}) => {
      const base: CharacterInfo = {
        x: 130, y: 120, map: 0, dir: 0,
        experience: 1200, nextExperience: 3400, levelUpPoint: 5,
        strength: 28, dexterity: 20, vitality: 25, energy: 10,
        life: 210, maxLife: 320, mana: 60, maxMana: 120, bp: 45, maxBp: 100,
        money: 12345, pkLevel: 0, ctlCode: 0, fruitAddPoint: 0, maxFruitAddPoint: 0,
        raw: new Uint8Array(0),
      };
      currentChar = {
        name: 'DarkKnight',
        level: 12,
        charSet: [0x20],
        info: { ...base, ...over },
      };
      refreshHud();
      return hudValues.snapshot();
    },
    /* ---- 背包 ---- */
    /* ---------------- 黄金弓箭手（0x94-0x9D） ---------------- */
    /** 窗口状态 + 兑换配置 + 背包里的 Rena/Stone 件数 */
    goldenArcher: () => ({
      ...gaPanel.snapshot(),
      info: gaInfo,
      collected: gaCollectedCount(),
    }),
    /** 探针：直接开窗口（不走 0x30/0x94） */
    gaOpen: (type: number, count = 0, lucky = '') => {
      openGoldenArcher({ type, count, lucky });
      return gaPanel.snapshot();
    },
    gaClose: () => {
      closeGoldenArcher();
      return gaPanel.isOpen;
    },
    gaRegister: (type: number) => {
      gaPanel.onRegister?.(type);
      return true;
    },
    gaExchange: (type: number, index: number) => {
      gaPanel.onExchange?.(type, index);
      return true;
    },
    gaRegisterLucky: (number: string) => {
      gaPanel.onRegisterLucky?.(number);
      return true;
    },
    gaExchangeLucky: (number: string) => {
      gaPanel.onExchangeLucky?.(number);
      return true;
    },
    /** 探针：注入 0x94（type@3 / count@4 / lucky@6） */
    injectGa94: (type: number, count: number, lucky = '') => {
      const pkt = new Uint8Array(20);
      pkt[0] = 0xc1;
      pkt[1] = 20;
      pkt[2] = 0x94;
      pkt[3] = type & 0xff;
      pkt[4] = count & 0xff;
      pkt[5] = (count >> 8) & 0xff;
      for (let i = 0; i < 12 && i < lucky.length; i++) pkt[6 + i] = lucky.charCodeAt(i) & 0xff;
      const d = parseGoldenArcherOpen(pkt);
      if (d) openGoldenArcher(d);
      return d;
    },
    /** 探针：注入 0x95 登记回执（count = -1 表示没有物品） */
    injectGa95: (count: number) => {
      const pkt = new Uint8Array(6);
      pkt[0] = 0xc1;
      pkt[1] = 6;
      pkt[2] = 0x95;
      pkt[4] = count & 0xff;
      pkt[5] = (count >> 8) & 0xff;
      const r = parseGoldenArcherRegister(pkt);
      if (!r) return null;
      if (r.count < 0) gaPanel.toast('背包里没有对应物品', 'error');
      else {
        gaPanel.setCount(r.count);
        gaPanel.toast(`已登记 ${r.count}`, 'ok');
      }
      return r;
    },
    /** 探针：注入 0x96 幸运号码 */
    injectGa96: (lucky: string) => {
      const pkt = new Uint8Array(16);
      pkt[0] = 0xc1;
      pkt[1] = 16;
      pkt[2] = 0x96;
      for (let i = 0; i < 12 && i < lucky.length; i++) pkt[3 + i] = lucky.charCodeAt(i) & 0xff;
      const r = parseGoldenArcherLuckyNumber(pkt);
      if (r) gaPanel.setLucky(r.lucky);
      return r;
    },
    /** 探针：注入 0x97/0x00 兑换配置（rena@4 / stone@20 / vip@36） */
    injectGaInfo: (
      rena: number[],
      stone: number[],
      vip: number[] = [0, 0, 0],
      luckyRequired = 0
    ) => {
      const pkt = new Uint8Array(48);
      pkt[0] = 0xc1;
      pkt[1] = 48;
      pkt[2] = 0x97;
      pkt[3] = 0x00;
      const put = (o: number, v: number) => {
        pkt[o] = v & 0xff;
        pkt[o + 1] = (v >> 8) & 0xff;
        pkt[o + 2] = (v >> 16) & 0xff;
        pkt[o + 3] = (v >> 24) & 0xff;
      };
      for (let i = 0; i < 4; i++) put(4 + i * 4, rena[i] ?? 0);
      const stones = [stone[0] ?? 0, stone[1] ?? 0, stone[2] ?? 0, luckyRequired];
      for (let i = 0; i < 4; i++) put(20 + i * 4, stones[i]);
      for (let i = 0; i < 3; i++) put(36 + i * 4, vip[i] ?? 0);
      const inf = parseGoldenArcherInfo(pkt);
      if (inf) {
        gaInfo = inf;
        gaPanel.setInfo(inf);
      }
      return inf;
    },
    /** 探针：注入 0x97/0x01 号码列表（C2 长包，count@8 / 条目@12） */
    injectGaList: (numbers: string[]) => {
      const n = numbers.length;
      const pkt = new Uint8Array(12 + n * 13);
      pkt[0] = 0xc2;
      pkt[1] = (pkt.length >> 8) & 0xff;
      pkt[2] = pkt.length & 0xff;
      pkt[3] = 0x97;
      pkt[4] = 0x01;
      pkt[8] = n & 0xff;
      pkt[9] = (n >> 8) & 0xff;
      for (let i = 0; i < n; i++) {
        const o = 12 + i * 13;
        for (let k = 0; k < 12 && k < numbers[i].length; k++) {
          pkt[o + k] = numbers[i].charCodeAt(k) & 0xff;
        }
      }
      const r = parseGoldenArcherList(pkt);
      if (r) {
        gaPanel.setLuckyNumbers(r.numbers);
        gaPanel.showList();
      }
      return r;
    },
    /** 探针：注入 0x97/0x03 登记号码回执 */
    injectGaRegisterLucky: (result: number) => {
      const pkt = new Uint8Array([0xc1, 5, 0x97, 0x03, result & 0xff]);
      const r = parseGoldenArcherRegisterLuckyResult(pkt);
      if (r) {
        const text =
          ['幸运号码登记成功', '登记幸运号码时出错', '你需要先有一个幸运号码', '幸运号码不正确'][r.result] ??
          `登记失败（${r.result}）`;
        gaPanel.toast(text, r.result === 0 ? 'ok' : 'error');
      }
      return r;
    },
    /** 探针：注入 0x9D 领奖回执 */
    injectGaExchangeLucky: (result: number) => {
      const pkt = new Uint8Array([0xc1, 4, 0x9d, result & 0xff]);
      const r = parseGoldenArcherExchangeLuckyResult(pkt);
      if (r) {
        const text =
          ['恭喜！请领取你的奖励。', '这个幸运号码没有奖励。', '你没有登记过任何幸运号码。', '输入的幸运号码不正确。'][
            r.result
          ] ?? `领奖失败（${r.result}）`;
        gaPanel.toast(text, r.result === 0 ? 'ok' : 'error');
      }
      return r;
    },
    /** 探针：formatLucky 的结果（xxxx - xxxx - xxxx） */
    gaFormatLucky: (n: string) => formatLucky(n),

    /* ---------------- 事件入场（0x8E-0x9B） ---------------- */
    /** 事件状态：等级表、窗口、赛事状态 */
    event: () => ({
      open: eventPanel.isOpen,
      kind: eventKind,
      dsRanges: dsRanges.map(r => `${r.min}-${r.max}`),
      bcRanges: bcRanges.map(r => `${r.min}-${r.max}`),
      charLevel: charLevel(),
      magicGladiator: isMagicGladiator(),
      tickets: inventoryItems
        .filter(i => i.type === TICKET.DS || i.type === TICKET.BC)
        .map(i => `${i.slot}:${i.type}@${i.level}`),
      panel: eventPanel.snapshot(),
      match: matchState,
      matchHud: eventTimer.matchSnapshot(),
    }),
    eventView: () => eventPanel.snapshot(),
    /** 探针：注入 0x8E 恶魔广场等级表（int 从 +4 起，和服务端对齐一致） */
    injectDsLevels: (ranges: { min: number; max: number }[]) => {
      const pkt = new Uint8Array(36);
      pkt[0] = 0xc1;
      pkt[1] = 36;
      pkt[2] = 0x8e;
      ranges.slice(0, 4).forEach((r, i) => {
        const o = 4 + i * 8;
        pkt[o] = r.min & 0xff;
        pkt[o + 1] = (r.min >> 8) & 0xff;
        pkt[o + 4] = r.max & 0xff;
        pkt[o + 5] = (r.max >> 8) & 0xff;
      });
      const out = parseEventRequiredLevels(pkt, 'ds');
      if (out) dsRanges = out;
      return dsRanges;
    },
    /** 探针：注入 0x8F 血色城堡等级表（12 行，前 6 普通后 6 魔剑士） */
    injectBcLevels: (ranges: { min: number; max: number }[]) => {
      const pkt = new Uint8Array(100);
      pkt[0] = 0xc1;
      pkt[1] = 100;
      pkt[2] = 0x8f;
      for (let i = 0; i < 6; i++) {
        const normal = ranges[i] ?? { min: 0, max: 0 };
        const mg = ranges[i + 6] ?? normal;
        const o = 4 + i * 16;
        pkt[o] = normal.min & 0xff;
        pkt[o + 1] = (normal.min >> 8) & 0xff;
        pkt[o + 4] = normal.max & 0xff;
        pkt[o + 5] = (normal.max >> 8) & 0xff;
        pkt[o + 8] = mg.min & 0xff;
        pkt[o + 9] = (mg.min >> 8) & 0xff;
        pkt[o + 12] = mg.max & 0xff;
        pkt[o + 13] = (mg.max >> 8) & 0xff;
      }
      const out = parseEventRequiredLevels(pkt, 'bc');
      if (out) bcRanges = out;
      return bcRanges;
    },
    /** 探针：直接开事件窗口（不走 0x30） */
    eventOpen: (kind: 'ds' | 'bc') => {
      openEventWindow(kind);
      return eventPanel.snapshot();
    },
    /** 探针：点某一档（走 `EventPanel.pick`，和真点击同一条路，含灰行拦截） */
    eventPick: (level: number) => eventPanel.pick(level),
    eventClose: () => {
      closeEventWindow();
      return true;
    },
    /** 探针：注入 0x90 / 0x9A 回执 */
    injectEventResult: (kind: 'ds' | 'bc', result: number) => {
      onEventEnterResult(result, kind);
      return true;
    },
    /** 探针：注入 0x91 剩余时间 */
    injectEventRemain: (eventType: number, minutes: number) => {
      const pkt = new Uint8Array([0xc1, 5, 0x91, eventType & 0xff, minutes & 0xff]);
      const r = parseEventRemainTime(pkt);
      if (!r) return null;
      chatBox.push(
        '系统',
        r.minutes ? `还有 ${r.minutes} 分钟开放` : '现在就可以进入',
        1
      );
      return r;
    },
    /** 探针：注入 0x9B 赛事状态 */
    injectMatchState: (opts: {
      state: number;
      time: number;
      maxMonster?: number;
      curMonster?: number;
      itemOwner?: number;
      itemLevel?: number;
    }) => {
      const pkt = new Uint8Array(13);
      pkt[0] = 0xc1;
      pkt[1] = 13;
      pkt[2] = 0x9b;
      pkt[3] = opts.state & 0xff;
      pkt[4] = opts.time & 0xff;
      pkt[5] = (opts.time >> 8) & 0xff;
      const max = opts.maxMonster ?? 0;
      const cur = opts.curMonster ?? 0;
      pkt[6] = max & 0xff;
      pkt[7] = (max >> 8) & 0xff;
      pkt[8] = cur & 0xff;
      pkt[9] = (cur >> 8) & 0xff;
      const owner = opts.itemOwner ?? -1;
      pkt[10] = owner & 0xff;
      pkt[11] = (owner >> 8) & 0xff;
      pkt[12] = opts.itemLevel ?? 0xff;
      const r = parseMatchState(pkt);
      if (!r) return null;
      matchState = r;
      eventTimer.setMatch({
        kind: 'bc',
        state: r.state,
        seconds: r.time,
        maxMonster: r.maxMonster,
        curMonster: r.curMonster,
        itemOwner: r.itemOwner === remotes.selfId ? '你' : '',
        itemLevel: r.itemLevel,
      });
      return r;
    },
    /** 探针：注入 0x92 倒计时 */
    injectMatchCountDown: (type: number) => {
      const pkt = new Uint8Array([0xc1, 4, 0x92, type & 0xff]);
      return parseMatchCountDown(pkt);
    },
    /** 探针：注入 0x93 排名 */
    injectDsRank: (rank: number, name: string, score: number, exp = 0, money = 0) => {
      /*
       * 和 `parseDevilSquareRank` 的注释对应：服务端先放 5 字节的
       * `PMSG_DEVIL_SQUARE_SCORE_SEND`（全 BYTE，sizeof=5），再把
       * `PMSG_DEVIL_SQUARE_SCORE`（name@0、score@12、exp@16、money@20）
       * memcpy 到 +5。所以线上 name@5、score@17、exp@21、money@25，总 29 字节。
       */
      const pkt = new Uint8Array(29);
      pkt[0] = 0xc1;
      pkt[1] = 29;
      pkt[2] = 0x93;
      pkt[3] = rank;
      pkt[4] = 0xff;
      for (let i = 0; i < 10 && i < name.length; i++) pkt[5 + i] = name.charCodeAt(i) & 0xff;
      const put = (o: number, v: number) => {
        pkt[o] = v & 0xff;
        pkt[o + 1] = (v >> 8) & 0xff;
        pkt[o + 2] = (v >> 16) & 0xff;
        pkt[o + 3] = (v >> 24) & 0xff;
      };
      put(17, score);
      put(21, exp);
      put(25, money);
      const r = parseDevilSquareRank(pkt);
      if (r) {
        chatBox.push(
          '活动',
          `【恶魔广场】#${r.rank} ${r.name} 分数 ${r.score}（经验 ${r.exp} / 金币 ${r.money}）`,
          1
        );
      }
      return r;
    },
    eventHud: () => eventTimer.matchSnapshot(),
    /* ---------------- 战盟（0x50-0x64） ---------------- */
    /** 战盟状态：面板、成员、自己的盟名、待应答的申请 */
    guild: () => ({
      open: guildPanel.isOpen,
      creating: guildPanel.isCreating,
      myGuild: guildPanel.guildName,
      sawSelfViewport: sawSelfGuildViewport,
      count: guildPanel.members.length,
      members: guildPanel.members.map(m => `${m.master ? '*' : ''}${m.name}${m.connected ? '' : '(off)'}`),
      totalScore: lastGuildList?.totalScore ?? 0,
      playScore: lastGuildList?.playScore ?? 0,
      request: guildPanel.pendingRequest,
      self: currentChar?.name ?? '',
    }),
    guildView: () => guildPanel.snapshot(),
    /** 开关战盟窗口（发 0x52） */
    toggleGuild: () => {
      toggleGuildPanel();
      return guildPanel.isOpen;
    },
    guildRefresh: () => {
      guildPanel.onRefresh?.();
      return true;
    },
    /** `/guild`：向附近 3 格内的玩家申请入盟（0x50） */
    guildApply: () => guildApplyNearestPlayer(),
    /** 应答入盟申请（0x51） */
    guildAnswer: (accept: boolean) => {
      const req = guildPanel.pendingRequest;
      if (!req) return false;
      guildPanel.onJoinAnswer?.(accept, req.index);
      return true;
    },
    /** 建盟：先 0x54 请求开框，再 `guildCreate(name, cells)` 发 0x55 */
    guildOpenCreate: () => {
      guildPanel.onOpenCreate?.();
      return true;
    },
    guildCreate: (name: string, cells: number[]) => {
      guildPanel.onCreate?.(name, cells ?? []);
      return true;
    },
    guildCancelCreate: () => {
      guildPanel.onCreateCancel?.();
      return true;
    },
    /** 退盟 / 解散 / 驱逐（0x53，需要个人码） */
    guildDelete: (name: string, code: string) => {
      if (!connection?.connected) return false;
      connection.send(buildGuildDeletePacket(name, code));
      return true;
    },
    /**
     * 探针：注入一条 0x52（C2 长包，含对齐填充），走 `parseGuildList`。
     * 结构：+4 result、+5 count、+8 TotalScore、+12 score、**+16 起成员**。
     */
    injectGuildList: (
      members: { name: string; connected?: boolean; master?: boolean }[],
      totalScore = 0,
      playScore = 0
    ) => {
      const n = members.length;
      const pkt = new Uint8Array(16 + n * 12);
      pkt[0] = 0xc2;
      pkt[1] = (pkt.length >> 8) & 0xff;
      pkt[2] = pkt.length & 0xff;
      pkt[3] = 0x52;
      pkt[4] = n > 0 ? 1 : 0;
      pkt[5] = n;
      pkt[8] = totalScore & 0xff;
      pkt[9] = (totalScore >> 8) & 0xff;
      pkt[10] = (totalScore >> 16) & 0xff;
      pkt[11] = (totalScore >> 24) & 0xff;
      pkt[12] = playScore & 0xff;
      for (let i = 0; i < n; i++) {
        const o = 16 + i * 12;
        const m = members[i];
        for (let k = 0; k < 10 && k < m.name.length; k++) pkt[o + k] = m.name.charCodeAt(k) & 0xff;
        pkt[o + 10] = m.connected === false ? 0x7f : 0;
        pkt[o + 11] = (m.master ? 0x80 : 0) | (m.connected === false ? 0x7f : 0);
      }
      const list = parseGuildList(pkt);
      if (list) {
        lastGuildList = list;
        guildPanel.setList(list);
      }
      return guildPanel.snapshot();
    },
    /** 探针：注入 0x50（有人申请入盟） */
    injectGuildRequest: (name: string, index: number) => {
      guildPanel.showRequest(name, index);
      return guildPanel.snapshot();
    },
    /** 探针：注入 0x55（服务端允许开创建框） */
    injectGuildCreateOpen: () => {
      guildPanel.openCreate();
      return guildPanel.snapshot();
    },
    /** 探针：注入 0x56 建盟结果 */
    injectGuildCreateResult: (result: number, pending = 'TestGuild') => {
      pendingGuildCreate = pending;
      const pkt = new Uint8Array([0xc1, 4, 0x56, result & 0xff]);
      const r = parseGuildCreateResult(pkt);
      if (r) {
        if (r.result === 1) {
          guildPanel.closeCreate(false);
          guildPanel.toast(`战盟「${pendingGuildCreate}」创建成功`, 'ok');
        } else {
          guildPanel.toast('创建失败', 'error');
        }
        pendingGuildCreate = null;
      }
      return guildPanel.snapshot();
    },
    /** 探针：注入 0x5C（某人/自己的战盟名 + 标志） */
    injectGuildViewport: (index: number, name: string) => {
      const mark = new Uint8Array(32);
      if (index === remotes.selfId) guildPanel.setMyGuild(name, mark);
      else remotes.setGuild(index, name, mark);
      return { index, name, self: index === remotes.selfId };
    },
    /* ---------------- 混沌合成（0x86-0x88） ---------------- */
    /** 混沌机状态：面板、箱内物品、本地推导的配方 */
    chaos: () => ({
      open: chaosPanel.isOpen,
      mode: npcMode,
      pendingType: pendingChaosType,
      items: chaosItems.map(i => `${i.slot}:${i.type}:${i.level}`),
      recipe: checkMixRecipe(chaosItems),
      types: CHAOS_MIX_TYPES,
      view: chaosPanel.snapshot(),
    }),
    chaosView: () => chaosPanel.snapshot(),
    /**
     * 探针：不经服务端直接开面板（离线 UI 校验用）。
     * 正常入口只有 NPC 238 的 0x30 result=3。
     */
    chaosOpen: () => {
      npcMode = 'chaos';
      chaosItems = [];
      chaosPanel.setItems([]);
      chaosPanel.setRecipe(0);
      chaosPanel.show();
      return chaosPanel.snapshot();
    },
    /** 放进 / 取回（真发 0x24 flag 3） */
    chaosPut: (slot: number) => {
      putIntoChaosBox(slot);
      return true;
    },
    chaosTake: (slot: number) => {
      takeFromChaosBox(slot);
      return true;
    },
    /** 查成功率（真发 0x88） */
    chaosRate: (type: number) => {
      queryChaosRate(type);
      return true;
    },
    /** 合成（真发 0x86；材料不匹配会被本地拦下） */
    chaosMix: (type: number) => {
      mixChaos(type);
      return pendingChaosType;
    },
    /** 关混沌机（箱内有物品时会拒绝，返回 true = 仍然开着） */
    chaosClose: () => {
      chaosPanel.requestClose();
      return chaosPanel.isOpen;
    },
    /**
     * 探针：注入 0x31 type=3 箱内清单（走 `onContainerList` 同一条路径）。
     * 服务端打开混沌机时**不**主动下发这张表，探针得自己造。
     */
    injectChaosList: (specs: { slot: number; type: number; level?: number; excellent?: number }[]) => {
      const n = specs.length;
      const pkt = new Uint8Array(7 + n * 5);
      pkt[0] = 0xc2;
      pkt[1] = (pkt.length >> 8) & 0xff;
      pkt[2] = pkt.length & 0xff;
      pkt[3] = 0x31;
      pkt[4] = 3; // type = 混沌箱
      pkt[5] = n;
      let o = 6;
      for (const s of specs) {
        pkt[o] = s.slot;
        pkt[o + 1] = s.type & 0xff;
        pkt[o + 2] = ((s.level ?? 0) & 0x0f) << 3;
        pkt[o + 3] = 1; // durability
        // b3：bit7 = type 的第 9 位，低 6 位 = 卓越属性位
        pkt[o + 4] = ((s.excellent ?? 0) & 0x3f) | (s.type & 0x100 ? 0x80 : 0);
        o += 5;
      }
      onContainerList(pkt);
      return chaosPanel.snapshot();
    },
    /** 探针：注入 0x86 合成回执（走 `onChaosMixResult` 同一条路径） */
    injectChaosMix: (result: number, itemType = -1, level = 0) => {
      const pkt = new Uint8Array(8);
      pkt[0] = 0xc1;
      pkt[1] = 8;
      pkt[2] = 0x86;
      pkt[3] = result & 0xff;
      if (itemType >= 0) {
        pkt[4] = itemType & 0xff;
        pkt[5] = (level & 0x0f) << 3;
        pkt[6] = 1;
        pkt[7] = (itemType & 0x100) ? 0x80 : 0;
      } else {
        pkt.fill(0xff, 4, 8);
      }
      onChaosMixResult(pkt);
      return chaosPanel.snapshot();
    },
    /** 探针：注入 0x88 成功率回执 */
    injectChaosRate: (rate: number, money: number) => {
      /*
       * 按**服务端真实布局**构造：`ChaosBox.h` 没 pack(1)，两个 DWORD 都要
       * 4 字节对齐 → rate@4、money@8，包长 12，+3 是对齐洞。
       * 以前这里按 11 字节 packed 造，和解析器一起错，测试就自洽地骗过自己了。
       */
      const pkt = new Uint8Array(12);
      pkt[0] = 0xc1;
      pkt[1] = 12;
      pkt[2] = 0x88;
      const put = (o: number, v: number) => {
        pkt[o] = v & 0xff;
        pkt[o + 1] = (v >> 8) & 0xff;
        pkt[o + 2] = (v >> 16) & 0xff;
        pkt[o + 3] = (v >> 24) & 0xff;
      };
      put(4, rate);
      put(8, money);
      onChaosRateReply(pkt);
      return chaosPanel.snapshot();
    },
    /* ---------------- 交易（0x36-0x3D） ---------------- */
    /** 交易状态：窗口、双方物品、确定状态 */
    trade: () => ({
      open: tradePanel.isOpen,
      mine: tradeMine.map(i => `${i.slot}:${i.type}`),
      theirs: tradeTheirs.map(i => `${i.slot}:${i.type}`),
      ok: { ...tradeOk },
      request: tradePanel.pendingRequest,
    }),
    tradeView: () => tradePanel.snapshot(),
    /** 按名字发起交易（/trade 的等价入口） */
    tradeWith: (name: string) => tradeWithName(name),
    /** 放进 / 取回交易格（真发 0x24） */
    tradePut: (slot: number) => {
      moveItemToTrade(slot);
      return true;
    },
    tradeTake: (slot: number) => {
      moveItemFromTrade(slot);
      return true;
    },
    /** 放入交易金币（真发 0x3A） */
    tradeMoney: (money: number) => {
      tradePanel.onSetMoney?.(money);
      return true;
    },
    /** 确定 / 取消确定（真发 0x3C） */
    tradeOk: (flag: boolean) => {
      tradePanel.onOk?.(flag);
      return true;
    },
    /** 取消交易（真发 0x3D） */
    tradeCancel: () => {
      tradePanel.onCancel?.();
      return true;
    },
    /** 探针：注入「交易开始」（走和 0x37 相同的 UI 路径） */
    injectTradeStart: (name: string, level: number) => {
      tradeMine = [];
      tradeTheirs = [];
      tradeOk = { mine: false, theirs: false };
      tradePanel.show(name, level);
      refreshTradePanel();
      tradePanel.setOk(false, false);
      return tradePanel.snapshot();
    },
    /** 探针：注入对方放入的物品（0x39） */
    injectTradeItem: (slot: number, type: number, level = 0, durability = 1) => {
      tradeTheirs = tradeTheirs.filter(i => i.slot !== slot).concat({
        slot,
        type,
        level,
        option: 0,
        durability,
        skill: false,
        luck: false,
        excellent: 0,
      });
      tradePanel.setTheirs(tradeTheirs);
      return tradePanel.snapshot();
    },
    /** 探针：注入确定状态（0x3C） */
    injectTradeOk: (flag: number) => {
      if (flag === 0) tradeOk = { mine: false, theirs: false };
      else tradeOk.theirs = true;
      tradePanel.setOk(tradeOk.mine, tradeOk.theirs);
      return tradePanel.snapshot();
    },
    /** 探针：注入交易结果（0x3D） */
    injectTradeResult: (result: number) => {
      tradePanel.hide();
      tradeOk = { mine: false, theirs: false };
      return result;
    },

    /* ---------------- 组队（0x40-0x44） ---------------- */
    /** 队伍状态：窗口、成员、待应答邀请、附近玩家 */
    party: () => ({
      open: partyPanel.isOpen,
      members: partyMembers.map(m => `${m.number}:${m.name} ${m.life}/${m.maxLife}`),
      invite: partyPanel.pendingInvite,
    }),
    /** 队伍面板快照（血条格数 / 坐标 / 附近玩家） */
    partyView: () => partyPanel.snapshot(),
    /** P 键等价：开关队伍窗口 */
    openParty: () => {
      togglePartyPanel();
      return partyPanel.isOpen;
    },
    /** 邀请视野里的某个玩家（真发 0x40） */
    partyInvite: (id: number) => {
      partyPanel.onInvite?.(id);
      return true;
    },
    /** 踢人 / 退队（真发 0x43，number 是队伍位置） */
    partyKick: (number: number) => {
      partyPanel.onKick?.(number);
      return true;
    },
    /** 应答邀请（真发 0x41） */
    partyRespond: (index: number, accept: boolean) => {
      if (accept) partyPanel.onAccept?.(index);
      else partyPanel.onDecline?.(index);
      return true;
    },
    /**
     * 探针：注入一份队伍列表（走和 0x42 相同的渲染路径）。
     * `openPanel = false` 用来测「紧凑血条」——面板关着但有队伍。
     */
    injectPartyList: (
      members: { name: string; number: number; life: number; maxLife: number; map?: number; x?: number; y?: number }[],
      openPanel = true
    ) => {
      partyMembers = members.map(m => ({
        name: m.name,
        number: m.number,
        life: m.life,
        maxLife: m.maxLife,
        map: m.map ?? 0,
        x: m.x ?? 0,
        y: m.y ?? 0,
      }));
      partyPanel.setMembers(partyMembers);
      // 和真 0x42 一样：重发成员表会把血量十等分清掉
      partyLife.clear();
      if (openPanel) {
        if (!partyPanel.isOpen) partyPanel.show();
      } else if (partyPanel.isOpen) {
        partyPanel.hide();
      }
      return partyPanel.snapshot();
    },
    /** 探针：注入一条「有人邀请你」（走和 0x40 相同的 UI 路径） */
    injectPartyRequest: (index: number, name: string) => {
      partyPanel.showInvite(index, name);
      if (!partyPanel.isOpen) partyPanel.show();
      return partyPanel.snapshot();
    },
    /** 探针：注入血量包（十等分）—— 同样落到 `partyLife`（= 头顶血条的数据源） */
    injectPartyLife: (list: { number: number; tenths: number }[]) => {
      partyPanel.setLife(list);
      for (const l of list) partyLife.set(l.number, Math.max(0, Math.min(10, l.tenths)));
      return partyPanel.snapshot();
    },
    /** 探针：只设焦点（不真的发包 —— 假怪 id 发给服务端会被当成非法目标） */
    focusOn: (id: number) => {
      focusId = id;
      return focusId;
    },

    /* ---------------- 任务（0xA0-A3） ---------------- */
    /** 任务状态：bitmask 展开后的表 + 窗口是否打开 */
    quests: () => ({
      open: questPanel.isOpen,
      loaded: !!questData,
      count: questData?.quests.length ?? 0,
      states: Object.fromEntries(questStates),
      mask: Array.from(questMask),
      selected: questPanel.currentIndex,
    }),
    /** 任务窗口快照（列表行 + 详情文本 + 按钮文案） */
    questPanelView: () => questPanel.snapshot(),
    /** 打开任务窗口（探针用） */
    openQuests: async () => {
      await toggleQuestPanel();
      return questPanel.isOpen;
    },
    /** 选中某个任务 */
    selectQuest: (index: number) => {
      questPanel.select(index);
      return questPanel.currentIndex;
    },
    /** 点「接取 / 完成」（真发 0xA2） */
    questAction: (index: number) => {
      questPanel.select(index);
      return requestQuestState(index);
    },
    /** 探针：注入一条 0xA2 回执（走和收包完全相同的处理路径，只测 UI/状态） */
    injectQuestResult: (index: number, result: number, state: number) => {
      applyQuestResult({ index, result, state });
      return questPanel.snapshot();
    },

    /* ---------------- 拆堆叠 / 修理 / 仓库密码（0x2B / 0x34 / 0x83） ---------------- */
    /** 通用输入框是否打开（拆堆叠 / 仓库密码共用） */
    dialogOpen: () => dialog.isOpen,
    /** 打开「拆分堆叠」框（探针用：之后直接操作 DOM 填数量并点确定） */
    openSplit: (slot: number) => {
      openSplitDialog(slot);
      return dialog.isOpen;
    },
    /** 打开仓库密码框（探针用） */
    openWarehousePassword: () => {
      openWarehousePasswordDialog();
      return dialog.isOpen;
    },
    /** 单件修理（探针用：不发 UI，直接发 0x34 type=0） */
    repairOne: (slot: number) => repairOne(slot),
    /** 仓库锁状态（0x83 下行） */
    warehouseState: () => warehouseState,

    /** 服务端下发的背包快照（含装备栏 64..75） */
    inventory: () =>
      inventoryItems.map(i => ({ ...i, name: itemAttr(i.type).name, wh: [itemAttr(i.type).w, itemAttr(i.type).h] })),
    /** 背包开关（I / V，和原版 Player_InputTick.cpp:475 一致） */
    inventoryOpen: () => inventoryPanel.isOpen,
    toggleInventory: (show?: boolean) => {
      toggleInventory(show);
      return inventoryPanel.isOpen;
    },
    /** 发 0x24 把物品从 fromSlot 挪到 toSlot（toSlot < 12 就是装备槽） */
    moveItem: (from: number, to: number) => {
      // 走和拖拽完全相同的判定路径，方便探针复现「装备被拒」的原因
      const ok = requestItemMove(from, to);
      return { ok, lastMove };
    },
    /** 调试：最近一次拖拽的 from/to（确认面板算出来的槽位） */
    lastMove: () => lastMove,
    /**
     * 调试：往背包里塞一批物品（不连服务端也能验图标）。
     *   `__MU_APP__.inventoryFill([0, 391, 471])`
     * 从 12 号格开始按 1×1 摆放；宽高不一的物品可能重叠，够用了。
     */
    inventoryFill: (types: number[], show = true) => {
      inventoryItems = types.map((type, i) => ({
        slot: 12 + i,
        type,
        level: 0,
        skill: false,
        luck: false,
        option: 0,
        durability: 20,
        excellent: 0,
      }));
      inventoryPanel.setItems(inventoryItems);
      if (show) toggleInventory(true);
      return inventoryItems.length;
    },
    /** 调试：打开商店 / 仓库面板（不连服务端） */
    npcPanelOpen: (mode: 'shop' | 'warehouse' = 'warehouse') => {
      npcMode = mode;
      npcPanel.show(mode);
      return mode;
    },
    /** 调试：往当前打开的面板（商店/仓库）里塞物品 */
    npcPanelFill: (types: number[]) => {
      npcPanel.setItems(
        types.map((type, i) => ({
          slot: i,
          type,
          level: 0,
          skill: false,
          luck: false,
          option: 0,
          durability: 20,
          excellent: 0,
        }))
      );
      return types.length;
    },
    /** 调试：地面物品各自挂了几个模型 mesh（0 = 只有光斑，模型没出来） */
    itemMeshes: () =>
      groundItems.list().map(g => ({
        id: g.id,
        type: g.type,
        name: itemDisplayName(g.type),
        meshes: groundItems.meshCount(g.id),
      })),
    /** 调试：黑龙波 4 条激光的实时位置 / 到施法者的水平距离 */
    dragonWave: () => dragonWaveLive,
    /** 调试：地面物品名标签快照（悬停 / Alt 全显） */
    itemLabels: () => itemLabels.snapshot(),
    /** 调试：指针状态与「指着的地面物品」（验悬停命中） */
    pointerDebug: () => {
      const rect = fxLayer.getBoundingClientRect();
      return {
        hoverX,
        hoverY,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        pick: groundItems.pickAt(muCamera.camera, hoverX, hoverY, rect, 30),
        items: groundItems.list().map(g => {
          const v = new THREE.Vector3(g.wx, g.wy, g.wz + 0.08).project(muCamera.camera);
          return {
            id: g.id,
            type: g.type,
            sx: +((v.x * 0.5 + 0.5) * rect.width + rect.left).toFixed(1),
            sy: +((-v.y * 0.5 + 0.5) * rect.height + rect.top).toFixed(1),
          };
        }),
      };
    },
    /** 调试：地面上所有物品（含世界坐标，给标签/投影用） */
    itemsOnGround: () => groundItems.list(),
    /**
     * 调试：某件地面物品在屏幕上的位置（client 坐标，给「鼠标移过去」用）。
     * 物品中心和它头顶（名字标签的锚点）都返回。
     */
    itemScreenPos: (id: number) => {
      const g = groundItems.list().find(x => x.id === id);
      if (!g) return null;
      const rect = fxLayer.getBoundingClientRect();
      const v = new THREE.Vector3();
      const project = (x: number, y: number, z: number) => {
        v.set(x, y, z).project(muCamera.camera);
        return {
          x: (v.x * 0.5 + 0.5) * rect.width + rect.left,
          y: (-v.y * 0.5 + 0.5) * rect.height + rect.top,
          behind: v.z > 1,
        };
      };
      return { id, center: project(g.wx, g.wy, g.wz), top: project(g.wx, g.wy, g.wz + 0.55) };
    },
    /** 调试：关掉商店/仓库面板 */
    npcPanelHide: () => npcPanel.hide(),
    /* ---- 服务器传送（原版 RenderServerDivision / 0x30 result=5） ---- */
    /**
     * 调试：开/关服务器传送窗口。
     *
     * 本机这份 GameServer 的 `MonsterSetBase.txt` 里**没有 234 号 NPC**
     * （`NpcTalk.cpp:69` 那条分支），所以真实会话里收不到 `0x30 result=5`，
     * 只能从这里注入验证界面。
     */
    serverDivision: (on = true) => {
      if (on) {
        closeOtherNpcWindows();
        svdPanel.show();
      } else {
        closeServerDivision();
      }
      return svdPanel.snapshot();
    },
    /** 调试：服务器传送窗口当前状态（不改变它） */
    serverDivisionState: () => svdPanel.snapshot(),
    /**
     * 调试：服务端推过来的三张辅助表（`F3/E3` 堆叠 / `F3/E4` 价格 / `F3/E5` 移动）。
     * 登录成功之后服务端会主动推，正常情况下三条都不为 0。
     */
    serverTables: () => ({
      ...serverTablesSnapshot(),
      // `F3/E5` 覆盖到本地 warp 表之后，条目上的门槛/价格长什么样
      warp: warpTable.entries.slice(0, 8).map(e => ({
        key: e.key,
        mapId: e.mapId,
        money: e.money,
        lv: [e.minLevel, e.maxLevel],
        canMove: e.canMove ?? null,
      })),
    }),
    /** 调试：结束游戏回到「选择线路」（= ESC 菜单的「回到选择服务器画面」） */
    leaveToLogin: () => leaveGame('login', 2, ''),
    /**
     * 调试：直接进离线沙盘（原「离线演示」按钮）。
     * 老探针点的就是那个按钮，按钮现在改成「结束游戏」了，改走这个口。
     */
    offline: (cls?: number) => void enterOfflineSandbox(cls),
    /** 调试：当前是否离线演示页面（`/demo`） */
    isDemo: () => DEMO,
    /** 调试：物品悬停旋转的当前状态（`ui/itemSpin.ts`） */
    itemSpin: () => spinState(),
    /** 调试：`chs/item.bmd` 物品名表（条数 + 几个样本） */
    itemNames: (types: number[] = [0, 8, 128, 192, 452, 471]) => ({
      size: itemNamesSize(),
      names: types.map(t => `${t}:${itemAttr(t).name}`),
    }),
    /** 调试：查某件物品的服务端售价/堆叠上限（表没到就是 null / 0） */
    itemServerValue: (type: number, level = -1) => ({
      value: itemValueOf(type, level),
      maxStack: itemMaxStack(type, level),
    }),
    /**
     * 调试：改 tooltip 判定用的角色等级/四维（验「还需 N」那行）。
     * 不传就是读当前值。
     */
    heroStats: (over?: { level?: number; str?: number; agi?: number; ene?: number }) => {
      const info = currentChar?.info ?? null;
      const cur = {
        level: currentChar?.level ?? 0,
        str: info?.strength ?? 0,
        agi: info?.dexterity ?? 0,
        ene: info?.energy ?? 0,
      };
      if (over) inventoryPanel.setHero({ ...cur, ...over });
      return cur;
    },
    /** 调试：背包 tooltip 现在显示的那几行（悬停时才有） */
    itemTip: () => {
      const el = document.querySelector<HTMLElement>('#mu-ui .ui-tip');
      if (!el || el.classList.contains('hidden')) return null;
      return el.innerText.split('\n').filter(l => l.trim());
    },
    /** 调试：模拟按住 / 松开 Alt（原版 Alt 显示所有地面物品名） */
    setAlt: (on: boolean) => {
      altHeld = on;
      syncItemLabels();
      return altHeld;
    },
    /** 调试：某件地面物品会显示成什么名字 / 颜色（原版 RenderItemName） */
    itemLabelOf: (
      type: number,
      opts: Partial<{ level: number; option: number; excellent: boolean; skill: boolean; luck: boolean; money: number }> = {}
    ) => {
      const isMoney = type === TYPE_MONEY;
      const g: GroundItem = {
        id: 0,
        x: 0,
        y: 0,
        type,
        level: opts.level ?? 0,
        durability: 20,
        option: opts.option ?? 0,
        excellent: opts.excellent ?? false,
        skill: opts.skill ?? false,
        luck: opts.luck ?? false,
        isMoney,
        money: isMoney ? (opts.money ?? 1234) : 0,
      };
      return groundItemLabelOf(g);
    },
    /** 角色属性面板（C） */
    characterOpen: () => characterPanel.isOpen,
    toggleCharacter: (show?: boolean) => toggleCharacter(show),
    /** 面板上每一行实际渲染出来的文字，用来核对坐标/字段有没有错位 */
    characterRows: () =>
      Object.fromEntries(
        [...document.querySelectorAll('.chr-text')].map(el => [
          (el as HTMLElement).dataset.row ?? '?',
          el.textContent ?? '',
        ])
      ),
    /** 底栏按钮的命中框（逻辑坐标），验证和原版 Player_InputTick 是否一致 */
    bottomButtons: () =>
      [...document.querySelectorAll('.bar-btn')].map(el => {
        const rect = el.getBoundingClientRect();
        const stage = stageEl.getBoundingClientRect();
        const s = uiLayer.scaleFactor || 1;
        return {
          id: (el as HTMLElement).dataset.btn,
          x: Math.round((rect.left - stage.left) / s),
          y: Math.round((rect.top - stage.top) / s),
          w: Math.round(rect.width / s),
          h: Math.round(rect.height / s),
        };
      }),
    /** 调试：直接拿一张 Interface 贴图（页面内用，不能 JSON 序列化） */
    uiSprite: (name: string) => uiSprite(name),
    /**
     * 调试：采样某张 Interface 贴图的像素。
     * 用来判断 JPEG 类图标是不是「黑底 colorkey」（原版靠 EnableAlphaTest 抠掉），
     * 是的话 H5 这边也得把纯黑转成透明，否则贴到底栏上就是一块黑。
     */
    uiPixel: async (name: string) => {
      const sp = await uiSprite(name);
      if (!sp) return null;
      const cv = document.createElement('canvas');
      cv.width = sp.image.width;
      cv.height = sp.image.height;
      const g = cv.getContext('2d')!;
      g.drawImage(sp.image, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] + d[i + 1] + d[i + 2] < 60) dark++;
      }
      const at = (x: number, y: number) => {
        const i = (y * cv.width + x) * 4;
        return [d[i], d[i + 1], d[i + 2]];
      };
      return {
        w: cv.width,
        h: cv.height,
        corner: at(0, 0),
        center: at(cv.width >> 1, cv.height >> 1),
        darkRatio: +(dark / (cv.width * cv.height)).toFixed(3),
      };
    },
    /**
     * 调试：把本地背包临时换成给定列表（只影响 UI）。
     * 这台服务端拒绝一切「背包 → 装备槽」的 0x24（二进制里装备分支走反了），
     * 所以验证装备槽渲染只能靠注入假数据，不能靠真穿戴。
     */
    mockInventory: (list: { slot: number; type: number; durability?: number }[]) => {
      // 假背包和沙盘都是「外观覆盖层」，后调用的说了算：
      // 探针想验证真实背包链路时先 mockInventory，就不能再让沙盘顶在上面。
      if (sandbox.on) {
        sandbox.on = false;
        sandboxPanel.show(false);
      }
      inventoryItems = list.map(i => ({
        slot: i.slot,
        type: i.type,
        level: 0,
        skill: false,
        luck: false,
        option: 0,
        // 耐久默认 100；探针验「修理光标」时传低耐久（< 上限）的物品
        durability: i.durability ?? 100,
        excellent: 0,
      }));
      syncInventoryViews();
      return inventoryItems.length;
    },
    /** 调试：最近收到的报文头（确认服务端到底发了哪些包） */
    heads: () => [...recentHeads],
    /* ---- ESC 菜单 / 自动攻击 / 头顶名字（本轮新增的探针口） ---- */
    /** 调试：手动拉一次角色列表（探针用，返回条数或错误） */
    charListReload: async (timeoutMs = 3000) => {
      if (!session) return 'no session';
      try {
        const list = await session.requestCharacterList(timeoutMs);
        return list.map(c => `${c.slot}:${c.name}`).join(',');
      } catch (e) {
        return 'ERR ' + (e instanceof Error ? e.message : String(e));
      }
    },
    /** 调试：ESC 菜单状态（文案 + 原版逻辑坐标） */
    esc: () => escMenu.snapshot(),
    /** 调试：自动攻击状态 */
    autoAttack: () => ({
      id: autoAttackId,
      pending: pendingTargetId,
      cd: +attackCd.toFixed(2),
      attacking: isAttacking(),
      // 每挥一次 +1（`attackCombo` 是原版 c+771 那个连击计数），用来数「打了几刀」
      combo: attackCombo,
    }),
    /** 调试：把自动攻击的目标设成某只怪（不点鼠标也能测） */
    setAutoAttack: (id: number) => {
      autoAttackId = id;
      return autoAttackId;
    },
    /** 调试：藏/显自己的模型（给「名字是不是在头顶」做剪影对比） */
    selfShow: (on: boolean) => {
      if (!player) return false;
      for (const m of player.meshes) m.visible = on;
      for (const p of player.props) p.visible = on;
      return true;
    },
    /** 调试：世界坐标 → 舞台像素（`#fx` 的坐标系，左上角 0,0） */
    project: (x: number, y: number, z: number) => {
      const rect = fxLayer.getBoundingClientRect();
      const v = new THREE.Vector3(x, y, z).project(muCamera.camera);
      return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height, z: v.z };
    },
    /** 调试：头顶名字的高度测量明细 */
    headProbe: () => {
      if (!world || !player) return null;
      const terrain = world.terrain;
      const measure = (name: string, actor: Actor, x: number, y: number) => {
        const gz = terrain.getHeight(x, y);
        // 和 `headHeightOf` 同一套算法：蒙皮后的世界包围盒
        const box = new THREE.Box3();
        const tb = new THREE.Box3();
        for (const m of actor.meshes) {
          if (typeof m.computeBoundingBox === 'function') m.computeBoundingBox();
          const bb = m.boundingBox;
          if (!bb || bb.isEmpty()) continue;
          tb.copy(bb).applyMatrix4(m.matrixWorld);
          box.union(tb);
        }
        const v = new THREE.Vector3();
        let boneTop = -Infinity;
        actor.root.traverse(o => {
          if ((o as THREE.Bone).isBone) {
            o.getWorldPosition(v);
            if (v.z > boneTop) boneTop = v.z;
          }
        });
        const rootBox = new THREE.Box3().setFromObject(actor.root);
        return {
          name,
          meshes: actor.meshes.length,
          meshH: box.isEmpty() ? 0 : +(box.max.z - gz).toFixed(2),
          boneTop: Number.isFinite(boneTop) ? +(boneTop - gz).toFixed(2) : null,
          rootBoxTop: rootBox.isEmpty() ? null : +(rootBox.max.z - gz).toFixed(2),
          used: +headHeightOf(actor, gz, 0).toFixed(2),
        };
      };
      const rows = [];
      if (currentChar) rows.push(measure(`self:${currentChar.name}`, player, player.wx, player.wy));
      for (const e of remotes.list()) {
        const ent = remotes.get(e.id);
        if (ent) rows.push(measure(e.name, ent.actor, e.x, e.y));
      }
      return rows;
    },
    /** 走到指定格（等同点击地面） */
    /** 调试：最近的拖拽落点记录（`ui/itemDrag.ts` 写的） */
    dragLog: () => (window as unknown as { __MU_DRAG_LOG__?: unknown[] }).__MU_DRAG_LOG__ ?? [],
    /** 调试：某格能不能站（地形可走 + 没被单位占） */
    canStandAt: (x: number, y: number) => canStand(x, y),
    /** 调试：寻路为什么失败（`walkTo` 之后读它） */
    walkWhy: () => walkFail,
    walkTo: (x: number, y: number) => {
      pendingTargetId = -1;
      return walkToCell(x, y);
    },
    /** 走到某格并返回实际路径长度（0 表示不可达） */
    pathTo: (x: number, y: number) => {
      refreshBlocked();
      const dest = nearestFree(Math.floor(x), Math.floor(y), canStand, 2);
      if (!dest) return -1;
      const path = findPath(
        lastCell.x >= 0 ? lastCell.x : Math.floor(player?.x ?? 0),
        lastCell.y >= 0 ? lastCell.y : Math.floor(player?.y ?? 0),
        dest.x,
        dest.y,
        canStand
      );
      return path ? path.length : -1;
    },
    /**
     * 调试：离玩家最近的物件（站在"看着不对"的模型旁边调它，就能知道是哪个 id）。
     * 返回 { id, name, dist }。
     */
    nearestObjects: (n = 6) => {
      const me = player;
      if (!world || !me) return [];
      return world.objects.placed
        .map(o => ({ id: o.id, name: o.name, dist: +Math.hypot(o.x - me.wx, o.y - me.wy).toFixed(1) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, n);
    },
    /**
     * 调试：极光/蛛网/花 那几根「三棱柱特效面片」整体显隐。
     * `false` = 完全不画，`true` = 按叠加混合显示（默认）。
     */
    effects: (visible: boolean) => {
      world?.objects.setEffectVisible(visible);
      return world ? world.objects.effectMeshes.length : 0;
    },
    /** 调试：三棱柱面片总数 / 其中可见数 */
    effectState: () => {
      const l = world ? world.objects.effectMeshes : [];
      return { total: l.length, visible: l.filter(m => m.visible).length };
    },
    /** 调试：每个物件的模型规模（顶点数 / mesh 数 / 包围盒），诊断「是不是小面片」 */
    objectModels: () => (world ? world.objects.modelStats : []),
    /** 调试：被整只隐藏的物件 id → 实例数 */
    hiddenObjects: () => (world ? world.objects.stats.hiddenIds : {}),
    /**
     * 调试：某张贴图的混合判定（`core/blendHeuristic`，看像素不是看名字）。
     *   `__MU_APP__.blendOf('Object3', 'aurora.jpg')`
     */
    /**
     * 调试：某张贴图的候选路径（前 4 个）。
     *   `__MU_APP__.texCandidates('Object1', 'ston02.tga')`
     */
    texCandidates: (dir: string, path: string) => {
      const r = resolveTextureCandidates(`/Data/${dir}/`, path);
      return { isTga: r.isTga, candidates: r.candidates.slice(0, 4) };
    },
    blendOf: async (dir: string, file: string) => {
      const tex = await loadTexture(`/Data/${dir}/`, file);
      if (!tex) return null;
      const v = detectBlend(tex.texture ?? null, file);
      return { ...v, size: tex.texture ? [tex.texture.image.width, tex.texture.image.height] : null };
    },
    /** 调试：混合判定的**原始统计 + 各项得分**（标定阈值用） */
    blendMetrics: async (dir: string, file: string) => {
      const tex = await loadTexture(`/Data/${dir}/`, file);
      if (!tex) return null;
      const r = blendMetrics(tex.texture ?? null, file);
      const img = tex.texture?.image as { width: number; height: number } | undefined;
      return { ...r, size: img ? [img.width, img.height] : null, tag: tex.tag };
    },
    /** 调试：耐力计数（0..40，>=40 时游泳用力竭动作 29） */
    stamina: () => stamina,
    setStamina: (n: number) => {
      stamina = Math.max(0, Math.min(STAMINA_MAX, n | 0));
      return stamina;
    },
    /** 调试：脚下这格是不是水面（亚特兰蒂斯游泳判定用） */
    isWater: (x: number, y: number) => isWaterCell(x, y),
    /** 调试：在玩家周围找一格水面（探针用） */
    findWaterNear: (radius = 30) => {
      if (!player) return null;
      const cx = Math.round(player.x);
      const cy = Math.round(player.y);
      for (let r = 0; r <= radius; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (isWaterCell(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
          }
        }
      }
      return null;
    },
    /**
     * 调试：水面/水下滤镜状态。
     *   `__MU_APP__.waterInfo()`
     */
    waterInfo: () => {
      if (!world) return null;
      const t = world.terrain;
      const u = t.water ? (t.water.material as THREE.ShaderMaterial).uniforms : null;
      return {
        mapId: world.mapId,
        level: t.waterLevel,
        hasMesh: !!t.water,
        quads: t.water ? (t.water.userData.quads as number) : 0,
        time: +(u?.uTime?.value ?? 0).toFixed(3),
        alpha: u ? (u.uAlpha.value as number) : 0,
        amp: u ? (u.uAmp.value as number) : 0,
        tint: +waterTint.toFixed(3),
        tintEl: waterTintEl ? waterTintEl.style.opacity : null,
        tintDisplay: waterTintEl ? waterTintEl.style.display : null,
        isWaterCell: player ? t.isWaterCell(Math.floor(player.x), Math.floor(player.y)) : false,
      };
    },
    /**
     * 调试：地形"按图定标"的提亮开关（A/B 对比用）。
     *   `__MU_APP__.lightLift(false)` → 回到 lift=1（各图各按自身光照图亮度）
     *   `__MU_APP__.lightLift(true)`  → 恢复按均值归一
     */
    lightLift: (on: boolean) => {
      if (!world) return null;
      const mat = world.terrain.mesh.material as THREE.ShaderMaterial;
      const u = mat.uniforms.uLightLift;
      if (!u) return null;
      if (on) u.value = world.terrain.lightLift;
      else u.value = 1;
      return { lift: u.value };
    },
    /** 调试：临时关掉水面（对比画面用） */
    waterShow: (on: boolean) => {
      if (!world?.terrain.water) return false;
      world.terrain.water.visible = on;
      return true;
    },
    /** 调试：F1 帮助窗（文案来自 Text.bmd 120..157） */
    help: () => helpWindow.toggle(),
    helpClose: () => helpWindow.hide(),
    helpSnapshot: () => helpWindow.snapshot(),
    /**
     * 调试：在脚下放一件地面物品（验发光底斑/模型，不动服务端）。
     *   `__MU_APP__.spawnItem(0)`
     */
    spawnItem: (
      type: number,
      opts: Partial<{ level: number; option: number; excellent: boolean; skill: boolean; luck: boolean; money: number }> = {}
    ) => {
      if (!player) return null;
      const id = 990000 + (type & 0xffff);
      /*
       * 连续放几件的时候按格子散开（1..3 格往外、y 上错开一格），
       * 不然全叠在同一格 —— 截图看不清、悬停也只能命中一件。
       */
      const n = spawnSeq++;
      const x = Math.round(player.x) + 1 + (n % 3);
      const y = Math.round(player.y) + (Math.floor(n / 3) % 2) * 2 - 1;
      const isMoney = type === TYPE_MONEY;
      groundItems.upsert([
        {
          id,
          x,
          y,
          type,
          level: opts.level ?? 0,
          durability: isMoney ? 0 : 20,
          option: opts.option ?? 0,
          excellent: opts.excellent ?? false,
          skill: opts.skill ?? false,
          luck: opts.luck ?? false,
          isMoney,
          money: isMoney ? (opts.money ?? 1000) : 0,
        },
      ]);
      return { id, x, y, type, isMoney };
    },
    /**
     * 调试：切换加色混合模式。
     *   `one`   = 原版 `glBlendFunc(GL_ONE, GL_ONE)`，最亮
     *   `alpha` = three 默认 `SRC_ALPHA, ONE`，柔和
     * 已经建好的材质也会一起刷。
     */
    additive: (m: 'one' | 'alpha') => {
      const r = setAdditiveMode(m);
      const seen = new Set<THREE.Material>();
      scene.traverse(o => {
        const mesh = o as THREE.Mesh;
        const mats = mesh.material
          ? Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
          : [];
        for (const mm of mats) {
          if (!mm || seen.has(mm)) continue;
          const additive =
            mm.blending === THREE.AdditiveBlending ||
            (mm.blending === THREE.CustomBlending && mm.blendSrc === THREE.OneFactor);
          if (!additive) continue;
          seen.add(mm);
          useAdditiveBlend(mm);
        }
      });
      return { ...r, existing: seen.size };
    },
    /** 调试：按名字取一个物体的材质混合状态（验加色模式） */
    fxSample: (name: string) => {
      const o = scene.getObjectByName(name) as THREE.Mesh | undefined;
      const m = o?.material as THREE.Material | undefined;
      if (!m) return null;
      return {
        blending: m.blending,
        blendSrc: (m as THREE.MeshBasicMaterial).blendSrc,
        blendDst: (m as THREE.MeshBasicMaterial).blendDst,
        fog: (m as THREE.Material & { fog?: boolean }).fog,
        opacity: (m as THREE.MeshBasicMaterial).opacity,
      };
    },
    /** 调试：加色材质登记数量 / 当前模式 */
    additiveInfo: () => additiveInfo(),
    /** 调试：地面物品的发光底斑数量 / 其中可见数 */
    itemGlowState: () => groundItems.glowStats(),
    /** 调试：当前对话窗对应的任务（对话答案会用它发包） */
    questDialog: () => activeQuestDialog,
    /** 调试：按 NPC Class 打开它的任务对话（和点 NPC 走同一条路） */
    questDialogOpen: async (cls: number) => {
      const info = await questForNpc(cls, playerClassId());
      if (!info) return null;
      activeQuestDialog = { index: info.index, name: info.name };
      const state = questStates.get(info.index) ?? 0;
      await npcDialog.show(questDialogText(info, state));
      return { ...info, state, text: questDialogText(info, state), hasItems: questItemsSatisfied(info) };
    },
    /** 调试：某 NPC Class 对应的任务开场对话号（`quest.bmd`） */
    questForNpc: (cls: number) => questDialogForNpc(cls),
    /**
     * 调试：注入一条任务奖励 `0xA3`（不连服务端也能验转职）。
     *   `__MU_APP__.questReward(0xc9, 0x10)`  → 魔法师一转（职业号 8 = 魔导师）
     *   `__MU_APP__.questReward(0xc8, 5)`     → 只加 5 点可分配点
     */
    questReward: (reward: number, value: number) => {
      handleQuestReward({ reward: reward & 0xff, value: value & 0xff, viewPoint: null });
      return app_questClass();
    },
    /** 调试：当前职业（编码号 / 职业组 / 转职次数 / 名字） */
    questClass: () => app_questClass(),
    /**
     * 调试：**只解析**一条 0xA3（不应用），验证包结构。
     *   `__MU_APP__.questParse('C1 07 A3 00 05 C9 10')`
     */
    questParse: (hex: string) => {
      const bytes = new Uint8Array(
        hex.trim().split(/\s+/).map(h => parseInt(h, 16)).filter(n => Number.isFinite(n))
      );
      const rw = parseQuestReward(bytes);
      if (!rw) return null;
      const isClass = rw.reward === QUEST_REWARD_CLASS || rw.reward === QUEST_REWARD_CLASS_POINT ||
        rw.reward === QUEST_REWARD_CLASS_ONLY;
      return { ...rw, decodedClass: isClass ? decodeQuestClass(rw.value) : null };
    },
    /**
     * 调试：怪物 / NPC 的中文名牌（`Data/Local/NPCName.txt`）。
     * 不传参数就给几个常用 NPC 的样本；表还没加载完会先 await。
     */
    npcNames: async (classes: number[] = [235, 236, 239, 240, 249, 251, 255]) => {
      await npcNamesReady;
      return {
        size: npcNameTableSize(),
        names: classes.map(c => `${c}:${monsterNameOf(c, '') || '—'}`),
      };
    },
    /* ---------------- 可交互世界物件（坐下 / 倚靠） ---------------- */
    /** 当前地图上所有可交互物件（原版 `DAT_083a2370` 那张表） */
    operables: () => {
      syncOperables();
      return operables.map((o, i) => ({
        i,
        id: o.id,
        name: o.name,
        x: +o.x.toFixed(2),
        y: +o.y.toFixed(2),
        z: +(world?.terrain.getHeight(o.x, o.y) ?? 0).toFixed(2),
        kind: o.kind,
      }));
    },
    /** 屏幕坐标命中了哪个可交互物件（和真实 hover 走同一个 picker） */
    operableAt: (x: number, y: number) => {
      const o = pickOperableAt(x, y);
      return o ? { id: o.id, name: o.name, kind: o.kind, cursor: cursorOfOperable(o) } : null;
    },
    /** 直接坐/倚靠第 i 个物件（不走路，探针用）；返回播的动作号 */
    operate: (i: number) => {
      syncOperables();
      const o = operables[i];
      if (!o) return null;
      doOperate(o);
      return { id: o.id, kind: o.kind, action: player?.action ?? -1 };
    },
    /** 点某个物件（会走过去），返回是否排上 */
    operateGo: (i: number) => {
      syncOperables();
      const o = operables[i];
      if (!o) return false;
      tryOperate(o);
      return true;
    },
    /** 调试：坐/倚靠/浮空那几个动作在玩家模型里到底存不存在 */
    playerActions: (ids: number[] = [1, 9, 133, 135, 137, 139, 140]) => {
      const me = player;
      if (!me) return null;
      const acts = me.rig.bmd.actions;
      return {
        count: acts.length,
        keys: ids.map(i => [i, acts[i]?.numKeys ?? -1] as [number, number]),
        current: me.action,
      };
    },
    /** 当前「已排上但还没走到」的物件 */
    operateState: () => ({
      hover: operableHover ? { id: operableHover.id, kind: operableHover.kind } : null,
      pending: pendingOperate ? { id: pendingOperate.id, kind: pendingOperate.kind } : null,
      action: player?.action ?? -1,
      path: movePath.length,
    }),
    /** 调试：看 0x18 动作包的字节（可顺手发出去） */
    actionPacket: (dir: number, action: number, send = false) => {
      const pkt = buildActionPacket(dir, action);
      if (send && connection?.connected) connection.send(pkt);
      return Array.from(pkt).map(b => b.toString(16).padStart(2, '0')).join(' ');
    },
    /**
     * 调试：某任务在某个状态下会显示哪条对话（原版 `CSQuest::CheckQuestState`）。
     *   `__MU_APP__.questTextOf(0, 0)` → 52（开始）
     *   `__MU_APP__.questTextOf(0, 1)` → 55（进行中，东西没齐）
     *   `__MU_APP__.questTextOf(0, 2)` → 56（完成）
     */
    questTextOf: async (index: number, state: number) => {
      const info = await questByIndex(index, playerClassId());
      if (!info) return null;
      const hasItems = questItemsSatisfied(info);
      return {
        index,
        state,
        act: info.act,
        items: info.items,
        hasItems,
        texts: info.texts,
        shown: questTextFor(info, state, hasItems),
        // 「进行中」那一档两条分支都给出，方便对照：没齐 / 齐了
        shownInProgress: questTextFor(info, 1, false),
        shownReadyToHandIn: questTextFor(info, 1, true),
      };
    },
    /**
     * 调试：直接问「这条任务的物品条件在背包里够不够」。
     *   `__MU_APP__.questItems(0)` → { need: {type:471,count:1}, got: 0, ok: false }
     */
    questItems: async (index: number) => {
      const info = await questByIndex(index, playerClassId());
      if (!info) return null;
      let got = 0;
      if (info.items) {
        for (const it of inventoryItems) {
          if (it.slot < INVENTORY_WEAR_SIZE) continue;
          if (it.type === info.items.type) got++;
        }
      }
      return { need: info.items, got, ok: questItemsSatisfied(info) };
    },
    /** 调试：按「任务 + 状态」直接开对话（等价于 NPC 说话后的 CheckQuestState） */
    questDialogShow: async (index: number, state = 0) => {
      await reopenQuestDialog(index, state);
      return npcDialog.snapshot()?.index ?? -1;
    },
    /** 调试：模拟一条 0xA2 回执（不经过网络），用来验「按状态重开对话」 */
    questResultFeed: (index: number, state: number) => {
      applyQuestResult({ index, result: 0, state });
      return { state: questStates.get(index) ?? -1, dialog: npcDialog.snapshot()?.index ?? -1 };
    },
    /** 调试：任务表前几条（名称 / NPC / 对话号） */
    questList: () =>
      loadQuestTable().then(all =>
        all.filter(q => q.npc > 0).map(q => ({ index: q.index, npc: q.npc, name: q.name, dialogs: q.dialogs.slice(0, 2) }))
      ),
    /** 调试：打开第 i 条 NPC 对话（`Data/Local/chs/Dialog.bmd`） */
    dialog: (i: number) => npcDialog.show(i),
    /** 调试：关掉对话窗 */
    dialogClose: () => npcDialog.hide(),
    /** 调试：对话窗当前状态 */
    dialogSnapshot: () => npcDialog.snapshot(),
    /** 调试：物品显示名（应来自 `chs/item.bmd` 的中文） */
    itemName: (type: number) => ({ fromAttr: itemAttr(type).name, fromCatalog: itemDisplayName(type) }),
    /** 调试：物品 type → 模型路径（null = 映射表里就没这一项） */
    itemPath: (type: number) => itemModelPath(type),
    /**
     * 调试：批量体检物品模型（地面掉落 / 背包 / 仓库都靠它）。
     * 返回 `{ type, name, file, exists, proto }`：
     *   `file`   映射出来的文件名
     *   `exists` 文件真的取得到（fetch HEAD）
     *   `proto`  BMD 解析出几个 part（0 / null = 画不出来）
     */
    itemProbe: async (types: number[]) => {
      const out: Record<string, unknown>[] = [];
      for (const type of types) {
        const path = itemModelPath(type);
        const name = itemDisplayName(type);
        if (!path) {
          out.push({ type, name, file: null, exists: false, proto: null });
          continue;
        }
        const file = `${path.dir}${path.file}.bmd`;
        /*
         * 判定顺序：先让 `loadProto` 去试它的三个候选（大写 / 小写 / 首字母大写，
         * 资源包里 `shield16/shield17/sword22` 就是小写的）。能解析出网格 = 文件在。
         *
         * 只有解析不出来时才回头确认「到底是没有文件，还是 BMD 坏了」：
         * 用 GET 看前几个字节 —— dev server 对不存在的路径会回退到 index.html
         * 并返回 200，所以不能只看 `r.ok`；index.html 的首字节是 '<'（0x3C）。
         */
        const protoObj = await loadProto(type);
        const proto = protoObj ? protoObj.parts.length : null;
        let exists = proto !== null;
        if (!exists) {
          for (const candidate of [file, file.toLowerCase()]) {
            try {
              const r = await fetch(assetUrl(`${path.dir}${candidate}`));
              const b = new Uint8Array(await r.arrayBuffer());
              if (b.length > 32 && b[0] !== 0x3c) {
                exists = true;
                break;
              }
            } catch {
              /* 试下一个 */
            }
          }
        }
        out.push({ type, name, file, exists, proto });
      }
      return out;
    },
    /** 调试：物品图标（背包/仓库格子里那张图）；null = 画不出来 */
    itemIcon: (type: number, level = 0) => itemIcon(type, level),
    /** 调试：物品图标朝向算法的变体开关（扫参数用，见 `ui/itemIcon.ts`） */
    iconDebug: (o: Partial<typeof iconDebug>) => {
      Object.assign(iconDebug, o);
      clearItemIcons();
      return { ...iconDebug };
    },
    /** 调试：`Data/Local/Text.bmd` 的一条文案（原版 `GlobalText[i]`） */
    text: async (i: number) => ({ text: await textAt(i), source: await textSource() }),
    /** 调试：服务端字符集（gbk / utf-8）与 GBK 反查表大小 */
    textCodec: () => textCodecInfo(),
    /** 调试：把字符串按服务端字符集编码成字节（验中文不会变成单字节垃圾） */
    encodeText: (text: string) => Array.from(encodeServerText(text, 59)),
    /** 调试：把字节按服务端字符集解码回来 */
    decodeText: (bytes: number[]) => decodeServerText(new Uint8Array(bytes)),
    /** 调试：光标状态（载入了哪几种、当前是什么、鼠标下有什么） */
    cursor: () => ({
      ...cursorInfo(),
      hover: hoverTarget(hoverX, hoverY),
      lmbDown,
      rightDrag: rightState ? rightState.dragged : null,
    }),
    /** 调试：按当前鼠标位置放一次技能（右键的同一条路径） */
    castSkillAtPointer: () => castSkillAtPointer(hoverX, hoverY),
    /** 调试：最近若干次点地面的决策记录（定位「点了没反应」） */
    clickLog: () => [...clickLog],
    /**
     * 调试：屏幕坐标走一遍「点击地面」的同一套换算，返回世界落点与格号。
     * 和 `pointerdown` 里完全是同一条路径（NDC → 射线 → 地形），
     * 用来做「投影 → 拾取」往返校验：把格心投影到屏幕再喂回来，应当还原同一格。
     */
    pickScreen: (sx: number, sy: number) => {
      if (!world) return null;
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((sx - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((sy - rect.top) / rect.height) * 2 + 1;
      const p = pickTerrainPoint(muCamera.camera, ndcX, ndcY, world.terrain.getHeight);
      return p
        ? { x: +p.x.toFixed(3), y: +p.y.toFixed(3), cell: [Math.floor(p.x), Math.floor(p.y)] }
        : null;
    },
    /** 调试：清空点击记录（探针按单次点击分类） */
    clearClickLog: () => {
      clickLog.length = 0;
      return true;
    },
    /** 调试：当前占位格列表 */
    selfMoveLog: () => selfMoveLog,
    blockedList: () => {
      const out: { x: number; y: number }[] = [];
      for (const k of blockedCells) out.push({ x: k & 0xff, y: k >> 8 });
      return out;
    },
    /** 移动调试：路径、上报队列、服务端已知位置 */
    moveInfo: () => ({
      len: movePath.length,
      cursor: pathCursor,
      next: movePath[pathCursor] ?? null,
      goal: moveGoal,
      blocked: blockedCells.size,
      dir: [+moveDir.x.toFixed(2), +moveDir.y.toFixed(2)],
      lastCell: { ...lastCell },
      sentCell: { ...sentCell },
      outSteps: outSteps.length,
      clearReason: moveClearReason,
    }),
    /** 单帧位移判定的内幕：为什么走不动 */
    stepProbe: () => {
      if (!player) return null;
      const nx = player.x + moveDir.x * WALK_SPEED * 0.016;
      const ny = player.y + moveDir.y * WALK_SPEED * 0.016;
      const hereX = playerCellX();
      const hereY = playerCellY();
      const chk = (x: number, y: number) => {
        const cx = Math.round(x);
        const cy = Math.round(y);
        if (cx === hereX && cy === hereY) return 'self';
        return canStand(cx, cy);
      };
      return {
        x: +player.x.toFixed(2),
        y: +player.y.toFixed(2),
        here: { x: hereX, y: hereY },
        dir: [+moveDir.x.toFixed(2), +moveDir.y.toFixed(2)],
        next: movePath[pathCursor] ?? null,
        remaining: movePath.length - pathCursor,
        all: { cell: [Math.round(nx), Math.round(ny)], ok: chk(nx, ny) },
        xOnly: { cell: [Math.round(nx), hereY], ok: chk(nx, player.y) },
        yOnly: { cell: [hereX, Math.round(ny)], ok: chk(player.x, ny) },
        blocked: [...blockedCells].map(k => `${k & 0xff},${k >> 8}`),
      };
    },
    /** 调试：移动包收发记录 */
    netLog: () => ({ sent: [...sendLog], echo: [...echoLog] }),
    /** 某格是否可站（含单位占位） */
    canStand: (x: number, y: number) => {
      refreshBlocked();
      return canStand(x, y);
    },
    /** 当前视野内的怪物（含距离） */
    monsters: () =>
      remotes
        .list()
        .filter(e => e.kind === 'monster')
        .map(e => ({
          ...e,
          dist: player ? +Math.hypot(e.x - player.x, e.y - player.y).toFixed(2) : -1,
        })),
    /** 攻击指定目标（不传就用当前锁定 / 最近的怪物） */
    attack: (id?: number) => {
      attackCd = 0;
      tryAttack(id ?? (focusId >= 0 ? focusId : -1));
      return focusId;
    },
    focus: () => focusId,
    state: () => ({
      screen: loginScreen.classList.contains('hidden') ? (charScreen.classList.contains('hidden') ? 'game' : 'charselect') : 'login',
      /** 登录界面内部的两步：'servers' 选线路 / 'account' 账号密码 */
      loginStage,
      /** 当前选中的 GameServer（选完线路后才有意义） */
      gameServer,
      mapId: world?.mapId ?? null,
      mapName: world ? getMapDefinition(world.mapId).english : null,
      objects: world?.objects.stats.placed ?? 0,
      /** 被整只隐藏的物件实例数（占位/空模型/坏数据）与分类 */
      objectsHidden: world?.objects.stats.hidden ?? 0,
      objectsHiddenIds: world?.objects.stats.hiddenIds ?? {},
      objectAnim: world ? world.objects.anim : null,
      objectFx: world ? { spots: world.objectFx.spots.length } : null,
      /** 收屋顶统计（每个地图哪些屋顶、现在收着没有） */
      roofs: world ? world.objects.roofs() : null,
      ambient: world ? world.ambient.stats : null,
      moveCommand: movePanel.snapshot(),
      missing: world ? [...world.objects.stats.missing] : [],
      player: player ? { x: +player.x.toFixed(2), y: +player.y.toFixed(2), z: +player.z.toFixed(2), yaw: +player.yaw.toFixed(3), action: player.action } : null,
      /** 剩余路径长度（0 = 没在走） */
      pathLeft: movePath.length,
      char: currentChar?.name ?? null,
      /** 职业号（0 DW / 1 DK / 2 FE / 3 MG），算法同 `syncCharacterPanel` */
      classId: currentChar ? ((((currentChar.charSet?.[0] ?? 0) >> 4) | ((currentChar.charSet?.[0] ?? 0) & 0x10)) >> 1) : null,
      level: currentChar?.level ?? null,
      /** 身上金币（`F3/03` 的 money 字段，`0xF3/0x04` 之类的推送会更新它） */
      money: currentChar?.info?.money ?? null,
      focus: focusId,
      dead: playerDead,
      target: (() => {
        const t = focusId >= 0 ? remotes.get(focusId) : null;
        return t
          ? { id: t.id, name: t.name, hp: t.life, maxHp: t.maxLife, dying: t.dying }
          : null;
      })(),
      remotes: remotes.list(),
      selfId: remotes.selfId,
      connected: connection?.connected === true,
      heads: recentHeads.slice(-40),
      remoteDebug: remotes.debug,
    }),
  };
}

function createRadialTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 关页面/刷新时按协议退出，避免账号卡在 JoinServer 的在线表里
window.addEventListener('beforeunload', () => {
  if (loggedIn && session) {
    try {
      session.closeClient(0);
    } catch {
      /* ignore */
    }
  }
});

boot();
