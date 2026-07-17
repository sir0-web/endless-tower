import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ovutdzjddrwbguwjwmuw.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

const SESSION_TIMEOUT_MS = 2 * 60 * 1000   // 2分以内に heartbeat → オンライン扱い
const SKULPORIN_DURATION_MS = 3 * 60 * 1000

export default async function handler(req: any, res: any) {
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY 未設定' })
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // ── GET: オンライン中プレイヤー一覧（2分以内に heartbeat があったセッション）──
  if (req.method === 'GET') {
    const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString()
    const { data, error } = await db
      .from('active_sessions')
      .select('player_id, player_name, floor, updated_at')
      .gt('updated_at', cutoff)
      .order('updated_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ players: data ?? [] })
  }

  if (req.method !== 'POST') return res.status(405).end()

  const { adminKey, action } = req.body ?? {}
  const ADMIN_KEY = process.env.ADMIN_KEY || process.env.VITE_ADMIN_KEY // 移行期間中は旧変数もフォールバック
  if (!ADMIN_KEY || adminKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // ── すかるぽりん強制出現（全プレイヤー対象）──
    if (action === 'skulporin') {
      const now = new Date()
      const escapesAt = new Date(Date.now() + SKULPORIN_DURATION_MS)
      const { error } = await db.from('skulporin_spawns').insert({
        target_floor: 0,
        target_player_id: 'admin',
        spawn_date: now.toISOString().slice(0, 10),
        status: 'active',
        spawned_at: now.toISOString(),
        escapes_at: escapesAt.toISOString(),
      })
      if (error) return res.status(500).json({ error: error.message })
      await db.from('world_notifications').insert({
        type: 'event',
        title: '[緊急]すかるぽりんが出現しました！',
        message: 'どこかのフロアに「すかるぽりん」が出現したようです！冒険者の皆さんは至急討伐に向かってください！',
        player_name: 'SYSTEM',
        player_id: 'system',
      })
      return res.json({ ok: true })
    }

    // ── モンスターハウス強制発動（指定プレイヤーの次フロア）──
    if (action === 'monster_house') {
      const { target_player_id, target_player_name } = req.body ?? {}
      if (!target_player_id) return res.status(400).json({ error: 'target_player_id 必須' })
      const { error } = await db.from('admin_event_commands').insert({
        command_type: 'monster_house',
        target_player_id,
        target_player_name: target_player_name ?? null,
        status: 'pending',
      })
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ ok: true })
    }

    // ── 指定モンスターを指定プレイヤーの指定階へ強制ポップ ──
    if (action === 'spawn_monster') {
      const { target_player_id, target_player_name, monster_name, monster_behavior, target_floor } = req.body ?? {}
      if (!target_player_id || !monster_name || !monster_behavior) {
        return res.status(400).json({ error: 'target_player_id / monster_name / monster_behavior 必須' })
      }
      const { error } = await db.from('admin_event_commands').insert({
        command_type: 'spawn_monster',
        target_player_id,
        target_player_name: target_player_name ?? null,
        monster_name,
        monster_behavior,
        target_floor: typeof target_floor === 'number' ? target_floor : null,
        status: 'pending',
      })
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ ok: true })
    }

    // ── ユーザー管理：名前で active_sessions を検索し、現在のステータス・装備を返す ──
    if (action === 'player_state') {
      const { name } = req.body ?? {}
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name 必須' })
      const { data, error } = await db.from('active_sessions')
        .select('player_id, player_name, floor, updated_at, state')
        .ilike('player_name', `%${name.trim()}%`)
        .order('updated_at', { ascending: false })
        .limit(20)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ sessions: data ?? [] })
    }

    return res.status(400).json({ error: 'invalid action' })
  } catch (e: any) {
    console.error('[admin-event] error:', e)
    return res.status(500).json({ error: e?.message ?? String(e) })
  }
}
