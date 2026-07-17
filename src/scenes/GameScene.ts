import Phaser from 'phaser'
import type { GameState, AllocStat, Enemy, Player } from '../types'
import { weaponKindOf } from '../types'
import { generateDungeon, getPlayerStartPosition, spawnEnemies, spawnMonsterHouseEnemies, spawnBosses, makeChaosBoss, makeNamedNormalEnemy, makeNamedBossEnemy, makeMinionEnemy, generateAreaBossFloors, getFloorTelopMessage, dedupeEnemyPositions, dedupeItemPositions, PERSONALITY_PREFIX_RE, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../game/dungeon'
import { spawnItems, SPELL_ITEMS, EQUIP_ITEMS, HEAL_ITEMS, WING_ITEMS, makeWingItem, MASTERWORK_PREFIX, type WingKey } from '../game/items'
import { floorLabel, refineSuccessPercent } from '../game/utils'
import { playAttack, playCrit, playDamage, playKill, playLevelUp, playStairs, playPotion, playEquip, playFall, playMate, playBGM, setHeartbeat } from '../game/sound'
import { withV } from '../game/assetVersion'
import { saveGame, loadGame, clearSave, type SaveData } from '../game/save'
import { cloudSaveGame, deleteOwnCloudSave } from '../game/cloudSave'
import { logEvent, getPlayerId } from '../game/supabase'
import { fireWorldNotification, resetWorldNotifyDedup } from '../game/worldNotify'
import { getDisplayName } from '../game/playerName'
import { claimJackpot } from '../game/jackpot'
import { getMonsterTextureOverrides } from '../game/overrides'
import { ENEMY_TEXTURE_MAP, getEnemyTextureKeysForFloorRange } from '../game/enemyTextures'
import { safePrompt } from '../game/phaserRecovery'
import { fetchDoppelgangerCandidate, type DoppelgangerRecord } from '../game/doppelganger'
import { fetchLatestGraveyardId, getLastSeenGraveyardId, setLastSeenGraveyardId } from '../game/graveyard'

const VISION_RADIUS    = 5   // エンティティ可視半径
const VISION_FOG_INNER = 2   // 霧グラデーション開始距離
const VISION_FOG_OUTER = 5   // 霧グラデーション終了距離（以遠は真っ暗）

// ── 階層帯ティント：10F刻みで床・壁に色を被せ、上層ほど毒々しくする ──
// 白(0xffffff)=素の画像。視認性を保つため明度は高めに維持し、色相だけ毒々しく振る。
// 最後の要素以降の階はクランプ（最深色のまま）。
// 〜50Fは緑系で毒々しく深まり、51F以降は徐々に紫が侵食していく（緑→紫の連続グラデ）。
const FLOOR_TINT_TIERS = [
  0xffffff, // 1-10F   素の石畳（変化なし）
  0xc8e896, // 11-20F  明るい毒ライム（ここで一気に緑へ）
  0xafe178, // 21-30F  深まる毒緑
  0xa0da69, // 31-40F  濃い毒緑
  0x96d25a, // 41-50F  最も鮮烈な毒緑（緑のピーク）
  0x96b177, // 51-60F  緑に紫が滲み始める
  0x96978e, // 61-70F  緑と紫が拮抗（澱んだ中間色）
  0x967da5, // 71-80F  紫が優勢に
  0x9663bc, // 81-90F  濃い毒紫
  0x9650cd, // 91F+    紫が完全侵食（瘴気の底）
]

/** 色を係数 f(0〜1) で暗くする（壁を床より一段沈ませる用途） */
function darkenColor(hex: number, f: number): number {
  const r = Math.round(((hex >> 16) & 0xff) * f)
  const g = Math.round(((hex >> 8) & 0xff) * f)
  const b = Math.round((hex & 0xff) * f)
  return (r << 16) | (g << 8) | b
}

/**
 * 階(1始まり)→10F帯のティント色を返す。
 * 〜100Fはテーブルどおり緑→紫。101F以降はクランプせず、最深の紫を10Fごとに
 * 少しずつ暗化して「まだ上がある」深淵感を出す（視認性のため暗化は下限0.5でクランプ）。
 */
function floorTierTint(floor: number): number {
  const tier = Math.max(0, Math.floor((floor - 1) / 10))
  const last = FLOOR_TINT_TIERS.length - 1
  if (tier <= last) return FLOOR_TINT_TIERS[tier]
  const extra = tier - last                          // 101-110F→1, 111-120F→2, ...
  const factor = Math.max(0.5, 1 - extra * 0.06)     // 0.94, 0.88, ... 下限0.5
  return darkenColor(FLOOR_TINT_TIERS[last], factor)
}

// ── 洞窟タイルセットのテーマ（階層帯で見た目が変わる）──
// v2タイル（/assets/dungeon/v2/）が読めた場合のみ有効。無ければ従来タイルへフォールバック。
type DungeonTheme = 'brown' | 'gray' | 'blue'
const DUNGEON_THEMES: DungeonTheme[] = ['brown', 'gray', 'blue']
function dungeonTheme(floor: number): DungeonTheme {
  if (floor <= 30) return 'brown'   // 土の洞窟
  if (floor <= 70) return 'gray'    // 岩窟
  return 'blue'                     // 水晶洞
}

/** ティントを白方向へ寄せて弱める。テーマ付きタイルは絵自体に色があるため、
 *  従来の帯ティントをフルに掛けると絵柄が潰れる（緑床×青テーマ等）。 */
function softenTint(color: number, amount: number): number {
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff)
}

// ── あるかなひろば：さがし人解放の進み具合で「廃れた街→リッチな街」へ段階的に彩る ──
// 0体解放＝褪せた廃墟色、7体全解放＝原色フル。5段階のティントで解放ごとの変化にメリハリを付ける
// （線形補間だと最初と最後の差が地味になるため、区切りを刻んだ階段状の変化にしている）。
const PLAZA_TINT_TIERS = [0x7d6b4a, 0xa8925f, 0xcdb98a, 0xeee0c0, 0xffffff]
function plazaTierIndex(rescuedCount: number): number {
  if (rescuedCount <= 0) return 0
  if (rescuedCount <= 2) return 1
  if (rescuedCount <= 4) return 2
  if (rescuedCount <= 6) return 3
  return 4
}
function plazaProgressTint(rescuedCount: number): number {
  return PLAZA_TINT_TIERS[plazaTierIndex(rescuedCount)]
}

/** 階に応じた瘴気オーバーレイの色とアルファ（薄め。暗くしすぎない）。1-10Fは無し */
function floorMiasma(floor: number): { color: number; alpha: number } {
  const tier = Math.max(0, Math.floor((floor - 1) / 10))
  if (tier === 0) return { color: 0x000000, alpha: 0 }
  // 帯のティント色をそのまま瘴気色に流用。視認性優先で薄く（最大0.10でクランプ）
  const alpha = Math.min(0.10, 0.03 + tier * 0.009)
  return { color: floorTierTint(floor), alpha }
}

// 敵名 → テクスチャキー のマッピング（/assets/enemy/<key>.png を想定）
// 全ボスは画像なし → 色付きRectangleにフォールバック
// 割合貫通率：攻防どちらの近接攻撃でも「攻撃力×この割合」は相手の防御を無視して必ず通る。
// 防御(VIT+Lv/2)やVIT過積みによる完全無敵化を防ぎ、深部の敵・ボスが必ずチップダメージを与える。
const PIERCE_RATE = 0.06

// 強敵判定：この敵の通常攻撃1発の実ダメージ(enemyTurn()と同じ式。クリティカル・鈍足debuffは除く
// ＝敵本来の実力で判定)が3発でプレイヤーの最大HPを超えるなら「強敵」とみなす。
/** 敵の通常攻撃1発分の想定ダメージ（防御・貫通・真ダメージ込み）。危険判定の共通元データ。 */
function enemyHitDamage(enemy: Enemy, player: Player): number {
  if (enemy.isSkulporin) return 0   // 固定で最大HPの3%ダメージのため対象外
  const effectiveDef = player.vit + Math.floor(player.level / 2)
  const floorNow = player.floor
  const pierce   = Math.min(0.20, PIERCE_RATE + Math.max(0, floorNow - 100) * 0.002)
  const trueDmg  = (enemy.isBoss && floorNow > 100)
    ? Math.floor(player.maxHp * Math.min(0.15, (floorNow - 100) * 0.0025))
    : 0
  const baseAtk = enemy.attack + Math.floor(enemy.str * 0.5)
  const raw     = Math.max(1, Math.round(baseAtk * pierce), baseAtk - effectiveDef)
  return raw + trueDmg
}

/** 3発以内で最大HPを削り切る強敵（💀の表示条件）。 */
function isDangerousEnemy(enemy: Enemy, player: Player): boolean {
  if (enemy.isSkulporin) return false
  return enemyHitDamage(enemy, player) * 3 >= player.maxHp
}

/** 現在HPに対して1発で致死しうる敵（💀＋赤オーラの表示条件）。今受けたら死ぬ、の警告。 */
function isLethalEnemy(enemy: Enemy, player: Player): boolean {
  if (enemy.isSkulporin) return false
  return enemyHitDamage(enemy, player) >= player.hp
}

// ── あるかなひろばの住人カタログ（救済で増える）──
// icon=画像未ロード時の絵文字フォールバック。texture=/assets/characters/enemies/<key>.webp。
// 新NPC(miner/junk/toolshop)の画像はユーザー提供待ち→当面は絵文字で表示される。
// hasModal=衝突で専用モーダルを開くか（minerは泉設置のみでモーダル無し）。
// person=救出イベントで表示する「助けた相手」の名前。
const NPC_CATALOG: Record<import('../types').NpcKind, {
  name: string; icon: string; texture: string; hasModal: boolean; person: string
}> = {
  refine:    { name: '鍛冶屋ハンマー', icon: '🔨', texture: 'refine',   hasModal: true,  person: '鍛冶屋ハンマー' },
  shadow:    { name: '影の仕立て屋',   icon: '🌑', texture: 'shadow',   hasModal: true,  person: '影の仕立て屋' },
  spellbook: { name: '古書の魔導士',   icon: '📖', texture: 'spellbook', hasModal: true,  person: '古書の魔導士' },
  merchant:  { name: '行商人とるいぬ', icon: '🛒', texture: 'merchant', hasModal: true,  person: '行商人とるいぬ' },
  miner:     { name: '採掘師',         icon: '⛏️', texture: 'miner',    hasModal: false, person: '採掘師ドリー' },
  junk:      { name: 'がらくた屋',     icon: '♻️', texture: 'junk',     hasModal: true,  person: 'がらくた屋ジャンク' },
  toolshop:  { name: 'どうぐや',       icon: '🧪', texture: 'toolshop', hasModal: true,  person: 'どうぐやポーラ' },
}
const ALL_NPC_KINDS = Object.keys(NPC_CATALOG) as import('../types').NpcKind[]

// どうぐやの品揃え（女神のコインで購入）
const TOOLSHOP_ITEMS: { key: string; name: string; icon: string; cost: number; desc: string }[] = [
  { key: 'red',   name: '赤ポーション', icon: '🧪', cost: 1, desc: 'HPを8回復' },
  { key: 'yellow', name: '黄ポーション', icon: '💊', cost: 2, desc: 'HPを15回復' },
  { key: 'white', name: '白ポーション', icon: '⚗️', cost: 3, desc: 'HPを30回復' },
  { key: 'stamina', name: 'スタミナポーション', icon: '🍵', cost: 2, desc: 'スタミナ+30%' },
]

// モンスター別の表示サイズ係数（1.0=標準）。可視部分=主人公サイズ補正の上に掛かる。
// 大きすぎ/小さすぎる個体をモンスター名で個別調整する（ADMIN上書き画像にも適用）。
const ENEMY_SIZE_MULT: Record<string, number> = {
  'ヨーヨー': 0.8,
}

// AGI：多段攻撃の閾値を逓増（2hit=50, 3hit=100, 4hit=200, 5hit=400, …＝倍々）。天井は8回。
// 旧仕様(50刻み・5回上限)の「AGI200で打ち止め＝死にステ」を解消し、青天井で報われるように。
function playerAttackCount(agi: number): number {
  let hits = 1, need = 50
  while (agi >= need && hits < 8) { hits++; need *= 2 }
  return hits
}
// DEX：命中100%(DEX100)を超えたぶんを貫通へ変換。+100ごとに+2%、上限+16%（基礎6%と合算で最大22%）。
function dexPierceBonus(dex: number): number {
  return Math.min(0.16, Math.max(0, dex - 100) / 100 * 0.02)
}

// 弓：射程はマンハッタン距離4マス。「敵が詰め寄る1〜2ターンの間に先制できる」だけの距離を確保する
// （2マスだと敵が1手で隣接でき、先制の恩恵がほぼ無かったためバランス調整で3→4に拡張）。
const BOW_RANGE = 4
// 遠距離型モンスターの射程（プレイヤーの弓と同じマンハッタン距離）。最小2＝隣接時は通常の近接攻撃になる
const ENEMY_BOW_RANGE = 4
// 弓の割合貫通：近接(PIERCE_RATE=6%)より低い基礎4%＋DEXボーナス（近接のdexPierceBonusを流用）。
// DEXは弓の主力ステータスなので、近接よりむしろ貫通が伸びやすい＝高VIT/ボス戦でも芯を通せる。
const BOW_PIERCE_RATE = 0.04
// 弓：AGIによる多段攻撃の閾値。初段(2発目)は近接と同じAGI50で揃える
// （防具等でのAGI"おこぼれ"投資で近接だけ得をするのを防ぐ＝入口は公平に）。
// 2発目以降の伸び率(2.2倍・上限5)は近接(2倍・上限8)より急なので、天井の高さでのみ差別化する。
function bowAttackCount(agi: number): number {
  let hits = 1, need = 50
  while (agi >= need && hits < 5) { hits++; need *= 2.2 }
  return hits
}

// プレイヤー/ドッペルゲンガー共通の8方向むき（プレイヤーの歩行・攻撃スプライトをそのまま流用するため）
type FacingDir = 'down' | 'up' | 'right' | 'left' | 'down-right' | 'down-left' | 'up-right' | 'up-left'

/** 移動量の符号(-1/0/1)から8方向を求める（プレイヤー移動・ドッペルゲンガー移動の両方で使う共通ロジック） */
function dirFromSign(sx: number, sy: number): FacingDir {
  if (sx > 0 && sy === 0) return 'right'
  if (sx < 0 && sy === 0) return 'left'
  if (sx === 0 && sy > 0) return 'down'
  if (sx === 0 && sy < 0) return 'up'
  if (sx > 0 && sy > 0)   return 'down-right'
  if (sx > 0 && sy < 0)   return 'up-right'
  if (sx < 0 && sy > 0)   return 'down-left'
  if (sx < 0 && sy < 0)   return 'up-left'
  return 'down'
}

// dirFromSign の逆変換（8方向 → 符号ベクトル）。弓の照準優先方向の判定に使う。
const FACING_VEC: Record<FacingDir, [number, number]> = {
  'down': [0, 1], 'up': [0, -1], 'right': [1, 0], 'left': [-1, 0],
  'down-right': [1, 1], 'down-left': [-1, 1], 'up-right': [1, -1], 'up-left': [-1, -1],
}

export class GameScene extends Phaser.Scene {
  private state!: GameState
  private graphics!: Phaser.GameObjects.Graphics
  private fogGraphics!: Phaser.GameObjects.Graphics
  private bowRangeGraphics!: Phaser.GameObjects.Graphics
  private playerGraphic: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Sprite | null = null
  private playerDir: FacingDir = 'down'
  private isPlayerAttacking = false
  private hasPlayerAnims    = false
  private hasArcherAnims    = false
  // ドッペルゲンガー用：プレイヤーと同じ歩行/攻撃スプライトを使うための敵ごとの向き記憶
  private enemyDir = new Map<string, FacingDir>()
  private enemyGraphics: Map<string, Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image | Phaser.GameObjects.Sprite> = new Map()
  private enemyHpBars:  Map<string, { bg: Phaser.GameObjects.Rectangle; fg: Phaser.GameObjects.Rectangle }> = new Map()
  // アイテム描画: Text（回復/魔法）または Image（装備品＝宝箱スプライト）
  private itemGraphics: Map<string, Phaser.GameObjects.GameObject> = new Map()
  // 攻撃可能誘導マーク（今殴れる敵の頭上に⚔️）
  private attackMarkers: Map<string, Phaser.GameObjects.Text> = new Map()
  // 強敵警告マーク（3発で瀕死/即死級の攻撃力を持つ敵の頭上に💀）
  private dangerMarkers: Map<string, Phaser.GameObjects.Text> = new Map()
  // 1撃死警告オーラ（現在HPを1発で削り切る敵の💀背後に赤い発光）
  private dangerGlows: Map<string, Phaser.GameObjects.Image> = new Map()
  // ボス大技チャージ警告（溜め中の敵の頭上に⚠️）
  private chargeMarkers: Map<string, Phaser.GameObjects.Text> = new Map()
  // 性格カウントダウン数字（突進兵=赤・支配者=紫。頭上に3→2→1）
  private countdownMarkers: Map<string, Phaser.GameObjects.Text> = new Map()
  // 支配者の黒いもや（足元の暗紫グロー）
  private mistSprites: Map<string, Phaser.GameObjects.Image> = new Map()
  // 弱虫オーラで強化中の敵に出す💢マーク
  private buffMarkers: Map<string, Phaser.GameObjects.Text> = new Map()
  // 遠距離型が射程＋射線内にプレイヤーを捉えている間、頭上に出す🎯マーク
  private aimMarkers: Map<string, Phaser.GameObjects.Text> = new Map()
  // ヒットストップ/スローモーションのネスト深度（多重発動時に復帰を1回にする）
  private timeFreezeDepth = 0
  // 連続撃破コンボ（実時間ベース）
  private killComboCount = 0
  private killComboAt = 0
  // イベントフロアNPC（施設の話しかけ役）描画
  private facilityGraphics: Map<string, Phaser.GameObjects.Image | Phaser.GameObjects.Text> = new Map()
  // 施設NPC画像の可視領域割合キャッシュ（透過除き可視部分 / 画像全体）
  private facilityBoundsCache: Map<string, { wFrac: number; hFrac: number }> = new Map()


  private inventoryPanel!: Phaser.GameObjects.Container
  private pauseOverlay!: Phaser.GameObjects.Container
  private inventoryOpen = false
  private isPaused = false
  private isStatAllocOpen = false
  private isEquipModalOpen = false
  private isRescueNoticeOpen = false   // さがし人：発生告知/救出完了モーダル表示中は操作を止める
  private isArcadeOpen = false   // げーせんのミニゲーム表示中は操作を止める
  private awaitingEquipModal = false
  private pendingItem: import('../types').Item | null = null
  private isGameOver   = false   // gameOver()の多重発火防止（同一ターン内で複数回HP<=0判定が走るため）
  private lastDeathCause = '不明な要因'   // ゲームオーバー画面用：直近のダメージ要因（各ダメージ処理箇所でセット）
  private isAnimating  = false   // 落とし穴スピンなどの演出中フラグ（入力ブロック用）
  private animatingTimer: ReturnType<typeof setTimeout> | null = null  // isAnimating安全タイムアウト
  private onVisibilityChange = () => {
    if (!document.hidden) {
      // バックグラウンド復帰時：スタックした入力ロックフラグを全て強制解除
      this.isAnimating = false
      if (this.animatingTimer) { clearTimeout(this.animatingTimer); this.animatingTimer = null }
      this.isPaused = false
      this.pauseOverlay?.setVisible(false)
      // 装備モーダルが解決されないままだった場合、アイテムをバッグへ退避して解放
      if (this.isEquipModalOpen && this.pendingItem) {
        this.state.bag.push(this.pendingItem)
        this.addMessage(`${this.pendingItem.name}をバッグに入れた（復帰時自動処理）`)
      }
      this.pendingItem        = null
      this.isEquipModalOpen   = false
      this.awaitingEquipModal = false
      this.updateWindowGameState()
    }
  }
  // テクスチャ/アニメーションはゲーム全体で共有（シーン再起動毎にリセットされない）ため、
  // 透過処理（テクスチャの remove→addCanvas）は初回のみ実行する。
  // 2回目以降に再実行すると、既存のwalk/attackアニメーションが参照している古いFrameの
  // textureSourceがnullになり、再生時に "Cannot read properties of null (reading 'sourceSize')" でクラッシュする
  private playerTexturesTransparent = false
  private isEventFloor = false   // イベントフロア（ベースキャンプ「あるかなひろば」）滞在中フラグ
  private floorIsCleared = false  // 現在のフロアが踏破済み（自己最高到達階未満）か。XP大幅減＆ドロップなし
  private eventFacilities: { id: string; kind: import('../types').FacilityKind; name: string; icon: string; texture?: string; position: import('../types').Position }[] = []
  // ── 救済システム（このフロア限定・セーブしない。救済結果 rescuedNpcs は state 側で永続）──
  private floorRescue: { kind: import('../types').NpcKind; position: import('../types').Position } | null = null   // 徘徊NPC（衝突で救出＝パターン1）
  private pendingClearRescue: import('../types').NpcKind | null = null   // 全敵撃破で救出（パターン2）
  private jailCell: { kind: import('../types').NpcKind; doorPos: import('../types').Position; npcPos: import('../types').Position } | null = null   // 牢屋（パターン3）
  private jailNpcSprite: Phaser.GameObjects.GameObject | null = null
  private rescueSprite: Phaser.GameObjects.GameObject | null = null
  private plazaDecor: Phaser.GameObjects.GameObject[] = []   // 町の装飾スプライト（プラザ滞在中のみ）
  private plazaBlocked = new Set<string>()   // 町で通行不可なタイル（木/池/街灯/花/建物）"x,y"
  private plazaPath = new Set<string>()      // 町の石畳パス（十字通路）"x,y"。createTileSpritesの見た目切替に使う
  private signboardPos: import('../types').Position | null = null   // 広場の掲示板の位置。体当たりで捜し人一覧を開く
  private signboardMark: Phaser.GameObjects.Text | null = null   // 看板上に浮かせる未読「！」マーク
  private graveyardPos: import('../types').Position | null = null   // 広場の墓標の位置。体当たりで墓標一覧を開く
  private graveyardMark: Phaser.GameObjects.Text | null = null   // 墓標上に浮かせる未読「！」マーク
  private graveyardLatestId: number | null = null   // 直近フェッチした最新墓標id（既読化に使う）
  private graveyardUnread = false   // 全プレイヤー共有データのため、セーブ対象のstateではなくシーン内フラグで管理
  private arcadePos: import('../types').Position | null = null   // 広場のげーせん筐体の位置。体当たり/タップでミニゲームを開く
  private skipNextStairsSound = false   // 落とし穴転落直後のpopulateFloorで汎用階段音を重ねないためのフラグ
  private failedTextures = new Set<string>()   // 読み込み失敗テクスチャ
  private loadedEnemyKeys = new Set<string>()  // 先読み済みの敵テクスチャキー（通信量削減の遅延ロード用）
  private loadedEnemyFloorTo = 0                // 敵テクスチャを先読み済みのフロア上限
  private enemyTextureLoadInFlight = false      // 先読みロードの多重実行防止
  private floorVariantMap: string[][] = []      // [y][x] → 'tile-floor1/2/3'
  private tileSprites: (Phaser.GameObjects.Image | null)[][] = []
  private miasmaOverlay: Phaser.GameObjects.Rectangle | null = null  // 画面全面の瘴気オーバーレイ
  private miasmaOrbs: Phaser.GameObjects.Image[] = []  // 浮遊する毒の光球
  // 描画タイルサイズ（シーン起動時に確定。ワールド座標 = タイル座標 × rts）
  private rts = TILE_SIZE
  private lastMoveAt = 0          // キーリピート抑制（移動テンポ制御）
  private lastActionWasAttack = false  // 攻撃後のキーリピートによる意図しない移動防止
  private snapNextRender = false  // フロア切替直後はトゥイーンせず即時配置＋カメラスナップ
  private stairsGlow: Phaser.GameObjects.Arc | null = null
  private stairsGlowPos: import('../types').Position | null = null
  private lowHpVignette: Phaser.GameObjects.Image | null = null
  private vignetteTween: Phaser.Tweens.Tween | null = null
  private vignetteTarget = 0

  // ── すかるぽりん ──
  private skulporinSpawnId: number | null = null
  private skulporinEscapeAt: number | null = null
  // 討伐/逃走で決着済みのスポーンID。討伐通知(fire-and-forget)がサーバー反映される前に
  // フロア入場 heartbeat が同じactiveを返して「倒した直後に再出現」するのを防ぐ。
  private resolvedSkulporinIds = new Set<number>()
  private skulporinHeartbeatTimer: ReturnType<typeof setInterval> | null = null
  private skulporinEscapeTimer: ReturnType<typeof setInterval> | null = null
  // すかるぽりんの新規ターゲット選出から放置プレイヤーを除外するための最終操作時刻。
  // タブを開いたまま無操作でもheartbeat自体は送られ続けるため、実操作(移動等)でのみ更新する。
  private lastActionAt: number = Date.now()
  private static readonly SKULPORIN_IDLE_MS = 5 * 60 * 1000

  // このプレイ（この周回）中に撃破済みのドッペルゲンガー記録ID。DBの記録自体は削除しない
  // （他プレイヤーや次回以降の自分には引き続き出現しうる）ため、同一周回内での再出現だけを防ぐ。
  // 新規ゲーム開始時にリセットする（initGame()参照）。ロード再開時はリセットしない。
  private defeatedDoppelgangerIds = new Set<number>()

  // ── ADMIN イベント（モンスターハウス強制・モンスター強制ポップ）──
  private forceMonsterHouseNextFloor = false
  private pendingAdminSpawns: { name: string; behavior: 'normal' | 'boss' | 'skulporin'; floor: number }[] = []

  constructor() {
    super({ key: 'GameScene' })
  }

  // シーン再起動時（scene.start 呼び出しごと）に必ず実行される
  init() {
    this.playerGraphic      = null
    this.enemyGraphics      = new Map()
    this.enemyHpBars        = new Map()
    this.itemGraphics       = new Map()
    this.attackMarkers      = new Map()
    this.dangerMarkers      = new Map()
    this.dangerGlows        = new Map()
    this.chargeMarkers      = new Map()
    this.countdownMarkers   = new Map()
    this.mistSprites        = new Map()
    this.buffMarkers        = new Map()
    this.aimMarkers         = new Map()
    this.timeFreezeDepth    = 0
    this.killComboCount     = 0
    this.killComboAt        = 0
    this.facilityGraphics   = new Map()
    this.tileSprites        = []
    this.floorVariantMap    = []
    this.miasmaOverlay      = null
    this.miasmaOrbs         = []
    this.inventoryOpen      = false
    this.isPaused           = false
    this.isStatAllocOpen    = false
    this.isEquipModalOpen   = false
    this.isRescueNoticeOpen = false
    this.isArcadeOpen       = false
    this.awaitingEquipModal = false
    this.pendingItem        = null
    this.playerDir          = 'down'
    this.isPlayerAttacking  = false
    this.isGameOver         = false
    this.isAnimating        = false
    this.isEventFloor       = false
    this.floorRescue        = null
    this.pendingClearRescue = null
    this.jailCell           = null
    this.jailNpcSprite      = null
    this.rescueSprite       = null
    this.plazaDecor         = []
    this.plazaBlocked       = new Set<string>()
    this.plazaPath          = new Set<string>()
    this.signboardPos       = null
    this.eventFacilities    = []
    this.rts                = window.innerWidth < 768 ? Math.round(TILE_SIZE * 1.5) : TILE_SIZE
    this.lastMoveAt            = 0
    this.lastActionWasAttack   = false
    this.snapNextRender        = false
    this.stairsGlow         = null
    this.stairsGlowPos      = null
    this.lowHpVignette      = null
    this.vignetteTween      = null
    this.vignetteTarget     = 0
  }

  /** this.load.image()のラッパー。public/配下の画像はファイル名を変えずに中身だけ差し替えることがあり、
   *  Cache-Control: immutable な配信環境だとブラウザキャッシュが更新されず古い画像のまま固まる事故が起きる。
   *  ファイル内容ハッシュ(withV)をURLに付け、変更したファイルだけキャッシュを更新させる
   *  （無変更ファイルは同じURLのまま＝長期キャッシュの再訪問ゼロ通信を維持する）。 */
  private loadImg(key: string, path: string) {
    this.load.image(key, withV(path))
  }

  preload() {
    // 旧タイルは表示に使う壁・階段のみ読み込む。床・罠・泥・泉・落とし穴・宝箱は
    // v2タイルへ完全移行済みのため旧画像（計約580KB）の並行ロードを廃止（通信量・発熱対策）。
    // 万一v2が読めない場合も、renderMapの単色矩形フォールバックでゲームは継続できる。
    this.loadImg('tile-wall',   '/assets/dungeon/wall/wall.webp')
    this.loadImg('tile-stairs', '/assets/dungeon/stairs/stairs.webp')

    // ── 新洞窟タイルセット（テーマ別 v2）──
    // 採用範囲：床・落とし穴・泥（砂利）・毒罠（紫池）・泉（緑池）・宝箱
    // （壁・階段はユーザー確認の結果、従来タイルを継続）
    // 読み込み失敗時は failedTextures 経由で上の旧タイルへ自動フォールバックする
    for (const th of DUNGEON_THEMES) {
      for (const n of [1, 2, 3]) this.loadImg(`t2-floor-${th}-${n}`, `/assets/dungeon/v2/floor_${th}_${n}.webp`)
      this.loadImg(`t2-pitfall-${th}`,    `/assets/dungeon/v2/pitfall_${th}.webp`)
      this.loadImg(`t2-mud-${th}`,        `/assets/dungeon/v2/mud_${th}.webp`)
      this.loadImg(`t2-trap-${th}`,       `/assets/dungeon/v2/trap_${th}.webp`)
      this.loadImg(`t2-spring-${th}`,     `/assets/dungeon/v2/spring_${th}.webp`)
      this.loadImg(`t2-spring-dry-${th}`, `/assets/dungeon/v2/spring_dry_${th}.webp`)
    }
    this.loadImg('t2-box', '/assets/dungeon/v2/box.webp')   // 宝箱（アイテム表示）

    // ── あるかなひろば（町）プロップ。未配置でも読み込み失敗＝描画スキップで安全 ──
    for (const p of ['grass', 'path', 'tree', 'well', 'lamp', 'fence', 'pond', 'flowers',
      'stonepath', 'hedge', 'topiary', 'bench', 'signboard', 'fountain', 'cave', 'rockwall', 'jail-door', 'goddess-statue', 'arcade']) {
      const file = p === 'grass' ? 'ground_grass' : p === 'path' ? 'ground_path'
        : p === 'stonepath' ? 'path_stone' : p === 'hedge' ? 'hedge_h'
        : p === 'cave' ? 'deco_cave_entrance_big' : p === 'rockwall' ? 'deco_rockwall'
        : 'deco_' + p.replace('-', '_')
      this.loadImg(`town-${p}`, `/assets/town/props/${file}.webp`)
    }
    // 建物は参考画像から抜いた高品質ランドマーク版(ref_building_*)を優先。無ければ旧簡易版にフォールバック。
    for (const k of ALL_NPC_KINDS) {
      this.loadImg(`town-b-${k}`, `/assets/town/props/ref_building_${k}.webp`)
      this.loadImg(`town-bf-${k}`, `/assets/town/props/building_${k}.webp`)
    }

    // プレイヤー画像（スタティック・フォールバック用）
    this.loadImg('player', '/assets/characters/player.webp')

    // プレイヤーアニメーションフレーム（12枚）
    for (let i = 1; i <= 4; i++) {
      this.loadImg(`attack_down_${i}`,  `/assets/characters/player/attack_down_${i}.webp`)
      this.loadImg(`attack_up_${i}`,    `/assets/characters/player/attack_up_${i}.webp`)
      this.loadImg(`attack_right_${i}`, `/assets/characters/player/attack_right_${i}.webp`)
    }

    // 弓職（アーチャー）フレーム（16枚・透過済みなのでmakeTransparent不要）。
    // 左向き系は近接と同様flipXで代用するため画像を持たない。
    // 攻撃は斜め射ちの専用絵があるため、近接（上下で代用）と違い斜め2方向もロードする。
    for (let i = 1; i <= 2; i++) {
      for (const d of ['down', 'up', 'right']) {
        this.loadImg(`archer_walk_${d}_${i}`, `/assets/characters/player/archer/walk_${d}_${i}.webp`)
      }
      for (const d of ['down', 'up', 'right', 'up-right', 'down-right']) {
        this.loadImg(`archer_attack_${d}_${i}`, `/assets/characters/player/archer/attack_${d}_${i}.webp`)
      }
    }

    // 敵キャラクター画像（存在しないものは loaderror で failedTextures に記録→フォールバック）
    // 通信量削減のため、全モンスター画像(70体超)を毎回丸ごと先読みするのではなく、
    // 現在地から先のフロア帯だけを先読みする（loadEnemyTexturesAround 参照）。
    // イベントフロアNPC・徘徊モンスターはフロアと無関係に出現しうるので常時ロードする。
    const alwaysLoadEnemyImages: [string, string][] = [
      ['refine',     '/assets/characters/enemies/refine.webp'],
      ['shadow',     '/assets/characters/enemies/shadow.webp'],
      ['spellbook',  '/assets/characters/enemies/spellbook.webp'],
      ['merchant',   '/assets/characters/enemies/merchant.webp'],
      ['miner',      '/assets/characters/enemies/miner.webp'],
      ['junk',       '/assets/characters/enemies/junk.webp'],
      ['toolshop',   '/assets/characters/enemies/toolshop.webp'],
      ['scullporin', '/assets/characters/enemies/scullporin.webp'],
    ]
    for (const [key, path] of alwaysLoadEnemyImages) this.loadImg(key, path)
    this.loadedEnemyKeys = new Set(alwaysLoadEnemyImages.map(([key]) => key))

    // 開始フロア周辺のモンスター画像を先読み（新規開始は1F、セーブ再開時はその階から）
    const startFloor = loadGame()?.player.floor ?? 1
    const floorLookaheadTo = startFloor + 39
    for (const key of getEnemyTextureKeysForFloorRange(1, floorLookaheadTo)) {
      if (this.loadedEnemyKeys.has(key)) continue
      this.loadImg(key, `/assets/characters/enemies/${key}.webp`)
      this.loadedEnemyKeys.add(key)
    }
    this.loadedEnemyFloorTo = floorLookaheadTo

    // データベース編集でアップロードされたモンスター画像を上書きロード（透過処理のためCORS有効化）
    const texOverrides = getMonsterTextureOverrides()
    if (texOverrides.some(o => o.url)) {
      this.load.crossOrigin = 'anonymous'
      for (const o of texOverrides) {
        if (o.url) this.loadImg(`ovr_${o.ref}`, o.url)
      }
    }

    // 読み込みエラーを記録 → フォールバックで色描画
    this.load.on('loaderror', (file: { key: string }) => {
      this.failedTextures.add(file.key)
    })
  }

