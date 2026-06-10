import { useEffect, useRef, useState } from 'react'

interface MsgState { text: string; color: string; key: number }

export function EventMsgBar() {
  const [msg, setMsg] = useState<MsgState | null>(null)
  const [fading, setFading] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const t1 = useRef<ReturnType<typeof setTimeout> | null>(null)
  const t2 = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.showEventMessage = (text, color = '#ffdd44') => {
      if (t1.current) clearTimeout(t1.current)
      if (t2.current) clearTimeout(t2.current)
      setFading(false)
      setMsg({ text, color, key: Date.now() })
      t1.current = setTimeout(() => setFading(true), 2800)
      t2.current = setTimeout(() => setMsg(null), 3500)
    }
    return () => {
      window.showEventMessage = undefined
      if (t1.current) clearTimeout(t1.current)
      if (t2.current) clearTimeout(t2.current)
    }
  }, [])

  // PC: キャンバス要素の幅・位置に追従して横幅を同期
  useEffect(() => {
    if (window.innerWidth < 768) return  // スマホは不要

    const bar = barRef.current
    if (!bar) return

    const syncToCanvas = () => {
      const canvas = document.querySelector<HTMLCanvasElement>('.game-pane canvas')
      if (!canvas || !bar.parentElement) return
      const cr = canvas.getBoundingClientRect()
      const pr = bar.parentElement.getBoundingClientRect()
      bar.style.width = `${cr.width}px`
      bar.style.left  = `${cr.left - pr.left}px`
    }

    let ro: ResizeObserver | null = null

    const attachObserver = () => {
      const canvas = document.querySelector<HTMLCanvasElement>('.game-pane canvas')
      if (!canvas) return false
      syncToCanvas()
      ro = new ResizeObserver(syncToCanvas)
      ro.observe(canvas)
      window.addEventListener('resize', syncToCanvas)
      return true
    }

    // canvas がまだ生成されていない場合は MutationObserver で待機
    if (!attachObserver()) {
      const gamePaneEl = document.querySelector('.game-pane')
      const mo = new MutationObserver(() => {
        if (attachObserver()) mo.disconnect()
      })
      if (gamePaneEl) mo.observe(gamePaneEl, { childList: true, subtree: true })
      return () => { mo.disconnect(); ro?.disconnect(); window.removeEventListener('resize', syncToCanvas) }
    }

    return () => { ro?.disconnect(); window.removeEventListener('resize', syncToCanvas) }
  }, [])

  return (
    <div ref={barRef} className={`event-msg-bar${fading ? ' emb-fading' : ''}`}>
      <img className="emb-bg" src="/assets/ui/event_msg_bg.png" alt="" aria-hidden="true" />
      <div className="emb-content">
        {msg && msg.text.split('\n').map((line, i) => (
          <span key={`${msg.key}-${i}`} className="emb-msg" style={{ color: msg.color }}>
            {line}
          </span>
        ))}
      </div>
    </div>
  )
}
