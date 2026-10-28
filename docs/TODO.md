# 待同步清单（按「看得见的程度 / 风险」排序）

> 勾选 = 已完成。每项都尽量对应到客户端源码里的具体函数，避免"猜着做"。

## A. 文案 / 本地化（`Data/Local`）

- [x] `Text.bmd`（chs）接进属性面板（`GlobalText[200..217]`）
- [x] `item.bmd`（chs）物品名（波刃剑/短剑…），`itemDisplayName` / `itemAttr` 同源
- [x] `Dialog.bmd`（chs）NPC 对话窗 + `m_iLinkForAnswer` 链式跳转
- [x] F1 帮助窗（`Text.bmd 120..157`，38 行两列）
- [x] **按钮/面板文案走 `GlobalText`**：`228 确认` / `229 取消` / `237 全体修理(A)` / `247 关闭`
      （`dialog` / `tradePanel` / `guildPanel` / `npcPanel` / `eventPanel` / `goldenArcherPanel`）
- [x] `quest.bmd` 的 `m_iReturnForAnswer`（1 接受 / 2 关闭 / 3 提交）→ 对话答案接 `0xA2` 发包
- [x] ~~`Filter.bmd` / `FilterName.bmd`：聊天屏蔽词~~ —— **用户确认这两份文件是空的，不用做**
      （2026-10-27：明文里没有词条，也不需要解密，直接从待办里划掉）
- [x] `NPCName.txt`（chs）：怪物 / NPC 的中文名牌（`loadNpcNames()` → `setNpcNameTable()`）
      - 原版 `Item/NPC_Data.cpp::NPCName_LoadTextData`（IDA FUN_0047D120）读的就是它，
        `Monster.cpp:1396` 的 `CreateMonster` 用 `getMonsterName(Type)` 填 `c+0x1c1` ——
        **怪物也用这张表**，所以中文客户端里是「骷灵战士」而不是服务端的 `Skeleton`。
      - 明文 GBK，`<Type> <Idx> "Name"` 三列，`//` 注释、`end` 结束；空名字跳过。
      - chs 那份 152 条：235 圣导士塞维娜 / 236 弓箭手洛斯 / 249 守卫 / 251 铁匠 汉斯 /
        255 老板娘 莉雅；`monsterNameOf()` 优先查它，服务端 `Monster.txt`（英文）当兜底。
      - 探针 `tools/npc-name-probe.mjs`，调试口 `__MU_APP__.npcNames()`。
- [x] **界面文字统一走 `Data/Local`**（阶段 CE）
      - 物品名：`itemAttr()` 改成 `itemNameSync(type) || 静态表`，读的是
        `chs/item.bmd`（512 条，`loadItemNames()` 早就在跑，只是 UI 没用它）；
        读完要 `refreshItemNames()` 清 `ATTR_CACHE`。
      - tooltip 行抽到 `ui/itemTip.ts`，背包/商店/仓库共用一套 `GlobalText` 模板；
        商店额外一行买卖价（原版 `if (ShopOpened != 0)`）。
      - 背包金币条标题 `Zen` → `GlobalText[224]`「金」。
      - 装备槽的空槽提示（「武器/头盔/戒指 1」这类）仍是自写中文 ——
        `Text.bmd` 里没有对应的槽位名，原版空槽也不出 tooltip。
- [x] **剩余硬编码文案**（A3）
      - `npcPanel` 的 `TEXT` 从「写死中文」改成 getter 走 `textSync`：
        商店标题 `[230]`「商  人」、仓库标题 `"%s (%s)"` 234+240/241、
        金币条 `[224]`「金」、费用 `[266]`「仓库使用费」、按钮 `[235]存款`/`[236]提款`/`[242]`/`[237]`。
        `Text.bmd` 是懒加载的，所以 `show()` 里加了一次 `refreshText()`。
      - 背包标题 `物品栏` → `[223]`「装  备」。
      - tooltip 词条改原版模板：`[40]` 单手攻击力（`%s: %d ~ %d`）、`[64]` 攻击速度、
        `[65]` 防御力、`[67]` 防御率；耐久 `[71]`「耐久度 : [%d/%d]」（箭矢 `[69]` 数量 /
        宠物 `[70]` 生命 / 426 `[95]`）；需求拆成 `[73]`力 / `[75]`敏 / `[77]`智 / `[76]`级
        各一行，不够时补 `[74]`「(还需 %d)」。
      - **背包 tooltip 不显示价格** —— 原版那行包在 `if (ShopOpened != 0)` 里
        （`RenderItemInfo.cpp:2020`），只有站在商人面前悬停才显示 `[62]/[63]`。
      - 探针 `tools/a3-text-probe.mjs`。

