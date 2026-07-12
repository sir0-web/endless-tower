import { useEffect, useState } from 'react'
import { weaponKindOf } from '../types'

export function BowAttackButton() {
  const [isBow, setIsBow] = useState(false)

  useEffect(() => {
    const update = () => {
      if (window.gameState) setIsBow(weaponKindOf(window.gameState.equipment.weapon) === 'bow')
    }
    update()
    window.addEventListener('gamestate-update', update)
    return () => window.removeEventListener('gamestate-update', update)
  }, [])

  if (!isBow) return null

  return (
    <button
      className="bow-attack-btn"
      data-priority-tap
      onClick={e => { e.stopPropagation(); window.gameAttack?.() }}
      onTouchStart={e => e.stopPropagation()}
      title="弓で攻撃"
    >
      🏹
    </button>
  )
}
