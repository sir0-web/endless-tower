import Phaser from 'phaser'
import { floorLabel } from '../game/utils'
import { playBGM } from '../game/sound'

interface RankingEntry {
  player_name: string
  floor: number
  level: number
  created_at: string
}

export class RankingScene extends Phaser.Scene {
  private ranking: RankingEntry[] = []
  private floor: number = 1
  private from: 'title' | 'gameover' = 'gameover'

  constructor() {
    super({ key: 'RankingScene' })
  }

init(data: {
  ranking: RankingEntry[]
  floor: number
  from?: 'title' | 'gameover'
}) {
    this.ranking = data.ranking
    this.floor   = data.floor
    this.from    = data.from ?? 'gameover'
  }

  create() {
    playBGM('ranking')

    window.dispatchEvent(new Event('et-canvas-full'))

    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2

    this.cameras.main.fadeIn(450, 0, 0, 0)

    const sc = Math.min(W / 800, H / 700)
    const fs = (base: number) => `${Math.max(10, Math.round(base * sc))}px`

    this.add.rectangle(cx, H / 2, W, H, 0x000000)

    this.add.text(cx, H * 0.07, 'ランキング TOP10', {
      fontSize: fs(36),
      color: '#ffdd00',
      fontStyle: 'bold',
    }).setOrigin(0.5)

if (this.floor > 0) {
  this.add.text(cx, H * 0.15, `あなたの記録：${floorLabel(this.floor)}`, {
        fontSize: fs(18),
        color: '#aaffaa',
      }).setOrigin(0.5)
    }

    // 列レイアウト（シンプル化）
const colRank  = W * 0.08
const colName  = W * 0.25
const colFloor = W * 0.65
const colLevel = W * 0.88

    const headerY = H * 0.23
    const headerStyle = { fontSize: fs(16), color: '#888888' }

this.add.text(colRank, headerY, '順位', headerStyle)
this.add.text(colName, headerY, '名前', headerStyle)
this.add.text(colFloor, headerY, '到達階', headerStyle).setOrigin(0.5)
this.add.text(colLevel, headerY, 'Lv', headerStyle).setOrigin(0.5)

    const lineY = headerY + Math.round(22 * sc)
    const line = this.add.graphics()
    line.lineStyle(1, 0x444444)
    line.lineBetween(W * 0.02, lineY, W * 0.98, lineY)

    const rowH = Math.max(22, Math.round(36 * sc))
    const listTop = H * 0.28

    if (this.ranking.length === 0) {
  this.add.text(cx, H * 0.5, 'まだ記録がありません', {
    fontSize: fs(18),
    color: '#aaaaaa',
  }).setOrigin(0.5)
} else {
  this.ranking.forEach((entry, i) => {
    const y = listTop + i * rowH

    const color =
      i === 0 ? '#ffdd00' :
      i === 1 ? '#cccccc' :
      i === 2 ? '#cc8844' : '#ffffff'

    const medal =
      i === 0 ? '🥇' :
      i === 1 ? '🥈' :
      i === 2 ? '🥉' : `${i + 1}.`

    const entryFs = fs(18)

    this.add.text(colRank, y, medal, { fontSize: entryFs, color })
    this.add.text(colName, y, entry.player_name, { fontSize: entryFs, color })

    // 到達階
    this.add.text(
      colFloor,
      y,
      floorLabel(entry.floor),
      { fontSize: fs(14), color }
    ).setOrigin(0.5)

    // レベル
    this.add.text(
      colLevel,
      y,
      String(entry.level),
      { fontSize: fs(14), color }
    ).setOrigin(0.5)
  })
}
    const btnLabel = this.from === 'title' ? 'もどる' : 'もう一度挑戦する'

    const btn = this.add.text(cx, H * 0.88, btnLabel, {
      fontSize: fs(24),
      color: '#00ff88',
      backgroundColor: '#003322',
      padding: { x: 20, y: 10 },
    }).setOrigin(0.5)

    btn.setInteractive({ useHandCursor: true })

    btn.on('pointerdown', () => {
      this.cameras.main.fadeOut(350, 0, 0, 0)
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('TitleScene')
      })
    })

    btn.on('pointerover', () => btn.setColor('#ffffff'))
    btn.on('pointerout',  () => btn.setColor('#00ff88'))
  }
}
