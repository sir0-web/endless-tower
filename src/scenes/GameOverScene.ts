import Phaser from 'phaser'
import { submitRanking, fetchRanking } from '../game/supabase'
import { floorLabel } from '../game/utils'
import { playBGM } from '../game/sound'

export class GameOverScene extends Phaser.Scene {
  private floor: number = 1
  private playerName: string = ''
  private nameInput!: Phaser.GameObjects.Text
  private submitted: boolean = false

  constructor() {
    super({ key: 'GameOverScene' })
  }

  init(data: { floor: number }) {
    this.floor = data.floor
    this.playerName = ''
    this.submitted = false
  }

  create() {
    playBGM('gameover')
    const cx = 400
    const cy = 300

    this.add.rectangle(cx, cy, 800, 700, 0x000000)

    this.add.text(cx, 80, 'GAME OVER', {
      fontSize: '64px',
      color: '#ff4444',
      fontStyle: 'bold',
    }).setOrigin(0.5)

    this.add.text(cx, 170, `到達：${floorLabel(this.floor)}`, {
      fontSize: '40px',
      color: '#ffffff',
    }).setOrigin(0.5)

    // 名前入力
    this.add.text(cx, 240, '名前を入力してランキングに登録', {
      fontSize: '18px',
      color: '#aaaaaa',
    }).setOrigin(0.5)

    this.nameInput = this.add.text(cx, 290, '▶ _', {
      fontSize: '24px',
      color: '#ffff00',
      backgroundColor: '#222222',
      padding: { x: 20, y: 10 },
    }).setOrigin(0.5)

    // キーボード入力
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

    // 登録ボタン
    const submitBtn = this.add.text(cx, 370, '登録してランキングを見る', {
      fontSize: '24px',
      color: '#00ff88',
      backgroundColor: '#003322',
      padding: { x: 20, y: 10 },
    }).setOrigin(0.5)

    submitBtn.setInteractive({ useHandCursor: true })
    submitBtn.on('pointerdown', () => {
      if (this.playerName.length > 0 && !this.submitted) {
        this.registerRanking()
      }
    })
    submitBtn.on('pointerover', () => { submitBtn.setColor('#ffffff') })
    submitBtn.on('pointerout', () => { submitBtn.setColor('#00ff88') })

    // もう一度ボタン
    const retryBtn = this.add.text(cx, 450, 'ランキング登録せずにもう一度', {
      fontSize: '20px',
      color: '#aaaaaa',
      padding: { x: 20, y: 10 },
    }).setOrigin(0.5)

    retryBtn.setInteractive({ useHandCursor: true })
    retryBtn.on('pointerdown', () => { this.scene.start('TitleScene') })
    retryBtn.on('pointerover', () => { retryBtn.setColor('#ffffff') })
    retryBtn.on('pointerout', () => { retryBtn.setColor('#aaaaaa') })
  }

  private async registerRanking() {
    this.submitted = true
    this.nameInput.setText(`登録中...`)
    await submitRanking(this.playerName, this.floor)
    this.showRanking()
  }

  private async showRanking() {
    const ranking = await fetchRanking()
    this.scene.start('RankingScene', { ranking, floor: this.floor })
  }
}