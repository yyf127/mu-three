# 尚未迁移 / 尚未修复清单（2026-10-27 盘点）

> 来源：`docs/TODO.md`、`docs/SKILL_AUDIT.md`、`references/migration-pitfalls.md` 的未勾选项，
> **逐条到代码里核对过**（不是我照着文档抄的）。证据等级按 skill 约定：
> `CONFIRMED_SOURCE` / `CONFIRMED_RUNTIME` / `INFERRED` / `UNKNOWN`。
> 「现状证据」写的是我在 `mu-three` 里实际 grep / 读到的结果。

## A. 文案 / 本地化

| # | 项 | 现状证据 | 影响 | 证据等级 |
|---|---|---|---|---|
| ~~A1~~ | ~~`Filter.bmd` / `FilterName.bmd` 聊天屏蔽词~~ | **用户确认这两份是空文件，不用做也不需要解密**（2026-10-27） | — | ✅ 不做 |
| ~~A2~~ | ~~`NPCName.txt`（chs）NPC 中文名牌~~ | **2026-10-27 已实现**：`loadNpcNames()` + `setNpcNameTable()`，`monsterNameOf()` 优先查它 | 名牌已是中文（铁匠 汉斯 / 老板娘 莉雅 / 圣导士塞维娜） | ✅ 已完成 |
| ~~A3~~ | ~~硬编码文案：商店/仓库标题、背包 tooltip 的需求行~~ | **2026-10-27 已实现**：`npcPanel` 的 `TEXT` 改成 getter 走 `textSync`，tooltip 用 `GlobalText[71/73/74/75/76/77]` 原版模板 | — | ✅ 已完成 |

## B. 画面

| # | 项 | 现状证据 | 影响 | 证据等级 |
|---|---|---|---|---|
| ~~B2~~ | ~~`Loading01-03.ozj` / `Webzenlogo.ozj` / `Everyone.ozj`~~ | **2026-10-27 已实现**：`ui/splash.ts` + `logoAssets.ts::localSprite()`，位置全部抄 `Scene_Intro` / `Scene_Loading` 的源码常量 | — | ✅ 已完成（`VISUAL UNVERIFIED`） |
| B3 | 相机穿墙 | `world/camera.ts` 里没有 raycast / 碰撞相关代码 | 贴墙、进屋时镜头会穿进模型 | **按用户要求略过（2026-10-27）** |

## C. 玩法

| # | 项 | 现状证据 | 影响 | 证据等级 |
|---|---|---|---|---|
| ~~C1~~ | ~~坐下 / 倚靠（动作 133/135、139/140，锚点 `PoseBox`）~~ | **2026-10-27 已实现**：`OPERABLE_BY_MAP` + `tryOperate/doOperate` + `restAction`；PoseBox 位置由 `objects.ts::hiddenPlaced` 提供 | — | ✅ 已完成（`VISUAL UNVERIFIED`） |
| ~~C2~~ | ~~可交互物件光标（`Cursorleanagainst` / `Cursorsitdown`）~~ | **2026-10-27 已实现**：`pickOperableAt` + `cursorOfOperable`（判据照 `Cursor_Render.cpp:78`） | — | ✅ 已完成 |
| ~~C3~~ | ~~修理模式光标（`Cursorrepair`）~~ | **2026-10-27 已实现**：商店开着 + 指向有损耗装备 → 钻头 | — | ✅ 已完成 |
| C4 | 装备/技能门槛的「第几转」 | `ItemAttr` 只有 `clsMask`（位掩码），**没有 `changeUp`**；`item.bmd` 的 `RequireClass` 0/1/2 里那个 2 被压掉了 | 一转装备/技能的门槛判不严 | `docs/TODO.md` C-4 |
| C5 | 技能逐帧时序（`AttackStage` 的 `stage==N`） | `SKILL_CASTS` 只抓「一次触发放什么」；43/47/55/56 手写过 stage 拆解 | 部分技能的特效时机比原版粗 | `docs/TODO.md` C-5 |
| C6 | 掉落物长按连续拾取（`Text.bmd 136/137`） | `grep "pickupHold\|longPress" src/main.ts` **无命中** | 只能一件一件捡 | **按用户要求略过（2026-10-27）** |
| ~~C7~~ | ~~`0x30 result=5` 服务器传送界面~~ | **2026-10-27 已实现**：`ui/serverDivisionPanel.ts` 照 `RenderServerDivision`（HUD_Pass6.cpp:323）逐坐标抄 | — | ✅ 已完成（本机无 234 号 NPC，用调试口注入验证） |
| ~~C8~~ | ~~`0xA1`/`0xA2` 后按新状态重开任务对话~~ | **2026-10-27 已实现**：`questTextFor()` + `pendingQuestDialogRefresh` + `reopenQuestDialog()` | — | ✅ 已完成（「东西齐了」那一档仍按 texts[1] 未判，见下） |
| ~~C9~~ | ~~`F3/E3`（任务表）/`F3/E4`（技能）/`F3/E5`（大师树）~~ | **2026-10-27 已实现**。⚠️ **旧记录三条全错**：实际是 `F3/E3` 堆叠表（`CItemStack`）、`F3/E4` 价格表（`CItemValue`）、`F3/E5` 移动列表（`CMove`），记录 12/16/48 字节，`E5` 的 count 前还多一个 `PKLimitFree` 字节 | — | ✅ 已完成 |
| C10 | 事件地图（11..16）安全区放行 16/26/27/28/48 | 规则代码已写（`safeZoneBlocksCombat`），但角色等级不够、`/move` 进不去 → **行为未验** | 未验证 | NOT RUN |

