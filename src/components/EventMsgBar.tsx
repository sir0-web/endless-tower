import { useEffect, useRef, useState } from 'react'

interface MsgState { text: string; color: string; key: number; small: boolean }

export function EventMsgBar() {
  const [msg, setMsg] = useState<MsgState | null>(null)
  const [fading, setFading] = useState(false)
  const t1 = useRef<ReturnType<typeof setTimeout> | null>(null)
  const t2 = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.showEventMessage = (text, color = '#ffdd44', small = false) => {
      if (t1.current) clearTimeout(t1.current)
      if (t2.current) clearTimeout(t2.current)
      setFading(false)
      setMsg({ text, color, key: Date.now(), small })
      t1.current = setTimeout(() => setFading(true), 2800)
      t2.current = setTimeout(() => setMsg(null), 3500)
    }
    return () => {
      window.showEventMessage = undefined
      if (t1.current) clearTimeout(t1.current)
      if (t2.current) clearTimeout(t2.current)
    }
  }, [])

  return (
    <div className={`event-msg-bar${fading ? ' emb-fading' : ''}${msg?.small ? ' emb-small' : ''}`}>
      <img className="emb-bg" src="/assets/ui/event_msg_bg.webp" alt="" aria-hidden="true" />
      <div className="emb-content">
        {msg && msg.text.split('\n').map((line, i) => (
          <span key={`${msg.key}-${i}`} className="emb-msg" style={{ color: msg.color }}>
            {line.split('§').map((seg, j) =>
              j % 2 === 1
                ? <span key={j} style={{ color: '#ff4444' }}>{seg}</span>
                : seg
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