  /**
   * 現在のフロアが先読み済みウィンドウの終端に近づいたら、次のフロア帯のモンスター画像を追加ロードする。
   * ロード完了までは既存のフォールバック描画（色矩形）に任せ、完了後に renderMap() で差し替える。
   */
  private ensureEnemyTexturesForFloor(floor: number) {
    if (this.enemyTextureLoadInFlight) return
    if (floor + 10 <= this.loadedEnemyFloorTo) return
    const from = this.loadedEnemyFloorTo + 1
    const to   = floor + 39
    this.loadedEnemyFloorTo = to
    const newKeys = getEnemyTextureKeysForFloorRange(from, to).filter(key => !this.loadedEnemyKeys.has(key))
    if (newKeys.length === 0) return
    this.enemyTextureLoadInFlight = true
    for (const key of newKeys) {
      this.loadImg(key, `/assets/characters/enemies/${key}.webp`)
      this.loadedEnemyKeys.add(key)
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.enemyTextureLoadInFlight = false
      this.renderMap()
    })
    this.load.start()
  }

  /** DB編集の画像/改名をテクスチャ解決へ反映（透過処理→可視部分サイズ調整は描画時に適用）。 */
  private applyMonsterTextureOverrides() {
    for (const o of getMonsterTextureOverrides()) {
      const effectiveName = o.newName ?? o.ref
      if (o.url) {
        const key = `ovr_${o.ref}`
        if (this.textures.exists(key) && !this.failedTextures.has(key)) {
          try { this.makeTransparent(key) } catch (e) { console.warn('上書き画像の透過処理に失敗:', key, e) }
          ENEMY_TEXTURE_MAP[effectiveName] = key
          ENEMY_TEXTURE_MAP[o.ref] = key
        }
      } else if (o.newName) {
        // 改名のみ：旧名のテクスチャを新名でも引けるよう登録
        const cur = ENEMY_TEXTURE_MAP[o.ref]
        if (cur) ENEMY_TEXTURE_MAP[effectiveName] = cur
      }
    }
  }

  create() {
    this.cameras.main.fadeIn(500, 0, 0, 0)
    this.cameras.main.setBounds(0, 0, MAP_WIDTH * this.rts, MAP_HEIGHT * this.rts)
    this.graphics    = this.add.graphics().setDepth(1)
    this.fogGraphics = this.add.graphics().setDepth(7)
    this.bowRangeGraphics = this.add.graphics().setDepth(2)
    this.applyMonsterTextureOverrides()
    // プレイヤーアニメは initGame より前に用意する。
    // initGame は新章で開始プラザ生成→renderMap を即実行するため、ここで先に整えておかないと
    // 主人公が歩行スプライトではなく矩形フォールバックで生成され、以後スプライト化されない
    // （初期の町で主人公が表示されない不具合になる）。
    this.removePlayerBackgrounds()
    this.createPlayerAnims()
    this.initGame()
    this.createLowHpVignette()
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    // シーン停止時の後始末（shutdown は Phaser から自動では呼ばれないため明示登録。
    // これがないと visibilitychange リスナーやすかるぽりんの interval が GAME OVER 後も生き続ける）
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)
    this.input.keyboard!.on('keydown', this.handleInput, this)
    this.input.on('pointerdown', this.handlePointerMove, this)   // PC: クリックした方向へ1歩
    window.allocateStat = (stat: AllocStat) => this.doAllocateStat(stat)
    window.allocateStatBulk = (stat: AllocStat, amount: number) => this.doAllocateStatBulk(stat, amount)
    window.useSpell    = (itemId: string) => this.useSpellById(itemId)
    window.useHeal     = (itemId: string) => this.useHealById(itemId)
    window.isGameSceneActive = true
    // プレイ中はステータスバー/メッセージ枠を表示する通常レイアウトへ戻す（スマホ全幅化を解除）
    window.dispatchEvent(new Event('et-canvas-play'))
    window.resolveEquip    = (equip: boolean) => this.resolveEquipModal(equip)
    window.equipFromBag   = (itemId: string) => this.equipFromBag(itemId)
    window.discardFromBag = (itemId: string) => this.discardFromBag(itemId)
    window.toggleLockItem = (itemId: string) => this.toggleLockItem(itemId)
    window.applySlotEffect = (result: string) => this.applySlotEffect(result)
    window.applyArcanaResult = (points: number) => this.applyArcanaResult(points)
    window.gameMove        = (key: string)    => this.handleInput({ key } as KeyboardEvent)
    window.gameAttack      = () => this.gameAttackById()
    window.gameSwapWeapon  = () => this.gameSwapWeapon()
    window.grantReward     = (reward, message) => this.grantLikeReward(reward, message)
    window.saveGame        = () => this.doSaveGame()
    window.addWorldLogMessage = (text: string) => this.addWorldLogMessage(text)
    window.runRefineChallenge   = (slot, sacrificeId) => this.runRefineChallenge(slot, sacrificeId)
    window.runBulkRefineChallenge = (slot, sacrificeIds) => this.runBulkRefineChallenge(slot, sacrificeIds)
    window.runShadowChallenge   = ()                  => this.runShadowChallenge()
    window.runBulkShadowChallenge = (times)            => this.runBulkShadowChallenge(times)
    window.runSpellbookChallenge = (spellId)          => this.runSpellbookChallenge(spellId)
    window.buyMerchantItem      = (key)               => this.buyMerchantItem(key)
    window.runJunkConvert       = (itemId)            => this.runJunkConvert(itemId)
    window.getToolShopItems     = ()                  => TOOLSHOP_ITEMS
    window.buyToolItem          = (key)               => this.buyToolItem(key)
    window.getJailUnlockState   = ()                  => this.getJailUnlockState()
    window.tryJailUnlock        = (method, sacId)     => this.tryJailUnlock(method, sacId)
    window.getRescueList        = ()                  => this.getRescueList()
    window.closeRescueNotice    = ()                  => { this.isRescueNoticeOpen = false }
    window.closeArcade          = ()                  => { this.isArcadeOpen = false }

    // ADMINパネルからの即時チェック用（強制出現後に即反映）
    window.triggerSkulporinCheck = () => { void this.sendSkulporinHeartbeat() }

    // すかるぽりん heartbeat（30秒ごと）
    // ※スポーン配布のほかADMINコマンド・いいね報酬・状態スナップショットも運ぶため常時稼働
    this.skulporinHeartbeatTimer = setInterval(() => this.sendSkulporinHeartbeat(), 30_000)
    // 逃走タイマー監視（1秒ごと）は常時ではなく、すかるぽりん出現中のみ起動する（発熱対策）。
    // 時間切れ個体のDB側掃除は /api/skulporin-heartbeat が全プレイヤーの心拍で行うため、
    // このタイマーが止まっていても全鯖排他（uniq_skulporin_active）は詰まらない。

    // 開発サーバー限定：コンソールから warpFloor(階数) で好きな階に飛べる
    if (import.meta.env.DEV) {
      window.warpFloor = (floor: number) => {
        this.state.player.floor = Math.max(1, Math.floor(floor)) - 1
        this.nextFloor()
      }
      window.giveEquip = (name?: string) => {
        const base = name
          ? EQUIP_ITEMS.find(e => e.name === name)
          : EQUIP_ITEMS[Math.floor(Math.random() * EQUIP_ITEMS.length)]
        if (!base) { console.warn('[DEV] 装備名が見つかりません:', name); return }
        this.state.bag.push({
          id: `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: base.name, type: 'equip', position: { x: 0, y: 0 },
          equipSlot: base.equipSlot,
          weaponKind: base.weaponKind,
          hpBonus: base.hpBonus, strBonus: base.strBonus, agiBonus: base.agiBonus,
          dexBonus: base.dexBonus, intBonus: base.intBonus, vitBonus: base.vitBonus, lukBonus: base.lukBonus,
        })
        this.updateWindowGameState()
        console.log('[DEV] バッグに追加:', base.name)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).debugSkulporin = () => {
        if (this.state.enemies.some(e => e.isSkulporin)) {
          console.warn('[DEV] すかるぽりんはすでにマップにいます')
          return
        }
        this.skulporinSpawnId  = -1
        this.skulporinEscapeAt = Date.now() + 3 * 60 * 1000
        this.startSkulporinEscapeTimer()
        this.spawnSkulporinOnFloor()
        fireWorldNotification('event', '[緊急]すかるぽりんが出現しました！', 'どこかのフロアに「すかるぽりん」が出現したようです！冒険者の皆さんは至急討伐に向かってください！')
        console.log('[DEV] すかるぽりんを強制スポーンしました')
      }
      window.forceRescue = (pattern?: 1 | 2 | 3) => {
        const pool = this.unrescuedNpcs()
        if (pool.length === 0) { console.warn('[DEV] 救済可能なNPCがいません（全員救済済み）'); return }
        const kind = pool[Math.floor(Math.random() * pool.length)]
        const p = pattern ?? (1 + Math.floor(Math.random() * 3)) as 1 | 2 | 3
        this.floorRescue = null
        this.pendingClearRescue = null
        this.jailCell = null
        let subMessage = ''
        if (p === 1) { this.spawnWanderingRescue(kind); subMessage = 'どこかで迷子になっているようだ。' }
        else if (p === 2) { this.pendingClearRescue = kind; subMessage = 'モンスターに捕まっているようだ。' }
        else { this.carveJail(kind); subMessage = 'どこかで囚われているようだ。' }
        if (!(this.floorRescue || this.pendingClearRescue || this.jailCell)) {
          console.warn('[DEV] 配置に失敗しました（空きマスなし等）。もう一度試してください')
          return
        }
        this.isRescueNoticeOpen = true
        window.dispatchEvent(new CustomEvent('rescue-notice-open', {
          detail: `どこからか助けを呼ぶ声が聞こえる・・・\n${subMessage}`,
        }))
        this.renderMap()
        console.log(`[DEV] パターン${p}でさがし人イベントを強制発生:`, kind)
      }
      window.rescueAllNpcs = () => {
        const missing = ALL_NPC_KINDS.filter(k => !this.state.rescuedNpcs.includes(k))
        if (missing.length === 0) { console.warn('[DEV] 既に全員救済済みです'); return }
        this.state.rescuedNpcs.push(...missing)
        this.state.signboardUnread = true
        if (this.isEventFloor) this.enterEventFloor()   // 街を全住人・満開デコで再構築
        this.updateWindowGameState()
        console.log('[DEV] 住人を全員救済しました:', missing)
      }
      console.log('[DEV] warpFloor(階数) で好きな階にワープできます。例: warpFloor(10)')
      console.log('[DEV] giveEquip("装備名") でバッグに装備を追加。引数なしでランダム。')
      console.log('[DEV] debugSkulporin() ですかるぽりんを強制スポーン。')
      console.log('[DEV] rescueAllNpcs() であるかなひろばの住人を全員救済（街を満開状態に）。')
      console.log('[DEV] forceRescue(1|2|3) でさがし人イベントを強制発生。1=徘徊 2=全滅解放 3=牢屋。引数なしでランダム。')
      console.log('[DEV] 装備一覧:', EQUIP_ITEMS.map(e => e.name).join(', '))
    }

    this.createPauseOverlay()
    this.createInventoryPanel()
    // removePlayerBackgrounds / createPlayerAnims は initGame より前へ移動済み（初期の町で主人公が出ない対策）

    this.renderMap()
    this.updateWindowGameState()
    this.showTelopIfNeeded()
    this.updateBGM()
    if (this.state.floorType === 'chaos') this.showMonsterHouseEffect()
  }

  private initGame() {
    const saved = loadGame()
    if (saved) {
      this.initGameFromSave(saved)
      return
    }

    // 新規ゲーム：マイルストーン通知の重複防止をリセット（ロード再開時は呼ばない）
    resetWorldNotifyDedup()
    this.defeatedDoppelgangerIds = new Set<number>()

    const map = generateDungeon()
    const playerPos = getPlayerStartPosition(map)
    const areaBossFloors = generateAreaBossFloors()

    const floorType = this.determineFloorType(1, 1)  // 初期LUK=1
    const initBase = 3  // 1Fはチュートリアル的に少なめ（3〜5体）
    const initCount = initBase + Math.floor(Math.random() * 3)
    const normalEnemies = floorType === 'chaos'
      ? spawnMonsterHouseEnemies(map, 1, playerPos)
      : spawnEnemies(map, initCount, 1)
    let bosses = spawnBosses(1, areaBossFloors)
    if (floorType === 'chaos') bosses = [...bosses, makeChaosBoss(1)]
    const floorTiles: { x: number; y: number }[] = []
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) {
        if (map[y][x] === 'floor') floorTiles.push({ x, y })
      }
    }
    for (const boss of bosses) {
      const pos = floorTiles[Math.floor(Math.random() * floorTiles.length)]
      boss.position = { ...pos }
    }

    this.state = {
      player: {
        position: { ...playerPos },
        hp: 50,
        maxHp: 50,
        level: 1,
        exp: 0,
        floor: 1,
        stamina: 350,
        maxStamina: 350,
        poisoned: false,
        poisonTurns: 0,
        mudTurns: 0,
        mudSkipNext: false,
        equipment: {},
        str: 3, agi: 1, dex: 1, int: 1, vit: 3, luk: 1,
        maxFloorReached: 1,
        jackpotWins: 0,
        statPoints: 0,
        totalStatPointsEarned: 0,
        doppelPointsGained: 0,
        healingTurns: 0,
        blessingTurns: 0,
        blessingBonus: { str: 0, int: 0, dex: 0, agi: 0 },
      },
      enemies: [...normalEnemies, ...bosses],
      items: floorType === 'lucky'
        ? spawnItems(map, { countMult: 2, equipRate: 0.30, floor: 1 })
        : floorType === 'chaos'
        ? spawnItems(map, { countMult: 3, floor: 1 })
        : spawnItems(map, { floor: 1 }),
      map,
      turn: 0,
      spells: [],
      heals: [],
      bag: [],
      messages: ['地下タワーに潜入した！'],
      areaBossFloors,
      floorType,
      driedSprings: [],
      miasmaFloor: false,   // 1Fは瘴気フロアにしない（序盤の理不尽さ回避）
      rescuedNpcs: [],
      signboardUnread: true,   // 初回は未読扱いで「！」を出す
    }
    // 新章：スタート地点は「あるかなひろば」。最初は住人0人＋B1Fへの階段のみ。
    // 上で組んだ通常フロアはプラザ生成で上書きされる（floor=0からnextFloorでB1Fへ）。
    this.state.player.floor = 0
    this.state.player.maxFloorReached = 0
    this.enterEventFloor()
  }

  // セーブデータからの再開：保存時点のマップ・敵・アイテム配置をそのまま復元する
  // （再生成すると「リロードで良いダンジョンを引き直す」抜け道になるため、スナップショットを丸ごと復元する）
  private initGameFromSave(saved: SaveData) {
    const floor = saved.player.floor
    const map = saved.map

    this.state = {
      player: {
        ...saved.player,
        maxFloorReached: saved.player.maxFloorReached ?? floor,
        // 本機能導入前のセーブ互換：生涯累計が未記録なら、現在の未消費ステータスポイントを
        // 下限の概算値としてバックフィルする（0スタートだと以後の少量獲得だけで頭打ちになるため）
        totalStatPointsEarned: saved.player.totalStatPointsEarned ?? saved.player.statPoints ?? 0,
        // 本フィールド導入前のセーブは0扱い（過去のドッペル取得分は継承候補に残るが、
        // 出現時のクランプ（spawnDoppelganger）が上限を抑えるため実害は限定的）
        doppelPointsGained: saved.player.doppelPointsGained ?? 0,
      },
      enemies: saved.enemies,
      items: saved.items,
      map,
      turn: saved.turn,
      spells: saved.spells,
      heals: saved.heals,
      bag: saved.bag,
      messages: [`セーブデータをロードしました（${floorLabel(floor)}から再開）`],
      areaBossFloors: saved.areaBossFloors,
      floorType: saved.floorType,
      driedSprings: saved.driedSprings ?? [],
      miasmaFloor: saved.miasmaFloor ?? false,
      rescuedNpcs: saved.rescuedNpcs ?? [],
      // 本フィールド導入前のセーブは一度も見ていない扱いにして「！」で気づかせる
      signboardUnread: saved.signboardUnread ?? true,
    }
    // 再開フロアはそのスナップショットを復元するだけなので踏破済みペナルティ対象にしない
    this.floorIsCleared = false
    this.buildFloorVariants(map)
    this.createTileSprites(map)
  }

  // オートセーブ（階層が上がるたびに保存。誤操作によるデータ消失を防ぐ保険。死亡時は clearSave() で消える）。
  // TOPのSETTINGSで ON/OFF 切替（localStorage 'autoSave'。未設定=ON）。完了時はプレイ枠左上に薄く通知。
  private autoSave() {
    if ((localStorage.getItem('autoSave') ?? 'on') === 'off') return
    const { player, enemies, items, map, spells, heals, bag, turn, areaBossFloors, floorType, driedSprings, miasmaFloor, rescuedNpcs, signboardUnread } = this.state
    const ok = saveGame({ player, enemies, items, map, spells, heals, bag, turn, areaBossFloors, floorType, driedSprings, miasmaFloor, rescuedNpcs, signboardUnread })
    if (ok) window.showAutoSaveToast?.()
  }

  // セーブ実行（プレイ中のセーブボタンから呼ばれる）
  // ローカル（この端末の中断データ）に保存しつつ、名前＋パスワードでクラウドにも保存し、
  // 別端末でも「クラウド再開」から続けられるようにする。
  private async doSaveGame() {
    const { player, enemies, items, map, spells, heals, bag, turn, areaBossFloors, floorType, driedSprings, miasmaFloor, rescuedNpcs, signboardUnread } = this.state
    const snapshot = { player, enemies, items, map, spells, heals, bag, turn, areaBossFloors, floorType, driedSprings, miasmaFloor, rescuedNpcs, signboardUnread }
    const localOk = saveGame(snapshot)

    const localMsg = localOk
      ? 'この端末には中断データを保存しました。\n（クラウド保存は行われていません）'
      : '⚠️セーブに失敗しました。\nプライベートモードを解除し、\nブラウザのデータ保存を許可してください。'

    // クラウド保存：名前＋パスワード（任意・キャンセル時はローカルのみ）
    // safePrompt: DOM入力モーダル（prompt非対応ブラウザ対策）。表示中はシーン入力を停止
    const name = (await safePrompt(this, 'クラウドに保存する冒険者名を入力\n（別端末での再開に使います）', getDisplayName()))?.trim()
    if (!name) { window.showGameToast?.(localMsg); return }
    const password = (await safePrompt(this, 'パスワードを入力\n（再開時に必要。忘れないでください）'))?.trim()
    if (!password) { window.showGameToast?.(localMsg); return }

    window.showGameToast?.('クラウドに保存中...')
    void cloudSaveGame(name, password, { ...snapshot, savedAt: Date.now() }).then(res => {
      if (res === 'ok') {
        window.showGameToast?.('クラウドに保存しました。\n別の端末でもタイトルの「クラウド再開」から\n同じ名前とパスワードで続けられます。')
      } else if (res === 'name_taken') {
        window.showGameToast?.('そのセーブ名は別のパスワードで使用中です。\n別の名前にするか、正しいパスワードを\n入力してください。')
      } else {
        window.showGameToast?.(localOk
          ? 'クラウド保存に失敗しました。\nこの端末には保存済みです。'
          : '⚠️セーブに失敗しました。通信状況をご確認ください。')
      }
    })
  }

  private showTelopIfNeeded() {
    if (this.isEventFloor) return   // あるかなひろば（プラザ）では階層テロップを出さない
    const { player, areaBossFloors, floorType, miasmaFloor } = this.state
    const bossMsg = getFloorTelopMessage(player.floor, areaBossFloors)

    const parts: string[] = []
    if (this.floorIsCleared)   parts.push('このフロアは踏破済み。経験値・ドロップなし。')
    if (floorType === 'chaos') parts.push('このフロアは混沌とした気配に満ちている！')
    if (floorType === 'lucky') parts.push('このフロアは不思議な光に包まれている・・・')
    if (miasmaFloor)           parts.push('瘴気が強いフロアだ！目の前がとても見えにくい！')
    if (bossMsg)               parts.push(bossMsg)
    if (parts.length === 0) return

    // 瘴気は紫。chaos橙・lucky水色を優先しつつ、それ以外で瘴気があれば紫、踏破済みのみなら灰
    const color = floorType === 'chaos' ? '#ff6600'
      : floorType === 'lucky' ? '#aaddff'
      : miasmaFloor ? '#b066ff'
      : this.floorIsCleared && !bossMsg ? '#9aa6b2'
      : '#ff4444'

    window.showEventMessage?.(parts.join('\n'), color)
  }

  // PC向け：ゲーム画面のクリックで、クリック先タイルの方向へ1歩進む（8方向）。
  // タッチ（モバイル）は仮想ジョイスティック維持のため無視する。
  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (this.isStatAllocOpen || this.isEquipModalOpen || this.isAnimating) return
    if (this.isPaused || this.inventoryOpen || this.isRescueNoticeOpen || this.isArcadeOpen) return

    const { player } = this.state
    const tx = Math.floor(pointer.worldX / this.rts)
    const ty = Math.floor(pointer.worldY / this.rts)

    // 弓装備中：射程内の敵のマスをタップ/クリック → その敵を狙い撃ち。
    // スマホはジョイスティック移動のため「向きで狙いを選ぶ」操作が不親切で、
    // 敵を直接タップして狙えるようにする（PCのクリックでも同じに動く）。
    if (weaponKindOf(player.equipment.weapon) === 'bow') {
      const enemy = this.state.enemies.find(e => e.position.x === tx && e.position.y === ty)
      if (enemy) {
        const dist = Math.abs(tx - player.position.x) + Math.abs(ty - player.position.y)
        if (
          dist >= 1 && dist <= BOW_RANGE &&
          this.isVisible(tx, ty) &&
          this.hasLineOfSight(player.position.x, player.position.y, tx, ty)
        ) {
          this.gameAttackById(enemy)
          return
        }
      }
    }

    // タッチの移動タップは無効（スマホの移動はジョイスティック。誤タップ移動を防ぐ）
    if (pointer.wasTouch) return

    const dx = Math.sign(tx - player.position.x)
    const dy = Math.sign(ty - player.position.y)
    if (dx === 0 && dy === 0) return   // 自分のタイルをクリック → 何もしない

    let key: string
    if      (dx === 0)            key = dy === -1 ? 'MoveUp'  : 'MoveDown'
    else if (dy === 0)            key = dx === -1 ? 'MoveLeft' : 'MoveRight'
    else if (dx === -1 && dy === -1) key = 'DiagUL'
    else if (dx ===  1 && dy === -1) key = 'DiagUR'
    else if (dx === -1 && dy ===  1) key = 'DiagDL'
    else                          key = 'DiagDR'

    this.handleInput({ key } as KeyboardEvent)
  }

  private handleInput(event: KeyboardEvent) {
    this.lastActionAt = Date.now()
    if (this.isStatAllocOpen || this.isEquipModalOpen || this.isAnimating) return
    if (this.isRescueNoticeOpen || this.isArcadeOpen) return
    if (event.key === 'Escape') {
      if (this.inventoryOpen) {
        this.toggleInventory()
      } else {
        this.togglePause()
      }
      return
    }
    if (event.key === 'i' || event.key === 'I') {
      if (!this.isPaused) this.toggleInventory()
      return
    }
    if (this.isPaused || this.inventoryOpen) return

    // 弓：その場から攻撃（🏹ボタンと同じ）。スペースキー移動系操作を持たないため、
    // マウス/タップに頼らずキーボードだけでも弓を撃てるようにする。
    if (event.key === ' ' || event.code === 'Space') {
      this.gameAttackById()
      return
    }

    const { player } = this.state
    let dx = 0
    let dy = 0

    const km       = localStorage.getItem('keyMode') ?? 'both'
    const useArr   = km !== 'wasd'
    const useWASD  = km !== 'arrows'
    const k        = event.key
    const code     = event.code ?? ''  // テンキーは event.key が '7' 等になるため code で判定

    // 斜め移動（テンキー・ローグライクキー q/e/z/c・バーチャルジョイスティック）
    if      (code === 'Numpad7' || k === 'DiagUL' || ((k === 'q' || k === 'Q') && useWASD)) { dx = -1; dy = -1 }
    else if (code === 'Numpad9' || k === 'DiagUR' || ((k === 'e' || k === 'E') && useWASD)) { dx =  1; dy = -1 }
    else if (code === 'Numpad1' || k === 'DiagDL' || ((k === 'z' || k === 'Z') && useWASD)) { dx = -1; dy =  1 }
    else if (code === 'Numpad3' || k === 'DiagDR' || ((k === 'c' || k === 'C') && useWASD)) { dx =  1; dy =  1 }
    // クリック移動用（keyModeに依存しない上下左右トークン）
    else if (k === 'MoveUp')    dy = -1
    else if (k === 'MoveDown')  dy =  1
    else if (k === 'MoveLeft')  dx = -1
    else if (k === 'MoveRight') dx =  1
    // 通常移動
    else if ((k === 'ArrowUp'    && useArr) || ((k === 'w' || k === 'W') && useWASD)) dy = -1
    else if ((k === 'ArrowDown'  && useArr) || ((k === 's' || k === 'S') && useWASD)) dy = 1
    else if ((k === 'ArrowLeft'  && useArr) || ((k === 'a' || k === 'A') && useWASD)) dx = -1
    else if ((k === 'ArrowRight' && useArr) || ((k === 'd' || k === 'D') && useWASD)) dx = 1
    else return

    // キーリピート抑制：移動トゥイーン（110ms）と歩調を合わせ、長押しでも滑らかに連続移動する
    const now = performance.now()
    if (now - this.lastMoveAt < 95) return
    this.lastMoveAt = now

    // 移動方向を記録
    this.playerDir = dirFromSign(dx, dy)

    // 泥の沼スロー処理
    if (player.mudTurns > 0) {
      // 泥：歩くたびに画面をブラウンにフラッシュして鈍足を演出
      this.cameras.main.flash(170, 120, 75, 30)
      player.mudTurns--
      if (player.mudSkipNext) {
        player.mudSkipNext = false
        if (player.mudTurns > 0) {
          window.showEventMessage?.(`泥沼で動きが鈍い…（残り${player.mudTurns}ターン）`, '#c2a020')
        } else {
          window.showEventMessage?.('泥沼の影響が消えた！', '#c2a020')
        }
        this.state.turn++
        this.enemyTurn()
        this.hungerTick()
        this.poisonTick()
        this.effectTick()
        this.renderMap()
        this.updateWindowGameState()
        return
      }
      player.mudSkipNext = true
    }

    const nx = player.position.x + dx
    const ny = player.position.y + dy

    // 斜め移動のコーナーカット防止（壁の角を斜めに越えない）
    if (dx !== 0 && dy !== 0) {
      if (this.state.map[player.position.y][nx] === 'wall') return
      if (this.state.map[ny][player.position.x] === 'wall') return
    }
    if (this.state.map[ny][nx] === 'wall') return

    // 町（あるかなひろば）の掲示板：体当たりで捜し人一覧（救出状況）を開く
    if (this.isEventFloor && this.signboardPos && this.signboardPos.x === nx && this.signboardPos.y === ny) {
      if (event.repeat) return
      window.dispatchEvent(new Event('signboard-open'))
      this.state.signboardUnread = false
      this.updateSignboardMark()
      return
    }

    // 町（あるかなひろば）の墓標：体当たりで墓標一覧（全プレイヤー共有）を開く
    if (this.isEventFloor && this.graveyardPos && this.graveyardPos.x === nx && this.graveyardPos.y === ny) {
      if (event.repeat) return
      this.openGraveyard()
      return
    }

    // 町（あるかなひろば）のげーせん筐体：体当たりでミニゲームを開く。
    // スプライトが縦に足元2マス分の高さで描かれるため、当たり判定も足元と1つ上の2マス分にする。
    if (this.isEventFloor && this.arcadePos && this.arcadePos.x === nx
      && (this.arcadePos.y === ny || this.arcadePos.y - 1 === ny)) {
      if (event.repeat) return
      this.openArcade()
      return
    }

    // 町（あるかなひろば）の装飾・建物タイルは通行不可（木/池/街灯/花/建物）
    if (this.isEventFloor && this.plazaBlocked.has(`${nx},${ny}`)) return

    // 牢屋の柵（jail）：進入不可。体当たりで開錠モーダルを開く（パターン3）。
    if (this.state.map[ny][nx] === 'jail') {
      if (event.repeat) return
      window.dispatchEvent(new Event('jail-open'))
      return
    }

    // イベントフロアNPC：タイルには進入できない（当たり判定）。体当たりで話しかける。
    // 以前は同じタイルに乗って起動する方式だったため、会話後にそのまま通過できてしまっていた。
    if (this.isEventFloor) {
      const facility = this.eventFacilities.find(f => f.position.x === nx && f.position.y === ny)
      if (facility) {
        if (event.repeat) return   // キーリピートでモーダルを連続オープンしない
        if (facility.kind === 'miner') { this.addMessage('採掘師「この泉、私が掘り当てたんだ。ゆっくり浸かってくれ」'); return }
        window.dispatchEvent(new CustomEvent('facility-open', { detail: facility.kind }))
        return
      }
    }

    // 徘徊する迷子NPC（パターン1）：体当たりで救出。
    if (this.floorRescue && this.floorRescue.position.x === nx && this.floorRescue.position.y === ny) {
      if (event.repeat) return
      const kind = this.floorRescue.kind
      this.floorRescue = null
      if (this.rescueSprite) { this.rescueSprite.destroy(); this.rescueSprite = null }
      this.rescueNpc(kind)
      this.renderMap()
      this.updateWindowGameState()
      return
    }

    const enemy = this.state.enemies.find(e => e.position.x === nx && e.position.y === ny)
    let didAttack = false
    if (enemy) {
      // 弓装備時は隣接へ移動(bump)した場合も近接attackEnemy()(STR基準)ではなく
      // 弓の攻撃(DEX基準)を使う。これが無いとDEX特化の弓使いが通路等での自然なbump操作のたびに
      // ほぼ無力なSTR攻撃を撃ってしまい、弓の存在意義が失われる。
      if (weaponKindOf(player.equipment.weapon) === 'bow') {
        this.attackWithBow(enemy)
      } else {
        this.attackEnemy(enemy)
      }
      didAttack = true
      this.lastActionWasAttack = true
      if (enemy.hp <= 0) this.lastMoveAt = performance.now() + 300
    } else {
      // キーリピート中、直前の行動が攻撃だった場合は移動をブロック（一度離して押し直す必要がある）
      if (event.repeat && this.lastActionWasAttack) return
      this.lastActionWasAttack = false
      player.position.x = nx
      player.position.y = ny

      if (this.state.map[ny][nx] === 'stairs') {
        if (this.isEventFloor) {
          // あるかなひろばの洞窟口は壁バンドに埋め込んで描画しているため、即時遷移だと
          // 「入り口に足が届く前にダンジョンへ移動した」ように感じてしまう。
          // 一度その場の移動を描画してから少し間を置いて遷移し、入り口に踏み込む動きを見せる。
          this.renderMap()
          this.time.delayedCall(220, () => this.nextFloor())
          return
        }
        this.nextFloor()
        return
      }

      if (this.state.map[ny][nx] === 'pitfall') {
        const fallDepth = 1 + Math.floor(Math.random() * 3)
        const fromFloor = this.state.player.floor
        const toFloor   = fromFloor + fallDepth
        playFall()
        this.isAnimating = true
        if (this.animatingTimer) clearTimeout(this.animatingTimer)
        this.animatingTimer = setTimeout(() => { this.isAnimating = false; this.animatingTimer = null }, 5000)
        this.renderMap()
        this.spinPlayer(3, 600, () => {
          this.state.player.floor += fallDepth - 1
          // 落とし穴は専用の落下音（playFall）を既に鳴らしているため、
          // populateFloor内の汎用「階段音」を重ねて鳴らさないよう抑制する
          this.skipNextStairsSound = true
          this.enterNormalFloor()
          this.time.delayedCall(80, () => {
            this.spinPlayer(3, 600, () => {
              this.isAnimating = false
              if (this.animatingTimer) { clearTimeout(this.animatingTimer); this.animatingTimer = null }
              window.showEventMessage?.(
                `落とし穴に落ちた！\nB§${fromFloor}§FからB§${toFloor}§Fへ転落した！`,
                '#ffffff'
              )
            })
          })
        })
        return
      }

      this.pickupItem()
      if (!this.awaitingEquipModal) this.checkTrap()
    }

    if (!this.awaitingEquipModal) {
      this.state.turn++
      this.enemyTurn()
      this.hungerTick()
      this.poisonTick()
      this.effectTick()
    }
    this.renderMap()
    this.updateWindowGameState()

    if (didAttack) {
      this.playAttackAnim()
      this.lungePlayer()
    } else {
      this.playWalkAnim()
    }
  }

  /** 攻撃時、プレイヤーを向いている方向へ小さく突進させる（やられた感の演出） */
  private lungePlayer() {
    const g = this.playerGraphic
    if (!g) return
    const vec: Record<typeof this.playerDir, [number, number]> = {
      'down': [0, 1], 'up': [0, -1], 'right': [1, 0], 'left': [-1, 0],
      'down-right': [1, 1], 'down-left': [-1, 1], 'up-right': [1, -1], 'up-left': [-1, -1],
    }
    const [vx, vy] = vec[this.playerDir]
    // 突進の基準は常にプレイヤーの現在タイル中心にする。
    // g.x基準＋tween重ねだと、同方向に連打した際に基準位置が前へ累積して
    // グラフィックだけ前進し続けてしまうため、毎回タイル中心へ戻してから突進する。
    const { x: bx, y: by } = this.tileToWorld(this.state.player.position.x, this.state.player.position.y)
    this.tweens.killTweensOf(g)
    g.setPosition(bx, by)
    this.tweens.add({
      targets: g,
      x: bx + vx * this.rts * 0.3,
      y: by + vy * this.rts * 0.3,
      duration: 80,
      yoyo: true,
      ease: 'Quad.Out',
      onComplete: () => { g.setPosition(bx, by) },
    })
  }

  private pickupItem() {
    const { items } = this.state
    const item = items.find(i => i.position.x === this.state.player.position.x && i.position.y === this.state.player.position.y)
    if (!item) return

    if (item.type === 'heal') {
      const sameCount = this.state.heals.filter(h => h.name === item.name).length
      if (sameCount >= 10) {
        if (item.coin) {
          // コインは満タンでもそのまま即消費してスロットストック＋１
          this.addMessage('もちものがいっぱいのため、取得した女神のコインをそのまま使った！')
          this.showPickupNotif('もちものがいっぱいのため、取得した女神のコインをそのまま使った！')
          window.spinSlotOnce?.()
        } else {
          this.addMessage(`${item.name}を手に入れたが、いっぱいのため宝箱へ戻した・・・`)
          return
        }
      } else {
        this.state.heals.push({ ...item, position: { x: 0, y: 0 } })
        this.addMessage(`${item.name}を拾った！`)
        this.showPickupNotif(`${item.name}を拾った！`)
      }
    } else if (item.type === 'spell' && item.spellType) {
      const sameCount = this.state.spells.filter(s => s.name === item.name).length
      if (sameCount >= 10) {
        this.addMessage(`${item.name}を手に入れたが、いっぱいのため宝箱へ戻した・・・`)
        return
      }
      this.state.spells.push({ ...item, position: { x: 0, y: 0 } })
      this.addMessage(`${item.name}を手に入れた！`)
      this.showPickupNotif(`${item.name}を手に入れた！`)
    } else if (item.type === 'equip' && item.equipSlot) {
      this.notifyIfMasterwork(item)
      // 装備モーダルを開く（ターン消費なし）
      this.pendingItem = item
      this.isEquipModalOpen = true
      this.awaitingEquipModal = true
    } else {
      return
    }

    this.state.items = items.filter(i => i.id !== item.id)
  }

  private showPickupNotif(text: string) {
    // PC・スマホともに EventMsgBar へ（キャンバス内テキストは使わない）
    window.showEventMessage?.(text, '#ffdd44')
  }

  /** 名匠装備の入手をワールド通知する（床ドロップ拾得・スロット当選の両経路から呼ぶ） */
  private notifyIfMasterwork(item: import('../types').Item) {
    if (!item.name.startsWith(MASTERWORK_PREFIX)) return
    fireWorldNotification(
      'achievement',
      '【名匠の逸品】',
      `${getDisplayName()}さんがB${this.state.player.floor}Fで「${item.name}」を手に入れました！`,
      `masterwork_${item.id}`,
    )
  }

  private doEquip(item: import('../types').Item) {
    if (!item.equipSlot) return
    const { player } = this.state
    const slot = item.equipSlot
    const old = player.equipment[slot]
    if (old) {
      player.maxHp -= old.hpBonus ?? 0
      player.hp = Math.min(player.hp, player.maxHp)
      player.str -= old.strBonus ?? 0; player.agi -= old.agiBonus ?? 0
      player.dex -= old.dexBonus ?? 0; player.int -= old.intBonus ?? 0
      player.vit -= old.vitBonus ?? 0; player.luk -= old.lukBonus ?? 0
      this.state.bag.push(old)
      this.addMessage(`${old.name}をバッグに戻した`)
    }
    player.equipment[slot] = item
    player.maxHp += item.hpBonus ?? 0
    player.hp    += item.hpBonus ?? 0
    player.str += item.strBonus ?? 0; player.agi += item.agiBonus ?? 0
    player.dex += item.dexBonus ?? 0; player.int += item.intBonus ?? 0
    player.vit += item.vitBonus ?? 0; player.luk += item.lukBonus ?? 0
    this.addMessage(`${item.name}を装備した！`)
    playEquip()
  }

  private resolveEquipModal(equip: boolean) {
    const item = this.pendingItem
    this.pendingItem = null
    this.isEquipModalOpen = false
    this.awaitingEquipModal = false
    if (!item) return

    if (equip) {
      this.doEquip(item)
      this.state.turn++
      this.enemyTurn()
      this.hungerTick()
      this.poisonTick()
      this.effectTick()
    } else {
      this.state.bag.push(item)
      this.addMessage(`${item.name}をバッグに入れた`)
      this.showPickupNotif(`${item.name}をバッグに入れた`)
    }
    this.renderMap()
    this.updateWindowGameState()
  }

  private equipFromBag(itemId: string) {
    if (this.isPaused || this.isStatAllocOpen) return
    const item = this.state.bag.find(b => b.id === itemId)
    if (!item) return
    this.state.bag = this.state.bag.filter(b => b.id !== itemId)
    this.doEquip(item)
    this.state.turn++
    this.enemyTurn()
    this.hungerTick()
    this.poisonTick()
    this.effectTick()
    this.renderMap()
    this.updateWindowGameState()
  }

  private discardFromBag(itemId: string) {
    if (this.isPaused || this.isStatAllocOpen) return
    const item = this.state.bag.find(b => b.id === itemId)
    if (!item) return
    if (item.locked) {
      this.addMessage(`${item.name}はロック中のため捨てられない（🔒を解除してください）`)
      this.updateWindowGameState()
      return
    }
    this.state.bag = this.state.bag.filter(b => b.id !== itemId)
    this.addMessage(`${item.name}を捨てた`)
    this.updateWindowGameState()
  }

  /** 装備品のロックON/OFF切替。ロック中は精錬の生贄に選べず、捨てることもできない（誤操作防止） */
  private toggleLockItem(itemId: string) {
    if (this.isPaused || this.isStatAllocOpen) return
    // バッグ内・装備中のどちらの装備品もロック対象にできる
    const item =
      this.state.bag.find(b => b.id === itemId) ??
      (Object.values(this.state.player.equipment) as (import('../types').Item | null)[])
        .find(e => e?.id === itemId) ?? null
    if (!item || item.type !== 'equip') return
    item.locked = !item.locked
    this.addMessage(item.locked ? `${item.name}をロックした 🔒` : `${item.name}のロックを解除した`)
    this.updateWindowGameState()
  }

  private checkTrap() {
    const { player, map } = this.state
    const tile = map[player.position.y][player.position.x]
    if (tile === 'trap') {
      const dmg = 3
      player.hp = Math.max(0, player.hp - dmg)
      player.poisoned = true
      player.poisonTurns = 5
      this.addMessage('ベノムダストを踏んだ！毒状態に！')
      window.showEventMessage?.(`毒の沼にハマってしまった\n残り§${player.poisonTurns}§ターン`, '#aa44ff')
      if (player.hp <= 0) { this.lastDeathCause = '毒の沼（ベノムダスト）'; this.gameOver() }
    }
    if (tile === 'mud') {
      player.mudTurns = 10
      player.mudSkipNext = false
      this.addMessage('泥の沼に踏み入った！10ターン動きが鈍くなる！')
      window.showEventMessage?.(`泥沼にハマってしまった\n残り§${player.mudTurns}§ターン`, '#c2a020')
    }
    if (tile === 'spring') {
      const key = `${player.position.x},${player.position.y}`
      if (this.state.driedSprings.includes(key)) {
        this.addMessage('泉は枯れている…')
      } else {
        player.hp = player.maxHp
        this.state.driedSprings.push(key)
        this.addMessage('回復の泉に浸かった')
        // 泉が枯れる見た目に切り替え（テーマ付きv2があれば優先）
        const sprite = this.tileSprites[player.position.y]?.[player.position.x]
        const dryKey = this.themedTileKey('spring-dry', 'tile-spring-dry')
        if (sprite && this.textureOk(dryKey)) {
          sprite.setTexture(dryKey).setDisplaySize(this.rts + 6, this.rts + 6)
        }
      }
    }
  }

  private attackEnemy(enemy: typeof this.state.enemies[0]) {
    // すかるぽりん専用戦闘（命中率10%、ヒット時は必ず1ダメージ）
    if (enemy.isSkulporin) {
      this.attackSkulporin(enemy)
      return
    }

    const { player } = this.state
    const effectiveAtk  = Math.floor(player.str * 1.5) + player.level
    const attackCount   = playerAttackCount(player.agi)
    const hitRate       = Math.min(1.00, 0.90 + player.dex * 0.001)
    const critRate      = player.luk * 0.0015
    const playerPierce  = PIERCE_RATE + dexPierceBonus(player.dex)
    // トドメ演出用：攻撃方向は連撃中不変なのでループ外で確定し、最後に命中したhitのクリット状態を控える
    const kdx = Math.sign(enemy.position.x - player.position.x)
    const kdy = Math.sign(enemy.position.y - player.position.y)
    let killingCrit = false
    let killVisualDelay = 0

    for (let hit = 0; hit < attackCount; hit++) {
      if (enemy.hp <= 0) break

      if (Math.random() > hitRate) {
        this.addMessage(`${enemy.name}への攻撃がはずれた！`)
        this.popDamageNumber(enemy.position.x, enemy.position.y, '', { miss: true })
        continue
      }

      const isCrit = Math.random() < critRate
      // 敵のVITを防御に加算（VIT＝被ダメ軽減。プレイヤーのvitと対称）
      const enemyDef = enemy.defense + enemy.vit
      // 割合貫通：基礎6%＋DEX超過ぶんは防御を無視して必ず通る（防御の青天井による完全無敵化を防ぐ）
      const raw    = Math.max(1, Math.round(effectiveAtk * playerPierce), effectiveAtk - enemyDef)
      const dmg    = isCrit ? Math.floor(raw * 1.5) : raw
      enemy.hp = Math.max(0, enemy.hp - dmg)
      killingCrit = isCrit

      // ヒット演出：ヒットストップ＋ダメージ数字ポップ＋敵フラッシュ＋のけぞり＋火花（連撃は少し時間差で）
      if (hit === 0) this.hitStop(isCrit)
      const delay = hit * 70
      killVisualDelay = delay
      this.time.delayedCall(delay, () => {
        if (this.isVisible(enemy.position.x, enemy.position.y)) {
          this.popDamageNumber(enemy.position.x, enemy.position.y, dmg, { crit: isCrit })
          this.flashSprite(enemy.id)
          this.recoilEnemy(
            enemy.id,
            Math.sign(enemy.position.x - player.position.x),
            Math.sign(enemy.position.y - player.position.y),
            isCrit ? 0.34 : 0.22,
          )
          const eg = this.enemyGraphics.get(enemy.id)
          if (eg) {
            this.spawnBurst(eg.x, eg.y, {
              color: isCrit ? 0xffdd33 : 0xffffff,
              count: isCrit ? 9 : 4,
              speed: this.rts * (isCrit ? 1.1 : 0.6),
            })
          }
        }
      })

      if (isCrit) {
        playCrit()
        this.cameras.main.shake(120, 0.006)
        this.addMessage(`${enemy.name}にクリティカル！${dmg}ダメージ！`)
      } else {
        playAttack()
        this.addMessage(`${enemy.name}に${dmg}ダメージ！`)
      }
    }

    if (enemy.hp <= 0) this.killEnemy(enemy, { crit: killingCrit, dx: kdx, dy: kdy, visualDelay: killVisualDelay })
  }

  /**
   * 弓の通常攻撃：射程内(BOW_RANGE)の敵を攻撃する。
   * target省略時は射程内でプレイヤーの向いている方向にいる敵を優先し、いなければ最も近い敵へ
   * フォールバックしてオートターゲットする（🏹ボタン用。狙った方向を向いてから撃つと反映される）。
   * target指定時はその敵を対象に、隣接(dist=1)からの移動bump攻撃として扱う
   * （bump時に近接attackEnemy()へ誤フォールバックしないための経路）。
   * 近接attackEnemy()と異なり、隣接不要・距離に応じて命中率が下がる。
   * bump(dist=1)ではない真の遠距離弾(dist>1)には先制ボーナス(+30%)が乗る。
   * 戻り値: 攻撃を実行できたか（false=射程内に敵がいない＝ターン消費させない）
   */
  private attackWithBow(target?: import('../types').Enemy): boolean {
    const { player, enemies } = this.state
    if (weaponKindOf(player.equipment.weapon) !== 'bow') return false

    // すかるぽりんは武器種によらず専用戦闘（命中率10%、ヒット時は必ず1ダメージ）で固定
    if (target?.isSkulporin) { this.attackSkulporin(target); return true }

    let enemy: import('../types').Enemy
    let dist: number
    if (target) {
      enemy = target
      dist  = Math.abs(target.position.x - player.position.x) + Math.abs(target.position.y - player.position.y)
      // 標的の方向を向く（bump時は移動方向と同じ。タップ狙撃時はここで初めて向きが決まる）
      this.playerDir = dirFromSign(
        Math.sign(target.position.x - player.position.x),
        Math.sign(target.position.y - player.position.y),
      )
    } else {
      const inRange = enemies
        .map(e => ({
          e,
          dist: Math.abs(e.position.x - player.position.x) + Math.abs(e.position.y - player.position.y),
        }))
        .filter(o => o.dist <= BOW_RANGE)
        .filter(o => this.hasLineOfSight(player.position.x, player.position.y, o.e.position.x, o.e.position.y))

      if (inRange.length === 0) {
        this.addMessage('射程内に敵がいない！')
        return false
      }

      // プレイヤーが向いている方向にいる敵を優先ターゲットにする（狙った敵を選べない、という不満対策）。
      // 向き先に誰もいなければ、これまで通り最も近い敵へフォールバックし、ボタンが空振りしないようにする。
      const [fx, fy] = FACING_VEC[this.playerDir]
      const faced = inRange.filter(o => {
        const esx = Math.sign(o.e.position.x - player.position.x)
        const esy = Math.sign(o.e.position.y - player.position.y)
        return (fx === 0 || esx === fx) && (fy === 0 || esy === fy)
      })
      const pool = faced.length > 0 ? faced : inRange
      const nearest = pool.reduce((a, b) => (a.dist <= b.dist ? a : b))
      enemy = nearest.e
      dist  = nearest.dist
      // 射る敵の方向を向く（攻撃アニメの向き・次弾の照準優先方向に反映）
      this.playerDir = dirFromSign(
        Math.sign(enemy.position.x - player.position.x),
        Math.sign(enemy.position.y - player.position.y),
      )
      if (enemy.isSkulporin) { this.attackSkulporin(enemy); return true }
    }

    // 先制ボーナス：隣接(bump)ではなく、真に離れた位置(dist>1)から先制した一撃には威力+30%。
    // bump時と全く同じ火力になってしまうと「弓としての強み」が命中率減衰だけになるため、
    // 「敵が詰め寄る前に狙い撃つ」というプレイに明確な報酬を用意する。
    const isOpeningShot = dist > 1

    // ── 剣との差別化（弓が単純上位互換にならないための2つのコスト）──
    // (1) 至近距離ペナルティ：隣接(bump含む)では弓を引き絞れず威力半減 → 隣接戦は剣の領分
    const isPointBlank = dist === 1
    if (isPointBlank) this.addMessage('近すぎて弓を引き絞れない！（威力半減）')
    // (2) 射撃コスト：1射撃ごとにスタミナ-5（通常のhungerTickは3ターンで-1なので15ターン分）。
    //     「射程の安全はスタミナ（＝食料経済）で買う」。低資源・長期戦では剣が有利になる。
    player.stamina = Math.max(0, player.stamina - 5)

    // ダメージは近接の対称式(str*1.5+level)よりやや低い係数(dex*1.4+level)。
    // 「安全な距離から先制できる」分の調整はBOW_RANGE/命中率側で行い、火力そのものは大きく削らない
    // （検証:等投資STR255vsDEX同値の理論DPS比が約59%だったため、ランキング等進行速度を競う
    //   ヘビー層で"完全な劣化選択"にならないよう1.3→1.4へ微調整）。
    const effectiveAtk = Math.floor(player.dex * 1.4) + player.level
    const attackCount  = bowAttackCount(player.agi)
    const baseHit      = 0.95 + player.dex * 0.0008
    const hitRate      = Math.max(0.15, Math.min(1.00, baseHit - Math.max(0, dist - 1) * 0.10))
    const critRate     = player.luk * 0.0022
    // 割合貫通：基礎4%＋DEXボーナス（近接のdexPierceBonusを流用）。DEXが主力の弓は貫通が伸びやすい。
    const playerPierce = BOW_PIERCE_RATE + dexPierceBonus(player.dex)
    // トドメ演出用：攻撃方向は連射中不変なのでループ外で確定し、最後に命中したhitのクリット状態を控える
    const kdx = Math.sign(enemy.position.x - player.position.x)
    const kdy = Math.sign(enemy.position.y - player.position.y)
    let killingCrit = false
    let killVisualDelay = 0

    for (let hit = 0; hit < attackCount; hit++) {
      if (enemy.hp <= 0) break

      const delay    = hit * 70
      // 飛翔時間：距離に比例（多段時は矢が連なって見えるようdelayと同程度のオーダーに収める）
      const flightMs = 60 + dist * 35

      if (Math.random() > hitRate) {
        this.addMessage(`${enemy.name}への矢がはずれた！`)
        // はずれ矢は敵マスを通り過ぎて1マス奥へ飛び抜ける
        this.fireArrowEffect(
          player.position.x, player.position.y,
          enemy.position.x + Math.sign(enemy.position.x - player.position.x),
          enemy.position.y + Math.sign(enemy.position.y - player.position.y),
          delay, flightMs * 1.3,
        )
        this.time.delayedCall(delay + flightMs, () => {
          if (this.isVisible(enemy.position.x, enemy.position.y)) {
            this.popDamageNumber(enemy.position.x, enemy.position.y, '', { miss: true })
          }
        })
        continue
      }

      const isCrit = Math.random() < critRate
      const enemyDef = enemy.defense + enemy.vit
      const raw = Math.max(1, Math.round(effectiveAtk * playerPierce), effectiveAtk - enemyDef)
      let dmg = isCrit ? Math.floor(raw * 1.8) : raw
      if (isOpeningShot) dmg = Math.floor(dmg * 1.3)
      if (isPointBlank)  dmg = Math.max(1, Math.floor(dmg * 0.5))
      // 弓の総合火力調整：会心・先制・至近距離補正まで含めた最終ダメージを1/2に圧縮
      dmg = Math.max(1, Math.floor(dmg / 2))
      enemy.hp = Math.max(0, enemy.hp - dmg)
      killingCrit = isCrit
      killVisualDelay = delay + flightMs

      // 矢が飛び、着弾したタイミングでダメージ演出を出す（着弾瞬間にヒットストップ＋のけぞり）
      this.fireArrowEffect(player.position.x, player.position.y, enemy.position.x, enemy.position.y, delay, flightMs)
      this.time.delayedCall(delay + flightMs, () => {
        if (this.isVisible(enemy.position.x, enemy.position.y)) {
          if (hit === 0) this.hitStop(isCrit)
          this.popDamageNumber(enemy.position.x, enemy.position.y, dmg, { crit: isCrit })
          this.flashSprite(enemy.id)
          this.recoilEnemy(
            enemy.id,
            Math.sign(enemy.position.x - player.position.x),
            Math.sign(enemy.position.y - player.position.y),
            isCrit ? 0.30 : 0.18,
          )
          const eg = this.enemyGraphics.get(enemy.id)
          if (eg) {
            this.spawnBurst(eg.x, eg.y, {
              color: isCrit ? 0xffdd33 : 0xffffff,
              count: isCrit ? 9 : 4,
              speed: this.rts * (isCrit ? 1.1 : 0.6),
            })
          }
        }
      })

      if (isCrit) {
        playCrit()
        this.cameras.main.shake(120, 0.006)
        this.addMessage(
          isOpeningShot
            ? `${enemy.name}に会心の不意打ち！${dmg}ダメージ！`
            : `${enemy.name}にクリティカル！${dmg}ダメージ！`
        )
      } else {
        playAttack()
        this.addMessage(
          isOpeningShot
            ? `${enemy.name}に不意打ち！${dmg}ダメージ！`
            : `${enemy.name}に${dmg}ダメージ！`
        )
      }
    }

    if (enemy.hp <= 0) this.killEnemy(enemy, { crit: killingCrit, dx: kdx, dy: kdy, visualDelay: killVisualDelay })
    return true
  }

  /** 矢のテクスチャ（+x向き：羽・シャフト・鏃）をGraphicsから一度だけ生成する */
  private ensureArrowTexture() {
    if (this.textures.exists('bow-arrow')) return
    const g = this.add.graphics().setVisible(false)
    g.fillStyle(0xf2f2f2)
    g.fillTriangle(0, 8, 9, 3, 9, 13)      // 羽
    g.fillStyle(0xb98a44)
    g.fillRect(8, 7, 22, 3)                // シャフト
    g.fillStyle(0xffe28a)
    g.fillTriangle(38, 8, 28, 3, 28, 13)   // 鏃
    g.generateTexture('bow-arrow', 40, 16)
    g.destroy()
  }

  /** 矢の飛翔エフェクト：発射マスから対象マスへ矢の画像を回転を合わせて飛ばす（見た目のみ） */
  private fireArrowEffect(fromTx: number, fromTy: number, toTx: number, toTy: number, delay: number, flightMs: number) {
    this.ensureArrowTexture()
    this.time.delayedCall(delay, () => {
      if (!this.isVisible(fromTx, fromTy) && !this.isVisible(toTx, toTy)) return
      const from = this.tileToWorld(fromTx, fromTy)
      const to   = this.tileToWorld(toTx, toTy)
      const arrow = this.add.image(from.x, from.y, 'bow-arrow')
        .setDepth(7)
        .setScale(this.rts / 44)
        .setRotation(Math.atan2(to.y - from.y, to.x - from.x))
      this.tweens.add({
        targets: arrow,
        x: to.x, y: to.y,
        duration: flightMs,
        ease: 'Linear',
        onComplete: () => arrow.destroy(),
      })
    })
  }

  /**
   * 弓の攻撃ボタン用エントリポイント（window.gameAttack）。行動→ターン消費はuseSpellById等と同型。
   * target指定時（敵タップ狙撃）はその敵を、省略時はオートターゲットで攻撃する。
   */
  private gameAttackById(target?: import('../types').Enemy) {
    if (this.isPaused || this.isStatAllocOpen || this.inventoryOpen) return
    const { player } = this.state
    if (weaponKindOf(player.equipment.weapon) !== 'bow') return

    // 連打・キーリピート抑制：Space分岐は移動系スロットル(95ms)より手前でreturnするため、
    // ここで抑えないと長押しで1秒に数十ターン進みスタミナが溶ける。移動と同じlastMoveAtを共有し、
    // 攻撃(敵ターン込み)は移動より少し長めの間隔にする。
    const now = performance.now()
    if (now - this.lastMoveAt < 180) return
    this.lastMoveAt = now

    const acted = this.attackWithBow(target)
    if (!acted) {
      this.renderMap()
      this.updateWindowGameState()
      return
    }

    // attackWithBow内で標的の方向を向いているので、その向きで攻撃アニメを再生
    this.playAttackAnim()
    this.state.turn++
    this.enemyTurn()
    this.hungerTick()
    this.poisonTick()
    this.effectTick()
    this.renderMap()
    this.updateWindowGameState()
  }

  /**
   * 剣⇔弓のクイック切替（window.gameSwapWeapon）。バッグ内の異種武器のうち
   * 合計ボーナスが最大のものへ持ち替える。通常の装備と同じくターンを消費する
   * （equipFromBag経由）ので、戦闘中の持ち替えは「1ターン払う」戦術判断になる。
   */
  private gameSwapWeapon() {
    if (this.isPaused || this.isStatAllocOpen || this.inventoryOpen) return
    const { player } = this.state
    const targetKind = weaponKindOf(player.equipment.weapon) === 'bow' ? 'melee' : 'bow'
    const candidates = this.state.bag.filter(b => b.equipSlot === 'weapon' && weaponKindOf(b) === targetKind)
    if (candidates.length === 0) return

    const score = (i: import('../types').Item) =>
      (i.strBonus ?? 0) + (i.agiBonus ?? 0) + (i.dexBonus ?? 0) +
      (i.intBonus ?? 0) + (i.vitBonus ?? 0) + (i.lukBonus ?? 0) + (i.hpBonus ?? 0) * 0.2
    const best = candidates.reduce((a, b) => (score(a) >= score(b) ? a : b))
    this.equipFromBag(best.id)
  }

  /** 敵を撃破：状態から除去し、撃破演出（縮小フェード＋破片）・経験値・レベルアップ処理を行う */
  private killEnemy(enemy: import('../types').Enemy, opts: { crit?: boolean; dx?: number; dy?: number; visualDelay?: number } = {}) {
    if (enemy.isDoppelganger) { this.killDoppelganger(enemy); return }
    const { player } = this.state
    this.state.enemies = this.state.enemies.filter(e => e.id !== enemy.id)
    if (enemy.isBoss) {
      const m = enemy.name.match(/^【(MINI|MVP|エリア)】(.+)$/)
      if (m) {
        const [, kind, bossName] = m
        const title = kind === 'MVP' ? '【MVP討伐】' : kind === 'エリア' ? '【エリアボス討伐】' : '【討伐速報】'
        fireWorldNotification('boss', title, `${getDisplayName()}さんが${bossName}を討伐しました！`)
      }
    }
    const baseExp = enemy.isBoss ? (50 + enemy.maxHp) : (5 + enemy.maxHp)
    // 弱虫は経験値2倍（逃げる敵を追いかける報酬）。召喚体はゼロ（召喚無限狩り対策）。
    // 踏破済みフロアでは経験値ゼロにして周回レベリングを無効化
    const persMult = enemy.personality === 'coward' ? 2 : 1
    const expGain = (this.floorIsCleared || enemy.isSummoned) ? 0 : baseExp * persMult
    player.exp += expGain
    this.addMessage(
      this.floorIsCleared ? `${enemy.name}を倒した！（踏破済み：経験値なし）`
      : enemy.isSummoned  ? `${enemy.name}を倒した！（召喚体：経験値なし）`
      : enemy.personality === 'coward' ? `${enemy.name}を追い詰めて倒した！経験値+${expGain}（2倍）`
      : `${enemy.name}を倒した！経験値+${expGain}`
    )

    // 女神のコイン：撃破時20%＋LUKで微増（上限30%）でその場にドロップ（踏破済みフロアではドロップなし）
    // 弱虫はコイン確定ドロップ（宝持ちのコソ泥）。召喚体はドロップなし。
    const coinDropRate = enemy.personality === 'coward' ? 1.0 : Math.min(0.30, 0.20 + player.luk * 0.0002)
    if (!this.floorIsCleared && !enemy.isSummoned && Math.random() < coinDropRate) {
      this.state.items.push({
        id: `coin_${enemy.id}_${Date.now()}`,
        name: '女神のコイン',
        type: 'heal',
        position: { x: enemy.position.x, y: enemy.position.y },
        coin: true,
      })
      this.addMessage('女神のコインがドロップした！')
    }

    const g   = this.enemyGraphics.get(enemy.id)
    const bar = this.enemyHpBars.get(enemy.id)
    this.enemyGraphics.delete(enemy.id)
    this.enemyHpBars.delete(enemy.id)
    if (bar) { bar.bg.destroy(); bar.fg.destroy() }
    // 攻撃可能マークも撤去（撃破時にマップから即削除するため描画ループのクリーンアップでは拾えない）
    this.destroyEnemyDecor(enemy.id)
    if (g) {
      this.tweens.killTweensOf(g)
      if (g.visible) {
        // 弓の矢は着弾までflightMs分の飛翔時間があり、多段攻撃は1発ごとにdelay(hit*70ms)がある。
        // トドメの演出をここで即時発火すると「矢が飛んでいる最中に敵が爆散して消える」という
        // 演出上の矛盾（着弾前に消滅）が起きるため、命中演出と同じタイミングまで遅延させる。
        // データ側（経験値・コインドロップ・敵配列からの除去等）は上ですでに確定済みなので、
        // ここで遅延させるのは見た目の反応（バースト・カメラ演出・消滅トゥイーン）のみ。
        const playDeathFx = () => {
          // 遅延中にシーン遷移・ゲームオーバー等でグラフィックが既に破棄されている場合は何もしない
          if (!g.active || !this.scene?.isActive()) return
          this.spawnBurst(g.x, g.y, {
            color: enemy.isBoss ? 0xffcc44 : 0xff8866,
            count: enemy.isBoss ? 14 : 7,
            speed: this.rts * (enemy.isBoss ? 1.4 : 0.9),
          })
          this.countKillCombo(g.x, g.y)

          if (enemy.isBoss) {
            // ボス撃破：吹っ飛ばさず、質量を感じる「沈み込むような」崩れ落ち
            playKill(true)
            this.cameras.main.shake(220, 0.008)
            this.cameras.main.flash(200, 255, 240, 190)
            this.freezeTime(0.25, 450)
            this.time.delayedCall(60, () => {
              if (g.active) this.spawnBurst(g.x, g.y, { color: 0xffffff, count: 10, speed: this.rts * 2.0 })
            })
            this.tweens.add({
              targets: g,
              y: g.y + this.rts * 0.18,
              alpha: 0,
              scaleX: g.scaleX * 0.3,
              scaleY: g.scaleY * 0.2,
              angle: g.angle + (Math.random() < 0.5 ? -8 : 8),
              duration: 480,
              ease: 'Cubic.In',
              onComplete: () => g.destroy(),
            })
          } else if (opts.crit && (opts.dx || opts.dy)) {
            // クリティカルの止め：一瞬の間 → 回転しながら攻撃方向へ吹き飛ぶ
            // ヒットストップは60fpsで3フレーム(50ms)では知覚できないため150ms程度まで伸ばす
            playKill()
            this.freezeTime(0.12, 150)
            this.cameras.main.shake(160, 0.012)
            const spin = (Math.random() < 0.5 ? -1 : 1) * (420 + Math.random() * 220)
            this.tweens.add({
              targets: g,
              x: g.x + (opts.dx ?? 0) * this.rts * 3.6,
              y: g.y + (opts.dy ?? 0) * this.rts * 3.6,
              angle: g.angle + spin,
              scaleX: g.scaleX * 0.35,
              scaleY: g.scaleY * 0.35,
              alpha: 0,
              duration: 420,
              ease: 'Cubic.In',
              onComplete: () => g.destroy(),
            })
            this.time.delayedCall(90, () => {
              if (g.active) this.spawnBurst(g.x, g.y, { color: 0xffdd33, count: 5, speed: this.rts * 0.7 })
            })
          } else {
            // 通常撃破：一瞬潰れてから崩れ落ちる、重さを感じる二段演出
            // 旧: freezeTime(0.3,50)/shake(90,0.005) は短すぎ・弱すぎて知覚できていなかった
            playKill()
            this.freezeTime(0.25, 120)
            this.cameras.main.shake(110, 0.011)
            this.tweens.add({
              targets: g,
              scaleX: g.scaleX * 1.12,
              scaleY: g.scaleY * 0.8,
              duration: 45,
              ease: 'Quad.Out',
              onComplete: () => {
                // squashトゥイーンの完了後にシーンが非アクティブ化している可能性をガード
                if (!g.active) return
                this.tweens.add({
                  targets: g,
                  alpha: 0,
                  scaleX: g.scaleX * 0.15,
                  scaleY: g.scaleY * 0.15,
                  angle: g.angle + 100,
                  y: g.y + this.rts * 0.1,
                  duration: 260,
                  ease: 'Quad.In',
                  onComplete: () => g.destroy(),
                })
              },
            })
          }
        }

        const vd = Math.max(0, opts.visualDelay ?? 0)
        if (vd > 0) this.time.delayedCall(vd, playDeathFx)
        else playDeathFx()
      } else {
        g.destroy()
      }
    }

    this.checkLevelUp()
    window.onEnemyKilled?.()
    logEvent('kill', { floor: this.state.player.floor, enemy_name: enemy.name, is_boss: enemy.isBoss })

    // パターン2：このフロアの敵を全滅させたら救出イベント発生（主人公の隣に現れて即救済）
    if (this.pendingClearRescue && this.state.enemies.length === 0) {
      const kind = this.pendingClearRescue
      this.pendingClearRescue = null
      this.rescueNpc(kind)
      this.renderMap()
    }
  }

  /**
   * ヒットストップ/スローモーション：tween・タイマー・アニメを一瞬遅くして打撃の「重さ」を出す。
   * realMs は実時間（setTimeoutなのでタイムスケールの影響を受けない）。多重発動はネスト管理し、
   * 最後の1つが終わった時だけ等速へ復帰する。
   */
  private freezeTime(scale: number, realMs: number) {
    // 撃破演出の呼び出し頻度が増えたため、シーンが既に非アクティブ（フロア遷移直後・ゲームオーバー等）な
    // 状態での誤発火を防ぐガードを追加。
    if (!this.scene?.isActive()) return
    this.timeFreezeDepth++
    this.tweens.timeScale = scale
    this.time.timeScale = scale
    this.anims.globalTimeScale = scale
    setTimeout(() => {
      this.timeFreezeDepth = Math.max(0, this.timeFreezeDepth - 1)
      if (this.timeFreezeDepth === 0 && this.scene?.isActive()) {
        this.tweens.timeScale = 1
        this.time.timeScale = 1
        this.anims.globalTimeScale = 1
      }
    }, realMs)
  }

  /** 攻撃命中時のヒットストップ（通常45ms／クリティカル90ms） */
  private hitStop(crit: boolean) {
    this.freezeTime(0.05, crit ? 90 : 45)
  }

  /** 敵に付随する全マーカー・エフェクト（⚔️💀⚠️・カウントダウン・もや・💢）を破棄する */
  private destroyEnemyDecor(id: string) {
    const maps: Map<string, Phaser.GameObjects.Text | Phaser.GameObjects.Image>[] = [
      this.attackMarkers, this.dangerMarkers, this.dangerGlows, this.chargeMarkers,
      this.countdownMarkers, this.mistSprites, this.buffMarkers, this.aimMarkers,
    ]
    for (const m of maps) {
      const obj = m.get(id)
      if (obj) { this.tweens.killTweensOf(obj); obj.destroy(); m.delete(id) }
    }
  }

  /** 被弾した敵を攻撃方向へ小さく弾く「のけぞり」。dx/dyは攻撃の進行方向(-1/0/1) */
  private recoilEnemy(enemyId: string, dx: number, dy: number, strength = 0.22) {
    const g = this.enemyGraphics.get(enemyId)
    if (!g || !g.visible) return
    // 相対トゥイーン(+=)は多段ヒットやボスの反撃突進と飛行中に重なると
    // 「ズレた位置」を開始点として記録し、恒久的な位置ズレが蓄積する。
    // タイル座標由来の正位置(home)へ一度スナップしてから絶対座標で弾き、完了時に必ず戻す。
    const enemy = this.state.enemies.find(e => e.id === enemyId)
    const home = enemy
      ? this.tileToWorld(enemy.position.x, enemy.position.y)
      : { x: g.x, y: g.y }
    this.tweens.killTweensOf(g)
    g.setPosition(home.x, home.y)
    this.tweens.add({
      targets: g,
      x: home.x + dx * this.rts * strength,
      y: home.y + dy * this.rts * strength,
      duration: 55,
      yoyo: true,
      ease: 'Quad.Out',
      onComplete: () => { if (g.active) g.setPosition(home.x, home.y) },
    })
  }

  /** 連続撃破コンボの計上と「n連撃破！」ポップ。倒した位置(world座標)に出す */
  private countKillCombo(wx?: number, wy?: number) {
    const now = Date.now()
    this.killComboCount = now - this.killComboAt < 3500 ? this.killComboCount + 1 : 1
    this.killComboAt = now
    const n = this.killComboCount
    if (n < 2 || wx === undefined || wy === undefined) return

    const hot   = n >= 4
    const label = this.add.text(wx, wy - this.rts * 0.8, `${n}連撃破！`, {
      fontSize: `${Math.round(this.rts * (hot ? 0.66 : 0.52))}px`,
      fontFamily: 'Arial, sans-serif',
      color: hot ? '#ff8a2a' : '#ffdd33',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: Math.max(3, Math.round(this.rts * 0.09)),
    }).setOrigin(0.5).setDepth(21).setScale(0.3).setAngle(-6)
    this.tweens.add({ targets: label, scale: 1, angle: 0, duration: 180, ease: 'Back.Out' })
    this.tweens.add({
      targets: label,
      y: wy - this.rts * 1.7,
      alpha: 0,
      delay: 380,
      duration: 520,
      ease: 'Cubic.Out',
      onComplete: () => label.destroy(),
    })
    if (hot) {
      playCrit()
      this.cameras.main.flash(120, 255, 170, 60)
    }
    if (n >= 3) {
      // 連続撃破の勢いをカメラの一瞬のズームパンチで表現
      this.tweens.killTweensOf(this.cameras.main)
      this.cameras.main.zoom = 1
      this.tweens.add({ targets: this.cameras.main, zoom: 1.045, duration: 70, yoyo: true, ease: 'Quad.Out' })
    }
  }

  /** 小さな破片を放射状に飛ばす汎用パーティクル（ヒット火花・撃破演出） */
  private spawnBurst(wx: number, wy: number, opts: { color?: number; count?: number; speed?: number } = {}) {
    const { color = 0xffeeaa, count = 6, speed = this.rts * 0.9 } = opts
    const size = Math.max(2, Math.round(this.rts * 0.09))
    for (let i = 0; i < count; i++) {
      const ang  = Math.random() * Math.PI * 2
      const dist = speed * (0.5 + Math.random() * 0.7)
      const p = this.add.rectangle(wx, wy, size, size, color).setDepth(19)
      this.tweens.add({
        targets: p,
        x: wx + Math.cos(ang) * dist,
        y: wy + Math.sin(ang) * dist,
        alpha: 0,
        scale: 0.3,
        duration: 260 + Math.random() * 160,
        ease: 'Cubic.Out',
        onComplete: () => p.destroy(),
      })
    }
  }

  private checkLevelUp() {
    const { player } = this.state
    const expNeeded = player.level * 30 + 10
    if (player.exp >= expNeeded) {
      player.exp -= expNeeded
      const prevLevel = player.level
      player.level++
      player.maxHp += 5
      player.hp = player.maxHp
      this.grantStatPoints(5)
      this.addMessage(`レベルアップ！Lv${player.level}  +5ステータスポイント！`)
      playLevelUp()
      this.playLevelUpEffect()
      this.showLevelUpNotif(prevLevel, player.level)
      if (player.level % 10 === 0) {
        fireWorldNotification('world', '【ワールド】', `${getDisplayName()}さんがLv${player.level}に到達しました！`, `lv:${player.level}`)
      }
      this.updateWindowGameState()
    }
  }

  private showLevelUpNotif(prevLevel: number, newLevel: number) {
    // enemyTurn() の同期メッセージ群が EventMsgBar に流れた後に表示する
    setTimeout(() => {
      window.showEventMessage?.(`⚔レベルアップ⚔\nLv${prevLevel}→Lv${newLevel} になりました`, '#ffdd44')
    }, 150)
  }

  /** レベルアップ演出：金色の閃光＋プレイヤー足元からの拡散リング＋「LEVEL UP」上昇テキスト */
  private playLevelUpEffect() {
    const { player } = this.state
    const { x, y } = this.tileToWorld(player.position.x, player.position.y)

    // 画面全体に淡い金フラッシュ
    this.cameras.main.flash(260, 255, 220, 80)

    // 拡散する金リング（Graphics circleをtweenで拡大＋フェード）
    const ring = this.add.circle(x, y, this.rts * 0.4, 0xffdd44, 0)
      .setStrokeStyle(Math.max(2, Math.round(this.rts * 0.08)), 0xffee88, 0.9)
      .setDepth(19)
    this.tweens.add({
      targets: ring,
      radius: this.rts * 1.8,
      alpha: 0,
      duration: 600,
      ease: 'Cubic.Out',
      onUpdate: () => ring.setStrokeStyle(Math.max(2, Math.round(this.rts * 0.08)), 0xffee88, ring.alpha),
      onComplete: () => ring.destroy(),
    })

    // 上昇する「LEVEL UP」テキスト
    const label = this.add.text(x, y - this.rts * 0.6, 'LEVEL UP!', {
      fontSize: `${Math.round(this.rts * 0.5)}px`,
      fontFamily: 'Arial, sans-serif',
      color: '#ffee66',
      fontStyle: 'bold',
      stroke: '#7a4a00',
      strokeThickness: Math.max(3, Math.round(this.rts * 0.12)),
    }).setOrigin(0.5).setDepth(21).setScale(0.5)
    this.tweens.add({ targets: label, scale: 1, duration: 200, ease: 'Back.Out' })
    this.tweens.add({
      targets: label,
      y: y - this.rts * 1.6,
      alpha: 0,
      delay: 400,
      duration: 700,
      ease: 'Cubic.In',
      onComplete: () => label.destroy(),
    })
  }

  private doAllocateStat(stat: AllocStat) {
    const { player } = this.state
    if (player.statPoints <= 0) return
    player[stat]++
    player.statPoints--
    this.updateWindowGameState()
  }

  /** ステータスポイントをまとめて振り分ける（数字入力による一括割り振り用）。
   *  1回のupdateWindowGameStateで済ませ、長押し連打を大量回数分エミュレートしない。 */
  private doAllocateStatBulk(stat: AllocStat, amount: number) {
    const { player } = this.state
    const n = Math.max(0, Math.min(Math.floor(amount), player.statPoints))
    if (n <= 0) return
    player[stat] += n
    player.statPoints -= n
    this.updateWindowGameState()
  }

  /**
   * ステータスポイントを付与する共通ヘルパー。未消費分(statPoints)に加え、
   * 生涯累計(totalStatPointsEarned)も同時に加算する。累計は消費しても減らず、
   * 死亡時にドッペルゲンガーとして登録される際の撃破報酬の元データになるため、
   * 新たな獲得経路を追加する際は必ずこれを経由すること（直接 statPoints += しない）。
   */
  private grantStatPoints(amount: number): void {
    if (amount === 0) return
    const { player } = this.state
    player.statPoints += amount
    player.totalStatPointsEarned = (player.totalStatPointsEarned ?? 0) + amount
  }

  private enemyTurn() {
    const { player, enemies } = this.state

    // プレイヤーを囲む8マス（包囲ポジション：上下左右＋斜め）
    const adjPos = [
      { x: player.position.x - 1, y: player.position.y     },
      { x: player.position.x + 1, y: player.position.y     },
      { x: player.position.x,     y: player.position.y - 1 },
      { x: player.position.x,     y: player.position.y + 1 },
      { x: player.position.x - 1, y: player.position.y - 1 },
      { x: player.position.x + 1, y: player.position.y - 1 },
      { x: player.position.x - 1, y: player.position.y + 1 },
      { x: player.position.x + 1, y: player.position.y + 1 },
    ]

    // 近い敵から処理して包囲ポジションを確保させる
    const sorted = [...enemies].sort((a, b) =>
      (Math.abs(player.position.x - a.position.x) + Math.abs(player.position.y - a.position.y)) -
      (Math.abs(player.position.x - b.position.x) + Math.abs(player.position.y - b.position.y))
    )

    // 既にプレイヤー隣接マスにいる敵のポジションを確保済みとしてマーク（チェビシェフ距離1）
    const takenAdj = new Set<string>(
      sorted
        .filter(e => Math.max(Math.abs(player.position.x - e.position.x), Math.abs(player.position.y - e.position.y)) === 1)
        .map(e => `${e.position.x},${e.position.y}`)
    )

    for (const enemy of sorted) {
      // 突進兵の誘爆などでこのターン中に死亡した敵は行動させない
      if (enemy.hp <= 0) continue
      const edx = player.position.x - enemy.position.x
      const edy = player.position.y - enemy.position.y
      const chebDist = Math.max(Math.abs(edx), Math.abs(edy))
      const manhDist = Math.abs(edx) + Math.abs(edy)

      // 斜め攻撃のコーナーカット防止：壁の角越しには斜め攻撃できない（プレイヤーと同条件）
      const diagAttackBlocked =
        edx !== 0 && edy !== 0 &&
        (this.state.map[enemy.position.y]?.[player.position.x] === 'wall' ||
         this.state.map[player.position.y]?.[enemy.position.x] === 'wall')

      // ── ボス大技テレグラフ ──
      // 溜め中(chargeTurns>0)のボスはこのターンに大技を解放する。プレイヤーがまだ隣接していれば
      // 通常1発の2.5倍ダメージ、離れていれば空振り。位置取りで大技を「避けられる」のが核。
      if (enemy.chargeCd && enemy.chargeCd > 0) enemy.chargeCd--
      if (enemy.chargeTurns && enemy.chargeTurns > 0) {
        enemy.chargeTurns = 0
        enemy.chargeCd = 3   // 連続チャージ禁止（弓による安全ハメ狩り防止）
        const eg = this.enemyGraphics.get(enemy.id)
        if (chebDist === 1 && !diagAttackBlocked) {
          // 直撃：計算式は通常攻撃1発と同じ土台（クリティカルなし・×2.5）
          const baseAtk = enemy.attack + Math.floor(enemy.str * 0.5)
          const effAtk  = enemy.slowedTurns > 0 ? Math.floor(baseAtk * 0.5) : baseAtk
          const effDef  = player.vit + Math.floor(player.level / 2)
          const pierce  = Math.min(0.20, PIERCE_RATE + Math.max(0, player.floor - 100) * 0.002)
          const raw     = Math.max(1, Math.round(effAtk * pierce), effAtk - effDef)
          const dmg     = Math.floor(raw * 2.5)
          player.hp = Math.max(0, player.hp - dmg)
          playDamage()
          this.hitStop(true)
          if (eg && eg.visible) {
            this.tweens.add({
              targets: eg,
              x: eg.x + Math.sign(edx) * this.rts * 0.5,
              y: eg.y + Math.sign(edy) * this.rts * 0.5,
              duration: 70, yoyo: true, ease: 'Quad.Out',
            })
          }
          const pw = this.tileToWorld(player.position.x, player.position.y)
          this.spawnBurst(pw.x, pw.y, { color: 0xff5533, count: 14, speed: this.rts * 1.5 })
          this.popDamageNumber(player.position.x, player.position.y, dmg, { toPlayer: true, crit: true })
          this.flashPlayer()
          this.cameras.main.shake(280, 0.018)
          this.cameras.main.flash(170, 150, 0, 0)
          this.addMessage(`${enemy.name}の大技が炸裂！${dmg}ダメージ！`)
          if (player.hp <= 0) { this.lastDeathCause = `${enemy.name}の大技`; this.gameOver(); return }
        } else {
          // 空振り：回避成功の快感を演出で返す
          if (eg && eg.visible) {
            this.spawnBurst(eg.x, eg.y, { color: 0x99aabb, count: 8, speed: this.rts * 1.3 })
          }
          this.addMessage(`${enemy.name}の大技は空を切った！`)
        }
        continue
      }
      // 溜め開始判定：隣接しているボスのみ。溜めたターンは攻撃も移動もしない
      if (
        enemy.isBoss && !enemy.isSkulporin && !enemy.isDoppelganger &&
        chebDist === 1 && !diagAttackBlocked &&
        !(enemy.chargeCd && enemy.chargeCd > 0) &&
        Math.random() < 0.35
      ) {
        enemy.chargeTurns = 1
        const eg = this.enemyGraphics.get(enemy.id)
        if (eg && eg.visible) {
          // 赤く膨らむ「力を溜める」パルス
          this.tweens.add({
            targets: eg,
            scaleX: eg.scaleX * 1.14,
            scaleY: eg.scaleY * 1.14,
            duration: 220, yoyo: true, repeat: 1, ease: 'Sine.InOut',
          })
          this.spawnBurst(eg.x, eg.y, { color: 0xff3333, count: 6, speed: this.rts * 0.7 })
        }
        this.addMessage(`⚠ ${enemy.name}は大技を溜めている…！（離れれば避けられる）`)
        continue
      }

      // ── 敵の性格：突進兵（自爆カウントダウン） ──
      if (enemy.personality === 'bomber') {
        if (enemy.fuseCount === undefined) {
          // プレイヤーを発見したら導火線に点火（視線が通る6マス以内）
          if (manhDist <= 6 && this.hasLineOfSight(enemy.position.x, enemy.position.y, player.position.x, player.position.y)) {
            enemy.fuseCount = 3
            this.addMessage(`⚠ ${enemy.name}が突進してくる…！（3ターン後に自爆・2マス離れれば無傷）`)
          }
        } else {
          enemy.fuseCount--
          if (enemy.fuseCount <= 0) {
            this.explodeBomber(enemy)
            if (player.hp <= 0) { this.lastDeathCause = `${enemy.name}の自爆`; this.gameOver(); return }
            continue
          }
        }
      }
      const bomberFused = enemy.personality === 'bomber' && enemy.fuseCount !== undefined

      // ── 敵の性格：支配者（召喚カウントダウン。通常の攻撃・移動と並行して進む） ──
      if (enemy.personality === 'summoner' && (enemy.summonsLeft ?? 0) > 0) {
        if (enemy.summonCount === undefined) {
          if (manhDist < 10) {
            enemy.summonCount = 3
            this.addMessage(`⚠ ${enemy.name}が黒いもやを纏い始めた…！`)
          }
        } else {
          enemy.summonCount--
          if (enemy.summonCount <= 0) {
            this.summonMinions(enemy)
            enemy.summonCount = undefined
            enemy.summonsLeft = (enemy.summonsLeft ?? 1) - 1
          }
        }
      }

      // ── 敵の性格：弱虫（逃走・強化オーラ。オーラの効果は攻撃計算側で参照） ──
      if (enemy.personality === 'coward') {
        if (chebDist <= 3) {
          if (this.fleeEnemy(enemy)) continue
          // 逃げ場なし：追い詰められたら苦し紛れの弱い攻撃（威力50%）
          if (chebDist === 1 && !diagAttackBlocked) {
            const baseAtk = enemy.attack + Math.floor(enemy.str * 0.5)
            const effAtk  = Math.floor((enemy.slowedTurns > 0 ? baseAtk * 0.5 : baseAtk) * 0.5)
            const effDef  = player.vit + Math.floor(player.level / 2)
            const dmg     = Math.max(1, effAtk - effDef)
            player.hp = Math.max(0, player.hp - dmg)
            playDamage()
            this.popDamageNumber(player.position.x, player.position.y, dmg, { toPlayer: true })
            this.flashPlayer()
            this.addMessage(`${enemy.name}は苦し紛れの攻撃！${dmg}ダメージ！`)
            if (player.hp <= 0) { this.lastDeathCause = `${enemy.name}`; this.gameOver(); return }
          }
        }
        continue   // 弱虫は自分からは近寄らない
      }

      // ── 遠距離型（ranged）：射程2〜ENEMY_BOW_RANGEマスかつ視線が通れば矢を放つ ──
      // 隣接時(manhDist 1)はこの分岐を通らず、下の通常近接攻撃になる＝「懐に潜り込めば普通の敵」。
      // 演出はプレイヤーの弓と同じ矢(fireArrowEffect)を敵→プレイヤー向きに流用し、着弾時にダメージ演出を出す。
      if (
        enemy.isRanged && !bomberFused &&
        manhDist >= 2 && manhDist <= ENEMY_BOW_RANGE &&
        this.hasLineOfSight(enemy.position.x, enemy.position.y, player.position.x, player.position.y)
      ) {
        // 初めてこの敵の射線に捉えられたターンは⚠を先に出す（何に撃たれたかを明示する初見ガード）
        if (!enemy.aimNotified) {
          enemy.aimNotified = true
          this.addMessage(`⚠ ${enemy.name}に狙われた！`)
        }
        const baseAtk      = enemy.attack + Math.floor(enemy.str * 0.5)
        const effectiveAtk = enemy.slowedTurns > 0 ? Math.floor(baseAtk * 0.5) : baseAtk
        const effectiveDef = player.vit + Math.floor(player.level / 2)
        const pierce       = Math.min(0.20, PIERCE_RATE + Math.max(0, player.floor - 100) * 0.002)
        const isCrit       = Math.random() < enemy.luk * 0.001
        const raw          = Math.max(1, Math.round(effectiveAtk * pierce), effectiveAtk - effectiveDef)
        const dmg          = isCrit ? Math.floor(raw * 1.5) : raw
        player.hp = Math.max(0, player.hp - dmg)

        // 矢の飛翔（プレイヤーの弓と同じ距離比例の飛翔時間）＋敵の小さな「引き絞り」モーション
        const flightMs = 60 + manhDist * 35
        this.fireArrowEffect(enemy.position.x, enemy.position.y, player.position.x, player.position.y, 0, flightMs)
        const eg = this.enemyGraphics.get(enemy.id)
        if (eg && eg.visible) {
          this.tweens.add({
            targets: eg,
            x: eg.x - Math.sign(edx) * this.rts * 0.15,
            y: eg.y - Math.sign(edy) * this.rts * 0.15,
            duration: 70, yoyo: true, ease: 'Quad.Out',
          })
        }
        // 着弾タイミングで被弾演出（数字・フラッシュ・シェイク・SE）
        const dShown = dmg, cShown = isCrit
        this.time.delayedCall(flightMs, () => {
          playDamage()
          this.popDamageNumber(player.position.x, player.position.y, dShown, { toPlayer: true, crit: cShown })
          this.flashPlayer()
          this.cameras.main.shake(cShown ? 200 : 110, cShown ? 0.012 : 0.007)
          const hpRatio = player.hp / player.maxHp
          if (player.hp > 0 && hpRatio <= 0.25) this.cameras.main.flash(180, 120, 0, 0)
        })
        this.addMessage(isCrit
          ? `${enemy.name}の矢がクリティカル！${dmg}ダメージ！`
          : `${enemy.name}の矢が命中！${dmg}ダメージ！`)
        if (player.hp <= 0) { this.lastDeathCause = `${enemy.name}の矢`; this.gameOver(); return }
        continue   // 射撃したターンは移動しない（射線が通る限りその場から撃ち続ける）
      }

      if (chebDist === 1 && !diagAttackBlocked && !bomberFused) {
        // 隣接（斜め含む。ただし壁角越しの斜めは不可）→攻撃

        // すかるぽりん専用攻撃（最大HPの3%の固定ダメージ。長期戦でも倒しきれるよう低めに設定）
        if (enemy.isSkulporin) {
          const dmg = Math.max(1, Math.floor(player.maxHp * 0.03))
          player.hp = Math.max(0, player.hp - dmg)
          playDamage()
          const eg2 = this.enemyGraphics.get(enemy.id)
          if (eg2 && eg2.visible) {
            this.tweens.add({
              targets: eg2,
              x: eg2.x + Math.sign(edx) * this.rts * 0.28,
              y: eg2.y + Math.sign(edy) * this.rts * 0.28,
              duration: 80, yoyo: true, ease: 'Quad.Out',
            })
          }
          this.popDamageNumber(player.position.x, player.position.y, dmg, { toPlayer: true })
          this.flashPlayer()
          this.cameras.main.shake(180, 0.010)
          this.addMessage(`すかるぽりんから${dmg}ダメージ！`)
          if (player.hp <= 0) { this.lastDeathCause = 'すかるぽりん'; this.gameOver(); return }
          continue
        }

        // 敵の多段攻撃（AGI由来。プレイヤーと対称だが上限は3回・90刻みで控えめ）
        const attackCount  = Math.min(3, Math.floor(enemy.agi / 90) + 1)
        const effectiveDef = player.vit + Math.floor(player.level / 2)
        // 深層ペナルティ：100F以降は貫通率が逓増（防御の青天井を抑える）。最大20%。
        const floorNow = player.floor
        const pierce   = Math.min(0.20, PIERCE_RATE + Math.max(0, floorNow - 100) * 0.002)
        // ボスのみ：防御無視の「最大HP割合ダメージ」を上乗せ。150Fで約12.5%（上限15%）。
        // 無限タンク(青天井VIT)＋遅い最大HP成長(+5/Lv)を封じ、深層で耐久に上限を作る。
        const trueDmg  = (enemy.isBoss && floorNow > 100)
          ? Math.floor(player.maxHp * Math.min(0.15, (floorNow - 100) * 0.0025))
          : 0
        const eg = this.enemyGraphics.get(enemy.id)
        // 弱虫の強化オーラ：2マス以内に弱虫がいる敵は攻撃力1.3倍（💢マークの敵）
        // ※弱虫自身はこの分岐に到達しない（上でcontinue済み）
        const cowardAura = enemies.some(o =>
          o !== enemy && o.hp > 0 && o.personality === 'coward' &&
          Math.max(Math.abs(o.position.x - enemy.position.x), Math.abs(o.position.y - enemy.position.y)) <= 2)
        let totalDmg = 0
        let anyCrit  = false
        for (let hit = 0; hit < attackCount; hit++) {
          if (player.hp <= 0) break
          const baseAtk      = enemy.attack + Math.floor(enemy.str * 0.5)
          const effectiveAtk = Math.floor((enemy.slowedTurns > 0 ? baseAtk * 0.5 : baseAtk) * (cowardAura ? 1.3 : 1))
          const isCrit = Math.random() < enemy.luk * 0.001
          // 割合貫通(深層で逓増)は防御を無視して必ず通る。さらにボスは最大HP割合ダメージを加算。
          const raw    = Math.max(1, Math.round(effectiveAtk * pierce), effectiveAtk - effectiveDef)
          const dmg    = (isCrit ? Math.floor(raw * 1.5) : raw) + trueDmg
          player.hp = Math.max(0, player.hp - dmg)
          totalDmg += dmg
          anyCrit = anyCrit || isCrit
          // 多段は時間差でダメージ数字をポップ
          const dShown = dmg, cShown = isCrit
          this.time.delayedCall(hit * 90, () => {
            this.popDamageNumber(player.position.x, player.position.y, dShown, { toPlayer: true, crit: cShown })
          })
        }
        playDamage()
        // 敵がプレイヤーへ小さく突進（誰に殴られたかが分かる）
        if (eg && eg.visible) {
          this.tweens.add({
            targets: eg,
            x: eg.x + Math.sign(edx) * this.rts * 0.28,
            y: eg.y + Math.sign(edy) * this.rts * 0.28,
            duration: 80,
            yoyo: true,
            ease: 'Quad.Out',
          })
          // ドッペルゲンガー：プレイヤーと同じ攻撃アニメーションを、プレイヤーの向きで再生する
          if (enemy.isDoppelganger && eg instanceof Phaser.GameObjects.Sprite) {
            const dir = dirFromSign(Math.sign(edx), Math.sign(edy))
            this.enemyDir.set(enemy.id, dir)
            this.playEnemyAttackAnim(eg, dir)
          }
        }
        // 被ダメ演出：プレイヤーフラッシュ＋画面シェイク
        this.flashPlayer()
        this.cameras.main.shake(anyCrit ? 200 : 110, anyCrit ? 0.012 : 0.007)
        // HP残量が少ないほど強い赤フラッシュ（ピンチ演出）
        const hpRatio = player.hp / player.maxHp
        if (player.hp > 0 && hpRatio <= 0.25) {
          this.cameras.main.flash(180, 120, 0, 0)
        }
        const hitLabel = attackCount > 1 ? `${attackCount}回攻撃 計` : ''
        this.addMessage(anyCrit
          ? `${enemy.name}からクリティカル！${hitLabel}${totalDmg}ダメージ！`
          : `${enemy.name}から${hitLabel}${totalDmg}ダメージ！`)
        if (player.hp <= 0) { this.lastDeathCause = anyCrit ? `${enemy.name}のクリティカル` : `${enemy.name}`; this.gameOver(); return }

      } else if (manhDist < 10) {
        // 空いている包囲ポジションを最も近いものから探す
        const candidates = adjPos
          .filter(p => {
            const tile = this.state.map[p.y]?.[p.x]
            return (tile === 'floor' || tile === 'trap' || tile === 'mud' || tile === 'spring' || tile === 'pitfall') && !takenAdj.has(`${p.x},${p.y}`)
          })
          .sort((a, b) =>
            (Math.abs(a.x - enemy.position.x) + Math.abs(a.y - enemy.position.y)) -
            (Math.abs(b.x - enemy.position.x) + Math.abs(b.y - enemy.position.y))
          )

        // 目標: 最寄りの空き包囲ポジション、なければプレイヤーへ直進
        const target = candidates.length > 0 ? candidates[0] : { x: player.position.x, y: player.position.y }
        if (candidates.length > 0) takenAdj.add(`${target.x},${target.y}`)

        const tdx = target.x - enemy.position.x
        const tdy = target.y - enemy.position.y

        // まず斜め移動を試みる（コーナーカット防止）
        let moved = false
        if (tdx !== 0 && tdy !== 0) {
          const diagX = enemy.position.x + Math.sign(tdx)
          const diagY = enemy.position.y + Math.sign(tdy)
          const diagTile = this.state.map[diagY]?.[diagX]
          const hTile    = this.state.map[enemy.position.y]?.[enemy.position.x + Math.sign(tdx)]
          const vTile    = this.state.map[enemy.position.y + Math.sign(tdy)]?.[enemy.position.x]
          const isW = (t: string | undefined) => t === 'floor' || t === 'trap' || t === 'mud' || t === 'spring' || t === 'pitfall'
          const diagWalkable  = isW(diagTile)
          const noCorner      = isW(hTile) && isW(vTile)
          const diagNotPlayer = !(diagX === player.position.x && diagY === player.position.y)
          const diagFree      = !enemies.some(e => e !== enemy && e.position.x === diagX && e.position.y === diagY)
          if (diagWalkable && noCorner && diagNotPlayer && diagFree) {
            enemy.position.x = diagX
            enemy.position.y = diagY
            moved = true
          }
        }

        // 斜め移動できなかった場合は単軸移動。主軸(移動量の大きい方)が壁等で塞がっていたら、
        // 副軸での移動を試す（これが無いと壁の角で完全に足止めされ、遠距離から一方的に攻撃され続けるバグになる）
        if (!moved) {
          const tryAxisMove = (mx: number, my: number): boolean => {
            if (mx === 0 && my === 0) return false
            const nx = enemy.position.x + mx
            const ny = enemy.position.y + my
            const tile = this.state.map[ny]?.[nx]
            const isWalkable = tile === 'floor' || tile === 'trap' || tile === 'mud' || tile === 'spring' || tile === 'pitfall'
            const isPlayerPos = nx === player.position.x && ny === player.position.y
            const occupied = enemies.some(e => e !== enemy && e.position.x === nx && e.position.y === ny)
            if (isWalkable && !isPlayerPos && !occupied) {
              enemy.position.x = nx
              enemy.position.y = ny
              return true
            }
            return false
          }

          const primaryX = Math.abs(tdx) >= Math.abs(tdy)
          const primary:   [number, number] = primaryX ? [Math.sign(tdx), 0] : [0, Math.sign(tdy)]
          const secondary: [number, number] = primaryX ? [0, Math.sign(tdy)] : [Math.sign(tdx), 0]

          if (!tryAxisMove(primary[0], primary[1])) {
            tryAxisMove(secondary[0], secondary[1])
          }
        }

        // 遠距離型：この移動で射程＋射線に入った場合は初回のみ予告する。
        // （敵側から近づいたケースでは次の敵ターンまで撃ってこないため、プレイヤーに1ターンの反応猶予がある）
        if (enemy.isRanged && !enemy.aimNotified) {
          const nd = Math.abs(player.position.x - enemy.position.x) + Math.abs(player.position.y - enemy.position.y)
          if (nd >= 2 && nd <= ENEMY_BOW_RANGE &&
              this.hasLineOfSight(enemy.position.x, enemy.position.y, player.position.x, player.position.y)) {
            enemy.aimNotified = true
            this.addMessage(`⚠ ${enemy.name}がこちらを狙っている…！`)
          }
        }
      }
    }
  }

  /** 突進兵の自爆：自身は消滅（経験値なし）し、周囲1マスのプレイヤー・敵すべてに大ダメージ（誘爆あり） */
  private explodeBomber(enemy: import('../types').Enemy) {
    const { player } = this.state
    // 本体を先に除去（周囲ダメージの巻き込み対象から外す）
    this.state.enemies = this.state.enemies.filter(e => e.id !== enemy.id)
    const { x: wx, y: wy } = this.tileToWorld(enemy.position.x, enemy.position.y)
    const g = this.enemyGraphics.get(enemy.id)
    this.enemyGraphics.delete(enemy.id)
    const bar = this.enemyHpBars.get(enemy.id)
    if (bar) { bar.bg.destroy(); bar.fg.destroy(); this.enemyHpBars.delete(enemy.id) }
    this.destroyEnemyDecor(enemy.id)
    if (g) { this.tweens.killTweensOf(g); g.destroy() }

    // 爆発演出：橙フラッシュ＋強シェイク＋ヒットストップ＋二重バースト＋衝撃波リング
    if (this.isVisible(enemy.position.x, enemy.position.y)) {
      this.cameras.main.flash(180, 255, 120, 30)
      this.cameras.main.shake(300, 0.02)
      this.hitStop(true)
      this.spawnBurst(wx, wy, { color: 0xff6622, count: 18, speed: this.rts * 1.8 })
      this.spawnBurst(wx, wy, { color: 0xffdd66, count: 10, speed: this.rts * 1.1 })
      const ring = this.add.circle(wx, wy, this.rts * 1.6)
        .setStrokeStyle(Math.max(3, this.rts * 0.08), 0xffaa33)
        .setDepth(19).setScale(0.15)
      this.tweens.add({
        targets: ring, scale: 1, alpha: 0, duration: 400, ease: 'Cubic.Out',
        onComplete: () => ring.destroy(),
      })
    }
    this.addMessage(`${enemy.name}が自爆した！`)

    const atk3 = Math.floor((enemy.attack + Math.floor(enemy.str * 0.5)) * 3)
    // プレイヤーへのダメージ（周囲1マス。2マス離れていれば無傷）
    const pd = Math.max(Math.abs(player.position.x - enemy.position.x), Math.abs(player.position.y - enemy.position.y))
    if (pd <= 1) {
      const effDef = player.vit + Math.floor(player.level / 2)
      const dmg = Math.max(1, Math.round(atk3 * 0.06), atk3 - effDef)
      player.hp = Math.max(0, player.hp - dmg)
      playDamage()
      this.popDamageNumber(player.position.x, player.position.y, dmg, { toPlayer: true, crit: true })
      this.flashPlayer()
      this.addMessage(`爆発に巻き込まれた！${dmg}ダメージ！`)
    }
    // 周囲の敵も巻き込む（誘爆で処理する遊び）
    const caught = this.state.enemies.filter(e =>
      Math.max(Math.abs(e.position.x - enemy.position.x), Math.abs(e.position.y - enemy.position.y)) <= 1)
    for (const e of caught) {
      if (e.isSkulporin) continue   // すかるぽりんは特殊戦闘（固定1ダメ制）なので巻き込まない
      const dmg = Math.max(1, Math.round(atk3 * 0.06), atk3 - (e.defense + e.vit))
      e.hp = Math.max(0, e.hp - dmg)
      if (this.isVisible(e.position.x, e.position.y)) {
        this.popDamageNumber(e.position.x, e.position.y, dmg, {})
        this.flashSprite(e.id)
      }
      this.addMessage(`${e.name}が爆発に巻き込まれた！`)
      if (e.hp <= 0) this.killEnemy(e)
    }
  }

  /** 支配者の召喚：周囲の空きマスに雑魚を1〜3体呼ぶ（ステータス70%・経験値ドロップなし） */
  private summonMinions(summoner: import('../types').Enemy) {
    const isW = (t: string | undefined) => t === 'floor' || t === 'trap' || t === 'mud' || t === 'spring' || t === 'pitfall'
    const dirs = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
    const free = dirs
      .map(([dx, dy]) => ({ x: summoner.position.x + dx, y: summoner.position.y + dy }))
      .filter(p =>
        isW(this.state.map[p.y]?.[p.x]) &&
        !this.state.enemies.some(e => e.position.x === p.x && e.position.y === p.y) &&
        !(this.state.player.position.x === p.x && this.state.player.position.y === p.y))
    const count = Math.min(free.length, 1 + Math.floor(Math.random() * 3))
    if (count <= 0) {
      this.addMessage(`${summoner.name}の召喚は不発に終わった…`)
      return
    }
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [free[i], free[j]] = [free[j], free[i]]
    }
    for (let i = 0; i < count; i++) {
      const m = makeMinionEnemy(this.state.player.floor)
      m.position = { ...free[i] }
      this.state.enemies.push(m)
      // 召喚地点に黒い光の粒が弾ける
      if (this.isVisible(free[i].x, free[i].y)) {
        const { x, y } = this.tileToWorld(free[i].x, free[i].y)
        this.spawnBurst(x, y, { color: 0x7733aa, count: 10, speed: this.rts * 0.9 })
        this.spawnBurst(x, y, { color: 0x221133, count: 6, speed: this.rts * 0.5 })
      }
    }
    if (this.isVisible(summoner.position.x, summoner.position.y)) {
      const { x, y } = this.tileToWorld(summoner.position.x, summoner.position.y)
      this.spawnBurst(x, y, { color: 0x330055, count: 12, speed: this.rts * 1.2 })
      this.cameras.main.shake(140, 0.006)
    }
    this.addMessage(`${summoner.name}が配下を${count}体召喚した！`)
  }

  /** 弱虫の逃走：プレイヤーから最も遠ざかる隣接マスへ移動する。動けなければfalse */
  private fleeEnemy(enemy: import('../types').Enemy): boolean {
    const { player, enemies } = this.state
    const isW = (t: string | undefined) => t === 'floor' || t === 'trap' || t === 'mud' || t === 'spring' || t === 'pitfall'
    const dirs = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
    let best: { x: number; y: number } | null = null
    let bestDist = Math.max(Math.abs(player.position.x - enemy.position.x), Math.abs(player.position.y - enemy.position.y))
    for (const [dx, dy] of dirs) {
      const nx = enemy.position.x + dx
      const ny = enemy.position.y + dy
      if (!isW(this.state.map[ny]?.[nx])) continue
      // 斜めのコーナーカット防止（通常移動と同条件）
      if (dx !== 0 && dy !== 0 &&
          !(isW(this.state.map[enemy.position.y]?.[nx]) && isW(this.state.map[ny]?.[enemy.position.x]))) continue
      if (nx === player.position.x && ny === player.position.y) continue
      if (enemies.some(e => e !== enemy && e.position.x === nx && e.position.y === ny)) continue
      const d = Math.max(Math.abs(player.position.x - nx), Math.abs(player.position.y - ny))
      if (d > bestDist) { bestDist = d; best = { x: nx, y: ny } }
    }
    if (!best) return false
    enemy.position.x = best.x
    enemy.position.y = best.y
    return true
  }

  private effectTick() {
    const { player, enemies } = this.state
    if (player.healingTurns > 0) {
      const heal = Math.floor(player.int * 0.5 + 3)
      player.hp = Math.min(player.maxHp, player.hp + heal)
      player.healingTurns--
      this.addMessage(`ライトブレッシング！HP+${heal}（残り${player.healingTurns}ターン）`)
    }
    if (player.blessingTurns > 0) {
      player.blessingTurns--
      if (player.blessingTurns <= 0) {
        // 使用時に増えた分のみを戻す（レベルアップ等で増えた分は巻き込まない）
        player.str -= player.blessingBonus.str
        player.int -= player.blessingBonus.int
        player.dex -= player.blessingBonus.dex
        player.agi -= player.blessingBonus.agi
        player.blessingBonus = { str: 0, int: 0, dex: 0, agi: 0 }
        this.addMessage('ブレッシングの効果が切れた…ステータスが元に戻った')
      }
    }
    for (const enemy of enemies) {
      if (enemy.slowedTurns > 0) enemy.slowedTurns--
    }
  }

  private useSpellById(itemId: string) {
    if (this.isPaused || this.isStatAllocOpen) return
    const spell = this.state.spells.find(s => s.id === itemId)
    if (!spell || !spell.spellType) return

    this.castSpell(spell.spellType)
    this.state.spells = this.state.spells.filter(s => s.id !== itemId)

    this.state.turn++
    this.enemyTurn()
    this.hungerTick()
    this.poisonTick()
    this.effectTick()
    this.renderMap()
    this.updateWindowGameState()
  }

  private useHealById(itemId: string) {
    if (this.isPaused || this.isStatAllocOpen) return
    const { player } = this.state
    const item = this.state.heals.find(h => h.id === itemId)
    if (!item) return

    // 女神のコイン：回復せずスロットを1回回す
    if (item.coin) {
      this.state.heals = this.state.heals.filter(h => h.id !== itemId)
      this.addMessage('女神のコインを使った！スロットが回る！')
      window.spinSlotOnce?.()
      this.renderMap()
      this.updateWindowGameState()
      return
    }

    // 羽：ワープ系（回復せず移動。使用できた場合のみ消費する）
    if (item.wing) {
      const consumed = item.wing === 'fly' ? this.useFlyWing() : this.useButterflyWing()
      if (consumed) this.state.heals = this.state.heals.filter(h => h.id !== itemId)
      this.updateWindowGameState()
      return
    }

    playPotion()
    if (item.staminaPercent) {
      const recover = Math.floor(player.maxStamina * item.staminaPercent / 100)
      player.stamina = Math.min(player.maxStamina, player.stamina + recover)
      this.addMessage(`${item.name}を使った！スタミナ+${recover}`)
    } else {
      // 割合回復（灰ポーション）は最大HP×割合とhealAmountの大きい方。通常は固定値healAmount。
      const flat    = item.healAmount ?? 10
      const percent = item.healPercent ? Math.floor(player.maxHp * item.healPercent) : 0
      const heal    = Math.max(flat, percent)
      player.hp = Math.min(player.maxHp, player.hp + heal)
      this.addMessage(`${item.name}を使った！HP+${heal}`)
    }

    this.state.heals = this.state.heals.filter(h => h.id !== itemId)
    this.renderMap()
    this.updateWindowGameState()
  }

  /** ハエの羽：同じ階の階段のそば（周囲8マスの空き床）へワープ。成功でtrue＝消費 */
  private useFlyWing(): boolean {
    if (this.isEventFloor) { this.addMessage('ここでは羽を使えない。'); return false }
    const { map, player, enemies } = this.state
    const occupied = new Set(enemies.map(e => `${e.position.x},${e.position.y}`))

    let stairs: import('../types').Position | null = null
    for (let y = 0; y < map.length && !stairs; y++) {
      for (let x = 0; x < map[y].length; x++) {
        if (map[y][x] === 'stairs') { stairs = { x, y }; break }
      }
    }
    if (!stairs) { this.addMessage('この階には階段がない！'); return false }

    const dest: import('../types').Position[] = []
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const x = stairs.x + dx, y = stairs.y + dy
        if (map[y]?.[x] !== 'floor') continue
        if (x === player.position.x && y === player.position.y) continue
        if (occupied.has(`${x},${y}`)) continue
        dest.push({ x, y })
      }
    }
    if (dest.length === 0) { this.addMessage('階段のそばに降りられる場所がない！'); return false }

    const t = dest[Math.floor(Math.random() * dest.length)]
    player.position = { x: t.x, y: t.y }
    this.addMessage('ハエの羽を使った！階段のそばへ飛んだ！')
    this.cameras.main.flash(200, 180, 255, 180)
    this.snapNextRender = true
    this.renderMap()
    const { x: wx, y: wy } = this.tileToWorld(t.x, t.y)
    this.cameras.main.centerOn(wx, wy)
    return true
  }

  /** 蝶の羽：今いる階を再生成して仕切り直す（敵・アイテム・地形が再配置）。成功でtrue＝消費 */
  private useButterflyWing(): boolean {
    if (this.isEventFloor) { this.addMessage('ここでは羽を使えない。'); return false }
    const cur = this.state.player.floor
    this.addMessage(`蝶の羽を使った！B${cur}階が再構築された！`)
    this.populateFloor()
    return true
  }

  /** 行商人：女神のコインを cost 枚消費して羽を1個購入（所持上限は WING_ITEMS.holdMax） */
  private buyMerchantItem(key: WingKey): { ok: boolean; reason?: 'coin' | 'limit' } {
    const { name, cost, holdMax } = WING_ITEMS[key]
    const held = this.state.heals.filter(h => h.name === name).length
    if (held >= holdMax) return { ok: false, reason: 'limit' }
    const coins = this.state.heals.filter(h => h.coin)
    if (coins.length < cost) return { ok: false, reason: 'coin' }

    // コインを cost 枚だけ消費する
    const spendIds = new Set(coins.slice(0, cost).map(c => c.id))
    this.state.heals = this.state.heals.filter(h => !spendIds.has(h.id))
    this.state.heals.push(makeWingItem(key))
    this.addMessage(`${name}を1個購入した！（女神のコイン -${cost}）`)
    this.updateWindowGameState()
    return { ok: true }
  }

  private castSpell(spellType: import('../types').SpellType) {
    const { player, enemies } = this.state

    switch (spellType) {
      case 'firebolt': {
        if (enemies.length === 0) { this.addMessage('ファイアボルト！しかし敵がいない！'); return }
        const target = enemies.reduce((a, b) => {
          const da = Math.abs(a.position.x - player.position.x) + Math.abs(a.position.y - player.position.y)
          const db = Math.abs(b.position.x - player.position.x) + Math.abs(b.position.y - player.position.y)
          return da < db ? a : b
        })
        const dmg = player.int * 3 + 10
        target.hp = Math.max(0, target.hp - dmg)
        this.addMessage(`ファイアボルト！${target.name}に${dmg}ダメージ！`)
        if (this.isVisible(target.position.x, target.position.y)) {
          this.popDamageNumber(target.position.x, target.position.y, dmg)
          const eg = this.enemyGraphics.get(target.id)
          if (eg) this.spawnBurst(eg.x, eg.y, { color: 0xff6622, count: 8 })
          this.flashSprite(target.id)
        }
        if (target.hp <= 0) this.killEnemy(target)
        break
      }

      case 'blessing': {
        const amount = 5
        player.str += amount
        player.int += amount
        player.dex += amount
        player.agi += amount
        // 付与した分だけを記録（レベルアップ等による変動とは区別して10ターン後に戻す）
        player.blessingBonus.str += amount
        player.blessingBonus.int += amount
        player.blessingBonus.dex += amount
        player.blessingBonus.agi += amount
        player.blessingTurns = 10
        this.addMessage('ブレッシング！ステータスが上昇した！（10ターン）')
        break
      }

      case 'lightblessing': {
        player.healingTurns = 10
        this.addMessage('ライトブレッシング！10ターン間HPが回復する！')
        break
      }

      case 'quagmire': {
        for (const enemy of enemies) enemy.slowedTurns = 3
        this.addMessage('クァグマイア！敵の動きが鈍くなった！')
        break
      }

      case 'meteostorm': {
        if (enemies.length === 0) { this.addMessage('メテオストーム！しかし敵がいない！'); return }
        const dmg = player.int * 2 + 5
        this.cameras.main.shake(280, 0.008)
        this.cameras.main.flash(220, 255, 140, 60)
        this.addMessage(`メテオストーム！全敵に${dmg}ダメージ！`)
        const targets = [...enemies]
        for (const enemy of targets) {
          enemy.hp = Math.max(0, enemy.hp - dmg)
          if (this.isVisible(enemy.position.x, enemy.position.y)) {
            this.popDamageNumber(enemy.position.x, enemy.position.y, dmg)
            const eg = this.enemyGraphics.get(enemy.id)
            if (eg) this.spawnBurst(eg.x, eg.y, { color: 0xff6622, count: 6 })
          }
          if (enemy.hp <= 0) this.killEnemy(enemy)
        }
        break
      }
    }
  }

  private hungerTick() {
    const { player } = this.state
    if (this.state.turn % 3 === 0) player.stamina -= 1
    if (player.stamina <= 0) {
      player.stamina = 0
      player.hp = Math.max(0, player.hp - 2)
      this.addMessage('スタミナ切れ！HPが減っていく！')
      if (player.hp <= 0) { this.lastDeathCause = 'スタミナ切れ'; this.gameOver() }
    } else if (player.stamina <= 20) {
      this.addMessage('スタミナが少なくなってきた…')
    }
  }

  private poisonTick() {
    const { player } = this.state
    if (!player.poisoned) return
    const dmg = 2
    player.hp = Math.max(0, player.hp - dmg)
    player.poisonTurns--
    // 毒：歩くたびに画面を緑にフラッシュしてダメージを演出
    this.cameras.main.flash(170, 40, 180, 60)
    this.addMessage(`毒のダメージ！${dmg}ダメージ（残り${player.poisonTurns}ターン）`)
    if (player.poisonTurns <= 0) {
      player.poisoned = false
      this.addMessage('毒が治った！')
    }
    if (player.hp <= 0) { this.lastDeathCause = '毒'; this.gameOver() }
  }

  private nextFloor() {
    // 連続撃破ズームパンチのトゥイーンがフロア遷移で中断され、ズームが1に戻らないまま
    // 固定されてしまう事故の保険（トゥイーンを止めて確実に等倍へ戻す）
    this.tweens.killTweensOf(this.cameras.main)
    this.cameras.main.zoom = 1
    // イベントフロアからの脱出 → 通常フロアへ
    if (this.isEventFloor) {
      this.isEventFloor = false
      this.eventFacilities = []
      this.enterNormalFloor()
      return
    }
    // 5フロアクリアごとに、次のフロアへ進む前にイベントフロア（ベースキャンプ「あるかなひろば」）に立ち寄る
    if (this.state.player.floor > 0 && this.state.player.floor % 5 === 0) {
      this.enterEventFloor()
      return
    }
    this.enterNormalFloor()
  }

  private enterNormalFloor() {
    this.state.player.floor++
    const floor = this.state.player.floor
    // 自己最高到達階を更新（フロンティア前進）。踏破済み判定の基準になる。
    this.state.player.maxFloorReached = Math.max(this.state.player.maxFloorReached ?? floor, floor)
    logEvent('floor_reached', { floor, level: this.state.player.level })
    if (floor % 5 === 0) {
      fireWorldNotification('world', '【ワールド】', `${getDisplayName()}さんがB${floor}階に到達しました！`, `floor:${floor}`)
    }
    this.populateFloor()
    this.autoSave()   // 階層が上がるたびにオートセーブ
  }

  /** 現在の player.floor の階を新規生成して配置・描画する（到達ログ/通知は呼び出し側の責務） */
  private populateFloor() {
    this.isEventFloor = false
    this.eventFacilities = []
    this.state.driedSprings = []
    // 前フロアの救済スプライト/状態と町装飾を掃除（rollFloorRescueで再抽選される）
    if (this.rescueSprite) { this.rescueSprite.destroy(); this.rescueSprite = null }
    if (this.jailNpcSprite) { this.jailNpcSprite.destroy(); this.jailNpcSprite = null }
    for (const d of this.plazaDecor) d.destroy()
    this.plazaDecor = []
    this.plazaBlocked = new Set<string>()
    this.signboardPos = null
    this.signboardMark?.destroy()
    this.signboardMark = null
    this.graveyardPos = null
    this.graveyardMark?.destroy()
    this.graveyardMark = null
    this.arcadePos = null
    this.floorRescue = null
    this.jailCell = null
    this.pendingClearRescue = null
    const floor = this.state.player.floor
    this.ensureEnemyTexturesForFloor(floor)
    // 踏破済みフロア（蝶の羽で自己最高到達階より下に戻ったケース）→ XP大幅減＆ドロップなし
    this.floorIsCleared = floor < (this.state.player.maxFloorReached ?? floor)
    const map = generateDungeon()
    const playerPos = getPlayerStartPosition(map)
    this.state.map = map
    this.state.player.position = { ...playerPos }
    this.state.enemies = []   // 前フロアの残存データで救済NPCの空きマス判定を汚さないよう先にクリア（下でこのフロアの敵を設定し直す）

    // あるかなひろばの住人 救済抽選（このフロアで助けられるか）。
    // 牢屋(パターン3)はmapを直接書き換える（floor→wall/jail）ため、ボス/敵/アイテムの配置マス集計や
    // createTileSpritesより前に確定させる必要がある。後で回すと書き換え後の壁マスに敵やアイテムが
    // 置かれてしまう（＝二度と回収できない）上、見た目にも反映されず当たり判定だけの壁になる。
    this.rollFloorRescue()

    let floorType = this.determineFloorType(this.state.player.luk, floor)
    let bosses = spawnBosses(floor, this.state.areaBossFloors)
    // スケジュールボス階（MINI/MVP/エリア/深淵）とモンスターハウスは重ねない（ボス体感密度の抑制）
    if (floorType === 'chaos' && bosses.length > 0) floorType = 'normal'
    // ADMINがモンスターハウスを強制予約していたら、このフロアをchaos化（1回限り・排他より優先）
    if (this.forceMonsterHouseNextFloor) {
      floorType = 'chaos'
      this.forceMonsterHouseNextFloor = false
    }
    // 通常フロアの敵数。LUKで増えるが過剰にならないよう係数を抑え、上限も設ける。
    // （旧: luk*0.5 だとLUK2000で約1000体湧き、空きマス不足で重なり・プレイヤー被り＆描画フリーズを誘発していた）
    const base     = 7
    const lukBonus = Math.min(Math.floor(this.state.player.luk * 0.08), 20)
    const count    = Math.min(base + Math.floor(Math.random() * (base + lukBonus)), 36)
    // 牢屋(パターン3)のNPCマスは見た目上floorのままなので、明示的に湧き候補から除外する
    const spawnExclude: import('../types').Position[] = this.getJailNpcPos()
    const normalEnemies = floorType === 'chaos'
      ? spawnMonsterHouseEnemies(map, floor, playerPos, spawnExclude)
      : spawnEnemies(map, count, floor, spawnExclude)
    if (floorType === 'chaos') bosses = [...bosses, makeChaosBoss(floor)]

    const floors: { x: number; y: number }[] = []
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) {
        if (map[y][x] === 'floor') floors.push({ x, y })
      }
    }
    for (const boss of bosses) {
      const pos = floors[Math.floor(Math.random() * floors.length)]
      boss.position = { ...pos }
    }

    this.state.enemies = [...normalEnemies, ...bosses]
    dedupeEnemyPositions(this.state.enemies, map, playerPos, spawnExclude)   // 敵が重なって始まらないように
    this.state.items = this.floorIsCleared
      ? []   // 踏破済みフロアはアイテムドロップなし（周回ファーム対策）
      : floorType === 'lucky'
      ? spawnItems(map, { countMult: 6, equipRate: 0.30, floor, excludePositions: spawnExclude })
      : floorType === 'chaos'
      ? spawnItems(map, { countMult: 6, floor, excludePositions: spawnExclude })
      : spawnItems(map, { countMult: 3, floor, excludePositions: spawnExclude })
    dedupeItemPositions(this.state.items, map, playerPos, spawnExclude)   // 壁化したマスに乗っていたら空き床へ退避（回収不能化の防止）
    this.state.floorType = floorType
    // 瘴気フロア（デバフ）：normalフロアのみ1割で発生。視界3マス減。lucky/chaos/イベントとは排他で競合しない
    this.state.miasmaFloor = floorType === 'normal' && Math.random() < 0.10
    this.buildFloorVariants(map)
    this.createTileSprites(map)
    if (this.skipNextStairsSound) this.skipNextStairsSound = false
    else playStairs()
    this.snapNextRender = true
    this.renderMap()
    this.updateWindowGameState()
    this.showTelopIfNeeded()
    this.updateBGM()
    this.cameras.main.fadeIn(300, 0, 0, 0)   // フロア切替の入場フェード
    if (floorType === 'chaos') {
      this.showMonsterHouseEffect()
      fireWorldNotification('world', '【緊急速報】', `${getDisplayName()}さんがモンスターハウスに遭遇しました！`, `mhouse:${floor}`)
    }

    // フロア入場時にすかるぽりんチェック（heartbeatを即時実行）＋保留中のADMIN指定スポーン適用
    void this.sendSkulporinHeartbeat()
    this.flushPendingAdminSpawns()

    // ドッペルゲンガー：踏破済み（周回済み）フロアは farming 対策で対象外にする
    if (!this.floorIsCleared) void this.checkDoppelgangerSpawn()
  }

  // ── 住人救済システム ──
  private unrescuedNpcs(): import('../types').NpcKind[] {
    return ALL_NPC_KINDS.filter(k => !this.state.rescuedNpcs.includes(k))
  }

  /** フロア入場ごとに救済チャンスを抽選。30%で発生、内訳 1:30% / 2:30% / 3:40%。対象は未救済からランダム。 */
  private rollFloorRescue() {
    this.floorRescue = null
    this.pendingClearRescue = null
    this.jailCell = null
    if (this.floorIsCleared) return                 // 踏破済みフロアは対象外
    const pool = this.unrescuedNpcs()
    if (pool.length === 0) return                    // 全員救済済み → 打ち止め
    if (Math.random() >= 0.30) return                // 70%は何も起きない
    const kind = pool[Math.floor(Math.random() * pool.length)]
    const r = Math.random()
    let subMessage = ''
    if (r < 0.30) {
      this.spawnWanderingRescue(kind)                // パターン1
      subMessage = 'どこかで迷子になっているようだ。'
    } else if (r < 0.60) {
      this.pendingClearRescue = kind                 // パターン2（全敵撃破で発生）
      subMessage = 'モンスターに捕まっているようだ。'
    } else {
      this.carveJail(kind)                           // パターン3（牢屋）
      subMessage = 'どこかで囚われているようだ。'
    }
    // 配置に失敗（空きマスなし等）した場合は何も起きていないので告知しない。
    // メッセージウィンドウだと気づかれにくいため、OKで消せるモーダルで明示的に知らせる。
    if (this.floorRescue || this.pendingClearRescue || this.jailCell) {
      this.isRescueNoticeOpen = true
      window.dispatchEvent(new CustomEvent('rescue-notice-open', {
        detail: `どこからか助けを呼ぶ声が聞こえる・・・\n${subMessage}`,
      }))
    }
  }

  private randomFloorTile(pred?: (x: number, y: number) => boolean): import('../types').Position | null {
    const { map, player } = this.state
    const cand: import('../types').Position[] = []
    for (let y = 0; y < map.length; y++) for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] !== 'floor') continue
      if (x === player.position.x && y === player.position.y) continue
      if (this.state.enemies.some(e => e.position.x === x && e.position.y === y)) continue
      if (pred && !pred(x, y)) continue
      cand.push({ x, y })
    }
    return cand.length ? cand[Math.floor(Math.random() * cand.length)] : null
  }

  /** パターン1：フロアに迷子NPCを1体配置（衝突で救出）。 */
  private spawnWanderingRescue(kind: import('../types').NpcKind) {
    const pos = this.randomFloorTile()
    if (!pos) return
    this.floorRescue = { kind, position: pos }
  }

  /** 牢屋NPCの座標を配列で返す（未生成なら空配列）。敵/アイテムの湧き候補除外に使う。 */
  private getJailNpcPos(): import('../types').Position[] {
    const cell = this.jailCell
    if (cell === null) return []
    return [cell.npcPos]
  }

  /** パターン3：8方を岩で囲み1方だけ柵(jail)のある牢屋を生成し、中に未救済NPCを配置。 */
  private carveJail(kind: import('../types').NpcKind) {
    const { map } = this.state
    // 中心候補：3x3が全て床で、かつ外周に脱出用の床が隣接する場所
    const spot = this.randomFloorTile((cx, cy) => {
      if (cx < 2 || cy < 2 || cx >= MAP_WIDTH - 2 || cy >= MAP_HEIGHT - 2) return false
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (map[cy + dy][cx + dx] !== 'floor') return false
      }
      // 下側(cy+2)が床＝そこから柵に接近できる
      return map[cy + 2]?.[cx] === 'floor'
    })
    if (!spot) return
    const { x: cx, y: cy } = spot
    // 3x3の外周を岩で囲む（中心はNPC、下辺中央を柵にする）
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      map[cy + dy][cx + dx] = 'wall'
    }
    map[cy + 1][cx] = 'jail'          // 下辺中央＝柵（ドア）。プレイヤーは cy+2 から接近
    this.jailCell = { kind, doorPos: { x: cx, y: cy + 1 }, npcPos: { x: cx, y: cy } }
  }

  /** NPCを救済（rescuedNpcsへ追加）。パターンによらず共通の演出モーダル＋SEで知らせる。 */
  private rescueNpc(kind: import('../types').NpcKind) {
    if (this.state.rescuedNpcs.includes(kind)) return
    this.state.rescuedNpcs.push(kind)
    const c = NPC_CATALOG[kind]
    // モーダル表示中は操作不能にし、SEが鳴り終わるまで余韻を持たせる
    this.isRescueNoticeOpen = true
    window.dispatchEvent(new CustomEvent('rescue-done-open', {
      detail: `${c.person}を救出し、ひろばの住人に迎え入れた！`,
    }))
    playMate()
    // 操作ロックはSEの再生完了を待たず、固定4秒で解除する（余韻を持たせる演出時間）
    window.setTimeout(() => window.dispatchEvent(new Event('rescue-done-sound-ended')), 4000)
    // 救出＝さがし人一覧の更新なので、看板の「！」を再表示する
    this.state.signboardUnread = true
    this.updateSignboardMark()
    this.updateWindowGameState()
    fireWorldNotification('world', '【ワールド】', `${getDisplayName()}さんが${c.person}を助け出しました！`)
  }

  /** 看板の上に浮かせる「！」マークの表示/非表示を更新する（未読時のみ表示） */
  private updateSignboardMark() {
    this.signboardMark?.setVisible(this.isEventFloor && !!this.signboardPos && this.state.signboardUnread)
  }

  /** 墓標本体を描画する（画像アセット不要。丸みのある石版＋十字＋絵文字をGraphicsで描画）。
   *  当たり判定はplace()を使わず、移動ハンドラ側でgraveyardPosを直接判定する（看板と同じ方式）。 */
  private drawGraveTombstone(pos: import('../types').Position) {
    const { x, y } = this.tileToWorld(pos.x, pos.y)
    const baseY = y + this.rts * 0.12   // 足元を少し下げて地面に馴染ませる

    // 女神像の画像（街3素材）。読み込み済みならこちらを優先し、未読込時のみ旧Graphics+絵文字描画へ
    if (this.textureOk('town-goddess-statue')) {
      const shadow = this.add.graphics().setDepth(4)
      shadow.fillStyle(0x000000, 0.25)
      shadow.fillEllipse(x, baseY + this.rts * 0.08, this.rts * 0.5, this.rts * 0.16)
      this.plazaDecor.push(shadow)

      const img = this.add.image(x, baseY, 'town-goddess-statue').setOrigin(0.5, 1).setDepth(5)
      const natW = img.width || 1, natH = img.height || 1
      const k = (this.rts * 1.17) / natH
      img.setDisplaySize(natW * k, natH * k)
      this.plazaDecor.push(img)

      img.setInteractive({ useHandCursor: true })
      img.on('pointerdown', () => this.openGraveyard())
      return
    }

    const w = this.rts * 0.62
    const h = this.rts * 0.82
    const g = this.add.graphics().setDepth(4)
    // 影
    g.fillStyle(0x000000, 0.25)
    g.fillEllipse(x, baseY + h * 0.42, w * 0.9, h * 0.22)
    // 石版本体（上部を丸めたアーチ型）
    g.fillStyle(0x555568, 1)
    g.fillRoundedRect(x - w / 2, baseY - h, w, h, { tl: w / 2, tr: w / 2, bl: 4, br: 4 })
    g.lineStyle(Math.max(1, this.rts * 0.02), 0x2f2f3a, 1)
    g.strokeRoundedRect(x - w / 2, baseY - h, w, h, { tl: w / 2, tr: w / 2, bl: 4, br: 4 })
    // 十字の刻み
    g.lineStyle(Math.max(1, this.rts * 0.035), 0x2f2f3a, 0.8)
    g.lineBetween(x, baseY - h * 0.82, x, baseY - h * 0.5)
    g.lineBetween(x - w * 0.16, baseY - h * 0.68, x + w * 0.16, baseY - h * 0.68)
    this.plazaDecor.push(g)

    // 絵文字アクセント
    const emoji = this.add.text(x, baseY - h * 0.32, '🪦', {
      fontSize: `${Math.round(this.rts * 0.42)}px`,
    }).setOrigin(0.5).setDepth(5)
    this.plazaDecor.push(emoji)

    // 体当たり移動が使えないスマホ操作でも開けるよう、直接タップ/クリックでも開けるようにする
    emoji.setInteractive({ useHandCursor: true })
    emoji.on('pointerdown', () => this.openGraveyard())
  }

  /** 墓標一覧モーダルを開く（体当たり／直接タップの両方から呼ばれる共通処理） */
  private openGraveyard() {
    window.dispatchEvent(new Event('graveyard-open'))
    if (this.graveyardLatestId !== null) setLastSeenGraveyardId(this.graveyardLatestId)
    this.graveyardUnread = false
    this.updateGraveyardMark()
  }

  /** 墓標上に浮かせる「！」マークの表示/非表示を更新する（未読時のみ表示） */
  private updateGraveyardMark() {
    this.graveyardMark?.setVisible(this.isEventFloor && !!this.graveyardPos && this.graveyardUnread)
  }

  /** げーせん筐体本体を描画する。画像(town-arcade)読み込み済みならそちらを優先し、
   *  未読込時のみ旧Graphics+絵文字描画へフォールバックする（女神像と同じ方式）。
   *  当たり判定はplace()を使わず、移動ハンドラ側でarcadePosを直接判定する（看板/墓標と同じ方式）。 */
  private drawArcadeCabinet(pos: import('../types').Position) {
    const { x, y } = this.tileToWorld(pos.x, pos.y)
    const baseY = y + this.rts * 0.12

    if (this.textureOk('town-arcade')) {
      const shadow = this.add.graphics().setDepth(4)
      shadow.fillStyle(0x000000, 0.25)
      shadow.fillEllipse(x, baseY + this.rts * 0.08, this.rts * 0.5, this.rts * 0.16)
      this.plazaDecor.push(shadow)

      const img = this.add.image(x, baseY, 'town-arcade').setOrigin(0.5, 1).setDepth(5)
      const natW = img.width || 1, natH = img.height || 1
      const k = (this.rts * 1.3) / natH
      img.setDisplaySize(natW * k, natH * k)
      this.plazaDecor.push(img)

      img.setInteractive({ useHandCursor: true })
      img.on('pointerdown', () => this.openArcade())
      return
    }

    const w = this.rts * 0.66
    const h = this.rts * 0.88
    const g = this.add.graphics().setDepth(4)
    // 影
    g.fillStyle(0x000000, 0.25)
    g.fillEllipse(x, baseY + h * 0.4, w * 0.95, h * 0.2)
    // 筐体本体
    g.fillStyle(0x33305a, 1)
    g.fillRoundedRect(x - w / 2, baseY - h, w, h, 6)
    g.lineStyle(Math.max(1, this.rts * 0.02), 0x1c1a33, 1)
    g.strokeRoundedRect(x - w / 2, baseY - h, w, h, 6)
    // 画面
    const screenW = w * 0.72, screenH = h * 0.42
    g.fillStyle(0x1a2a4a, 1)
    g.fillRoundedRect(x - screenW / 2, baseY - h * 0.86, screenW, screenH, 3)
    g.lineStyle(Math.max(1, this.rts * 0.015), 0x66ccff, 0.8)
    g.strokeRoundedRect(x - screenW / 2, baseY - h * 0.86, screenW, screenH, 3)
    this.plazaDecor.push(g)

    const emoji = this.add.text(x, baseY - h * 0.66, '🕹️', {
      fontSize: `${Math.round(this.rts * 0.34)}px`,
    }).setOrigin(0.5).setDepth(5)
    this.plazaDecor.push(emoji)

    // 体当たり移動が使えないスマホ操作でも開けるよう、直接タップ/クリックでも開けるようにする
    emoji.setInteractive({ useHandCursor: true })
    emoji.on('pointerdown', () => this.openArcade())
  }

  /** げーせんのミニゲームモーダルを開く（体当たり／直接タップの両方から呼ばれる共通処理） */
  private openArcade() {
    this.isArcadeOpen = true
    window.dispatchEvent(new Event('arcade-open'))
  }

  private coinCount(): number { return this.state.heals.filter(h => h.coin).length }
  private addCoins(n: number) {
    for (let i = 0; i < n; i++) {
      this.state.heals.push({ id: `coin_${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`, name: '女神のコイン', type: 'heal', position: { x: 0, y: 0 }, coin: true })
    }
  }
  private consumeCoins(n: number): boolean {
    if (this.coinCount() < n) return false
    let left = n
    this.state.heals = this.state.heals.filter(h => { if (h.coin && left > 0) { left--; return false } return true })
    return true
  }

  /** がらくた屋：いらない装備を女神のコインに換金（コイン = 1 + 精錬値）。 */
  private runJunkConvert(itemId: string): { ok: boolean; coins?: number } | null {
    const item = this.state.bag.find(b => b.id === itemId && b.type === 'equip')
    if (!item || item.locked) return { ok: false }
    const coins = 1 + Math.max(0, item.refineLevel ?? 0)
    this.state.bag = this.state.bag.filter(b => b.id !== itemId)
    this.addCoins(coins)
    this.addMessage(`${item.name}をがらくた屋に売った。女神のコイン+${coins}枚！`)
    this.updateWindowGameState()
    return { ok: true, coins }
  }

  /** どうぐや：女神のコインで回復薬を購入。同名10個上限。 */
  private buyToolItem(key: string): { ok: boolean; reason?: 'coin' | 'limit' } | null {
    const def = TOOLSHOP_ITEMS.find(t => t.key === key)
    if (!def) return { ok: false }
    if (this.coinCount() < def.cost) return { ok: false, reason: 'coin' }
    const base = HEAL_ITEMS.find(h => h.name === def.name)
    if (this.state.heals.filter(h => h.name === def.name).length >= 10) return { ok: false, reason: 'limit' }
    if (!this.consumeCoins(def.cost)) return { ok: false, reason: 'coin' }
    this.state.heals.push({
      id: `buy_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: def.name, type: 'heal', position: { x: 0, y: 0 },
      healAmount: base?.healAmount ?? 0,
      ...(base && 'staminaPercent' in base ? { staminaPercent: (base as { staminaPercent: number }).staminaPercent } : {}),
    })
    this.addMessage(`どうぐやで${def.name}を購入した（🪙${def.cost}）`)
    this.updateWindowGameState()
    return { ok: true }
  }

  private getJailUnlockState(): { npcName: string; bagEquips: { id: string; name: string }[]; coins: number; statPoints: number } | null {
    if (!this.jailCell) return null
    return {
      npcName: NPC_CATALOG[this.jailCell.kind].person,
      bagEquips: this.state.bag.filter(b => b.type === 'equip' && !b.locked).map(b => ({ id: b.id, name: b.name })),
      coins: this.coinCount(),
      statPoints: this.state.player.statPoints,
    }
  }

  /** 広場の掲示板：全住人の捜索/救助状況一覧（カタログ順で安定表示） */
  private getRescueList(): { person: string; role: string; rescued: boolean }[] {
    return ALL_NPC_KINDS.map(kind => {
      const c = NPC_CATALOG[kind]
      return { person: c.person, role: c.name, rescued: this.state.rescuedNpcs.includes(kind) }
    })
  }

  /** 牢屋の柵を開錠。成功で柵撤去＋救済。失敗でも資源は消費（確率は非公開）。 */
  private tryJailUnlock(method: 'equip' | 'coin' | 'point', sacrificeId?: string): { ok: boolean; message: string; broke?: boolean } | null {
    if (!this.jailCell) return null
    const success = (): { ok: boolean; message: string; broke?: boolean } => {
      const kind = this.jailCell!.kind
      const { doorPos } = this.jailCell!
      this.state.map[doorPos.y][doorPos.x] = 'floor'   // 柵を撤去して通行可能に
      this.assignFloorVariant(doorPos.x, doorPos.y)    // 柵位置は生成時未割当のため、床の見た目も明示的に割り当てる
      if (this.jailNpcSprite) { this.jailNpcSprite.destroy(); this.jailNpcSprite = null }
      this.jailCell = null
      this.rescueNpc(kind)
      // タイルスプライトを再構築（柵→床の反映）
      this.createTileSprites(this.state.map)
      this.renderMap()
      return { ok: true, message: '柵が開いた！' }
    }
    if (method === 'equip') {
      const item = this.state.bag.find(b => b.id === sacrificeId && b.type === 'equip' && !b.locked)
      if (!item) return { ok: false, message: '生贄にできる装備がない' }
      this.state.bag = this.state.bag.filter(b => b.id !== item.id)
      this.updateWindowGameState()
      if (Math.random() < 0.10) { this.addMessage(`${item.name}で柵をブチ破った！`); return success() }
      this.addMessage(`${item.name}は堅牢な柵に負けて破損してしまった…`)
      return { ok: false, message: `${item.name}は壊れてしまった…`, broke: true }
    }
    if (method === 'coin') {
      if (!this.consumeCoins(3)) return { ok: false, message: '女神のコインが足りない' }
      this.updateWindowGameState()
      if (Math.random() < 0.50) { return success() }
      this.addMessage('コインは柵に吸い込まれてしまった…')
      return { ok: false, message: 'コインはそのまま吸い込まれた…' }
    }
    // point
    if (this.state.player.statPoints < 5) return { ok: false, message: 'ステータスポイントが足りない' }
    this.state.player.statPoints -= 5
    this.updateWindowGameState()
    if (Math.random() < 0.80) { return success() }
    this.addMessage('光は柵に弾かれた…何も起きなかった。')
    return { ok: false, message: '何も起きなかった…' }
  }

  // ── イベントフロア（ベースキャンプ「あるかなひろば」）──
  // NPCは固定プロットに配置し、救済済みのNPCだけがそのプロットに登場。
  // プロットごとに専用の建物プロップ（露店/工房）を building_<kind> で描く。
  // 中央の縦通路(x=15)を挟んで2列4行にゆったり配置（NPC同士2〜4マス空け、密集させない）
  private static readonly PLAZA_PLOTS: Record<import('../types').NpcKind, import('../types').Position> = {
    refine:    { x: 10, y: 10 },
    shadow:    { x: 20, y: 10 },
    spellbook: { x: 10, y: 15 },
    merchant:  { x: 20, y: 15 },
    toolshop:  { x: 10, y: 20 },
    junk:      { x: 20, y: 20 },
    miner:     { x: 15, y: 20 },
  }

  private enterEventFloor() {
    this.isEventFloor = true
    this.floorIsCleared = false   // ベースキャンプはペナルティ対象外
    const map = this.generateEventFloorMap()
    // 噴水(15,14)の真下（1マス南）からスタートする
    const playerPos = { x: 15, y: 15 }

    const rescued = ALL_NPC_KINDS.filter(k => this.state.rescuedNpcs.includes(k))

    this.state.map = map
    this.state.player.position = { ...playerPos }
    this.state.enemies = []
    this.state.items = []
    // 救済済み住人を固定プロットへ配置
    this.eventFacilities = rescued.map(kind => {
      const c = NPC_CATALOG[kind]
      return { id: `facility_${kind}`, kind: kind as import('../types').FacilityKind, name: c.name, icon: c.icon, texture: c.texture, position: { ...GameScene.PLAZA_PLOTS[kind] } }
    })

    // ── 回復の泉：採掘師を救済済みのときだけ設置する（採掘師の2マス下を優先、ダメなら隣接マスへ） ──
    if (rescued.includes('miner')) {
      const mp = GameScene.PLAZA_PLOTS.miner
      const occupied = new Set(this.eventFacilities.map(f => `${f.position.x},${f.position.y}`))
      const canPlace = (nx: number, ny: number) =>
        map[ny]?.[nx] === 'floor' && !occupied.has(`${nx},${ny}`) && !(nx === playerPos.x && ny === playerPos.y)
      for (const [dx, dy] of [[0, 2], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = mp.x + dx, ny = mp.y + dy
        if (canPlace(nx, ny)) {
          map[ny][nx] = 'spring'
          break
        }
      }
    }
    this.state.floorType = 'normal'
    this.state.miasmaFloor = false   // ベースキャンプは瘴気なし（フル視界）
    this.computePlazaPath()   // createTileSprites より前に石畳パスの座標を確定させる
    this.buildFloorVariants(map)
    this.createTileSprites(map)
    this.buildPlazaDecor(rescued)
    this.addMessage('ベースキャンプ「あるかなひろば」に到着した...')
    this.snapNextRender = true
    this.renderMap()
    this.updateWindowGameState()
    this.updateBGM()
    this.cameras.main.fadeIn(300, 0, 0, 0)
    this.showMidgardTitle()
  }

  /** 町の石畳パス（十字通路）の座標を確定する。createTileSprites より前に呼ぶこと。
   *  洞窟口(15,7)→中央広場の噴水(15,14)→プレイヤー開始位置(15,22)の縦の大通りに、
   *  各NPC列（y=10/15/20）へ抜ける横の小道を接続する（参考画像の十字型導線を踏襲）。 */
  private computePlazaPath() {
    this.plazaPath = new Set<string>()
    const add = (x: number, y: number) => this.plazaPath.add(`${x},${y}`)
    for (let y = 8; y <= 21; y++) {
      if (y === 13 || y === 14) continue   // 噴水の手前で通路を止める（水面には敷石を置かない）
      add(15, y)
    }
    for (const y of [10, 15, 20]) {
      for (let x = 11; x <= 19; x++) add(x, y)
    }
  }

  /** 町の建物テクスチャキーを決める。参考画像から抜いた高品質版(town-b-)があればそれを、
   *  無ければ簡易版(town-bf-)にフォールバックする（採掘師は簡易版のみ）。 */
  private buildingTextureFor(kind: import('../types').NpcKind): string {
    return this.textureOk(`town-b-${kind}`) ? `town-b-${kind}` : `town-bf-${kind}`
  }

  /** 町の装飾（石畳パス・噴水・生垣・トピアリー・救済NPCごとの建物）を生成する。プラザ滞在中のみ。
   *  配置したタイルは plazaBlocked に登録し通行不可にする（床以外は通り抜け不可、木は枝先まで含めた
   *  footprint全体をブロック）。方針：装飾は要所に絞って密集させず、各NPCには背後に1棟の建物ランド
   *  マーク（参考画像から抜いた高品質素材）を添えて「お店」らしさを出す。 */
  private buildPlazaDecor(rescued: import('../types').NpcKind[]) {
    for (const d of this.plazaDecor) d.destroy()
    this.plazaDecor = []
    this.plazaBlocked = new Set<string>()
    this.signboardMark?.destroy()
    this.signboardMark = null
    this.graveyardMark?.destroy()
    this.graveyardMark = null
    // さがし人の解放数に応じた「廃れた街→リッチな街」演出：
    // 解放0＝広場はほぼ何もない褪せた廃墟、解放が進むごとに緑化・装飾が増え、全解放で満開の庭園になる。
    const stage = rescued.length
    const tint = plazaProgressTint(stage)
    const place = (key: string, tx: number, ty: number, scale: number, depth: number, applyTint = false) => {
      if (!this.textureOk(key)) return
      const { x, y } = this.tileToWorld(tx, ty)
      const img = this.add.image(x, y, key).setOrigin(0.5, 0.85).setDepth(depth)
      const natW = img.width || 1, natH = img.height || 1
      const nat = Math.max(natW, natH)
      const k = (scale * this.rts) / nat
      const dispW = natW * k, dispH = natH * k
      img.setDisplaySize(dispW, dispH)
      if (applyTint) img.setTint(tint)
      this.plazaDecor.push(img)
      // 当たり判定は見た目の footprint 全体をブロックする（木の枝先だけ通れてしまう等を防ぐ）。
      // origin(0.5, 0.85) なので画像の大部分は ty より上に伸びる。横は tx を中心に、
      // 縦は ty を最下段として footH タイル分ぶん上へ広げる。
      const footW = Math.max(1, Math.round(dispW / this.rts))
      const footH = Math.max(1, Math.round(dispH / this.rts))
      const halfW = Math.floor((footW - 1) / 2)
      for (let dy = 0; dy < footH; dy++) {
        for (let dx = -halfW; dx <= footW - 1 - halfW; dx++) {
          this.plazaBlocked.add(`${tx + dx},${ty - dy}`)
        }
      }
    }
    const { rx, ry, rh, rw } = GameScene.PLAZA_RECT
    // 洞窟口：階段マス自体は草地の見た目のまま（地面が空洞にならないよう）にし、
    // ドアの絵は壁バンドの中だけに収め、横の岩壁と同じ下端ラインで揃える（草地側へはみ出させない）。
    if (this.textureOk('town-cave')) {
      const entranceTx = rx + Math.floor(rw / 2)
      const { x: caveX } = this.tileToWorld(entranceTx, ry)
      const boundaryY = ry * this.rts
      const caveImg = this.add.image(caveX, boundaryY, 'town-cave')
        .setOrigin(0.5, 1)
        .setDisplaySize(this.rts * 0.75, this.rts)
        .setDepth(2)
      this.plazaDecor.push(caveImg)
    }
    // 木・トピアリーは1体以上救済で生え始める（誰もいない廃墟には緑がない）
    if (stage >= 1) {
      place('town-tree',    rx + 1,  ry + 2,      1.8, 4, true)
      place('town-tree',    rx + 14, ry + 2,      1.8, 4, true)
      place('town-tree',    rx + 1,  ry + rh - 3, 1.8, 6, true)
      place('town-tree',    rx + 14, ry + rh - 3, 1.8, 6, true)
      place('town-topiary', rx + 6,  ry + 2,      1.1, 4, true)
      place('town-topiary', rx + 10, ry + 2,      1.1, 4, true)
    }
    // 看板は救済状況を確認するための機能物なので、廃墟状態でも常設・ティントなし
    place('town-signboard', rx + 7,  ry + 3,      1.08, 4)
    // 体当たりで捜し人一覧を開く（当たり判定はplace()内で登録済み。テクスチャ未読込時はplace()が無視するため位置も設定しない）
    this.signboardPos = this.textureOk('town-signboard') ? { x: rx + 7, y: ry + 3 } : null
    // 看板の未読「！」：初回・新しい救出があるまで表示。上下にふわふわ揺らす
    if (this.signboardPos) {
      const { x: markX, y: markY } = this.tileToWorld(this.signboardPos.x, this.signboardPos.y)
      const mark = this.add.text(markX, markY - this.rts * 1.1, '！', {
        fontSize: `${Math.round(this.rts * 0.6)}px`,
        color: '#ff4444',
        fontStyle: 'bold',
        stroke: '#ffffff',
        strokeThickness: 4,
      }).setOrigin(0.5).setDepth(6)
      this.tweens.add({ targets: mark, y: markY - this.rts * 1.35, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
      this.signboardMark = mark
      this.updateSignboardMark()
    }
    // 墓標（画像アセット不要。Graphics+絵文字で描画）。看板の3マス右隣＝十字路の右上。
    this.graveyardPos = { x: rx + 9, y: ry + 3 }
    this.drawGraveTombstone(this.graveyardPos)
    {
      const { x: gMarkX, y: gMarkY } = this.tileToWorld(this.graveyardPos.x, this.graveyardPos.y)
      const gMark = this.add.text(gMarkX, gMarkY - this.rts * 1.1, '！', {
        fontSize: `${Math.round(this.rts * 0.6)}px`,
        color: '#ff4444',
        fontStyle: 'bold',
        stroke: '#ffffff',
        strokeThickness: 4,
      }).setOrigin(0.5).setDepth(6).setVisible(false)
      this.tweens.add({ targets: gMark, y: gMarkY - this.rts * 1.35, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
      this.graveyardMark = gMark
      // 全プレイヤー共有データのため、最新idを取得して前回既読分（localStorage）と比較する
      void fetchLatestGraveyardId().then(latestId => {
        if (latestId === null) return
        this.graveyardLatestId = latestId
        this.graveyardUnread = latestId !== getLastSeenGraveyardId()
        this.updateGraveyardMark()
      })
    }
    // 噴水は広場の象徴として常設（ティントで「濁って涸れた噴水」→「澄んだ水」へ変化させる）
    place('town-fountain',  15,      14,          2.4, 3, true)
    // げーせん筐体：救済状況によらず常設（機能物なので看板/墓標と同じ扱い）。
    this.arcadePos = { x: 16, y: 16 }
    this.drawArcadeCabinet(this.arcadePos)
    // ベンチ・花壇は3体以上救済で設置（人が戻り始め、手入れが行き届き始めた頃合い）
    if (stage >= 3) {
      place('town-bench',   13,      14,          1.1, 3, true)
      place('town-flowers', rx + 5,  ry + 6,      0.9, 3, true)
      place('town-flowers', rx + 12, ry + 6,      0.9, 3, true)
      // 生垣：各NPC列の手前にワンポイントで（境界線は張らず、控えめなアクセントに留める）
      place('town-hedge', rx + 2,  12, 1.0, 3, true)
      place('town-hedge', rx + 13, 12, 1.0, 3, true)
      place('town-hedge', rx + 2,  18, 1.0, 3, true)
      place('town-hedge', rx + 13, 18, 1.0, 3, true)
    }
    // 井戸・街灯・池：5体以上救済で庭園アクセントとして追加（広場がにぎわい豊かになってきた段階）
    // 座標はNPCプロット(x=10/15/20)・十字通路(x=15列, y=10/15/20行)・既存デコを避けた空き地を選んでいる
    // ※石垣(town-rockwall)は単体だと道から浮いた石の塊にしか見えず「謎の階段」と誤認されるため撤去した
    if (stage >= 5) {
      place('town-well',     12, 11, 1.3, 3, true)
      place('town-lamp',     18, 11, 1.1, 4, true)
      place('town-pond',     12, 17, 1.4, 3, true)
    }
    // 全員解放（7体）：満開の庭園として花壇・街灯・トピアリーを追加し、原色フルで最も華やかな見た目に仕上げる
    if (stage >= 7) {
      place('town-flowers', 13, 19, 0.9, 3, true)
      place('town-topiary', 17, 19, 1.1, 4, true)
      place('town-lamp',    17, 13, 1.1, 4, true)
    }
    // 救済NPCごとの建物：NPCの2マス上に大きめのランドマークとして配置（NPCは建物の前に立つ構図）
    // 採掘師は店を構えないNPC（回復の泉のとなりで機能する）で、専用の建物素材が
    // 素朴な岩塊しかなく「謎の巨大岩」に見えてしまうため、建物は置かない。
    for (const kind of rescued) {
      if (kind === 'miner') continue
      const p = GameScene.PLAZA_PLOTS[kind]
      place(this.buildingTextureFor(kind), p.x, p.y - 2, 2.3, 3)
    }
  }

  // あるかなひろばの矩形（旧10x11から倍近くに拡張。町らしい余白を持たせるため）
  private static readonly PLAZA_RECT = { rx: 7, ry: 6, rw: 16, rh: 18 }

  /** イベントフロア専用の固定マップ（町の広場）を生成する */
  private generateEventFloorMap(): import('../types').TileType[][] {
    const map: import('../types').TileType[][] = Array.from({ length: MAP_HEIGHT }, () =>
      Array(MAP_WIDTH).fill('wall')
    )
    const { rx, ry, rw } = GameScene.PLAZA_RECT
    for (let y = ry; y < ry + GameScene.PLAZA_RECT.rh; y++) {
      for (let x = rx; x < rx + rw; x++) map[y][x] = 'floor'
    }
    map[ry][rx + Math.floor(rw / 2)] = 'stairs'
    return map
  }

  private showMidgardTitle() {
    window.showEventMessage?.('ベースキャンプ「あるかなひろば」に到着！', '#ffd766')
  }

  /** プレイヤーをその場で turns 回転させ、完了後に onComplete を呼ぶ */
  private spinPlayer(turns: number, duration: number, onComplete: () => void) {
    if (!this.playerGraphic) { onComplete(); return }
    const target = this.playerGraphic
    this.tweens.add({
      targets: target,
      angle: `+=${turns * 360}`,
      duration,
      ease: 'Linear',
      onComplete: () => {
        target.setAngle(0)
        onComplete()
      },
    })
  }

  // ── 精錬チャレンジ ──
  private readonly REFINE_BONUS_KEYS = ['hpBonus', 'strBonus', 'agiBonus', 'dexBonus', 'intBonus', 'vitBonus', 'lukBonus'] as const

  private applyEquipStatDelta(key: typeof this.REFINE_BONUS_KEYS[number], delta: number) {
    if (delta === 0) return
    const { player } = this.state
    switch (key) {
      case 'hpBonus':  player.maxHp += delta; player.hp = Math.min(Math.max(0, player.hp + Math.max(0, delta)), player.maxHp); break
      case 'strBonus': player.str += delta; break
      case 'agiBonus': player.agi += delta; break
      case 'dexBonus': player.dex += delta; break
      case 'intBonus': player.int += delta; break
      case 'vitBonus': player.vit += delta; break
      case 'lukBonus': player.luk += delta; break
    }
  }

  /** 装備品のボーナス値を factor 倍（精錬成功で1.1、失敗ペナルティで1/1.1）に変動させ、装備中の場合はプレイヤーの現在値にも差分を反映する */
  private adjustItemBonuses(item: import('../types').Item, factor: number) {
    for (const key of this.REFINE_BONUS_KEYS) {
      const old = item[key] ?? 0
      if (old <= 0) continue
      let next = Math.round(old * factor)
      if (factor > 1 && next <= old) next = old + 1
      if (factor < 1 && next >= old) next = Math.max(0, old - 1)
      const delta = next - old
      item[key] = next
      this.applyEquipStatDelta(key, delta)
    }
  }

  /** 精錬1回分の判定＋ボーナス反映のみを行う内部処理（単発/一括共通）。生贄の消費・メッセージ・通知は呼び出し側の責務。 */
  private refineOnce(target: import('../types').Item): { success: boolean; before: number; after: number } {
    const before = target.refineLevel ?? 0
    const success = Math.random() * 100 < refineSuccessPercent(before)
    let after = before
    if (success) {
      this.adjustItemBonuses(target, 1.1)
      after = before + 1
    } else if (before > 0 && Math.random() < 0.5) {
      this.adjustItemBonuses(target, 1 / 1.1)
      after = before - 1
    }
    target.refineLevel = after
    return { success, before, after }
  }

  private runRefineChallenge(slot: import('../types').EquipSlot, sacrificeId: string): import('../types').RefineResult | null {
    const { player, bag } = this.state
    const target = player.equipment[slot]
    if (!target) return null
    const sacrifice = bag.find(b => b.id === sacrificeId && b.type === 'equip')
    if (!sacrifice) return null
    if (sacrifice.locked) {
      this.addMessage(`${sacrifice.name}はロック中のため生贄にできない`)
      return null
    }

    // 精錬の生贄として消費
    this.state.bag = bag.filter(b => b.id !== sacrificeId)
    this.addMessage(`${sacrifice.name}を精錬の生贄に捧げた...`)

    const { success, before, after: level } = this.refineOnce(target)
    if (success) {
      this.addMessage(`${target.name}の精錬に成功した！ +${level}`)
      if (level >= 5) {
        fireWorldNotification('achievement', '【精錬成功】', `${getDisplayName()}さんが+${level}精錬に成功しました！`)
      }
    } else if (level < before) {
      this.addMessage(`${target.name}の精錬に失敗し、精錬値が下がってしまった... +${level}`)
    } else {
      this.addMessage(`${target.name}の精錬に失敗した...`)
    }
    this.updateWindowGameState()
    return { success, itemName: target.name, refineLevel: level }
  }

  /**
   * いっきにカンカン：選んだ生贄の数だけ精錬を連続実行する（1個=1回分）。
   * 途中経過はプレイヤーログに、終了後は増減にかかわらずワールドログに通知する。
   */
  private runBulkRefineChallenge(slot: import('../types').EquipSlot, sacrificeIds: string[]): import('../types').BulkRefineResult | null {
    const { player, bag } = this.state
    const target = player.equipment[slot]
    if (!target) return null
    const ids = [...new Set(sacrificeIds)].slice(0, 10)
    const sacrifices = ids
      .map(id => bag.find(b => b.id === id && b.type === 'equip'))
      .filter((b): b is import('../types').Item => !!b && !b.locked)
    if (sacrifices.length === 0) return null

    // 生贄をまとめて消費
    const consumedIds = new Set(sacrifices.map(s => s.id))
    this.state.bag = bag.filter(b => !consumedIds.has(b.id))
    this.addMessage(`いっきにカンカン：${sacrifices.length}個の生贄を捧げた...`)

    const attempts: import('../types').RefineAttempt[] = []
    for (const sacrifice of sacrifices) {
      const { success, before, after } = this.refineOnce(target)
      attempts.push({ success, before, after })
      this.addMessage(
        success
          ? `${target.name}の精錬に成功した！ +${before}→+${after}（生贄：${sacrifice.name}）`
          : after < before
          ? `${target.name}の精錬に失敗し、精錬値が下がってしまった... +${before}→+${after}（生贄：${sacrifice.name}）`
          : `${target.name}の精錬に失敗した...（生贄：${sacrifice.name}）`
      )
    }

    const startLevel = attempts[0].before
    const endLevel = attempts[attempts.length - 1].after
    // 増減にかかわらず、いっきにカンカン利用時は必ずワールドログを施行する
    fireWorldNotification(
      'achievement',
      '【いっきにカンカン】',
      `${getDisplayName()}さんがいっきにカンカンモードで${attempts.length}回精錬にチャレンジ！${target.name}が+${startLevel}→+${endLevel}になりました！`,
    )

    this.updateWindowGameState()
    return { itemName: target.name, attempts }
  }

  // ── 影装チャレンジ ──
  private readonly SHADOW_COST = 5

  /** 影装1回分の判定＋反映のみを行う内部処理（単発/一括共通）。statPoints消費は呼び出し側の責務。 */
  private shadowOnce(): import('../types').ShadowResult {
    const { player } = this.state
    const success = Math.random() < 0.2
    if (success) {
      player.str += 3; player.agi += 3; player.dex += 3
      player.int += 3; player.vit += 3; player.luk += 3
    }
    return { success }
  }

  private runShadowChallenge(): import('../types').ShadowResult | null {
    const { player } = this.state
    if (player.statPoints < this.SHADOW_COST) return null
    player.statPoints -= this.SHADOW_COST

    const { success } = this.shadowOnce()
    if (success) {
      this.addMessage('影装チャレンジに成功した！全ステータス+3！')
      fireWorldNotification('achievement', '【影装強化】', `${getDisplayName()}さんが影装強化に成功しました！`)
    } else {
      this.addMessage('影装チャレンジに失敗し、ボーナスポイントを失った...')
    }
    this.updateWindowGameState()
    return { success }
  }

  /**
   * いっきにエイ！エイ！ソー！：所持ボーナスポイントの続く限り（最大10回）影装チャレンジを連続実行する。
   * 途中経過はプレイヤーログに、終了後は必ずワールドログに通知する。
   */
  private runBulkShadowChallenge(times: number): import('../types').BulkShadowResult | null {
    const { player } = this.state
    const maxAffordable = Math.floor(player.statPoints / this.SHADOW_COST)
    const count = Math.max(0, Math.min(times, maxAffordable, 10))
    if (count === 0) return null

    const attempts: import('../types').ShadowResult[] = []
    for (let i = 0; i < count; i++) {
      player.statPoints -= this.SHADOW_COST
      const { success } = this.shadowOnce()
      attempts.push({ success })
      this.addMessage(
        success
          ? `影装チャレンジに成功した！全ステータス+3！（${i + 1}回目）`
          : `影装チャレンジに失敗し、ボーナスポイントを失った...（${i + 1}回目）`
      )
    }

    const successCount = attempts.filter(a => a.success).length
    fireWorldNotification(
      'achievement',
      '【いっきにエイ！エイ！ソー！】',
      `${getDisplayName()}さんがいっきにエイ！エイ！ソー！で${attempts.length}回影装にチャレンジ！${successCount}回成功しました！`,
    )

    this.updateWindowGameState()
    return { attempts }
  }

  // ── 魔法の書チャレンジ ──
  private runSpellbookChallenge(spellId: string): import('../types').SpellbookResult | null {
    const { spells } = this.state
    const target = spells.find(s => s.id === spellId)
    if (!target) return null
    this.state.spells = spells.filter(s => s.id !== spellId)

    const burned = Math.random() < 0.3
    if (burned) {
      this.addMessage(`${target.name}は炎に包まれて燃え尽きてしまった...`)
      this.updateWindowGameState()
      return { success: false, lostName: target.name }
    }

    const candidates = SPELL_ITEMS.filter(s => s.spellType !== target.spellType)
    const picked = candidates[Math.floor(Math.random() * candidates.length)]
    const gained: import('../types').Item = {
      id: `spell_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: picked.name,
      type: 'spell',
      position: { x: 0, y: 0 },
      spellType: picked.spellType,
    }
    this.state.spells.push(gained)
    this.addMessage(`${target.name}を渡し、${gained.name}を手に入れた！`)
    this.updateWindowGameState()
    return { success: true, lostName: target.name, gainedName: gained.name }
  }

  shutdown() {
    setHeartbeat(false)
    // ヒットストップ/スローモ中にシーンが終わっても等速へ戻す
    this.timeFreezeDepth = 0
    this.tweens.timeScale = 1
    this.time.timeScale = 1
    this.anims.globalTimeScale = 1
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    if (this.animatingTimer) { clearTimeout(this.animatingTimer); this.animatingTimer = null }
    if (this.skulporinHeartbeatTimer) { clearInterval(this.skulporinHeartbeatTimer); this.skulporinHeartbeatTimer = null }
    if (this.skulporinEscapeTimer) { clearInterval(this.skulporinEscapeTimer); this.skulporinEscapeTimer = null }
    window.triggerSkulporinCheck = undefined
    window.grantReward = undefined
  }

  // ─────────────────────────────────────────────────────────
  // すかるぽりん
  // ─────────────────────────────────────────────────────────

  // ADMINユーザー管理での閲覧用に、プレイヤーの現在状態を軽量JSONへまとめる。
  // 心拍(30秒ごと)に相乗りして active_sessions.state に保存される（最終同期時点のスナップショット）。
  private buildStateSnapshot(): Record<string, unknown> {
    const { player, spells, heals, bag } = this.state
    const equipment = Object.entries(player.equipment)
      .filter(([, it]) => !!it)
      .map(([slot, it]) => ({ slot, name: it!.name, refine: it!.refineLevel ?? 0 }))
    // 回復/コインは名前ごとに個数集計
    const healCounts: Record<string, number> = {}
    for (const h of heals) healCounts[h.name] = (healCounts[h.name] ?? 0) + 1
    return {
      level: player.level, exp: player.exp,
      hp: player.hp, maxHp: player.maxHp,
      stamina: player.stamina, maxStamina: player.maxStamina,
      floor: player.floor, turn: this.state.turn,
      str: player.str, agi: player.agi, dex: player.dex,
      int: player.int, vit: player.vit, luk: player.luk,
      statPoints: player.statPoints,
      equipment,
      spells: spells.map(s => s.name),
      heals: Object.entries(healCounts).map(([name, count]) => ({ name, count })),
      bagEquip: bag.filter(b => b.type === 'equip').map(b => ({ name: b.name, refine: b.refineLevel ?? 0 })),
    }
  }

  private async sendSkulporinHeartbeat(): Promise<void> {
    if (this.isGameOver || this.isEventFloor) return
    const { player } = this.state
    try {
      const res = await fetch('/api/skulporin-heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: getPlayerId(),
          player_name: getDisplayName(),
          floor: player.floor,
          // 放置プレイヤーがすかるぽりんの新規ターゲットに選ばれ続けるのを防ぐための無操作判定
          idle: Date.now() - this.lastActionAt >= GameScene.SKULPORIN_IDLE_MS,
          // ADMINユーザー管理で「現在のステータス・装備」を閲覧するための軽量スナップショット
          state: this.buildStateSnapshot(),
        }),
      })
      if (!res.ok) return
      const json = await res.json().catch(() => null)
      this.handleSkulporinSpawnResponse(json?.spawn ?? null)
      if (Array.isArray(json?.commands)) this.handleAdminCommands(json.commands)
      if (Array.isArray(json?.rewards)) this.handleLikeRewards(json.rewards)
    } catch {
      // fire-and-forget
    }
  }

  // いいねされた側：保留報酬を受け取って付与する。
  // 複数同時に届くと EventMsgBar が一瞬で上書きされ最後の1件しか見えないため、時間差で表示する。
  private handleLikeRewards(rewards: Array<{ reward_type: string; reward_name?: string | null; from_name?: string | null }>): void {
    rewards.forEach((r, i) => {
      this.time.delayedCall(i * 1900, () => {
        this.grantLikeReward(r, `${r.from_name ?? '冒険者'}さんからいいねいただきました！`)
      })
    })
  }

  // いいね報酬を実際に付与する（押した本人＝messageは「〜にいいねしました」、される側＝「〜からいいね…」）
  private grantLikeReward(
    reward: { reward_type: string; reward_name?: string | null },
    message: string,
  ): void {
    // 報酬なし（1日上限超過）＝コミュニケーションとしての通知のみ
    if (reward.reward_type === 'none') {
      this.addLikeMessage(`💗 ${message}`)
      this.updateWindowGameState()
      return
    }
    let detail: string
    if (reward.reward_type === 'point') {
      this.grantStatPoints(1)
      detail = 'ステータスポイント+1！'
    } else if (reward.reward_type === 'coin') {
      const coinCount = this.state.heals.filter(h => h.coin).length
      if (coinCount >= 10) {
        window.spinSlotOnce?.()
        detail = '女神のコイン獲得（満タンのため即使用）！'
      } else {
        this.state.heals.push({ id: `like_coin_${Date.now()}`, name: '女神のコイン', type: 'heal', position: { x: 0, y: 0 }, coin: true })
        detail = '女神のコインを獲得！'
      }
    } else {
      const name = reward.reward_name ?? '黄ポーション'
      const def = HEAL_ITEMS.find(h => h.name === name)
      const sameCount = this.state.heals.filter(h => h.name === name).length
      if (sameCount >= 10) {
        detail = `${name}を獲得したが持ちきれなかった…`
      } else {
        this.state.heals.push({
          id: `like_potion_${Date.now()}`,
          name,
          type: 'heal',
          position: { x: 0, y: 0 },
          healAmount: def?.healAmount ?? 0,
          ...(def && 'staminaPercent' in def ? { staminaPercent: (def as { staminaPercent: number }).staminaPercent } : {}),
        })
        detail = `${name}を獲得！`
      }
    }
    this.addLikeMessage(`💗 ${message} ${detail}`)
    this.updateWindowGameState()
  }

  // いいね系メッセージ：ログに残しつつ EventMsgBar は小さめサイズで表示（通常イベントより控えめに）
  private addLikeMessage(msg: string) {
    this.state.messages.unshift(msg)
    if (this.state.messages.length > 50) this.state.messages.pop()
    window.showEventMessage?.(msg, '#ff9ec4', true)
  }

  // ── ADMIN イベントコマンド処理（モンスターハウス強制 / モンスター強制ポップ）──
  private handleAdminCommands(cmds: Array<{
    command_type: string
    monster_name?: string | null
    monster_behavior?: string | null
    target_floor?: number | null
  }>): void {
    for (const c of cmds) {
      if (c.command_type === 'monster_house') {
        this.forceMonsterHouseNextFloor = true
        this.addMessage('⚠️ 何か嫌な予感がする……次のフロアに気をつけろ！')
        this.showPickupNotif('⚠️ 次のフロアに異変の気配……')
      } else if (c.command_type === 'spawn_monster' && c.monster_name) {
        // target_floor 指定があり現在フロアと違う場合は保留（到達時に発動）
        if (c.target_floor != null && c.target_floor !== this.state.player.floor) {
          this.pendingAdminSpawns.push({
            name: c.monster_name,
            behavior: (c.monster_behavior ?? 'normal') as 'normal' | 'boss' | 'skulporin',
            floor: c.target_floor,
          })
        } else {
          this.spawnAdminMonster(c.monster_name, (c.monster_behavior ?? 'normal') as 'normal' | 'boss' | 'skulporin')
        }
      }
    }
  }

  // 保留中の指定モンスターのうち、現在フロアに該当するものを出現させる
  private flushPendingAdminSpawns(): void {
    if (this.pendingAdminSpawns.length === 0) return
    const floor = this.state.player.floor
    const remain: typeof this.pendingAdminSpawns = []
    for (const p of this.pendingAdminSpawns) {
      if (p.floor === floor) this.spawnAdminMonster(p.name, p.behavior)
      else remain.push(p)
    }
    this.pendingAdminSpawns = remain
  }

  // 指定モンスターを現在フロアの空きタイルへ1体出現させる
  private spawnAdminMonster(name: string, behavior: 'normal' | 'boss' | 'skulporin'): void {
    if (this.isEventFloor || this.isGameOver) return
    if (behavior === 'skulporin') {
      if (this.state.enemies.some(e => e.isSkulporin)) return
      this.skulporinSpawnId  = -1
      this.skulporinEscapeAt = Date.now() + 3 * 60 * 1000
      this.startSkulporinEscapeTimer()
      this.spawnSkulporinOnFloor()
      return
    }
    const { map, player } = this.state
    const jailExclude = this.getJailNpcPos()
    const inView:   { x: number; y: number }[] = []
    const fallback: { x: number; y: number }[] = []
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) {
        if (map[y][x] !== 'floor') continue
        if (jailExclude.some(p => p.x === x && p.y === y)) continue
        const dx = x - player.position.x
        const dy = y - player.position.y
        const distSq = dx * dx + dy * dy
        if (distSq >= 1 && distSq <= VISION_RADIUS * VISION_RADIUS) inView.push({ x, y })
        else if (distSq > VISION_RADIUS * VISION_RADIUS) fallback.push({ x, y })
      }
    }
    const floors = inView.length > 0 ? inView : fallback
    if (floors.length === 0) return
    const pos = floors[Math.floor(Math.random() * floors.length)]
    const enemy = behavior === 'boss'
      ? makeNamedBossEnemy(name, player.floor)
      : makeNamedNormalEnemy(name, player.floor)
    enemy.position = { ...pos }
    this.state.enemies.push(enemy)
    dedupeEnemyPositions(this.state.enemies, map, player.position, jailExclude)
    this.addMessage(`⚡ ${enemy.name} が出現した！`)
    this.showPickupNotif(`⚡ ${enemy.name} 出現！`)
    this.renderMap()
  }

  private handleSkulporinSpawnResponse(spawn: {
    id: number
    target_floor: number
    target_player_id: string
    escapes_at: string
    status: string
  } | null): void {
    if (!spawn || spawn.status !== 'active') return

    // 既に倒した/逃した個体は無視（討伐通知のサーバー反映前に再表示されるのを防ぐ）
    if (this.resolvedSkulporinIds.has(spawn.id)) return

    // ターゲットに指名された本人のフロアにのみ出現させる（全員には出さない）
    if (spawn.target_player_id !== getPlayerId()) return

    // すでにマップに存在する場合はスキップ
    if (this.state.enemies.some(e => e.isSkulporin)) return

    // 逃走タイムスタンプを保存
    this.skulporinSpawnId  = spawn.id
    this.skulporinEscapeAt = new Date(spawn.escapes_at).getTime()
    this.startSkulporinEscapeTimer()

    this.spawnSkulporinOnFloor()
  }

  private spawnSkulporinOnFloor(): void {
    const { map, player } = this.state
    const jailExclude = this.getJailNpcPos()
    // プレイヤーのすぐ近く（2〜4マス）に出現させて見つけやすくする
    const near: { x: number; y: number }[] = []
    const far:  { x: number; y: number }[] = []
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) {
        if (map[y][x] !== 'floor') continue
        if (jailExclude.some(p => p.x === x && p.y === y)) continue
        const dist = Math.abs(x - player.position.x) + Math.abs(y - player.position.y)
        if (dist >= 2 && dist <= 4) near.push({ x, y })
        else if (dist >= 1) far.push({ x, y })
      }
    }
    const pool = near.length > 0 ? near : far
    if (pool.length === 0) return
    const pos = pool[Math.floor(Math.random() * pool.length)]

    this.state.enemies.push({
      id: 'skulporin_active',
      name: 'すかるぽりん',
      position: { ...pos },
      hp: 5,
      maxHp: 5,
      attack: 0,
      defense: 0,
      str: 0,
      vit: 0,
      agi: 3,
      luk: 0,
      slowedTurns: 0,
      isSkulporin: true,
    })
    dedupeEnemyPositions(this.state.enemies, map, player.position, jailExclude)

    this.addMessage('【すかるぽりんが出現した！】逃げる前に倒そう！')
    this.renderMap()
  }

  private attackSkulporin(enemy: import('../types').Enemy): void {
    if (Math.random() >= 0.1) {
      this.addMessage('すかるぽりんへの攻撃がはずれた！')
      this.popDamageNumber(enemy.position.x, enemy.position.y, '', { miss: true })
      return
    }
    enemy.hp = Math.max(0, enemy.hp - 1)
    this.popDamageNumber(enemy.position.x, enemy.position.y, 1, {})
    this.flashSprite(enemy.id)
    const eg = this.enemyGraphics.get(enemy.id)
    if (eg) this.spawnBurst(eg.x, eg.y, { color: 0x9966ff, count: 5, speed: this.rts * 0.7 })
    this.addMessage(`すかるぽりんに1ダメージ！（残りHP: ${enemy.hp}/5）`)

    if (enemy.hp <= 0) {
      this.killSkulporin(enemy)
    }
  }

  private killSkulporin(enemy: import('../types').Enemy): void {
    this.state.enemies = this.state.enemies.filter(e => e.id !== enemy.id)

    // API に討伐を通知（fire-and-forget）
    const spawnId = this.skulporinSpawnId
    if (spawnId !== null) {
      this.resolvedSkulporinIds.add(spawnId)   // 反映前の再出現を防ぐ
      void fetch('/api/skulporin-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'kill',
          spawn_id: spawnId,
          player_name: getDisplayName(),
          player_id: getPlayerId(),
        }),
      }).catch(() => {})
    }
    this.skulporinSpawnId  = null
    this.skulporinEscapeAt = null
    this.stopSkulporinEscapeTimer()

    // 経験値なし・コインなし（代わりに下の報酬ポップアップ）
    this.addMessage('すかるぽりんを倒した！豪華な報酬をゲット！')

    // 報酬をランダム選択
    const equips = this.pickSkulporinEquips(3)
    const spells = this.pickSkulporinSpells(3)

    window.showSkulporinReward?.(equips, spells, () => {
      // スペル追加
      for (const sp of spells) {
        const same = this.state.spells.filter(s => s.name === sp.name).length
        if (same < 10) {
          this.state.spells.push({ ...sp })
        }
      }
      // 装備品をバッグへ
      for (const eq of equips) {
        this.state.bag.push({ ...eq })
      }
      this.addMessage(`報酬を受け取った！バッグを確認してください。`)
      this.updateWindowGameState()
      // アルカナチャンス
      window.showArcanaRoulette?.(() => {})
    })
  }

  private handleSkulporinEscape(): void {
    const spawnId = this.skulporinSpawnId
    this.state.enemies = this.state.enemies.filter(e => !e.isSkulporin)
    this.skulporinSpawnId  = null
    this.skulporinEscapeAt = null
    this.stopSkulporinEscapeTimer()

    if (spawnId !== null) {
      this.resolvedSkulporinIds.add(spawnId)   // 反映前の再出現を防ぐ
      void fetch('/api/skulporin-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'escape', spawn_id: spawnId, player_id: getPlayerId() }),
      }).catch(() => {})
    }
    this.addMessage('すかるぽりんは闇の中に消えていった...')
    this.renderMap()
  }

  // 逃走監視タイマー（1秒間隔）を出現中だけ回す。常時intervalは発熱・電池の無駄になるため。
  private startSkulporinEscapeTimer(): void {
    if (this.skulporinEscapeTimer) return
    this.skulporinEscapeTimer = setInterval(() => this.checkSkulporinEscape(), 1_000)
  }

  private stopSkulporinEscapeTimer(): void {
    if (this.skulporinEscapeTimer) { clearInterval(this.skulporinEscapeTimer); this.skulporinEscapeTimer = null }
  }

  private checkSkulporinEscape(): void {
    if (this.skulporinEscapeAt === null) { this.stopSkulporinEscapeTimer(); return }
    if (Date.now() < this.skulporinEscapeAt) return
    if (!this.state.enemies.some(e => e.isSkulporin)) {
      // すでに倒されていた場合はリセットのみ
      this.skulporinEscapeAt = null
      this.skulporinSpawnId  = null
      this.stopSkulporinEscapeTimer()
      return
    }
    this.handleSkulporinEscape()
  }

  private pickSkulporinEquips(count: number): import('../types').Item[] {
    const pool = [...EQUIP_ITEMS]
    const result: import('../types').Item[] = []
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length)
      const base = pool.splice(idx, 1)[0]
      result.push({
        id: `skulporin_eq_${Date.now()}_${i}`,
        name: base.name,
        type: 'equip',
        position: { x: 0, y: 0 },
        equipSlot: base.equipSlot,
        weaponKind: base.weaponKind,
        hpBonus:  base.hpBonus,
        strBonus: base.strBonus,
        agiBonus: base.agiBonus,
        dexBonus: base.dexBonus,
        intBonus: base.intBonus,
        vitBonus: base.vitBonus,
        lukBonus: base.lukBonus,
      })
    }
    return result
  }

  private pickSkulporinSpells(count: number): import('../types').Item[] {
    const pool = [...SPELL_ITEMS]
    const result: import('../types').Item[] = []
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length)
      const base = pool.splice(idx, 1)[0]
      result.push({
        id: `skulporin_sp_${Date.now()}_${i}`,
        name: base.name,
        type: 'spell',
        position: { x: 0, y: 0 },
        spellType: base.spellType,
      })
    }
    return result
  }

  // ─────────────────────────────────────────────────────────
  // ドッペルゲンガー
  // ─────────────────────────────────────────────────────────

  // フロア到達時：死亡階±10階（10階未満は対象外）に他プレイヤーの記録があれば10%で1体出現させる。
  // この周回で既に撃破済みの記録は除外する（DB自体は削除しないため、他プレイヤーや次回の周回には
  // 引き続き出現しうる＝10階バンドの保持上限に達するまで何度でも遭遇可能）。
  private async checkDoppelgangerSpawn(): Promise<void> {
    if (this.isGameOver || this.isEventFloor) return
    if (this.state.enemies.some(e => e.isDoppelganger)) return
    if (Math.random() >= 0.10) return
    const floor = this.state.player.floor
    const record = await fetchDoppelgangerCandidate(floor, this.defeatedDoppelgangerIds)
    if (!record) return
    // 非同期待ちの間にフロアを離れていたら出現させない
    if (this.isGameOver || this.isEventFloor || this.state.player.floor !== floor) return
    if (this.state.enemies.some(e => e.isDoppelganger)) return   // 1イベントにつき1体のみ
    this.spawnDoppelganger(record)
  }

  private spawnDoppelganger(record: DoppelgangerRecord): void {
    const { map, player } = this.state
    const jailExclude = this.getJailNpcPos()
    const floors: { x: number; y: number }[] = []
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) {
        if (map[y][x] !== 'floor') continue
        if (jailExclude.some(p => p.x === x && p.y === y)) continue
        floors.push({ x, y })
      }
    }
    if (floors.length === 0) return
    const pos = floors[Math.floor(Math.random() * floors.length)]

    // 敵ステータス変換：既存の attackEnemy/enemyTurn の式（effectiveAtk=str*1.5+level、
    // 防御=vit+level/2）と整合するよう、enemy.attack/defense を逆算する。
    // enemyTurnはbaseAtk=enemy.attack+floor(str*0.5)を計算するため、その分を差し引いておく。
    const str   = Math.max(0, Math.floor(record.str))
    const level = Math.max(1, Math.floor(record.level))
    const atkTotal = Math.floor(str * 1.5) + level
    const attack   = Math.max(0, atkTotal - Math.floor(str * 0.5))
    const defense  = Math.max(0, Math.floor(level / 2))
    const maxHp    = Math.max(1, Math.floor(record.max_hp))

    const enemy: Enemy = {
      id: `doppel_${record.id}_${Date.now()}`,
      position: { ...pos },
      hp: maxHp,
      maxHp,
      attack,
      defense,
      str,
      vit: Math.max(0, Math.floor(record.vit)),
      agi: Math.max(0, Math.floor(record.agi)),
      luk: Math.max(0, Math.floor(record.luk)),
      slowedTurns: 0,
      name: `ドッペルゲンガー「${record.player_name}」`,
      isDoppelganger: true,
      // 受取時クランプ：報酬は死亡階×10を上限とする（深層で死んだ強者ほど高報酬の設計は維持）。
      // 複利遮断（doppelPointsGained除外）導入前に肥大化した既存記録への対策で、
      // DBを書き換えなくても過去データ・新データとも同じ天井に収まる。
      doppelStatReward: Math.min(
        Math.max(0, Math.floor(record.stat_point_reward)),
        Math.max(1, Math.floor(record.floor)) * 10,
      ),
    }
    this.state.enemies.push(enemy)
    dedupeEnemyPositions(this.state.enemies, map, player.position, jailExclude)
    this.addMessage(`【ドッペルゲンガーが出現した！】「${record.player_name}」の魂が眠っていたようだ…`)
    this.renderMap()
    // populateFloor完了後の非同期出現のため、ボスBGMへの切り替えをここで再評価する
    this.updateBGM()
    fireWorldNotification(
      'boss',
      '【ドッペルゲンガー出現】',
      `${getDisplayName()}さんがいる${floorLabel(this.state.player.floor)}にドッペルゲンガー「${record.player_name}」が出現しました！`,
    )
  }

  /**
   * ドッペルゲンガー撃破：ステータスポイント報酬を付与する。DBの記録は削除せず、
   * この周回中だけ再出現しないよう defeatedDoppelgangerIds に記録する
   * （他プレイヤーや次回以降の周回には引き続き出現しうる）。
   */
  private killDoppelganger(enemy: Enemy): void {
    this.state.enemies = this.state.enemies.filter(e => e.id !== enemy.id)

    const idMatch = enemy.id.match(/^doppel_(\d+)_/)
    if (idMatch) this.defeatedDoppelgangerIds.add(Number(idMatch[1]))

    const reward = enemy.doppelStatReward ?? 0
    if (reward > 0) {
      this.grantStatPoints(reward)
      // 継承分は自分の死亡時に再継承させない（複利インフレ防止。registerDeadCharacter参照）
      const p = this.state.player
      p.doppelPointsGained = (p.doppelPointsGained ?? 0) + reward
    }
    this.addMessage(`ドッペルゲンガーを倒した！生前のステータスポイント${reward}を引き継いだ！`)
    window.showEventMessage?.(`ドッペルゲンガー討伐！ステータスポイント+${reward}`, '#cc88ff')

    // 撃破演出・後片付け（通常のkillEnemyと同様。経験値・コインドロップは対象外）
    const g   = this.enemyGraphics.get(enemy.id)
    const bar = this.enemyHpBars.get(enemy.id)
    this.enemyGraphics.delete(enemy.id)
    this.enemyHpBars.delete(enemy.id)
    if (bar) { bar.bg.destroy(); bar.fg.destroy() }
    this.destroyEnemyDecor(enemy.id)
    if (g) {
      this.tweens.killTweensOf(g)
      if (g.visible) {
        this.spawnBurst(g.x, g.y, { color: 0x9966ff, count: 10, speed: this.rts * 1.1 })
        this.cameras.main.shake(200, 0.008)
        this.tweens.add({
          targets: g,
          alpha: 0,
          scaleX: g.scaleX * 0.2,
          scaleY: g.scaleY * 0.2,
          angle: 90,
          duration: 240,
          ease: 'Quad.In',
          onComplete: () => g.destroy(),
        })
      } else {
        g.destroy()
      }
    }
    // 通常の敵撃破と同様、スロットのキル連動クレジット・討伐ログにも計上する
    window.onEnemyKilled?.()
    logEvent('kill', { floor: this.state.player.floor, enemy_name: enemy.name, is_boss: false })
    this.updateWindowGameState()
  }

  private gameOver() {
    if (this.isGameOver) return   // 1ターン内で複数回HP<=0判定が走っても遷移は1回だけにする
    this.isGameOver = true
    setHeartbeat(false)
    // プレイ中フラグの解除と通知を最優先で行う（後続処理が万一throwしても
    // ジョイスティックのタッチ横取りや「いいね」判定が生き残らないように）
    window.isGameSceneActive = false
    window.dispatchEvent(new Event('game-scene-changed'))
    logEvent('death', { floor: this.state.player.floor, level: this.state.player.level, enemy_name: this.lastDeathCause })
    clearSave()              // ローカル中断データをゲームオーバーで強制消滅
    void deleteOwnCloudSave() // クラウドセーブも削除（復活＝セーブスカミング防止・permadeath維持）
    this.input.keyboard!.off('keydown', this.handleInput, this)
    this.input.off('pointerdown', this.handlePointerMove, this)
    // 少し間を置いてから暗転 → ゲームオーバー画面へ
    this.time.delayedCall(700, () => this.cameras.main.fadeOut(500, 0, 0, 0))
    // 全身の精錬値合計（装備中アイテムの refineLevel を合算）
    const refineTotal = Object.values(this.state.player.equipment)
      .reduce((sum, eq) => sum + (eq?.refineLevel ?? 0), 0)
    const jackpotWins = this.state.player.jackpotWins ?? 0
    // ドッペルゲンガー登録用スナップショット（GAME OVER画面での同意確認後に使う。ここでは登録しない）
    // 10階未満での死亡は弱すぎて出現候補としての意味が薄いため、そもそも同意確認自体を出さない
    const doppelSnapshot = this.state.player.floor >= 10 ? this.state.player : undefined
    this.time.delayedCall(1250, () => {
      this.scene.start('GameOverScene', {
        floor: this.state.player.floor,
        level: this.state.player.level,
        refineTotal,
        jackpotWins,
        doppelSnapshot,
        deathCause: this.lastDeathCause,
      })
    })
  }

  private addMessage(msg: string) {
    this.state.messages.unshift(msg)
    if (this.state.messages.length > 50) this.state.messages.pop()
    window.showEventMessage?.(msg)
  }

  /** ワールド通知をゲーム内ログに残す（EventMsgBarは光らせない。テロップと役割分担）。 */
  private addWorldLogMessage(text: string) {
    this.state.messages.unshift(text)
    if (this.state.messages.length > 50) this.state.messages.pop()
    this.updateWindowGameState()
  }

  private updateWindowGameState() {
    const { player, messages } = this.state
    window.gameState = {
      hp: player.hp,
      maxHp: player.maxHp,
      level: player.level,
      exp: player.exp,
      floor: player.floor,
      stamina: player.stamina,
      maxStamina: player.maxStamina,
      poisoned: player.poisoned,
      messages: [...messages],
      equipment: { ...player.equipment },
      str: player.str,
      agi: player.agi,
      dex: player.dex,
      int: player.int,
      vit: player.vit,
      luk: player.luk,
      statPoints: player.statPoints,
      spells: [...this.state.spells],
      heals: [...this.state.heals],
      bag: [...this.state.bag],
      minimapData: {
        tiles: this.state.map,
        playerPos: { ...player.position },
        enemies: this.state.enemies.map(e => ({
          x: e.position.x, y: e.position.y, isBoss: (e.isBoss || e.isDoppelganger) ?? false,
        })),
        items: this.state.items.map(i => ({ x: i.position.x, y: i.position.y })),
      },
      pendingEquip: this.pendingItem && this.pendingItem.equipSlot ? {
        newItem: this.pendingItem,
        currentItem: this.state.player.equipment[this.pendingItem.equipSlot] ?? null,
      } : null,
      floorType: this.state.floorType,
      bowTargetInRange:
        weaponKindOf(player.equipment.weapon) === 'bow' &&
        this.state.enemies.some(e => {
          const d = Math.abs(e.position.x - player.position.x) + Math.abs(e.position.y - player.position.y)
          return d <= BOW_RANGE && this.hasLineOfSight(player.position.x, player.position.y, e.position.x, e.position.y)
        }),
    }
    window.dispatchEvent(new Event('gamestate-update'))
    this.updateLowHpVignette()
  }

  // ── スロットマシーン効果処理 ──
  private applySlotEffect(result: string) {
    const { player } = this.state

    switch (result) {
      case 'jackpot': {
        // ジャックポット当選回数を記録（プールが空でも「当選」自体はカウント。ランキング表示用）
        this.state.player.jackpotWins = (this.state.player.jackpotWins ?? 0) + 1
        // 動画終了後にここへ到達。全鯖共有プールを総取り → ステータスポイントへ加算（取得は非同期）
        void claimJackpot().then(won => {
          if (won <= 0) {
            // 直前に他プレイヤーが総取りした等でプールが空 → 最低保証で「当たったのに0枚」を防ぐ
            const guarantee = 20
            this.grantStatPoints(guarantee)
            this.addMessage(`💰 JACKPOT！プールは空だったが、最低保証 ${guarantee}ポイントを獲得！`)
            window.showSlotAnnouncement?.('jackpot', `プールは空…最低保証 ${guarantee}ポイント獲得！`)
            this.updateWindowGameState()
            return
          }
          this.grantStatPoints(won)
          this.addMessage(`💰 JACKPOT！！共有プール ${won}ポイントを総取り！！`)
          window.showSlotAnnouncement?.('jackpot', `ポイント総取り ${won}ポイントゲット！`)
          fireWorldNotification(
            'achievement',
            '【💰JACKPOT💰】',
            `${getDisplayName()}さんがジャックポットを引き当て ${won}ポイントを総取りしました！`,
          )
          this.updateWindowGameState()
        })
        playLevelUp()
        break
      }
      case '777': {
        player.level      += 10
        this.grantStatPoints(50)
        player.maxHp       = Math.floor(player.maxHp      * 1.1)
        player.maxStamina  = Math.floor(player.maxStamina * 1.1)
        player.hp          = player.maxHp
        player.stamina     = player.maxStamina
        this.state.enemies = []
        this.addMessage('🔥 阿修羅覇王拳！！Lv+10・HP/STA上限+10%・全敵消滅！！')
        window.showSlotAnnouncement?.('777')
        playLevelUp()
        break
      }
      case 'triple': {
        player.hp = player.maxHp; player.stamina = player.maxStamina
        for (let i = 0; i < 3; i++) {
          const pool  = spawnItems(this.state.map, { countMult: 1, equipRate: 1.0, floor: this.state.player.floor })
          const equip = pool.find(it => it.type === 'equip')
          if (equip) {
            this.state.bag.push({ ...equip, position: { x: 0, y: 0 } })
          }
        }
        window.showSlotAnnouncement?.('triple')
        break
      }
      case 'skulls':
        player.hp = Math.max(1, Math.floor(player.hp / 2))
        window.showSlotAnnouncement?.('skulls')
        break
      case 'lr_match':
        player.hp = Math.min(player.maxHp, player.hp + Math.floor(player.maxHp / 2))
        window.showSlotAnnouncement?.('lr_match')
        break
      case 'adjacent':
        player.stamina = Math.min(player.maxStamina, player.stamina + Math.floor(player.maxStamina / 2))
        window.showSlotAnnouncement?.('adjacent')
        break
      case 'sequential':
        this.slotSpawnEquip()
        window.showSlotAnnouncement?.('sequential')
        break
      case 'kakuhen':
      case 'kakuhen_miss': {
        this.grantStatPoints(30)
        window.showSlotAnnouncement?.('kakuhen')
        window.releaseSlotSpins?.()   // アルカナ演出完了（ルーレット非表示のフォールバック経路）→ スロット再開
        break
      }
      default: {
        let missSub = ''
        if (Math.random() < 0.3) {
          if (Math.random() < 0.5) {
            player.stamina = Math.max(0, player.stamina - 20)
            missSub = 'スタミナ -20…'
          } else {
            player.poisoned = true; player.poisonTurns = 5
            missSub = '毒状態になった…'
          }
        }
        window.showSlotAnnouncement?.('miss', missSub)
      }
    }

    const isWin  = result !== 'miss' && result !== 'kakuhen' && result !== 'kakuhen_miss'
    const isMiss = result === 'miss'
    if ((isWin || isMiss) && Math.random() < 0.011) {
      const kakuhenVideo = isWin ? 'kakuhen' : 'kakuhen_miss'
      // アルカナ演出が終わるまでスロットの自動消化を止める（連続スピンに当たりが埋もれるのを防ぐ）
      window.holdSlotSpins?.()
      // 当選/ハズレアナウンス（最長3000ms＋フェード500ms）が消えるのを待ってから演出開始
      this.time.delayedCall(3500, () => {
        this.addMessage('🌌 アルカナチャンス発動！')
        fireWorldNotification('achievement', '【女神の祝福】', `${getDisplayName()}さんがアルカナチャンスに当選しました！`)
        window.showSlotAnnouncement?.('kakuhen_start')
        this.time.delayedCall(3000, () => {
          window.playBonusVideo?.(kakuhenVideo)
        })
      })
    }

    if (player.hp <= 0) { player.hp = 0; this.gameOver() }
    this.renderMap()
    this.updateWindowGameState()
  }

  // アルカナチャンス専用ルーレットの結果ポイントを付与する
  private applyArcanaResult(points: number) {
    window.releaseSlotSpins?.()   // アルカナ演出完了 → スロット自動消化を再開
    const p = Math.max(0, Math.floor(points))
    this.grantStatPoints(p)
    this.addMessage(`🌌 アルカナチャンス！ ステータスポイント +${p} 獲得！`)
    fireWorldNotification(
      'achievement',
      '【女神の祝福】',
      `${getDisplayName()}さんがアルカナチャンスで${p}ポイント獲得しました！`,
    )
    this.updateWindowGameState()
  }

  private slotSpawnEquip() {
    const pool = spawnItems(this.state.map, { countMult: 1, equipRate: 1.0, floor: this.state.player.floor })
    const equip = pool.find(i => i.type === 'equip')
    if (equip) {
      this.notifyIfMasterwork(equip)
      this.state.bag.push({ ...equip, position: { x: 0, y: 0 } })
      this.addMessage(`🎰 女神からのプレゼント！ランダム装備品ゲット！`)
      this.addMessage(`→ ${equip.name}をバッグに入れた`)
    }
  }

  private updateBGM() {
    if (this.isEventFloor) { playBGM('town'); return }   // あるかなひろば専用BGM
    const hasBoss = this.state.enemies.some(e => e.isBoss || e.isDoppelganger)
    playBGM(hasBoss ? 'boss' : 'dungeon')
  }

  private determineFloorType(luk: number, floor: number): 'normal' | 'lucky' | 'chaos' {
    const luckyChance = Math.min(0.50, 0.03 + luk * 0.005)
    const chaosChance = floor <= 5 ? 0 : Math.min(0.30, 0.01 + luk * 0.008)
    const r = Math.random()
    if (r < luckyChance) return 'lucky'
    if (r < luckyChance + chaosChance) return 'chaos'
    return 'normal'
  }

  private showMonsterHouseEffect() {
    const W = this.scale.width
    const H = this.scale.height
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0xff2200, 0).setDepth(90).setScrollFactor(0)
    this.tweens.add({
      targets: overlay,
      alpha: 0.45,
      duration: 180,
      ease: 'Power2',
      yoyo: true,
      repeat: 3,
      onComplete: () => overlay.destroy(),
    })
  }

  /** 現在フロアの視界パラメータ。瘴気フロアでは通常より3マス狭く・薄紫フォグになる
   *  （瘴気の見える2マスは薄い紫の靄、3マス目以遠はタイル非表示で完全暗黒）。 */
  private vision(): { radius: number; fogInner: number; fogOuter: number; fogColor: number; fogMaxAlpha: number } {
    return this.state.miasmaFloor
      ? { radius: VISION_RADIUS - 3, fogInner: VISION_FOG_INNER - 1, fogOuter: VISION_FOG_OUTER - 3, fogColor: 0x9a7ad0, fogMaxAlpha: 0.5 }
      : { radius: VISION_RADIUS,     fogInner: VISION_FOG_INNER,     fogOuter: VISION_FOG_OUTER,     fogColor: 0x000000, fogMaxAlpha: 1 }
  }

  private isVisible(tx: number, ty: number): boolean {
    if (this.state.floorType === 'lucky' || this.isEventFloor) return true
    const { player } = this.state
    const dx = tx - player.position.x
    const dy = ty - player.position.y
    const r = this.vision().radius
    return dx * dx + dy * dy <= r * r
  }

  private isTileVisible(tx: number, ty: number): boolean {
    if (this.state.floorType === 'lucky' || this.isEventFloor) return true
    const { player } = this.state
    const dx = tx - player.position.x
    const dy = ty - player.position.y
    const o = this.vision().fogOuter
    return dx * dx + dy * dy <= o * o
  }

  // ── 戦闘エフェクト（game feel） ──

  /** タイル座標 → ワールド座標（タイル中心px。カメラがスクロールを担当する） */
  /**
   * プレイヤーが現在位置から (ex,ey) の敵を攻撃できるか。
   * チェビシェフ距離1、かつ斜めの場合は壁角越し不可（移動時のコーナーカット防止 L466-468 と同条件）。
   * 攻撃可能マークの表示判定に使う（実攻撃ルールと一致させ、嘘UIにしない）。
   */
  private canPlayerReachAttack(ex: number, ey: number): boolean {
    const px = this.state.player.position.x
    const py = this.state.player.position.y
    const dx = ex - px
    const dy = ey - py
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return false
    if (dx !== 0 && dy !== 0) {
      if (this.state.map[py]?.[ex] === 'wall') return false
      if (this.state.map[ey]?.[px] === 'wall') return false
    }
    return true
  }

  /**
   * 2点間に壁を挟まず射線が通るか（弓の射程判定・射程表示に使用）。
   * ブレゼンハムのアルゴリズムで始点/終点を除く経路上のタイルを調べ、壁があれば不通とする。
   */
  private hasLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    let x = x0, y = y0
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx - dy
    while (x !== x1 || y !== y1) {
      const e2 = 2 * err
      if (e2 > -dy) { err -= dy; x += sx }
      if (e2 < dx)  { err += dx; y += sy }
      if (x === x1 && y === y1) break
      if (this.state.map[y]?.[x] === 'wall') return false
    }
    return true
  }

  private tileToWorld(tx: number, ty: number): { x: number; y: number } {
    return {
      x: tx * this.rts + this.rts / 2,
      y: ty * this.rts + this.rts / 2,
    }
  }

  /**
   * ダメージ数字をタイル上にポップさせる。
   * crit=大きく黄色、heal=緑＋、miss=灰色「MISS」、toPlayer=赤系（被ダメ）
   */
  private popDamageNumber(
    tx: number, ty: number, value: number | string,
    opts: { crit?: boolean; heal?: boolean; miss?: boolean; toPlayer?: boolean } = {}
  ) {
    const { x, y } = this.tileToWorld(tx, ty)
    const { crit, heal, miss, toPlayer } = opts

    // ダメージ量の階調：大きいダメージほど数字がデカく・熱い色に・派手に跳ねる（成長の可視化）
    const v    = typeof value === 'number' ? value : 0
    const tier = v >= 1000 ? 3 : v >= 300 ? 2 : v >= 100 ? 1 : 0
    const tierColor = ['#ffffff', '#ffe9a8', '#ffc14d', '#ff8a2a'][tier]

    const color = miss ? '#cccccc'
      : heal ? '#66ff99'
      : crit ? '#ffdd33'
      : toPlayer ? '#ff5555'
      : tierColor
    const sizeMul  = [1, 1.18, 1.42, 1.72][tier]
    const baseSize = this.rts * (crit ? 0.62 : 0.46) * sizeMul
    const text = miss ? 'MISS' : heal ? `+${value}` : `${value}`

    // 横位置を少しランダムにずらして連続ヒットでも重ならないように
    const jitterX = (Math.random() - 0.5) * this.rts * 0.4
    const startY  = y - this.rts * 0.25

    const label = this.add.text(x + jitterX, startY, text, {
      fontSize: `${Math.round(baseSize)}px`,
      fontFamily: 'Arial, sans-serif',
      color,
      fontStyle: crit || tier >= 1 ? 'bold' : 'normal',
      stroke: '#000000',
      strokeThickness: Math.max(2, Math.round(baseSize * (tier >= 2 ? 0.17 : 0.14))),
    }).setOrigin(0.5).setDepth(20)

    if (crit || tier >= 2) {
      // 「ドン」と飛び出す。特大(tier3)はわずかに傾けてインパクトを足す
      label.setScale(0.4)
      if (tier >= 3) label.setAngle(Math.random() < 0.5 ? -8 : 8)
      this.tweens.add({ targets: label, scale: 1, angle: 0, duration: 160, ease: 'Back.Out' })
    }

    this.tweens.add({
      targets: label,
      y: startY - this.rts * (crit || tier >= 2 ? 1.1 : 0.85),
      alpha: 0,
      duration: (crit ? 900 : 700) + tier * 120,
      ease: 'Cubic.Out',
      onComplete: () => label.destroy(),
    })
  }

  /** スプライトを白く点滅させる（ヒット時のフラッシュ） */
  private flashSprite(id: string) {
    const g = this.enemyGraphics.get(id)
    if (!g) return
    if (g instanceof Phaser.GameObjects.Image) {
      g.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)
      this.time.delayedCall(90, () => { if (g.active) g.clearTint() })
    } else if (g instanceof Phaser.GameObjects.Rectangle) {
      const orig = g.fillColor
      g.setFillStyle(0xffffff)
      this.time.delayedCall(90, () => { if (g.active) g.setFillStyle(orig) })
    }
  }

  /** プレイヤースプライトを赤く点滅（被ダメ時） */
  private flashPlayer() {
    const g = this.playerGraphic
    if (!g) return
    if (g instanceof Phaser.GameObjects.Sprite) {
      g.setTint(0xff3333).setTintMode(Phaser.TintModes.FILL)
      this.time.delayedCall(110, () => { if (g.active) g.clearTint() })
    } else if (g instanceof Phaser.GameObjects.Rectangle) {
      const orig = g.fillColor
      g.setFillStyle(0xff3333)
      this.time.delayedCall(110, () => { if (g.active) g.setFillStyle(orig) })
    }
  }

  /** 床タイルのバリアント（floor1/2/3）をフロア生成時にランダム決定・固定 */
  // ── 画像の背景を透過（ロード済み PNG から実行。プレイヤー画像／ADMINアップロード画像の両方で使用） ──
  // 単色背景だけでなく「青背景＋白い角」のような複数色背景や、ゆるいグラデーション背景にも対応する。
  //   1) エッジ(外周1px)の不透明色を複数クラスタに分け、有意なものを全て背景シードとして採用
  //   2) エッジから連結する「シード色に近い or 勾配で連続する」ピクセルだけをflood fillで透過
  //      （外周連結のみ＝本体内部の同系色は守る。勾配追従はシードからの距離上限で本体への侵入を防ぐ）
  //   3) 透明に隣接して残った薄い背景フリンジ(にじみ)を1px掃除
  private makeTransparent(key: string) {
    if (!this.textures.exists(key)) return

    const src = this.textures.get(key).getSourceImage() as HTMLImageElement
    const w = src.naturalWidth  || src.width
    const h = src.naturalHeight || src.height
    if (!w || !h) return

    const canvas = document.createElement('canvas')
    canvas.width  = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(src, 0, 0)

    const id = ctx.getImageData(0, 0, w, h)
    const d  = id.data

    // 既にアルファ透過済み（一定割合以上が完全透明）の画像は処理をスキップする。
    // 触手や髪など本体の一部が画像の縁ギリギリに触れているだけで背景色クラスタと誤認識し、
    // 本体色まで巻き込んで消してしまう事故（ヒドラ/ゾンビ/ボンゴン等で発生）を防ぐため。
    let alreadyTransparent = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] === 0) alreadyTransparent++
    if (alreadyTransparent / (w * h) > 0.02) return

    // エッジ(外周1px)のピクセルインデックスを列挙
    const edge: number[] = []
    for (let x = 0; x < w; x++) { edge.push(x); edge.push((h - 1) * w + x) }
    for (let y = 1; y < h - 1; y++) { edge.push(y * w); edge.push(y * w + w - 1) }

    // 背景色クラスタリング：白い角＋色背景など複数色の背景を取りこぼさない
    const clusters: { r: number; g: number; b: number; count: number }[] = []
    const CLU_TOL = 40          // 同一背景クラスタとみなすマンハッタン色距離（緩すぎると勾配背景が1色に潰れて取りこぼす）
    let edgeOpaque = 0
    for (const pi of edge) {
      const i = pi * 4
      if (d[i + 3] < 200) continue
      edgeOpaque++
      const r = d[i], g = d[i + 1], b = d[i + 2]
      let best: typeof clusters[number] | null = null, bestD = Infinity
      for (const c of clusters) {
        const dd = Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b)
        if (dd < bestD) { bestD = dd; best = c }
      }
      if (best && bestD <= CLU_TOL) {
        const n = best.count + 1
        best.r = (best.r * best.count + r) / n
        best.g = (best.g * best.count + g) / n
        best.b = (best.b * best.count + b) / n
        best.count = n
      } else {
        clusters.push({ r, g, b, count: 1 })
      }
    }
    if (edgeOpaque === 0) return  // 全エッジが既に透過 → 処理不要

    // エッジの3%以上を占めるクラスタを背景シードに（少なくとも最頻の1つは採用）
    const minCount = Math.max(2, edgeOpaque * 0.03)
    let seeds = clusters.filter(c => c.count >= minCount)
    if (seeds.length === 0) seeds = [clusters.reduce((a, b) => (b.count > a.count ? b : a))]

    const SEED_TOL2  = 48 * 48   // シード色からの許容（二乗距離）
    const GRAD_CAP2  = 96 * 96   // 勾配追従の上限（シードからの二乗距離）＝本体への侵入防止
    const LOCAL_TOL  = 16        // 勾配追従：隣接ピクセル間のマンハッタン色差
    const FRINGE2    = 70 * 70   // フリンジ掃除：背景寄りと判定する二乗距離

    const nearestSeed2 = (r: number, g: number, b: number) => {
      let m = Infinity
      for (const s of seeds) {
        const dr = s.r - r, dg = s.g - g, db = s.b - b
        const dd = dr * dr + dg * dg + db * db
        if (dd < m) m = dd
      }
      return m
    }

    const visited = new Uint8Array(w * h)   // 1 = 背景として透過した
    const stack: number[] = []
    for (const pi of edge) {
      const i = pi * 4
      if (!visited[pi] && d[i + 3] >= 128 && nearestSeed2(d[i], d[i + 1], d[i + 2]) <= SEED_TOL2) {
        visited[pi] = 1; stack.push(pi)
      }
    }

    while (stack.length > 0) {
      const pi = stack.pop()!
      const i = pi * 4
      const cr = d[i], cg = d[i + 1], cb = d[i + 2]
      d[i + 3] = 0
      const px = pi % w, py = (pi / w) | 0
      for (let k = 0; k < 4; k++) {
        let nx = px, ny = py
        if (k === 0) { if (px === 0) continue; nx = px - 1 }
        else if (k === 1) { if (px === w - 1) continue; nx = px + 1 }
        else if (k === 2) { if (py === 0) continue; ny = py - 1 }
        else { if (py === h - 1) continue; ny = py + 1 }
        const ni = ny * w + nx
        if (visited[ni]) continue
        const j = ni * 4
        if (d[j + 3] < 128) { visited[ni] = 1; continue }
        const nr = d[j], ng = d[j + 1], nb = d[j + 2]
        const ns2 = nearestSeed2(nr, ng, nb)
        const nearSeed  = ns2 <= SEED_TOL2
        const gradFollow = ns2 <= GRAD_CAP2 &&
          (Math.abs(nr - cr) + Math.abs(ng - cg) + Math.abs(nb - cb)) <= LOCAL_TOL
        if (nearSeed || gradFollow) { visited[ni] = 1; stack.push(ni) }
      }
    }

    // フリンジ掃除：透明に隣接して残った「背景寄りの薄いにじみ」を1pxだけ透過する
    const fringe: number[] = []
    for (let pi = 0; pi < w * h; pi++) {
      const i = pi * 4
      if (visited[pi] || d[i + 3] === 0) continue
      if (nearestSeed2(d[i], d[i + 1], d[i + 2]) > FRINGE2) continue
      const px = pi % w, py = (pi / w) | 0
      const adjTransparent =
        (px > 0     && visited[pi - 1]) ||
        (px < w - 1 && visited[pi + 1]) ||
        (py > 0     && visited[pi - w]) ||
        (py < h - 1 && visited[pi + w])
      if (adjTransparent) fringe.push(pi)
    }
    for (const pi of fringe) d[pi * 4 + 3] = 0

    ctx.putImageData(id, 0, 0)
    this.textures.remove(key)
    this.textures.addCanvas(key, canvas)
  }

  private removePlayerBackgrounds() {
    if (this.playerTexturesTransparent) return   // テクスチャ/アニメは全シーン共有のため初回のみ実行
    this.playerTexturesTransparent = true

    const dirs = ['down', 'up', 'right'] as const
    for (const dir of dirs) {
      for (let i = 1; i <= 4; i++) {
        this.makeTransparent(`attack_${dir}_${i}`)
      }
    }
    // refine/shadow/spellbook/miner/junk/toolshop は npc.png から切り出し済みで透過処理不要
    for (const key of ['merchant', 'deviling', 'masterring']) {
      this.makeTransparent(key)
    }
  }

  // ── プレイヤーアニメーション定義 ──
  private createPlayerAnims() {
    const dirs = ['down', 'up', 'right'] as const
    const allLoaded = dirs.every(dir =>
      [1, 2, 3, 4].every(i =>
        !this.failedTextures.has(`attack_${dir}_${i}`) &&
        this.textures.exists(`attack_${dir}_${i}`)
      )
    )
    if (!allLoaded) return
    this.hasPlayerAnims = true

    for (const dir of dirs) {
      if (!this.anims.exists(`walk_${dir}`)) {
        this.anims.create({
          key: `walk_${dir}`,
          frames: [{ key: `attack_${dir}_1` }, { key: `attack_${dir}_2` }],
          frameRate: 1000 / 150,
          repeat: -1,
        })
      }
      if (!this.anims.exists(`attack_${dir}`)) {
        this.anims.create({
          key: `attack_${dir}`,
          frames: [1, 2, 3, 4].map(i => ({ key: `attack_${dir}_${i}` })),
          frameRate: 1000 / 80,
          repeat: 0,
        })
      }
    }
    if (!this.anims.exists('walk_left')) {
      this.anims.create({
        key: 'walk_left',
        frames: [{ key: 'attack_right_1' }, { key: 'attack_right_2' }],
        frameRate: 1000 / 150,
        repeat: -1,
      })
    }
    if (!this.anims.exists('attack_left')) {
      this.anims.create({
        key: 'attack_left',
        frames: [1, 2, 3, 4].map(i => ({ key: `attack_right_${i}` })),
        frameRate: 1000 / 80,
        repeat: 0,
      })
    }

    this.createArcherAnims()
  }

  // ── 弓職アニメーション定義（弓装備時のみ使用。左向き系はflipXで代用） ──
  private createArcherAnims() {
    const walkDirs   = ['down', 'up', 'right'] as const
    const attackDirs = ['down', 'up', 'right', 'up-right', 'down-right'] as const
    const ok = (key: string) => !this.failedTextures.has(key) && this.textures.exists(key)
    const allLoaded =
      walkDirs.every(d => [1, 2].every(i => ok(`archer_walk_${d}_${i}`))) &&
      attackDirs.every(d => [1, 2].every(i => ok(`archer_attack_${d}_${i}`)))
    if (!allLoaded) return
    this.hasArcherAnims = true

    for (const d of walkDirs) {
      if (!this.anims.exists(`archer_walk_${d}`)) {
        this.anims.create({
          key: `archer_walk_${d}`,
          frames: [{ key: `archer_walk_${d}_1` }, { key: `archer_walk_${d}_2` }],
          frameRate: 1000 / 150,
          repeat: -1,
        })
      }
    }
    for (const d of attackDirs) {
      if (!this.anims.exists(`archer_attack_${d}`)) {
        this.anims.create({
          key: `archer_attack_${d}`,
          // 近接(4frame×80ms)と体感時間を揃えるため、2frameは1コマ140msにする
          frames: [{ key: `archer_attack_${d}_1` }, { key: `archer_attack_${d}_2` }],
          frameRate: 1000 / 140,
          repeat: 0,
        })
      }
    }
  }

  /** 全8方向をベースアニメーション（down/up/right）とflipXにマッピング。プレイヤー・ドッペルゲンガー共用 */
  private getAnimBaseDir(dir: FacingDir): { anim: 'down' | 'up' | 'right'; flipX: boolean; idleKey: string } {
    switch (dir) {
      case 'up':         return { anim: 'up',    flipX: false, idleKey: 'attack_up_1'    }
      case 'down':       return { anim: 'down',  flipX: false, idleKey: 'attack_down_1'  }
      case 'right':      return { anim: 'right', flipX: false, idleKey: 'attack_right_1' }
      case 'left':       return { anim: 'right', flipX: true,  idleKey: 'attack_right_1' }
      case 'up-right':   return { anim: 'up',   flipX: false, idleKey: 'attack_up_1'   }
      case 'up-left':    return { anim: 'up',   flipX: true,  idleKey: 'attack_up_1'   }
      case 'down-right': return { anim: 'down', flipX: false, idleKey: 'attack_down_1' }
      case 'down-left':  return { anim: 'down', flipX: true,  idleKey: 'attack_down_1' }
    }
  }

  /** プレイヤー表示の基準サイズ（rts依存のため毎回算出） */
  private playerDisplayH(): number { return this.rts * 1.38 }
  private playerDisplayW(): number { return this.rts * 1.25 }

  /** プレイヤー描画の拡縮率。攻撃コマごとの生フレーム高さではなく、振りかぶり等で
   *  縦に伸びにくい基準フレーム（右斬り/歩行）の高さから算出した「武器種ごとに一定の倍率」を使う。
   *  上下・斜め攻撃は剣や矢が縦方向に大きく伸びてフレーム自体の高さが増えるため、コマごとの高さで
   *  正規化すると振りかぶるたびキャラ本体が縮んで見える不具合があった（固定倍率にすることで解消）。 */
  private getPlayerFitScale(): number {
    const refKey = this.useArcherSprites() ? 'archer_walk_down_1' : 'attack_right_1'
    if (this.textures.exists(refKey)) {
      const f = this.textures.get(refKey).get()
      if (f && f.height > 0) return this.playerDisplayH() / f.height
    }
    return 1
  }

  /** 弓装備＆弓グラ読込済みか（プレイヤーの見た目セット切り替え判定） */
  private useArcherSprites(): boolean {
    return this.hasArcherAnims && weaponKindOf(this.state?.player?.equipment?.weapon) === 'bow'
  }

  /**
   * プレイヤーの向き→再生アニメキー・待機テクスチャの解決。弓装備時はアーチャーセットを使う。
   * 近接：斜めは上下向きで代用（斜め絵が無いため）。
   * 弓　：攻撃のみ斜め専用絵（up-right/down-right、左側はflipX）があるので斜め攻撃はそれを使う。
   */
  private getPlayerAnimKeys(dir: FacingDir): { walkKey: string; attackKey: string; flipX: boolean; idleKey: string } {
    const { anim, flipX, idleKey } = this.getAnimBaseDir(dir)
    if (!this.useArcherSprites()) {
      return { walkKey: `walk_${anim}`, attackKey: `attack_${anim}`, flipX, idleKey }
    }
    // 弓の攻撃方向：右上・右下は専用、左上・左下はそれぞれの反転
    let attackDir: string = anim
    switch (dir) {
      case 'up-right': case 'up-left':     attackDir = 'up-right';   break
      case 'down-right': case 'down-left': attackDir = 'down-right'; break
    }
    return {
      walkKey:   `archer_walk_${anim}`,
      attackKey: `archer_attack_${attackDir}`,
      flipX,
      idleKey:   `archer_walk_${anim}_1`,
    }
  }

  private playWalkAnim() {
    if (!this.hasPlayerAnims || this.isPlayerAttacking) return
    const sprite = this.playerGraphic
    if (!(sprite instanceof Phaser.GameObjects.Sprite)) return
    const { walkKey, flipX, idleKey } = this.getPlayerAnimKeys(this.playerDir)
    sprite.setFlipX(flipX)
    sprite.play(walkKey, true)
    this.time.delayedCall(450, () => {
      if (this.isPlayerAttacking || !sprite.active) return
      sprite.stop()
      sprite.setTexture(idleKey)
    })
  }

  private playAttackAnim() {
    if (!this.hasPlayerAnims) return
    const sprite = this.playerGraphic
    if (!(sprite instanceof Phaser.GameObjects.Sprite)) return
    const { attackKey, flipX, idleKey } = this.getPlayerAnimKeys(this.playerDir)
    sprite.off('animationcomplete')
    this.isPlayerAttacking = true
    sprite.setFlipX(flipX)
    sprite.play(attackKey, true)
    sprite.once('animationcomplete', () => {
      this.isPlayerAttacking = false
      if (!sprite.active) return
      sprite.setTexture(idleKey)
    })
  }

  /** ドッペルゲンガー用：移動時の歩行アニメーション（プレイヤーのplayWalkAnimと同じ仕組み） */
  private playEnemyWalkAnim(sprite: Phaser.GameObjects.Sprite, dir: FacingDir): void {
    const { anim, flipX, idleKey } = this.getAnimBaseDir(dir)
    sprite.setFlipX(flipX)
    sprite.play(`walk_${anim}`, true)
    this.time.delayedCall(450, () => {
      if (!sprite.active) return
      sprite.stop()
      sprite.setTexture(idleKey)
    })
  }

  /** ドッペルゲンガー用：攻撃時のアニメーション（プレイヤーのplayAttackAnimと同じ仕組み） */
  private playEnemyAttackAnim(sprite: Phaser.GameObjects.Sprite, dir: FacingDir): void {
    const { anim, flipX, idleKey } = this.getAnimBaseDir(dir)
    sprite.off('animationcomplete')
    sprite.setFlipX(flipX)
    sprite.play(`attack_${anim}`, true)
    sprite.once('animationcomplete', () => {
      if (!sprite.active) return
      sprite.setTexture(idleKey)
    })
  }

  /** テクスチャが利用可能か（読込失敗を除外） */
  private textureOk(key: string): boolean {
    return !this.failedTextures.has(key) && this.textures.exists(key)
  }

  /** 現在階のテーマ付きv2タイルキーを返す。v2が無ければ従来キーへフォールバック */
  private themedTileKey(kind: 'pitfall' | 'mud' | 'trap' | 'spring' | 'spring-dry', legacy: string): string {
    const v2 = `t2-${kind}-${dungeonTheme(this.state?.player?.floor ?? 1)}`
    return this.textureOk(v2) ? v2 : legacy
  }

  /**
   * 牢屋の柵(jail)撤去など、床でなかったマスが後から床へ変わるケース用。
   * buildFloorVariants は生成時に一括で床バリエーションを割り当てるため、
   * その後floor化した個別マスは空文字のままテクスチャ不明→フォールバック単色描画になってしまう。
   * ここで該当マスにだけ同じ選定ロジックで床キーを割り当て、通常の床と同じ見た目にする。
   */
  private assignFloorVariant(x: number, y: number) {
    const theme = dungeonTheme(this.state?.player?.floor ?? 1)
    const keys = [1, 2, 3].map(n => {
      const v2 = `t2-floor-${theme}-${n}`
      return this.textureOk(v2) ? v2 : `tile-floor${n}`
    })
    if (!this.floorVariantMap[y]) this.floorVariantMap[y] = []
    this.floorVariantMap[y][x] = keys[Math.floor(Math.random() * keys.length)]
  }

  private buildFloorVariants(map: import('../types').TileType[][]) {
    // 同一テーマ内の微バリエーション3種をタイルごとにランダム配置
    // （テーマ自体は階層帯で固定：茶→灰→青。旧「3色ランダム混合」は柄がうるさいため廃止）
    const theme = dungeonTheme(this.state?.player?.floor ?? 1)
    const keys = [1, 2, 3].map(n => {
      const v2 = `t2-floor-${theme}-${n}`
      return this.textureOk(v2) ? v2 : `tile-floor${n}`
    })
    this.floorVariantMap = map.map(row =>
      row.map(tile =>
        tile === 'floor' ? keys[Math.floor(Math.random() * keys.length)] : ''
      )
    )
  }

  /** タイルスプライトを生成（フロア切り替え時に呼び出し）。位置はワールド座標で固定 */
  private createTileSprites(map: import('../types').TileType[][]) {
    const rts = this.rts
    // 階層帯ティント：上層ほど暗く毒々しく。床は帯色、壁は一段沈めた色を被せる
    const floorTint = floorTierTint(this.state?.player?.floor ?? 1)
    const wallTint  = darkenColor(floorTint, 0.8)
    this.tileSprites.forEach(row => row.forEach(s => s?.destroy()))
    this.tileSprites = map.map((row, y) =>
      row.map((tile, x) => {
        let key: string
        // あるかなひろば（町）は草地。十字通路は石畳、階段は洞窟口グラフィックに差し替える
        // （「階段を降りる」ではなく「洞窟に入る」見せ方にするため）。プロップ未配置なら通常表示へフォールバック。
        // 階段マスの見た目は下地の草地のままにし、洞窟口グラフィックは buildPlazaDecor() 側で
        // 壁バンドに埋め込む形の装飾として別レイヤーに重ねる（このマスの地面を空洞にしないため）。
        if      (this.isEventFloor && tile === 'floor' && this.plazaPath.has(`${x},${y}`) && this.textureOk('town-stonepath')) key = 'town-stonepath'
        else if (this.isEventFloor && (tile === 'floor' || tile === 'stairs') && this.textureOk('town-grass')) key = 'town-grass'
        else if (tile === 'wall')    key = 'tile-wall'
        else if (tile === 'floor')   key = this.floorVariantMap[y]?.[x] ?? 'tile-floor1'
        else if (tile === 'stairs')  key = 'tile-stairs'
        else if (tile === 'trap')    key = this.themedTileKey('trap', 'trap')
        else if (tile === 'mud')     key = this.themedTileKey('mud', 'tile-mud')
        // 泉：使用済み（枯渇）はセーブ復元時もそのまま枯れ画像で表示する
        else if (tile === 'spring')  key = this.state?.driedSprings?.includes(`${x},${y}`)
          ? this.themedTileKey('spring-dry', 'tile-spring-dry')
          : this.themedTileKey('spring', 'tile-spring')
        else if (tile === 'pitfall') key = this.themedTileKey('pitfall', 'tile-pitfall')
        else if (tile === 'jail')    key = 'town-jail-door'
        else return null

        if (this.failedTextures.has(key) || !this.textures.exists(key)) return null

        const img = this.add.image(x * rts + rts / 2, y * rts + rts / 2, key)
          .setDepth(-1)
          .setVisible(false)
        if (key === 'town-jail-door') {
          // 縦長のドア絵をタイルの縦横比を保ったまま高さ基準でフィットさせる（正方形強制で潰さない）
          const natW = img.width || 1, natH = img.height || 1
          const s = (rts + 6) / natH
          img.setDisplaySize(natW * s, natH * s)
        } else {
          img.setDisplaySize(rts + 6, rts + 6)
        }
        // 町の草地・石畳は、さがし人の解放数に応じたティントを掛ける（0体＝褪せた廃墟色→全解放＝原色）。
        // 洞窟口は導線の視認性を優先し帯ティントを掛けない。
        if (this.isEventFloor && (key === 'town-grass' || key === 'town-stonepath')) {
          img.setTint(plazaProgressTint(this.state?.rescuedNpcs?.length ?? 0))
          return img
        }
        if (this.isEventFloor && key === 'town-cave') return img
        // v2テーマタイルは絵自体に色があるため帯ティントを白方向へ65%弱めて質感を残す
        const v2 = key.startsWith('t2-')
        if      (tile === 'floor') img.setTint(v2 ? softenTint(floorTint, 0.65) : floorTint)
        else if (tile === 'wall' || tile === 'jail') img.setTint(wallTint)
        return img
      })
    )
    this.createStairsGlow(map)
    this.updateMiasma()
    this.updateMiasmaOrbs()
  }

  /** 画面全面の瘴気オーバーレイを現在フロアに合わせて更新（薄め・暗くしすぎない） */
  private updateMiasma() {
    const { color, alpha } = floorMiasma(this.state?.player?.floor ?? 1)
    if (!this.miasmaOverlay) {
      // カメラに固定し、タイルより上・エンティティより下に置く
      this.miasmaOverlay = this.add.rectangle(
        this.scale.width / 2, this.scale.height / 2,
        this.scale.width, this.scale.height,
        color, alpha,
      )
        .setScrollFactor(0)
        .setDepth(3)
        .setBlendMode(Phaser.BlendModes.MULTIPLY)
    }
    this.miasmaOverlay
      .setFillStyle(color, alpha)
      .setSize(this.scale.width, this.scale.height)
      .setPosition(this.scale.width / 2, this.scale.height / 2)
      .setVisible(alpha > 0)
  }

  /** 柔らかいグロー用テクスチャ（放射状グラデ）を一度だけ生成 */
  private ensureGlowTexture() {
    if (this.textures.exists('miasma-glow')) return
    const size = 64
    const c = document.createElement('canvas')
    c.width = c.height = size
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0,   'rgba(255,255,255,1)')
    g.addColorStop(0.4, 'rgba(255,255,255,0.45)')
    g.addColorStop(1,   'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    this.textures.addCanvas('miasma-glow', c)
  }

  /** 毒々しい光球を画面に浮遊させる（加算合成・カメラ固定）。上層ほど数が増える */
  private updateMiasmaOrbs() {
    this.miasmaOrbs.forEach(o => { this.tweens.killTweensOf(o); o.destroy() })
    this.miasmaOrbs = []

    const floor = this.state?.player?.floor ?? 1
    const tier = Math.max(0, Math.floor((floor - 1) / 10))
    this.ensureGlowTexture()

    const W = this.scale.width, H = this.scale.height
    // 1-10Fは無し（10Fで明確に変化）。11F以降、上層ほど増やす（最大16）
    const count = tier === 0 ? 0 : Math.min(16, 4 + (tier - 1) * 2)
    if (count === 0) return
    // 50Fまでは緑、50→100Fで徐々に紫の比率を上げる（連続的に侵食）
    const purpleRatio = Math.max(0, Math.min(1, (floor - 50) / 50))
    const GREEN_ORBS  = [0x66ff66, 0x99ff33, 0xccff44, 0x66ffaa]
    const PURPLE_ORBS = [0xcc66ff, 0xaa66ff, 0xff66cc, 0x9933ff]

    for (let i = 0; i < count; i++) {
      const palette = Math.random() < purpleRatio ? PURPLE_ORBS : GREEN_ORBS
      const color = palette[Math.floor(Math.random() * palette.length)]
      const r = 18 + Math.random() * 28
      const baseAlpha = 0.16 + Math.random() * 0.20
      const orb = this.add.image(Math.random() * W, Math.random() * H, 'miasma-glow')
        .setScrollFactor(0)
        .setDepth(8)                              // エンティティより前に浮遊させる
        .setBlendMode(Phaser.BlendModes.ADD)      // 加算なので暗くせず光って見える
        .setTint(color)
        .setDisplaySize(r * 2, r * 2)
        .setAlpha(baseAlpha)
      this.miasmaOrbs.push(orb)

      // ゆっくり漂う（上方向＋左右ゆらぎ）
      this.tweens.add({
        targets: orb,
        x: orb.x + (Math.random() * 2 - 1) * W * 0.28,
        y: orb.y - (50 + Math.random() * 140),
        duration: 4500 + Math.random() * 4000,
        yoyo: true, repeat: -1, ease: 'Sine.InOut',
        delay: Math.random() * 1800,
      })
      // 明滅
      this.tweens.add({
        targets: orb,
        alpha: baseAlpha * 0.35,
        duration: 1300 + Math.random() * 1600,
        yoyo: true, repeat: -1, ease: 'Sine.InOut',
        delay: Math.random() * 1200,
      })
      // 微妙な拡縮で生き物っぽく
      this.tweens.add({
        targets: orb,
        scaleX: orb.scaleX * (0.7 + Math.random() * 0.5),
        scaleY: orb.scaleY * (0.7 + Math.random() * 0.5),
        duration: 1800 + Math.random() * 1800,
        yoyo: true, repeat: -1, ease: 'Sine.InOut',
      })
    }
  }

  /** 階段タイルに脈動する光輪マーカーを置く（出口の視認性向上） */
  private createStairsGlow(map: import('../types').TileType[][]) {
    if (this.stairsGlow) {
      this.tweens.killTweensOf(this.stairsGlow)
      this.stairsGlow.destroy()
      this.stairsGlow = null
    }
    this.stairsGlowPos = null
    if (this.isEventFloor) return   // あるかなひろばの洞窟口は素の見た目のまま（ダンジョン階段の魔法陣グローは出さない）
    for (let y = 0; y < map.length && !this.stairsGlowPos; y++) {
      for (let x = 0; x < map[y].length; x++) {
        if (map[y][x] === 'stairs') { this.stairsGlowPos = { x, y }; break }
      }
    }
    if (!this.stairsGlowPos) return
    const { x: wx, y: wy } = this.tileToWorld(this.stairsGlowPos.x, this.stairsGlowPos.y)
    const glow = this.add.circle(wx, wy, this.rts * 0.46, 0x88bbff, 0.14)
      .setStrokeStyle(2, 0xaaddff, 0.9)
      .setDepth(2)
      .setAlpha(0.55)
      .setVisible(false)
    this.stairsGlow = glow
    this.tweens.add({
      targets: glow,
      alpha: 1,
      scale: 1.22,
      duration: 850,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
  }

  /** テクスチャの不透明ピクセル領域割合を返す（透過パディング補正用）。結果はキャッシュ。 */
  private getVisibleFraction(key: string): { wFrac: number; hFrac: number } {
    if (this.facilityBoundsCache.has(key)) return this.facilityBoundsCache.get(key)!
    if (!this.textures.exists(key)) return { wFrac: 1, hFrac: 1 }
    const src = this.textures.get(key).getSourceImage() as HTMLCanvasElement | HTMLImageElement
    const w = (src as HTMLCanvasElement).width  || (src as HTMLImageElement).naturalWidth  || 0
    const h = (src as HTMLCanvasElement).height || (src as HTMLImageElement).naturalHeight || 0
    if (!w || !h) return { wFrac: 1, hFrac: 1 }
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(src as CanvasImageSource, 0, 0)
    const d = ctx.getImageData(0, 0, w, h).data
    let x0 = w, x1 = 0, y0 = h, y1 = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    const result = (x1 > x0 && y1 > y0)
      ? { wFrac: (x1 - x0 + 1) / w, hFrac: (y1 - y0 + 1) / h }
      : { wFrac: 1, hFrac: 1 }
    this.facilityBoundsCache.set(key, result)
    return result
  }

  private renderMap() {
    this.graphics.clear()
    const { map, player, enemies, items } = this.state
    const rts = this.rts

    // ── タイルスプライト：可視状態のみ更新（位置は生成時に固定済み）──
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        this.tileSprites[y]?.[x]?.setVisible(this.isTileVisible(x, y))
      }
    }
    // ── フォールバック描画（テクスチャ未ロードのタイルのみ）──
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (this.tileSprites[y]?.[x]) continue
        if (!this.isTileVisible(x, y)) continue
        const tile = map[y][x]
        if      (tile === 'wall')    this.graphics.fillStyle(0x333333)
        else if (tile === 'floor')   this.graphics.fillStyle(0x888866)
        else if (tile === 'stairs')  this.graphics.fillStyle(0x4444ff)
        else if (tile === 'trap')    this.graphics.fillStyle(0x662288)
        else if (tile === 'mud')     this.graphics.fillStyle(0x8B4513)
        else if (tile === 'spring')  this.graphics.fillStyle(0x00ccaa)
        else if (tile === 'pitfall') this.graphics.fillStyle(0x111111)
        else if (tile === 'jail')    this.graphics.fillStyle(0x7a5a2a)   // 牢屋の柵（木/鉄格子色）
        else continue
        this.graphics.fillRect(x * rts, y * rts, rts, rts)
      }
    }

    // ── 階段グロー可視更新 ──
    if (this.stairsGlow && this.stairsGlowPos) {
      this.stairsGlow.setVisible(this.isTileVisible(this.stairsGlowPos.x, this.stairsGlowPos.y))
    }

    // ── アイテム描画（ワールド座標固定＋ふわふわ浮遊）──
    // 宝箱はv2の木箱を優先（縦横比を保ってタイル枠に収める）。無ければ旧boxへフォールバック
    const boxKey = this.textureOk('t2-box') ? 't2-box' : 'tile-box'
    const boxReady = this.textureOk(boxKey)
    const liveItemIds = new Set(items.map(i => i.id))
    for (const [id, g] of this.itemGraphics) {
      if (!liveItemIds.has(id)) { this.tweens.killTweensOf(g); g.destroy(); this.itemGraphics.delete(id) }
    }
    for (const item of items) {
      let g = this.itemGraphics.get(item.id)
      if (!g) {
        const { x: wx, y: wy } = this.tileToWorld(item.position.x, item.position.y)
        if (boxReady) {
          const img = this.add.image(wx, wy, boxKey).setDepth(3)
          const s = (rts - 2) / Math.max(img.width || 1, img.height || 1)
          img.setDisplaySize((img.width || 1) * s, (img.height || 1) * s)
          g = img
        } else {
          const icon = item.coin ? '🪙' : item.type === 'heal' ? '💊' : item.type === 'spell' ? '📖' : item.weaponKind === 'bow' ? '🏹' : '⚔️'
          g = this.add.text(wx, wy, icon, { fontSize: `${Math.round(rts * 0.6)}px` }).setOrigin(0.5).setDepth(3)
        }
        // ゆっくり上下に浮遊させて「拾える物」感を出す
        this.tweens.add({
          targets: g,
          y: wy - rts * 0.08,
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
          delay: Math.random() * 500,
        })
        this.itemGraphics.set(item.id, g)
      }
      (g as Phaser.GameObjects.Image).setVisible(this.isVisible(item.position.x, item.position.y))
    }

    // ── イベントフロアNPC描画 ──
    const liveFacilityIds = new Set(this.eventFacilities.map(f => f.id))
    for (const [id, g] of this.facilityGraphics) {
      if (!liveFacilityIds.has(id)) { g.destroy(); this.facilityGraphics.delete(id) }
    }
    if (this.isEventFloor) {
      for (const facility of this.eventFacilities) {
        let g = this.facilityGraphics.get(facility.id)
        if (!g) {
          const { x: wx, y: wy } = this.tileToWorld(facility.position.x, facility.position.y)
          const tex = facility.texture
          if (tex && !this.failedTextures.has(tex) && this.textures.exists(tex)) {
            // 主人公と同じ見た目サイズに合わせる。主人公は 1.25×1.38タイルの枠に
            // 透過パディング込みで描画されるため（可視部分は枠より小さい）、枠サイズではなく
            // 「主人公の可視部分の大きさ」を目標にし、NPC側のパディングも補正して一致させる。
            // 旧実装は枠サイズ(1.25×1.38)を可視部分の目標にしていたため、NPCだけ一回り大きく見えていた。
            const pKey = this.hasPlayerAnims ? this.getPlayerAnimKeys(this.playerDir).idleKey : 'player'
            const pf = this.getVisibleFraction(pKey)
            const { wFrac, hFrac } = this.getVisibleFraction(tex)
            const targetW = rts * 1.25 * pf.wFrac
            const targetH = rts * 1.38 * pf.hFrac
            g = this.add.image(wx, wy, tex)
              .setDisplaySize(targetW / wFrac, targetH / hFrac).setOrigin(0.5).setDepth(4)
          } else {
            g = this.add.text(wx, wy, facility.icon, { fontSize: `${Math.round(rts * 0.7)}px` })
              .setOrigin(0.5).setDepth(4)
          }
          this.facilityGraphics.set(facility.id, g)
        }
        g.setVisible(true)
      }
    }

    // ── 救済NPC描画（徘徊＝パターン1／牢屋内＝パターン3）。画像未提供のため絵文字表示。──
    const drawRescueNpc = (
      cur: Phaser.GameObjects.GameObject | null,
      pos: import('../types').Position | null,
      kind: import('../types').NpcKind | null,
    ): Phaser.GameObjects.GameObject | null => {
      if (!pos || !kind) { if (cur) cur.destroy(); return null }
      const { x: wx, y: wy } = this.tileToWorld(pos.x, pos.y)
      const c = NPC_CATALOG[kind]
      const tex = c.texture
      let g = cur
      if (!g) {
        if (!this.failedTextures.has(tex) && this.textures.exists(tex)) {
          const pf = this.getVisibleFraction(this.hasPlayerAnims ? this.getPlayerAnimKeys(this.playerDir).idleKey : 'player')
          const { wFrac, hFrac } = this.getVisibleFraction(tex)
          g = this.add.image(wx, wy, tex).setDisplaySize(rts * 1.25 * pf.wFrac / wFrac, rts * 1.38 * pf.hFrac / hFrac).setOrigin(0.5).setDepth(5)
        } else {
          g = this.add.text(wx, wy, c.icon, { fontSize: `${Math.round(rts * 0.7)}px` }).setOrigin(0.5).setDepth(5)
        }
      } else {
        (g as Phaser.GameObjects.Image | Phaser.GameObjects.Text).setPosition(wx, wy)
      }
      const vis = this.isVisible(pos.x, pos.y)
      ;(g as Phaser.GameObjects.Image | Phaser.GameObjects.Text).setVisible(vis)
      return g
    }
    this.rescueSprite  = drawRescueNpc(this.rescueSprite,  this.floorRescue?.position ?? null, this.floorRescue?.kind ?? null)
    this.jailNpcSprite = drawRescueNpc(this.jailNpcSprite, this.jailCell?.npcPos ?? null,      this.jailCell?.kind ?? null)

    // ── 敵描画 ──
    const liveEnemyIds = new Set(enemies.map(e => e.id))
    for (const [id, g] of this.enemyGraphics) {
      if (!liveEnemyIds.has(id)) {
        this.tweens.killTweensOf(g)
        g.destroy()
        this.enemyGraphics.delete(id)
        const bar = this.enemyHpBars.get(id)
        if (bar) { bar.bg.destroy(); bar.fg.destroy(); this.enemyHpBars.delete(id) }
        this.destroyEnemyDecor(id)
        this.enemyDir.delete(id)
      }
    }
    for (const enemy of enemies) {
      const { x: ex, y: ey } = this.tileToWorld(enemy.position.x, enemy.position.y)
      const vis = this.isVisible(enemy.position.x, enemy.position.y)
      const barW = rts - 2
      const barH = (enemy.isBoss || enemy.isDoppelganger) ? Math.max(4, Math.round(8 * rts / TILE_SIZE)) : Math.max(2, Math.round(4 * rts / TILE_SIZE))

      // 視界外の敵はスプライト・HPバーを生成しない（描画負荷削減）
      // ただし既に生成済みのものはそのまま位置更新する
      let g = this.enemyGraphics.get(enemy.id)
      if (!g && !vis) {
        // 視界外かつ未生成 → スキップ（次に視界内に入ったとき生成）
        continue
      }
      if (!g && enemy.isDoppelganger && this.hasPlayerAnims) {
        // ドッペルゲンガー：プレイヤーと全く同じ歩行/攻撃スプライトを使う
        const dir = this.enemyDir.get(enemy.id) ?? 'down'
        const { idleKey, flipX } = this.getAnimBaseDir(dir)
        const sprite = this.add.sprite(ex, ey, idleKey)
          .setDisplaySize(rts * 1.25, rts * 1.38)
          .setDepth(5)
        if (flipX) sprite.setFlipX(true)
        g = sprite
        this.enemyGraphics.set(enemy.id, g)
      }
      if (!g) {
        // ボス【】と性格接頭辞（突進兵の等）を剥がして素のモンスター名で画像を引く
        const baseName   = enemy.name.replace(/^【[^】]+】/, '').replace(PERSONALITY_PREFIX_RE, '')
        const textureKey = ENEMY_TEXTURE_MAP[baseName]
        // 透過パディング補正でサイズ指定するテクスチャ
        // heroSized: 可視部分が主人公（1.25×1.38タイル）と同サイズになるよう補正
        const fracSized: Record<string, number> = { deviling: 1.25, masterring: 1.25 }
        const heroSized = ['ghostring', 'drake', 'toad', 'oaklord', 'oakhero', 'osiris', 'stra', 'wanderwolf', 'kingdramo', 'scullporin',
          'yafa', 'dorakyura', 'dark', 'oul', 'myutant', 'darkpri', 'kimera', 'mistel', 'nekuro', 'amon', 'farao', 'moroku', 'dragonfly']
        // モンスター別の表示サイズ係数（ENEMY_SIZE_MULT、1.0=標準）。大きすぎる個体を個別に縮小。
        const sizeMult = ENEMY_SIZE_MULT[baseName] ?? 1.0
        if (textureKey && !this.failedTextures.has(textureKey) && this.textures.exists(textureKey)) {
          // 上書き画像(ovr_*)も主人公サイズに合わせる（可視部分を計算して補正）。係数で個別調整可。
          if (heroSized.includes(textureKey) || textureKey.startsWith('ovr_')) {
            const { wFrac, hFrac } = this.getVisibleFraction(textureKey)
            g = this.add.image(ex, ey, textureKey)
              .setDisplaySize(rts * 1.25 * sizeMult / wFrac, rts * 1.38 * sizeMult / hFrac).setDepth(5)
          } else if (textureKey in fracSized) {
            const { wFrac, hFrac } = this.getVisibleFraction(textureKey)
            const target = rts * fracSized[textureKey] * sizeMult
            g = this.add.image(ex, ey, textureKey)
              .setDisplaySize(target / wFrac, target / hFrac).setDepth(5)
          } else {
            const eSize = (['whisper', 'chinpira'].includes(textureKey) ? rts * 1.3
              : ['eclipse', 'angeling', 'goldenbug'].includes(textureKey) ? rts * 1.5
              : textureKey === 'furioni' ? rts * 2.0
              : rts - 2) * sizeMult
            g = this.add.image(ex, ey, textureKey)
              .setDisplaySize(eSize, eSize).setDepth(5)
          }
        } else {
          const color = enemy.isDoppelganger
            ? 0x9966ff
            : enemy.isBoss
            ? (enemy.name.startsWith('【MVP】') ? 0xff8800
              : enemy.name.startsWith('【エリア】') ? 0xffff00
              : 0xff00ff)
            : 0xff4444
          g = this.add.rectangle(ex, ey, rts - 2, rts - 2, color).setDepth(5)
        }
        this.enemyGraphics.set(enemy.id, g)
      }

      // HPバー（敵の真下。ノーマル敵は負傷時のみ表示。視界外は生成しない）
      let bar = this.enemyHpBars.get(enemy.id)
      if (!bar && !vis) {
        // 視界外かつ未生成 → バーなしで続行
        g.setVisible(false)
        continue
      }
      if (!bar) {
        const bg = this.add.rectangle(0, 0, barW, barH, 0x660000).setDepth(5)
        const fg = this.add.rectangle(0, 0, barW, barH, 0x00ff00).setDepth(6)
        bar = { bg, fg }
        this.enemyHpBars.set(enemy.id, bar)
      }
      const ratio   = enemy.maxHp > 0 ? Math.max(0, enemy.hp / enemy.maxHp) : 0
      const fgWidth = Math.max(1, ratio * barW)
      const fgColor = ratio > 0.5 ? 0x00ff00 : ratio > 0.25 ? 0xffff00 : 0xff0000
      bar.fg.setSize(fgWidth, barH).setFillStyle(fgColor)
      bar.bg.setSize(barW, barH)
      const showBar = vis && (enemy.isBoss || enemy.isDoppelganger || enemy.hp < enemy.maxHp)

      // 位置が変わっていたらトゥイーン移動（視界内のみ。遠距離テレポートは即時配置）
      const fixedBar = bar
      if (g.x !== ex || g.y !== ey) {
        const near = Math.abs(g.x - ex) <= rts * 1.6 && Math.abs(g.y - ey) <= rts * 1.6
        // ドッペルゲンガー：隣接タイルへの移動なら向きを更新し歩行アニメーションを再生する
        if (enemy.isDoppelganger && g instanceof Phaser.GameObjects.Sprite && vis && g.visible && near) {
          const dir = dirFromSign(Math.sign(ex - g.x), Math.sign(ey - g.y))
          this.enemyDir.set(enemy.id, dir)
          this.playEnemyWalkAnim(g, dir)
        }
        this.tweens.killTweensOf(g)
        if (vis && g.visible && near) {
          this.tweens.add({
            targets: g,
            x: ex, y: ey,
            duration: 110,
            ease: 'Quad.Out',
            onUpdate: () => this.positionEnemyBar(g!, fixedBar, barW, barH, fgWidth),
          })
        } else {
          g.setPosition(ex, ey)
        }
      }
      g.setVisible(vis)
      bar.bg.setVisible(showBar)
      bar.fg.setVisible(showBar)
      this.positionEnemyBar(g, bar, barW, barH, fgWidth)

      // 攻撃可能誘導マーク：今このプレイヤー位置から殴れる敵だけ頭上に⚔️
      const canAttack = vis && this.canPlayerReachAttack(enemy.position.x, enemy.position.y)
      let mark = this.attackMarkers.get(enemy.id)
      if (canAttack) {
        if (!mark) {
          mark = this.add.text(ex, ey, '⚔️', { fontSize: `${Math.round(rts * 0.5)}px` })
            .setOrigin(0.5).setDepth(7)
          this.tweens.add({ targets: mark, scale: 1.2, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
          this.attackMarkers.set(enemy.id, mark)
        }
        mark.setPosition(ex, ey - rts * 0.62)
        mark.setVisible(true)
      } else if (mark) {
        mark.setVisible(false)
      }

      // 大技チャージ警告：溜め中のボスの頭上に⚠️（速い点滅パルス＝次ターン大技の合図）
      const isCharging = vis && (enemy.chargeTurns ?? 0) > 0
      let charge = this.chargeMarkers.get(enemy.id)
      if (isCharging) {
        if (!charge) {
          charge = this.add.text(ex, ey, '⚠️', { fontSize: `${Math.round(rts * 0.62)}px` })
            .setOrigin(0.5).setDepth(9)
          this.tweens.add({
            targets: charge,
            scale: 1.35, alpha: { from: 1, to: 0.45 },
            duration: 260, yoyo: true, repeat: -1, ease: 'Sine.InOut',
          })
          this.chargeMarkers.set(enemy.id, charge)
        }
        charge.setPosition(ex, ey - rts * 1.28)
        charge.setVisible(true)
      } else if (charge) {
        charge.setVisible(false)
      }

      // ── 性格の視覚表現 ──
      // カウントダウン数字（突進兵=赤・支配者=紫）：頭上で3→2→1と脈動
      const cdVal = enemy.personality === 'bomber' ? enemy.fuseCount
        : enemy.personality === 'summoner' ? enemy.summonCount
        : undefined
      const showCd = vis && cdVal !== undefined && cdVal > 0
      let cd = this.countdownMarkers.get(enemy.id)
      if (showCd) {
        const cdColor = enemy.personality === 'bomber' ? '#ff4433' : '#cc66ff'
        if (!cd) {
          cd = this.add.text(ex, ey, '', {
            fontSize: `${Math.round(rts * 0.6)}px`, fontStyle: 'bold',
            color: cdColor, stroke: '#000000', strokeThickness: Math.max(2, Math.round(rts * 0.08)),
          }).setOrigin(0.5).setDepth(9)
          this.tweens.add({
            targets: cd, scale: { from: 1, to: 1.45 },
            duration: 300, yoyo: true, repeat: -1, ease: 'Sine.InOut',
          })
          this.countdownMarkers.set(enemy.id, cd)
        }
        cd.setText(String(cdVal)).setColor(cdColor)
        cd.setPosition(ex, ey - rts * 1.28)
        cd.setVisible(true)
      } else if (cd) {
        cd.setVisible(false)
      }

      // 体色：突進兵(点火中)=赤発光／支配者(詠唱中)=紫
      if (g instanceof Phaser.GameObjects.Image) {
        if (enemy.personality === 'bomber' && enemy.fuseCount !== undefined) g.setTint(0xff6655)
        else if (enemy.personality === 'summoner' && enemy.summonCount !== undefined) g.setTint(0xcc88ff)
        else if (enemy.personality) g.clearTint()
      }

      // 黒いもや：詠唱中の支配者の足元に暗紫のグローが明滅
      const showMist = vis && enemy.personality === 'summoner' && enemy.summonCount !== undefined
      let mist = this.mistSprites.get(enemy.id)
      if (showMist) {
        if (!mist) {
          this.ensureGlowTexture()
          mist = this.add.image(ex, ey, 'miasma-glow').setTint(0x330055)
            .setDisplaySize(rts * 1.9, rts * 1.2).setAlpha(0.6).setDepth(4)
          this.tweens.add({
            targets: mist, alpha: 0.25,
            duration: 480, yoyo: true, repeat: -1, ease: 'Sine.InOut',
          })
          this.mistSprites.set(enemy.id, mist)
        }
        mist.setPosition(ex, ey + rts * 0.3)
        mist.setVisible(true)
      } else if (mist) {
        mist.setVisible(false)
      }

      // 弱虫の強化オーラを受けている敵に💢（攻撃力1.3倍の可視化）
      const isBuffed = vis && enemy.personality !== 'coward' && this.state.enemies.some(o =>
        o !== enemy && o.hp > 0 && o.personality === 'coward' &&
        Math.max(Math.abs(o.position.x - enemy.position.x), Math.abs(o.position.y - enemy.position.y)) <= 2)
      let buff = this.buffMarkers.get(enemy.id)
      if (isBuffed) {
        if (!buff) {
          buff = this.add.text(ex, ey, '💢', { fontSize: `${Math.round(rts * 0.4)}px` })
            .setOrigin(0.5).setDepth(8)
          this.tweens.add({ targets: buff, scale: 1.25, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
          this.buffMarkers.set(enemy.id, buff)
        }
        buff.setPosition(ex + rts * 0.42, ey - rts * 0.55)
        buff.setVisible(true)
      } else if (buff) {
        buff.setVisible(false)
      }

      // 遠距離型の狙撃マーク：射程2〜ENEMY_BOW_RANGE＆射線が通っている＝「次の敵ターンに撃たれる」状態を🎯で可視化。
      // 壁裏に隠れて🎯が消えれば射線が切れた証拠＝遮蔽プレイが画面から学べる。位置は左上（💢=右上・💀=中央上と住み分け）
      const aimDist = Math.abs(player.position.x - enemy.position.x) + Math.abs(player.position.y - enemy.position.y)
      const isAiming = vis && enemy.isRanged === true &&
        aimDist >= 2 && aimDist <= ENEMY_BOW_RANGE &&
        this.hasLineOfSight(enemy.position.x, enemy.position.y, player.position.x, player.position.y)
      let aim = this.aimMarkers.get(enemy.id)
      if (isAiming) {
        if (!aim) {
          aim = this.add.text(ex, ey, '🎯', { fontSize: `${Math.round(rts * 0.4)}px` })
            .setOrigin(0.5).setDepth(8)
          this.tweens.add({ targets: aim, alpha: { from: 1, to: 0.45 }, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
          this.aimMarkers.set(enemy.id, aim)
        }
        aim.setPosition(ex - rts * 0.42, ey - rts * 0.55)
        aim.setVisible(true)
      } else if (aim) {
        aim.setVisible(false)
      }

      // 強敵警告マーク：3発以内でプレイヤーの最大HPを削り切る敵の頭上に💀。
      // さらに現在HPを1発で削り切る（＝今受けたら即死）敵には赤いオーラを重ねて最大警告。
      const isLethal = vis && isLethalEnemy(enemy, player)
      const isDanger = isLethal || (vis && isDangerousEnemy(enemy, player))
      const markerY  = ey - rts * 0.95
      let danger = this.dangerMarkers.get(enemy.id)
      let dglow  = this.dangerGlows.get(enemy.id)
      if (isDanger) {
        if (!danger) {
          danger = this.add.text(ex, ey, '💀', { fontSize: `${Math.round(rts * 0.55)}px` })
            .setOrigin(0.5).setDepth(8)
          this.tweens.add({ targets: danger, scale: 1.3, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
          this.dangerMarkers.set(enemy.id, danger)
        }
        danger.setPosition(ex, markerY)
        danger.setVisible(true)

        if (isLethal) {
          // 赤い放射グロー（加算合成）を💀の背後で強く脈動させる
          this.ensureGlowTexture()
          if (!dglow) {
            dglow = this.add.image(ex, markerY, 'miasma-glow')
              .setDepth(7)                            // 💀(depth8)の一段下
              .setBlendMode(Phaser.BlendModes.ADD)
              .setTint(0xff2222)
              .setDisplaySize(rts * 1.6, rts * 1.6)
            // 強い脈動はアルファで表現（scaleのtweenはsetDisplaySizeを打ち消すため使わない）
            this.tweens.add({ targets: dglow, alpha: { from: 0.5, to: 1 }, duration: 360, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
            this.dangerGlows.set(enemy.id, dglow)
          }
          dglow.setPosition(ex, markerY)
          dglow.setVisible(true)
        } else if (dglow) {
          dglow.setVisible(false)
        }
      } else {
        if (danger) danger.setVisible(false)
        if (dglow)  dglow.setVisible(false)
      }
    }

    // ── プレイヤー描画 ──
    const { x: px, y: py } = this.tileToWorld(player.position.x, player.position.y)
    // 剣と弓でスプライト素材の生ピクセル解像度が大きく異なる（例：剣231×346 vs 弓177×237）。
    // setDisplaySizeは呼んだ瞬間のフレームサイズからscaleを逆算するだけで、setTextureでの
    // フレーム差し替え時にscaleは再計算されないため、武器切替・攻撃アニメのコマ送りのたびに
    // 見た目サイズがブレる（剣基準で固定されると弓が縮んで見える＝報告の逆転現象）。
    // 毎回呼び直して常に同じ表示サイズへ強制することで解消する。
    const PLAYER_DISPLAY_W = this.playerDisplayW()
    const PLAYER_DISPLAY_H = this.playerDisplayH()
    // 武器種ごとに一定の拡縮率（getPlayerFitScale）を全コマへ一律適用する。
    // フレームごとの生高さで正規化すると、上下/斜め攻撃で剣や矢が縦に伸びてbboxが増えた分だけ
    // キャラ本体が縮んで見える不具合になるため、基準フレームから求めた固定倍率のみを使う。
    const fitPlayer = (sp: Phaser.GameObjects.Sprite) => {
      const fw = sp.frame?.width || 0
      const fh = sp.frame?.height || 0
      const scale = this.getPlayerFitScale()
      if (fw > 0 && fh > 0) sp.setDisplaySize(fw * scale, fh * scale)
      else sp.setDisplaySize(PLAYER_DISPLAY_W, PLAYER_DISPLAY_H)
    }
    if (!this.playerGraphic) {
      if (this.hasPlayerAnims) {
        const { idleKey, flipX } = this.getPlayerAnimKeys(this.playerDir)
        const sprite = this.add.sprite(px, py, idleKey).setDepth(6)
        fitPlayer(sprite)
        if (flipX) sprite.setFlipX(true)
        // 歩行・攻撃アニメはコマごとに素材解像度が異なるため、フレーム切替のたびに縦基準で再フィット
        sprite.on('animationstart',  () => fitPlayer(sprite))
        sprite.on('animationupdate', () => fitPlayer(sprite))
        this.playerGraphic = sprite
      } else {
        this.playerGraphic = this.add.rectangle(px, py, rts - 2, rts - 2, 0x44ff44).setDepth(6)
      }
      // カメラはプレイヤーを滑らかに追従（lerp）
      this.cameras.main.startFollow(this.playerGraphic, true, 0.12, 0.12)
      this.cameras.main.centerOn(px, py)
    } else {
      const g = this.playerGraphic
      if (this.snapNextRender) {
        // フロア切替：トゥイーンせず即時配置＋カメラスナップ
        this.tweens.killTweensOf(g)
        g.setAngle(0)
        g.setPosition(px, py)
        this.cameras.main.centerOn(px, py)
      } else if (g.x !== px || g.y !== py) {
        this.tweens.killTweensOf(g)
        this.tweens.add({ targets: g, x: px, y: py, duration: 110, ease: 'Quad.Out' })
      }
      // 武器持ち替え（弓⇔近接）を待機グラフィックへ即反映。アニメ再生中はcomplete側に任せる
      if (g instanceof Phaser.GameObjects.Sprite && !this.isPlayerAttacking && !g.anims.isPlaying) {
        const { idleKey, flipX } = this.getPlayerAnimKeys(this.playerDir)
        if (g.texture.key !== idleKey) {
          g.setTexture(idleKey)
          g.setFlipX(flipX)
        }
        // テクスチャ切替のたびに縦基準で再フィット（剣⇔弓で素材解像度が違うため）
        fitPlayer(g)
      }
    }
    this.snapNextRender = false

    // ── 霧グラデーション（inner→outer にかけて円形スモッグ。瘴気フロアは狭く紫色）──
    this.fogGraphics.clear()
    if (this.state.floorType !== 'lucky' && !this.isEventFloor) {
      const { fogInner, fogOuter, fogColor, fogMaxAlpha } = this.vision()
      for (let fy = 0; fy < MAP_HEIGHT; fy++) {
        for (let fx = 0; fx < MAP_WIDTH; fx++) {
          const dx   = fx - player.position.x
          const dy   = fy - player.position.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > fogOuter) continue
          const t = Math.max(0, (dist - fogInner) / (fogOuter - fogInner))
          const alpha = t * t * fogMaxAlpha  // 二次曲線で自然な霧立ち上がり（瘴気は薄め）
          if (alpha <= 0) continue
          this.fogGraphics.fillStyle(fogColor, Math.min(1, alpha))
          this.fogGraphics.fillRect(fx * rts, fy * rts, rts, rts)
        }
      }
    }

    // ── 弓の射程表示（薄緑、装備中は常時表示）──
    this.bowRangeGraphics.clear()
    if (weaponKindOf(player.equipment.weapon) === 'bow') {
      this.bowRangeGraphics.fillStyle(0x33dd66, 0.16)
      for (let ry = player.position.y - BOW_RANGE; ry <= player.position.y + BOW_RANGE; ry++) {
        for (let rx = player.position.x - BOW_RANGE; rx <= player.position.x + BOW_RANGE; rx++) {
          if (rx === player.position.x && ry === player.position.y) continue
          if (rx < 0 || ry < 0 || rx >= MAP_WIDTH || ry >= MAP_HEIGHT) continue
          const rdist = Math.abs(rx - player.position.x) + Math.abs(ry - player.position.y)
          if (rdist > BOW_RANGE) continue
          if (!this.isTileVisible(rx, ry)) continue
          if (map[ry]?.[rx] === 'wall') continue
          if (!this.hasLineOfSight(player.position.x, player.position.y, rx, ry)) continue
          this.bowRangeGraphics.fillRect(rx * rts, ry * rts, rts, rts)
        }
      }
    }
  }

  /** 敵HPバーを敵グラフィックの現在位置に追従させる（移動トゥイーン中も毎フレーム呼ばれる） */
  private positionEnemyBar(
    g: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image,
    bar: { bg: Phaser.GameObjects.Rectangle; fg: Phaser.GameObjects.Rectangle },
    barW: number, barH: number, fgWidth: number,
  ) {
    if (!bar.bg.active || !bar.fg.active) return
    const barY = g.y + this.rts / 2 - 1 + barH / 2
    bar.bg.setPosition(g.x, barY)
    bar.fg.setPosition(g.x - barW / 2 + fgWidth / 2, barY)
  }

  // ── 低HPビネット（画面端が赤く脈動して危機を知らせる）──
  private createLowHpVignette() {
    const key = 'vignette-red'
    if (!this.textures.exists(key)) {
      const size = 512
      const c = document.createElement('canvas')
      c.width = size; c.height = size
      const ctx = c.getContext('2d')!
      const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.30, size / 2, size / 2, size * 0.72)
      grad.addColorStop(0, 'rgba(255,0,0,0)')
      grad.addColorStop(1, 'rgba(190,0,0,0.85)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, size, size)
      this.textures.addCanvas(key, c)
    }
    this.lowHpVignette = this.add.image(this.scale.width / 2, this.scale.height / 2, key)
      .setDisplaySize(this.scale.width, this.scale.height)
      .setScrollFactor(0)
      .setDepth(85)
      .setAlpha(0)
  }

  private updateLowHpVignette() {
    if (!this.lowHpVignette) return
    const { hp, maxHp } = this.state.player
    const ratio  = maxHp > 0 ? hp / maxHp : 1
    const target = hp > 0 && ratio <= 0.25 ? 0.85 : hp > 0 && ratio <= 0.4 ? 0.4 : 0
    // HP25%以下は心音を鳴らす（ビネットの脈動と同期する緊張演出）
    setHeartbeat(hp > 0 && ratio <= 0.25)
    if (target === this.vignetteTarget) return
    this.vignetteTarget = target
    if (this.vignetteTween) { this.vignetteTween.stop(); this.vignetteTween = null }
    if (target <= 0) {
      this.vignetteTween = this.tweens.add({ targets: this.lowHpVignette, alpha: 0, duration: 400 })
    } else {
      // 心拍のように脈動させる
      this.lowHpVignette.setAlpha(Math.max(this.lowHpVignette.alpha, target * 0.55))
      this.vignetteTween = this.tweens.add({
        targets: this.lowHpVignette,
        alpha: { from: target * 0.55, to: target },
        duration: 650,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
    }
  }

  private createPauseOverlay() {
    const W = this.scale.width
    const H = this.scale.height
    const bg = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65)
    const text = this.add.text(W / 2, H / 2 - 30, 'ポーズ中', {
      fontSize: '52px', color: '#ffffff',
      stroke: '#333333', strokeThickness: 8,
    }).setOrigin(0.5)
    const hint = this.add.text(W / 2, H / 2 + 35, '[Esc] で再開', {
      fontSize: '18px', color: '#aaaaaa',
    }).setOrigin(0.5)
    this.pauseOverlay = this.add.container(0, 0, [bg, text, hint])
      .setDepth(100).setScrollFactor(0).setVisible(false)
  }

  private createInventoryPanel() {
    this.inventoryPanel = this.add.container(0, 0).setDepth(50).setScrollFactor(0).setVisible(false)
  }

  private togglePause() {
    this.isPaused = !this.isPaused
    this.pauseOverlay.setVisible(this.isPaused)
  }

  private toggleInventory() {
    this.inventoryOpen = !this.inventoryOpen
    if (this.inventoryOpen) {
      this.buildInventoryPanel()
      this.inventoryPanel.setVisible(true)
    } else {
      this.inventoryPanel.setVisible(false)
      this.inventoryPanel.removeAll(true)
    }
  }

  private buildInventoryPanel() {
    this.inventoryPanel.removeAll(true)
    const { player } = this.state
    const eq = player.equipment
    const W = this.scale.width
    const H = this.scale.height
    const cx = W / 2
    const panelW = Math.min(560, W * 0.92)
    const panelH = Math.min(480, H * 0.90)
    const topY   = H / 2 - panelH / 2
    const lx     = cx - panelW / 2 + 18
    const SLOT_H = 42   // 1スロットの高さ（名前行 + ボーナス行 + 余白）
    const BOTTOM_MARGIN = 22

    const bg = this.add.rectangle(cx, H / 2, panelW, panelH, 0x08081e, 0.96)
      .setStrokeStyle(2, 0x6666cc)
    const title = this.add.text(cx, topY + 14, '─── インベントリ ───', {
      fontSize: '17px', color: '#aaaaff',
    }).setOrigin(0.5)
    const hint = this.add.text(cx, topY + panelH - 10, '[I] / [Esc] で閉じる', {
      fontSize: '11px', color: '#554466',
    }).setOrigin(0.5)

    type SlotKey = keyof typeof eq
    const SLOTS: { key: SlotKey; label: string; icon: string }[] = [
      { key: 'weapon',     label: '武器',   icon: '⚔️' },
      { key: 'armor',      label: '鎧',     icon: '🛡️' },
      { key: 'shoulder',   label: '肩装備', icon: '🧣' },
      { key: 'boots',      label: '靴',     icon: '👟' },
      { key: 'accessory1', label: '指輪①', icon: '💍' },
      { key: 'accessory2', label: '指輪②', icon: '💍' },
      { key: 'charm',      label: 'お守り', icon: '🍀' },
    ]

    const children: Phaser.GameObjects.GameObject[] = [bg, title, hint]
    let curY = topY + 36

    // 装備スロット（名前行 + ボーナス行に分離して溢れを防止）
    SLOTS.forEach(slot => {
      const item = eq[slot.key]
      const nameLine = item
        ? `${slot.icon} [${slot.label}]  ${item.name}`
        : `${slot.icon} [${slot.label}]  （装備なし）`
      children.push(
        this.add.text(lx, curY, nameLine, {
          fontSize: '13px',
          color: item ? '#88ff88' : '#445544',
        })
      )
      if (item) {
        const bonuses = [
          item.hpBonus  && `HP+${item.hpBonus}`,
          item.strBonus && `STR+${item.strBonus}`,
          item.agiBonus && `AGI+${item.agiBonus}`,
          item.dexBonus && `DEX+${item.dexBonus}`,
          item.vitBonus && `VIT+${item.vitBonus}`,
          item.lukBonus && `LUK+${item.lukBonus}`,
        ].filter(Boolean).join('  ')
        if (bonuses) {
          children.push(
            this.add.text(lx + 18, curY + 17, bonuses, {
              fontSize: '11px', color: '#66cc88',
            })
          )
        }
      }
      curY += SLOT_H
    })

    const bottomLimit = topY + panelH - BOTTOM_MARGIN

    // 回復アイテム（名前でグループ化して個数表示）
    if (this.state.heals.length > 0 && curY + 36 < bottomLimit) {
      const healGroups: Record<string, number> = {}
      for (const h of this.state.heals) healGroups[h.name] = (healGroups[h.name] ?? 0) + 1
      curY += 6
      children.push(
        this.add.text(cx, curY, '── 回復アイテム ──', {
          fontSize: '11px', color: '#88ccaa',
        }).setOrigin(0.5)
      )
      curY += 16
      for (const [name, count] of Object.entries(healGroups)) {
        if (curY + 18 > bottomLimit) break
        const label = count > 1 ? `💊 ${name}（${count}）` : `💊 ${name}`
        children.push(this.add.text(lx, curY, label, { fontSize: '12px', color: '#88ddaa' }))
        curY += 18
      }
    }

    // バッグ（未装備）
    if (this.state.bag.length > 0 && curY + 36 < bottomLimit) {
      curY += 6
      children.push(
        this.add.text(cx, curY, '── バッグ（未装備） ──', {
          fontSize: '11px', color: '#ccaa66',
        }).setOrigin(0.5)
      )
      curY += 16
      for (const bagItem of this.state.bag) {
        if (curY + 18 > bottomLimit) break
        children.push(
          this.add.text(lx, curY, `📦 ${bagItem.name}`, {
            fontSize: '12px', color: '#ddbb88',
          })
        )
        curY += 18
      }
    }

    // 魔法の書（名前でグループ化して個数表示）
    if (this.state.spells.length > 0 && curY + 36 < bottomLimit) {
      const spellGroups: Record<string, number> = {}
      for (const s of this.state.spells) spellGroups[s.name] = (spellGroups[s.name] ?? 0) + 1
      curY += 6
      children.push(
        this.add.text(cx, curY, '── 魔法の書 ──', {
          fontSize: '11px', color: '#8866ff',
        }).setOrigin(0.5)
      )
      curY += 16
      for (const [name, count] of Object.entries(spellGroups)) {
        if (curY + 18 > bottomLimit) break
        const label = count > 1 ? `📖 ${name}（${count}）` : `📖 ${name}`
        children.push(this.add.text(lx, curY, label, { fontSize: '12px', color: '#9977ff' }))
        curY += 18
      }
    }

    this.inventoryPanel.add(children)
  }
}
