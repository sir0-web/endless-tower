import { useEffect, useRef, useState } from 'react'
import Phaser from 'phaser'
import { TitleScene } from './scenes/TitleScene'
import { GameScene } from './scenes/GameScene'
import { GameOverScene } from './scenes/GameOverScene'
import { RankingScene } from './scenes/RankingScene'
import { UIPanel } from './components/UIPanel'
import { EquipModal } from './components/EquipModal'
import { VirtualJoystick } from './components/VirtualJoystick'
import { MobileStatusBar } from './components/MobileStatusBar'
import { SlotAnnouncement } from './components/SlotAnnouncement'
import { RefineModal, ShadowEquipModal, SpellbookModal } from './components/EventFacilityModals'
import { ScrollLockButton } from './components/ScrollLockButton'
import { GameToast } from './components/GameToast'
import { EventMsgBar } from './components/EventMsgBar'
import { WorldTelop } from './components/WorldTelop'
import { WorldLog } from './components/WorldLog'
import { HowToPlay } from './components/HowToPlay'
import { ArcanaRoulette } from './components/ArcanaRoulette'
import { ReportModal } from './components/ReportModal'
import { Analytics } from '@vercel/analytics/react'

const BASE_W = 1280
const BASE_H = 880   // 全体の縦サイズ：少し伸ばし
const GAME_H = BASE_H   // ゲーム画面も全体に合わせて伸ばす
const GAME_W = Math.floor(BASE_W * 0.65)  // 832
const PC_GAME_ZOOM = 0.8   // PC: マップcanvasの表示倍率（下部のEventMsgウィンドウと被らないよう縮小）

function calcScale() {
  return Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H)
}

function isMobileViewport() {
  return window.innerWidth < 768
}

