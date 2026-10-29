# 装备强化 / 追加 / 卓越：原版表现与 mu-three 现状（只读审计）

> 审计时间：2026-10-28 · 范围：视觉效果 + 数值加成 + 转职/转生进度系统
> 证据等级：`CONFIRMED_SOURCE` = 有源码行号；`INFERRED` = 推断；`UNKNOWN` = 未确认

## 一、结论速览

| 项 | 原版 0.97k | mu-three 现状 | 差距 |
|---|---|---|---|
| +3..+11 强化发光（分档、可叠层） | 有（`RenderPartObjectEffect`） | **无**（`EquipSet` 只传 type） | 未实现 |
| 追加（Option1）装备闪烁 | 有（正弦脉冲叠加渲染） | **无** | 未实现 |
| 地面物品光斑颜色随等级/追加 | 未证实（`ExtOption` 只保存） | 固定琥珀色 | 一致（暂不改） |
| tooltip 卓越前缀「Excellent」+ 词条行 | 有（`RenderItemInfo.cpp`） | 只显示 `+N` / `追加 +X` | 未实现 |
| tooltip 攻/防数值含强化加成 | 有（服务端算完下发/客户端公式） | 只有 +0 基础值 | 未实现 |
| 角色面板数值含追加/卓越/套装 | 有 | **没算**（`character.ts` 自己注明近似） | 未实现 |
| demo 战斗伤害含强化/追加/卓越 | 服务端算 | 只有 `(str+dex)*0.9 - def` | 未实现 |
| 转职（ChangeUp / Evolution 1） | 有（Quest + QuestReward） | **已实现**（0xC8–0xCB + 特效 1264） | 无 |
| 转生（Reset / GrandReset） | 有（`/reset` 命令 + SQL） | **无 UI、无状态**（`reset` 恒 0） | 未实现 |

## 二、原版客户端：强化发光怎么算的

`RenderLinkObject.cpp:675-686` 把每件装备的 `Level`（强化）和 `Option1`（追加）交给渲染：

```cpp
// RenderPartObjectEffect: (localObj, Type, Light*, alpha, 8*Level, Option1, 0, flags)
RenderPartObjectEffect(local_1ec, param_6, Light, alpha,
                       8u * (unsigned char)param_7,   // 8*Level
                       (unsigned char)param_8,        // Option1
                       0, baseRenderFlags | param_11);
```

`Entity_DrawSetup.cpp:52` 先还原等级：`param_5 = (param_5 >> 3) & 0xf;`，
然后按档位做**额外一遍渲染**（这就是「+N 发光」）：

| 强化 | 处理（`Entity_DrawSetup.cpp:396-478`） |
|---|---|
| +0..+2 | 直接按光照渲染，无附加 |
| +3..+4 | 叠一层 `(X, 0.6X, 0.6X)` 色调 |
| +5..+6 | 叠一层 `(0.5X, 0.7X, X)`（偏蓝） |
| +7..+8 | 亮度 ×0.8 + `RenderPartObjectBodyColor(flags 0x44)` |
| +9..+10 | 亮度 ×0.9 + `0x44` 与 `0x48` **双次**叠加 |
| +11 以上 | ×0.9 + `Entity_SetModelColorAlt(0x240)` + `0x48` + `0x44` |

追加（`Option1`）走另一条：`Entity_DrawSetup.cpp:499-518` 里
`(param_6 & 0x3f) != 0` 时用 `sin(WorldTime)` 生成脉动颜色，再 `BMD__RenderBody(flags 0x42)`
盖一层 —— 就是「追加装备会一闪一闪」。

数值侧（服务端权威，`Item.cpp`）：

- `m_DamageMax += m_Level * 3`，`m_Level >= 10` 再加 `(L-9)(L-8)/2`（`:354-380`）；
- 魔攻、防御同构（`:398-402` 起）；
- 需求随强化放大：`m_RequireStrength = (ReqStr * (m_Level*3 + ItemLevel) * 3/100) + 20`（`:256`）；
- 追加属性由 `CItem::GetOption()` 生成（`:482-560`），并额外 `m_RequireStrength += m_AddOption * 4`。

## 三、mu-three 现状（证据）

| 位置 | 现状 |
|---|---|
| `src/world/actor.ts:301-315` | `EquipSet` 只有 `weapon/shield/helm/…: number`（type），**没有 level/option** |
| `src/world/actor.ts:840` | `applyEquipment()` 只用 `equip[part]` 的 type 取模型 |
| `src/world/actor.ts:358 / 774` | `loadItemBmd(type)`、`buildHeldItem(type)` 均无等级参数 |
| `src/ui/itemTip.ts:169-173` | 名字拼 `+N` 与 `(追加 +X)`，其余走 `itemStats(type)` |
| `src/ui/itemRules.ts:166` | `itemStats(type)` 仅按 type 输出 +0 基础攻/防 |
| `src/ui/character.ts:354` | 注释直言：追加属性、卓越、套装加成都没算，面板三行是近似值 |
| `src/world/items.ts:485-505` | 地面物品光斑固定 `0xffd8a0` 呼吸，不区分等级 |
| `src/main.ts:1966` | 地面物品**名字**颜色：卓越 → `#1aff80`（这一条与原版一致） |
| `src/main.ts` `hitDemoTarget` | demo 伤害 `(str+dex)*0.9*(0.85~1.15) - defense`，不含强化/追加/卓越 |

## 四、进度系统（转职 / 转生）

### 转职：服务端有，客户端已接

- 数据：`MuServer/Data/Quest/Quest.txt`（30 行）只有 **Evolution 1** 的两步：
  Step 1 拿「皇帝之卷轴」、Step 2 拿对应职业道具（DK 断剑 / FE 精灵之泪 / DW 灵魂碎片），
  NPC 235（圣导士塞维娜）、Lv150、DW/DK/FE 可接（MG 不行）。
- 奖励：`QuestReward.txt` `Type 2 = Obtain Evo 1`、`Index 201`；
  `QuestReward.cpp:175/215` 写 `lpObj->ChangeUp = lpObj->DBClass % 16` 并 `GCQuestRewardSend(201, Class)`。
- 客户端（本项目）：`main.ts:5055-5099` 收 `0xC8..0xCB`（加点 / 转职 / 转职+加点）、
  `applyClassChange()`（`:5107`）更新职业号 + 刷新面板/底栏 + 播 `CreateEffect(1264)`；
  职业名按 `>>3` 取 `Text.bmd` 的转职列（`data/localText.ts:208-220`）。
  → **转职这条链是通的**。

### 转生：服务端有，客户端没有

- 命令：`CommandManager.cpp:890` `CommandReset`（`/reset`，支持 `auto`），
  校验等级（`gResetTable.GetResetLevel`）、金币（`GetResetMoney`）、次数上限（`m_CommandResetLimit`）、
  可选「身上不能穿装备」（`m_CommandResetCheckItem`）。
- 回执：`DGCommandResetRecv`（`:1058`）扣钱、等级回到 `m_CommandResetStartLevel`、
  `Reset += m_CommandResetCount`、清自动加点；`m_CommandResetQuest != 0` 时还会
  **清空任务并回退转职**（`DBClass / 16 * 16`）。
- 数据：`Data/Util/ResetTable.txt` 在本仓库是**空表**（只有表头 + `end`），
  实际数值走 SQL：`DataServer/CommandManager.cpp:42-97` 调
  `WZ_GetResetInfo` / `WZ_GetGrandResetInfo`。另有 `/grandreset`、每日/周/月上限。
- 客户端：`main.ts:5378-5393` 里 `reset: 0` 写死，注释说明
  「0.97 的 `CharacterInfo` 里没有转生字段」→ **转生数不显示、没有 UI**；
  只能靠聊天框敲 `/reset`（`sendChatText` 已实现，`/move` 同一条路）。

> 结论：转生是**服务端 + SQL** 的功能，本地 demo（没有 DataServer/SQL）无法复现；
> 客户端要显示转生数也没有协议字段可用，除非扩展 0xF3 或走自定义包。

## 五、建议的实施顺序（按性价比）

1. **+N 强化发光（最高价值，证据最完整）**
   - `EquipSet` 增加 `levels?: Partial<Record<slot, number>>` / 或直接传 `InventoryItem`；
   - `buildSkinnedPart` / `buildHeldItem` 收 `level`，在材质上按档位叠加一层
     `AdditiveBlending` 副本（+3/+5 变色、+7 起双次、+9 起三层），复用
     `core/additive.ts` 的 `additiveProps()`；
   - 验收：`__MU__.player` 的网格上能数出「基础 + 叠加」层数，配合截图对比原版。
2. **tooltip 词条（纯 UI，零风险）**
   - 把 `RenderItemInfo.cpp:2038-2065` 的「Excellent 前缀」+ RII 556.. 的
     追加/卓越行补进 `itemTip.ts`；数值按 `Item.cpp` 的公式算（+N 的 3/级、10 级后平方项）。
