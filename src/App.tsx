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
import { RefineModal, ShadowEquipModal, SpellbookModal, MerchantModal } from './components/EventFacilityModals'
import { ScrollLockButton } from './components/ScrollLockButton'
import { BowAttackButton } from './components/BowAttackButton'
import { GameToast } from './components/GameToast'
import { AutoSaveToast } from './components/AutoSaveToast'
import { MailBox } from './components/MailBox'
import { EventMsgBar } from './components/EventMsgBar'
import { WorldTelop } from './components/WorldTelop'
import { WorldLog } from './components/WorldLog'
import { HowToPlay } from './components/HowToPlay'
import { ArcanaRoulette } from './components/ArcanaRoulette'
import { ReportModal } from './components/ReportModal'
import { NewsModal } from './components/NewsModal'
import { AnnouncementGateModal } from './components/AnnouncementGateModal'
import { SkulporinReward } from './components/SkulporinReward'
import { applyOverrides } from './game/overrides'
import { releaseStuckPointers } from './game/phaserRecovery'
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

  // Phaser 初期化（ADMIN編集の上書きを反映してから起動する）
  useEffect(() => {
    let cancelled = false
    let obs: ResizeObserver | null = null
    let cleanupRecovery: (() => void) | null = null
    void (async () => {
      // データベース編集の公開分をハードコード表へマージ（失敗してもデフォルトで続行）
      await applyOverrides()
      if (cancelled) return

      const mobile = isMobileViewport()
      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: canvasAreaRef.current!,
        backgroundColor: '#000000',
        scene: [TitleScene, GameScene, GameOverScene, RankingScene],
        // タッチポインタを複数確保する。既定は1本のため、prompt等で touchend が
        // 飲まれてポインタが1本スタックしただけで全タップが死んでいた。予備を持たせる。
        input: { activePointers: 3 },
        // ── スマホ発熱対策 ──
        // ターン制のため高リフレッシュは不要。無制限だと120Hz端末で毎秒120回フル描画され
        // 端末が発熱する。40fpsならtween/フェードの滑らかさはほぼ維持される。PCは無制限のまま。
        ...(mobile ? { fps: { limit: 40 } } : {}),
        // GPUに省電力動作をヒント（ブラウザ実装依存。効かない環境でも無害）。スマホのみ。
        ...(mobile ? { render: { powerPreference: 'low-power' } } : {}),
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

      // 開発時のみ: コンソール/E2Eテストからシーンを直接操作できるように公開
      if (import.meta.env.DEV) {
        ;(window as unknown as { __game?: Phaser.Game }).__game = gameRef.current
      }

      // 初期レイアウト確定後にスケールを再計算し、コンテナとのズレ（隙間）を解消する
      requestAnimationFrame(() => { gameRef.current?.scale.refresh() })

      // game-canvas-area のサイズが変わったとき（ステータスバー出現/消滅など）スケールを再計算
      obs = new ResizeObserver(() => { gameRef.current?.scale.refresh() })
      if (canvasAreaRef.current) obs.observe(canvasAreaRef.current)

      // ── バックグラウンド復帰時の自己修復 ──
      // 「GAME OVER画面などでボタンが一切押せなくなる」報告への対策：
      //  1. prompt等で touchend が飲まれて押しっぱなしになったタッチポインタを解放
      //  2. タップ座標の基準（canvasBounds）を再計算
      //  3. 復帰後に RAF が再開しない既知のブラウザ問題を検出し、ループを強制再始動
      const onVisible = () => {
        if (document.hidden) return
        const game = gameRef.current
        if (!game) return
        releaseStuckPointers(game.input)
        game.scale.refresh()
        const frameBefore = game.loop.frame
        window.setTimeout(() => {
          const g = gameRef.current
          if (!g || document.hidden) return
          if (g.loop.frame === frameBefore) {
            // 表示状態なのにフレームが1つも進んでいない → RAF停止と判断して再始動
            g.loop.sleep()
            g.loop.wake(true)
          }
        }, 800)
      }
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('pageshow', onVisible)   // bfcache復元でも同じ復旧を走らせる

      // iframe埋め込み（arcana-guild-site経由のアクセス）ではホストページ側の要素を
      // 操作しただけで document.hidden は変わらないまま window の blur/focus だけが
      // 発生しうる。その場合上のonVisibleが一切発火せず、押しっぱなしポインタが
      // 解放されないままになる。blur/focusにも同じ復旧を繋いでおく。
      const onBlur = () => {
        const game = gameRef.current
        if (!game) return
        releaseStuckPointers(game.input)   // フォーカスが離れる瞬間に即解放（touchend取りこぼし対策）
      }
      window.addEventListener('blur', onBlur)
      window.addEventListener('focus', onVisible)

      // 最後の保険: 原因を問わず、次にユーザーがタップした瞬間に必ずポインタを
      // 解放しておく（capture段階でPhaser本体の処理より先に実行）。
      // これにより「一度バックグラウンドへ回して戻す」往復をしなくても、
      // 気づいた時点の1タップ目で自己修復するようになる。
      const onPointerDownCapture = () => {
        const game = gameRef.current
        if (game) releaseStuckPointers(game.input)
      }
      document.addEventListener('pointerdown', onPointerDownCapture, { capture: true, passive: true })
      document.addEventListener('touchstart', onPointerDownCapture, { capture: true, passive: true })

      // visualViewport の変化（アドレスバー収納・キーボード開閉・ページスクロール）でも
      // タップ座標の基準を再同期する（スクロール中の連発を避けるデバウンス付き）
      let vvTimer: number | undefined
      const onVVChange = () => {
        window.clearTimeout(vvTimer)
        vvTimer = window.setTimeout(() => gameRef.current?.scale.refresh(), 200)
      }
      window.visualViewport?.addEventListener('resize', onVVChange)
      window.visualViewport?.addEventListener('scroll', onVVChange)

      cleanupRecovery = () => {
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('pageshow', onVisible)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('focus', onVisible)
        document.removeEventListener('pointerdown', onPointerDownCapture, { capture: true })
        document.removeEventListener('touchstart', onPointerDownCapture, { capture: true })
        window.visualViewport?.removeEventListener('resize', onVVChange)
        window.visualViewport?.removeEventListener('scroll', onVVChange)
        window.clearTimeout(vvTimer)
      }
    })()

    return () => { cancelled = true; obs?.disconnect(); cleanupRecovery?.(); gameRef.current?.destroy(true); gameRef.current = null }
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

  // クリックしたボタンにはブラウザ仕様でフォーカスが残り、以後スペースキーを押すたびに
  // 「スペース＝フォーカス中のボタン押下」の標準動作で誤発動する
  // （例：🔊ミュートを一度クリック→スペースで弓を撃つたびにサウンドがON/OFFされる報告）。
  // クリック直後にフォーカスを外して、スペースは常に弓の発射だけになるようにする。
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('button')
      if (btn instanceof HTMLButtonElement) btn.blur()
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

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
            <AutoSaveToast />
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
            {/* 弓の攻撃ボタン：非プレイ画面（タイトル・GAME OVER・ランキング）では
                window.gameStateに弓装備が残っていても表示しない */}
            {!fullCanvas && <BowAttackButton />}
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
        <MerchantModal />
        <NewsModal />
        <AnnouncementGateModal />
        <GameToast />
      </div>
    </div>
    <WorldTelop />
    <WorldLog />
    <MailBox />
    <HowToPlay />
    <ArcanaRoulette />
    <SkulporinReward />
    <ReportModal />
    <Analytics />
    </>
  )
}

export default App
