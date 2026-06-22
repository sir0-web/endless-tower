import { useEffect, useRef, useState } from 'react'
import { isMuted, toggleMute as soundToggleMute } from '../game/sound'
import { getDisplayName } from '../game/playerName'
import { MailButton } from './MailButton'

interface StatusSnap {
  hp: number; maxHp: number
  stamina: number; maxStamina: number
  floor: number; level: number
  exp: number
}

const DEFAULT: StatusSnap = { hp: 0, maxHp: 0, stamina: 0, maxStamina: 0, floor: 1, level: 1, exp: 0 }

export function MobileStatusBar() {
  const [s, setS]       = useState<StatusSnap>(DEFAULT)
  const [active, setActive] = useState(false)
  const [mute, setMute] = useState(isMuted())
  const [name, setName] = useState(getDisplayName)
  const [displayFloor, setDisplayFloor] = useState(1)
  const [numAnim, setNumAnim]           = useState(false)
  const prevFloorRef = useRef(-1)
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const update = () => {
      if (window.gameState && window.isGameSceneActive) {
        const { hp, maxHp, stamina, maxStamina, floor, level, exp } = window.gameState
        const prev = prevFloorRef.current
        if (prev > 0 && floor > prev) {
          if (animTimerRef.current) clearTimeout(animTimerRef.current)
          setNumAnim(true)
          animTimerRef.current = setTimeout(() => {
            setNumAnim(false)
            setDisplayFloor(floor)
            animTimerRef.current = null
          }, 500)
        } else {
          setDisplayFloor(floor)
        }
        prevFloorRef.current = floor
        setS({ hp, maxHp, stamina, maxStamina, floor, level, exp })
        setActive(true)
      }
    }
    const hide = () => {
      setActive(false)
      prevFloorRef.current = -1
      if (animTimerRef.current) { clearTimeout(animTimerRef.current); animTimerRef.current = null }
    }

    const onName = () => setName(getDisplayName())

    window.addEventListener('gamestate-update', update)
    window.addEventListener('game-scene-changed', hide)
    window.addEventListener('displayname-changed', onName)
    return () => {
      window.removeEventListener('gamestate-update', update)
      window.removeEventListener('game-scene-changed', hide)
      window.removeEventListener('displayname-changed', onName)
      if (animTimerRef.current) clearTimeout(animTimerRef.current)
    }
  }, [])

  const toggleMute = () => { soundToggleMute(); setMute(p => !p) }
  const handleSave = () => { window.saveGame?.() }

  const hpPct  = s.maxHp      > 0 ? Math.max(0, Math.round((s.hp      / s.maxHp)      * 100)) : 0
  const staPct = s.maxStamina > 0 ? Math.round((s.stamina / s.maxStamina) * 100) : 0

  const expNeeded = s.level * 30 + 10
  const expPct = expNeeded > 0 ? Math.min(100, Math.round((s.exp / expNeeded) * 100)) : 0

  if (!active) return null

  return (
    <div className="mob-status-bar">
      <div className="mob-floor-row">
        <span className="badge floor-badge mob-badge">
          B
          <span className={`floor-num${numAnim ? ' floor-num-anim' : ''}`}>
            {displayFloor}
          </span>
          F
        </span>
        <span className="badge level-badge mob-badge">Lv {s.level}</span>
        <span className="badge name-badge mob-badge">{name}</span>
        <MailButton className="mob-mute-btn" />
        <button className="mob-mute-btn" data-priority-tap onClick={toggleMute}>{mute ? '🔇' : '🔊'}</button>
        <button className="mob-save-btn" data-priority-tap onClick={handleSave}>セーブ</button>
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
          <div className="mob-bar-fill" style={{ width: `${staPct}%`, background: '#3b82f6' }} />
        </div>
        <span className="mob-bar-num">{s.stamina}/{s.maxStamina}</span>
      </div>
      <div className="mob-bar-row">
        <span className="mob-bar-lbl">EXP</span>
        <div className="mob-bar-track">
          <div className="mob-bar-fill" style={{ width: `${expPct}%`, background: '#ffffff' }} />
        </div>
        <span className="mob-bar-num">{s.exp}/{expNeeded}</span>
      </div>
    </div>
  )
}
