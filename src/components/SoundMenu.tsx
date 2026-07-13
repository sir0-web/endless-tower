import { useEffect, useRef, useState } from 'react'
import {
  isMuted, toggleMute as soundToggleMute,
  getBgmVolumePct, setBgmVolumePct, getSeVolumePct, setSeVolumePct,
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

  return (
    <div className="sound-menu-wrap" ref={wrapRef}>
      <button
        className={btnClassName}
        data-priority-tap
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        title="サウンド設定"
      >
        {mute ? '🔇' : '🔊'}
      </button>
      {open && (
        <div className="sound-menu-popover" onClick={e => e.stopPropagation()}>
          <div className="sound-menu-row sound-menu-mute-row">
            <span>ミュート</span>
            <button className="sound-menu-mute-toggle" onClick={toggleMute}>
              {mute ? 'OFF' : 'ON'}
            </button>
          </div>
          <div className="sound-menu-row">
            <span className="sound-menu-lbl">BGM</span>
            <input
              type="range" min={0} max={100} step={1} value={bgmPct}
              onChange={e => onBgm(Number(e.target.value))}
              className="sound-menu-slider"
            />
            <span className="sound-menu-val">{bgmPct}</span>
          </div>
          <div className="sound-menu-row">
            <span className="sound-menu-lbl">SE</span>
            <input
              type="range" min={0} max={100} step={1} value={sePct}
              onChange={e => onSe(Number(e.target.value))}
              className="sound-menu-slider"
            />
            <span className="sound-menu-val">{sePct}</span>
          </div>
        </div>
      )}
    </div>
  )
}
