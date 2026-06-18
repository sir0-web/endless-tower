import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { acquireFeed, releaseFeed, onNewNotif, type WorldNotif } from '../game/worldFeed'
import { getPlayerId } from '../game/supabase'
import { getDisplayName } from '../game/playerName'

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

// いいね可能な通知か：プレイヤー発（system/admin除外）・自分以外・プレイ中のみ
function isLikeable(n: WorldNotif): boolean {
  if (!n.player_id) return false
  if (n.player_id === 'system' || n.player_id === 'admin-broadcast') return false
  if (n.player_id === getPlayerId()) return false
  return !!window.isGameSceneActive
}

export function WorldTelop() {
  const [queue, setQueue]         = useState<WorldNotif[]>([])
  const [current, setCurrent]     = useState<WorldNotif | null>(null)
  const [visible, setVisible]     = useState(false)
  const [likeStatus, setLikeStatus] = useState<'idle' | 'sending' | 'done'>('idle')

  const hideRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // フィード購読 → 受信した通知はキューへ（表示中でも捨てない）＋ゲーム内ログにも残す
  useEffect(() => {
    acquireFeed()
    const off = onNewNotif((n) => {
      setQueue(q => [...q, n])
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
    setLikeStatus('idle')
    setVisible(false)
    const showMs = current.display_ms ?? SHOW_MS
    const t0 = setTimeout(() => setVisible(true), 20)
    hideRef.current  = setTimeout(() => setVisible(false), 20 + showMs)
    clearRef.current = setTimeout(() => setCurrent(null), 20 + showMs + FADE_MS)
    return () => {
      clearTimeout(t0)
      if (hideRef.current)  clearTimeout(hideRef.current)
      if (clearRef.current) clearTimeout(clearRef.current)
    }
  }, [current])

  // ホバー/タッチ中は自動消去を止めて、いいねを押す猶予を作る
  const pauseHide = () => {
    if (hideRef.current)  { clearTimeout(hideRef.current);  hideRef.current = null }
    if (clearRef.current) { clearTimeout(clearRef.current); clearRef.current = null }
    setVisible(true)
  }
  const resumeHide = () => {
    if (hideRef.current)  clearTimeout(hideRef.current)
    if (clearRef.current) clearTimeout(clearRef.current)
    hideRef.current  = setTimeout(() => setVisible(false), 1000)
    clearRef.current = setTimeout(() => setCurrent(null), 1000 + FADE_MS)
  }

  const doLike = async () => {
    if (!current || likeStatus !== 'idle') return
    setLikeStatus('sending')
    try {
      const res = await fetch('/api/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notification_id: current.id,
          from_player_id: getPlayerId(),
          from_name: getDisplayName(),
          to_player_id: current.player_id,
          to_name: current.player_name,
        }),
      })
      const json = await res.json().catch(() => null)
      if (json?.ok) {
        setLikeStatus('done')
        window.grantReward?.(json.reward, `${json.to_name ?? current.player_name ?? '冒険者'}さんにいいねしました！`)
      } else {
        setLikeStatus('done')
        window.showEventMessage?.(json?.message ?? 'いいねできませんでした', '#ff9a9a')
      }
    } catch {
      setLikeStatus('idle')   // 通信失敗時は再挑戦できるよう戻す
    }
  }

  if (!current) return null
  const c = COLORS[current.type] ?? COLORS.world
  const likeable = isLikeable(current)

  return createPortal(
    <div
      className="world-telop"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? 0 : -10}px)`,
        borderColor: c.border,
        boxShadow: `0 0 18px ${c.glow}, inset 0 0 0 1px rgba(255,255,255,0.04)`,
        pointerEvents: likeable ? 'auto' : 'none',
      }}
      onMouseEnter={likeable ? pauseHide : undefined}
      onMouseLeave={likeable ? resumeHide : undefined}
      onTouchStart={likeable ? pauseHide : undefined}
    >
      <div className="world-telop-rule" style={{ background: c.border }} />
      <div className="world-telop-title" style={{ color: c.title }}>{current.title}</div>
      <div className="world-telop-msg">{current.message}</div>
      {likeable && (
        <button
          className="world-telop-like"
          disabled={likeStatus !== 'idle'}
          onClick={doLike}
        >
          {likeStatus === 'done' ? '❤️ いいね済み' : likeStatus === 'sending' ? '送信中…' : '🤍 いいね！'}
        </button>
      )}
      <div className="world-telop-rule" style={{ background: c.border }} />
    </div>,
    document.body,
  )
}
