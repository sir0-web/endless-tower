import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { acquireFeed, releaseFeed, onLogUpdate, type WorldNotif } from '../game/worldFeed'

// type別のアクセント色（テロップと統一）
const ACCENT: Record<WorldNotif['type'], string> = {
  boss:        '#ff5a5a',
  achievement: '#ffcc44',
  world:       '#5aa6ff',
  system:      '#b58aff',
  event:       '#5ad6a0',
  maintenance: '#9aa0b0',
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function WorldLog() {
  const [open, setOpen] = useState(false)
  const [log, setLog]   = useState<WorldNotif[]>([])

  useEffect(() => {
    acquireFeed()
    const off = onLogUpdate(setLog)
    return () => { off(); releaseFeed() }
  }, [])

  return createPortal(
    <>
      <button
        className="world-log-toggle"
        onClick={() => setOpen(o => !o)}
        aria-label="ワールドログ"
        title="ワールドログ"
      >
        🌐
      </button>

      {open && (
        <div className="world-log-backdrop" onClick={() => setOpen(false)}>
          <div className="world-log-panel" onClick={e => e.stopPropagation()}>
            <div className="world-log-head">
              <span>🌐 ワールドログ</span>
              <button className="world-log-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="world-log-list">
              {log.length === 0 && <div className="world-log-empty">まだ通知はありません</div>}
              {log.map(n => (
                <div key={n.id} className="world-log-item" style={{ borderLeftColor: ACCENT[n.type] ?? '#5aa6ff' }}>
                  <div className="world-log-item-top">
                    <span className="world-log-item-title" style={{ color: ACCENT[n.type] ?? '#aacfff' }}>{n.title}</span>
                    <span className="world-log-item-time">{timeLabel(n.created_at)}</span>
                  </div>
                  <div className="world-log-item-msg">{n.message}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}
