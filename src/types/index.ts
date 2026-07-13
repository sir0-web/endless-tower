export type TileType = 'floor' | 'wall' | 'stairs' | 'trap' | 'mud' | 'spring' | 'pitfall'

export interface Position {
  x: number
  y: number
}

export type EquipSlot = 'weapon' | 'armor' | 'shoulder' | 'boots' | 'accessory1' | 'accessory2' | 'charm'

export type WeaponKind = 'melee' | 'bow'

export type AllocStat = 'str' | 'agi' | 'dex' | 'int' | 'vit' | 'luk'

export type SpellType = 'firebolt' | 'blessing' | 'lightblessing' | 'quagmire' | 'meteostorm'

export interface MinimapData {
  tiles: TileType[][]
  playerPos: Position
  enemies: { x: number; y: number; isBoss: boolean }[]
  items: { x: number; y: number }[]
}

export interface PendingEquip {
  newItem: Item
  currentItem: Item | null
}

export interface Item {
  id: string
  name: string
  type: 'heal' | 'equip' | 'spell'
  position: Position
  // 回復アイテム
  healAmount?: number
  staminaPercent?: number
  healPercent?: number   // 最大HPに対する割合回復（灰ポーション。healAmountを下限として併用）
  // 装備アイテム
  equipSlot?: EquipSlot
  // 武器の種別（weaponスロットのみ意味を持つ）。未指定は近接武器扱い。
  weaponKind?: WeaponKind
  hpBonus?: number
  strBonus?: number
  agiBonus?: number
  dexBonus?: number
  intBonus?: number
  vitBonus?: number
  lukBonus?: number
  // 魔法の書
  spellType?: SpellType
  // 精錬値（装備品のみ。精錬チャレンジで増減する）
  refineLevel?: number
  // ロック（装備品のみ）。ONの間は精錬の生贄に選べず、捨てることもできない誤操作防止
  locked?: boolean
  // 女神のコイン：使うとスロットを1回回す消費アイテム
  coin?: boolean
  // 羽アイテム：fly=同じ階の階段そばへワープ / butterfly=今いる階を再生成
  wing?: 'fly' | 'butterfly'
}

export type FacilityKind = 'refine' | 'shadow' | 'spellbook' | 'merchant'

// いいね報酬（サーバー抽選）。potion時のみ reward_name に色名が入る。
export interface LikeReward {
  reward_type: 'potion' | 'coin' | 'point'
  reward_name?: string | null
  from_name?: string | null
}

export interface RefineResult { success: boolean; itemName: string; refineLevel: number }
export interface RefineAttempt { success: boolean; before: number; after: number }
export interface BulkRefineResult { itemName: string; attempts: RefineAttempt[] }
export interface ShadowResult { success: boolean }
export interface BulkShadowResult { attempts: ShadowResult[] }
export interface SpellbookResult { success: boolean; lostName: string; gainedName?: string }

export interface Equipment {
  weapon?: Item
  armor?: Item
  shoulder?: Item
  boots?: Item
  accessory1?: Item
  accessory2?: Item
  charm?: Item
}

/** 装備中の武器種別を判定する。未装備・未指定は近接(melee)扱い。 */
export function weaponKindOf(item?: Item | null): WeaponKind {
  return item?.weaponKind === 'bow' ? 'bow' : 'melee'
}

export interface Player {
  position: Position
  hp: number
  maxHp: number
  level: number
  exp: number
  floor: number
  stamina: number
  maxStamina: number
  poisoned: boolean
  poisonTurns: number
  mudTurns: number
  mudSkipNext: boolean
  equipment: Equipment
  // 新ステータス
  str: number
  agi: number
  dex: number
  int: number
  vit: number
  luk: number
  statPoints: number
  // 生涯累計で獲得したステータスポイント（消費しても減らない）。ドッペルゲンガー撃破報酬の元データ。
  totalStatPointsEarned?: number
  // 自己最高到達階。これ未満のフロア（蝶の羽で戻った踏破済み階）はXP大幅減＆ドロップなし
  maxFloorReached?: number
  // このプレイでのジャックポット当選回数（ランキング表示用。セーブに永続化）
  jackpotWins?: number
  // エフェクト
  healingTurns: number
  // ブレッシングの書：残りターン数と、付与した分のみを記録（レベルアップ等の変動と区別するため）
  blessingTurns: number
  blessingBonus: { str: number; int: number; dex: number; agi: number }
}

