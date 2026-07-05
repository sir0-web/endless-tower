import Phaser from 'phaser'
import { floorLabel } from '../game/utils'
import { playBGM } from '../game/sound'
import { fadeOutToScene } from '../game/phaserRecovery'

interface RankingEntry {
  player_name: string
  floor: number
  level: number
  created_at: string
  refine_total?: number   // 全身の精錬値合計（DBに新カラム未追加の旧データでは undefined）
  jackpot_wins?: number    // そのプレイでのジャックポット当選回数
}

export class RankingScene extends Phaser.Scene {
  private ranking: RankingEntry[] = []
  private floor: number = 1
  private level: number = 1
  private from: 'title' | 'gameover' = 'gameover'
  private leaving = false   // シーン遷移開始済みフラグ（二重遷移防止）

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
    this.leaving = false   // シーンは再利用されるため入場のたびにリセット
    // スマホ: キャンバスを全幅化（非プレイ画面）。ゲームオーバー⇄ランキングでサイズが揃う
    window.dispatchEvent(new Event('et-canvas-full'))
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2
    const clamp = Phaser.Math.Clamp

    // 入場フェードイン
    this.cameras.main.fadeIn(450, 0, 0, 0)

    // フォントサイズをキャンバスサイズに合わせてスケール
    const sc = Math.min(W / 800, H / 700)
    const fs = (base: number) => `${Math.max(10, Math.round(base * sc))}px`
    const px = (base: number) => Math.round(base * sc)

    // 背景（中央に向けてわずかに明るくするビネット風）
    this.add.rectangle(cx, H / 2, W, H, 0x05070b)
    const glow = this.add.graphics()
    glow.fillStyle(0x123040, 0.35)
    glow.fillEllipse(cx, H * 0.42, W * 1.1, H * 0.7)

    // タイトル
    this.add.text(cx, H * 0.06, '🏆 ランキング TOP30', {
      fontSize: fs(34), color: '#ffd700', fontStyle: 'bold',
    }).setOrigin(0.5).setShadow(0, px(2), '#000000', px(4), true, true)

    if (this.floor > 0) {
      this.add.text(cx, H * 0.125, `あなたの記録：${floorLabel(this.floor)}　Lv ${this.level}`, {
        fontSize: fs(17), color: '#9affc8',
      }).setOrigin(0.5)
    }

    // ── 表示領域（スクロール窓）の定義 ──
    const viewLeft   = W * 0.03
    const viewRight  = W * 0.955
    const viewW      = viewRight - viewLeft
    const listTop    = H * 0.225
    const listBottom = H * 0.835
    const viewH      = listBottom - listTop

    // 列の中心 X（viewW に対する割合）
    const cRank  = viewLeft + viewW * 0.085
    const cName  = viewLeft + viewW * 0.18
    const cFloor = viewLeft + viewW * 0.68
    const cLevel = viewLeft + viewW * 0.93

    // ヘッダー行
    const headerY = H * 0.19
    const headerStyle = { fontSize: fs(14), color: '#7a8aa0' }
    this.add.text(cRank,  headerY, '順位',   headerStyle).setOrigin(0.5)
    this.add.text(cName,  headerY, '名前',   headerStyle).setOrigin(0, 0.5)
    this.add.text(cFloor, headerY, '到達階', headerStyle).setOrigin(0.5)
    this.add.text(cLevel, headerY, 'Lv',     headerStyle).setOrigin(0.5)
    const lineY = headerY + px(14)
    const line = this.add.graphics()
    line.lineStyle(1, 0x33404f)
    line.lineBetween(viewLeft, lineY, viewRight, lineY)

    const count = this.ranking.length
    if (count === 0) {
      this.add.text(cx, H * 0.52, 'まだ記録がありません', {
        fontSize: fs(18), color: '#aaaaaa',
      }).setOrigin(0.5)
      this.addBackButton(W, H, fs, px)
      return
    }

    // ── スクロールするコンテナ（中身はローカル座標 0 起点） ──
    const container = this.add.container(0, listTop)

    // 順位ごとの見た目（上位ほど大きく豪華に、下位は徐々に控えめに）
    const rankMult = (i: number) =>
      i === 0 ? 1.55 : i === 1 ? 1.34 : i === 2 ? 1.18 : Math.max(0.80, 1.02 - (i - 3) * 0.011)

