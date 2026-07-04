export type TileType = 'floor' | 'wall' | 'stairs' | 'trap' | 'mud' | 'spring' | 'pitfall'

export interface Position {
  x: number
  y: number
}

export type EquipSlot = 'weapon' | 'armor' | 'shoulder' | 'boots' | 'accessory1' | 'accessory2' | 'charm'

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
export interface ShadowResult { success: boolean }
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
  slowedTurns: number
}

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
    saveGame?: () => void
    warpFloor?: (floor: number) => void
    giveEquip?: (name?: string) => void
    debugSkulporin?: () => void
    // ── グローバルUI ──
    showHowToPlay?: () => void
    showNews?: () => void
    showMailBox?: () => void
    showGameToast?: (message: string) => void
    addWorldLogMessage?: (text: string) => void
    showResumeConfirm?: (onYes: () => void, onNo: () => void) => void
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
    runShadowChallenge?: () => ShadowResult | null
    runSpellbookChallenge?: (spellId: string) => SpellbookResult | null
    // ── 行商人：女神のコインで羽を購入（所持上限はWING_ITEMS.holdMax）──
    buyMerchantItem?: (key: 'fly' | 'butterfly') => { ok: boolean; reason?: 'coin' | 'limit' }
  }
}
