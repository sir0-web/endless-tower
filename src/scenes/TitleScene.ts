import Phaser from 'phaser'
import { playBGM } from '../game/sound'

export class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TitleScene' })
  }

  create() {
    playBGM('title')
    const cx = 400
    const cy = 300

    // 背景
    this.add.rectangle(cx, cy, 800, 700, 0x000000)

    // タイトル
    this.add.text(cx, cy - 200, 'エンドレス地下タワー', {
      fontSize: '48px',
      color: '#ffdd00',
      fontStyle: 'bold',
      stroke: '#aa6600',
      strokeThickness: 6,
    }).setOrigin(0.5)

    // サブタイトル
    this.add.text(cx, cy - 130, '～どこまで潜れるか～', {
      fontSize: '24px',
      color: '#aaaaaa',
    }).setOrigin(0.5)

    // 操作説明
    this.add.text(cx, cy, [
      '【操作方法】',
      '矢印キー：移動・攻撃',
      'アイテムは踏むと自動で拾う',
      '青いマスが階段（次の階へ）',
    ].join('\n'), {
      fontSize: '18px',
      color: '#cccccc',
      align: 'center',
      lineSpacing: 8,
    }).setOrigin(0.5)

    // スタートボタン
    const btn = this.add.text(cx, cy + 180, 'ゲームスタート', {
      fontSize: '32px',
      color: '#00ff88',
      backgroundColor: '#003322',
      padding: { x: 30, y: 14 },
      stroke: '#00aa55',
      strokeThickness: 3,
    }).setOrigin(0.5)

    btn.setInteractive({ useHandCursor: true })
    btn.on('pointerdown', () => { this.scene.start('GameScene') })
    btn.on('pointerover', () => { btn.setColor('#ffffff') })
    btn.on('pointerout', () => { btn.setColor('#00ff88') })

    // 点滅アニメ
    this.tweens.add({
      targets: btn,
      alpha: 0.6,
      duration: 800,
      yoyo: true,
      repeat: -1,
    })
  }
}