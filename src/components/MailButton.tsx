import { useEffect, useState } from 'react'
import { subscribeMailUnread } from '../game/mailbox'

// サウンドマークの隣に置く📧ボタン。新着(未読admin発)があると赤バッジ。クリックでメールBOXを開く。
// 未読数は MailBox のポーリングが更新する共有ストアから購読する。
export function MailButton({ className }: { className?: string }) {
  const [unread, setUnread] = useState(0)
  useEffect(() => subscribeMailUnread(setUnread), [])

  return (
    <button
      className={className}
      data-priority-tap
      style={{ position: 'relative' }}
      onClick={() => window.showMailBox?.()}
      title="メールBOX（運営からのメッセージ）"
    >
      📧
      {unread > 0 && <span className="mailbox-badge">{unread > 99 ? '99+' : unread}</span>}
    </button>
  )
}
