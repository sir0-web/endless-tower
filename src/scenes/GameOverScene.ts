import Phaser from 'phaser'
import { submitRanking, fetchRanking } from '../game/supabase'
import { ordinalSuffix } from '../game/utils'
import { playBGM } from '../game/sound'

export class GameOverScene extends Phaser.Scene {
  private floor: number = 1
  private level: number = 1
  private playerName: string = ''
  private nameInput!: Phaser.GameObjects.Text
  private submitted: boolean = false

  private readonly PLACEHOLDER = 'ここをタップして名前を入力'

  constructor() {
    super({ key: 'GameOverScene' })
  }

  init(data: { floor: number; level: number }) {
    this.floor = data.floor
    this.level = data.level
    this.playerName = ''
    this.submitted = false
  }

  create() {
    playBGM('gameover')
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2

    const s    = Math.min(W / 800, H / 700)
    const fs   = (base: number) => `${Math.max(12, Math.round(base * s))}px`
    const fsPx = (base: number) => Math.max(12, Math.round(base * s))

    // 背景
    this.add.rectangle(cx, H / 2, W, H, 0x000000)

    // GAME OVER
    this.add.text(cx, H * 0.11, 'GAME OVER', {
      fontSize: fs(64), color: '#ff4444', fontStyle: 'bold',
    }).setOrigin(0.5)

    // 到達フロア: BASEMENT XXXst Floor !! (階数部分だけオレンジ)
    const ord      = `${this.floor}${ordinalSuffix(this.floor)}`
    const floorFs  = fs(36)
    const floorY   = H * 0.24
    const prefixT  = this.add.text(0, floorY, 'BASEMENT ', { fontSize: floorFs, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0, 0.5)
    const floorT   = this.add.text(0, floorY, ord,          { fontSize: floorFs, color: '#ff8800', fontStyle: 'bold' }).setOrigin(0, 0.5)
    const suffixT  = this.add.text(0, floorY, ' Floor !!',  { fontSize: floorFs, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0, 0.5)
    const totalW   = prefixT.width + floorT.width + suffixT.width
    const startX   = cx - totalW / 2
    prefixT.setX(startX)
    floorT.setX(startX + prefixT.width)
    suffixT.setX(startX + prefixT.width + floorT.width)

    // 入力ラベル
    this.add.text(cx, H * 0.37, '名前を入力してランキングに登録', {
      fontSize: fs(20), color: '#cccccc',
    }).setOrigin(0.5)

    // 名前入力フィールド（枠付き）
    const inputY = H * 0.47
    const inputW = Math.min(520, W * 0.78)
    const inputH = fsPx(24) + 28
    const inputBg = this.add.graphics()
    this.drawBox(inputBg, cx, inputY, inputW, inputH, 0x1a1a44, 0x8888ff)

    this.nameInput = this.add.text(cx, inputY, this.PLACEHOLDER, {
      fontSize: fs(22), color: '#555577',
      fixedWidth: inputW - 16,
      align: 'center',
    }).setOrigin(0.5)

    // キーボード入力（PC）
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (this.submitted) return
      if (event.key === 'Enter' && this.playerName.length > 0) {
        this.registerRanking()
      } else if (event.key === 'Backspace') {
        this.playerName = this.playerName.slice(0, -1)
      } else if (event.key.length === 1 && this.playerName.length < 10) {
        this.playerName += event.key
      }
      this.refreshNameInput()
    })

    // スマホ用タップ入力
    this.nameInput.setInteractive({ useHandCursor: true })
    this.nameInput.on('pointerdown', () => {
      if (this.submitted) return
      const name = prompt('プレイヤー名を入力（10文字以内）', this.playerName) ?? this.playerName
      this.playerName = name.slice(0, 10)
      this.refreshNameInput()
    })

    // ── ボタン共通 ──
    const btnW = Math.min(500, W * 0.74)
    const btnH = fsPx(26) + 32

    // 登録してランキングをみる
    const submitY  = H * 0.63
    const submitBg = this.add.graphics()
    this.drawBox(submitBg, cx, submitY, btnW, btnH, 0x003322, 0x00ff88)

    const submitBtn = this.add.text(cx, submitY, '登録してランキングをみる', {
      fontSize: fs(26), color: '#00ff88', fontStyle: 'bold',
    }).setOrigin(0.5)

    submitBtn.setInteractive({ useHandCursor: true })
    submitBtn.on('pointerdown', () => {
      if (this.playerName.length > 0 && !this.submitted) this.registerRanking()
    })
    submitBtn.on('pointerover', () => {
      submitBtn.setColor('#ffffff')
      this.drawBox(submitBg, cx, submitY, btnW, btnH, 0x006644, 0x00ff88)
    })
    submitBtn.on('pointerout', () => {
      submitBtn.setColor('#00ff88')
      this.drawBox(submitBg, cx, submitY, btnW, btnH, 0x003322, 0x00ff88)
    })

    // 登録せずにTOPへ戻る
    const retryY  = H * 0.79
    const retryBg = this.add.graphics()
    this.drawBox(retryBg, cx, retryY, btnW, btnH, 0x111111, 0x888888)

    const retryBtn = this.add.text(cx, retryY, '登録せずにTOPへ戻る', {
      fontSize: fs(26), color: '#aaaaaa', fontStyle: 'bold',
    }).setOrigin(0.5)

    retryBtn.setInteractive({ useHandCursor: true })
    retryBtn.on('pointerdown', () => { this.scene.start('TitleScene') })
    retryBtn.on('pointerover', () => {
      retryBtn.setColor('#ffffff')
      this.drawBox(retryBg, cx, retryY, btnW, btnH, 0x333333, 0xaaaaaa)
    })
    retryBtn.on('pointerout', () => {
      retryBtn.setColor('#aaaaaa')
      this.drawBox(retryBg, cx, retryY, btnW, btnH, 0x111111, 0x888888)
    })
  }

  /** 名前入力テキストを playerName に合わせて更新 */
  private refreshNameInput() {
    if (this.playerName.length > 0) {
      this.nameInput.setText(`▶ ${this.playerName}_`)
      this.nameInput.setColor('#ffff00')
    } else {
      this.nameInput.setText(this.PLACEHOLDER)
      this.nameInput.setColor('#555577')
    }
  }

  /** 塗り＋枠の矩形を Graphics に描画（ホバー時の再描画に使う） */
  private drawBox(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number, fill: number, stroke: number) {
    g.clear()
    g.fillStyle(fill, 1)
    g.fillRect(cx - w / 2, cy - h / 2, w, h)
    g.lineStyle(2, stroke, 1)
    g.strokeRect(cx - w / 2, cy - h / 2, w, h)
  }

  private async registerRanking() {
    this.submitted = true
    this.nameInput.setText('登録中...')
    this.nameInput.setColor('#aaaaaa')
    const errMsg = await submitRanking(this.playerName, this.floor, this.level)
    if (errMsg) {
      this.submitted = false
      this.refreshNameInput()
      const W = this.scale.width
      const H = this.scale.height
      const errText = this.add.text(W / 2, H * 0.55, `登録失敗: ${errMsg}`, {
        fontSize: '14px', color: '#ff4444',
        backgroundColor: '#330000', padding: { x: 10, y: 6 },
        wordWrap: { width: W * 0.85 },
      }).setOrigin(0.5).setDepth(20)
      this.time.delayedCall(6000, () => errText.destroy())
      return
    }
    this.showRanking()
  }

  private async showRanking() {
    const ranking = await fetchRanking()
    this.scene.start('RankingScene', { ranking, floor: this.floor, level: this.level, from: 'gameover' })
  }
}
