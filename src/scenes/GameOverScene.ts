import Phaser from 'phaser'
import type { Player } from '../types'
import { submitRanking, fetchRanking } from '../game/supabase'
import { ordinalSuffix } from '../game/utils'
import { playBGM } from '../game/sound'
import { getDisplayName, setDisplayName } from '../game/playerName'
import { safePrompt, fadeOutToScene } from '../game/phaserRecovery'
import { registerDeadCharacter } from '../game/doppelganger'
import { submitGraveyardEntry, fetchGraveyard, fetchTotalDeathCount, type GraveyardEntry } from '../game/graveyard'

export class GameOverScene extends Phaser.Scene {
  private floor: number = 1
  private level: number = 1
  private refineTotal: number = 0
  private jackpotWins: number = 0
  private playerName: string = ''
  private nameInput!: Phaser.GameObjects.Text
  private submitted: boolean = false
  private leaving: boolean = false   // シーン遷移開始済みフラグ（二重遷移防止）
  private doppelSnapshot: Player | null = null   // ドッペルゲンガー登録用の死亡時ステータス・装備スナップショット
  private deathCause: string = '不明な要因'
  private graveyard: GraveyardEntry[] = []
  private totalDeaths: number | null = null

  private readonly PLACEHOLDER = 'ここをタップして名前を入力'

  constructor() {
    super({ key: 'GameOverScene' })
  }

  init(data: { floor: number; level: number; refineTotal?: number; jackpotWins?: number; doppelSnapshot?: Player; deathCause?: string }) {
    this.floor = data.floor
    this.level = data.level
    this.refineTotal = data.refineTotal ?? 0
    this.jackpotWins = data.jackpotWins ?? 0
    this.playerName = getDisplayName()   // 保存中の表示名を初期値に
    this.submitted = false
    this.leaving = false
    this.doppelSnapshot = data.doppelSnapshot ?? null
    this.deathCause = data.deathCause ?? '不明な要因'
  }

