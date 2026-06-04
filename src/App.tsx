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

const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

function isMobilePortrait() {
  return isMobileDevice && window.innerHeight > window.innerWidth
}

/** スマホ横画面（縦幅が小さい）かどうか */
function isSmallLandscape() {
  return isMobileDevice && window.innerWidth > window.innerHeight && window.innerHeight <= 500
}

function calcGameSize() {
  const STATUS_BAR_H = 72

  if (!isMobileDevice || window.innerWidth >= 1024) {
    // PC・大型タブレット：左右並び
    return {
      width:  Math.floor(window.innerWidth * 0.65),
      height: window.innerHeight - STATUS_BAR_H,
      layout: 'pc' as const,
    }
  }
  if (isSmallLandscape()) {
    // スマホ横画面：縦積み、ゲーム60%高さ（ステータスバーはオーバーレイ）
    return {
      width:  window.innerWidth,
      height: Math.floor(window.innerHeight * 0.60),
      layout: 'mobileLandscape' as const,
    }
  }
  // スマホ縦画面（portrait guard で通常到達しない）
  return {
    width:  window.innerWidth,
    height: Math.floor(window.innerHeight * 0.55) - STATUS_BAR_H,
    layout: 'mobilePortrait' as const,
  }
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
    if (portrait) return
    const { width, height } = calcGameSize()

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width,
      height,
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