function App() {
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const gameRef       = useRef<Phaser.Game | null>(null)
  const [appScale, setAppScale] = useState(calcScale)
  const [isMobile, setIsMobile] = useState(isMobileViewport)
  // キャンバス全幅化フラグ（スマホ）。ステータスバー/メッセージ枠が不要な非プレイ画面
  // （タイトル・ゲームオーバー・ランキング）でキャンバスを画面いっぱいに拡大する。初期はタイトルなので true。
  const [fullCanvas, setFullCanvas] = useState(true)
  const [scrollLock, setScrollLock] = useState(false)

  // ウィンドウリサイズでスケール再計算 + Phaser canvas 更新
  useEffect(() => {
    const onResize = () => {
      const mobile = isMobileViewport()
      setIsMobile(mobile)
      setAppScale(calcScale())
      const sm = gameRef.current?.scale
      if (sm) {
        // PC=NONE（等倍／外側transformで拡縮） / スマホ=FIT（実DOMに合わせる）
        sm.scaleMode  = mobile ? Phaser.Scale.FIT : Phaser.Scale.NONE
        sm.autoCenter = mobile ? Phaser.Scale.CENTER_BOTH : Phaser.Scale.CENTER_HORIZONTALLY
        sm.setZoom(mobile ? 1 : PC_GAME_ZOOM)
        sm.setGameSize(GAME_W, GAME_H)
        sm.refresh()
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Phaser 初期化
  useEffect(() => {
    const mobile = isMobileViewport()
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: canvasAreaRef.current!,
      backgroundColor: '#000000',
      scene: [TitleScene, GameScene, GameOverScene, RankingScene],
      scale: {
        // PC: 外側ラッパーの transform:scale が全体を拡縮するため、Phaserは等倍(NONE)の
        //     固定サイズで描画する。FITだと transform後に縮んだ親サイズを測って二重スケールし、
        //     大画面でマップだけ肥大化してEventMsgBarと被り、ブラウザズームで反転する不具合になる。
        // スマホ: transformを掛けないので、実DOMサイズへ合わせるFITが正しい。
        mode: mobile ? Phaser.Scale.FIT : Phaser.Scale.NONE,
        autoCenter: mobile ? Phaser.Scale.CENTER_BOTH : Phaser.Scale.CENTER_HORIZONTALLY,
        zoom: mobile ? 1 : PC_GAME_ZOOM,   // PCは縮小して上寄せ（下部にEMBの余白を確保）
        width: GAME_W,
        height: GAME_H,
      },
    }
    gameRef.current = new Phaser.Game(config)

    // 初期レイアウト確定後にスケールを再計算し、コンテナとのズレ（隙間）を解消する
    requestAnimationFrame(() => { gameRef.current?.scale.refresh() })

    // game-canvas-area のサイズが変わったとき（ステータスバー出現/消滅など）スケールを再計算
    const obs = new ResizeObserver(() => { gameRef.current?.scale.refresh() })
    if (canvasAreaRef.current) obs.observe(canvasAreaRef.current)

    return () => { obs.disconnect(); gameRef.current?.destroy(true); gameRef.current = null }
  }, [])

  // appScale 変更後（React re-render → CSS transform 適用後）に Phaser の入力座標を再同期する。
  // CSS transform は layout size を変えないため Phaser の内部ループでは検知されず canvasBounds が
  // 古いままになる。ブラウザのズーム変更などで appScale が変わるたびに RAF で更新する。
  useEffect(() => {
    if (!gameRef.current) return
    requestAnimationFrame(() => { gameRef.current?.scale.refresh() })
  }, [appScale])

  // 非プレイ画面ではキャンバス枠を全幅化する（スマホ）。各 Phaser シーンの create からの通知で切り替える。
  useEffect(() => {
    const full = () => setFullCanvas(true)
    const play = () => setFullCanvas(false)
    window.addEventListener('et-canvas-full', full)
    window.addEventListener('et-canvas-play', play)
    return () => {
      window.removeEventListener('et-canvas-full', full)
      window.removeEventListener('et-canvas-play', play)
    }
  }, [])

  // 全幅化の切替でキャンバス枠サイズが変わるため、Phaser の FIT スケールを再計算する。
  useEffect(() => {
    if (!gameRef.current) return
    requestAnimationFrame(() => { gameRef.current?.scale.refresh() })
  }, [fullCanvas])

  // スクロールロック状態の監視（報告ボタンの有効/無効切替のため）
  useEffect(() => {
    const onChange = (e: Event) => {
      setScrollLock((e as CustomEvent<{ enabled: boolean }>).detail.enabled)
    }
    window.addEventListener('scroll-lock-change', onChange)
    return () => window.removeEventListener('scroll-lock-change', onChange)
  }, [])

  // スマホ: 通常レスポンシブ / PC: 固定サイズ＋スケール縮小
  const wrapperStyle = isMobile
    ? { width: '100%', height: '100%' } as const
    : {
        width:  BASE_W,
        height: BASE_H,
        transform: `scale(${appScale})`,
        transformOrigin: 'top left',
        overflow: 'hidden',
        position: 'absolute' as const,
        top: 0,
        left: 0,
      }

  return (
    <>
    <div style={wrapperStyle}>
      <div className={`app-layout${fullCanvas ? ' canvas-full' : ''}`}>
        <div className="game-pane">
          <MobileStatusBar />
          <div className="game-canvas-area" ref={canvasAreaRef}>
            <ScrollLockButton />
            {!fullCanvas && (
              <button
                className="report-float-btn"
                data-priority-tap
                onClick={e => { e.stopPropagation(); window.showReport?.() }}
                onTouchStart={e => e.stopPropagation()}
                style={scrollLock ? { opacity: 0.35, pointerEvents: 'none' } : undefined}
                tabIndex={scrollLock ? -1 : undefined}
                title="報告・お問い合わせ"
              >
                📬
              </button>
            )}
          </div>
          <EventMsgBar />
        </div>
        <div className="ui-pane">
          <UIPanel />
        </div>
        <EquipModal />
        <VirtualJoystick />
        <SlotAnnouncement />
        <RefineModal />
        <ShadowEquipModal />
        <SpellbookModal />
        <GameToast />
      </div>
    </div>
    <WorldTelop />
    <WorldLog />
    <HowToPlay />
    <ArcanaRoulette />
    <ReportModal />
    <Analytics />
    </>
  )
}

export default App