    const tier = (i: number) => {
      if (i === 0) return { bg: 0x3a2e00, border: 0xffd700, name: '#ffe98a', rank: '#ffd700' }
      if (i === 1) return { bg: 0x2a2a34, border: 0xd2d6e2, name: '#eef0f8', rank: '#d2d6e2' }
      if (i === 2) return { bg: 0x331f0d, border: 0xd0894a, name: '#f3c89a', rank: '#d0894a' }
      const even = i % 2 === 0
      return { bg: even ? 0x131923 : 0x0e131b, border: 0x2b3543, name: '#dbe3ee', rank: '#8b97a6' }
    }

    const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

    const baseH   = Math.max(38, px(52))   // 精錬値/JPのサブ行ぶん少し高め
    const gap     = px(7)
    const radius  = px(10)
    const rowMid: number[] = []
    let cursorY = px(6)
    let youIndex = -1

    this.ranking.forEach((entry, i) => {
      const m     = rankMult(i)
      const cardH = Math.round(baseH * m)
      const top   = cursorY
      const midY  = top + cardH / 2
      rowMid[i]   = midY
      const t     = tier(i)
      const isTop = i < 3
      // 自分の記録（到達階・Lv 一致）をハイライト
      const isYou = youIndex < 0 && this.floor > 0 && entry.floor === this.floor && (entry.level ?? -1) === this.level
      if (isYou) youIndex = i

      // カード背景
      const g = this.add.graphics()
      g.fillStyle(t.bg, isTop ? 0.95 : 0.7)
      g.fillRoundedRect(viewLeft, top, viewW, cardH, radius)
      g.lineStyle(px(isYou ? 3 : isTop ? 2.5 : 1), isYou ? 0x00ff88 : t.border, isYou ? 1 : isTop ? 0.95 : 0.5)
      g.strokeRoundedRect(viewLeft, top, viewW, cardH, radius)
      // 左端のアクセントバー
      g.fillStyle(isYou ? 0x00ff88 : t.border, isTop || isYou ? 1 : 0.6)
      g.fillRoundedRect(viewLeft, top, px(5), cardH, { tl: radius, bl: radius, tr: 0, br: 0 })
      container.add(g)

      // 順位 / メダル
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
      if (medal) {
        container.add(this.add.text(cRank, midY, medal, { fontSize: `${px(26 * m)}px` }).setOrigin(0.5))
      } else {
        container.add(this.add.text(cRank, midY, `${i + 1}`, {
          fontSize: `${px(18 * m)}px`, color: t.rank, fontStyle: 'bold',
        }).setOrigin(0.5))
      }

      // 精錬値合計・ジャックポット当選回数（あれば名前の下に小さく表示。旧データは非表示）
      const refine = entry.refine_total ?? 0
      const jpWins = entry.jackpot_wins ?? 0
      const subParts: string[] = []
      if (refine > 0) subParts.push(`🔨精錬+${refine}`)
      if (jpWins > 0) subParts.push(`💰JP${jpWins}回`)
      const hasSub = subParts.length > 0

      // 名前（サブ行がある時は少し上に寄せて2段組みにする）
      const nameY = midY - (hasSub ? px(8) : 0)
      const nameT = this.add.text(cName, nameY, trunc(entry.player_name ?? '', isTop ? 12 : 10), {
        fontSize: `${px((isTop ? 21 : 16) * (isTop ? 1 : m))}px`, color: t.name, fontStyle: isTop ? 'bold' : 'normal',
      }).setOrigin(0, 0.5)
      container.add(nameT)
      if (isYou) {
        container.add(this.add.text(nameT.x + nameT.width + px(6), nameY, 'YOU', {
          fontSize: `${px(11)}px`, color: '#00ff88', fontStyle: 'bold',
          backgroundColor: '#003a22', padding: { x: px(4), y: px(2) },
        }).setOrigin(0, 0.5))
      }
      if (hasSub) {
        container.add(this.add.text(cName, midY + px(9), subParts.join('  '), {
          fontSize: `${px(isTop ? 13 : 11)}px`, color: '#8fa6c4',
        }).setOrigin(0, 0.5))
      }

      // 到達階：数字部分だけ大きく＆鮮やかに、B / F の単位は小さく
      const floorColor = isTop ? '#aef6ff' : '#5fd8ff'
      const numT = this.add.text(cFloor, midY, `${entry.floor}`, {
        fontSize: `${px((isTop ? 30 : 20) * m)}px`, color: floorColor, fontStyle: 'bold',
      }).setOrigin(0.5).setShadow(0, px(1), '#000814', px(3), false, true)
      container.add(numT)
      const unitFs = `${px((isTop ? 13 : 11) * m)}px`
      const unitY  = midY + numT.height * 0.18
      container.add(this.add.text(numT.x - numT.width / 2 - px(2), unitY, 'B', {
        fontSize: unitFs, color: '#65788c',
      }).setOrigin(1, 0.5))
      container.add(this.add.text(numT.x + numT.width / 2 + px(2), unitY, 'F', {
        fontSize: unitFs, color: '#65788c',
      }).setOrigin(0, 0.5))

      // Lv
      container.add(this.add.text(cLevel, midY, `${entry.level ?? '─'}`, {
        fontSize: `${px((isTop ? 18 : 14) * m)}px`, color: isTop ? t.name : '#aab6c4',
      }).setOrigin(0.5))

      cursorY += cardH + gap
    })

