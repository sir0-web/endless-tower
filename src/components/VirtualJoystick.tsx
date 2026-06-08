import { useCallback, useEffect, useRef, useState } from 'react'

const OUTER_R   = 65   // 外円の半径 px
const INNER_R   = 26   // ノブの半径 px
const DEAD_ZONE = 20   // 移動が発動する最小ドラッグ距離
const REPEAT_MS = 180  // 長押し時の繰り返し間隔 ms

export function VirtualJoystick() {
  const [vis,  setVis]  = useState(false)
  const [base, setBase] = useState({ x: 0, y: 0 })
  const [knob, setKnob] = useState({ x: 0, y: 0 })

  const ivRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const dirRef    = useRef<string | null>(null)
  const baseRef   = useRef({ x: 0, y: 0 })
  const activeRef = useRef(false)

  const stopMove = useCallback(() => {
    if (ivRef.current) { clearInterval(ivRef.current); ivRef.current = null }
    dirRef.current = null
  }, [])

  useEffect(() => {
    const pane = document.querySelector('.game-pane') as HTMLElement | null
    if (!pane) return

    const onStart = (e: TouchEvent) => {
      // スマホのみ（PC はキーボードで操作）
      if (window.innerWidth >= 768) return
      // ボタン類タップ時はジョイスティックを起動しない
      if ((e.target as HTMLElement).closest('button, a, [role="button"]')) return
      const t = e.touches[0]
      baseRef.current = { x: t.clientX, y: t.clientY }
      activeRef.current = true
      setBase({ x: t.clientX, y: t.clientY })
      setKnob({ x: t.clientX, y: t.clientY })
      setVis(true)
      e.preventDefault()
    }

    const onMove = (e: TouchEvent) => {
      if (!activeRef.current) return
      const t = e.touches[0]
      const dx   = t.clientX - baseRef.current.x
      const dy   = t.clientY - baseRef.current.y
      const dist = Math.hypot(dx, dy)
      const maxR = OUTER_R - INNER_R
      const r    = Math.min(dist, maxR)
      const ang  = Math.atan2(dy, dx)

      // ノブを外円内にクランプして描画
      setKnob({
        x: baseRef.current.x + Math.cos(ang) * r,
        y: baseRef.current.y + Math.sin(ang) * r,
      })

      // 4方向判定
      let dir: string | null = null
      if (dist >= DEAD_ZONE) {
        dir = Math.abs(dx) >= Math.abs(dy)
          ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft')
          : (dy > 0 ? 'ArrowDown'  : 'ArrowUp')
      }

      if (dir !== dirRef.current) {
        stopMove()
        dirRef.current = dir
        if (dir) {
          window.gameMove?.(dir)
          ivRef.current = setInterval(() => {
            if (dirRef.current) window.gameMove?.(dirRef.current)
          }, REPEAT_MS)
        }
      }
      e.preventDefault()
    }

    const onEnd = (e: TouchEvent) => {
      activeRef.current = false
      stopMove()
      setVis(false)
      e.preventDefault()
    }

    pane.addEventListener('touchstart',  onStart, { passive: false })
    pane.addEventListener('touchmove',   onMove,  { passive: false })
    pane.addEventListener('touchend',    onEnd,   { passive: false })
    pane.addEventListener('touchcancel', onEnd,   { passive: false })

    return () => {
      pane.removeEventListener('touchstart',  onStart)
      pane.removeEventListener('touchmove',   onMove)
      pane.removeEventListener('touchend',    onEnd)
      pane.removeEventListener('touchcancel', onEnd)
      stopMove()
    }
  }, [stopMove])

  if (!vis) return null

  return (
    <div
      className="vj-outer"
      style={{ left: base.x - OUTER_R, top: base.y - OUTER_R }}
    >
      <div
        className="vj-knob"
        style={{
          left: knob.x - base.x + OUTER_R - INNER_R,
          top:  knob.y - base.y + OUTER_R - INNER_R,
        }}
      />
    </div>
  )
}
