import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ovutdzjddrwbguwjwmuw.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

// お知らせの閲覧数を+1する（誰でも叩ける／重複抑制はクライアント側 localStorage に委譲）
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY 未設定' })

  const id = Number(req.body?.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id 必須' })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // 現在値を読んで+1（件数は多くないため read→write で十分）
  const { data, error } = await db
    .from('ebt_announcements')
    .select('view_count')
    .eq('id', id)
    .single()
  if (error) return res.status(404).json({ error: error.message })

  const { error: upErr } = await db
    .from('ebt_announcements')
    .update({ view_count: (data?.view_count ?? 0) + 1 })
    .eq('id', id)
  if (upErr) return res.status(500).json({ error: upErr.message })

  return res.json({ ok: true })
}