| ~~C11~~ | ~~任务「进行中且任务物品已齐」那一档文本~~ | **2026-10-27 已实现**：quest.bmd 物品条件（段 +2/+3/+4，`Type=(+2)<<5|(+3)`）+ `questItemsSatisfied()` 扫背包 | — | ✅ 已完成（顺带纠正 texts[1]/[2] 语义映射反了的老问题） |

## D. 环境

| # | 项 | 现状 | 证据等级 |
|---|---|---|---|
| D1 | `GameServer` 偶发 `F1/01` 登录超时（半死会话） | 重启 GameServer 可解；探针里今天也复现过一次（同一账号连跑多次） | CONFIRMED_RUNTIME |

---

## 本轮已修（2026-10-27）

- **安全区不能攻击 / 放技能** → `main.ts::safeZoneBlocksCombat()`，依据 `Combat.cpp::Attack()` IDA L1280/L1314。
  验证 `tools/safezone-probe.mjs` PASS。详见 `docs/FEATURES.md` 阶段 BX。
- **任务 NPC 多余对话框** → `queueNpcGreeting()` 重写 + `anyNpcWindowOpen()` + `0x30` 到达即取消。
  验证 `tools/npc-dialog-probe.mjs` PASS（6/6）。
- **中文名牌（A2）** → `loadNpcNames()` + `setNpcNameTable()`，`monsterNameOf()` 优先查 NPCName.txt。
  验证 `tools/npc-name-probe.mjs` PASS。详见阶段 BY。
- **任务对话按状态重开（C8）** → `questTextFor()` + `pendingQuestDialogRefresh` + `reopenQuestDialog()`。
  验证 `tools/quest-state-probe.mjs` PASS。
- **修理光标（C3）** → 商店开着 + 指向有损耗装备 → `Cursorrepair`。
  验证 `tools/repair-cursor-probe.mjs` PASS。
- **启动画面 + 读条画面（B2）** → `ui/splash.ts`，位置抄 `Scene_Intro` / `Scene_Loading`。
  验证 `tools/splash-probe.mjs` PASS。详见 `FEATURES.md` 阶段 CA。
- **任务物品条件（C11）** → quest.bmd 段 +2/+3/+4 + `questItemsSatisfied()`；
  顺带纠正 texts[1]/[2] 语义映射（原来「没拿到」也显示「您真的找到了」）。
  验证 `tools/quest-items-probe.mjs` PASS。
- **服务器传送界面（C7）** → `ui/serverDivisionPanel.ts`，布局抄 `RenderServerDivision`，
  勾选 → 确定 → 二次确认，出口一律发 `C1 03 31`。验证 `tools/server-division-probe.mjs` PASS。
- **服务端三张表（C9）** → `F3/E3` 堆叠 / `F3/E4` 价格 / `F3/E5` 移动列表全部接上，
  `applyServerMoveList()` 覆盖本地 warp 门槛。验证 `tools/server-tables-probe.mjs` PASS。