3. **角色面板 / demo 战斗接入加成**
   - `character.ts` 那三行改成「基础 + 强化 + 追加 + 卓越」求和；
   - `hitDemoTarget` 的伤害改用同一套计算函数，保证「面板看到的就是打出来的」。
4. （可选，需服务端配合）**转生数显示**：自定义 0xF3 扩展字段或独立包；
   否则维持「聊天 `/reset`、界面不显示」。

## 六、未验证 / 风险

- `VISUAL UNVERIFIED`：原版发光的具体观感（叠加层数对应的亮度）需要 Windows 原版截图对照，
  本文只给出代码级参数。
- `UNKNOWN`：0.97 客户端是否对**卓越**单独做颜色（当前证据是 `ExtOption` 只保存不参与渲染，
  卓越只体现在名字前缀与词条）。
- 转生的实际数值（等级/金币/次数）依赖 SQL 存储过程，本仓库无数据，无法给出具体门槛。

## 七、实施进展（2026-10-28）

上面「建议顺序」里的 1 / 2 / 3 已经落地，全部按**服务端与客户端源码两端对照**后的公式实现：

| 改动 | 文件 | 说明 |
| --- | --- | --- |
| 强化数值 | `src/data/itemPower.ts`（新） | `CItem::Convert` + `Item_LegacyLinker.cpp::ItemConvert` 的移植：攻击/防御/防御率 `3/级`（+10 起有平方补偿）、盾 `+1/级`、翅膀 `+2/级`、需求 `Req*(Level*3+itemLevel)*3/100+20` |
| 物品表 | `src/data/itemAttrs.ts` | `ItemRow` 增加第 16 列 `itemLevel`（Item.txt 的 `Level` 列，需求的缩放基准），由 `tools/gen-item-attrs.mjs` 生成 |
| 装备签名 | `src/world/actor.ts` | `EquipSet.levels`（按槽位的强化等级）+ `Actor.glows`；`setMeshes` 里先 `clearGlows()` 再换网格 |
| 发光渲染 | `src/world/itemGlow.ts`（新） | 原版「同一份网格再画一遍」的等价实现：共享几何 + `AdditiveBlending` 副本，档位 +3/+5 偏色、+7 起白光、+9 起双遍、+11 加强；亮度按正弦脉冲 |
| tooltip | `src/ui/itemRules.ts`、`src/ui/itemTip.ts` | 词条和四条需求都走 `itemPower(type, level)` |
| 角色面板 | `src/ui/character.ts` | 去掉「每级 3%」的近似式，改用强化后的真实数值 |
| 穿装判定 | `src/ui/itemRules.ts::checkEquip` | 需求按强化放大后再判（服务端 `m_RequireStrength`），失败原因里带上 +N |

### 两个必须分开的口径

「需求等级」两端**本来就不一致**，实现时拆成了两个字段：

- `reqLevel`（客户端口径，tooltip 显示）：`RequireLevel + itemLevel*4`，翅膀 `*5`；
- `reqLevelSrv`（服务端口径，`checkEquip` 判定）：武器到护符（group 0..11）**不随强化涨**，
  宝珠/卷轴也不涨，翅膀 `+5/级`、其余 `+4/级`。

拿 tooltip 的数去拦发包会出现「显示穿不了、实际能穿」的矛盾。

### 验证

- `npx tsc --noEmit` / `npm run build` 通过；
- `node tools/equip-glow-probe.mjs`：冻结场景后逐档截图，光效副本数
  `+0/+2 → 0、+3/+5/+7 → 4、+9/+11 → 8`，角色区域平均亮度 `66.9 → 74.8 / 81.0 / 87.8`
  （冻结下背景噪声 0.000%，差异全部来自装备）；
- `node tools/equip-power-probe.mjs`：tooltip 端到端，传说之剑 +0「56~72 / 需力 178」、
  +9「83~99 / 需力 275」，黑凤凰之铠 +11「防御 99 / 需力 873」。

### 追加（AddOption）与卓越（Excellent）—— 第二批落地

位定义来自 `0xF3/0x10` 的解析（`net/game.ts:913`），已经是现成的：

```
option    = (b1 & 0x03) | (b3 & 0x40 ? 4 : 0)   // 0..7，即 (Attribute1&3) + 4*((Attribute2>>6)&1)
excellent = b3 & 0x3f                           // 6 bit
```

数值分两套来源：

| | 追加 | 卓越 |
| --- | --- | --- |
| 数值 | `ItemOption.txt` `Index=2`：武器 +4×opt、法杖 +4×opt 魔法、盾 +5×opt 防御率、防具 +4×opt 防御 | `Item.cpp:340-410`：武器 `25*表值/Level+5`、防具 `12*表值/Level+Level/5+4`、防御率 `25*表值/Level+5` |
| 显示位置 | **单独一行**（`GlobalText[88..91]`，「追加攻击力+16」），不进主属性行 | **直接进主属性行**（攻击力/防御力那一行会变大） |
| 顺序 | 独立 | 先算卓越（用表值），再加 `Level*3` |

需求侧同样两套口径（`itemPower` vs `itemRequireSrv`）：

| | 客户端（tooltip 显示） | 服务端（判定） |
| --- | --- | --- |
| 追加力量 | `+5×opt`，部位 0..383 | 仅**翅膀**（384..390）`+4×opt` |
| 卓越等级 | `RequireLevel` 非 0 就 `+20` | 只有 `m_Index >= 12*32` 才 `+20` |

翅膀分组也要注意：**只有 387..390**（Spirit/Soul/Devil/Darkness）走 `需求等级 +5/级`、
`防御 +2/级`；384..386 是普通防具的 `+4` / `+3`。

tooltip 名字行按 `RenderItemInfo.cpp:2053` 的 `"%s %s +%u"`：卓越前缀在最前
（`Text.bmd[620]`，实测中文版取到「卓越的」，兜底同），等级紧贴名字。

### 仍未实现

- **卓越的逐位词条行**（`SpecialNum` 循环，`GlobalText[622..631]` 那组）：需要按
  0x20/0x10/0x08/0x04/0x02/0x01 逐位 push 选项码并查模板，目前只做了名字前缀；
  实际数值加成已经生效，只是没有「卓越伤害 +10」这类细分行；
- **套装加成**：0.97 服务端没有 SetItem 表，跳过；
- **幸运（Luck）**：只解析了 `luck` 位，没有参与暴击判定。

## 八、第二批：卓越词条 / 幸运 / 转生

### 卓越逐位词条（UI）

`Item_LegacyLinker.cpp:466-490` 把 6 个卓越位映射到**不同文案**，防具和武器还是两套：

| 位 | 防具 / 盾（192..383、424..425） | 武器 / 法杖（0..191、428..429） |
| --- | --- | --- |
| 0x20 | 622 最大生命值 +4% | 628 卓越攻击几率 +10% |
| 0x10 | 623 最大魔法值 +4% | 629 攻击力 +等级/20（法杖 631） |
| 0x08 | 624 伤害减少 +4% | 630 攻击力 +2%（法杖 632） |
| 0x04 | 625 伤害反射 +5% | 633 攻击(魔法)速度 +%d（值固定 7） |
| 0x02 | 626 防御成功率 +10% | 634 杀怪回血 +生命/8 |
| 0x01 | 627 杀怪所获金 +40% | 635 杀怪回蓝 +魔法/8 |

模板里的 `%%` 是 sprintf 转义，必须折叠成 `%`（否则显示「+4%%」）。文案直接从
`Data/Local/chs/Text.bmd` 取（实测 622..635 全部命中中文），没加载到就不显示该行。

实现在 `ui/itemRules.ts::excellentLines()`，`itemTip` 用蓝色 `.tip-exc` 渲染。

### 幸运（Luck）＝ 暴击率 +5%

之前判断「Luck 不参与暴击」是**错的**。服务端 `ItemOption.cpp:268`：

```cpp
case ITEM_OPTION_ADD_CRITICAL_DAMAGE_RATE:   // = 64
    lpObj->CriticalDamageRate += value;      // Luck 表的 value = 5
```

而 64 正是 Luck 的选项码（`ItemOption.txt` 的 `1 64 5 ...`）。暴击判定在
`Attack.cpp:1122`：`rand()%100 < CriticalDamageRate - 目标抗性`。

同时修掉一个真 bug：客户端原来写 `hit.type === 0x10 → crit`，但
`User.h:136-140` 的枚举是 `0x10 IGNORE / 0x20 REFLECT / 0x40 EXCELLENT / 0x80 CRITICAL`
—— 暴击是 **0x80**。也就是「无视防御」的伤害被当成暴击显示，真正的暴击反而没样式。
现在 `ui/damageText.ts::damageClassOf()` 统一映射：`0x80 → crit(橙)`、`0x40 → exc(青)`、
`0x10 → hurt`，重击音也改成按 0x80/0x40 判定。