## B. 画面（地图/角色）

- [x] 收顶：洛兰 `125/126`（`HeroTile==4`）+ 冰风谷 `81/82/96/98/99`（`HeroTile==3 或 >=10`）
- [x] 占位/锚点模型：`HiddenMesh=-2` 的逐地图类型表 + 6 顶点三棱柱面片
- [x] 这些类型自带的特效（火/烟/光点）补上（`FX_BY_MAP`）
- [x] 亚特兰蒂斯水下姿势：待机 9/10（浮空）、走动 21（游动）
- [x] **耐力（stamina）**：本地冲刺计数（原版 `c+0x300`），走一格 +1、停下/安全区清零；
      `>= 40` 时游泳用力竭动作 29
- [x] **水面网格 + UV 滚动 + 顶点波动**：`terrain.water` 单独一层半透明网格，
      贴图 UV 随时间滚动、顶点按 `sin(x*0.55+t)` 只往上抬（不超过 0.05 格），
      深度不写、`depthWrite=false` —— 水里的人和物件不会被糊住
- [x] **水面判定改用瓦片索引**：洛兰 `layer1==TileWater01`、亚特兰蒂斯 `layer2==TileWater01`
      （实测 `.att` 的高度字节和 `TW_WATER` 位都认不出水：洛兰只有 6 格高度是 0、
      `TW_WATER` 两张图一格都没置）
- [x] **水下滤镜**：亚特兰蒂斯非安全区整屏蓝绿 + 暗角（`#water-tint`，DOM 层，
      4/s 指数缓动约 0.25 秒过渡）；判据与游泳姿势共用，不会「人在游但画面没变」
- [x] 缺 tile 时从别的 World **借同一张**（World8 缺 `TileWater01` 但 `.map` 里
      6974 格 layer2 = 5；原版是 OpenJPG 失败后槽位保留上一次绑定，碰巧对）
- [x] **贴图混合「自动识别」**（物件 / 装备 / 怪物 / NPC / 玩家 / 地面物品 一套规则）
      - 原版怎么定的（`Render/BMD_LegacyDraw.cpp` 的 `BMD__RenderMesh`）：
        **按贴图自动判的只有 `Bitmaps[tex].bpp == 4`** —— OZT/TGA 带 alpha 就走
        `GL_SetBlendSrcOver(1)`（alphaTest），否则 `GL_ResetState()` 不透明；
        加色是**调用方**传的标志（`0x40` = `RENDER_BRIGHT`、`0x80` = `RENDER_DARK`），
        而且 `0x40` 那条还要求 `bpp != 4`（有 alpha 的不给加色）。
        纹理槽 `+0x28 = bpp`，OZT 写 4、OZJ 写 3（`Texture/Texture.cpp`）。
      - 我们照做 bpp 规则，再补一条**自动加色**判据 → `core/blendHeuristic` 的
        `modelBlend()`：**黑底发光**（一圈纯黑 + 黑占过半 + 里面有内容）**且**贴图名带特效词。
      - 单一入口：`objects.ts` / `items.ts` / `actor.ts`(×4) / `ambient.ts` 全部改成
        `modelBlend()`，不再各自 `tex.tag === 'blend'`。
      - 名单 `ADDITIVE_OBJECTS_BY_FOLDER` 只留一条逃生口：
        `8: Object41`（亚特兰蒂斯蝴蝶 @ `ioi01.jpg`）—— 它像素那关是过的
        （glowRaw 0.77 / 边框黑 0.93），但名字 `ioi01` 没有特效词；而放开名字条件的话
        同图的 `gearB.jpg`（0.91）/ `R.jpg`（0.98）会一起被误翻成加色，像素上分不开。
      - 扫描 8 张图后加色的只有：`candle2 / fire_01 / fire_02 / fire0a / light2 /
        light3 / light01 / aurora / cobweb`，木头 `wood02`(×17)、`squid01`(×40)、
        `gearB`(×8)、`steel_barred`、`horse_drawn`、`tile_space` 都是实体（已排除）。
