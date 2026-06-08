import Phaser from 'phaser'
import { playBGM, isMuted, toggleMute } from '../game/sound'
import { fetchRanking } from '../game/supabase'
import { hasSave, clearSave } from '../game/save'

const PIXEL_FONT  = '"Press Start 2P", monospace'
const BTN_WIDTH   = 300   // 全ボタン共通の固定幅
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

    // ── ボタン（下部中央・縦並び・全幅統一）──
    const btnFont = W < 500 ? 15 : 22
    const gap     = H * 0.09
    const top     = H * 0.60

    // ①〜④ すべて同じ固定幅 BTN_WIDTH で生成
    this.makeBtn(cx, top,          'GAME START',  btnFont, () => {
      if (hasSave()) this.openResumeConfirm(W, H)
      else this.scene.start('GameScene')
    })
    this.makeBtn(cx, top + gap,    'RANKING',     btnFont, () => { void this.goRanking() })
    this.makeBtn(cx, top + gap * 2,'SETTINGS',    btnFont, () => { this.openSettings(W, H) })
    this.makeBtn(cx, top + gap * 3,'HOW TO PLAY', btnFont, () => { this.openHowTo(W, H) })
  }

  // ── 全ボタン共通生成（fixedWidth で横幅統一・中央揃え）──
  private makeBtn(x: number, y: number, label: string, size: number, cb: () => void) {
    const btn = this.add.text(x, y, label, {
      fontFamily: PIXEL_FONT,
      fontSize:   `${size}px`,
      color:      '#d8d8ff',
      backgroundColor: '#00000099',
      padding:    { x: 20, y: 14 },
      fixedWidth: BTN_WIDTH,
      align:      'center',
    }).setOrigin(0.5).setDepth(10)

    btn.setInteractive({ useHandCursor: true })
    btn.on('pointerover',  () => { btn.setColor('#ffdd00').setBackgroundColor('#000000cc') })
    btn.on('pointerout',   () => { btn.setColor('#d8d8ff').setBackgroundColor('#00000099') })
    btn.on('pointerdown',  cb)
    return btn
  }

  private closeOverlay() { this.overlay?.destroy(); this.overlay = null }

  // ── 中断データ再開確認モーダル ──
  private openResumeConfirm(W: number, H: number) {
    if (this.overlay) return
    const cx = W / 2, cy = H / 2
    const isMobile = window.innerWidth < 768

    const bodySize = isMobile ? '22px' : '12px'
    const btnSize  = isMobile ? '24px' : '14px'
    const panelH   = isMobile ? 340 : 260
    const btnOffY  = isMobile ? 100 : 60
    const btnOffX  = isMobile ? 130 : 90
    const btnW     = isMobile ? 160 : 120

    const panel = this.add.rectangle(cx, cy, Math.min(560, W * 0.92), panelH, 0x0a0a22, 0.96)
      .setStrokeStyle(2, 0x4455aa)
    const body = this.add.text(cx, cy - 60, [
      '前回の中断データがあります。',
      '中断データから再開しますか？',
    ].join('\n'), {
      fontFamily: PIXEL_FONT, fontSize: bodySize, color: '#d8d8ff',
      align: 'center', lineSpacing: isMobile ? 22 : 14,
      wordWrap: { width: Math.min(520, W * 0.86) },
    }).setOrigin(0.5)

    const yesBtn = this.add.text(cx - btnOffX, cy + btnOffY, 'はい', {
      fontFamily: PIXEL_FONT, fontSize: btnSize, color: '#88ff88',
      backgroundColor: '#003322', padding: { x: 18, y: 12 },
      fixedWidth: btnW, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    yesBtn.on('pointerdown', () => {
      this.closeOverlay()
      this.scene.start('GameScene')
    })

    const noBtn = this.add.text(cx + btnOffX, cy + btnOffY, 'いいえ', {
      fontFamily: PIXEL_FONT, fontSize: btnSize, color: '#ff8888',
      backgroundColor: '#330000', padding: { x: 18, y: 12 },
      fixedWidth: btnW, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    noBtn.on('pointerdown', () => {
      clearSave()
      this.closeOverlay()
      this.scene.start('GameScene')
    })

    this.overlay = this.add.container(0, 0, [panel, body, yesBtn, noBtn]).setDepth(50)
  }

  // ── 設定モーダル（ミュート + キー設定）──
  private openSettings(W: number, H: number) {
    if (this.overlay) return
    const cx = W / 2, cy = H / 2

    const panel = this.add.rectangle(cx, cy, Math.min(460, W * 0.88), 320, 0x0a0a22, 0.96)
      .setStrokeStyle(2, 0x4455aa)
    const title = this.add.text(cx, cy - 128, 'SETTINGS', {
      fontFamily: PIXEL_FONT, fontSize: '16px', color: '#aaaaff',
    }).setOrigin(0.5)

    // ── ミュート トグル ──
    const muteBtn = this.add.text(cx, cy - 60, this.muteLabel(), {
      fontFamily: PIXEL_FONT, fontSize: '13px', color: '#00ff88',
      backgroundColor: '#003322', padding: { x: 16, y: 10 },
      fixedWidth: 260, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    muteBtn.on('pointerdown', () => { toggleMute(); muteBtn.setText(this.muteLabel()) })

    // ── キー設定 トグル ──
    const keyBtn = this.add.text(cx, cy + 10, this.keyLabel(), {
      fontFamily: PIXEL_FONT, fontSize: '13px', color: '#88ddff',
      backgroundColor: '#002233', padding: { x: 16, y: 10 },
      fixedWidth: 260, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    keyBtn.on('pointerdown', () => { this.cycleKeyMode(); keyBtn.setText(this.keyLabel()) })

    // ── 閉じる ──
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

  // ── ランキング画面へ遷移（from: 'title'）──
  private async goRanking() {
    try {
      const ranking = await fetchRanking()
      this.scene.start('RankingScene', { ranking, floor: 0, from: 'title' })
    } catch {
      this.scene.start('RankingScene', { ranking: [], floor: 0, from: 'title' })
    }
  }
}
