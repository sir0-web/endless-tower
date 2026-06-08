import { useCallback, useEffect, useRef, useState } from 'react'

const OUTER_R   = 65   // 外円の半径 px
const INNER_R   = 26   // ノブの半径 px
const DEAD_ZONE = 20   // 移動が発動する最小ドラッグ距離
const REPEAT_MS = 180  // 長押し時の繰り返し間隔 ms

export function VirtualJoystick() {
  const [vis,  setVis]  = useState(false)
  const [base, setBase] = useState({ x: 0, y: 0 })
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [scrollLock, setScrollLock] = useState(false)

  const ivRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const dirRef    = useRef<string | null>(null)
  const baseRef   = useRef({ x: 0, y: 0 })
  const activeRef = useRef(false)

  const stopMove = useCallback(() => {
    if (ivRef.current) { clearInterval(ivRef.current); ivRef.current = null }
    dirRef.current = null
  }, [])

  // スクロールロック状態の変化を受け取る
  useEffect(() => {
    const onChange = (e: Event) => {
      setScrollLock((e as CustomEvent<{ enabled: boolean }>).detail.enabled)
    }
    window.addEventListener('scroll-lock-change', onChange)
    return () => window.removeEventListener('scroll-lock-change', onChange)
  }, [])

  useEffect(() => {
    if (window.innerWidth >= 768) return
    // scrollLock ON: 画面全体をリスナー対象にする
    const target: HTMLElement = scrollLock
      ? document.body
      : (document.querySelector('.game-pane') as HTMLElement | null) ?? document.body

    const onStart = (e: TouchEvent) => {
      if (window.innerWidth >= 768) return
      // ゲームシーン以外（タイトル・ゲームオーバー・ランキング）は起動しない
      if (!window.isGameSceneActive) return
      // scrollrockOFF: 全ボタン優先 / scrollrockON: data-priority-tap のみ優先（ステータス割り振り等は無効化）
      const prioritySelector = scrollLock
        ? '[data-priority-tap], a'
        : 'button, a, [role="button"]'
      if ((e.target as HTMLElement).closest(prioritySelector)) return
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

      setKnob({
        x: baseRef.current.x + Math.cos(ang) * r,
        y: baseRef.current.y + Math.sin(ang) * r,
      })

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
      const wasActive = activeRef.current
      activeRef.current = false
      stopMove()
      setVis(false)
      // ジョイスティックが実際に起動していた場合のみ preventDefault（ボタンの click を殺さない）
      if (wasActive) e.preventDefault()
    }

    target.addEventListener('touchstart',  onStart, { passive: false })
    target.addEventListener('touchmove',   onMove,  { passive: false })
    target.addEventListener('touchend',    onEnd,   { passive: false })
    target.addEventListener('touchcancel', onEnd,   { passive: false })

    return () => {
      target.removeEventListener('touchstart',  onStart)
      target.removeEventListener('touchmove',   onMove)
      target.removeEventListener('touchend',    onEnd)
      target.removeEventListener('touchcancel', onEnd)
      stopMove()
    }
  }, [scrollLock, stopMove])

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
