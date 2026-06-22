import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ovutdzjddrwbguwjwmuw.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

// プレイヤー側メールBOX（双方向DM）。
//   GET ?player_id=        → 会話(全件) + 未読(admin発)数
//   POST action='read'     → admin発を既読化
//   POST action='reply'    → プレイヤーからADMINへ返信(sender='player')
// 端末(player_id)キーなので死亡後も残る。テーブル未作成時はクラッシュせず空で返す。
export default async function handler(req: any, res: any) {
  if (!SERVICE_KEY) return res.json({ mails: [], unread: 0 })
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  if (req.method === 'GET') {
    const player_id = String(req.query?.player_id ?? '').trim()
    if (!player_id) return res.status(400).json({ error: 'player_id 必須' })
    const { data, error } = await db.from('ebt_mails')
      .select('id, sender, title, body, read, created_at')
      .eq('player_id', player_id)
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) return res.json({ mails: [], unread: 0 })   // 未作成等でも空返し
    const mails = data ?? []
    const unread = mails.filter((m: any) => m.sender === 'admin' && !m.read).length
    return res.json({ mails, unread })
  }

  if (req.method === 'POST') {
    const { player_id, player_name, action, body } = req.body ?? {}
    if (typeof player_id !== 'string' || !player_id.trim()) return res.status(400).json({ error: 'player_id 必須' })
    const pid = player_id.trim()

    if (action === 'read') {
      // admin発をプレイヤーが既読化
      const { error } = await db.from('ebt_mails')
        .update({ read: true })
        .eq('player_id', pid).eq('sender', 'admin').eq('read', false)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ ok: true })
    }

    if (action === 'reply') {
      if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: 'body 必須' })
      const { error } = await db.from('ebt_mails').insert({
        player_id: pid,
        player_name: typeof player_name === 'string' ? player_name : null,
        sender: 'player',
        body: body.trim().slice(0, 1000),
        read: false,   // ADMINが未読
      })
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ ok: true })
    }

    return res.status(400).json({ error: 'invalid action' })
  }

  return res.status(405).end()
}
