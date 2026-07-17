import { useEffect, useRef, useState } from 'react'

/**
 * 📺画面サイズボタン＋ポップオーバー（PC専用）。
 * 元々SoundMenu内にあった「画面サイズ（標準/小/特小）」設定を、サウンドとは無関係な
 * 独立ボタンとして分離したもの（サウンドボタンの中にあるのは直感的でない、という声を受けて新設）。
 * 設定値はSoundMenu時代と同じlocalStorageキー(ebt_ui_scale)・同じイベント(et-ui-scale-change)を使うため、
 * App.tsx側の適用ロジックは変更不要。
 */
export function ScreenSizeMenu({ btnClassName }: { btnClassName: string }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // メニュー外クリック／Escで閉じる（SoundMenuと同じ方式）
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const readScale = () => { const v = Number(localStorage.getItem('ebt_ui_scale')); return v >= 0.6 && v <= 1.0 ? v : 1 }
  const [uiScale, setUiScale] = useState(readScale)
  const applyScale = (v: number) => {
    setUiScale(v)
    localStorage.setItem('ebt_ui_scale', String(v))
    window.dispatchEvent(new CustomEvent('et-ui-scale-change', { detail: v }))
  }
  const SCALE_PRESETS: { v: number; label: string }[] = [
    { v: 1.0,  label: '標準' },
    { v: 0.85, label: '小' },
    { v: 0.7,  label: '特小' },
  ]

  return (
    <div
      className="screen-size-menu-wrap"
      ref={wrapRef}
      onTouchStartCapture={e => e.stopPropagation()}
      onTouchMoveCapture={e => e.stopPropagation()}
    >
      <button
        className={btnClassName}
        data-priority-tap
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        onTouchStart={e => e.stopPropagation()}
        title="画面サイズ設定"
      >
        📺
      </button>
      {open && (
        <div
          className="screen-size-menu-popover"
          data-priority-tap
          onClick={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          <div className="sound-menu-row ui-scale-row">
            <span className="sound-menu-lbl">画面</span>
            <div className="ui-scale-btns">
              {SCALE_PRESETS.map(p => (
                <button
                  key={p.v}
                  className={`ui-scale-btn ${Math.abs(uiScale - p.v) < 0.001 ? 'ui-scale-active' : ''}`}
                  onClick={() => applyScale(p.v)}
                  onTouchStart={e => e.stopPropagation()}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