### 转生：不用改服务端，字段一直在发

服务端 `PMSG_NEW_CHARACTER_INFO_SEND`（`0xF3/0xE0`，`Protocol.h:543`）末尾本来就有
`ViewReset` / `ViewGrandReset`，且 `stdafx.h:7` 就是 `#define GAMESERVER_EXTRA 1`。

之前「客户端没有转生字段」的说法只对**原版 0x03 包**成立（48 字节，结构到
`MaxFruitAddPoint` 就结束）。E0 是 76 字节、18 个 DWORD 的版本，只是客户端从来没解析。

现在 `net/game.ts::parseNewCharacterInfo()` 读 `p+64` / `p+68`，`main.ts` 的 F3 分发里
接 `0xE0` → `applyCharacterExtra()`，结果落到：

- 角色面板标题：`名字 (转生 N)`；
- `/move` 的门槛校验：`refreshMovePanel()` 不再把 `reset` 写死 0，
  「天空之城需要转生 N 次」这类条目终于能正确拦。

### 仍未实现（更新）

- 套装加成：0.97 服务端没有 SetItem 表，跳过；
- 转生的**消耗门槛展示**（等级/金币/次数上限）：服务端只在失败时用系统公告报数
  （`gMessage` 58/59/76），客户端没有对应包，做不成「转生界面」。

## 九、第三批：0xE1 属性 / 0xE2 血条 / 武器文案

### `0xF3/0xE1` 角色最终属性

`PMSG_NEW_CHARACTER_CALC_SEND`（`Protocol.h:566`）= 17 个 DWORD：
HP/MP/BP 的当前与上限、物理/魔法攻速、物攻区间、魔攻区间、魔攻率、命中、
伤害倍率、防御、防御率。服务端已经把这些都算好了（含强化、追加、卓越、buff，
**以及耐久磨损带来的防御衰减** `Item.cpp:624`）。

之前角色面板是客户端自己凑的：

```
攻击 = STR/6 ~ STR/4 + 武器基础值
防御 = AGI/3 + 防具基础值
防御率 = AGI*1.2 + 装备防御率
```

这套近似式永远对不上服务端。现在 `characterPanel.setCalc()` 优先用 E1 的值，
本地公式降级为「还没收到 E1 时」的回退。收到的值也顺带修正了 HP/MP 与魔法伤害两行。

> 验证限制：面板渲染需要真实服务端（离线模式没有 `currentChar`，面板是空的）。
> 解析层已单测（17 字段逐个对位、短包返回 null），面板侧只做到 `tsc` + 代码路径检查。

### `0xF3/0xE2` 怪物血条

`GCHealthBarSend`（`Protocol.cpp:2236`）每秒遍历视野，**只挑怪物**，每条
`{WORD index, BYTE type, BYTE rateHP}`，`rateHP = Life*100/(MaxLife+AddLife)`。

之前怪物血条靠「挨打时 `life + damage` 反推上限」，一遇到回血就偏。现在
`remotes.applyHealthBars()` 直接存百分比，头顶血条和目标血条都优先用它；
`hpRate` 为 -1 时才退回旧的反推逻辑。

### 法杖与双手武器的攻击力文案

翻原版 `RenderItemInfo.cpp:1709-1712` 才发现两处之前没照着做：

1. **双手武器用 `GlobalText[41]`「双手攻击力」**（`p->TwoHand + 40`，
   而服务端 `TwoHand = Width >= 2`）；
2. **法杖（160..191）的物攻要除以 2 再显示** —— `if (type >= 160 && type <= 192)
   { dmin /= 2; dmax /= 2; }`，不除会显示成原版的两倍。

顺带确认：**法杖的 `MagiDmg`（魔法攻击力）原版 tooltip 根本不显示** ——
整个 `RenderItemInfo` 里没有引用 `MagicDamageRate`。所以「补 MagiDmg 列」这事
不做（没有消费方，面板的魔法伤害行走 E1），只在 `itemPower` 里保留 `magicDmg` 字段备用。

### 还没接的协议包

| 子码 | 内容 | 影响 |
| --- | --- | --- |
| 0x30 | 技能键位 10 个 + Q/W/E + 游戏选项 | 服务端存档的快捷键没同步，换机器丢键位 |
| 0x08 | PK 等级 | 名字颜色（白/紫/红） |
| 0x07 | 怪物打玩家的伤害 | 自己受击时没有伤害飘字 |
| 0x20 | 召唤物生命 | 黑王马/天使宠物血量 |
| 0x22 | 服务端时间 | 时间显示 |

## 十、第四批：`0x30` 技能键位（双向）

`PMSG_OPTION_DATA_SEND/RECV`（`Protocol.h:514` / `:134`，`#pragma pack(1)`）：

```
SkillKey[10] | GameOption | QKey | WKey | EKey | ChatWindow   → 15 字节 payload，总长 19
```

下行在登录时由 DataServer 推（`DSProtocol.cpp:1030`），上行是 `CGOptionDataRecv`
（`Protocol.cpp:1451`）→ `GDOptionDataSaveSend` 存数据库。

### 方向是反的

| | 结构 |
| --- | --- |
| 服务端 | `SkillKey[i]` = **键位 i+1 绑定的技能号**（0 和 0xFF 都表示空） |
| 客户端 | `skillHotkeys` = **槽位 → 键位**（`Map<slot, 1..10>`） |

所以落地时要拿技能号反查技能槽（`skillList.find(s => s.skill === id)`）。
两边到货顺序不固定（0x30 可能早于 0x11 技能表），用 `pendingHotkeys` 挂起，
`syncSkillBar()` 里再合一次。

存档全空时**不动**本地 localStorage —— 新角色没存过，不能把玩家自己配的键位清掉。

### 只读等于白读

不回报的话服务端存的还是旧键位，换机器照样丢。所以 `onHotkey`（Ctrl+数字改键）里
把当前映射转回 `SkillKey[10]` 发上行。上行用收到的原始包打底：
`GameOption` / `Q W E` / `ChatWindow` 客户端**都还没实现**，直接发 0 会把玩家
存在服务端的音效设置和药水槽一起清掉。

### `0x08` PK 等级：查证后不做

`PKLevel` 在原版只参与「能不能攻击这个目标」的判定（`SMD_Parser.cpp:902-927`，
`PkLevel >= 6` 即可攻击）。名字标签 `Render_CharNameTags`（`HUD_Pass2.cpp:625`）
只有三种固定颜色 —— 金黄 `(0.92,0.80,0.34)`、浅黄 `(0.91,0.81,0.60)`、白 ——
**没有按 PKLevel 变色的分支**。所以这条从待办里划掉。

### 剩余未接

| 子码 | 内容 | 说明 |
| --- | --- | --- |
| 0x07 | 怪物打玩家的伤害 | 自己受击时的伤害飘字 |
| 0x20 | 召唤物生命 | 黑王马/天使宠物血量 |
| 0x22 | 服务端时间 | 时间显示 |

## 十一、第五批：`0x07` 自己受击

`GCMonsterDamageSend`（`Protocol.cpp:2046`）的结构有点陷阱：

```
C1 0E F3 07 | damage[2]（**大端**） | ViewCurHP（DWORD 小端） | ViewDamageHP（DWORD 小端）
```

同一个包里 `damage` 是 `SET_NUMBERHB` 在前（大端），后面两个 DWORD 却是 x86 小端。
按小端读 500 会变成 62465。

发送对象也容易搞反：**只发给被打的自己**（`GCMonsterDamageSend(lpTarget->Index, damage)`，
`ObjectManager.cpp:2926` 的 `DamageType == 1 // Delay Life Check`）。
别人打谁走 `0x15`，那个包是发给**攻击者**的。

之前这条没接，所以自己挨打时既不飘字也不掉血条，只能等 `0x26` 慢慢同步。
现在抽了 `applySelfHurt(damage, life)`，`0x15` 的 self 分支和 `0x07` 共用同一套
表现（惨叫 + 红色飘字 + 刷新 HUD）。服务端这两条是 `if / else if` 互斥分支，
同一笔伤害不会飘两次。

### `0x20` / `0x22`：确认没有消费方，不做

| 子码 | 内容 | 为什么不做 |
| --- | --- | --- |
| 0x20 | 召唤物生命百分比 | 客户端**没有召唤物渲染**（`handleSummons` 只解析 0x1C 的列表），`EquipSet.helper` 也一直是空字段 |
| 0x22 | 服务端时间（WORD） | 界面上**没有任何时间显示**，加了也无处可放 |

要做这两条，得先有「守护/宠物渲染」和「时间 HUD」，属于新功能而不是补协议。

## 十二、守护 / 宠物（`EquipSet.helper`）

这个字段从建库起就在，但 `applyEquipment` 从来没读过 —— 守护/宠物一直是隐形的。

### 原版只画一种