- [x] **地形亮度按图定标**（把各图的光照图均值抬到同一档位）
      `TerrainLight.OZJ` 每张图的基准差很多（洛兰 0.56 / 冰风谷 0.57 / 死亡沙漠 0.61；
      **亚特兰蒂斯 0.299 / 失落塔 0.326 / 地下城 0.431**），原来一套常数映射把暗图压到 0.44
      → 实机"闷在深蓝里"。现在按 `LIGHT_LEVEL_TARGET=0.68` 逐图求 `uLightLift`
      （只抬不压，上限 1.65）：亚特兰蒂斯 ×1.563、失落塔 ×1.479、地下城 ×1.222，
      洛兰 1.006 / 冰风谷 1.0 —— 亮图不回归，暗图抬亮。A/B 实测 +53%。
- [x] **物件顶点光照对齐 viewer**：原公式 `clamp(0.62,1.0, 0.68+d*0.4)` 上限只有 1.0，
      viewer 是 `AmbientLight(0.6) + DirectionalLight(1.0)` → 受光面能到 1.6。
      现改成同一套式子（`OBJ_LIGHT`，半兰伯特 + 0xfff8e0 暖色，光向取 viewer 的灯位）
      → 物件更亮、亮暗反差更大。洛兰平均 luma 60→65.5，过曝像素 0.1%。
- [x] **物品模型映射照抄原版 `OpenItems`**（`Model/Model_Players.cpp`，IDA 0x005079D0）
      - 原版是**按模型槽（type + 400）硬编码加载**的，槽号和文件名之间没有算术关系：
        `791..798 = Gem01..08`（技能石，**不是翅膀**）、`799 = Jewel15`、`800..803 = Gem10..13`、
        `830 = Quest04`（洛克之羽）、`831 = Quest05`（果实）、`832..834 = EventBloodCastle00..02`、
        `864..874 = Jewel03 / Devil00..02 / Drink00 / ConChip00 / jewel22 / Quest00..03`
        （生命宝石 / 恶魔之眼·钥·通行证 / 爱情的魔力 / Rena 通宝 / 创造宝石 /
         帝王之书 / 断魂之剑 / 精灵之泪 / 先知之魂）。
      - 之前按「group 前缀 + index」拼 → 30 件落到不存在的 Wing08 / Helper05 / Potion17：
        **掉在地上没模型、背包和仓库那一格也是空的**。
      - 精灵五套防具占的是**另一段模型槽**（Male 624..633 / Elf 634..638），
        之前算成 `HelmMale11..15`（文件不存在）→ 藤/天蚕/风/精灵/女神 五套共 25 件全空。
        现在 `bodyModel()` 按 index 10..14 走 Elf 段。
      - `type 20 断月之光` → 资源包里是小写 `sword22.bmd`；`Shield16/17` 也是小写，靠
        `loadProto` 的多候选兜住。
      - 唯一的例外 `type 435 大天使之武器`（槽 835）原版就没加载模型，现在给**占位图/占位方块**
        （`itemIcon.placeholder`），不再是一格空白。
      - 体检口 `__MU_APP__.itemProbe(types)` / `itemMeshes()`；探针 `tools/item-model-probe.mjs` 16/16。
- [x] ~~小地图底图~~ —— **用户确认已自行做好（2026-10-27）**，从清单移出
- [x] **启动画面 + 读条画面**（`Scene_Intro.cpp` / `Scene_Loading.cpp`）
      - 启动：`Webzenlogo.ozj` 256×195 在 (192,142.5) 正中 + `Everyone.OZJ` 120×60 在 (520,0)
        右上角，纯黑底，1.6s 后淡出（点一下跳过）。原版这一屏只画一帧就进登录，
        我们拿它盖住登录背景/选角 3D 的首屏下载。
      - 读条：`Loading01/02/03.ozj` 按源码 `(0,100)256×256 / (256,100)128×256 /
        (384,100)256×256` 横拼成一条 640 宽的底图；进度条是网页端补的（原版没有）。
      - 文件：`src/ui/splash.ts`、`logoAssets.ts::localSprite()`、`style.css` 的 `#intro` / `#loading`。
      - 探针 `tools/splash-probe.mjs` 量逻辑坐标，六个盒子全部与源码常量一致。
- [ ] 相机穿墙：贴墙/进屋时镜头会穿进模型（原版有相机碰撞）

## C. 玩法

