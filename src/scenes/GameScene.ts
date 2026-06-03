import Phaser from 'phaser'
import type { GameState, AllocStat } from '../types'
import { generateDungeon, getPlayerStartPosition, spawnEnemies, spawnMonsterHouseEnemies, spawnBosses, generateAreaBossFloors, getFloorTelopMessage, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../game/dungeon'
import { spawnItems } from '../game/items'
import { floorLabel } from '../game/utils'
import { playAttack, playDamage, playLevelUp, playStairs, playPotion, playEquip, playBGM } from '../game/sound'

const VISION_RADIUS = 5

export class GameScene extends Phaser.Scene {
  private state!: GameState
  private graphics!: Phaser.GameObjects.Graphics
  private playerGraphic!: Phaser.GameObjects.Rectangle
  private enemyGraphics: Map<string, Phaser.GameObjects.Rectangle> = new Map()
  // アイテム描画: Text（回復/魔法）または Image（装備品＝宝箱スプライト）
  private itemGraphics: Map<string, Phaser.GameObjects.GameObject> = new Map()
  private telopText!: Phaser.GameObjects.Text

  private inventoryPanel!: Phaser.GameObjects.Container
  private pauseOverlay!: Phaser.GameObjects.Container
  private inventoryOpen = false
  private isPaused = false
  private isStatAllocOpen = false
  private isEquipModalOpen = false
  private awaitingEquipModal = false
  private pendingItem: import('../types').Item | null = null

  constructor() {
    super({ key: 'GameScene' })
  }

  preload() {
    // 宝箱スプライト（装備品アイテム表示用）
    this.load.image('box-0089', '/asetts/dungeon/box/tile_0089.png')
    this.load.image('box-0092', '/asetts/dungeon/box/tile_0092.png')
  }

  create() {
    this.graphics = this.add.graphics()
    this.initGame()
    this.input.keyboard!.on('keydown', this.handleInput, this)
    window.allocateStat = (stat: AllocStat) => this.doAllocateStat(stat)
    window.useSpell    = (itemId: string) => this.useSpellById(itemId)
    window.useHeal     = (itemId: string) => this.useHealById(itemId)
    window.resolveEquip = (equip: boolean) => this.resolveEquipModal(equip)
    window.equipFromBag = (itemId: string) => this.equipFromBag(itemId)

    const W = this.scale.width
    const H = this.scale.height

    this.telopText = this.add.text(W / 2, H / 2 - 40, '', {
      fontSize: '22px',
      color: '#ff4444',
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center',
    }).setOrigin(0.5).setDepth(10)

    this.createPauseOverlay()
    this.createInventoryPanel()

    this.renderMap()
    this.updateWindowGameState()
    this.showTelopIfNeeded()
    this.updateBGM()
    if (this.state.floorType === 'chaos') this.showMonsterHouseEffect()
  }

  private initGame() {
    const map = generateDungeon()
    const playerPos = getPlayerStartPosition(map)
    const areaBossFloors = generateAreaBossFloors()

    const floorType = this.determineFloorType(1)  // 初期LUK=1
    const initBase = 5 + 1  // floor 1
    const initLukBonus = 0   // 初期LUK=1 → floor(1*0.5)=0
    const initCount = initBase + Math.floor(Math.random() * (initBase + initLukBonus))
    const normalEnemies = floorType === 'chaos'
      ? spawnMonsterHouseEnemies(map, 1, playerPos)
      : spawnEnemies(map, initCount, 1)
    let bosses = spawnBosses(1, areaBossFloors)
    if (floorType === 'chaos') bosses = [...bosses, this.makeChaosExtraBoss(1)]
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
        attack: 5,
        defense: 3,
        level: 1,
        exp: 0,
        floor: 1,
        stamina: 200,
        maxStamina: 200,
        poisoned: false,
        poisonTurns: 0,
        equipment: {},
        str: 1, agi: 1, dex: 1, int: 1, vit: 1, luk: 1,
        statPoints: 0,
        healingTurns: 0,
      },
      enemies: [...normalEnemies, ...bosses],
      items: floorType === 'lucky'
        ? spawnItems(map, 1, { countMult: 2, equipRate: 0.30 })
        : floorType === 'chaos'
        ? spawnItems(map, 1, { countMult: 3 })
        : spawnItems(map, 1),
      map,
      turn: 0,
      spells: [],
      heals: [],
      bag: [],
      messages: ['地下タワーに潜入した！'],
      areaBossFloors,
      floorType,
    }
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
    this.telopText.setColor(color)
    this.telopText.setText(parts.join('\n'))
    this.telopText.setAlpha(1)

    this.tweens.add({
      targets: this.telopText,
      alpha: 0,
      duration: 3000,
      delay: 2000,
    })
  }

  private handleInput(event: KeyboardEvent) {
    if (this.isStatAllocOpen || this.isEquipModalOpen) return
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

    if (event.key === 'ArrowUp') dy = -1
    else if (event.key === 'ArrowDown') dy = 1
    else if (event.key === 'ArrowLeft') dx = -1
    else if (event.key === 'ArrowRight') dx = 1
    else return

    const nx = player.position.x + dx
    const ny = player.position.y + dy

    if (this.state.map[ny][nx] === 'wall') return

    const enemy = this.state.enemies.find(e => e.position.x === nx && e.position.y === ny)
    if (enemy) {
      this.attackEnemy(enemy)
    } else {
      player.position.x = nx
      player.position.y = ny

      if (this.state.map[ny][nx] === 'stairs') {
        this.nextFloor()
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
  }

  private pickupItem() {
    const { items } = this.state
    const item = items.find(i => i.position.x === this.state.player.position.x && i.position.y === this.state.player.position.y)
    if (!item) return

    if (item.type === 'heal') {
      const sameCount = this.state.heals.filter(h => h.name === item.name).length
      if (sameCount >= 10) {
        this.addMessage(`${item.name}は所持上限に達したため拾えません`)
        return
      }
      this.state.heals.push({ ...item, position: { x: 0, y: 0 } })
      this.addMessage(`${item.name}を拾った！`)
      this.showPickupNotif(`${item.name}を拾った！`)
    } else if (item.type === 'spell' && item.spellType) {
      const sameCount = this.state.spells.filter(s => s.name === item.name).length
      if (sameCount >= 10) {
        this.addMessage(`${item.name}は所持上限に達したため拾えません`)
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
    const W = this.scale.width
    const H = this.scale.height
    const t = this.add.text(W / 2, H / 2, text, {
      fontSize: '22px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
      backgroundColor: '#00000099',
      padding: { x: 14, y: 7 },
    }).setOrigin(0.5).setDepth(60)
    this.tweens.add({
      targets: t, alpha: 0, duration: 500, delay: 1500,
      onComplete: () => t.destroy(),
    })
  }

  private doEquip(item: import('../types').Item) {
    if (!item.equipSlot) return
    const { player } = this.state
    const slot = item.equipSlot
    const old = player.equipment[slot]
    if (old) {
      player.attack  -= old.atkBonus ?? 0
      player.defense -= old.defBonus ?? 0
      player.maxHp   -= old.hpBonus  ?? 0
      player.hp = Math.min(player.hp, player.maxHp)
      player.str -= old.strBonus ?? 0; player.agi -= old.agiBonus ?? 0
      player.dex -= old.dexBonus ?? 0; player.int -= old.intBonus ?? 0
      player.vit -= old.vitBonus ?? 0; player.luk -= old.lukBonus ?? 0
    }
    player.equipment[slot] = item
    player.attack  += item.atkBonus ?? 0
    player.defense += item.defBonus ?? 0
    player.maxHp   += item.hpBonus  ?? 0
    player.hp      += item.hpBonus  ?? 0
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

  private checkTrap() {
    const { player, map } = this.state
    const tile = map[player.position.y][player.position.x]
    if (tile === 'trap') {
      const dmg = 3
      player.hp = Math.max(0, player.hp - dmg)
      player.poisoned = true
      player.poisonTurns = 5
      this.addMessage('ベノムダストを踏んだ！毒状態に！')
      if (player.hp <= 0) this.gameOver()
    }
  }

  private attackEnemy(enemy: typeof this.state.enemies[0]) {
    const { player } = this.state
    const effectiveAtk  = player.attack + Math.floor(player.str * 0.5)
    const attackCount   = Math.min(5, Math.floor(player.agi / 50) + 1)
    const hitRate       = Math.min(0.99, 0.90 + player.dex * 0.001)
    const critRate      = player.luk * 0.001

    for (let hit = 0; hit < attackCount; hit++) {
      if (enemy.hp <= 0) break

      if (Math.random() > hitRate) {
        this.addMessage(`${enemy.name}への攻撃がはずれた！`)
        continue
      }

      const isCrit = Math.random() < critRate
      const raw    = Math.max(1, effectiveAtk - enemy.defense)
      const dmg    = isCrit ? Math.floor(raw * 1.5) : raw
      enemy.hp = Math.max(0, enemy.hp - dmg)

      if (isCrit) {
        this.addMessage(`${enemy.name}にクリティカル！${dmg}ダメージ！`)
      } else {
        playAttack()
        this.addMessage(`${enemy.name}に${dmg}ダメージ！`)
      }
    }

    if (enemy.hp <= 0) {
      this.state.enemies = this.state.enemies.filter(e => e.id !== enemy.id)
      const expGain = enemy.isBoss ? (50 + enemy.maxHp) : (5 + enemy.maxHp)
      player.exp += expGain
      this.addMessage(`${enemy.name}を倒した！経験値+${expGain}`)
      this.checkLevelUp()
    }
  }

  private checkLevelUp() {
    const { player } = this.state
    const expNeeded = player.level * 30 + 10
    if (player.exp >= expNeeded) {
      player.exp -= expNeeded
      player.level++
      player.maxHp += 3
      player.hp = player.maxHp
      player.attack += 1
      player.defense += 1
      player.statPoints += 5
      this.addMessage(`レベルアップ！Lv${player.level}  +5ステータスポイント！`)
      playLevelUp()
      this.updateWindowGameState()
      this.isStatAllocOpen = true
      window.dispatchEvent(new Event('stat-alloc-open'))
    }
  }

  private doAllocateStat(stat: AllocStat) {
    const { player } = this.state
    if (player.statPoints <= 0) return
    player[stat]++
    player.statPoints--
    this.updateWindowGameState()
    if (player.statPoints <= 0) {
      this.isStatAllocOpen = false
    }
  }

  private enemyTurn() {
    const { player, enemies } = this.state
    for (const enemy of enemies) {
      const dx = player.position.x - enemy.position.x
      const dy = player.position.y - enemy.position.y
      const dist = Math.abs(dx) + Math.abs(dy)

      if (dist === 1) {
        const baseAtk = enemy.attack + Math.floor(enemy.str * 0.5)
        const effectiveAtk = enemy.slowedTurns > 0 ? Math.floor(baseAtk * 0.5) : baseAtk
        const effectiveDef = player.defense + Math.floor(player.vit * 0.3)
        const critRate = enemy.luk * 0.001
        const isCrit = Math.random() < critRate
        const raw = Math.max(1, effectiveAtk - effectiveDef)
        const dmg = isCrit ? Math.floor(raw * 1.5) : raw
        player.hp = Math.max(0, player.hp - dmg)
        playDamage()
        if (isCrit) {
          this.addMessage(`${enemy.name}からクリティカル！${dmg}ダメージ！`)
        } else {
          this.addMessage(`${enemy.name}から${dmg}ダメージ！`)
        }
        if (player.hp <= 0) {
          this.gameOver()
          return
        }
      } else if (dist < 8) {
        const mx = Math.sign(dx)
        const my = Math.sign(dy)
        const nx = enemy.position.x + mx
        const ny = enemy.position.y + my
        if (this.state.map[ny]?.[nx] === 'floor') {
          const occupied = enemies.some(e => e.position.x === nx && e.position.y === ny)
          if (!occupied) {
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
        if (target.hp <= 0) {
          this.state.enemies = this.state.enemies.filter(e => e.id !== target.id)
          const exp = target.isBoss ? (50 + target.maxHp) : (5 + target.maxHp)
          player.exp += exp
          this.addMessage(`${target.name}を倒した！経験値+${exp}`)
          this.checkLevelUp()
        }
        break
      }

      case 'blessing': {
        player.str += 5
        player.int += 5
        player.dex += 5
        player.agi += 5
        this.addMessage('ブレッシング！ステータスが上昇した！')
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
        const deadIds: string[] = []
        for (const enemy of enemies) {
          enemy.hp = Math.max(0, enemy.hp - dmg)
          if (enemy.hp <= 0) deadIds.push(enemy.id)
        }
        this.addMessage(`メテオストーム！全敵に${dmg}ダメージ！`)
        for (const id of deadIds) {
          const dead = this.state.enemies.find(e => e.id === id)
          if (!dead) continue
          this.state.enemies = this.state.enemies.filter(e => e.id !== id)
          const exp = dead.isBoss ? (50 + dead.maxHp) : (5 + dead.maxHp)
          player.exp += exp
          this.addMessage(`${dead.name}を倒した！経験値+${exp}`)
          this.checkLevelUp()
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
    this.state.player.floor++
    const floor = this.state.player.floor
    const map = generateDungeon()
    const playerPos = getPlayerStartPosition(map)
    this.state.map = map
    this.state.player.position = { ...playerPos }

    const floorType = this.determineFloorType(this.state.player.luk)
    const base     = 5 + floor
    const lukBonus = Math.floor(this.state.player.luk * 0.5)
    const count    = base + Math.floor(Math.random() * (base + lukBonus))
    const normalEnemies = floorType === 'chaos'
      ? spawnMonsterHouseEnemies(map, floor, playerPos)
      : spawnEnemies(map, count, floor)
    let bosses = spawnBosses(floor, this.state.areaBossFloors)
    if (floorType === 'chaos') bosses = [...bosses, this.makeChaosExtraBoss(floor)]

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
    this.state.items = floorType === 'lucky'
      ? spawnItems(map, floor, { countMult: 2, equipRate: 0.30 })
      : floorType === 'chaos'
      ? spawnItems(map, floor, { countMult: 3 })
      : spawnItems(map, floor)
    this.state.floorType = floorType
    this.addMessage(`${floorLabel(floor)}に降りた！`)
    playStairs()
    this.renderMap()
    this.updateWindowGameState()
    this.showTelopIfNeeded()
    this.updateBGM()
    if (floorType === 'chaos') this.showMonsterHouseEffect()
  }

  private gameOver() {
    this.input.keyboard!.off('keydown', this.handleInput, this)
    this.time.delayedCall(1000, () => {
      this.scene.start('GameOverScene', { floor: this.state.player.floor })
    })
  }

  private addMessage(msg: string) {
    this.state.messages.unshift(msg)
    if (this.state.messages.length > 50) this.state.messages.pop()
  }

  private updateWindowGameState() {
    const { player, messages } = this.state
    window.gameState = {
      hp: player.hp,
      maxHp: player.maxHp,
      attack: player.attack,
      defense: player.defense,
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
    }
    window.dispatchEvent(new Event('gamestate-update'))
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

  private makeChaosExtraBoss(floor: number) {
    const scale = 1 + floor * 0.1
    return {
      id: `enemy_chaos_${floor}_${Date.now()}`,
      position: { x: 0, y: 0 },
      hp:      Math.floor((30 + floor * 5) * 3 * scale),
      maxHp:   Math.floor((30 + floor * 5) * 3 * scale),
      attack:  Math.floor((10 + floor * 2) * 1.5 * scale),
      defense: Math.floor((5  + floor)     * 1.5 * scale),
      str: Math.floor((4 + floor * 0.5) * 1.5),
      vit: Math.floor((2 + floor * 0.3) * 1.5),
      agi: Math.floor((5 + floor * 0.2) * 1.5),
      luk: Math.floor((2 + floor * 0.1) * 1.8),
      slowedTurns: 0,
      name: '【混沌】アビスガーディアン',
      isBoss: true as const,
    }
  }

  private showMonsterHouseEffect() {
    const W = this.scale.width
    const H = this.scale.height
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0xff2200, 0).setDepth(90)
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
    if (this.state.floorType === 'lucky') return true
    const { player } = this.state
    const dx = tx - player.position.x
    const dy = ty - player.position.y
    return dx * dx + dy * dy <= VISION_RADIUS * VISION_RADIUS
  }

  private renderMap() {
    this.graphics.clear()
    const { map, player, enemies, items } = this.state
    const W = this.scale.width
    const H = this.scale.height
    const offsetX = Math.max(0, Math.min(player.position.x * TILE_SIZE - W / 2, MAP_WIDTH * TILE_SIZE - W))
    const offsetY = Math.max(0, Math.min(player.position.y * TILE_SIZE - H / 2, MAP_HEIGHT * TILE_SIZE - H))

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const tile = map[y][x]
        const px = x * TILE_SIZE - offsetX
        const py = y * TILE_SIZE - offsetY
        if (px < -TILE_SIZE || px > W || py < -TILE_SIZE || py > H) continue
        if (!this.isVisible(x, y)) continue

        if      (tile === 'wall')   this.graphics.fillStyle(0x333333)
        else if (tile === 'floor')  this.graphics.fillStyle(0x888866)
        else if (tile === 'stairs') this.graphics.fillStyle(0x4444ff)
        else if (tile === 'trap')   this.graphics.fillStyle(0x662288)
        else continue
        this.graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE)
      }
    }

    // ── アイテム描画：装備品=宝箱スプライト / 回復=💊 / 魔法=📖 ──
    this.itemGraphics.forEach(g => g.destroy())
    this.itemGraphics.clear()
    for (const item of items) {
      if (!this.isVisible(item.position.x, item.position.y)) continue
      const px = item.position.x * TILE_SIZE - offsetX
      const py = item.position.y * TILE_SIZE - offsetY
      let g: Phaser.GameObjects.GameObject
      if (item.type === 'equip') {
        // 宝箱スプライト: id の先頭文字コードで box-0089 / box-0092 を固定選択
        // 利用ファイル: box/tile_0089.png, box/tile_0092.png
        const boxKey = item.id.charCodeAt(5) % 2 === 0 ? 'box-0089' : 'box-0092'
        g = this.add.image(px + TILE_SIZE / 2, py + TILE_SIZE / 2, boxKey)
          .setDisplaySize(TILE_SIZE - 4, TILE_SIZE - 4)
          .setDepth(1)
      } else {
        const icon = item.type === 'heal' ? '💊' : '📖'
        g = this.add.text(px + 8, py + 8, icon, { fontSize: '28px' }).setDepth(1)
      }
      this.itemGraphics.set(item.id, g)
    }

    this.enemyGraphics.forEach(g => g.destroy())
    this.enemyGraphics.clear()
    for (const enemy of enemies) {
      if (!this.isVisible(enemy.position.x, enemy.position.y)) continue
      const px = enemy.position.x * TILE_SIZE - offsetX
      const py = enemy.position.y * TILE_SIZE - offsetY
      const color = enemy.isBoss
        ? (enemy.name.startsWith('【MVP】') ? 0xff8800
          : enemy.name.startsWith('【エリア】') ? 0xffff00
          : 0xff00ff)
        : 0xff4444
      const g = this.add.rectangle(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE - 4, TILE_SIZE - 4, color)
      this.enemyGraphics.set(enemy.id, g)
    }

    if (this.playerGraphic) this.playerGraphic.destroy()
    const px = player.position.x * TILE_SIZE - offsetX
    const py = player.position.y * TILE_SIZE - offsetY
    this.playerGraphic = this.add.rectangle(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE - 4, TILE_SIZE - 4, 0x44ff44)
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
    this.pauseOverlay = this.add.container(0, 0, [bg, text, hint]).setDepth(100).setVisible(false)
  }

  private createInventoryPanel() {
    this.inventoryPanel = this.add.container(0, 0).setDepth(50).setVisible(false)
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
          item.atkBonus && `ATK+${item.atkBonus}`,
          item.defBonus && `DEF+${item.defBonus}`,
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