`Render_PlayerHelper`（`Render_PlayerEquipment.cpp:738`）第一行就是：

```c
if (*(short*)(c + 0x2B8) != 817) return;   // c+0x2B8 = Helper 槽的类型
```

**817 = Helper02 = 小恶魔 Imp**。只有它走这个函数，然后三件事：

| 动作 | 值 | 说明 |
| --- | --- | --- |
| `LinkBone` | `34` | 挂骨骼 34，不是背骨 47，也不是手骨 33/42 |
| `PlaySpeed` | `0.5` | 动画半速 |
| `RenderLinkObject(20, 0, 0, …)` | `(0.2, 0, 0)` 米 | 游戏单位 /100 |

外加在骨骼 34 的 `(20,0,15)` 处画一个 `CreateSprite(1150)` 光点。
816/818/819 不在这个函数里 —— 818/819 是「pet-fly」（飞行坐骑，`SecondPassword.cpp:1896` 提到），走另一条逻辑。

### 实现方式：和翅膀同构

守护 BMD 的骨骼命名和 `player.bmd` 完全不同，**不能当主角骨架的蒙皮**。所以照搬翅膀那套：

- `buildHelper()` 建独立 `Rig`，蒙皮网格加到**场景根**（`bindMatrix = identity`，蒙皮结果就是世界坐标）；
- 骨架根 `helperRoot` 挂到骨骼 34，位置 `(0.2, 0, 0)`；
- `Actor.tickHelper()` 每帧推进自己的帧，速度 0.5（`MU_REF_FPS` 换算）。

模型路径本来就能解析（`items.ts` 的 group 13 分支已经给了 `Helper01..04`）。

### 四个模型实测

| 类型 | 文件 | 骨架 / 帧 | 观感 |
| --- | --- | --- | --- |
| 416 | Helper01.bmd `fairy.jpg` | 8 骨 / 7 帧 | 会动（精灵） |
| 417 | Helper02.bmd `satan.jpg` | 8 骨 / 7 帧 | 会动（小恶魔，原版唯一支持的那个） |
| 418 | Helper03.bmd `unicon.jpg` | 2 骨 / 1 帧 | 静态（独角兽，本来就是坐骑） |
| 419 | Helper04.bmd `RedDragonT.jpg` | 2 骨 / 1 帧 | 静态（恐龙，同上） |

418/419 只有 1 帧，说明它们压根不是「跟在旁边飞」的宠物模型 —— 这反过来印证
原版为什么只对 817 开这个分支。现在四个都能显示，但 418/419 不会动，等实测再说要不要限制。

### 验证

`tools/helper-probe.mjs`：四个模型逐个 `previewEquip` → 检查 `EquipmentResult.helper`
的名字/骨骼/帧数；再冻结场景拍「有/无」两张做像素差：

```
变化 0.114%（960 像素），区域 59×46 @ 576,304
```

角色本体在 x≈592 一带，这块 59×46 正好落在它左侧 —— 确认不是「加载了但看不见」。

位置微调用 `__MU_APP__.helperPose({offset:[x,y,z], speed:n})`，改完把值写回
`HELPER_POSE` 常量即可（骨骼 34 的局部轴和世界轴不是一回事）。

### 没做

- **骨骼 34 上的光点 sprite**（`CreateSprite(1150)`）：要接 `world/sprites` 的一条贴图，先跳过；
- **818/819 的骑乘**（pet-fly）：那会改玩家姿态/坐骑，属于另一套逻辑；
- 远程玩家的守护：`CharSet[11]` 不解守护槽，靠 `0x25` 单件增量补（`equipSetOf` 已经读 `slot 8`）。

## 十三、召唤物与技能覆盖（排查记录）

### 召唤物（`0x1F`）—— 解析本身是对的

排查过程里我一度判错了：看到 `PMSG_VIEWPORT_SUMMON` 就以为和 `Protocol.h` 里那些
结构一样是 `#pragma pack(1)`，按 20 字节去解，把 `skillState` 挪到偏移 3。

**但 `Viewport.h` 全文没有 `#pragma pack`**，是 MSVC 默认对齐：

```
PMSG_VIEWPORT_MONSTER  index[2] type | pad | WORD ViewSkillState | x y tx ty dir | pad  → 12 字节
PMSG_VIEWPORT_SUMMON   同上 + name[10]                                              → 22 字节
```

所以客户端原来的 `skillState@4 / x@6 / name@11 / stride>=22` **全都是对的**，
改动已回滚。留下的唯一变化是把 stride 下限从 `>=12` 收紧到 `>=22`（结构是定长 22，
12 那个值只会放过坏包）。

教训：`Protocol.h` 里 `PMSG_OPTION_DATA_SEND` / `PMSG_NEW_CHARACTER_INFO_SEND` 确实带
`pack(1)`，但 `Viewport.h` 不带 —— 同一个工程里两种写法混着，不能一概而论。

**召唤物不显示的真实原因**（按可能性排序）：

1. **离线 demo 没有服务端**：`0x1F` 永远不来，召唤技能只有光环特效，不会有生物。
   这是 demo 的固有限制，不是 bug；
2. 正式服里服务端只在 `lpTarget->SummonIndex != 0` 时才把实体放进 `0x1F`
   （`Viewport.cpp:790`），怪物召唤物走 `0x13`、玩家召唤物才走 `0x1F`；
3. 召唤物的 `Class` 在 `monsterModels.ts` 里没有映射时，`modelForClass` 会退回
   `Monster{Class+1}.bmd`，文件不存在就跳过 —— 控制台会打
   `[remote] Class=xxx 客户端没有模型`。

### 技能视觉覆盖：31 / 13 / 1

`sourceTag()` 把 45 个技能分三档：

| 档 | 数量 | 含义 |
| --- | --- | --- |
| `client` | **31** | 源码 `MoveCharacter` 里查到明确特效 |
| `fallback` | 13 | 源码没给视觉，用本地兜底表现（3 掌心雷、6/15 瞬移、18 圣盾、19-23 剑士招式、24 多重箭、51 冰封箭、52 穿透箭、55 玄月斩） |
| `none` | 1 | 50「怪物区域攻击」——怪物技能，客户端不该有 |

**没有任何技能是「零视觉」**。近战招式的动作号也都对（19→56、20→57、21→58、22→59、
23→41/60、41→61、42→62、43→67、47→66）。

所以「很多技能没修好」如果有具体表现，大概率不是数据缺失，而是：
- 某个技能的特效模型/贴图号对不上（`EFFECT_MODELS` 缺项时部件会静默跳过）；
- 或者测的是离线 demo，本来就没有服务端行为。

### 新增排查口

```js
__MU_APP__.skillSpecs()   // 45 个技能的 action / source / parts / 特殊渲染器
__MU_APP__.f3Seen()       // 已收到过哪些 F3 子码（判断「服务端发没发」）
__MU_APP__.seenTypes()    // 视野里见过的实体 Class（召唤物 Class 对不对）
```

## 十四、demo 里的召唤技能（本地生成宠物）

正式服的召唤物是「服务端建实体 → `0x1F` 下发」，demo 没有服务端，所以以前放召唤技能
只有一圈光环，画面里什么都没有 —— 看起来就像技能没做。

现在 `castSkill` 里判断 `SUMMON_CLASS[skill.id]`，命中就在本地生成一只：

| 技能 | 召唤物 | Monster.txt Class |
| --- | --- | --- |
| 30 Summon Goblin | 小哥布林 | 26 |
| 31 Summon Stone Golem | 石巨人 | 32 |
| 32 Summon Assassin | 暗杀者 | 21 |
| 33 Summon Elite Yeti | 雪人王 | 20 |
| 34 Summon Dark Knight | 暗黑骑士 | 10 |
| 35 Summon Bali | 守护兽巴里 | 150 |
| 36 Summon Soldier | 黄金斗士 | 151 |

服务端这层映射本来是 `ServerInfo.txt` 的 `SummonMonster1..7`（`ServerInfo.cpp:1622`），
本仓库的配置里没写（取默认 0），所以按技能名直接对 `Monster.txt` 的 `Index` 列表。

几个细节：

- **重复施法只刷新不叠加**（同 Class 只保留一只），否则连点会堆出一群；
- 宠物血量取 `Monster.txt` 的 MaxLife，名字用服务端表里的中文名；
- `nearestDemoTarget()` 跳过宠物 —— 不然放技能会先打自己的召唤物；
- `updateDemoPets()` 每帧把它们绕玩家 1.7 格转圈（指数插值），demo 的普通怪是静止的。

验证 `tools/summon-probe.mjs`：

```
初始 0 只 → cast(30) 生成「小哥布林」dist=1.61 → 再 cast(30) 仍 1 只
→ cast(31) 变 2 只（小哥布林 / 石巨人）→ 坐标 134.4,130.1 → 134.6,131 在移动
6/6 通过
```

