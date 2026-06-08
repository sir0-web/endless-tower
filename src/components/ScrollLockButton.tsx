import { useEffect, useState } from 'react'

export function ScrollLockButton() {
  const [locked, setLocked] = useState(false)
  const [toast, setToast]   = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(t)
  }, [toast])

  const toggle = () => {
    const next = !locked
    setLocked(next)
    window.dispatchEvent(new CustomEvent('scroll-lock-change', { detail: { enabled: next } }))
    setToast(next
      ? 'scrollrockがONになりました\nバーチャルスティックが優先されます'
      : 'scrollrockがOFFになりました')
  }

  return (
    <>
      <button
        className={`scroll-lock-btn${locked ? '' : ' sl-off'}`}
        data-priority-tap
        onClick={toggle}
        onTouchStart={(e) => e.stopPropagation()}
      >
        🎮
      </button>

      {toast && (
        <div className="scroll-lock-toast">
          {toast.split('\n').map((line, i) => (
            <span key={i}>{line}{i < toast.split('\n').length - 1 && <br />}</span>
          ))}
        </div>
      )}
    </>
  )
}
