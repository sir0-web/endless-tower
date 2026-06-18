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
  private level: number = 1
  private from: 'title' | 'gameover' = 'gameover'

  constructor() {
    super({ key: 'RankingScene' })
  }

  init(data: { ranking: RankingEntry[]; floor: number; level?: number; from?: 'title' | 'gameover' }) {
    this.ranking = data.ranking
    this.floor   = data.floor
    this.level   = data.level ?? 1
    this.from    = data.from ?? 'gameover'
  }

  create() {
    playBGM('ranking')
    // スマホ: キャンバスを全幅化（非プレイ画面）。ゲームオーバー⇄ランキングでサイズが揃う
    window.dispatchEvent(new Event('et-canvas-full'))
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2

    // 入場フェードイン
    this.cameras.main.fadeIn(450, 0, 0, 0)

    // フォントサイズをキャンバスサイズに合わせてスケール
    const sc = Math.min(W / 800, H / 700)
    const fs = (base: number) => `${Math.max(10, Math.round(base * sc))}px`

    this.add.rectangle(cx, H / 2, W, H, 0x000000)

    this.add.text(cx, H * 0.07, 'ランキング TOP10', {
      fontSize: fs(36), color: '#ffdd00', fontStyle: 'bold',
    }).setOrigin(0.5)

    if (this.floor > 0) {
      this.add.text(cx, H * 0.15, `あなたの記録：${floorLabel(this.floor)}　Lv ${this.level}`, {
        fontSize: fs(18), color: '#aaffaa',
      }).setOrigin(0.5)
    }

    // 列の X 座標（W に対する割合で配置）
    const colRank  = W * 0.04
    const colName  = W * 0.20
    const colFloor = W * 0.60
    const colLevel = W * 0.84

    // ヘッダー行
    const headerY    = H * 0.23
    const headerStyle = { fontSize: fs(16), color: '#888888' }
    this.add.text(colRank,  headerY, '順位', headerStyle)
    this.add.text(colName,  headerY, '名前', headerStyle)
    this.add.text(colFloor, headerY, '到達階', headerStyle).setOrigin(0.5, 0)
    this.add.text(colLevel, headerY, 'Lv',    headerStyle).setOrigin(0.5, 0)

    // 区切り線
    const lineY = headerY + Math.round(22 * sc)
    const line = this.add.graphics()
    line.lineStyle(1, 0x444444)
    line.lineBetween(W * 0.02, lineY, W * 0.98, lineY)

    // ランキング表示
    const rowH = Math.max(22, Math.round(36 * sc))
    const listTop = H * 0.28

    if (this.ranking.length === 0) {
      this.add.text(cx, H * 0.50, 'まだ記録がありません', {
        fontSize: fs(18), color: '#aaaaaa',
      }).setOrigin(0.5)
    } else {
      this.ranking.forEach((entry, i) => {
        const y     = listTop + i * rowH
        const color = i === 0 ? '#ffdd00' : i === 1 ? '#cccccc' : i === 2 ? '#cc8844' : '#ffffff'
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
        const entryFs = fs(18)

        this.add.text(colRank,  y, medal,             { fontSize: entryFs, color })
        this.add.text(colName,  y, entry.player_name, { fontSize: entryFs, color })
        this.add.text(colFloor, y, floorLabel(entry.floor),       { fontSize: fs(14), color }).setOrigin(0.5, 0)
        this.add.text(colLevel, y, `${entry.level ?? '─'}`,       { fontSize: entryFs, color }).setOrigin(0.5, 0)
      })
    }

    // 戻るボタン
    const btnLabel = this.from === 'title' ? 'もどる' : 'もう一度挑戦する'
    const btn = this.add.text(cx, H * 0.88, btnLabel, {
      fontSize: fs(24), color: '#00ff88',
      backgroundColor: '#003322', padding: { x: 20, y: 10 },
    }).setOrigin(0.5)

    btn.setInteractive({ useHandCursor: true })
    btn.on('pointerdown', () => {
      this.cameras.main.fadeOut(350, 0, 0, 0)
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('TitleScene'))
    })
    btn.on('pointerover',  () => { btn.setColor('#ffffff') })
    btn.on('pointerout',   () => { btn.setColor('#00ff88') })
  }
}
