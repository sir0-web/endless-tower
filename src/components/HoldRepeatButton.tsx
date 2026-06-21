import { useCallback, useEffect, useRef } from 'react'

/**
 * 押している間 onPress を繰り返し呼ぶボタン（長押し連打）。
 * 押した瞬間に1回 → delay後から interval ごとに連続発火。離す/外れる/アンマウントで停止。
 * Pointer Events でマウス・タッチを一元処理。押下中にUIがズレてもポインタを要素に固定して連打が途切れない。
 * キーボードは onKeyDown(Enter/Space)で1回だけ拾う（onClickは使わない＝離した時に発火する誤動作を排除）。
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
    onPressRef.current()                       // 押した瞬間に1回
    startT.current = setTimeout(() => {         // 長押し判定後に連打開始
      repeatT.current = setInterval(() => onPressRef.current(), interval)
    }, delay)
  }, [delay, interval, stop])

  useEffect(() => stop, [stop])                // アンマウント時に確実に停止

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return   // マウスは左ボタンのみ
        e.preventDefault()
        // ポインタを要素に固定：振るたびにUIがズレてもカーソル離脱扱いにならず、
        // 離した場所に関わらず pointerup がこの要素に届く（連打が途切れない）。
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 未対応環境は無視 */ }
        start()
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); onPressRef.current() } }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}
