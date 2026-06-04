import { useEffect, useRef } from 'react'
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

function App() {
  const canvasAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = canvasAreaRef.current!
    // キャンバスエリアの実サイズに合わせる（ステータスバーを除いた高さ）
    const w = el.offsetWidth
    const h = el.offsetHeight

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: el,
      backgroundColor: '#000000',
      scene: [TitleScene, GameScene, GameOverScene, RankingScene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: w || Math.floor(window.innerWidth * 0.65),
        height: h || window.innerHeight,
      },
    }

    const game = new Phaser.Game(config)
    return () => game.destroy(true)
  }, [])

  return (
    <div className="app-layout">
      {/* ゲームペイン：ステータスバー（上）＋キャンバスエリア（残り）を縦積み */}
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
  )
}

export default App