`__MU_APP__.demoMonsters()` 的每条现在带 `pet` 标记，方便区分召唤物和普通怪。

## 十五、音效：补上「第二张表」与怪物叫声

这一批是从「还缺什么」的对账里翻出来的，属于**整块缺失**而不是零散补丁。

### 根因：原版有两个音效加载器，我们只抄了一个

| 加载器 | 位置 | 内容 |
| --- | --- | --- |
| `Sound_LoadGameSamples` | `Model/Model_Gates.cpp` | 环境、脚步、打击、挥砍、技能、NPC —— 91 条 |
| `OpenBasicData` 尾部 | `Scene/Scene_AssetLoad.cpp:159-166` | **界面音效 7 条** |

`src/data/sounds.ts` 的注释里原来写着「0x19/0x1C 原版就是哑的，因为没有加载」——
那是只翻了 `Model_Gates.cpp` 得出的结论。实际上第二个加载器把这几条都装上了：

```
4    iTitle.wav         标题画面
0x19 iButtonClick.wav   按钮点击
0x1a iButtonError.wav   按钮不可用
0x1b iButtonMove.wav    悬停
0x1c iCreateWindow.wav  开窗口
0x25 iRepair.wav        修理
0x26 iWhisper.wav       悄悄话提示
```

表从 91 → 98 条，注释也改成了正确的说法。

### 怪物音效：`Monster_Data.cpp` 里本来就有完整映射

`OpenMonsterModel`（`Monster_Data.cpp`）按怪物 type 挂 5 条 `LoadWaveFile`：
idle×2 / attack×2 / die。索引就是 `Monster.txt` 的 `Class`，也就是视野包里的
`type` —— 不需要再映射一层。

新增 `tools/gen-monster-sounds.mjs` 解析出 **47 个 type / 126 个文件**，
生成 `src/data/monsterSounds.ts`（自动生成，带表头说明）。生成脚本里踩过两点：

1. `LoadWaveFile` 的**第一个参数不是稳定 id**（0xaa..），原版每次进图把 120..419
   重新分配（`OpenWorldModels` 会释放这段）。所以表里只存文件名。
2. 每个 type 的文件数不固定（3~5 个），不能按位置取。改成**按文件名分类**：
   `*Die*` → die、`*Attack*` → attack、其余 → idle。47 个 type 里 39 个有死亡音。

播放侧新增 `sfxFile(file, opt, channels)`：`sfx(id)` 只认表里的 id，怪物音效没有
固定 id，必须按文件名播。两者共用同一套通道簿记（键从 number 改成 string）。

挂钩点（`world/remotes.ts`）：

- `applyAction` 里怪物播攻击动作时 → 攻击音（两个变体随机）；
- `kill()` 里怪物倒地时 → 死亡音；
- `update()` 每帧给每个怪一个 `voiceAt` 错峰计时（6~14 秒）→ 待机叫声。

全部带 `{x, y}` 走 3D 衰减 + 左右声道，和原版 `Enable3DSound=1` 一致。
`Class 60..255` 没有表项 —— `Monster_Data.cpp` 只给 0..59 挂了音，静音是对的
（这批高 Class 是这份服务端数据额外的怪，原版客户端也没有它们的声音）。

### 界面音效接入

- 按钮「叮」：**一个**委托监听（`pointerdown` capture）覆盖所有 `button` /
  `.inv-cell` / `.skill-slot`，不给几十个面板挨个加；
- 私聊提示音：`0x02` 收到就用 `sfx(0x26)`，受 ESC 选项里的「悄悄话提示音」控制。

### 顺手修掉「选项不落库」

ESC 选项里的两个开关原来只改本地字段：既不生效到别处，也不上报服务端。
现在：

- `0x30` 到达时按 `gameOption & 1` / `& 4` 还原（**不是 `!= 0`** —— 关的时候字节
  是 `0x0A`，判非零会把「关」读成「开」，位定义见 `UI_InGameMenu.cpp:89-90`）；
- 拨动开关立刻 `sendOptionData()` 回写，且**保留 `qKey/wKey/eKey/chatWindow`**
  原值（客户端没有这三个界面，发 0 会把玩家存的药水槽清掉）。

### 验证

```
node tools/audio-probe.mjs          39/39   （表长断言 91 → 98）
node tools/monster-sound-probe.mjs  20/20   （表覆盖/文件 200/sfxFile/通道上限）
node tools/equip-power-probe.mjs    25/25
node tools/helper-probe.mjs          6/6
npm run build                        ✓
```

`monster-sound-probe` 里有个坑值得记：页面里 `import('/src/audio/sound.ts')` 和
`main.ts` 的 `./audio/sound` 在 Vite 下是**两个模块实例**（各自一份 AudioContext
和计数器），所以解锁、播放、读计数必须在同一个实例上做，不能借 `__MU_APP__.audioXxx()`。

### 仍未做

- `iCreateWindow`（开窗）、`iButtonError`（不可用）、`iRepair`（修理）三条**已登记
  但还没挂钩**：开窗要改所有面板的 `show()`，属于逐个补的事；
- `pLevelUp.wav`、`mChangeup.wav`、`mQuest.wav` 几个文件在磁盘上，但原版两个
  加载器都没装它们，怀疑是后续版本才用，先不动。

## 十六、传送门：客户端从来没发过 `0x1C`

用户反馈「地图上有些移动点好像漏了」。查下来不是数据漏，是**协议漏**：

> 服务端**不会**自己发现你站在传送门上。它只在收到
> `C1 06 1C [gate] 00 00`（`CMove::CGTeleportRecv`）时才搬人。

原版客户端每帧跑 `CheckGate`（`Net/SecondPassword.cpp:2536`），踩到门就发这个包。
我们这边 `buildXxxPacket` 一堆，**唯独没有这个** —— 所以洛兰→地下城、地下城→地下城2、
冰风谷→失落之塔……所有地图之间的路口走过去都没反应。离线 demo 更是完全没救。

### 数据本身是完整的

| 表 | 条数 | 说明 |
| --- | --- | --- |
| `Move.txt` | 23 | `/move` 菜单，全部 23 条都能解析到目的地（无孤儿） |
| `Gate.txt` | 77 | 其中 **26 条 `flag=1` 入口**、其余是落点(2)与 `/move` 落区(0) |

`flag` 的语义（从 `CGate::GetGate` 反推）：`Target` 是**对面的门号**，不是地图号 ——

```
1  flag=1 map=0 rect=121,232..123,233 → 2   洛兰城门（你踩它）
2  flag=2 map=1 rect=107,247..110,247 → 0   地下城落点（别人把你送这）
```

所以**只有 `flag=1` 会触发**：`flag=2` 是落点，踩它就会立刻弹回去。

### 实现

`src/world/gates.ts`（新）：`checkWalkGate(map, x, y, actor)`，逐条照 `CheckGate`：

- `flag === 1` + 本图 + 矩形 `X,Y..TX,TY`（含两端）；
- 魔剑士（`Class & 7 === 3`）等级门槛 ×2/3（服务端 `CGate::GetMoveLevel`）；
- 亚特兰蒂斯/塔卡（45..49 / 55..56）不许骑 418/419；
- 天空之城（62..65）必须翅膀 384..390 或恐龙头 419；
- **`MinReset/MaxReset/AccountLvl` 不判**：`parseGateText` 把 `*` 归一成 0，
  `MaxRes=0` 会被读成「转生必须为 0」，反而挡住所有人 —— 这两条留给服务端。

`main.ts::updateGateCheck()` 在移动之后、攻击之前每帧跑一次：

- 线上：发 `buildGateTeleportPacket(gate)`，然后**锁 3 秒**（原版
  `GetTickCount() - last < 3000` 的防抖），等服务端回 `0x1C` 搬人；
- 离线：直接按目的地门的矩形本地过图（同图用 `findSpawnTileInRect` 挑可站格，
  跨图取矩形内随机格交给 `loadWorld`），demo 里也能走通地图链路。

两个坑：

1. 守卫里**不能带 `loggedIn`** —— 离线沙盘（`enterOfflineSandbox`）不发 socket，
   `loggedIn` 一直是 false，带上去 demo 里永远不触发。
2. 离线给等级**不能给 999**：`Gate.txt` 的 `MaxLvl` 就是 400，超过会被上限那条
   `continue` 掉，表现成「检测跑了但什么都没发生」。现在给 400。

### 验证

```
node tools/gate-probe.mjs   21/21
  A 表：77 门 / 26 入口 / Target 全部可解析 / 覆盖 map 0,1,2,3,4,7,8,10
  B 判定：门 1 命中→地下城；矩形外不触发；flag=2 不触发；
          10 级被挡(need=20)；魔剑士 14 级过、12 级不过(need=13)
  C 离线：setPos(122,232) → 换到 map 1，落点 (108,247) 在门 2 矩形内，
          聊天框「已进入 地下城」；包体 c1 06 1c 01 00 00
  D 门锁：判定函数无状态，锁在调用侧
```

