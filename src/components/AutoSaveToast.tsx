import { useEffect, useRef, useState } from 'react'

// プレイ枠の左上に「オートセーブ完了」を薄く表示する。
// フェードイン → 約3秒表示 → フェードアウト（CSSアニメ）。GameScene の autoSave() から呼ばれる。
export function AutoSaveToast() {
  const [seq, setSeq] = useState(0)   // 0=非表示。>0 で表示中（再表示のたびに増やしてアニメを再生）
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.showAutoSaveToast = () => {
      setSeq(s => s + 1)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setSeq(0), 3000)
    }
    return () => {
      window.showAutoSaveToast = undefined
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (seq === 0) return null
  return <div key={seq} className="autosave-toast">💾 オートセーブ完了</div>
}
