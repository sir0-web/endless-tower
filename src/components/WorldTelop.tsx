import { useEffect, useRef, useState } from 'react'
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

  // ウォッチドッグ：どんな経路で消去タイマーが失われても（タッチ後の合成 mouseenter で
  // pauseHide が走りタイマーが潰されるケース等）、テロップが永久残留しないための絶対上限。
  useEffect(() => {
    if (!current) return
    const maxMs = (current.display_ms ?? SHOW_MS) + 12_000
    const kill = setTimeout(() => {
      setVisible(false)
      setTimeout(() => setCurrent(null), FADE_MS)
    }, maxMs)
    return () => clearTimeout(kill)
  }, [current])

  // ホバー/タッチ中は自動消去を止めて、いいねを押す猶予を作る
  const pauseHide = () => {
    if (hideRef.current)  { clearTimeout(hideRef.current);  hideRef.current = null }
    if (clearRef.current) { clearTimeout(clearRef.current); clearRef.current = null }
    setVisible(true)
  }
  // delay後に隠して消去する（タイマーを張り直す）。like後やホバー解除で使う
  const scheduleHide = (delay: number) => {
    if (hideRef.current)  clearTimeout(hideRef.current)
    if (clearRef.current) clearTimeout(clearRef.current)
    hideRef.current  = setTimeout(() => setVisible(false), delay)
    clearRef.current = setTimeout(() => setCurrent(null), delay + FADE_MS)
  }
  const resumeHide = () => scheduleHide(1000)

  const doLike = async () => {
    if (!current || likeStatus !== 'idle') return
    pauseHide()   // 送信中にテロップが消えないよう保持（完了後 scheduleHide で必ず閉じる）
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
      // いいね後は「いいね済み」を一瞬見せてから必ず自動で閉じる
      // （タッチ操作で pauseHide によりタイマーが止まったまま残るのを防ぐ）
      scheduleHide(1300)
    } catch {
      setLikeStatus('idle')   // 通信失敗時は再挑戦できるよう戻す
    }
  }

  if (!current) return null
  const c = COLORS[current.type] ?? COLORS.world
  const likeable = isLikeable(current)

  return (
    // 親は常に pointer-events:none（タップは「いいね」ボタンだけが受ける。CSS側で auto 指定済み）。
    // 以前は likeable 時に親全体を auto にしていたため、消去タイマーが失われた際に
    // 見えない帯が画面上部のタップを恒久的に奪うことがあった。
    // ※以前はcreatePortalでdocument.body直下に描画していたが、それだとPCのUI倍率
    //   （App.tsxのtransform: scale）の影響を受けず実ピクセル位置に固定されたままになり、
    //   縮小率が下がるほどHPバー（.pc-status-top）へ物理的に重なる不具合があった。
    //   App.tsx側でtransform適用済みの箱の中に置くよう変更し、常に一緒に縮小・移動させる。
    <div
      className="world-telop"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? 0 : -10}px)`,
        borderColor: c.border,
        boxShadow: `0 0 18px ${c.glow}, inset 0 0 0 1px rgba(255,255,255,0.04)`,
        pointerEvents: 'none',
      }}
    >
      <div className="world-telop-rule" style={{ background: c.border }} />
      <div className="world-telop-title" style={{ color: c.title }}>{current.title}</div>
      <div className="world-telop-msg">{current.message}</div>
      {likeable && (
        <button
          className="world-telop-like"
          disabled={likeStatus !== 'idle'}
          onClick={doLike}
          // ホバー中は消去を保留（PCのみ。タッチ後の合成マウスイベントは pointerType で除外し、
          // resumeHide されないままタイマーが潰される残留バグを防ぐ）
          onPointerEnter={e => { if (e.pointerType === 'mouse') pauseHide() }}
          onPointerLeave={e => { if (e.pointerType === 'mouse') resumeHide() }}
        >
          {likeStatus === 'done' ? '❤️ いいね済み' : likeStatus === 'sending' ? '送信中…' : '🤍 いいね！'}
        </button>
      )}
      <div className="world-telop-rule" style={{ background: c.border }} />
    </div>
  )
}