新增调试口：`gateState()`（进了多少帧/命中几次/被什么挡住/当前坐标）、
`gateCheck(x,y,level?,class?,wing?,helper?)`（问某格会不会触发）。

### 仍然没有的

- **法师瞬移**（`gate = 0` 那条分支）走的是同一个包，但技能 6/15 我们走的是
  `0x19` 技能包，行为是「原地闪」，没有 `gObjCheckTeleportArea` 那套合法性校验；
- 事件地图（恶魔广场 9 / 血色城堡 11..16）不在这两张表里，靠 NPC 入场，
  `0x90/0x9A` 已经接好。

## 十七、战盟标志终于画出来了

`guildMark` 这个字段从建库起就在收（`0x5A/0x5C` 的 `Mark[32]`），但**从来没渲染过** ——
数据到 `RemoteEntity` 就停住了，注释里还写着「3D 标志贴图那一层还没做」。

### 原版两张函数合起来才是一件事

1. `CreateGuildMark`（`Render/HUD_Pass4.cpp:744`）：用 16 色调色板
   （`GuildMark_InitializePalette`，0 号 = 透明）把 32 字节（8×8、每格 4bit）
   **逐像素写进一张 8×8 的 RGBA 纹理**；
2. `RenderGuildMarkOnShield`（`Render/Entity_UpdateRender.cpp:59`）：把这张纹理画成
   **billboard**（`GL_DrawBillboard(5, 7, matrix)`）挂在**骨骼 26** 上，
   局部位移 `(20, -5, -10)`（带盾 676 时 z 换 -18）。

调色板早就有了（`net/game.ts::GUILD_MARK_COLORS`，面板里选颜色用的就是它），
缺的只是把它变成 3D 纹理。

### 实现

`src/world/guildMark.ts`（新）：

- `guildMarkTexture(mark)` → 8×8 `DataTexture`，`NearestFilter`（像素风不能平滑），
  行序**手动翻**（`DataTexture` 默认 `flipY=false`，不翻图是倒的）；
- `guildMarkMesh(mark)` → `THREE.Sprite`，`alphaTest 0.5`（0 号色整格镂空，
  不开会有一圈黑边）；全 0 的标志直接返回 `null`，不挂空贴图；
- `disposeGuildMark()` 释放纹理。

`Actor.setGuildMark(mark | null)` 挂到 `rig.bones[26]`（`Bip01 R UpperArm`），
`disposeActor` 里一并清理。`remotes.setGuild()` 收到 0x5A/0x5C 就调它；
`index` 是自己时走新加的 `onSelfGuild` 回调（本地玩家不在 `entities` 里）。

### 为什么用 Sprite 而不是 Mesh

先按「固定朝向的 Plane」做过，结果贴着右臂的那块片**会跟着手臂转**，
侧身时整片消失，看起来像贴纸掉了。而原版最后一步就是 `GL_DrawBillboard` ——
永远正对镜头。换成 `Sprite` 之后任意角度都能看见，也更省事（没有朝向要调）。

尺寸：原版 `5×7` 游戏单位 = `0.05×0.07 m`，画在 2.25 m 高的角色上只有几个像素，
放大到 **0.2×0.26 m**（肩章大小）。

### 验证

```
node tools/guild-mark-probe.mjs   11/11
  A 纹理：8×8、256 字节、四角白 / 中心青 / 内部红、0 号色 alpha=0
  B 全透明 → 不生成 quad
  C 挂点：Bip01 R UpperArm（骨骼 26）
  D 可见性：冻结场景戴/摘对比 → 变化 117 px，区域 11×19 @ 639,314
```

新增调试口：`guildMark(cells|null)`（灌 64 格图案，`null` 摘掉）、
`guildMarkPose({offset, scale})`、`bones()`（骨骼序号↔名字）、`face(deg)`（转朝向截图用）。

> 踩坑：截图探针里 `timeScale(0)` 要**等镜头插值到位之后**再冻，否则相机还在初始位置，
> 截出来是一片草地（第一版就是这样，看着像「角色不见了」）。

### 说明与限制

- 0.97 把标志画在**右臂**（骨骼 26 = `Bip01 R UpperArm`），不是严格贴在盾面上 ——
  这是原版行为，照抄；位置不对改 `GUILD_MARK_POSE.offset` 即可；
- 远程玩家的标志只走 `0x5A/0x5C`：如果标志包比实体先到会丢（实体表里还没有这个人），
  实际顺序是先 `0x12/0x13` 建实体再补 `0x5A`，暂时没问题；
- 头顶的**盟名文字**仍然没画（名字标签只有角色名），要做的话得在 `worldTags` 里加一行。

## 十八、收尾一批：头顶盟名 / 界面音效挂钩 / 坐骑不画

### 头顶战盟名（第二行）

`0x5A/0x5C` 的 `GuildName` 以前只存进 `RemoteEntity.guildName` 就没人用。
现在 `worldTags` 的标签结构里多了 `.wtag-guild` 一行（10px、青灰、带描边），
名字下面显示；没有盟就 `display:none`，不占位。数据入口两处：

- 其他玩家：`list()` 已经带 `guild` 字段，直接透传；
- 自己：`0x5A` 里 `index` 是自己时走 `onSelfGuild` 回调存进 `selfGuildName`。

顺带修了一个副作用：`syncWorldTags()` 原来 `if (!loggedIn || !currentChar || !world)`
直接关掉整个标签层 —— 离线沙盘（`currentChar` 为空）就连怪物/NPC 的名字血条都没有。
现在只要求 `world`，沙盘里也能看到名字了。

### 界面音效三条挂钩

`sfxClick()` / `sfxError()` / `sfxOpenWindow()` 三个快捷入口，分别对应
`iButtonClick(0x19)` / `iButtonError(0x1a)` / `iCreateWindow(0x1c)`：

| 触发 | 位置 |
| --- | --- |
| 开窗口 | 背包 / 属性 / 队伍 / 战盟 / 任务 / 商店 / 仓库 / 混沌 / 事件 / 黄金部队 / 移动命令 |
| 操作失败 | 五个面板的 `toast(..., 'error')` 统一入口（`npcPanel` / `chaosPanel` / `guildPanel` / `eventPanel` / `goldenArcherPanel`） |
| 修理成功 | `0x34` 回执里 `spent > 0` 时播 `iRepair(0x25)` |

验证：`audioSfx` 逐个播 0x19/0x1a/0x1c/0x25，`played=4 dropped=0`，
通道键 `#25/#26/#28/#37` 全在。

### 418/419 坐骑：原版就不画

之前四个 helper 模型全都挂到骨骼 34 上。但 418/419（独角兽 / 恐龙头）是
**骑乘坐骑**，模型只有 2 骨 1 帧的静态片；而原版 `Render_PlayerHelper`
第一行就是 `if (*(short*)(c + 0x2B8) != 817) return;`（817 = Helper02 小恶魔），
压根没有它们的渲染分支。现在收紧到 `HELPER_RENDERABLE = {416, 417}`
（两个自带 8 骨 7 帧循环的跟飞宠物），418/419 不画 —— 骑乘是服务端行为
（移速/姿态），客户端这边没有可抄的实现。

### 仍未做：转生门槛展示

服务端 `/reset` 只在**失败时**用系统公告报「等级不足/金币不足/次数到顶」
（`gMessage` 58/59/76），成功时也只发一条公告，没有结构化回执。
要做「转生界面（显示当前次数 + 下次所需等级/金币）」必须改协议并重编 GameServer，
不在客户端能解决的范围内。

## 十九、转生（`/reset`）到底做了什么

用户问：「满级转生会降回 1 级，但属性还是满级，之后再升级把点加回来 —— 是不是这样？」

**是的，而且这是配置决定的**，不是客户端表现。链路是：

```
/reset → CCommandManager::CommandReset（校验等级/钱/次数）
       → DataServer WZ_GetResetInfo（当日/周/月次数）
       → DGCommandResetRecv（真正落地）
```

`DGCommandResetRecv`（`CommandManager.cpp:1058`）做的事：

| # | 动作 | 配置项 | 本服取值 |
| --- | --- | --- | --- |
| 1 | 扣钱 | `CommandResetMoney` | 0（免费） |
| 2 | `Level = CommandResetStartLevel` | `CommandResetStartLevel` | **1** |
| 3 | `Experience = gLevelExperience[Level-1]` | — | 1 级起点 |
| 4 | `Reset += CommandResetCount` | `CommandResetCount` | +1 |
| 5 | 清未分配点 + 四项属性 | `CommandResetStat` | **0 = 不清** |
| 6 | 清任务 / 清技能 | `CommandResetQuest` / `CommandResetSkill` | 0 / 0 |
| 7 | 回安全区（`gObjMoveGate(17)`=洛兰） | `CommandResetMove` | 1 |
| 8 | `CharacterCalcAttribute` → 重算上限与 `NextExperience` | — | — |

