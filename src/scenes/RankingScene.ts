import Phaser from 'phaser'
import { floorLabel } from '../game/utils'
import { playBGM } from '../game/sound'

interface RankingEntry {
  player_name: string
  floor: number
  created_at: string
}

export class RankingScene extends Phaser.Scene {
  private ranking: RankingEntry[] = []
  private floor: number = 1

  constructor() {
    super({ key: 'RankingScene' })
  }

  init(data: { ranking: RankingEntry[]; floor: number }) {
    this.ranking = data.ranking
    this.floor = data.floor
  }

  create() {
    playBGM('ranking')
    const cx = 400

    this.add.rectangle(cx, 350, 800, 700, 0x000000)

    this.add.text(cx, 50, 'ランキング TOP10', {
      fontSize: '40px',
      color: '#ffdd00',
      fontStyle: 'bold',
    }).setOrigin(0.5)

    this.add.text(cx, 100, `あなたの記録：${floorLabel(this.floor)}`, {
      fontSize: '22px',
      color: '#aaffaa',
    }).setOrigin(0.5)

    // ランキング表示
    if (this.ranking.length === 0) {
      this.add.text(cx, 300, 'まだ記録がありません', {
        fontSize: '20px',
        color: '#aaaaaa',
      }).setOrigin(0.5)
    } else {
      this.ranking.forEach((entry, i) => {
        const y = 150 + i * 42
        const color = i === 0 ? '#ffdd00' : i === 1 ? '#cccccc' : i === 2 ? '#cc8844' : '#ffffff'
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`

        this.add.text(cx - 200, y, `${medal}`, {
          fontSize: '22px',
          color,
        })
        this.add.text(cx - 150, y, entry.player_name, {
          fontSize: '22px',
          color,
        })
        this.add.text(cx + 150, y, floorLabel(entry.floor), {
          fontSize: '22px',
          color,
        }).setOrigin(1, 0)
      })
    }

    // もう一度ボタン
    const btn = this.add.text(cx, 590, 'もう一度挑戦する', {
      fontSize: '28px',
      color: '#00ff88',
      backgroundColor: '#003322',
      padding: { x: 24, y: 12 },
    }).setOrigin(0.5)

    btn.setInteractive({ useHandCursor: true })
    btn.on('pointerdown', () => { this.scene.start('TitleScene') })
    btn.on('pointerover', () => { btn.setColor('#ffffff') })
    btn.on('pointerout', () => { btn.setColor('#00ff88') })
  }
}