  create() {
    playBGM('ranking')
    // 防御: 万一プレイ中フラグが残っていても、この画面ではジョイスティック等を確実に無効化する
    window.isGameSceneActive = false
    // スマホ: キャンバスを全幅化して余白を無くし、文字を大きく見せる（非プレイ画面）
    window.dispatchEvent(new Event('et-canvas-full'))
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2

    // 入場フェードイン（黒からゆっくり浮かび上がる）
    this.cameras.main.fadeIn(700, 0, 0, 0)

    const s    = Math.min(W / 800, H / 700)
    const fs   = (base: number) => `${Math.max(12, Math.round(base * s))}px`
    const fsPx = (base: number) => Math.max(12, Math.round(base * s))

    // 背景
    this.add.rectangle(cx, H / 2, W, H, 0x000000)

    // GAME OVER
    this.add.text(cx, H * 0.11, 'GAME OVER', {
      fontSize: fs(82), color: '#ff4444', fontStyle: 'bold',
    }).setOrigin(0.5)
      .setStroke('#3a0000', Math.max(4, Math.round(8 * s)))
      .setShadow(0, fsPx(4), '#000000', fsPx(6), true, true)

    // 到達フロア: BASEMENT XXXst Floor !! (階数部分だけオレンジ)
    const ord      = `${this.floor}${ordinalSuffix(this.floor)}`
    const floorFs  = fs(42)
    const floorY   = H * 0.24
    const prefixT  = this.add.text(0, floorY, 'BASEMENT ', { fontSize: floorFs, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0, 0.5)
    const floorT   = this.add.text(0, floorY, ord,          { fontSize: floorFs, color: '#ff8800', fontStyle: 'bold' }).setOrigin(0, 0.5)
    const suffixT  = this.add.text(0, floorY, ' Floor !!',  { fontSize: floorFs, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0, 0.5)
    const totalW   = prefixT.width + floorT.width + suffixT.width
    const startX   = cx - totalW / 2
    prefixT.setX(startX)
    floorT.setX(startX + prefixT.width)
    suffixT.setX(startX + prefixT.width + floorT.width)

    // 死因表示（「〇〇に倒された」）
    this.add.text(cx, H * 0.295, `☠ ${this.deathCause} に倒された`, {
      fontSize: fs(17), color: '#cc8888',
    }).setOrigin(0.5)

    // ── グループ1: ラベル＋入力フィールド ──
    const groupW   = Math.min(520, W * 0.80)
    const labelY   = H * 0.38
    const inputY   = H * 0.47
    const inputH   = fsPx(26) + 26
    const g1Top    = H * 0.33
    const g1Bot    = H * 0.535
    const g1H      = g1Bot - g1Top

    // グループ1外枠
    const group1Bg = this.add.graphics()
    group1Bg.fillStyle(0x0d0d22, 1)
    group1Bg.fillRect(cx - groupW / 2, g1Top, groupW, g1H)
    group1Bg.lineStyle(2, 0x6666bb, 1)
    group1Bg.strokeRect(cx - groupW / 2, g1Top, groupW, g1H)

    // ラベル
    this.add.text(cx, labelY, '名前を入力してランキングに登録', {
      fontSize: fs(23), color: '#dddde8',
    }).setOrigin(0.5)

    // 入力フィールド内枠
    const inputBg = this.add.graphics()
    this.drawBox(inputBg, cx, inputY, groupW - 24, inputH, 0x1a1a44, 0x8888ff)

    this.nameInput = this.add.text(cx, inputY, this.PLACEHOLDER, {
      fontSize: fs(26), color: '#555577',
      fixedWidth: groupW - 40,
      align: 'center',
    }).setOrigin(0.5)
    this.refreshNameInput()   // 初期値（表示名）を反映

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
      this.refreshNameInput()
    })

    // スマホ用タップ入力（safePrompt: DOM入力モーダル。prompt非対応ブラウザでも動く）
    this.nameInput.setInteractive({ useHandCursor: true })
    this.nameInput.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.submitted || this.leaving) return
      if (pointer.getDistance() > 16) return   // ドラッグ（ページスクロール）は無視
      void safePrompt(this, 'プレイヤー名を入力（10文字以内）', this.playerName, 10).then(name => {
        if (name === null) return   // キャンセルは変更なし
        this.playerName = name.slice(0, 10)
        this.refreshNameInput()
      })
    })

    // ── グループ2: ボタン2つ ──
    const submitY  = H * 0.655
    const retryY   = H * 0.775
    const g2Top    = H * 0.605
    const g2Bot    = H * 0.825
    const g2H      = g2Bot - g2Top

    // グループ2外枠
    const group2Bg = this.add.graphics()
    group2Bg.fillStyle(0x0d0d0d, 1)
    group2Bg.fillRect(cx - groupW / 2, g2Top, groupW, g2H)
    group2Bg.lineStyle(2, 0x666666, 1)
    group2Bg.strokeRect(cx - groupW / 2, g2Top, groupW, g2H)

    // ボタン間の区切り線
    const divY = (submitY + retryY) / 2
    group2Bg.lineStyle(1, 0x444444, 1)
    group2Bg.lineBetween(cx - groupW / 2 + 12, divY, cx + groupW / 2 - 12, divY)

    // 登録してランキングをみる（ホバー背景）
    const submitHover = this.add.graphics()
    const submitBtn = this.add.text(cx, submitY, '登録してランキングをみる', {
      fontSize: fs(30), color: '#00ff88', fontStyle: 'bold',
    }).setOrigin(0.5)

    submitBtn.setInteractive({ useHandCursor: true })
    submitBtn.on('pointerdown', () => {
      if (this.submitted || this.leaving) return
      if (this.playerName.length > 0) {
        this.registerRanking()
      } else {
        window.showEventMessage?.('先に名前を入力してください', '#ff4444')
      }
    })
    submitBtn.on('pointerover', () => {
      submitBtn.setColor('#ffffff')
      submitHover.fillStyle(0x006644, 0.5)
      submitHover.fillRect(cx - groupW / 2, g2Top, groupW, divY - g2Top)
    })
    submitBtn.on('pointerout', () => {
      submitBtn.setColor('#00ff88')
      submitHover.clear()
    })

    // 登録せずにTOPへ戻る（ホバー背景）
    const retryHover = this.add.graphics()
    const retryBtn = this.add.text(cx, retryY, '登録せずにTOPへ戻る', {
      fontSize: fs(30), color: '#aaaaaa', fontStyle: 'bold',
    }).setOrigin(0.5)

    retryBtn.setInteractive({ useHandCursor: true })
    retryBtn.on('pointerdown', () => { this.fadeToScene('TitleScene') })
    retryBtn.on('pointerover', () => {
      retryBtn.setColor('#ffffff')
      retryHover.fillStyle(0x333333, 0.5)
      retryHover.fillRect(cx - groupW / 2, divY, groupW, g2Bot - divY)
    })
    retryBtn.on('pointerout', () => {
      retryBtn.setColor('#aaaaaa')
      retryHover.clear()
    })

    // ── ドッペルゲンガー確認モーダル ──
    // ランキング登録/戻るボタンより先に、生前のステータスのまま他プレイヤーの前に
    // モンスターとして復活することに同意するか確認する。答えるまで入力を止める。
    // 魂の行方（ドッペルゲンガー化／浄化）が確定した時点で墓標にも記録する。
    if (window.showDoppelgangerConfirm && this.doppelSnapshot) {
      this.input.enabled = false
      const snapshot = this.doppelSnapshot
      window.showDoppelgangerConfirm(
        () => {
          this.input.enabled = true
          void registerDeadCharacter(getDisplayName(), snapshot)
          void submitGraveyardEntry(getDisplayName(), this.floor, this.deathCause, 'doppelganger')
        },
        () => {
          this.input.enabled = true
          void submitGraveyardEntry(getDisplayName(), this.floor, this.deathCause, 'purified')
        },
      )
    } else {
      // 10F未満などドッペル対象外の死は、同意確認を挟まず「浄化」として墓標に記録する
      void submitGraveyardEntry(getDisplayName(), this.floor, this.deathCause, 'purified')
    }

    // 墓標一覧・全世界死亡総数（他プレイヤー含む共有データ）を読み込んで描画
    void Promise.all([fetchGraveyard(8), fetchTotalDeathCount()]).then(([rows, total]) => {
      this.graveyard = rows
      this.totalDeaths = total
      this.drawGraveyard(W, H, cx, fs, fsPx)
    })
  }

  /** 墓標（全プレイヤー共有の死亡記録）を画面下部に横スクロール無しの表として描画 */
  private drawGraveyard(W: number, H: number, cx: number, fs: (n: number) => string, fsPx: (n: number) => number) {
    const viewLeft  = W * 0.03
    const viewRight = W * 0.97
    const viewW     = viewRight - viewLeft

    // 列の中心 X（viewW に対する割合）。死因は他より広めに取る。
    const cDate  = viewLeft + viewW * 0.075
    const cName  = viewLeft + viewW * 0.235
    const cFloor = viewLeft + viewW * 0.395
    const cCause = viewLeft + viewW * 0.66
    const cSoul  = viewLeft + viewW * 0.925

    const totalY  = H * 0.833
    const titleY  = H * 0.850
    const headerY = H * 0.870
    const lineY   = H * 0.882
    const rowTop  = H * 0.894
    const rowGap  = H * 0.0152
    const maxRows = 6

    if (this.totalDeaths !== null) {
      this.add.text(cx, totalY, `☠ 全世界死亡総数：${this.totalDeaths.toLocaleString()}`, {
        fontSize: fs(13), color: '#e0a0a0', fontStyle: 'bold',
      }).setOrigin(0.5)
    }

    this.add.text(cx, titleY, '🪦 墓標', { fontSize: fs(15), color: '#c8b8a0', fontStyle: 'bold' }).setOrigin(0.5)

    if (this.graveyard.length === 0) return   // 未取得／記録なしの間は表だけ省略（タイトルのみ表示）

    const headerStyle = { fontSize: fs(10), color: '#6a7080' }
    this.add.text(cDate,  headerY, '日付',   headerStyle).setOrigin(0.5)
    this.add.text(cName,  headerY, '生前名', headerStyle).setOrigin(0.5)
    this.add.text(cFloor, headerY, '階層',   headerStyle).setOrigin(0.5)
    this.add.text(cCause, headerY, '死因',   headerStyle).setOrigin(0.5)
    this.add.text(cSoul,  headerY, '魂',     headerStyle).setOrigin(0.5)

    const line = this.add.graphics()
    line.lineStyle(Math.max(1, fsPx(1)), 0x33404f)
    line.lineBetween(viewLeft, lineY, viewRight, lineY)

    const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
    const fmtDate = (iso: string) => {
      const d = new Date(iso)
      const yy = String(d.getFullYear()).slice(2)
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${yy}/${mm}/${dd}`
    }

    this.graveyard.slice(0, maxRows).forEach((g, i) => {
      const y = rowTop + rowGap * i
      const rowStyle = { fontSize: fs(11), color: '#9aa4b5' }
      this.add.text(cDate,  y, fmtDate(g.created_at), rowStyle).setOrigin(0.5)
      this.add.text(cName,  y, trunc(g.player_name, 8), { ...rowStyle, color: '#dbe3ee' }).setOrigin(0.5)
      this.add.text(cFloor, y, `B${g.floor}F`, rowStyle).setOrigin(0.5)
      this.add.text(cCause, y, trunc(g.death_cause, 14), rowStyle).setOrigin(0.5)
      this.add.text(cSoul,  y, g.soul === 'doppelganger' ? '👻分身' : '🕊️浄化',
        { fontSize: fs(10), color: g.soul === 'doppelganger' ? '#c88fff' : '#8fd0ff' }).setOrigin(0.5)
    })
  }

  /** 名前入力テキストを playerName に合わせて更新 */
  private refreshNameInput() {
    if (this.playerName.length > 0) {
      this.nameInput.setText(`▶ ${this.playerName}_`)
      this.nameInput.setColor('#ffff00')
    } else {
      this.nameInput.setText(this.PLACEHOLDER)
      this.nameInput.setColor('#555577')
    }
  }

  /** 塗り＋枠の矩形を Graphics に描画（ホバー時の再描画に使う） */
  private drawBox(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number, fill: number, stroke: number) {
    g.clear()
    g.fillStyle(fill, 1)
    g.fillRect(cx - w / 2, cy - h / 2, w, h)
    g.lineStyle(2, stroke, 1)
    g.strokeRect(cx - w / 2, cy - h / 2, w, h)
  }

  private async registerRanking() {
    this.submitted = true
    this.nameInput.setText('登録中...')
    this.nameInput.setColor('#aaaaaa')
    setDisplayName(this.playerName)   // 次回以降の表示名としても保存
    const errMsg = await submitRanking(this.playerName, this.floor, this.level, this.refineTotal, this.jackpotWins)
    if (errMsg) {
      this.submitted = false
      this.refreshNameInput()
      const W = this.scale.width
      const H = this.scale.height
      const errText = this.add.text(W / 2, H * 0.55, `登録失敗: ${errMsg}`, {
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
    this.fadeToScene('RankingScene', { ranking, floor: this.floor, level: this.level, from: 'gameover' })
  }

  /** フェードアウトしてからシーン遷移する共通ヘルパー（RAF停止時もタイムアウトで遷移を保証） */
  private fadeToScene(key: string, data?: object) {
    if (this.leaving) return
    this.leaving = true
    fadeOutToScene(this, key, data)
  }
}