**关键就是第 5 行**：`CommandResetStat_AL*=0`，于是这一整段被跳过 ——

```cpp
if (gServerInfo.m_CommandResetStats[...] != 0) {
    lpObj->LevelUpPoint = point;       // 重新给一大堆点
    lpObj->Strength  = 职业初始值;      // 属性归零
    ... Dexterity / Vitality / Energy
}
```

所以本服转生后：**等级 1、属性原封不动（还是满级那套）、未分配点也留着**。
之后从 1 级重新升，每级继续加 `DW/DK/FE=5`、`MG=7` 点
（`Common.dat` 的 `*LevelUpPoint`），升回 400 级就是再拿 ~1995 点 ——
这正是「属性点再加回来」。

需要完全重置（经典转生）就把 `CommandResetStat_AL*` 改成 1：那样属性回到职业初始值，
但 `LevelUpPoint` 会被重算成 `ResetPoint + (Level-1)×每级点 + 果实点`，玩家重新加。

### 顺手记两个坑

1. **`CommandResetStartLevel = -1` 那行是写反的**：
   ```cpp
   lpObj->Level = (m_CommandResetStartLevel == -1)
       ? (lpObj->Level - m_CommandResetStartLevel)   // -1 时等于 等级 +1
       : m_CommandResetStartLevel;
   ```
   本意大概是「保持等级」，实际会升一级。当前配置是 1，走 else 分支，无影响；
   但要改成 -1 之前必须先修这行。
2. **`NextExperience` 靠 `CharacterCalcAttribute` 里的 `gObjCalcExperience` 重算**，
   不是转生代码自己设的 —— 所以第 8 步不能省，否则 1 级要打满 400 级的经验才升 2 级。

### 客户端侧：一处错乱，已修

转生回执走的是 `GCLevelUpSend`（`0xF3/0x05`），和普通升级**同一个包**，
所以之前转生瞬间会闪一圈升级金光 +「LEVEL 1」飘字 + 聊天「等级提升！Lv 400 → 1」。

现在按 `ev.level > before` 分流：

- 真升级：`playLevelUpFx()` + `LEVEL n` 飘字 + 「等级提升！」；
- 等级下降（转生）：不播特效，聊天给「等级已重置为 Lv 1（转生后从 1 级重新升，可分配点 N）」。

另外 `applyCharacterExtra`（`0xF3/0xE0`）原来只吃 `reset/grandReset`，
现在也兜底更新 `level / levelUpPoint / experience` —— E0 里本来就带这三个字段，
万一某条路径只发 E0，面板不会还停在 400 级。

### 验证

```
node tools/reset-probe.mjs   21/21
  A 配置：400 级 / 回 1 级 / 免费 / +1 次 / Stat=0 / 回安全区
  B 代码：等级与经验赋值、Reset 累加、「清属性」被 Stat 包住、
          之后 CharacterCalcAttribute、E0 在 F3/05 之前
  C 客户端：等级回 1、转生 +1、文案「等级已重置」且不含「等级提升」
  D 对照：普通升级仍显示「等级提升」
```

新增调试口：`simReset(fromLevel)`（模拟一次转生回执）、`simLevelUp(level)`
（模拟一次普通升级）、`demoChar(name)`（走演示角色卡进图，`/demo` 需要先点「进入游戏」）。

## 二十、战盟战比分条 / 药水槽读服务端 / `/pt` 别名

### 0x64 比分：一直是错的

`PMSG_GUILD_WAR_SCORE_SEND`（`Guild.h:317`）是 `BYTE score[2]`：

```
score[0] = 自己公会 Guild->PlayScore
score[1] = 对手公会 TargetGuildNode->PlayScore
```

以前按 `(pkt[3] << 8) | pkt[4]` 合成一个 16 位数，3 : 5 会读成 **775**。
现在拆成 `{ mine, theirs }`。

### 比分条（原版 `Render_CharInfoPanel_` 的 `EnableGuildWar` 分支）

`src/ui/guildWarBar.ts`（新）：顶端两行，每行 `[盟标] 分数 公会名`，
我方绿、对方橙（原版 `0xFF008000` / `0xFFFF9560`）。`0x62` 开、`0x64` 更新、
`0x63` 结束收起、退出游戏也收起。

敌方盟标拿不到 —— 这三个包都不带 `Mark`，原版是按名字去 `0x5A/0x5C` 的战盟表里查。
所以只有**自己**那格会画（用 `onSelfGuild` 存下来的 32 字节）。

### 药水槽终于读服务端

`0xF3/0x30` 的 `QKey/WKey/EKey` 存的是「绑定的物品类型 + 64」（`opt[11] = type + 64`）。
`useQuickSlot` 现在先按这个精确类型找，背包里没有才退回原来的分类搜索
（治疗 / 魔法 / 辅助）。这样在老的 Win 客户端上配过 Q/W/E 的玩家，换到网页端也照他那套喝。

### `/pt` 别名

原版客户端 `/party` 和 `/pt` 都拦（`Chat_CommandParser.cpp:46` 的 strstr 表里两个都有），
现在正则改成 `/\/(?:party|pt)(?:\s+(.+))?$/i`。

顺带确认：`/post`、`/war`、`/soccer` 这些**是服务端命令**（`Data/Command.txt`），
客户端只要把文本原样发出去就行，不需要额外处理 —— 本来就已经通了。

### 验证

```
node tools/guild-war-probe.mjs   12/12
  A 0x64 → {mine:3, theirs:5}（不是 775）
  B 两行 / 3:5 / 对手名 / 颜色不同 / 结束时收起
  C /party 正则含 pt
  D useQuickSlot 读 type + 64
```

### 没做：NPC 用玩家外观（236 / 247 / 249）

原版这三个 NPC 走的是 `CreateChar5(Key, 390, …)`，390 是**玩家骨架的 NPC 模型**，
然后直接往实体上写部件模型号：

```
247 守卫   : 633(头) 665(上) 697(下) 729(手) 761(鞋) + 539(武器) + 535(盾)
249 守卫   : 同上，武器 503、无盾
236 黄金弓箭手: 只设 c+446 = 8（武器/动作类），身体部件走默认
```

这些 633/665/… 是**客户端模型号**（和 `BodyPart = Class + 0x390` 那套不是一张表），
我们手里没有「模型号 → 物品类型」的映射表，硬猜会变成一身错装备的守卫 ——
比现在拿 `Man01` 顶替更糟。所以这一项先留着，等能拿到那张表（或原版截图逐件对）再做。

## 二十一、三个「玩家骨架 NPC」：黄金弓箭手 / Archer Guard / Berdysh Guard

上一轮把这项标成「暂缓，缺模型号→物品类型映射表」。用户给了两张原版截图，
顺着 `Monster.cpp:1245/1299/1318` 把表找到了 —— **不需要映射表，模型号减 400 就是物品类型**。

### 原版怎么做的

```c
case 247:
    c = CreateChar5(Key, 390, PositionX, PositionY);   // 390 = 0x186 = player.bmd 的模型槽
    *(unsigned short*)(c + 504) = 633;   // Helm
    *(unsigned short*)(c + 528) = 665;   // Armor
    *(unsigned short*)(c + 552) = 697;   // Pant
    *(unsigned short*)(c + 576) = 729;   // Glove
    *(unsigned short*)(c + 600) = 761;   // Boot
    *(unsigned short*)(c + 624) = 539;   // Weapon
    *(unsigned short*)(c + 648) = 535;   // Shield
```

- `390 = 0x186` 正是 `Model_Items.cpp` 里 `AccessModel(0x186, "Data\\Player\\", "Player", -1)`
  的槽号 —— 所以这三个 NPC **就是玩家**：同一副骨架、同一条装备管线；
- 偏移每 24 字节一个槽，`504/528/552/576/600/624/648` 依次是
  Helm / Armor / Pant / Glove / Boot / Weapon / Shield；
- 模型槽号 ↔ 物品类型：`SLOT_FILES` 的表就是 `type + 400`，所以 **槽号 − 400 = 物品类型**。

### 换算结果

| 槽号 | 文件 | 物品类型 | 名字 |
| --- | --- | --- | --- |
| 633 | HelmMale10 | 233 | Plate Helm |
| 665 | ArmorMale10 | 265 | Plate Armor |
| 697 | PantMale10 | 297 | Plate Pants |
| 729 | GloveMale10 | 329 | Plate Gloves |
| 761 | BootMale10 | 361 | Plate Boots |
| 539 | CrossBow04 | 139 | 弩 |
| 535 | Arrows01 | 135 | 箭（247 左手那袋） |
| 503 | Spear09 | 103 | 长矛（249 的 Berdysh） |

`247 = Archer Guard`（弩 + 箭）、`249 = Berdysh Guard`（长矛），和用户给的两张图完全对得上 ——
图 2 那身银蓝板甲 + 长柄武器就是 249。