- [x] **技能表现链路统一**（这一轮的重点）：本地沙盘和收包/远端共用 `playCastParts()`
      - 以前只有本地 `castSkill` 走 `castOf()` 的完整序列（源码 `MoveCharacter` 的
        CreateEffect / Particle_Spawn / Joint_Create），收包那条 `playRemoteSkill`
        还停在早期的**单件**表 `SKILL_FX[skill]` —— 同一个技能「自己放一整套、
        别人放只有一件」，动作号也不看源码。
      - 现在 `playRemoteSkill` = `castOf(skill)` + `playCastParts()`，与本地完全一致；
        `SKILL_FX` 只剩「源码没覆盖的技能」兜底 + 延迟参数。
      - 实测：45 个技能的远端件数全部等于源码件数（`tools/skill-cast-probe.mjs` 10/10）。
- [x] **战士三个技能的专属动作**（源码 `Attack_WarriorBranch97k`）
      `41 霹雳回旋斩 → 61`、`42 雷霆裂闪 → 62`、`55 玄月斩 → 61`。
      这三条在 `PacketHandler_0x19` 的 switch 里**没有 case**，所以以前两边都落到
      「施法 82/83」—— 战士转圈斩 / 裂闪播的是法师举手，肉眼就能看出不对。
- [x] **`castOf().action === -1` 真的要挥砍**
      以前 `spec.action >= 0 ? spec.action : legacy.action ?? 82/83`，
      于是「源码不设动作、交给 `SetPlayerAttack`」的技能全在举手法师动作。
      现在 -1 走 `attackAction(animInput(), combo)`。

- [x] **坐下 / 倚靠 / 诺利亚浮空**（`Combat.cpp` MOVEMENT_OPERATE 分支）
      - 可交互物件表按 `Scene_EntityLifecycle.cpp::CreateObject` 的 World/Type switch 抄：
        洛兰 6/145/146/133、地下城 59/60、冰风谷 22/25/40/45/55/73/91、诺利亚 8/38、
        亚特兰蒂斯 39、塔坎 78。
      - 动作：坐 133（精灵 135）/ 倚靠 139（精灵 140）/ 浮空 137（精灵 138），
        同时上行 `0x18 action=108/109/110`（服务端 `PMSG_ACTION_RECV`：dir@3、action@4）。
      - 锚点：洛兰的 `133 = PoseBox01` 是**不渲染**的姿势锚点，`objects.ts` 新增
        `hiddenPlaced` 把它（以及 Light01-03）的位置留下来，否则坐不到椅子上。
      - 站着不动时保持姿势（`restAction`），一移动 / 攻击就站起来。
      - 探针 `tools/operate-probe.mjs`：74 个物件、命中→`lean` 光标、动作 139 保持、
        `0x18` 字节 `c1 06 18 04 6c 00`。
- [x] 修理模式光标（`Cursorrepair`）：商店开着 + 指向背包里**有损耗的装备** → 钻头光标
      （原版 `Cursor_Render.cpp:111` 的 `RepairEnable == 1|2`；我们的修理入口是右键，
      所以判据换成「商店开着 + 耐久 < item.bmd 上限」）。探针 `tools/repair-cursor-probe.mjs`。
- [x] 可交互物件光标（`Cursorleanagainst` / `Cursorsitdown`）
      - 判据照 `Cursor_Render.cpp:78`：World 0/1/2/3 的 Type 133/60/91/38 用
        `Cursorleanagainst`，其余用 `Cursorsitdown`。
      - 命中用「物件基座投影到屏幕、比 46px 屏距」（物件已按材质合批，没有单件 mesh 可射线）。
- [x] **转职 / 转职任务（`0xA3`）**
      - 0.97 的转职**不是独立系统**，是任务奖励的一种：服务端 `QuestReward.txt`
        的 `Type 2`（Index 201）→ `CQuestReward::InsertQuestReward` 的
        `QUEST_REWARD_CHANGE1` → 下发 `C1 06 A3 index[2] reward class`。
      - 转职任务数据在 `MuServer/Data/Quest/`：Quest.txt 两步
        （Step1 找帝王之书、Step2 断剑/精灵之泪/巫师灵魂碎片，NPC 235，Lv≥150），
        QuestReward.txt: Step1 → 200/+10 点；Step2 → 200/+10 点 **+ 201/转职**。
        客户端 `Quest.bmd` 读到的正是这两条（`npc 235`，对话 52/60）。
      - 客户端 `0xA3` 子类型：`0xC8` 只加点 / `0xC9` 转职 / `0xCA` 转职+加点 / `0xCB` 转职；
        职业号 `klass = ((b>>4) | (b&0x10)) >> 1`（低 3 位职业组、`>>3` 转职次数）。
      - 现在真的应用了：职业号覆盖 + 面板职业名 + 属性点 + 升级特效 + 音效。
      - `Text.bmd` 职业名改回原版公式 `20 + 4*(id>>3) + (id&7)` →
        一转后显示第 24/25/26 行（魔导师 / 骑士 / 圣射手）。