    const contentHeight = cursorY + px(6)

    // ── スクロール窓のマスク ──
    const maskG = this.make.graphics({ x: 0, y: 0 })
    maskG.fillStyle(0xffffff)
    maskG.fillRect(viewLeft - px(4), listTop, viewW + px(8), viewH)
    container.setMask(maskG.createGeometryMask())

    // ── スクロール制御 ──
    const maxScroll = Math.max(0, contentHeight - viewH)
    const maxY = listTop
    const minY = listTop - maxScroll

    if (maxScroll > 0) {
      // スクロールバー
      const sbX = W * 0.978
      const sbW = px(4)
      this.add.rectangle(sbX, listTop + viewH / 2, sbW, viewH, 0xffffff, 0.06).setOrigin(0.5)
      const thumbH = Math.max(px(28), viewH * (viewH / contentHeight))
      const thumb = this.add.rectangle(sbX, listTop, sbW, thumbH, 0x66ccff, 0.55).setOrigin(0.5, 0)
      const positionThumb = () => {
        const frac = (maxY - container.y) / maxScroll
        thumb.y = listTop + frac * (viewH - thumbH)
      }

      // ホイール / ドラッグでスクロール
      this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        container.y = clamp(container.y - dy, minY, maxY)
        positionThumb()
      })
      const zone = this.add.zone(viewLeft, listTop, viewW, viewH).setOrigin(0, 0).setInteractive()
      let dragging = false, startPY = 0, startCY = 0
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => { dragging = true; startPY = p.y; startCY = container.y })
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!dragging) return
        container.y = clamp(startCY + (p.y - startPY), minY, maxY)
        positionThumb()
      })
      this.input.on('pointerup', () => { dragging = false })

      // 自分の記録が窓外なら、その行が見えるよう初期スクロール位置を調整
      if (youIndex >= 0) {
        const target = clamp(listTop + viewH / 2 - rowMid[youIndex], minY, maxY)
        container.y = target
        positionThumb()
      }
    }

    this.addBackButton(W, H, fs, px)
  }

  private addBackButton(W: number, H: number, fs: (b: number) => string, px: (b: number) => number) {
    const btnLabel = this.from === 'title' ? 'もどる' : 'もう一度挑戦する'
    const btn = this.add.text(W / 2, H * 0.925, btnLabel, {
      fontSize: fs(22), color: '#00ff88',
      backgroundColor: '#003322', padding: { x: px(20), y: px(10) },
    }).setOrigin(0.5)

    btn.setInteractive({ useHandCursor: true })
    btn.on('pointerdown', () => {
      if (this.leaving) return
      this.leaving = true
      // RAF停止時もタイムアウトで遷移を保証する共通ヘルパー
      fadeOutToScene(this, 'TitleScene')
    })
    btn.on('pointerover', () => { btn.setColor('#ffffff') })
    btn.on('pointerout',  () => { btn.setColor('#00ff88') })
  }
}