- **空格键不再当普攻**、**选角 ESC 菜单（返回线路选择 / 选项 / 取消）**、
  **「返回登录」改走 `leaveGame`**。验证 `tools/charselect-esc-probe.mjs` PASS。
- **物品悬停 3D 旋转**（`RenderObjectScreen` 的 `Select==1`：`angle[1] =
  WorldTime*0.45`）→ `ui/itemSpin.ts` + `itemIcon(type, level, yawDeg)`，
  背包/装备槽/商店/仓库四处接上。验证 `tools/item-hover-probe.mjs` PASS。
  速度按用户要求降到 225°/秒（帧数 24→36）。
- **跨格拖动**：ghost 图标改成按物品槽位取（`iconBySlot`），非左上格按下也能拖；
  探针 `tools/item-ui-probe.mjs` 从 2×2 的四个格子分别验证。
- **tooltip 避让 + 职业限制**：`itemTip.placeTipBeside()` 按物品矩形避让（左→右→上）；
  补上 `RenderItemInfo.cpp:1385` 的「%s 可以使用」几行（`GlobalText[61]` + 职业名
  `[20..26]`，`RequireClass` 读 `chs/item.bmd`）。
- **离线演示**：账号面板「离线演示」→「结束游戏」（回线路选择）；新增 `/demo`
  全流程演示页（`vite.config.ts` 的 `demoAlias()` + `main.ts::DEMO`），
  `dist/404.html` 供 GitHub Pages 兜底。
- **仓库底部三个图标按钮 / 金币条**：`refreshText()` 的 `textContent=` 会把
  `<img>` 顶掉（按钮变空盒）；金币条被 `Item_Back02` 盖住（同 z-index、DOM 在后）。
  验证同一探针（14/14）。
- **UI 文字走 `Data/Local`**：`itemAttr()` 名字改用 `itemNameSync()`（`chs/item.bmd`
  512 条中文），tooltip 行抽到 `ui/itemTip.ts` 共用。
- **物品悬停 3D 旋转**（`RenderObjectScreen` 的 `Select==1`：`angle[1] =
  WorldTime*0.45`）→ `ui/itemSpin.ts` + `itemIcon(type, level, yawDeg)`，
  背包/装备槽/商店/仓库四处接上。验证 `tools/item-hover-probe.mjs` PASS。
- **仓库底部三个图标按钮 / 金币条**：`refreshText()` 的 `textContent=` 会把
  `<img>` 顶掉（按钮变空盒）；金币条被 `Item_Back02` 盖住（同 z-index、DOM 在后）。
  验证同一探针（14/14）。
- **UI 文字走 `Data/Local`**：`itemAttr()` 名字改用 `itemNameSync()`（`chs/item.bmd`
  512 条中文），tooltip 行抽到 `ui/itemTip.ts` 共用。
- **硬编码文案（A3）** → `npcPanel` 的标题/按钮/费用标签全部走 `textSync`，
  背包 tooltip 的属性/耐久/需求行改成 `GlobalText[40/64/65/67/69/70/71/73/75/76/77]`
  原版模板，缺属性时补 `[74]「(还需 %d)」`。验证 `tools/a3-text-probe.mjs` PASS。
- **坐下/倚靠/浮空 + 可交互物件光标（C1/C2）** → `OPERABLE_BY_MAP` + `hiddenPlaced`（PoseBox 锚点）
  + `restAction` 保持姿势 + 上行 `0x18`。验证 `tools/operate-probe.mjs` PASS。详见阶段 BZ。

## 下一步建议（按「看得见的程度 × 成本」排序）

> **B3 相机穿墙按用户要求略过**（2026-10-27）。原版是 `Camera_Movement.cpp` 的
> `Camera_CheckWall`，我们 `world/camera.ts` 里完全没有；贴墙/进屋时镜头会穿模型，
> 已知问题、暂不处理。

> B1（小地图底图）用户确认已自行做好，2026-10-27 从清单移出。
> C6（长按拾取）按用户要求略过；C7 / C9 / A3 已修（见上表和 `FEATURES.md`）。

清单现在是空的 —— `docs/TODO.md` 里剩下的是「已知限制 / 自加功能」说明，不是待办。