- [ ] **装备/技能门槛缺「第几转」这一维**：`item.bmd` 的 `RequireClass[DW..MG]`
      值是 0/1/2（2 = 需要一转），我们生成 `itemAttrs` 时压成了位掩码 → 一转装备的门槛丢了。
      要修得重新生成 `src/data/itemAttrs.ts`（保留 4 个职业列的原值 + `changeUp` 比较）。
- [x] **地面物品名**（原版 `RenderItemName`，`Item/Item_Display.cpp`）
      - 悬停就显示（`Target_Render` 的 `Sort=0`，画在鼠标上方 15px）
      - 按住 **Alt** 全显（`Sort=1`，画在物品自己头顶）
      - 颜色档位照源码：卓越绿 / +0 灰 / +1..2 白 / +3..4 橙 / +5..6 淡蓝 / +7+ 金，
        宝石-翅膀-恶魔广场-任务道具（槽 799/830/831/861/862/864/865..867/870）固定金
      - 后缀来自 `Text.bmd`：`[176] +技能`、`[177] +属性`、`[178] +幸运`（`0x20` 包的
        b1 bit7/bit2 之前根本没解出来，现已补 `skill` / `luck` 字段）
      - 金币显示 `金 12,345`（原版 `sprintf("%s %d")`）
      - 新文件 `src/ui/itemLabels.ts`（DOM 投影层，和头顶名字同一套）
- [x] **受击动作**（`playHurtAction()`，`remotes.onDamage` 里调用）
      - 怪物 / NPC → `MONSTER_ACTION.SHOCK`（= 4），520 ms 后回待机；
      - 玩家 → `0x85 / 0x87 / 0x8B / 0x8C` 随机（`PacketHandler_0x19` 的 `case 0x03`
        用 `SetPlayerStop(target)` 打断的就是这四种「受击/后仰」）；
      - 中途被别的动作顶掉就不硬塞 STOP（否则走路会被按回站立）；
      - 模型里没这组动作就跳过（靶子那种怪物模型没有玩家受击动作）。
      - 之前只飘伤害数字 + 打击音，被打的怪**动作不变**，像在隔空扣血。
- [x] **玄月斩（55）补件**（`SKILL_REFINE[55]`，源码 `AttackStage` 的 skill==55）
      - `1267`（`Effect_Create case 0x4F3`）寿命 **1 帧** → 换成 0.55 s 的爆闪才看得见；
      - `1168`（`case 0x490`）寿命 30 帧、`goto LABEL_00463e3d` = **从施法者连到目标的
        一道线**（不是模型）→ 用 `JointEnergy01` 的 beam 表现；
      - 原来的 `Tail.bmd` 落在**目标**位置（像目标自己发光），已 `patch` 成「身前挥砍」。
      - 顺带修了 `castOf()` 的顺序坑：兜底件（`fromFallback`）必须排在 `SKILL_REFINE`
        **之前**，否则 refine 的 add 把 `parts` 填非空后兜底件会被整份丢掉（55 就只剩 2 件）。
- [x] **冰封箭（51）命中冰晶**（`spawnIceArrowHit()`）
      源码 `case 0x33`：`CreateEffect(190, 目标, sub=1)` + 角度 +180° 再 `sub=2`
      —— 两片 `Skill/Ice01.bmd` 冰晶**包住被打的人**（190 就是 Ice01）。
      箭要飞一会儿才到，所以延迟 300 ms 挂在落点上，本地沙盘和收包两条路都调。
