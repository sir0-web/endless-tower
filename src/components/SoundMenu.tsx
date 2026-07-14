import { useEffect, useRef, useState } from 'react'
import {
  isMuted, toggleMute as soundToggleMute,
  getBgmVolumePct, setBgmVolumePct, getSeVolumePct, setSeVolumePct, playSePreview,
} from '../game/sound'

/**
 * 🔈サウンドボタン＋スライダー式音量メニュー（PC/スマホ共通）。
 * ボタン押下でメニュー開閉、BGM/SEをそれぞれ0〜100のスライダーで調整する。
 * これまでの調整済み音量をデフォルト（BGM=50, SE=70）として保持している。
 */
export function SoundMenu({ btnClassName }: { btnClassName: string }) {
  const [open, setOpen]   = useState(false)
  const [mute, setMute]   = useState(isMuted())
  const [bgmPct, setBgm]  = useState(getBgmVolumePct())
  const [sePct, setSe]    = useState(getSeVolumePct())
  const wrapRef = useRef<HTMLDivElement>(null)

  // メニュー外クリック／Escで閉じる
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

  const toggleMute = () => { soundToggleMute(); setMute(m => !m) }
  const onBgm = (v: number) => { setBgm(v); setBgmVolumePct(v) }
  const onSe  = (v: number) => { setSe(v);  setSeVolumePct(v) }

  // ── 画面サイズ（PC UI倍率）。localStorageへ保存しApp.tsxへ通知。スマホはCSSで非表示＝無効 ──
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
      className="sound-menu-wrap"
      ref={wrapRef}
      onTouchStartCapture={e => e.stopPropagation()}
      onTouchMoveCapture={e => e.stopPropagation()}
    >
      <button
        className={btnClassName}
        data-priority-tap
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        onTouchStart={e => e.stopPropagation()}
        title="サウンド設定"
      >
        {mute ? '🔇' : '🔊'}
      </button>
      {open && (
        <div
          className="sound-menu-popover"
          data-priority-tap
          onClick={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          <div className="sound-menu-row sound-menu-mute-row">
            <span>ミュート</span>
            <button className="sound-menu-mute-toggle" onClick={toggleMute} onTouchStart={e => e.stopPropagation()}>
              {mute ? 'OFF' : 'ON'}
            </button>
          </div>
          <div className="sound-menu-row">
            <span className="sound-menu-lbl">BGM</span>
            <input
              type="range" min={0} max={100} step={1} value={bgmPct}
              onChange={e => onBgm(Number(e.target.value))}
              onTouchStart={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
              className="sound-menu-slider"
            />
            <span className="sound-menu-val">{bgmPct}</span>
          </div>
          <div className="sound-menu-row">
            <span className="sound-menu-lbl">SE</span>
            <input
              type="range" min={0} max={100} step={1} value={sePct}
              onChange={e => onSe(Number(e.target.value))}
              onTouchStart={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
              onTouchEnd={() => playSePreview()}
              onMouseUp={() => playSePreview()}
              className="sound-menu-slider"
            />
            <span className="sound-menu-val">{sePct}</span>
          </div>
          {/* 画面サイズ（PCのみ。CSS @media でスマホでは非表示＝挙動にも影響なし） */}
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
