export type TileType = 'floor' | 'wall' | 'stairs' | 'trap' | 'mud' | 'spring' | 'pitfall' | 'jail'

// あるかなひろばの住人（救済して増やす）。既存4種＋新規3種。
export type NpcKind = 'refine' | 'shadow' | 'spellbook' | 'merchant' | 'miner' | 'junk' | 'toolshop'

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

export type FacilityKind = 'refine' | 'shadow' | 'spellbook' | 'merchant' | 'miner' | 'junk' | 'toolshop'

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
  // 暗闇：残りターン数。0より大きい間、プレイヤーの攻撃命中率が半減する
  darkTurns: number
  // 混乱：残りターン数。0より大きい間、移動・攻撃の入力がランダムに乱される
  confuseTurns: number
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
  // うちドッペルゲンガー撃破で得た分。死亡時の登録では継承対象から除外する
  // （継承分を再継承させると倒すたびに雪だるま式に膨らむ複利インフレになるため）。
  doppelPointsGained?: number
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
  // 遠距離型：射程内(2〜4マス)かつ視線が通ればプレイヤーへ矢を放つ（アーチャースケルトン等）
  isRanged?: boolean
  // 遠距離型：初回の「狙われた」警告を出したか（1体につき1回だけ⚠ログを出すためのフラグ）
  aimNotified?: boolean
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
  // あるかなひろばで救済済みの住人（周回ごとにリセット。プラザに登場＆機能する）
  rescuedNpcs: NpcKind[]
  // さがし人看板：初回・未読の更新があるとtrue（看板の上に「！」を表示）。看板を開くとfalseになる
  signboardUnread: boolean
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
    allocateStatBulk?: (stat: AllocStat, amount: number) => void
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
    forceRescue?: (pattern?: 1 | 2 | 3) => void
    rescueAllNpcs?: () => void
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
    // ── 新NPC（あるかなひろば救済で増える）──
    // がらくた屋：いらない装備を女神のコインに換金
    runJunkConvert?: (itemId: string) => { ok: boolean; coins?: number } | null
    // どうぐや：女神のコインで回復薬を購入
    getToolShopItems?: () => { key: string; name: string; icon: string; cost: number; desc: string }[]
    buyToolItem?: (key: string) => { ok: boolean; reason?: 'coin' | 'limit' } | null
    // 牢屋：柵の開錠（3手段）。失敗しても資源は消費、成功で解放
    getJailUnlockState?: () => { npcName: string; bagEquips: { id: string; name: string }[]; coins: number; statPoints: number } | null
    tryJailUnlock?: (method: 'equip' | 'coin' | 'point', sacrificeId?: string) => { ok: boolean; message: string; broke?: boolean } | null
    // 広場の掲示板：捜し人（住人救済）一覧
    getRescueList?: () => { person: string; role: string; rescued: boolean }[]
    // さがし人：発生告知・救出完了の演出モーダルを閉じる（OK操作で操作ロック解除）
    closeRescueNotice?: () => void
    // げーせん：ミニゲームモーダルを閉じる（操作ロック解除）
    closeArcade?: () => void
  }
}