- [x] **技能表全面对照 + 首批修正**（`docs/SKILL_AUDIT.md`）
      - 全表：每个技能的「动作 / 源码创建的特效（type→文件@锚点）/ 源码运动 / 我们现在的实现 / 判定」。
        源码出处 `SecondPassword.cpp` 的技能 switch（case 号 = `Skill.txt` 编号，
        作者手写的 `// Twister`、`// Defense` 注释是错的）。
      - **地面圆形光斑全部去掉**：`effects.spawn` 的 `glow` 从默认开改成默认关
        （原版是 `AddTerrainLight` 提亮地形顶点，不是贴圆片）。调试口 `__MU_DEBUG__.glowCount()`。
      - **9 黑龙波**：源码 `case 9` = 4 × `Joint_Create(1253)`（4 方向 × 头 scale80 / 尾 scale20），
        头每帧 `CreateEffect(205)` = `Skill/Laser01.bmd`。新增 `CastSpec.special = 'dragon-wave'`
        → `castDragonWave()`：4 条 Laser01 贴地游动 + 每 70 ms 留一段 JointSpirit 光带 + 渐暗。
        以前是「8 个静态贴图点贴在施法者身上」。
      - **48 生命之光**：源码 `1264×1 + 1253×36`，生成表把循环次数套到了所有件上 →
        36 个法阵叠一起。现改成法阵 ×1 + 竖光 ×36。
      - **27 守护之光**：关节 10 → 2（源码 ×2）。
      - **12 极光**：补弹体（源码 1210）+ 拖尾 30 段（源码 1176）；拖尾改成铺满弹道。
      - 探针 `tools/skill-audit-probe.mjs` 11/11。
- [ ] **技能特效的逐帧时序**：`SKILL_CASTS` 抓的是 `MoveCharacter` 的「一次触发放什么」，
      而真正的分阶段在 `AttackStage`（`c+757` 每帧 +1）。43/47/55/56 已按源码的
      `stage==N` 拆开；其它技能若要更细的时序，得让 `extract-skill-fx.mjs` 也解析
      `AttackStage` 的 stage 条件。
- [x] ~~掉落物长按连续拾取（`Text.bmd 136/137` 有说明）~~ —— **用户要求略过（2026-10-27）**
- [x] **服务器传送界面（`0x30 result=5`）**
      - 服务端 `CNpcTalk::NpcServerTransfer`（`NpcTalk.cpp:137`，NPC **234**）回 result=5；
        客户端 `Net_Process.cpp:5226` 置 `g_bServerDivisionEnable`，`RenderServerDivision`
        （`HUD_Pass6.cpp:323`）每帧画。
      - 布局逐坐标抄：底板 `RenderInventoryInterface(450,0,1)`、标题 `GlobalText[462..469]`
        8 行居中在 545（y=50 起每行 20）、复选框 `accept_box01/02` (475,240) 16×16、
        确定/取消 `Message_box` (485,320)/(485,350) 120×24。
      - 勾选 → 确定 → 二次确认（原版 `ShowCheckBox(1,448,151)`）→ 才算同意；
        取消/关闭/确认后都发 `C1 03 31` 释放 `Interface.use`。
      - 文件 `src/ui/serverDivisionPanel.ts`；探针 `tools/server-division-probe.mjs`。
        本机 `MonsterSetBase.txt` 没有 234 号 NPC，用 `__MU_APP__.serverDivision(true)` 注入验证。
- [x] **`F3/E3` `F3/E4` `F3/E5` 三条协议分支**（旧记录的内容是错的）
      - ⚠️ 以前记成「任务表 / 技能表 / 大师树」，实际看服务端组包函数是：
        `F3/E3` 堆叠上限（`CItemStack::GCItemStackListSend`，12B/条）、
        `F3/E4` 固定价格（`CItemValue::GCItemValueListSend`，16B/条）、
        `F3/E5` `/move` 列表（`CMove::GCMoveListSend`，48B/条）。
      - **`E5` 的 count 前多一个 `PKLimitFree` 字节**（`Move.cpp:311`），按 `[5]` 读会得到 0。
      - `data/serverTables.ts` 存三张表；`F3/E5` 用 `applyServerMoveList()` 覆盖本地 warp
        表的门槛/价格/`canMove`（服务端按 VIP 账号等级重算过）。
      - 背包 tooltip 新增「售价/价格 X zen」「可堆叠 N」两行。
      - 探针 `tools/server-tables-probe.mjs`（E3 10 / E4 53 / E5 23 条）。
