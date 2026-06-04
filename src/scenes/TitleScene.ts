import Phaser from 'phaser'
import { playBGM, isMuted, toggleMute } from '../game/sound'
import { fetchRanking } from '../game/supabase'

const PIXEL_FONT  = '"Press Start 2P", monospace'
const BTN_WIDTH   = 300
const KEY_STORAGE = 'keyMode'

type KeyMode = 'arrows' | 'wasd' | 'both'

export class TitleScene extends Phaser.Scene {
  private overlay: Phaser.GameObjects.Container | null = null

  constructor() { super({ key: 'TitleScene' }) }

  preload() {
    this.load.image('title-bg', '/assets/title/title.png')
  }

  create() {
    playBGM('title')
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2

    // ── 背景画像（cover 挙動）──
    if (this.textures.exists('title-bg')) {
      const bg = this.add.image(cx, H / 2, 'title-bg').setDepth(0)
      bg.setScale(Math.max(W / bg.width, H / bg.height))
    } else {
      this.add.rectangle(cx, H / 2, W, H, 0x060610).setDepth(0)
    }

    // ── ボタンサイズをキャンバス高さに合わせて適応 ──
    const small   = H < 380                   // スマホ横画面など小型
    const btnFont = small ? 11 : W < 500 ? 15 : 22
    const padX    = small ? 14 : 20
    const padY    = small ? 7  : 14
    const btnW    = Math.min(BTN_WIDTH, Math.floor(W * 0.65))
    const gapH    = small ? 6  : Math.round(H * 0.025)

    // Press Start 2P の実レンダリング高さは fontSize の約2倍
    const btnH   = btnFont * 2 + padY * 2
    const totalH = btnH * 4 + gapH * 3

    // 画面下部62%から開始しつつ、はみ出さないよう上限を設ける
    const safeTop = Math.min(H * 0.62, H - totalH - 4)
    const startY  = safeTop + btnH / 2

    const yAt = (i: number) => startY + i * (btnH + gapH)

    this.makeBtn(cx, yAt(0), 'GAME START',  btnFont, padX, padY, btnW, () => this.scene.start('GameScene'))
    this.makeBtn(cx, yAt(1), 'RANKING',     btnFont, padX, padY, btnW, () => { void this.goRanking() })
    this.makeBtn(cx, yAt(2), 'SETTINGS',    btnFont, padX, padY, btnW, () => this.openSettings(W, H))
    this.makeBtn(cx, yAt(3), 'HOW TO PLAY', btnFont, padX, padY, btnW, () => this.openHowTo(W, H))
  }

  private makeBtn(
    x: number, y: number, label: string,
    size: number, padX: number, padY: number, width: number,
    cb: () => void,
  ) {
    const btn = this.add.text(x, y, label, {
      fontFamily: PIXEL_FONT,
      fontSize:   `${size}px`,
      color:      '#d8d8ff',
      backgroundColor: '#00000099',
      padding:    { x: padX, y: padY },
      fixedWidth: width,
      align:      'center',
    }).setOrigin(0.5).setDepth(10)

    btn.setInteractive({ useHandCursor: true })
    btn.on('pointerover',  () => { btn.setColor('#ffdd00').setBackgroundColor('#000000cc') })
    btn.on('pointerout',   () => { btn.setColor('#d8d8ff').setBackgroundColor('#00000099') })
    btn.on('pointerdown',  cb)
    return btn
  }

  private closeOverlay() { this.overlay?.destroy(); this.overlay = null }

