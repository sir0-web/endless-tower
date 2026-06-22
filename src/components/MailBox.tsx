import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMailbox, markMailsRead, sendMailReply, type Mail } from '../game/mailbox'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).replace(/\//g, '.')
}

// 端末(player_id)宛ての運営DMを読む／返信するメールBOX。TOP/ゲーム中どちらでも📧ボタンから開ける（死亡後も残る）。
export function MailBox() {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [mails, setMails]     = useState<Mail[]>([])
  const [unread, setUnread]   = useState(0)
  const [reply, setReply]     = useState('')
  const [sending, setSending] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshUnread = useCallback(async () => {
    const { unread } = await fetchMailbox()
    setUnread(unread)
  }, [])

  const load = useCallback(async (markRead: boolean) => {
    setLoading(true)
    const { mails } = await fetchMailbox()
    setMails(mails); setLoading(false)
    if (markRead && mails.some(m => m.sender === 'admin' && !m.read)) { void markMailsRead(); setUnread(0) }
  }, [])

  const openBox = useCallback(async () => { setOpen(true); await load(true) }, [load])

  useEffect(() => {
    window.showMailBox = () => { void openBox() }
    void refreshUnread()
    pollRef.current = setInterval(() => { if (!open) void refreshUnread() }, 60_000)
    return () => {
      window.showMailBox = undefined
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [openBox, refreshUnread, open])

  const submitReply = async () => {
    const text = reply.trim()
    if (!text || sending) return
    setSending(true)
    const ok = await sendMailReply(text)
    setSending(false)
    if (ok) { setReply(''); await load(false) }
    else alert('返信の送信に失敗しました。通信環境を確認してください。')
  }

  const hasAdminMsg = mails.some(m => m.sender === 'admin')

  return (
    <>
      <button className="mailbox-fab" onClick={() => void openBox()} aria-label="メールBOX" title="メールBOX（運営からのメッセージ）">
        📧
        {unread > 0 && <span className="mailbox-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div style={S.panel}>
            <div style={S.header}>
              <span style={S.title}>📧 メールBOX</span>
              <button onClick={() => setOpen(false)} style={S.closeX} aria-label="閉じる">✕</button>
            </div>
            <div style={S.rule} />

            <div style={S.body}>
              {loading && <p style={S.dim}>読み込み中…</p>}
              {!loading && mails.length === 0 && <p style={S.dim}>メールはまだありません。</p>}
              {!loading && mails.map(m => (
                m.sender === 'admin' ? (
                  <div key={m.id} style={S.adminMsg}>
                    <div style={S.msgHead}>
                      <span style={S.adminFrom}>運営</span>
                      {m.title && <span style={S.adminTitle}>{m.title}</span>}
                      <span style={S.msgDate}>{fmtDate(m.created_at)}</span>
                    </div>
                    <p style={S.msgBody}>{m.body}</p>
                  </div>
                ) : (
                  <div key={m.id} style={S.playerMsg}>
                    <p style={S.msgBodyMine}>{m.body}</p>
                    <span style={S.msgDateMine}>{fmtDate(m.created_at)} ・{m.read ? '既読' : '未読'}</span>
                  </div>
                )
              ))}
            </div>

            {/* 返信欄：運営からのメールがある場合のみ（一方的な送信を防ぐ） */}
            {!loading && hasAdminMsg && (
              <div style={S.replyBar}>
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  placeholder="運営へ返信する…"
                  rows={2}
                  maxLength={1000}
                  style={S.replyInput}
                />
                <button onClick={() => void submitReply()} disabled={sending || !reply.trim()} style={S.replyBtn}>
                  {sending ? '送信中…' : '返信'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const PARCH = 'linear-gradient(180deg, #f3e4c2 0%, #ecdab0 55%, #e2cb98 100%)'
const INK   = '#3a2a14'
const GOLD  = '#9c7a33'

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9300, background: 'rgba(0,0,0,0.78)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  panel: {
    width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    background: PARCH, color: INK, border: `3px solid ${GOLD}`, borderRadius: 10,
    boxShadow: '0 10px 50px rgba(0,0,0,0.75), inset 0 0 40px rgba(120,80,20,0.18)',
    fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", serif',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px 6px' },
  title: { fontSize: 18, fontWeight: 700, color: '#5a3d12', letterSpacing: 1 },
  closeX: { background: 'none', border: 'none', color: '#7a5a2a', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 6px' },
  rule: { height: 2, margin: '0 16px', background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` },
  body: { padding: '12px 18px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 },
  dim: { color: '#8a7244', textAlign: 'center', padding: '24px 0' },

  adminMsg: { alignSelf: 'flex-start', maxWidth: '88%', background: 'rgba(255,255,255,0.45)', border: '1px solid #c9b07e', borderRadius: '4px 12px 12px 12px', padding: '8px 12px' },
  msgHead: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  adminFrom: { fontSize: 12, fontWeight: 800, color: '#b3471f' },
  adminTitle: { fontSize: 14, fontWeight: 700, color: '#5a3d12' },
  msgDate: { fontSize: 10, color: '#9a7b3d', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' },
  msgBody: { fontSize: 14, lineHeight: 1.6, margin: '4px 0 0', whiteSpace: 'pre-wrap' },

  playerMsg: { alignSelf: 'flex-end', maxWidth: '88%', background: 'rgba(120,160,90,0.30)', border: '1px solid #8aa05a', borderRadius: '12px 4px 12px 12px', padding: '8px 12px' },
  msgBodyMine: { fontSize: 14, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', color: '#2e3a14' },
  msgDateMine: { display: 'block', fontSize: 10, color: '#6a7a3d', textAlign: 'right', marginTop: 2 },

  replyBar: { display: 'flex', gap: 8, padding: '10px 16px 14px', borderTop: `2px solid ${GOLD}`, alignItems: 'flex-end' },
  replyInput: { flex: 1, resize: 'none', borderRadius: 6, border: '1px solid #c9b07e', padding: '6px 8px', fontSize: 14, fontFamily: 'inherit', background: 'rgba(255,255,255,0.6)', color: INK },
  replyBtn: { flexShrink: 0, padding: '8px 16px', background: '#7a5a2a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' },
}