- [x] **接取/提交任务后按新状态重开对话**（原版 `Net_Process.cpp:7213/7223`）
      - quest.bmd 每个职业段的四段文本在 `+10/+12/+14/+16`（short[5..8]）：
        开始 / **进行中·没齐** / **进行中·齐了** / 完成，对应 `CSQuest::CheckQuestState`
        的 `FindQuestContext(act, 0|1|2|3)` 四个分支。
        ⚠️ **1 和 2 别搞反**：源码 `CheckActCondition` 在「物品没齐」时才走 `(act, 1)`，
        齐了反而返回 0 让 `CheckQuestState` 走 `(act, 2)`。实测任务 0 = 52/54/55/56，
        54「去找回帝王之书吧」、55「您真的找回了帝王之书」。
      - `questTextFor(info, state, hasItems)` 负责挑；`queueNpcGreeting` 按当前状态显示；
        在对话窗里点「接受/提交」后（`pendingQuestDialogRefresh`）等 `0xA1/0xA2`
        回来就 `reopenQuestDialog()` 按新状态重开 —— 接完任务不会再看到开场白。
      - **任务物品条件**（`quest.bmd` 职业段 +2/+3/+4）：`Type = (+2)<<5 | (+3)`，数量 = `+4`。
        任务 0 → 471「帝王之书」；任务 1 → 472/473/474「断魂之剑/精灵之泪/先知之魂」。
        `main.ts::questItemsSatisfied()` 扫背包（`slot >= INVENTORY_WEAR_SIZE`）判断齐没齐，
        对应原版 `CSQuest_FindQuestItemsInInven`（`Runtime_Medium.cpp:689`）。
      - 职业段选择：`pickAct()` 按 `playerClassId()` 取对应段（任务 1 三段是 60/64/67）。
      - 探针 `tools/quest-state-probe.mjs`（状态→对话映射 + 接取后重开）、
        `tools/quest-items-probe.mjs`（塞/清任务物品，51→54/55、61/62 双向验）。
- [x] **安全区不能攻击 / 不能放技能**（`Combat.cpp::Attack()` IDA L1280/L1314）
      - 门禁抽成 `safeZoneBlocksCombat(skillId, x?, y?)`：非事件地图（0..10 / 17+）的安全区
        **什么都不能打**；事件地图（11..16）只放行 16/26/27/28/48（生命/守护之光、攻防、治疗）。
      - 接在 `tryAttack()`（普攻/连击/自动攻击）和 `useSelectedSkill()`（右键施法/技能栏/数字键/
        走近补发）两处，挡在动作和发包之前；离线沙盘 `sandbox.on` 不拦。
      - 提示「安全区内不能攻击或施放技能」1.5s 节流（原版静默 return）。
      - 调试口 `__MU_APP__.safeZoneGate(skillId, x, y)`；探针 `tools/safezone-probe.mjs` PASS。
      - 事件地图那条（11..16 放行辅助技能）代码已写但**行为未验**（等级不够进不去）。
- [x] **任务 NPC「多余对话框」**（`CSQuest::ShowQuestNpcWindow` / `Net_Process.cpp:7213/7223`）
      - 三处根因：① 任何 NPC 都兜底弹 `Dialog.bmd[0]`；② 守卫漏了金弓/事件窗/交易/战盟/任务面板；
        ③ 900ms 盲等和 `0x30` 回包赛跑。现在：没任务的 NPC 不弹、`anyNpcWindowOpen()` 全覆盖、
        `0x30` 一到就 `cancelNpcGreeting()`。
      - 顺带修：走到 NPC 面前才说话（`updateNpcTalk`）以前不会补任务对话，现在会。
      - 探针 `tools/npc-dialog-probe.mjs`：6 个 NPC 全部「对话窗没开」+ 235 的任务对话正常渲染。

## D. 环境

- [ ] `GameServer` 偶发 `F1/01` 登录超时（半死会话，重启 GameServer.exe 可解）

---

## 进度

- 2026-10-25：完成 A 的前 6 项、B 的收顶/占位模型/水下姿势。
- 2026-10-25（续）：完成 B-6（水面网格 / UV 滚动 / 顶点波动 / 水下滤镜）。
- 2026-10-25（续2）：诺利亚蝴蝶 `Object4/Object38.bmd` 改为加法混合（点名表）。
- 2026-10-25（续3）：改成**贴图混合自动识别**（`modelBlend`），名单清空。
- 2026-10-25（续4）：`Object8/Object41`（亚特兰蒂斯蝴蝶）走逃生口点名加色；
  新增 `__MU_APP__.objectModels()`（顶点数/包围盒）用于识别「小面片」。
