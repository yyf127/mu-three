/**
 * 怪物音效表 —— **自动生成**，别手改。改数据源请跑：
 *
 *     node tools/gen-monster-sounds.mjs
 *
 * 数据源：`Mu-97k-Client-Source-main/src/Monster/Monster_Data.cpp` 的
 * `OpenMonsterModel`（按怪物 type 挂 5 条 `LoadWaveFile`）。
 *
 * 索引是**怪物 type**，也就是 `Monster.txt` 的 `Class`、视野包里的 `type`。
 * 覆盖 47 个 type（0..59）。
 *
 * 原版这些音效**没有固定 id**（每次进图重新分配 120..419），所以表里存文件名，
 * 播放走 `sfxFile()`。
 */

export interface MonsterSoundSet {
  /** 待机叫声（原版随机播，两个变体） */
  idle: string[];
  /** 攻击时（两个变体） */
  attack: string[];
  /** 死亡时；个别 type 没有 */
  die: string | null;
}

export const MONSTER_SOUNDS: Record<number, MonsterSoundSet> = {
  0: { idle: ['mBull1.wav', 'mBull2.wav'], attack: ['mBullAttack1.wav', 'mBullAttack2.wav'], die: 'mBullDie.wav' },
  1: { idle: ['mHound1.wav', 'mHound2.wav'], attack: ['mHoundAttack1.wav', 'mHoundAttack2.wav'], die: 'mHoundDie.wav' },
  2: { idle: ['mBudge1.wav'], attack: ['mBudgeAttack1.wav'], die: 'mBudgeDie.wav' },
  3: { idle: ['mDarkKnight1.wav', 'mDarkKnight2.wav'], attack: ['mDarkKnightAttack1.wav', 'mDarkKnightAttack2.wav'], die: 'mDarkKnightDie.wav' },
  4: { idle: ['mWizard1.wav', 'mWizard2.wav'], attack: ['mWizardAttack1.wav', 'mWizardAttack2.wav'], die: 'mWizardDie.wav' },
  5: { idle: ['mGiant1.wav', 'mGiant2.wav'], attack: ['mGiantAttack1.wav', 'mGiantAttack2.wav'], die: 'mGiantDie.wav' },
  6: { idle: ['mLarva1.wav', 'mLarva2.wav'], attack: [], die: null },
  7: { idle: ['mGhost1.wav', 'mGhost2.wav'], attack: ['mGhostAttack1.wav', 'mGhostAttack2.wav'], die: 'mGhostDie.wav' },
  8: { idle: ['mHellSpider1.wav'], attack: ['mHellSpiderAttack1.wav'], die: 'mHellSpiderDie.wav' },
  9: { idle: ['mSpider1.wav'], attack: [], die: null },
  10: { idle: ['mOgre1.wav', 'mOgre2.wav'], attack: ['mOgreAttack1.wav', 'mOgreAttack2.wav'], die: 'mOgreDie.wav' },
  11: { idle: ['mGorgon1.wav', 'mGorgon2.wav'], attack: ['mGorgonAttack1.wav', 'mGorgonAttack2.wav'], die: 'mGorgonDie.wav' },
  12: { idle: ['mYeti1.wav', 'mYeti2.wav'], attack: ['mYetiAttack1.wav'], die: 'mYetiDie.wav' },
  13: { idle: ['mYeti1.wav', 'mYeti2.wav'], attack: ['mYetiAttack1.wav'], die: 'mYetiDie.wav' },
  14: { idle: [], attack: ['mAssassinAttack1.wav', 'mAssassinAttack2.wav'], die: 'mAssassinDie.wav' },
  15: { idle: ['mIceMonster1.wav', 'mIceMonster2.wav'], attack: [], die: 'mIceMonsterDie.wav' },
  16: { idle: ['mHomord1.wav', 'mHomord2.wav'], attack: ['mHomordAttack1.wav'], die: 'mHomordDie.wav' },
  17: { idle: ['mWorm1.wav', 'mWorm2.wav'], attack: [], die: 'mWormDie.wav' },
  18: { idle: ['mIceQueen1.wav', 'mIceQueen2.wav'], attack: ['mIceQueenAttack1.wav', 'mIceQueenAttack2.wav'], die: 'mIceQueenDie.wav' },
  19: { idle: ['mGoblin1.wav', 'mGoblin2.wav'], attack: ['mGoblinAttack1.wav', 'mGoblinAttack2.wav'], die: 'mGoblinDie.wav' },
  20: { idle: ['mScorpion1.wav', 'mScorpion2.wav'], attack: ['mScorpionAttack1.wav', 'mScorpionAttack2.wav'], die: 'mScorpionDie.wav' },
  21: { idle: ['mBeetle1.wav'], attack: ['mBeetleAttack1.wav'], die: 'mBeetleDie.wav' },
  22: { idle: ['mHunter1.wav', 'mHunter2.wav'], attack: ['mHunterAttack1.wav', 'mHunterAttack2.wav'], die: 'mHunterDie.wav' },
  23: { idle: ['mWoodMon1.wav', 'mWoodMon2.wav'], attack: ['mWoodMonAttack1.wav', 'mWoodMonAttack2.wav'], die: 'mWoodMonDie.wav' },
  24: { idle: ['mArgon1.wav', 'mArgon2.wav'], attack: ['mArgonAttack1.wav', 'mArgonAttack2.wav'], die: 'mArgonDie.wav' },
  25: { idle: ['mGolem1.wav', 'mGolem2.wav'], attack: ['mGolemAttack1.wav', 'mGolemAttack2.wav'], die: 'mGolemDie.wav' },
  26: { idle: ['mYeti1.wav'], attack: ['mSatanAttack1.wav'], die: 'mYetiDie.wav' },
  27: { idle: ['mBalrog1.wav', 'mBalrog2.wav'], attack: ['mWizardAttack2.wav', 'mGorgonAttack2.wav'], die: 'mBalrogDie.wav' },
  28: { idle: ['mShadow1.wav', 'mShadow2.wav'], attack: ['mShadowAttack1.wav', 'mShadowAttack2.wav'], die: 'mShadowDie.wav' },
  29: { idle: ['mDarkKnight1.wav', 'mDarkKnight2.wav'], attack: ['mDarkKnightAttack1.wav', 'mDarkKnightAttack2.wav'], die: 'mDarkKnightDie.wav' },
  30: { idle: ['mBull1.wav', 'mBull2.wav'], attack: ['mBullAttack1.wav', 'mBullAttack2.wav'], die: 'mBullDie.wav' },
  31: { idle: ['mYeti1.wav'], attack: ['mBullAttack1.wav'], die: 'mYetiDie.wav' },
  32: { idle: ['mBali1.wav', 'mBali2.wav'], attack: ['mBaliAttack1.wav', 'mBaliAttack2.wav'], die: null },
  33: { idle: ['mBahamut1.wav', 'mYeti1.wav'], attack: [], die: null },
  34: { idle: ['mBepar1.wav', 'mBepar2.wav', 'mBalrog1.wav'], attack: [], die: null },
  35: { idle: ['mValkyrie1.wav'], attack: ['mBaliAttack2.wav'], die: 'mValkyrieDie.wav' },
  36: { idle: ['mLizardKing1.wav', 'mLizardKing2.wav'], attack: [], die: 'mGorgonDie.wav' },
  37: { idle: ['mHydra1.wav'], attack: ['mHydraAttack1.wav'], die: null },
  39: { idle: ['mDarkKnight1.wav', 'mDarkKnight2.wav'], attack: ['mDarkKnightAttack1.wav', 'mDarkKnightAttack2.wav'], die: 'mDarkKnightDie.wav' },
  40: { idle: ['mLizardKing1.wav', 'mLizardKing2.wav'], attack: [], die: 'mGorgonDie.wav' },
  41: { idle: ['mBull1.wav', 'mBull2.wav'], attack: ['mBullAttack1.wav', 'mBullAttack2.wav'], die: 'mBullDie.wav' },
  42: { idle: ['mBull1.wav', 'mBull2.wav'], attack: ['mBullAttack1.wav', 'mBullAttack2.wav'], die: 'mBullDie.wav' },
  44: { idle: ['mBull1.wav', 'mBull2.wav'], attack: ['mBullAttack1.wav', 'mBullAttack2.wav'], die: 'mBullDie.wav' },
  46: { idle: [], attack: [], die: 'mBullDie.wav' },
  47: { idle: ['mHunter2.wav'], attack: [], die: 'mBullDie.wav' },
  58: { idle: ['mHunter2.wav'], attack: [], die: null },
  59: { idle: ['mHunter2.wav'], attack: [], die: null },
};

/** type → 音效集；没登记返回 null（客户端会用默认静音，不报错） */
export function monsterSoundSet(cls: number): MonsterSoundSet | null {
  return MONSTER_SOUNDS[cls] ?? null;
}
