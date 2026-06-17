import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ovutdzjddrwbguwjwmuw.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()

  const { action, spawn_id, player_name, player_id } = req.body ?? {}
  if (!action || !spawn_id || typeof spawn_id !== 'number') {
    return res.status(400).json({ error: 'invalid params' })
  }
  if (action !== 'kill' && action !== 'escape') {
    return res.status(400).json({ error: 'invalid action' })
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // status='active' を実際に変更できた1人だけが通知を出す（複数プレイヤーの重複通知を防ぐ）
  const { data: updated, error } = await db
    .from('skulporin_spawns')
    .update({
      status: action === 'kill' ? 'defeated' : 'escaped',
      ...(action === 'kill' ? { killed_by_name: player_name ?? '冒険者' } : {}),
    })
    .eq('id', spawn_id)
    .eq('status', 'active')
    .select('id')

  if (error) {
    console.error('skulporin action error:', error)
    return res.status(500).json({ error: error.message })
  }

  // 0行マッチ（すでに他プレイヤーが討伐/逃走を確定済み）→ 通知を出さずに終了
  if (!updated || updated.length === 0) {
    return res.json({ ok: true, duplicate: true })
  }

  const notif = action === 'kill'
    ? {
        type: 'event',
        title: '[緊急]すかるぽりんの討伐に成功しました！',
        message: `${player_name ?? '冒険者'}さんがすかるぽりんを討伐しました！ありがとうございます！`,
      }
    : {
        type: 'event',
        title: '[緊急]すかるぽりんが逃走しました・・・！',
        message: 'すかるぽりんはどこかに逃走したようです、次に出現した際は必ず討伐しましょう！',
      }

  await db.from('world_notifications').insert({
    ...notif,
    player_name: player_name ?? 'SYSTEM',
    player_id: player_id ?? 'system',
  })

  return res.json({ ok: true })
}
