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

    // ── グループ1: ラベル＋入力フィールド ──
    const groupW   = Math.min(520, W * 0.80)
    const labelY   = H * 0.38
    const inputY   = H * 0.47
    const inputH   = fsPx(24) + 24
    const g1Top    = H * 0.33
    const g1Bot    = H * 0.535
    const g1Cx     = (g1Top + g1Bot) / 2
    const g1H      = g1Bot - g1Top

    // グループ1外枠
    const group1Bg = this.add.graphics()
    group1Bg.fillStyle(0x0d0d22, 1)
    group1Bg.fillRect(cx - groupW / 2, g1Top, groupW, g1H)
    group1Bg.lineStyle(2, 0x6666bb, 1)
    group1Bg.strokeRect(cx - groupW / 2, g1Top, groupW, g1H)

    // ラベル
    this.add.text(cx, labelY, '名前を入力してランキングに登録', {
      fontSize: fs(20), color: '#cccccc',
    }).setOrigin(0.5)

    // 入力フィールド内枠
    const inputBg = this.add.graphics()
    this.drawBox(inputBg, cx, inputY, groupW - 24, inputH, 0x1a1a44, 0x8888ff)

    this.nameInput = this.add.text(cx, inputY, this.PLACEHOLDER, {
      fontSize: fs(22), color: '#555577',
      fixedWidth: groupW - 40,
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

    // ── グループ2: ボタン2つ ──
    const btnRowH  = fsPx(26) + 32
    const submitY  = H * 0.655
    const retryY   = H * 0.775
    const g2Top    = H * 0.605
    const g2Bot    = H * 0.825
    const g2H      = g2Bot - g2Top

    // グループ2外枠
    const group2Bg = this.add.graphics()
    group2Bg.fillStyle(0x0d0d0d, 1)
    group2Bg.fillRect(cx - groupW / 2, g2Top, groupW, g2H)
    group2Bg.lineStyle(2, 0x666666, 1)
    group2Bg.strokeRect(cx - groupW / 2, g2Top, groupW, g2H)

    // ボタン間の区切り線
    const divY = (submitY + retryY) / 2
    group2Bg.lineStyle(1, 0x444444, 1)
    group2Bg.lineBetween(cx - groupW / 2 + 12, divY, cx + groupW / 2 - 12, divY)

    // 登録してランキングをみる（ホバー背景）
    const submitHover = this.add.graphics()
    const submitBtn = this.add.text(cx, submitY, '登録してランキングをみる', {
      fontSize: fs(26), color: '#00ff88', fontStyle: 'bold',
    }).setOrigin(0.5)

    submitBtn.setInteractive({ useHandCursor: true })
    submitBtn.on('pointerdown', () => {
      if (this.playerName.length > 0 && !this.submitted) this.registerRanking()
    })
    submitBtn.on('pointerover', () => {
      submitBtn.setColor('#ffffff')
      submitHover.fillStyle(0x006644, 0.5)
      submitHover.fillRect(cx - groupW / 2, g2Top, groupW, divY - g2Top)
    })
    submitBtn.on('pointerout', () => {
      submitBtn.setColor('#00ff88')
      submitHover.clear()
    })

    // 登録せずにTOPへ戻る（ホバー背景）
    const retryHover = this.add.graphics()
    const retryBtn = this.add.text(cx, retryY, '登録せずにTOPへ戻る', {
      fontSize: fs(26), color: '#aaaaaa', fontStyle: 'bold',
    }).setOrigin(0.5)

    retryBtn.setInteractive({ useHandCursor: true })
    retryBtn.on('pointerdown', () => { this.scene.start('TitleScene') })
    retryBtn.on('pointerover', () => {
      retryBtn.setColor('#ffffff')
      retryHover.fillStyle(0x333333, 0.5)
      retryHover.fillRect(cx - groupW / 2, divY, groupW, g2Bot - divY)
    })
    retryBtn.on('pointerout', () => {
      retryBtn.setColor('#aaaaaa')
      retryHover.clear()
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
