import Phaser from 'phaser'
import { playBGM, isMuted, toggleMute } from '../game/sound'
import { fetchRanking } from '../game/supabase'
import { hasSave, clearSave } from '../game/save'
import { getDisplayName, setDisplayName } from '../game/playerName'

const PIXEL_FONT  = '"Press Start 2P", monospace'
const KEY_STORAGE = 'keyMode'

type KeyMode = 'arrows' | 'wasd' | 'both'


export class TitleScene extends Phaser.Scene {
  private overlay: Phaser.GameObjects.Container | null = null

  constructor() { super({ key: 'TitleScene' }) }

  preload() {
    this.load.image('title-bg', '/assets/title/title.png')
    this.load.image('btn-frame', '/assets/ui/button-frame.png')
  }

  create() {
    playBGM('title')
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2

    // 入場フェードイン
    this.cameras.main.fadeIn(500, 0, 0, 0)

    // ── 背景画像（cover 挙動）──
    if (this.textures.exists('title-bg')) {
      const bg = this.add.image(cx, H / 2, 'title-bg').setDepth(0)
      const baseScale = Math.max(W / bg.width, H / bg.height)
      bg.setScale(baseScale)
      // ごく僅かにゆっくりズームしてタイトルに動きを出す（Ken Burns風）
      this.tweens.add({
        targets: bg,
        scale: baseScale * 1.06,
        duration: 12000,
        ease: 'Sine.InOut',
        yoyo: true,
        repeat: -1,
      })
    } else {
      this.add.rectangle(cx, H / 2, W, H, 0x060610).setDepth(0)
    }

    // ── ボタン（下部中央・縦並び・全幅統一）──
    const btnFont = W < 500 ? 15 : 22
    const gap     = H * 0.09
    const top     = H * 0.60

    // ── 表示名（GAME START の上）。タップで変更可 ──
    this.makeNameBadge(cx, top - gap * 0.95, W)

    // ①〜④ すべて同じ固定幅 BTN_WIDTH で生成
    const startBtn = this.makeBtn(cx, top,          'GAME START',  btnFont, () => {
      this.startGame()
    })
    const b2 = this.makeBtn(cx, top + gap,    'RANKING',     btnFont, () => { void this.goRanking() })
    const b3 = this.makeBtn(cx, top + gap * 2,'SETTINGS',    btnFont, () => { this.openSettings(W, H) })
    const b4 = this.makeBtn(cx, top + gap * 3,'HOW TO PLAY', btnFont, () => { this.openHowTo(W, H) })

    // ボタンを下から段階的にフェードイン
    const btns = [startBtn, b2, b3, b4]
    btns.forEach((btn, i) => {
      btn.setAlpha(0)
      const baseY = btn.y
      btn.setY(baseY + 16)
      this.tweens.add({
        targets: btn,
        alpha: 1,
        y: baseY,
        duration: 360,
        delay: 250 + i * 90,
        ease: 'Back.Out',
      })
    })

    // GAME START を脈動させて「押せる」感を出す
    this.tweens.add({
      targets: startBtn,
      scale: 1.05,
      duration: 900,
      delay: 700,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    })

    // React 側レイアウトへ「非プレイ画面（全幅化）」を通知。
    // スマホではキャンバスを全幅表示にして余白を埋める（プレイ遷移で GameScene が元に戻す）。
    window.dispatchEvent(new Event('et-canvas-full'))
  }

  /** フェードアウトしてからシーン遷移する共通ヘルパー */
  private fadeToScene(key: string, data?: object) {
    this.cameras.main.fadeOut(350, 0, 0, 0)
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(key, data))
  }

  private startGame() {
    if (hasSave()) {
      window.showResumeConfirm?.(
        () => { this.fadeToScene('GameScene') },
        () => { clearSave(); this.fadeToScene('GameScene') }
      )
    } else {
      this.fadeToScene('GameScene')
    }
  }

  // ── 表示名バッジ（タップで prompt 変更。ワールド通知に使う名前）──
  private makeNameBadge(cx: number, y: number, W: number) {
    const fontSize = W < 500 ? 14 : 19
    const badge = this.add.text(cx, y, '', {
      fontFamily: PIXEL_FONT,
      fontSize:   `${fontSize}px`,
      color:      '#ffe699',
      backgroundColor: '#00000099',
      padding:    { x: 22, y: 12 },
      align:      'center',
    }).setOrigin(0.5).setDepth(10)

    const render = () => badge.setText(`名前: ${getDisplayName()}  ✎`)
    render()

    badge.setInteractive({ useHandCursor: true })
    badge.on('pointerover', () => badge.setColor('#ffffff'))
    badge.on('pointerout',  () => badge.setColor('#ffe699'))
    badge.on('pointerdown', () => {
      const input = prompt('冒険者の名前を入力（12文字以内・任意）', getDisplayName())
      if (input !== null) { setDisplayName(input); render() }
    })
  }

  // ── 全ボタン共通生成（金縁＋宝石のリッチフレーム＋中央テキスト） ──
  private makeBtn(x: number, y: number, label: string, size: number, cb: () => void) {
    const small = this.scale.width < 500
    const w = small ? 268 : 332
    const h = small ? 54 : 66

    const frame = this.add.image(0, 0, 'btn-frame').setDisplaySize(w, h)
    const txt = this.add.text(0, 0, label, {
      fontFamily: PIXEL_FONT,
      fontSize:   `${size}px`,
      color:      '#f4e3a8',
      align:      'center',
    }).setOrigin(0.5)
    txt.setShadow(2, 2, '#160a02', 4, true, true)

    const btn = this.add.container(x, y, [frame, txt]).setSize(w, h).setDepth(10)
    btn.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    })
    btn.on('pointerover', () => { frame.setTint(0xfff2cc); txt.setColor('#fffbe6') })
    btn.on('pointerout',  () => { frame.clearTint();       txt.setColor('#f4e3a8') })
    btn.on('pointerdown', cb)
    return btn
  }

  private closeOverlay() { this.overlay?.destroy(); this.overlay = null }


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


  // ── 遊び方モーダル（React側の HowToPlay コンポーネントに委譲）──
  private openHowTo(_W: number, _H: number) {
    window.showHowToPlay?.()
  }

  // ── ランキング画面へ遷移（from: 'title'）──
  private async goRanking() {
    try {
      const ranking = await fetchRanking()
      this.fadeToScene('RankingScene', { ranking, floor: 0, from: 'title' })
    } catch {
      this.fadeToScene('RankingScene', { ranking: [], floor: 0, from: 'title' })
    }
  }
}
