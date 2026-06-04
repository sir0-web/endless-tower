import { useEffect, useState } from 'react'
import { floorLabel } from '../game/utils'
import { isMuted, toggleMute as soundToggleMute } from '../game/sound'

interface StatusSnap {
  hp: number; maxHp: number
  stamina: number; maxStamina: number
  floor: number; level: number
}

const DEFAULT: StatusSnap = { hp: 0, maxHp: 0, stamina: 0, maxStamina: 0, floor: 1, level: 1 }

export function MobileStatusBar() {
  const [s, setS]       = useState<StatusSnap>(DEFAULT)
  const [active, setActive] = useState(false)
  const [mute, setMute] = useState(isMuted())

  useEffect(() => {
    const update = () => {
      if (window.gameState && window.isGameSceneActive) {
        const { hp, maxHp, stamina, maxStamina, floor, level } = window.gameState
        setS({ hp, maxHp, stamina, maxStamina, floor, level })
        setActive(true)
      }
    }
    const hide = () => setActive(false)

    window.addEventListener('gamestate-update', update)
    window.addEventListener('game-scene-changed', hide)
    return () => {
      window.removeEventListener('gamestate-update', update)
      window.removeEventListener('game-scene-changed', hide)
    }
  }, [])

  const toggleMute = () => { soundToggleMute(); setMute(p => !p) }

  const hpPct  = s.maxHp      > 0 ? Math.max(0, Math.round((s.hp      / s.maxHp)      * 100)) : 0
  const staPct = s.maxStamina > 0 ? Math.round((s.stamina / s.maxStamina) * 100) : 0
  const staColor = staPct > 40 ? '#22c55e' : staPct > 15 ? '#f59e0b' : '#ef4444'

  if (!active) return null

  return (
    <div className="mob-status-bar">
      <div className="mob-floor-row">
        <span className="badge floor-badge mob-badge">{floorLabel(s.floor)}</span>
        <span className="badge level-badge mob-badge">Lv {s.level}</span>
        <button className="mob-mute-btn" onClick={toggleMute}>{mute ? '🔇' : '🔊'}</button>
      </div>
      <div className="mob-bar-row">
        <span className="mob-bar-lbl">HP</span>
        <div className="mob-bar-track">
          <div className="mob-bar-fill" style={{ width: `${hpPct}%`, background: '#22c55e' }} />
        </div>
        <span className="mob-bar-num">{Math.max(0, s.hp)}/{s.maxHp}</span>
      </div>
      <div className="mob-bar-row">
        <span className="mob-bar-lbl">STA</span>
        <div className="mob-bar-track">
          <div className="mob-bar-fill" style={{ width: `${staPct}%`, background: staColor }} />
        </div>
        <span className="mob-bar-num">{s.stamina}/{s.maxStamina}</span>
      </div>
    </div>
  )
}
