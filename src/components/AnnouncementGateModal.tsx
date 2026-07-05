import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { hasUnreadAnnouncement } from '../game/announcements'

// GAME START時に未読のお知らせがあれば割り込んで警告するモーダル。
// TitleScene（Phaser）から window.checkAnnouncementGate 経由で呼ばれる。
export function AnnouncementGateModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    window.checkAnnouncementGate = (onProceed) => {
      hasUnreadAnnouncement()
        .then(has => { if (has) setOpen(true); else onProceed() })
        .catch(() => onProceed())   // 取得失敗時はゲーム開始を止めない
    }
    return () => { window.checkAnnouncementGate = undefined }
  }, [])

  if (!open) return null

  const openNews = () => { setOpen(false); window.showNews?.() }

  return createPortal(
    <div style={S.overlay} onClick={() => setOpen(false)}>
      <div style={S.box} onClick={e => e.stopPropagation()}>
        <p style={S.msg}>📜 未読のお知らせがあります</p>
        <div style={S.btns}>
          <button style={S.primary} onClick={openNews}>お知らせを見る</button>
          <button style={S.close} onClick={() => setOpen(false)}>とじる</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const GOLD = '#9c7a33'

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9050, background: 'rgba(0,0,0,0.78)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  box: {
    width: '100%', maxWidth: 360, padding: '26px 22px 22px', textAlign: 'center',
    background: 'linear-gradient(180deg, #f3e4c2 0%, #ecdab0 55%, #e2cb98 100%)',
    border: `3px solid ${GOLD}`, borderRadius: 10,
    boxShadow: '0 10px 50px rgba(0,0,0,0.75), inset 0 0 40px rgba(120,80,20,0.18)',
    fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", serif',
  },
  msg: { fontSize: 17, fontWeight: 700, color: '#5a3d12', margin: '0 0 22px', lineHeight: 1.6 },
  btns: { display: 'flex', flexDirection: 'column', gap: 10 },
  primary: {
    padding: '11px 0', background: '#2d7a4a', color: '#fff', fontWeight: 700, fontSize: 15,
    border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
  },
  close: {
    padding: '9px 0', background: 'rgba(120,80,20,0.12)', color: '#5a3d12', fontSize: 14,
    border: `1px solid ${GOLD}`, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
  },
}
