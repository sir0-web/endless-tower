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

const BASE_W = 1280
const BASE_H = 800
const GAME_W = Math.floor(BASE_W * 0.65)  // 832

function calcScale() {
  return Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H, 1)
}

function App() {
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const gameRef       = useRef<Phaser.Game | null>(null)
  const [appScale, setAppScale] = useState(calcScale)

  // ウィンドウリサイズでスケール再計算 + Phaser canvas 更新
  useEffect(() => {
    const onResize = () => {
      setAppScale(calcScale())
      gameRef.current?.scale.resize(GAME_W, BASE_H)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Phaser 初期化
  useEffect(() => {
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: canvasAreaRef.current!,
      backgroundColor: '#000000',
      scene: [TitleScene, GameScene, GameOverScene, RankingScene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: GAME_W,
        height: BASE_H,
      },
    }
    gameRef.current = new Phaser.Game(config)
    return () => { gameRef.current?.destroy(true); gameRef.current = null }
  }, [])

  return (
    // 全体を BASE_W × BASE_H で固定し、ウィンドウに合わせて縮小
    <div style={{
      width:  BASE_W,
      height: BASE_H,
      transform: `scale(${appScale})`,
      transformOrigin: 'top left',
      overflow: 'hidden',
      position: 'absolute',
      top: 0,
      left: 0,
    }}>
      <div className="app-layout">
        <div className="game-pane">
          <MobileStatusBar />
          <div className="game-canvas-area" ref={canvasAreaRef} />
        </div>
        <div className="ui-pane">
          <UIPanel />
        </div>
        <EquipModal />
        <VirtualJoystick />
        <SlotAnnouncement />
      </div>
    </div>
  )
}

export default App
