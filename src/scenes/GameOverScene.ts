import Phaser from 'phaser'
import { submitRanking, fetchRanking } from '../game/supabase'
import { floorLabel } from '../game/utils'
import { playBGM } from '../game/sound'

export class GameOverScene extends Phaser.Scene {
  private floor: number = 1
  private level: number = 1
  private playerName: string = ''
  private nameInput!: Phaser.GameObjects.Text
  private submitted: boolean = false

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

    // フォントサイズをキャンバスサイズに合わせてスケール
    const s = Math.min(W / 800, H / 700)
    const fs = (base: number) => `${Math.max(12, Math.round(base * s))}px`

    this.add.rectangle(cx, H / 2, W, H, 0x000000)

    this.add.text(cx, H * 0.11, 'GAME OVER', {
      fontSize: fs(64), color: '#ff4444', fontStyle: 'bold',
    }).setOrigin(0.5)

    this.add.text(cx, H * 0.24, `到達：${floorLabel(this.floor)}`, {
      fontSize: fs(36), color: '#ffffff',
    }).setOrigin(0.5)

    // 名前入力
    this.add.text(cx, H * 0.36, '名前を入力してランキングに登録', {
      fontSize: fs(16), color: '#aaaaaa',
    }).setOrigin(0.5)

    this.nameInput = this.add.text(cx, H * 0.44, '▶ _', {
      fontSize: fs(22), color: '#ffff00',
      backgroundColor: '#222222',
      padding: { x: 16, y: 8 },
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
      this.nameInput.setText(`▶ ${this.playerName}_`)
    })

    // スマホ用：名前入力エリアをタップでネイティブキーボードを呼び出す
    this.nameInput.setInteractive()
    this.nameInput.on('pointerdown', () => {
      if (this.submitted) return
      const name = prompt('プレイヤー名を入力（10文字以内）', this.playerName) ?? this.playerName
      this.playerName = name.slice(0, 10)
      this.nameInput.setText(`▶ ${this.playerName}_`)
    })

    // 登録ボタン
    const submitBtn = this.add.text(cx, H * 0.57, '登録してランキングを見る', {
      fontSize: fs(22), color: '#00ff88',
      backgroundColor: '#003322', padding: { x: 16, y: 10 },
    }).setOrigin(0.5)

    submitBtn.setInteractive({ useHandCursor: true })
    submitBtn.on('pointerdown', () => {
      if (this.playerName.length > 0 && !this.submitted) this.registerRanking()
    })
    submitBtn.on('pointerover', () => { submitBtn.setColor('#ffffff') })
    submitBtn.on('pointerout',  () => { submitBtn.setColor('#00ff88') })

    // もう一度ボタン
    const retryBtn = this.add.text(cx, H * 0.70, 'ランキング登録せずにもう一度', {
      fontSize: fs(18), color: '#aaaaaa', padding: { x: 16, y: 10 },
    }).setOrigin(0.5)

    retryBtn.setInteractive({ useHandCursor: true })
    retryBtn.on('pointerdown', () => { this.scene.start('TitleScene') })
    retryBtn.on('pointerover', () => { retryBtn.setColor('#ffffff') })
    retryBtn.on('pointerout',  () => { retryBtn.setColor('#aaaaaa') })
  }

  private async registerRanking() {
    this.submitted = true
    this.nameInput.setText('登録中...')
    const errMsg = await submitRanking(this.playerName, this.floor, this.level)
    if (errMsg) {
      this.submitted = false
      this.nameInput.setText(`▶ ${this.playerName}_`)
      const W = this.scale.width
      const H = this.scale.height
      const errText = this.add.text(W / 2, H * 0.52, `登録失敗: ${errMsg}`, {
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