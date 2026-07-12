import { useEffect, useState } from 'react'
import { weaponKindOf } from '../types'

/**
 * マップ枠右下の武器アクションボタン群（PC/スマホ共通）。
 * - 🏹 攻撃ボタン：弓装備中のみ。射程内に敵がいない時は薄表示（押してもターン消費なし）
 * - ⚔️/🏹 切替ボタン：バッグに異種武器がある時のみ。タップで最強の異種武器へ持ち替え（1ターン消費）
 */
export function BowAttackButton() {
  const [isBow, setIsBow] = useState(false)
  const [inRange, setInRange] = useState(false)
  const [canSwap, setCanSwap] = useState(false)

  useEffect(() => {
    const update = () => {
      const gs = window.gameState
      if (!gs) return
      const bow = weaponKindOf(gs.equipment.weapon) === 'bow'
      setIsBow(bow)
      setInRange(gs.bowTargetInRange ?? false)
      const targetKind = bow ? 'melee' : 'bow'
      setCanSwap(gs.bag.some(b => b.equipSlot === 'weapon' && weaponKindOf(b) === targetKind))
    }
    update()
    window.addEventListener('gamestate-update', update)
    return () => window.removeEventListener('gamestate-update', update)
  }, [])

  // 剣装備時は切替ボタンだけ（バッグに弓があれば）表示する
  if (!isBow && !canSwap) return null

  return (
    <>
      {canSwap && (
        <button
          className="weapon-swap-btn"
          data-priority-tap
          onClick={e => { e.stopPropagation(); e.currentTarget.blur(); window.gameSwapWeapon?.() }}
          onTouchStart={e => e.stopPropagation()}
          title={isBow ? '剣に持ち替え（1ターン消費）' : '弓に持ち替え（1ターン消費）'}
        >
          {isBow ? '⚔️' : '🏹'}
        </button>
      )}
      {isBow && (
        <button
          className={`bow-attack-btn${inRange ? '' : ' bow-attack-btn--no-target'}`}
          data-priority-tap
          // blur: クリック後にフォーカスが残るとSpaceキーがボタンのclickも発火させ、
          // キー側のgameAttackと合わせて1押しで2回攻撃（2ターン消費）になるのを防ぐ
          onClick={e => { e.stopPropagation(); e.currentTarget.blur(); window.gameAttack?.() }}
          onTouchStart={e => e.stopPropagation()}
          title="弓で攻撃（Spaceキーでも可）"
        >
          🏹
        </button>
      )}
    </>
  )
}