export interface Enemy {
  id: string
  position: Position
  hp: number
  maxHp: number
  attack: number
  defense: number
  str: number
  vit: number
  agi: number
  luk: number
  name: string
  isBoss?: boolean
  isSkulporin?: boolean
  isDoppelganger?: boolean
  // ドッペルゲンガー撃破時にプレイヤーへ付与するステータスポイント（生前の生涯累計獲得量）
  doppelStatReward?: number
  slowedTurns: number
  // ボスの大技テレグラフ：>0なら「溜め中」（次ターンに大技が来る。離れれば空振りする）
  chargeTurns?: number
  // 大技のクールダウン残りターン（連続チャージによる遠距離ハメ狩り防止）
  chargeCd?: number
  // 敵の「性格」：突進兵(bomber)=自爆／支配者(summoner)=召喚／弱虫(coward)=逃走+強化オーラ
  personality?: EnemyPersonality
  // 突進兵：自爆までの残りターン（プレイヤー発見時に3で点火。未発見はundefined）
  fuseCount?: number
  // 支配者：召喚までの残りターン／残り召喚回数
  summonCount?: number
  summonsLeft?: number
  // 支配者に召喚された雑魚（経験値・ドロップなし＝召喚無限狩り対策）
  isSummoned?: boolean
}

export type EnemyPersonality = 'bomber' | 'summoner' | 'coward'

export interface GameState {
  player: Player
  enemies: Enemy[]
  items: Item[]
  spells: Item[]
  heals: Item[]
  bag: Item[]
  map: TileType[][]
  turn: number
  messages: string[]
  areaBossFloors: Record<number, string>
  floorType: 'normal' | 'lucky' | 'chaos'
  driedSprings: string[]
  // 瘴気が強いフロア（デバフ）：視界が通常より2マス狭くなり紫フォグがかかる。normalフロアでのみ抽選
  miasmaFloor: boolean
}

export interface WindowGameState {
  hp: number
  maxHp: number
  level: number
  exp: number
  floor: number
  stamina: number
  maxStamina: number
  poisoned: boolean
  messages: string[]
  equipment: Equipment
  str: number; agi: number; dex: number
  int: number; vit: number; luk: number
  statPoints: number
  spells: Item[]
  heals: Item[]
  bag: Item[]
  pendingEquip: PendingEquip | null
  minimapData: MinimapData | null
  floorType: 'normal' | 'lucky' | 'chaos'
  /** 弓装備中かつ射程内(視線あり)に敵がいるか。🏹ボタンの薄表示切替に使う */
  bowTargetInRange: boolean
}

declare global {
  interface Window {
    gameState: WindowGameState
    allocateStat?: (stat: AllocStat) => void
    useSpell?: (itemId: string) => void
    useHeal?: (itemId: string) => void
    resolveEquip?: (equip: boolean) => void
    equipFromBag?: (itemId: string) => void
    discardFromBag?: (itemId: string) => void
    toggleLockItem?: (itemId: string) => void
    isGameSceneActive?: boolean
    onEnemyKilled?: () => void
    applySlotEffect?: (result: string) => void
    playBonusVideo?: (result: string) => void
    spinSlotOnce?: () => void
    showSlotAnnouncement?: (result: string, sub?: string) => void
    onSlotEffectApplied?: () => void
    // アルカナ演出中のスロット自動消化ホールド／再開（SlotMachineが提供）
    holdSlotSpins?: () => void
    releaseSlotSpins?: () => void
    showArcanaRoulette?: (onComplete: () => void) => void
    applyArcanaResult?: (points: number) => void
    gameMove?: (key: string) => void
    gameAttack?: () => void
    gameSwapWeapon?: () => void
    saveGame?: () => void
    warpFloor?: (floor: number) => void
    giveEquip?: (name?: string) => void
    debugSkulporin?: () => void
    // ── グローバルUI ──
    showHowToPlay?: () => void
    showNews?: () => void
    checkAnnouncementGate?: (onProceed: () => void) => void
    showMailBox?: () => void
    showGameToast?: (message: string) => void
    addWorldLogMessage?: (text: string) => void
    showResumeConfirm?: (onYes: () => void, onNo: () => void) => void
    showDoppelgangerConfirm?: (onYes: () => void, onNo: () => void) => void
    showReport?: () => void
    triggerSkulporinCheck?: () => void
    showEventMessage?: (message: string, color?: string, small?: boolean) => void
    showAutoSaveToast?: () => void
    showSkulporinReward?: (
      equips: Item[],
      spells: Item[],
      onAccept: () => void,
    ) => void
    // ── いいね機能：報酬付与（いいねした本人側。messageは「XXさんにいいねしました」等）──
    grantReward?: (reward: LikeReward, message: string) => void
    // ── イベントフロア施設 ──
    openFacility?: (kind: FacilityKind) => void
    runRefineChallenge?: (slot: EquipSlot, sacrificeId: string) => RefineResult | null
    runBulkRefineChallenge?: (slot: EquipSlot, sacrificeIds: string[]) => BulkRefineResult | null
    runShadowChallenge?: () => ShadowResult | null
    runBulkShadowChallenge?: (times: number) => BulkShadowResult | null
    runSpellbookChallenge?: (spellId: string) => SpellbookResult | null
    // ── 行商人：女神のコインで羽を購入（所持上限はWING_ITEMS.holdMax）──
    buyMerchantItem?: (key: 'fly' | 'butterfly') => { ok: boolean; reason?: 'coin' | 'limit' }
  }
}
