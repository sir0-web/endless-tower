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

const BASE_W = 1280
const BASE_H = 880   // 全体の縦サイズ：少し伸ばし
const GAME_H = BASE_H   // ゲーム画面も全体に合わせて伸ばす
const GAME_W = Math.floor(BASE_W * 0.65)  // 832

function calcScale() {
  return Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H)
}

function isMobileViewport() {
  return window.innerWidth < 768
}

// タイトル時のPhaser解像度
const TITLE_W = BASE_W
const TITLE_H = BASE_H

function getTitleCanvasDims(isTitle: boolean): [number, number] {
  if (!isTitle) return [GAME_W, GAME_H]
  if (isMobileViewport()) return [window.innerWidth, window.innerHeight]
  return [TITLE_W, TITLE_H]
}

function App() {
  const canvasAreaRef  = useRef<HTMLDivElement>(null)
  const gameRef        = useRef<Phaser.Game | null>(null)
  const currentScene   = useRef<string>('title')
  const [appScale, setAppScale]   = useState(calcScale)
  const [isMobile, setIsMobile]   = useState(isMobileViewport)
  const [isTitleMode, setIsTitleMode] = useState(true)

  // ウィンドウリサイズでスケール再計算 + Phaser canvas 更新
  useEffect(() => {
    const onResize = () => {
      setIsMobile(isMobileViewport())
      setAppScale(calcScale())
      const isTitle = currentScene.current === 'title'
      const [w, h] = getTitleCanvasDims(isTitle)
      gameRef.current?.scale.resize(w, h)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // シーン変更ブリッジ
  useEffect(() => {
    window.onSceneChange = (scene) => {
      currentScene.current = scene
      const isTitle = scene === 'title'
      setIsTitleMode(isTitle)
      const [w, h] = getTitleCanvasDims(isTitle)
      gameRef.current?.scale.resize(w, h)
      requestAnimationFrame(() => { gameRef.current?.scale.refresh() })
    }
    return () => { window.onSceneChange = undefined }
  }, [])

  // Phaser 初期化（最初のシーンはTitleSceneなのでTITLE_W×TITLE_Hで初期化）
  useEffect(() => {
    const initW = isMobileViewport() ? window.innerWidth  : TITLE_W
    const initH = isMobileViewport() ? window.innerHeight : TITLE_H
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: canvasAreaRef.current!,
      backgroundColor: '#000000',
      scene: [TitleScene, GameScene, GameOverScene, RankingScene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: initW,
        height: initH,
      },
    }
    gameRef.current = new Phaser.Game(config)

    requestAnimationFrame(() => { gameRef.current?.scale.refresh() })

    const obs = new ResizeObserver(() => { gameRef.current?.scale.refresh() })
    if (canvasAreaRef.current) obs.observe(canvasAreaRef.current)

    return () => { obs.disconnect(); gameRef.current?.destroy(true); gameRef.current = null }
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
    <div style={wrapperStyle}>
      <div className={`app-layout${isTitleMode ? ' title-mode' : ''}`}>
        <div className="game-pane">
          <MobileStatusBar />
          <div className="game-canvas-area" ref={canvasAreaRef}>
            <ScrollLockButton />
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
  )
}

export default App