- 2026-10-25（续5）：对照 `muonline-bmd-viewer` 修「暗图偏闷」—— 地形按图定标提亮
  + 物件顶点光照改成 viewer 的 ambient/sun 模型。
- 2026-10-25（续6）：接通转职（`0xA3` 0xC8/0xC9/0xCA/0xCB + 职业名转职列）。
  下一步建议：A-7（聊天屏蔽词）→ B-8（加载画面）→ C-1（坐下/倚靠）。
- 2026-10-27：登录两步（选线路 + 账号密码）、仓库/商店拖拽、安全区门禁、NPC 对话窗去重。
  完整未实现清单见 `docs/migration/known-issues.md`。
- 2026-10-27（续）：中文名牌（`NPCName.txt`）、任务对话按状态重开、修理光标。
  下一步建议：C-1/C-2（坐下/倚靠 + 世界物件命中光标）→ A-7（聊天屏蔽词）→ B-2（加载画面）。
- 2026-10-27（续2）：坐下/倚靠/诺利亚浮空 + 可交互物件光标；`Filter.bmd` 经确认是空文件，移出待办。
  下一步建议（B-3 相机穿墙按用户要求略过）：C-11 任务物品对话已做 → 剩下的见
  `docs/migration/known-issues.md`（B-3 相机穿墙 / C-6 长按拾取 / C-7 服务器传送界面 / C-9 大师树）。
- 2026-10-27（续3）：启动画面 + 读条画面（原版 `Scene_Intro` / `Scene_Loading` 位图）、
  任务物品条件与「可以交了」那档对话（顺带修正 texts[1]/[2] 的语义映射）。
- 2026-10-27（续4）：去掉空格键普攻、选角 ESC 菜单（返回线路选择/选项/取消）、
  「返回登录」改走 leaveGame、服务器传送窗口（C7）、服务端三张表（C9）。
  B-3（相机穿墙）/ C-6（长按拾取）按用户要求略过。
- 2026-10-27（续5）：硬编码文案（A3）全部改成 `Text.bmd`；小地图底图（B1）用户已自行完成，移出清单。
  `docs/migration/known-issues.md` 的待办清单至此清空。
- 2026-10-27（续6）：物品悬停 3D 旋转（`RenderObjectScreen` 的 `Select==1` 分支）、
  仓库底部三个按钮（`refreshText` 顶掉 `<img>`）、仓库金币条被底盘盖住、
  物品名改走 `chs/item.bmd`（512 条中文）。详见 `FEATURES.md` 阶段 CE。
- 2026-10-27（续7）：悬停旋转降到 225°/秒（帧数 36）；跨格拖动（ghost 按物品槽位取图）；
  tooltip 改成按物品矩形避让 + 补职业使用限制（`GlobalText[61]` + `[20..26]`，
  读 `item.bmd` 的 `RequireClass`）；账号面板「离线演示」换成「结束游戏」回线路选择；
  新增 `/demo` 离线演示页（线路→登录→选角→进游戏，全程不连服务端）。详见阶段 CF。
- 2026-10-27（续8）：`/demo` 补上 ESC 菜单（判据从 `loggedIn && session` 改成
  `inGameWorld()`，演示靠 `sandbox.on`）；`leaveGame` 演示态复位沙盘、
  「回到选择角色画面」不再卡在「正在刷新角色列表…」；ESC 菜单文案改成表读完后
  `refreshText()` 覆盖（原来一直是构造时的硬编码兜底串）。详见阶段 CG。
- 2026-10-27（续9）：修背包 item tooltip 触发区域 —— hover 还是按槽位直查
  （`items.get(WEAR+i)`），只有物品左上格能弹；改成和仓库同一套矩形覆盖
  （`itemAt`），图标旋转也按 `item.slot` 取。探针新增 3 条（含反证）。详见阶段 CH。
- 2026-10-27（续10）：资源目录收到 `dist/Data`（`publicDir:false` + `localAssets()` 中间件，
  构建 28s→4s）；新增 `core/base.ts::assetUrl()` 统一拼 base，修复 GH Pages 子路径下
  `/Data/...` 全部 404；`tools/serve-gh.mjs` 本地仿真 Pages；只推部署文件到
  yyf127/mu-three（排除 600MB 无关资源）。详见 `docs/DEPLOY.md` 与阶段 CI。
