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

function isMobilePortrait() {
  const mobile = window.innerWidth < 1024 && 'ontouchstart' in window
  return mobile && window.innerHeight > window.innerWidth
}

function App() {
  const gameContainerRef = useRef<HTMLDivElement>(null)
  const [portrait, setPortrait] = useState(isMobilePortrait)

  useEffect(() => {
    const check = () => setPortrait(isMobilePortrait())
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
    return () => {
      window.removeEventListener('resize', check)
      window.removeEventListener('orientationchange', check)
    }
  }, [])

  useEffect(() => {
    if (portrait) return  // portrait中はPhaser起動しない
    const isPC = window.innerWidth >= 768
    const STATUS_BAR_H = 72
    const gameWidth = isPC
      ? Math.floor(window.innerWidth * 0.65)
      : window.innerWidth
    const gameHeight = isPC
      ? window.innerHeight - STATUS_BAR_H
      : Math.floor(window.innerHeight * 0.55) - STATUS_BAR_H

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: gameWidth,
      height: gameHeight,
      parent: gameContainerRef.current!,
      backgroundColor: '#000000',
      scene: [TitleScene, GameScene, GameOverScene, RankingScene],
    }

    const game = new Phaser.Game(config)
    return () => game.destroy(true)
  }, [portrait])

  if (portrait) {
    return (
      <div className="portrait-overlay">
        <div className="portrait-message">
          <div className="portrait-icon">📱</div>
          <p>横画面にしてください</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout">
      <div className="game-pane" ref={gameContainerRef} />
      <div className="ui-pane">
        <UIPanel />
      </div>
      <EquipModal />
      <VirtualJoystick />
      <MobileStatusBar />
      <SlotAnnouncement />
    </div>
  )
}

export default App
