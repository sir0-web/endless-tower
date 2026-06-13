import Phaser from 'phaser'
import type { GameState, AllocStat } from '../types'
import { generateDungeon, getPlayerStartPosition, spawnEnemies, spawnMonsterHouseEnemies, spawnBosses, makeChaosBoss, generateAreaBossFloors, getFloorTelopMessage, dedupeEnemyPositions, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../game/dungeon'
import { spawnItems, SPELL_ITEMS } from '../game/items'
import { floorLabel } from '../game/utils'
import { playAttack, playCrit, playDamage, playLevelUp, playStairs, playPotion, playEquip, playBGM } from '../game/sound'
import { saveGame, loadGame, clearSave, type SaveData } from '../game/save'
import { logEvent } from '../game/supabase'
import { fireWorldNotification, resetWorldNotifyDedup } from '../game/worldNotify'
import { getDisplayName } from '../game/playerName'

const VISION_RADIUS    = 5   // エンティティ可視半径
const VISION_FOG_INNER = 2   // 霧グラデーション開始距離
const VISION_FOG_OUTER = 5   // 霧グラデーション終了距離（以遠は真っ暗）

// 敵名 → テクスチャキー のマッピング（/assets/enemy/<key>.png を想定）
// 全ボスは画像なし → 色付きRectangleにフォールバック
const ENEMY_TEXTURE_MAP: Record<string, string> = {
  'ぽり男':              'pori',
  'ルナティック':        'lunatic',
  'ビタタ':              'bitata',
  'ウィスパー':          'whisper',
  'スモーキー':          'smokey',
  '白蓮玉':              'hakurengoku',
  'ソルジャースケルトン': 'soldierskeleton',
  'ムナック':            'munack',
  'デビルチ':            'devilchi',
  'ゴーレム':            'golem',
  'マミー':              'mummy',
  'アラーム':            'alarm',
  'フェンダーク':        'fendark',
  'ミノタウロス':        'minotaur',
  'オットー':            'otto',
  'チンピラ':            'chinpira',
  '半魚人':              'fishman',
  'ナイトメア':          'nightmare',
  '深淵の騎士':          'abyssalknight',
  '黄金蟲':              'goldenbug',
  'エクリプス':          'eclipse',
  'エンジェリング':      'angeling',
  'デビルリング':        'deviling',
  'マスターリング':      'masterring',
  'ゴーストリング':      'ghostring',
  'ドレイク':            'drake',
  'トード':              'toad',
  'キングドラモ':        'kingdramo',
  'さすらい狼':          'wanderwolf',
  'ダークプリースト':    'darkpriest',
  'キメラ':              'chimera',
  'ミステルテイン':      'misteltein',
  'ネクロマンサー':      'necromancer',
  'ドラゴンフライ':      'dragonfly',
  'フリオニ':            'furioni',
  'オークヒーロー':      'oakhero',
  'オークロード':        'oaklord',
  'アモンラー':          'amonra',
  'ダークロード':        'darklord',
  'ファラオ':            'pharaoh',
  'モロク':              'molok',
}

export class GameScene extends Phaser.Scene {
  private state!: GameState
  private graphics!: Phaser.GameObjects.Graphics
  private fogGraphics!: Phaser.GameObjects.Graphics
  private playerGraphic: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Sprite | null = null
  private playerDir: 'down' | 'up' | 'right' | 'left' | 'down-right' | 'down-left' | 'up-right' | 'up-left' = 'down'
  private isPlayerAttacking = false
  private hasPlayerAnims    = false
  private enemyGraphics: Map<string, Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image> = new Map()
  private enemyHpBars:  Map<string, { bg: Phaser.GameObjects.Rectangle; fg: Phaser.GameObjects.Rectangle }> = new Map()
  // アイテム描画: Text（回復/魔法）または Image（装備品＝宝箱スプライト）
  private itemGraphics: Map<string, Phaser.GameObjects.GameObject> = new Map()
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
  private awaitingEquipModal = false
  private pendingItem: import('../types').Item | null = null
  private isGameOver   = false   // gameOver()の多重発火防止（同一ターン内で複数回HP<=0判定が走るため）
  private isAnimating  = false   // 落とし穴スピンなどの演出中フラグ（入力ブロック用）
  private animatingTimer: ReturnType<typeof setTimeout> | null = null  // isAnimating安全タイムアウト
  private onVisibilityChange = () => {
    if (!document.hidden && this.isAnimating) {
      // バックグラウンド復帰時にフラグが残っていたら強制解除
      this.isAnimating = false
      if (this.animatingTimer) { clearTimeout(this.animatingTimer); this.animatingTimer = null }
    }
  }
  // テクスチャ/アニメーションはゲーム全体で共有（シーン再起動毎にリセットされない）ため、
  // 透過処理（テクスチャの remove→addCanvas）は初回のみ実行する。
  // 2回目以降に再実行すると、既存のwalk/attackアニメーションが参照している古いFrameの
  // textureSourceがnullになり、再生時に "Cannot read properties of null (reading 'sourceSize')" でクラッシュする
  private playerTexturesTransparent = false
  private isEventFloor = false   // イベントフロア（ベースキャンプ「あるかなひろば」）滞在中フラグ
  private eventFacilities: { id: string; kind: import('../types').FacilityKind; name: string; icon: string; texture?: string; position: import('../types').Position }[] = []
  private failedTextures = new Set<string>()   // 読み込み失敗テクスチャ
  private floorVariantMap: string[][] = []      // [y][x] → 'tile-floor1/2/3'
  private tileSprites: (Phaser.GameObjects.Image | null)[][] = []
  // 描画タイルサイズ（シーン起動時に確定。ワールド座標 = タイル座標 × rts）
  private rts = TILE_SIZE
  private lastMoveAt = 0          // キーリピート抑制（移動テンポ制御）
  private snapNextRender = false  // フロア切替直後はトゥイーンせず即時配置＋カメラスナップ
  private stairsGlow: Phaser.GameObjects.Arc | null = null
  private stairsGlowPos: import('../types').Position | null = null
  private lowHpVignette: Phaser.GameObjects.Image | null = null
  private vignetteTween: Phaser.Tweens.Tween | null = null
  private vignetteTarget = 0

  constructor() {
    super({ key: 'GameScene' })
  }

  // シーン再起動時（scene.start 呼び出しごと）に必ず実行される
  init() {
    this.playerGraphic      = null
    this.enemyGraphics      = new Map()
    this.enemyHpBars        = new Map()
    this.itemGraphics       = new Map()
    this.facilityGraphics   = new Map()
    this.tileSprites        = []
    this.floorVariantMap    = []
    this.inventoryOpen      = false
    this.isPaused           = false
    this.isStatAllocOpen    = false
    this.isEquipModalOpen   = false
    this.awaitingEquipModal = false
    this.pendingItem        = null
    this.playerDir          = 'down'
    this.isPlayerAttacking  = false
    this.isGameOver         = false
    this.isAnimating        = false
    this.isEventFloor       = false
    this.eventFacilities    = []
    this.rts                = window.innerWidth < 768 ? Math.round(TILE_SIZE * 1.5) : TILE_SIZE
    this.lastMoveAt         = 0
    this.snapNextRender     = false
    this.stairsGlow         = null
    this.stairsGlowPos      = null
    this.lowHpVignette      = null
    this.vignetteTween      = null
    this.vignetteTarget     = 0
  }

  preload() {
    // 床タイル（3種ランダム）— /assets/dungeon/floor/
    this.load.image('tile-floor1', '/assets/dungeon/floor/floor1.png')
    this.load.image('tile-floor2', '/assets/dungeon/floor/floor2.png')
    this.load.image('tile-floor3', '/assets/dungeon/floor/floor3.png')
    // 壁 — /assets/dungeon/wall/wall.png
    this.load.image('tile-wall',   '/assets/dungeon/wall/wall.png')
    // 階段 — /assets/dungeon/stairs/stairs.png
    this.load.image('tile-stairs', '/assets/dungeon/stairs/stairs.png')
    // box.png — アイテム表示用（床に落ちている全アイテム）
    this.load.image('tile-box', '/assets/dungeon/box/box.png')
    // trap.png — ベノムダスト（ハズレ時は紫Graphicsにフォールバック）
    this.load.image('trap', '/assets/dungeon/trap/trap.png')
    this.load.image('tile-mud',        '/assets/dungeon/mud/mud.png')
    this.load.image('tile-spring',     '/assets/dungeon/spring/spring.png')
    this.load.image('tile-spring-dry', '/assets/dungeon/spring/spring_dry.png')
    this.load.image('tile-pitfall',    '/assets/dungeon/pitfall/pitfall.png')

    // プレイヤー画像（スタティック・フォールバック用）
    this.load.image('player', '/assets/characters/player.png')

    // プレイヤーアニメーションフレーム（12枚）
    for (let i = 1; i <= 4; i++) {
      this.load.image(`attack_down_${i}`,  `/assets/characters/player/attack_down_${i}.png`)
      this.load.image(`attack_up_${i}`,    `/assets/characters/player/attack_up_${i}.png`)
      this.load.image(`attack_right_${i}`, `/assets/characters/player/attack_right_${i}.png`)
    }

    // 敵キャラクター画像（存在しないものは loaderror で failedTextures に記録→フォールバック）
    const enemyImages: [string, string][] = [
      ['pori',            '/assets/characters/enemies/pori.png'],
      ['lunatic',         '/assets/characters/enemies/lunatic.png'],
      ['bitata',          '/assets/characters/enemies/bitata.png'],
      ['whisper',         '/assets/characters/enemies/whisper.png'],
      ['smokey',          '/assets/characters/enemies/smokey.png'],
      ['hakurengoku',     '/assets/characters/enemies/hakurengoku.png'],
      ['soldierskeleton', '/assets/characters/enemies/soldierskeleton.png'],
      ['munack',          '/assets/characters/enemies/munack.png'],
      ['devilchi',        '/assets/characters/enemies/devilchi.png'],
      ['golem',           '/assets/characters/enemies/golem.png'],
      ['mummy',           '/assets/characters/enemies/mummy.png'],
      ['alarm',           '/assets/characters/enemies/alarm.png'],
      ['fendark',         '/assets/characters/enemies/fendark.png'],
      ['minotaur',        '/assets/characters/enemies/minotaur.png'],
      ['otto',            '/assets/characters/enemies/otto.png'],
      ['chinpira',        '/assets/characters/enemies/chinpira.png'],
      ['fishman',         '/assets/characters/enemies/fishman.png'],
      ['nightmare',       '/assets/characters/enemies/nightmare.png'],
      ['abyssalknight',   '/assets/characters/enemies/abyssalknight.png'],
      ['goldenbug',       '/assets/characters/enemies/goldenbug.png'],
      ['eclipse',         '/assets/characters/enemies/eclipse.png'],
      ['angeling',        '/assets/characters/enemies/angeling.png'],
      ['furioni',         '/assets/characters/enemies/furioni.png'],
      ['ghostring',       '/assets/characters/enemies/ghostring.png'],
      ['drake',           '/assets/characters/enemies/drake.png'],
      ['horu',            '/assets/characters/enemies/horu.png'],
      ['master',          '/assets/characters/enemies/master.png'],
      ['maho',            '/assets/characters/enemies/maho.png'],
    ]
    for (const [key, path] of enemyImages) this.load.image(key, path)

    // 読み込みエラーを記録 → フォールバックで色描画
    this.load.on('loaderror', (file: { key: string }) => {
      this.failedTextures.add(file.key)
    })
  }

  create() {
    this.cameras.main.fadeIn(500, 0, 0, 0)
    this.cameras.main.setBounds(0, 0, MAP_WIDTH * this.rts, MAP_HEIGHT * this.rts)
    this.graphics    = this.add.graphics().setDepth(1)
    this.fogGraphics = this.add.graphics().setDepth(7)
    this.initGame()
    this.createLowHpVignette()
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.input.keyboard!.on('keydown', this.handleInput, this)
    window.allocateStat = (stat: AllocStat) => this.doAllocateStat(stat)
    window.useSpell    = (itemId: string) => this.useSpellById(itemId)
    window.useHeal     = (itemId: string) => this.useHealById(itemId)
    window.isGameSceneActive = true
    window.resolveEquip    = (equip: boolean) => this.resolveEquipModal(equip)
    window.equipFromBag   = (itemId: string) => this.equipFromBag(itemId)
    window.discardFromBag = (itemId: string) => this.discardFromBag(itemId)
    window.applySlotEffect = (result: string) => this.applySlotEffect(result)
    window.gameMove        = (key: string)    => this.handleInput({ key } as KeyboardEvent)
    window.saveGame        = () => this.doSaveGame()
    window.addWorldLogMessage = (text: string) => this.addWorldLogMessage(text)
    window.runRefineChallenge   = (slot, sacrificeId) => this.runRefineChallenge(slot, sacrificeId)
    window.runShadowChallenge   = ()                  => this.runShadowChallenge()
    window.runSpellbookChallenge = (spellId)          => this.runSpellbookChallenge(spellId)

    // 開発サーバー限定：コンソールから warpFloor(階数) で好きな階に飛べる
    if (import.meta.env.DEV) {
      window.warpFloor = (floor: number) => {
        this.state.player.floor = Math.max(1, Math.floor(floor)) - 1
        this.nextFloor()
      }
      console.log('[DEV] warpFloor(階数) で好きな階にワープできます。例: warpFloor(10)')
    }

    this.createPauseOverlay()
    this.createInventoryPanel()
    this.removePlayerBackgrounds()
    this.createPlayerAnims()

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

    const map = generateDungeon()
    const playerPos = getPlayerStartPosition(map)
    const areaBossFloors = generateAreaBossFloors()

    const floorType = this.determineFloorType(1)  // 初期LUK=1
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
        hp: 30,
        maxHp: 30,
        level: 1,
        exp: 0,
        floor: 1,
        stamina: 200,
        maxStamina: 200,
        poisoned: false,
        poisonTurns: 0,
        mudTurns: 0,
        mudSkipNext: false,
        equipment: {},
        str: 3, agi: 1, dex: 1, int: 1, vit: 3, luk: 1,
        statPoints: 0,
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
    }
    dedupeEnemyPositions(this.state.enemies, map, this.state.player.position)   // 敵が重なって始まらないように
    this.buildFloorVariants(map)
    this.createTileSprites(map)
  }

  // セーブデータからの再開：保存時点のマップ・敵・アイテム配置をそのまま復元する
  // （再生成すると「リロードで良いダンジョンを引き直す」抜け道になるため、スナップショットを丸ごと復元する）
  private initGameFromSave(saved: SaveData) {
    const floor = saved.player.floor
    const map = saved.map

    this.state = {
      player: { ...saved.player },
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
    }
    this.buildFloorVariants(map)
    this.createTileSprites(map)
  }

  // セーブ実行（プレイ中のセーブボタンから呼ばれる）
  private doSaveGame() {
    const { player, enemies, items, map, spells, heals, bag, turn, areaBossFloors, floorType, driedSprings } = this.state
    saveGame({ player, enemies, items, map, spells, heals, bag, turn, areaBossFloors, floorType, driedSprings })
    window.showGameToast?.('セーブしました。\nゲームを閉じても次回「GAMESTART」を\n押した際にここから再開します。')
  }

  private showTelopIfNeeded() {
    const { player, areaBossFloors, floorType } = this.state
    const bossMsg = getFloorTelopMessage(player.floor, areaBossFloors)

    const parts: string[] = []
    if (floorType === 'chaos') parts.push('このフロアは混沌とした気配に満ちている！')
    if (floorType === 'lucky') parts.push('このフロアは不思議な光に包まれている・・・')
    if (bossMsg)               parts.push(bossMsg)
    if (parts.length === 0) return

    const color = floorType === 'chaos' ? '#ff6600'
      : floorType === 'lucky' ? '#aaddff'
      : '#ff4444'

    window.showEventMessage?.(parts.join('\n'), color)
  }

  private handleInput(event: KeyboardEvent) {
    if (this.isStatAllocOpen || this.isEquipModalOpen || this.isAnimating) return
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
    if      (dx === 1  && dy === 0)  this.playerDir = 'right'
    else if (dx === -1 && dy === 0)  this.playerDir = 'left'
    else if (dx === 0  && dy === 1)  this.playerDir = 'down'
    else if (dx === 0  && dy === -1) this.playerDir = 'up'
    else if (dx === 1  && dy === -1) this.playerDir = 'up-right'
    else if (dx === -1 && dy === -1) this.playerDir = 'up-left'
    else if (dx === 1  && dy === 1)  this.playerDir = 'down-right'
    else if (dx === -1 && dy === 1)  this.playerDir = 'down-left'

    // 泥の沼スロー処理
    if (player.mudTurns > 0) {
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

    const enemy = this.state.enemies.find(e => e.position.x === nx && e.position.y === ny)
    let didAttack = false
    if (enemy) {
      this.attackEnemy(enemy)
      didAttack = true
    } else {
      player.position.x = nx
      player.position.y = ny

      if (this.state.map[ny][nx] === 'stairs') {
        this.nextFloor()
        return
      }

      if (this.state.map[ny][nx] === 'pitfall') {
        const fallDepth = 1 + Math.floor(Math.random() * 3)
        const fromFloor = this.state.player.floor
        const toFloor   = fromFloor + fallDepth
        this.isAnimating = true
        if (this.animatingTimer) clearTimeout(this.animatingTimer)
        this.animatingTimer = setTimeout(() => { this.isAnimating = false; this.animatingTimer = null }, 5000)
        this.renderMap()
        this.spinPlayer(3, 600, () => {
          this.state.player.floor += fallDepth - 1
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

      if (this.checkEventFacility()) return

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
    this.tweens.add({
      targets: g,
      x: g.x + vx * this.rts * 0.3,
      y: g.y + vy * this.rts * 0.3,
      duration: 80,
      yoyo: true,
      ease: 'Quad.Out',
    })
  }

  private pickupItem() {
    const { items } = this.state
    const item = items.find(i => i.position.x === this.state.player.position.x && i.position.y === this.state.player.position.y)
    if (!item) return

    if (item.type === 'heal') {
      const sameCount = this.state.heals.filter(h => h.name === item.name).length
      if (sameCount >= 10) {
        this.addMessage(`${item.name}を手に入れたが、いっぱいのため宝箱へ戻した・・・`)
        return
      }
      this.state.heals.push({ ...item, position: { x: 0, y: 0 } })
      this.addMessage(`${item.name}を拾った！`)
      this.showPickupNotif(`${item.name}を拾った！`)
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
    this.state.bag = this.state.bag.filter(b => b.id !== itemId)
    this.addMessage(`${item.name}を捨てた`)
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
      if (player.hp <= 0) this.gameOver()
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
        // 泉が枯れる見た目に切り替え
        const sprite = this.tileSprites[player.position.y]?.[player.position.x]
        if (sprite && !this.failedTextures.has('tile-spring-dry') && this.textures.exists('tile-spring-dry')) {
          sprite.setTexture('tile-spring-dry').setDisplaySize(this.rts + 6, this.rts + 6)
        }
      }
    }
  }

  private attackEnemy(enemy: typeof this.state.enemies[0]) {
    const { player } = this.state
    const effectiveAtk  = Math.floor(player.str * 1.5) + player.level
    const attackCount   = Math.min(5, Math.floor(player.agi / 50) + 1)
    const hitRate       = Math.min(0.99, 0.90 + player.dex * 0.001)
    const critRate      = player.luk * 0.001

    for (let hit = 0; hit < attackCount; hit++) {
      if (enemy.hp <= 0) break

      if (Math.random() > hitRate) {
        this.addMessage(`${enemy.name}への攻撃がはずれた！`)
        this.popDamageNumber(enemy.position.x, enemy.position.y, '', { miss: true })
        continue
      }

      const isCrit = Math.random() < critRate
      const raw    = Math.max(1, effectiveAtk - enemy.defense)
      const dmg    = isCrit ? Math.floor(raw * 1.5) : raw
      enemy.hp = Math.max(0, enemy.hp - dmg)

      // ヒット演出：ダメージ数字ポップ＋敵フラッシュ＋火花（連撃は少し時間差で）
      const delay = hit * 70
      this.time.delayedCall(delay, () => {
        if (this.isVisible(enemy.position.x, enemy.position.y)) {
          this.popDamageNumber(enemy.position.x, enemy.position.y, dmg, { crit: isCrit })
          this.flashSprite(enemy.id)
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

    if (enemy.hp <= 0) this.killEnemy(enemy)
  }

  /** 敵を撃破：状態から除去し、撃破演出（縮小フェード＋破片）・経験値・レベルアップ処理を行う */
  private killEnemy(enemy: import('../types').Enemy) {
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
    const expGain = enemy.isBoss ? (50 + enemy.maxHp) : (5 + enemy.maxHp)
    player.exp += expGain
    this.addMessage(`${enemy.name}を倒した！経験値+${expGain}`)

    // 女神のコイン：撃破時20%でその場にドロップ
    if (Math.random() < 0.20) {
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
    if (g) {
      this.tweens.killTweensOf(g)
      if (g.visible) {
        this.spawnBurst(g.x, g.y, {
          color: enemy.isBoss ? 0xffcc44 : 0xff8866,
          count: enemy.isBoss ? 14 : 7,
          speed: this.rts * (enemy.isBoss ? 1.4 : 0.9),
        })
        if (enemy.isBoss) this.cameras.main.shake(220, 0.008)
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

    this.checkLevelUp()
    window.onEnemyKilled?.()
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
      player.maxHp += 3
      player.hp = player.maxHp
      player.statPoints += 5
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
      const edx = player.position.x - enemy.position.x
      const edy = player.position.y - enemy.position.y
      const chebDist = Math.max(Math.abs(edx), Math.abs(edy))
      const manhDist = Math.abs(edx) + Math.abs(edy)

      // 斜め攻撃のコーナーカット防止：壁の角越しには斜め攻撃できない（プレイヤーと同条件）
      const diagAttackBlocked =
        edx !== 0 && edy !== 0 &&
        (this.state.map[enemy.position.y]?.[player.position.x] === 'wall' ||
         this.state.map[player.position.y]?.[enemy.position.x] === 'wall')

      if (chebDist === 1 && !diagAttackBlocked) {
        // 隣接（斜め含む。ただし壁角越しの斜めは不可）→攻撃
        const baseAtk = enemy.attack + Math.floor(enemy.str * 0.5)
        const effectiveAtk = enemy.slowedTurns > 0 ? Math.floor(baseAtk * 0.5) : baseAtk
        const effectiveDef = player.vit + Math.floor(player.level / 2)
        const critRate = enemy.luk * 0.001
        const isCrit = Math.random() < critRate
        const raw = Math.max(1, effectiveAtk - effectiveDef)
        const dmg = isCrit ? Math.floor(raw * 1.5) : raw
        player.hp = Math.max(0, player.hp - dmg)
        playDamage()
        // 敵がプレイヤーへ小さく突進（誰に殴られたかが分かる）
        const eg = this.enemyGraphics.get(enemy.id)
        if (eg && eg.visible) {
          this.tweens.add({
            targets: eg,
            x: eg.x + Math.sign(edx) * this.rts * 0.28,
            y: eg.y + Math.sign(edy) * this.rts * 0.28,
            duration: 80,
            yoyo: true,
            ease: 'Quad.Out',
          })
        }
        // 被ダメ演出：赤いダメージ数字＋プレイヤーフラッシュ＋画面シェイク
        this.popDamageNumber(player.position.x, player.position.y, dmg, { toPlayer: true, crit: isCrit })
        this.flashPlayer()
        this.cameras.main.shake(isCrit ? 200 : 110, isCrit ? 0.012 : 0.007)
        // HP残量が少ないほど強い赤フラッシュ（ピンチ演出）
        const hpRatio = player.hp / player.maxHp
        if (player.hp > 0 && hpRatio <= 0.25) {
          this.cameras.main.flash(180, 120, 0, 0)
        }
        this.addMessage(isCrit
          ? `${enemy.name}からクリティカル！${dmg}ダメージ！`
          : `${enemy.name}から${dmg}ダメージ！`)
        if (player.hp <= 0) { this.gameOver(); return }

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

        // 斜め移動できなかった場合は単軸移動
        if (!moved) {
          const mx = Math.abs(tdx) >= Math.abs(tdy) ? Math.sign(tdx) : 0
          const my = Math.abs(tdx) >= Math.abs(tdy) ? 0 : Math.sign(tdy)
          const nx = enemy.position.x + mx
          const ny = enemy.position.y + my

          const tile = this.state.map[ny]?.[nx]
          const isWalkable = tile === 'floor' || tile === 'trap' || tile === 'mud' || tile === 'spring' || tile === 'pitfall'
          const isPlayerPos = nx === player.position.x && ny === player.position.y
          const occupied = enemies.some(e => e !== enemy && e.position.x === nx && e.position.y === ny)

          if (isWalkable && !isPlayerPos && !occupied) {
            enemy.position.x = nx
            enemy.position.y = ny
          }
        }
      }
    }
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

    playPotion()
    if (item.staminaPercent) {
      const recover = Math.floor(player.maxStamina * item.staminaPercent / 100)
      player.stamina = Math.min(player.maxStamina, player.stamina + recover)
      this.addMessage(`${item.name}を使った！スタミナ+${recover}`)
    } else {
      const heal = item.healAmount ?? 10
      player.hp = Math.min(player.maxHp, player.hp + heal)
      this.addMessage(`${item.name}を使った！HP+${heal}`)
    }

    this.state.heals = this.state.heals.filter(h => h.id !== itemId)
    this.renderMap()
    this.updateWindowGameState()
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
    if (this.state.turn % 2 === 0) player.stamina -= 1
    if (player.stamina <= 0) {
      player.stamina = 0
      player.hp = Math.max(0, player.hp - 2)
      this.addMessage('スタミナ切れ！HPが減っていく！')
      if (player.hp <= 0) this.gameOver()
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
    this.addMessage(`毒のダメージ！${dmg}ダメージ（残り${player.poisonTurns}ターン）`)
    if (player.poisonTurns <= 0) {
      player.poisoned = false
      this.addMessage('毒が治った！')
    }
    if (player.hp <= 0) this.gameOver()
  }

  private nextFloor() {
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
    this.isEventFloor = false
    this.eventFacilities = []
    this.state.driedSprings = []
    this.state.player.floor++
    const floor = this.state.player.floor
    logEvent('floor_reached', { floor, level: this.state.player.level })
    if (floor % 5 === 0) {
      fireWorldNotification('world', '【ワールド】', `${getDisplayName()}さんがB${floor}階に到達しました！`, `floor:${floor}`)
    }
    const map = generateDungeon()
    const playerPos = getPlayerStartPosition(map)
    this.state.map = map
    this.state.player.position = { ...playerPos }

    const floorType = this.determineFloorType(this.state.player.luk)
    const base     = 5
    const lukBonus = Math.floor(this.state.player.luk * 0.5)
    const count    = base + Math.floor(Math.random() * (base + lukBonus))
    const normalEnemies = floorType === 'chaos'
      ? spawnMonsterHouseEnemies(map, floor, playerPos)
      : spawnEnemies(map, count, floor)
    let bosses = spawnBosses(floor, this.state.areaBossFloors)
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
    dedupeEnemyPositions(this.state.enemies, map, playerPos)   // 敵が重なって始まらないように
    this.state.items = floorType === 'lucky'
      ? spawnItems(map, { countMult: 2, equipRate: 0.30, floor })
      : floorType === 'chaos'
      ? spawnItems(map, { countMult: 3, floor })
      : spawnItems(map, { floor })
    this.state.floorType = floorType
    this.buildFloorVariants(map)
    this.createTileSprites(map)
    playStairs()
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
  }

  // ── イベントフロア（ベースキャンプ「あるかなひろば」）──
  private enterEventFloor() {
    this.isEventFloor = true
    const map = this.generateEventFloorMap()
    const playerPos = { x: 9, y: 16 }
    this.state.map = map
    this.state.player.position = { ...playerPos }
    this.state.enemies = []
    this.state.items = []
    this.eventFacilities = [
      { id: 'facility_refine',    kind: 'refine',    name: '鍛冶屋ハンマー', icon: '🔨', texture: 'horu',   position: { x: 6,  y: 9 } },
      { id: 'facility_shadow',    kind: 'shadow',    name: '影の仕立て屋',   icon: '🌑', texture: 'master', position: { x: 9,  y: 9 } },
      { id: 'facility_spellbook', kind: 'spellbook', name: '古書の魔導士',   icon: '📖', texture: 'maho',   position: { x: 12, y: 9 } },
    ]
    this.state.floorType = 'normal'
    this.buildFloorVariants(map)
    this.createTileSprites(map)
    this.addMessage('ベースキャンプ「あるかなひろば」に到着した...')
    this.snapNextRender = true
    this.renderMap()
    this.updateWindowGameState()
    this.updateBGM()
    this.cameras.main.fadeIn(300, 0, 0, 0)   // フロア切替の入場フェード
    this.showMidgardTitle()
  }

  /** イベントフロア専用の固定マップ（宿屋の一室）を生成する */
  private generateEventFloorMap(): import('../types').TileType[][] {
    const map: import('../types').TileType[][] = Array.from({ length: MAP_HEIGHT }, () =>
      Array(MAP_WIDTH).fill('wall')
    )
    const rx = 5, ry = 7, rw = 10, rh = 11
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) map[y][x] = 'floor'
    }
    map[ry + 1][rx + Math.floor(rw / 2)] = 'stairs'
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

  /** イベントフロアの施設に話しかけたときの処理（移動と同じ操作で起動） */
  private checkEventFacility(): boolean {
    if (!this.isEventFloor) return false
    const { player } = this.state
    const facility = this.eventFacilities.find(
      f => f.position.x === player.position.x && f.position.y === player.position.y
    )
    if (!facility) return false
    window.dispatchEvent(new CustomEvent('facility-open', { detail: facility.kind }))
    return true
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

  private runRefineChallenge(slot: import('../types').EquipSlot, sacrificeId: string): import('../types').RefineResult | null {
    const { player, bag } = this.state
    const target = player.equipment[slot]
    if (!target) return null
    const sacrifice = bag.find(b => b.id === sacrificeId && b.type === 'equip')
    if (!sacrifice) return null

    // 精錬の生贄として消費
    this.state.bag = bag.filter(b => b.id !== sacrificeId)
    this.addMessage(`${sacrifice.name}を精錬の生贄に捧げた...`)

    const success = Math.random() < 0.3
    let level = target.refineLevel ?? 0
    if (success) {
      this.adjustItemBonuses(target, 1.1)
      level = (target.refineLevel ?? 0) + 1
      target.refineLevel = level
      this.addMessage(`${target.name}の精錬に成功した！ +${level}`)
      if (level >= 5) {
        fireWorldNotification('achievement', '【精錬成功】', `${getDisplayName()}さんが+${level}精錬に成功しました！`)
      }
    } else {
      if (level > 0 && Math.random() < 0.5) {
        this.adjustItemBonuses(target, 1 / 1.1)
        level = level - 1
        target.refineLevel = level
        this.addMessage(`${target.name}の精錬に失敗し、精錬値が下がってしまった... +${level}`)
      } else {
        this.addMessage(`${target.name}の精錬に失敗した...`)
      }
    }
    this.updateWindowGameState()
    return { success, itemName: target.name, refineLevel: level }
  }

  // ── 影装チャレンジ ──
  private runShadowChallenge(): import('../types').ShadowResult | null {
    const { player } = this.state
    const COST = 5
    if (player.statPoints < COST) return null
    player.statPoints -= COST

    const success = Math.random() < 0.3
    if (success) {
      player.str += 3; player.agi += 3; player.dex += 3
      player.int += 3; player.vit += 3; player.luk += 3
      this.addMessage('影装チャレンジに成功した！全ステータス+3！')
      fireWorldNotification('achievement', '【影装強化】', `${getDisplayName()}さんが影装強化に成功しました！`)
    } else {
      this.addMessage('影装チャレンジに失敗し、ボーナスポイントを失った...')
    }
    this.updateWindowGameState()
    return { success }
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
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    if (this.animatingTimer) { clearTimeout(this.animatingTimer); this.animatingTimer = null }
  }

  private gameOver() {
    if (this.isGameOver) return   // 1ターン内で複数回HP<=0判定が走っても遷移は1回だけにする
    this.isGameOver = true
    logEvent('death', { floor: this.state.player.floor, level: this.state.player.level })
    clearSave()   // セーブデータがあった場合、ゲームオーバーで強制消滅させる
    this.input.keyboard!.off('keydown', this.handleInput, this)
    window.isGameSceneActive = false
    window.dispatchEvent(new Event('game-scene-changed'))
    // 少し間を置いてから暗転 → ゲームオーバー画面へ
    this.time.delayedCall(700, () => this.cameras.main.fadeOut(500, 0, 0, 0))
    this.time.delayedCall(1250, () => {
      this.scene.start('GameOverScene', { floor: this.state.player.floor, level: this.state.player.level })
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
          x: e.position.x, y: e.position.y, isBoss: e.isBoss ?? false,
        })),
        items: this.state.items.map(i => ({ x: i.position.x, y: i.position.y })),
      },
      pendingEquip: this.pendingItem && this.pendingItem.equipSlot ? {
        newItem: this.pendingItem,
        currentItem: this.state.player.equipment[this.pendingItem.equipSlot] ?? null,
      } : null,
      floorType: this.state.floorType,
    }
    window.dispatchEvent(new Event('gamestate-update'))
    this.updateLowHpVignette()
  }

  // ── スロットマシーン効果処理 ──
  private applySlotEffect(result: string) {
    const { player } = this.state

    switch (result) {
      case '777': {
        player.level      += 10
        player.statPoints += 50
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
        player.statPoints += 30
        window.showSlotAnnouncement?.('kakuhen')
        break
      }
      default: {
        let missSub = 'ハズレ…'
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
    if ((isWin || isMiss) && Math.random() < 0.01) {
      const kakuhenVideo = isWin ? 'kakuhen' : 'kakuhen_miss'
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

  private slotSpawnEquip() {
    const pool = spawnItems(this.state.map, { countMult: 1, equipRate: 1.0, floor: this.state.player.floor })
    const equip = pool.find(i => i.type === 'equip')
    if (equip) {
      this.state.bag.push({ ...equip, position: { x: 0, y: 0 } })
      this.addMessage(`🎰 1-2-3！ランダム装備品ゲット！`)
      this.addMessage(`→ ${equip.name}をバッグに入れた`)
    }
  }

  private updateBGM() {
    const hasBoss = this.state.enemies.some(e => e.isBoss)
    playBGM(hasBoss ? 'boss' : 'dungeon')
  }

  private determineFloorType(luk: number): 'normal' | 'lucky' | 'chaos' {
    const luckyChance = Math.min(0.50, 0.03 + luk * 0.005)
    const chaosChance = Math.min(0.30, 0.01 + luk * 0.008)
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

  private isVisible(tx: number, ty: number): boolean {
    if (this.state.floorType === 'lucky' || this.isEventFloor) return true
    const { player } = this.state
    const dx = tx - player.position.x
    const dy = ty - player.position.y
    return dx * dx + dy * dy <= VISION_RADIUS * VISION_RADIUS
  }

  private isTileVisible(tx: number, ty: number): boolean {
    if (this.state.floorType === 'lucky' || this.isEventFloor) return true
    const { player } = this.state
    const dx = tx - player.position.x
    const dy = ty - player.position.y
    return dx * dx + dy * dy <= VISION_FOG_OUTER * VISION_FOG_OUTER
  }

  // ── 戦闘エフェクト（game feel） ──

  /** タイル座標 → ワールド座標（タイル中心px。カメラがスクロールを担当する） */
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

    const color = miss ? '#cccccc'
      : heal ? '#66ff99'
      : crit ? '#ffdd33'
      : toPlayer ? '#ff5555'
      : '#ffffff'
    const baseSize = this.rts * (crit ? 0.62 : 0.46)
    const text = miss ? 'MISS' : heal ? `+${value}` : `${value}`

    // 横位置を少しランダムにずらして連続ヒットでも重ならないように
    const jitterX = (Math.random() - 0.5) * this.rts * 0.4
    const startY  = y - this.rts * 0.25

    const label = this.add.text(x + jitterX, startY, text, {
      fontSize: `${Math.round(baseSize)}px`,
      fontFamily: 'Arial, sans-serif',
      color,
      fontStyle: crit ? 'bold' : 'normal',
      stroke: '#000000',
      strokeThickness: Math.max(2, Math.round(baseSize * 0.14)),
    }).setOrigin(0.5).setDepth(20)

    if (crit) {
      label.setScale(0.4)
      this.tweens.add({ targets: label, scale: 1, duration: 160, ease: 'Back.Out' })
    }

    this.tweens.add({
      targets: label,
      y: startY - this.rts * (crit ? 1.1 : 0.85),
      alpha: 0,
      duration: crit ? 900 : 700,
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
  // ── プレイヤー画像の背景色を透過（ロード済み PNG から実行） ──
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

    // 全エッジをスキャンして最頻出の不透明ピクセルを背景色として採用
    const edgePixels: [number, number][] = []
    for (let x = 0; x < w; x++) { edgePixels.push([x, 0]); edgePixels.push([x, h - 1]) }
    for (let y = 1; y < h - 1; y++) { edgePixels.push([0, y]); edgePixels.push([w - 1, y]) }

    const colorCount = new Map<string, { r: number; g: number; b: number; count: number }>()
    for (const [ex, ey] of edgePixels) {
      const i = (ey * w + ex) * 4
      if (d[i + 3] < 200) continue
      const key = `${d[i]},${d[i+1]},${d[i+2]}`
      const entry = colorCount.get(key)
      if (entry) entry.count++
      else colorCount.set(key, { r: d[i], g: d[i+1], b: d[i+2], count: 1 })
    }
    if (colorCount.size === 0) return  // 全エッジが既に透過 → 処理不要

    let bgR = -1, bgG = -1, bgB = -1, maxCount = 0
    for (const { r, g, b, count } of colorCount.values()) {
      if (count > maxCount) { maxCount = count; bgR = r; bgG = g; bgB = b }
    }

    // BFS flood fill: エッジから連続する背景色ピクセルを透過
    const tol = 40
    const visited = new Uint8Array(w * h)
    const queue: number[] = []

    const isBg = (idx: number) =>
      d[idx + 3] >= 128 &&
      Math.abs(d[idx]     - bgR) <= tol &&
      Math.abs(d[idx + 1] - bgG) <= tol &&
      Math.abs(d[idx + 2] - bgB) <= tol

    for (const [ex, ey] of edgePixels) {
      const pi = ey * w + ex
      if (!visited[pi] && isBg(pi * 4)) { visited[pi] = 1; queue.push(pi) }
    }

    while (queue.length > 0) {
      const pi = queue.pop()!
      d[pi * 4 + 3] = 0
      const px = pi % w, py = (pi / w) | 0
      for (const [nx, ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
        const ni = ny * w + nx
        if (!visited[ni] && isBg(ni * 4)) { visited[ni] = 1; queue.push(ni) }
      }
    }

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
    for (const key of ['horu', 'master', 'maho', 'deviling', 'masterring']) {
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
  }

  /** 全8方向をベースアニメーション（down/up/right）とflipXにマッピング */
  private getAnimBaseDir(): { anim: 'down' | 'up' | 'right'; flipX: boolean; idleKey: string } {
    switch (this.playerDir) {
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

  private playWalkAnim() {
    if (!this.hasPlayerAnims || this.isPlayerAttacking) return
    const sprite = this.playerGraphic
    if (!(sprite instanceof Phaser.GameObjects.Sprite)) return
    const { anim, flipX, idleKey } = this.getAnimBaseDir()
    sprite.setFlipX(flipX)
    sprite.play(`walk_${anim}`, true)
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
    const { anim, flipX, idleKey } = this.getAnimBaseDir()
    sprite.off('animationcomplete')
    this.isPlayerAttacking = true
    sprite.setFlipX(flipX)
    sprite.play(`attack_${anim}`, true)
    sprite.once('animationcomplete', () => {
      this.isPlayerAttacking = false
      if (!sprite.active) return
      sprite.setTexture(idleKey)
    })
  }

  private buildFloorVariants(map: import('../types').TileType[][]) {
    const keys = ['tile-floor1', 'tile-floor2', 'tile-floor3']
    this.floorVariantMap = map.map(row =>
      row.map(tile =>
        tile === 'floor' ? keys[Math.floor(Math.random() * keys.length)] : ''
      )
    )
  }

  /** タイルスプライトを生成（フロア切り替え時に呼び出し）。位置はワールド座標で固定 */
  private createTileSprites(map: import('../types').TileType[][]) {
    const rts = this.rts
    this.tileSprites.forEach(row => row.forEach(s => s?.destroy()))
    this.tileSprites = map.map((row, y) =>
      row.map((tile, x) => {
        let key: string
        if      (tile === 'wall')    key = 'tile-wall'
        else if (tile === 'floor')   key = this.floorVariantMap[y]?.[x] ?? 'tile-floor1'
        else if (tile === 'stairs')  key = 'tile-stairs'
        else if (tile === 'trap')    key = 'trap'
        else if (tile === 'mud')     key = 'tile-mud'
        // 泉：使用済み（枯渇）はセーブ復元時もそのまま枯れ画像で表示する
        else if (tile === 'spring')  key = this.state?.driedSprings?.includes(`${x},${y}`) ? 'tile-spring-dry' : 'tile-spring'
        else if (tile === 'pitfall') key = 'tile-pitfall'
        else return null

        if (this.failedTextures.has(key) || !this.textures.exists(key)) return null

        return this.add.image(x * rts + rts / 2, y * rts + rts / 2, key)
          .setDisplaySize(rts + 6, rts + 6)
          .setDepth(-1)
          .setVisible(false)
      })
    )
    this.createStairsGlow(map)
  }

  /** 階段タイルに脈動する光輪マーカーを置く（出口の視認性向上） */
  private createStairsGlow(map: import('../types').TileType[][]) {
    if (this.stairsGlow) {
      this.tweens.killTweensOf(this.stairsGlow)
      this.stairsGlow.destroy()
      this.stairsGlow = null
    }
    this.stairsGlowPos = null
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
        else continue
        this.graphics.fillRect(x * rts, y * rts, rts, rts)
      }
    }

    // ── 階段グロー可視更新 ──
    if (this.stairsGlow && this.stairsGlowPos) {
      this.stairsGlow.setVisible(this.isTileVisible(this.stairsGlowPos.x, this.stairsGlowPos.y))
    }

    // ── アイテム描画（ワールド座標固定＋ふわふわ浮遊）──
    const boxReady = !this.failedTextures.has('tile-box') && this.textures.exists('tile-box')
    const liveItemIds = new Set(items.map(i => i.id))
    for (const [id, g] of this.itemGraphics) {
      if (!liveItemIds.has(id)) { this.tweens.killTweensOf(g); g.destroy(); this.itemGraphics.delete(id) }
    }
    for (const item of items) {
      let g = this.itemGraphics.get(item.id)
      if (!g) {
        const { x: wx, y: wy } = this.tileToWorld(item.position.x, item.position.y)
        if (boxReady) {
          g = this.add.image(wx, wy, 'tile-box')
            .setDisplaySize(rts - 2, rts - 2).setDepth(3)
        } else {
          const icon = item.coin ? '🪙' : item.type === 'heal' ? '💊' : item.type === 'spell' ? '📖' : '⚔️'
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
            // 可視領域でプレイヤーと同サイズになるよう透過パディング分を補正
            const { wFrac, hFrac } = this.getVisibleFraction(tex)
            const targetW = rts * 1.25
            const targetH = rts * 1.38
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

    // ── 敵描画 ──
    const liveEnemyIds = new Set(enemies.map(e => e.id))
    for (const [id, g] of this.enemyGraphics) {
      if (!liveEnemyIds.has(id)) {
        this.tweens.killTweensOf(g)
        g.destroy()
        this.enemyGraphics.delete(id)
        const bar = this.enemyHpBars.get(id)
        if (bar) { bar.bg.destroy(); bar.fg.destroy(); this.enemyHpBars.delete(id) }
      }
    }
    for (const enemy of enemies) {
      const { x: ex, y: ey } = this.tileToWorld(enemy.position.x, enemy.position.y)
      const vis = this.isVisible(enemy.position.x, enemy.position.y)
      const barW = rts - 2
      const barH = enemy.isBoss ? Math.max(4, Math.round(8 * rts / TILE_SIZE)) : Math.max(2, Math.round(4 * rts / TILE_SIZE))

      let g = this.enemyGraphics.get(enemy.id)
      if (!g) {
        const baseName   = enemy.name.replace(/^【[^】]+】/, '')
        const textureKey = ENEMY_TEXTURE_MAP[baseName]
        // 透過パディング補正でサイズ指定するテクスチャ
        // heroSized: 可視部分が主人公（1.25×1.38タイル）と同サイズになるよう補正
        const fracSized: Record<string, number> = { deviling: 1.25, masterring: 1.25 }
        const heroSized = ['ghostring', 'drake']
        if (textureKey && !this.failedTextures.has(textureKey) && this.textures.exists(textureKey)) {
          if (heroSized.includes(textureKey)) {
            const { wFrac, hFrac } = this.getVisibleFraction(textureKey)
            g = this.add.image(ex, ey, textureKey)
              .setDisplaySize(rts * 1.25 / wFrac, rts * 1.38 / hFrac).setDepth(5)
          } else if (textureKey in fracSized) {
            const { wFrac, hFrac } = this.getVisibleFraction(textureKey)
            const target = rts * fracSized[textureKey]
            g = this.add.image(ex, ey, textureKey)
              .setDisplaySize(target / wFrac, target / hFrac).setDepth(5)
          } else {
            const eSize = ['whisper', 'chinpira'].includes(textureKey) ? rts * 1.3
              : ['eclipse', 'angeling', 'goldenbug'].includes(textureKey) ? rts * 1.5
              : textureKey === 'furioni' ? rts * 2.0
              : rts - 2
            g = this.add.image(ex, ey, textureKey)
              .setDisplaySize(eSize, eSize).setDepth(5)
          }
        } else {
          const color = enemy.isBoss
            ? (enemy.name.startsWith('【MVP】') ? 0xff8800
              : enemy.name.startsWith('【エリア】') ? 0xffff00
              : 0xff00ff)
            : 0xff4444
          g = this.add.rectangle(ex, ey, rts - 2, rts - 2, color).setDepth(5)
        }
        this.enemyGraphics.set(enemy.id, g)
      }

      // HPバー（敵の真下。ノーマル敵は負傷時のみ表示してノイズを減らす）
      let bar = this.enemyHpBars.get(enemy.id)
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
      const showBar = vis && (enemy.isBoss || enemy.hp < enemy.maxHp)

      // 位置が変わっていたらトゥイーン移動（視界内のみ。遠距離テレポートは即時配置）
      const fixedBar = bar
      if (g.x !== ex || g.y !== ey) {
        this.tweens.killTweensOf(g)
        const near = Math.abs(g.x - ex) <= rts * 1.6 && Math.abs(g.y - ey) <= rts * 1.6
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
    }

    // ── プレイヤー描画 ──
    const { x: px, y: py } = this.tileToWorld(player.position.x, player.position.y)
    if (!this.playerGraphic) {
      if (this.hasPlayerAnims) {
        const { idleKey, flipX } = this.getAnimBaseDir()
        const sprite = this.add.sprite(px, py, idleKey)
          .setDisplaySize(rts * 1.25, rts * 1.38)
          .setDepth(6)
        if (flipX) sprite.setFlipX(true)
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
    }
    this.snapNextRender = false

    // ── 霧グラデーション（distance 2→5 にかけて円形スモッグ）──
    this.fogGraphics.clear()
    if (this.state.floorType !== 'lucky' && !this.isEventFloor) {
      for (let fy = 0; fy < MAP_HEIGHT; fy++) {
        for (let fx = 0; fx < MAP_WIDTH; fx++) {
          const dx   = fx - player.position.x
          const dy   = fy - player.position.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > VISION_FOG_OUTER) continue
          const t = Math.max(0, (dist - VISION_FOG_INNER) / (VISION_FOG_OUTER - VISION_FOG_INNER))
          const alpha = t * t  // 二次曲線で自然な霧立ち上がり
          if (alpha <= 0) continue
          this.fogGraphics.fillStyle(0x000000, Math.min(1, alpha))
          this.fogGraphics.fillRect(fx * rts, fy * rts, rts, rts)
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