### 实现

不再复刻那套 24 字节偏移，而是翻译成 `EquipSet` 走 `applyEquipment`：

```ts
export const PLAYER_SKIN_NPCS: Record<number, PlayerSkin> = {
  236: { equip: {...Plate 五件, weapon: 139}, tint: 0xf0b24a },
  247: { equip: {...Plate 五件, weapon: 139, shield: 135} },
  249: { equip: {...Plate 五件, weapon: 103} },
};
```

`createPlayerSkinNpc()`（`actor.ts`）：

1. `loadBmd('/Data/Player/player.bmd')` → `createRig()` 建骨架；
2. `actor.attachMeshes(scene)` —— player.bmd **只有骨架、0 个网格**，这一步只是把
   `root` 放进场景（`applyEquipment` 末尾的 `setMeshes` 靠 `root.parent` 决定挂哪）；
3. `applyEquipment(actor, PLAYER_DIR, ...)` 套装备 —— 蒙皮、贴图混合、骨骼映射、
   强化光效全部复用现成逻辑。

### 236 金色：资源包里没有那套甲

`case 236` 只有 `*(unsigned int*)(c + 4) = 207`（换皮）和 `c+446 = 8`（动作组），
所以外观本该靠贴图。实测三张候选：

| 贴图 | 平均色 | 金色像素占比 |
| --- | --- | --- |
| `Npc/guard_gold2.OZJ` | rgb(56,53,50) | **5.3%** |
| `Object5/guard_gold2.OZJ` | rgb(74,71,67) | 8.3% |
| `Player/skin_archer_01.OZJ` | rgb(140,123,101) | **48.1%** |

名字带 gold 的 `guard_gold2` 其实是守卫的腰布（两块同名文件内容还不一样，
`md5` 不同）；`skin_archer_01` 倒是真偏金，但它**没有被任何 bmd 引用**
（`grep -rl skin_archer` 只命中我们自己的 `textures-index.json`），
套到 Plate 的 UV 上直接花成迷彩。

结论：**这份资源包里没有黄金弓箭手的专用金甲**。所以 236 用「Plate 五件
+ 材质乘法染色 `0xf0b24a`」近似 —— 是配色接近，不是逐像素还原。

> 踩坑：`getBmdMaterial` 是**按贴图缓存共享**的，直接 `material.color.setHex()`
> 会把所有用同一张贴图的角色一起染金 —— 第一版就把 249 Berdysh Guard 染成了
> 金色。现在染色前 `mat.clone()` 并标 `userData.owned`，`disposeActor` 里单独释放。

### 验证

```
node tools/npc-skin-probe.mjs   21/21
  A 分支：三个都走 player.bmd / 装备槽对（236 弩、247 弩+箭、249 矛）
  B 网格：每个 9 个（Plate 五件共 8 个网格 + 武器 1 个），手持 1~2 个
  C 截图：shots/npc-skin-{golden-archer,archer-guard,berdysh-guard}.png
  D 可见性：与"挪走"对比，变化 1.2~2.4% 画面像素
```

新增调试口 `__MU_APP__.npcSkin(cls, dx, dy, hideSelf)`：在主角位置摆一个该 Class 的
NPC（默认把主角藏起来，否则第三人称镜头会挡住），返回网格/手持/材质明细。

### 仍未做

- 远程玩家（服务端下发的 236/247/249）也会走这条路径 —— 因为改的是
  `modelForClass()`，`remotes` 建实体时同样命中；
- 236 的金色是染色近似，要真还原得补资源（原版 `GoldenArcher` 的 bmd + 贴图）。

## 二十二、技能：按源码收回 19..23，瞬移接上动作，补技能卷轴

上一轮说「13 个兜底技能的观感靠猜」。这一轮回到源码逐条对了，
**结论是其中 5 个根本不该有模型特效**。

### 19..23 近战五招：源码只有一颗光点

`Combat/Skills_WarriorLegacy.cpp::Combat_UseWarriorSkill` 全函数里，视觉只有三行：

```c
SetAction(o, selectedSlot + 37);                        // 动作 56..60
float Light[3] = { 1.0f, 1.0f, 1.0f };
Particle_Spawn(1232, (float*)(o + 16), (float*)(o + 28), Light, 0, 0.0f, o);
PlayBuffer((_rand() & 1) + 0x28, 0, 0);                 // 刀风
```

`1232 = Effect/Shiny03.OZJ`（`EFFECT_TEXTURES`）。**没有 Earthquake02、
没有 Piercing、没有 Blast01/Storm01/Kcross** —— 那五个是 `SKILL_FX` 里
「挑一件语义最贴的现成资源」，`source` 标的是兜底。

现在 `SKILL_REFINE` 里给 19..23 加整份 `replace`（一颗 Shiny03），
并把来源改判为 `client`（`SkillRefine.source` 字段）。原版近战的手感是
**挥砍动作 + 武器拖尾 + 一颗光点**，拖尾那套我们本来就有（`trailLayer`）。

> 想恢复「更炫但不对版」的表现：把 `skillFxRefine.ts` 的
> `MELEE_EXTRA_FX` 改成 `true`，就回到 `SKILL_FX` 那 5 个模型。

### 6 / 15 传送：动作是 87，不是施法 82

```c
CreateTeleportBegin(o):  SetAction(o, 87); alpha = 0;  CreateEffect(1176); PlayBuffer(88);
CreateTeleportEnd(o):    SetAction(o, 87); alpha = 1;  CreateEffect(1176); PlayBuffer(88);
```

两个函数**动作号相同（87）**，只差 alpha 与 anim_speed。以前走默认施法 82，
画面上是「举手施法」而不是「原地消失」。`1176 = Effect/Spark03.OZJ`，
原来配的 `Shiny02` 已换掉。

> 角色淡出（`alpha` 0/1）这一层没做：需要给 `Actor` 加整体透明度过渡，
> 属于角色渲染管线改动，和「技能特效」分开算。

### 技能卷轴（`Attack_UseManaScroll97k`）

```c
const bool lowMana = (piMana > (int)*(unsigned short*)(attr + 30));
case 41: if (lowMana) { Attack_UseManaScroll97k(); return; }   // ← 用完也 return
```

两个关键点：

1. **用了药也不放** —— 喝一瓶、等玩家再点一次，不是「自动补蓝接着放」；
2. 药是从**快捷槽按分类**找（`Item_FindQuickSlotByCategory(3)`，3 = 魔法药），
   不是随便哪个格子里的蓝瓶。

抽成纯函数 `src/data/skillMana.ts::manaBlock(cost, mana, hasPotion)`，
沙盘（`castSkill`）与联机（`castOnlineSkill`）两条路都接上了。
沙盘里 `currentChar` 为 null（不扣蓝），所以只在联机时生效。

### 剩下的 4 个兜底，都是「源码确实没有」

| 技能 | 源码情况 | 处理 |
| --- | --- | --- |
| 3 掌心雷 | `case 3` 只有 `PlayBuffer(60)` + 打断目标动作，**无 `CreateEffect`** | 保留兜底（一道雷 + 火花），`note` 写明 |
| 11 真空波 | 源码 `CreateEffect(203)` 在施法者身上生成、沿角度推进 | 改成「飞向目标」（已有 `WIZARD_FIX`） |
| 18 圣盾防御 | `Skills.cpp` / `SecondPassword.cpp` 里**没有 case 18**，buff 类客户端无表现 | 保留 `Protect01` 光圈，标注「源码未见」 |
| 55 玄月斩 | 有 `SKILL_REFINE`（`Tail.bmd` + 身前挥砍） | 不动 |

### 验证

```
node tools/skill-fx-probe.mjs   38/38
  A manaBlock 5 例（够 / 刚好 / 差一点有药 / 差一点没药 / 无消耗）
  C 19..23：source=client、动作 56..59/41、各 1 件、必须是 Shiny03、
            且**不能**再出现 Earthquake02/Piercing/Blast01/Storm01/Kcross
  D 6/15：动作 87、部件含 Spark03
  E cast(19) 后 spriteLayer 有存活件（轮询 1.2 s，因为 spawn 是异步的）
  F 截图：shots/skill-{melee-19,teleport-06}.png
```

新增调试口 `skillBlock()`（最近一次技能为什么没放：`''` / `'mana'` / `'mana-scroll'`），
`castSkill()` 返回值加了 `partsDetail`（`kind:file`），探针才能断言「到底是哪个文件」。

### 顺带纠正一处我自己的误判

我在动手前说「联机路径没有技能发包」——**是错的**。`buildSkillAttackPacket`
（0x19）和 `buildDurationSkillAttackPacket`（0x1E）都在，`castOnlineSkill()`
也早就写好了，注释里还留着「以前只跑离线沙盘」的说明。
是我用 `grep "^  [a-zA-Z]*("` 列方法名时漏掉了 `game.ts` 里的构造函数。
