import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { acquireFeed, releaseFeed, onNewNotif, type WorldNotif } from '../game/worldFeed'

// type別の配色（boss=赤 / achievement=金 / world=青 / system=紫 / event=緑 / maintenance=灰）
const COLORS: Record<WorldNotif['type'], { border: string; title: string; glow: string }> = {
  boss:        { border: '#ff5a5a', title: '#ffb3b3', glow: 'rgba(255,60,60,0.45)' },
  achievement: { border: '#ffcc44', title: '#ffe699', glow: 'rgba(255,200,60,0.45)' },
  world:       { border: '#5aa6ff', title: '#aacfff', glow: 'rgba(80,150,255,0.40)' },
  system:      { border: '#b58aff', title: '#d6c2ff', glow: 'rgba(160,120,255,0.40)' },
  event:       { border: '#5ad6a0', title: '#aef0d4', glow: 'rgba(80,210,150,0.40)' },
  maintenance: { border: '#9aa0b0', title: '#cfd3dd', glow: 'rgba(150,160,180,0.35)' },
}

const SHOW_MS  = 4000  // 表示時間
const FADE_MS  = 350   // フェード時間

export function WorldTelop() {
  const [queue, setQueue]     = useState<WorldNotif[]>([])
  const [current, setCurrent] = useState<WorldNotif | null>(null)
  const [visible, setVisible] = useState(false)

  // フィード購読 → 受信した通知はキューへ（表示中でも捨てない）＋ゲーム内ログにも残す
  useEffect(() => {
    acquireFeed()
    const off = onNewNotif((n) => {
      setQueue(q => [...q, n])
      // プレイ中なら、消えるテロップとは別にスクロールログへも蓄積する
      if (window.isGameSceneActive) window.addWorldLogMessage?.(`🌐${n.title} ${n.message}`)
    })
    return () => { off(); releaseFeed() }
  }, [])

  // 空き状態でキューがあれば次を取り出す
  useEffect(() => {
    if (current || queue.length === 0) return
    setCurrent(queue[0])
    setQueue(q => q.slice(1))
  }, [queue, current])

  // current の表示ライフサイクル：フェードイン → 表示 → フェードアウト → 消去（次へ）
  useEffect(() => {
    if (!current) return
    const showMs = current.display_ms ?? SHOW_MS
    console.log('[WorldTelop] display_ms:', current.display_ms, '→ showMs:', showMs)
    setVisible(false)
    const t0 = setTimeout(() => setVisible(true), 20)
    const t1 = setTimeout(() => setVisible(false), 20 + showMs)
    const t2 = setTimeout(() => setCurrent(null), 20 + showMs + FADE_MS)
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2) }
  }, [current])

  if (!current) return null
  const c = COLORS[current.type] ?? COLORS.world

  return createPortal(
    <div
      className="world-telop"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? 0 : -10}px)`,
        borderColor: c.border,
        boxShadow: `0 0 18px ${c.glow}, inset 0 0 0 1px rgba(255,255,255,0.04)`,
      }}
    >
      <div className="world-telop-rule" style={{ background: c.border }} />
      <div className="world-telop-title" style={{ color: c.title }}>{current.title}</div>
      <div className="world-telop-msg">{current.message}</div>
      <div className="world-telop-rule" style={{ background: c.border }} />
    </div>,
    document.body,
  )
}
