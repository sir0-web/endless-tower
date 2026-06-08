import { useState } from 'react'

export function ScrollLockButton() {
  const [locked, setLocked] = useState(false)

  const toggle = () => {
    const next = !locked
    setLocked(next)
    window.dispatchEvent(new CustomEvent('scroll-lock-change', { detail: { enabled: next } }))
  }

  return (
    <button
      className="scroll-lock-btn"
      onClick={toggle}
      onTouchStart={(e) => e.stopPropagation()}
      title={locked ? 'スクロールロック ON' : 'スクロールロック OFF'}
    >
      {locked ? '🔒' : '🔓'}
    </button>
  )
}
