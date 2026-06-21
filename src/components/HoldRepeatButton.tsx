import { useCallback, useEffect, useRef } from 'react'

/**
 * 押している間 onPress を繰り返し呼ぶボタン（長押し連打）。
 * 押下で即1回 → delay後から interval ごとに連続発火。離す/外れる/アンマウントで停止。
 * Pointer Events でマウス・タッチを一元処理し、キーボード(Enter/Space)は onClick(detail===0)で1回だけ拾う。
 */
export function HoldRepeatButton({
  className, disabled, onPress, children, delay = 300, interval = 80,
}: {
  className?: string
  disabled?: boolean
  onPress: () => void
  children: React.ReactNode
  delay?: number
  interval?: number
}) {
  const onPressRef = useRef(onPress)
  onPressRef.current = onPress
  const startT  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatT = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (startT.current)  { clearTimeout(startT.current);  startT.current = null }
    if (repeatT.current) { clearInterval(repeatT.current); repeatT.current = null }
  }, [])

  const start = useCallback(() => {
    stop()
    onPressRef.current()                     // 押した瞬間に1回
    startT.current = setTimeout(() => {       // 長押し判定後に連打開始
      repeatT.current = setInterval(() => onPressRef.current(), interval)
    }, delay)
  }, [delay, interval, stop])

  useEffect(() => stop, [stop])              // アンマウント時に確実に停止

  return (
    <button
      className={className}
      disabled={disabled}
      // ポインタを要素に固定。振るたびにUIがズレてもカーソル離脱扱いにならず、
      // 離した場所に関わらず pointerup がこの要素に届く（連打が途切れない）。
      onPointerDown={(e) => {
        e.preventDefault()
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 未対応環境は無視 */ }
        start()
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onClick={(e) => { if (e.detail === 0) onPressRef.current() }}  // キーボード操作のみ
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}
