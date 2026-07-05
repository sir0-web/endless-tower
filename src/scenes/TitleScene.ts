import Phaser from 'phaser'
import { playBGM, isMuted, toggleMute } from '../game/sound'
import { fetchRanking } from '../game/supabase'
import { hasNewAnnouncement } from '../game/announcements'
import { hasSave, clearSave, saveGame } from '../game/save'
import { cloudLoadGame, deleteOwnCloudSave } from '../game/cloudSave'
import { getDisplayName, setDisplayName } from '../game/playerName'
import { safePrompt, fadeOutToScene } from '../game/phaserRecovery'

const PIXEL_FONT  = '"Press Start 2P", monospace'
const KEY_STORAGE = 'keyMode'

type KeyMode = 'arrows' | 'wasd' | 'both'


export class TitleScene extends Phaser.Scene {
  private overlay: Phaser.GameObjects.Container | null = null
  private leaving = false   // シーン遷移開始済みフラグ（二重遷移防止）

  constructor() { super({ key: 'TitleScene' }) }

  preload() {
    this.load.image('title-bg', '/assets/title/title.png')
    this.load.image('btn-frame', '/assets/ui/button-frame.png')
  }

  create() {
    playBGM('title')
    this.leaving = false   // シーンは再利用されるため入場のたびにリセット
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

    // ── ボタン（下部中央・縦並び・全幅統一）。クラウド再開を含め7つ収めるため詰める ──
    const btnFont = W < 500 ? 15 : 22
    const gap     = H * 0.072
    const top     = H * 0.49

    // ── 表示名（NEWS の上）。タップで変更可 ──
    this.makeNameBadge(cx, top - gap * 0.95, W)

    // NEWS は GAME START の真上・同サイズ。以降すべて同じ固定幅で生成
    const newsBtn  = this.makeBtn(cx, top,          'NEWS',        btnFont, () => { window.showNews?.() })
    const startBtn = this.makeBtn(cx, top + gap,    'GAME START',  btnFont, () => { this.startGame() })
    const b2 = this.makeBtn(cx, top + gap * 2,'RANKING',     btnFont, () => { void this.goRanking() })
    const b6 = this.makeBtn(cx, top + gap * 3,'クラウド再開', btnFont, () => { this.resumeFromCloud() })
    const b3 = this.makeBtn(cx, top + gap * 4,'SETTINGS',    btnFont, () => { this.openSettings(W, H) })
    const b4 = this.makeBtn(cx, top + gap * 5,'HOW TO PLAY', btnFont, () => { this.openHowTo() })
    const b5 = this.makeBtn(cx, top + gap * 6,'REPORT',      btnFont, () => { window.showReport?.() })

    // NEWS ボタンに NEW バッジ（24時間以内・このブラウザ未閲覧の投稿があれば点灯）
    this.attachNewsBadge(newsBtn, W)

    // ボタンを下から段階的にフェードイン
    const btns = [newsBtn, startBtn, b2, b6, b3, b4, b5]
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

  /** フェードアウトしてからシーン遷移する共通ヘルパー（RAF停止時もタイムアウトで遷移を保証） */
  private fadeToScene(key: string, data?: object) {
    if (this.leaving) return
    this.leaving = true
    fadeOutToScene(this, key, data)
  }

  private startGame() {
    // 未読のお知らせがあれば警告モーダルを挟む（無ければ即座にproceedへ進む）
    if (window.checkAnnouncementGate) {
      window.checkAnnouncementGate(() => this.proceedStartGame())
    } else {
      this.proceedStartGame()
    }
  }

  private proceedStartGame() {
    if (hasSave()) {
      this.input.enabled = false
      window.showResumeConfirm?.(
        // つづきから（ローカル）：ロード扱い＝クラウドの控えも消費する（二重の保険を残さない）
        () => { this.input.enabled = true; void deleteOwnCloudSave(); this.fadeToScene('GameScene') },
        // 最初から：ローカル中断データを削除。クラウドの控えも破棄する
        () => { this.input.enabled = true; clearSave(); void deleteOwnCloudSave(); this.fadeToScene('GameScene') }
      )
    } else {
      this.fadeToScene('GameScene')
    }
  }

  // ── クラウド再開：名前＋パスワードでサーバーからセーブを取得し、ローカルへ展開して再開 ──
  // 成功するとサーバー行は消費（削除）され、以降はローカル自動セーブが進行を持つ。
  private resumeFromCloud() {
    // safePrompt: ダイアログでtouchendが飲まれてタッチ入力全体が固まる問題への対策
    const name = safePrompt(this, '再開する冒険者名を入力')?.trim()
    if (!name) return
    const password = safePrompt(this, 'パスワードを入力')?.trim()
    if (!password) return

    this.input.enabled = false
    window.showGameToast?.('クラウドデータを確認中...')
    void cloudLoadGame(name, password).then(data => {
      this.input.enabled = true
      if (!data) {
        window.showGameToast?.('該当するクラウドデータが見つかりません。\n名前とパスワードをご確認ください。')
        return
      }
      saveGame(data)   // ローカルへ展開 → GameScene が通常ロードで再開
      this.fadeToScene('GameScene')
    })
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
    // pointerup + setTimeout で開く：タッチ継続中に同期ダイアログを開くと touchend が
    // 飲み込まれてポインタがスタックし、以後の全タップが死ぬ問題（iOS Safari等）の回避
    badge.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.getDistance() > 16) return   // ドラッグは無視
      window.setTimeout(() => {
        const input = safePrompt(this, '冒険者の名前を入力（12文字以内・任意）', getDisplayName())
        if (input !== null) { setDisplayName(input); render() }
      }, 0)
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

  // ── NEWS ボタンへ「NEW」バッジを重ねる（24時間以内・未閲覧の投稿があれば点灯）──
  private attachNewsBadge(btn: Phaser.GameObjects.Container, W: number) {
    const small = W < 500
    const bw = small ? 268 : 332
    const bh = small ? 54 : 66
    // 右上の角に大きめのバッジを配置（視認性重視）
    const tag = this.add.text(bw / 2 - (small ? 14 : 18), -bh / 2 + (small ? 0 : 2), 'NEW', {
      fontFamily: PIXEL_FONT, fontSize: `${small ? 13 : 16}px`, color: '#ffffff',
      backgroundColor: '#e23b2e', padding: { x: 9, y: 6 },
    }).setOrigin(0.5).setVisible(false)
    tag.setStroke('#5a0e08', 4)
    tag.setShadow(2, 2, '#000000', 4, true, true)
    btn.add(tag)
    void hasNewAnnouncement().then(n => {
      tag.setVisible(n)
      // 目立たせるため軽く脈動
      if (n) this.tweens.add({ targets: tag, scale: 1.18, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    }).catch(() => {})
  }

  private closeOverlay() { this.overlay?.destroy(); this.overlay = null }


  // ── 設定モーダル（ミュート + キー設定）──
  private openSettings(W: number, H: number) {
    if (this.overlay) return
    const cx = W / 2, cy = H / 2

    const panel = this.add.rectangle(cx, cy, Math.min(460, W * 0.88), 388, 0x0a0a22, 0.96)
      .setStrokeStyle(2, 0x4455aa)
    const title = this.add.text(cx, cy - 162, 'SETTINGS', {
      fontFamily: PIXEL_FONT, fontSize: '16px', color: '#aaaaff',
    }).setOrigin(0.5)

    // ── ミュート トグル ──
    const muteBtn = this.add.text(cx, cy - 100, this.muteLabel(), {
      fontFamily: PIXEL_FONT, fontSize: '13px', color: '#00ff88',
      backgroundColor: '#003322', padding: { x: 16, y: 10 },
      fixedWidth: 260, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    muteBtn.on('pointerdown', () => { toggleMute(); muteBtn.setText(this.muteLabel()) })

    // ── キー設定 トグル ──
    const keyBtn = this.add.text(cx, cy - 38, this.keyLabel(), {
      fontFamily: PIXEL_FONT, fontSize: '13px', color: '#88ddff',
      backgroundColor: '#002233', padding: { x: 16, y: 10 },
      fixedWidth: 260, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    keyBtn.on('pointerdown', () => { this.cycleKeyMode(); keyBtn.setText(this.keyLabel()) })

    // ── オートセーブ トグル ──
    const autoBtn = this.add.text(cx, cy + 24, this.autoSaveLabel(), {
      fontFamily: PIXEL_FONT, fontSize: '13px', color: '#ffcc66',
      backgroundColor: '#332200', padding: { x: 16, y: 10 },
      fixedWidth: 260, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    autoBtn.on('pointerdown', () => { this.toggleAutoSave(); autoBtn.setText(this.autoSaveLabel()) })

    // ── 閉じる ──
    const closeBtn = this.add.text(cx, cy + 130, 'CLOSE', {
      fontFamily: PIXEL_FONT, fontSize: '13px', color: '#ffffff',
      backgroundColor: '#330000', padding: { x: 16, y: 10 },
      fixedWidth: 140, align: 'center',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    closeBtn.on('pointerdown', () => this.closeOverlay())

    this.overlay = this.add.container(0, 0, [panel, title, muteBtn, keyBtn, autoBtn, closeBtn]).setDepth(50)
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

  // オートセーブ（階層が上がるたびに自動保存）。未設定=ON（デフォルトON）。
  private getAutoSave() { return (localStorage.getItem('autoSave') ?? 'on') !== 'off' }
  private autoSaveLabel() { return this.getAutoSave() ? 'AUTO SAVE : ON ' : 'AUTO SAVE : OFF' }
  private toggleAutoSave() {
    localStorage.setItem('autoSave', this.getAutoSave() ? 'off' : 'on')
  }


  // ── 遊び方モーダル（React側の HowToPlay コンポーネントに委譲）──
  private openHowTo() {
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
