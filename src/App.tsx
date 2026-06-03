import { useEffect, useRef } from 'react'
import Phaser from 'phaser'
import { TestScene } from './scenes/TestScene'
import { TitleScene } from './scenes/TitleScene'
import { GameScene } from './scenes/GameScene'
import { GameOverScene } from './scenes/GameOverScene'
import { RankingScene } from './scenes/RankingScene'
import { UIPanel } from './components/UIPanel'
import { StatModal } from './components/StatModal'
import { EquipModal } from './components/EquipModal'

function App() {
  const gameContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const isPC = window.innerWidth >= 768
    const gameWidth = isPC
      ? Math.floor(window.innerWidth * 0.65)
      : window.innerWidth
    const gameHeight = isPC
      ? window.innerHeight
      : Math.floor(window.innerHeight * 0.55)

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: gameWidth,
      height: gameHeight,
      parent: gameContainerRef.current!,
      backgroundColor: '#000000',
      // TestScene を先頭に置いて素材確認モードで起動
      scene: [TestScene, TitleScene, GameScene, GameOverScene, RankingScene],
    }

    const game = new Phaser.Game(config)
    return () => game.destroy(true)
  }, [])

  return (
    <div className="app-layout">
      <div className="game-pane" ref={gameContainerRef} />
      <div className="ui-pane">
        <UIPanel />
      </div>
      <StatModal />
      <EquipModal />
    </div>
  )
}

export default App
