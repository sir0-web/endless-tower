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
      // blur: クリック後にフォーカスが残るとSpaceキーがボタンのclickも発火させ、
      // キー側のgameAttackと合わせて1押しで2回攻撃（2ターン消費）になるのを防ぐ
      onClick={e => { e.stopPropagation(); e.currentTarget.blur(); window.gameAttack?.() }}
      onTouchStart={e => e.stopPropagation()}
      title="弓で攻撃（Spaceキーでも可）"
    >
      🏹
    </button>
  )
}
