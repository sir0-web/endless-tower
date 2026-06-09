export type TileType = 'floor' | 'wall' | 'stairs' | 'trap'

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
}

export type FacilityKind = 'refine' | 'shadow' | 'spellbook'

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
  equipment: Equipment
  // 新ステータス
  str: number
  agi: number
  dex: number
  int: number
  vit: number
  luk: number
  statPoints: number
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
    showSlotAnnouncement?: (result: string, sub?: string) => void
    onSlotEffectApplied?: () => void
    gameMove?: (key: string) => void
    saveGame?: () => void
    warpFloor?: (floor: number) => void
    // ── グローバルUI ──
    showGameToast?: (message: string) => void
    showResumeConfirm?: (onYes: () => void, onNo: () => void) => void
    showEventMessage?: (message: string, color?: string) => void
    // ── イベントフロア施設 ──
    openFacility?: (kind: FacilityKind) => void
    runRefineChallenge?: (slot: EquipSlot, sacrificeId: string) => RefineResult | null
    runShadowChallenge?: () => ShadowResult | null
    runSpellbookChallenge?: (spellId: string) => SpellbookResult | null
  }
}
