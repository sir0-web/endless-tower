import { getPlayerId } from './supabase'
import { getDisplayName } from './playerName'

export interface Mail {
  id: number
  sender: 'admin' | 'player'
  title: string | null
  body: string
  read: boolean
  created_at: string
}

// ── 未読数の共有ストア（MailBoxがポーリングで更新 → MailButtonがバッジ表示）──
let _unread = 0
const _subs = new Set<(n: number) => void>()
export function setMailUnread(n: number): void { _unread = n; _subs.forEach(f => f(n)) }
export function getMailUnread(): number { return _unread }
export function subscribeMailUnread(f: (n: number) => void): () => void {
  _subs.add(f); f(_unread); return () => { _subs.delete(f) }
}

// 会話(全件)＋未読(admin発)数を取得。失敗時は空（機能無効）として返す。
export async function fetchMailbox(): Promise<{ mails: Mail[]; unread: number }> {
  try {
    const res = await fetch(`/api/mailbox?player_id=${encodeURIComponent(getPlayerId())}`)
    if (!res.ok) return { mails: [], unread: 0 }
    const json = await res.json().catch(() => null)
    return { mails: json?.mails ?? [], unread: json?.unread ?? 0 }
  } catch {
    return { mails: [], unread: 0 }
  }
}

// admin発を既読化（メールBOXを開いたとき）。fire-and-forget。
export async function markMailsRead(): Promise<void> {
  try {
    await fetch('/api/mailbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: getPlayerId(), action: 'read' }),
    })
  } catch { /* fire-and-forget */ }
}

// ADMINへ返信を送る。成功で true。
export async function sendMailReply(body: string): Promise<boolean> {
  try {
    const res = await fetch('/api/mailbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_id: getPlayerId(), player_name: getDisplayName(),
        action: 'reply', body,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