  // ── 設定モーダル ──
  private openSettings(W: number, H: number) {
    if (this.overlay) return
    const cx = W / 2, cy = H / 2

    const panel = this.add.rectangle(cx, cy, Math.min(460, W * 0.88), 320, 0x0a0a22, 0.96)
      .setStrokeStyle(2, 0x4455aa)
    const title = this.add.text(cx, cy - 128, 'SETTINGS', {
      fontFamily: PIXEL_FONT, fontSize: '16px', color: '#aaaaff',
    }).setOrigin(0.5)

    const muteBtn = this.add.text(cx, cy - 60, this.muteLabel(), {
      fontFamily: PIXEL_FONT, fontSize: '13px', color: '#00ff88',
      backgroundColor: '#003322', padding: { x: 16, y: 10 },
      fixedWidth: 260, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    muteBtn.on('pointerdown', () => { toggleMute(); muteBtn.setText(this.muteLabel()) })

    const keyBtn = this.add.text(cx, cy + 10, this.keyLabel(), {
      fontFamily: PIXEL_FONT, fontSize: '13px', color: '#88ddff',
      backgroundColor: '#002233', padding: { x: 16, y: 10 },
      fixedWidth: 260, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    keyBtn.on('pointerdown', () => { this.cycleKeyMode(); keyBtn.setText(this.keyLabel()) })

    const closeBtn = this.add.text(cx, cy + 108, 'CLOSE', {
      fontFamily: PIXEL_FONT, fontSize: '13px', color: '#ffffff',
      backgroundColor: '#330000', padding: { x: 16, y: 10 },
      fixedWidth: 140, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    closeBtn.on('pointerdown', () => this.closeOverlay())

    this.overlay = this.add.container(0, 0, [panel, title, muteBtn, keyBtn, closeBtn]).setDepth(50)
  }

  private muteLabel()  { return isMuted() ? 'SOUND : OFF' : 'SOUND : ON ' }
  private getKeyMode() { return (localStorage.getItem(KEY_STORAGE) ?? 'both') as KeyMode }
  private keyLabel()   {
    const labels: Record<KeyMode, string> = { arrows: 'KEYS: ARROW', wasd: 'KEYS: WASD ', both: 'KEYS: BOTH  ' }
    return labels[this.getKeyMode()]
  }
  private cycleKeyMode() {
    const order: KeyMode[] = ['arrows', 'wasd', 'both']
    const cur  = this.getKeyMode()
    const next = order[(order.indexOf(cur) + 1) % order.length]
    localStorage.setItem(KEY_STORAGE, next)
  }

  // ── 遊び方モーダル ──
  private openHowTo(W: number, H: number) {
    if (this.overlay) return
    const cx = W / 2, cy = H / 2
    const panel = this.add.rectangle(cx, cy, Math.min(500, W * 0.88), 400, 0x0a0a22, 0.96)
      .setStrokeStyle(2, 0x4455aa)
    const title = this.add.text(cx, cy - 170, 'HOW TO PLAY', {
      fontFamily: PIXEL_FONT, fontSize: '14px', color: '#aaaaff',
    }).setOrigin(0.5)
    const body = this.add.text(cx, cy - 40, [
      'ARROW / WASD : Move & Attack',
      '[I] Key  : Inventory',
      '[Esc]    : Pause',
      '',
      'BLUE tile  = Stairs (next floor)',
      'PURPLE tile = Venom Dust (poison)',
      '',
      'Step on items to pick up',
      'Defeat enemies to gain EXP',
    ].join('\n'), {
      fontFamily: PIXEL_FONT, fontSize: '9px', color: '#ccccdd', lineSpacing: 12, align: 'left',
    }).setOrigin(0.5)
    const closeBtn = this.add.text(cx, cy + 160, 'CLOSE', {
      fontFamily: PIXEL_FONT, fontSize: '13px', color: '#ffffff',
      backgroundColor: '#330000', padding: { x: 16, y: 10 },
      fixedWidth: 140, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    closeBtn.on('pointerdown', () => this.closeOverlay())
    this.overlay = this.add.container(0, 0, [panel, title, body, closeBtn]).setDepth(50)
  }

  // ── ランキング画面へ遷移 ──
  private async goRanking() {
    try {
      const ranking = await fetchRanking()
      this.scene.start('RankingScene', { ranking, floor: 0, from: 'title' })
    } catch {
      this.scene.start('RankingScene', { ranking: [], floor: 0, from: 'title' })
    }
  }
}
