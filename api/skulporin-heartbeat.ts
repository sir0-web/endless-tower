import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

const SPAWN_COOLDOWN_MS  = 30 * 60 * 1000   // 30分クールダウン
const SPAWN_DURATION_MS  = 3  * 60 * 1000   // 出現後3分で逃げる
const SESSION_TIMEOUT_MS = 2  * 60 * 1000   // 2分以内に heartbeat → アクティブ扱い
const MIN_PLAYERS        = 2                 // スポーン条件: 2人以上アクティブ
const MIN_FLOOR          = 5                 // スポーン条件: B5階以上にいるプレイヤー
const MAX_DAILY_SPAWNS   = 50                // 1日の最大スポーン数

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()

  const { player_id, player_name, floor } = req.body ?? {}
  if (!player_id || typeof floor !== 'number') {
    return res.status(400).json({ error: 'invalid params' })
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const now = new Date()

  // 1. セッション更新
  await db.from('active_sessions').upsert({
    player_id,
    player_name: player_name ?? '冒険者',
    floor,
    updated_at: now.toISOString(),
  })

  // 2. 現在アクティブなスポーンを確認
  const { data: active } = await db
    .from('skulporin_spawns')
    .select('*')
    .eq('status', 'active')
    .gt('escapes_at', now.toISOString())
    .limit(1)
    .single()

  if (active) return res.json({ spawn: active })

  // 3. クールダウンチェック（最後のスポーンから30分）
  const { data: last } = await db
    .from('skulporin_spawns')
    .select('spawned_at')
    .in('status', ['defeated', 'escaped'])
    .order('spawned_at', { ascending: false })
    .limit(1)
    .single()

  if (last) {
    const lastTime = new Date(last.spawned_at).getTime()
    if (Date.now() - lastTime < SPAWN_COOLDOWN_MS) {
      return res.json({ spawn: null })
    }
  }

  // 4. 本日の最大スポーン数チェック
  const today = now.toISOString().slice(0, 10)
  const { count: dailyCount } = await db
    .from('skulporin_spawns')
    .select('id', { count: 'exact', head: true })
    .eq('spawn_date', today)

  if ((dailyCount ?? 0) >= MAX_DAILY_SPAWNS) {
    return res.json({ spawn: null })
  }

  // 5. アクティブなプレイヤー数チェック（MIN_FLOOR以上にいる2人以上）
  const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString()
  const { data: players } = await db
    .from('active_sessions')
    .select('player_id, floor, player_name')
    .gte('floor', MIN_FLOOR)
    .gt('updated_at', cutoff)

  if (!players || players.length < MIN_PLAYERS) {
    return res.json({ spawn: null })
  }

  // 6. ランダムにターゲットプレイヤーを選んでスポーン
  const target = players[Math.floor(Math.random() * players.length)]
  const escapesAt = new Date(Date.now() + SPAWN_DURATION_MS)

  const { data: newSpawn, error } = await db
    .from('skulporin_spawns')
    .insert({
      target_floor: target.floor,
      target_player_id: target.player_id,
      spawn_date: today,
      escapes_at: escapesAt.toISOString(),
    })
    .select()
    .single()

  if (error || !newSpawn) {
    console.error('skulporin spawn insert error:', error)
    return res.json({ spawn: null })
  }

  // 7. ワールド通知
  await db.from('world_notifications').insert({
    type: 'event',
    title: '【緊急】すかるぽりん出現！',
    message: 'どこかのフロアに「すかるぽりん」が現れました！倒せた冒険者には豪華な報酬が！急いで！',
    player_name: 'SYSTEM',
    player_id: 'system',
  })

  return res.json({ spawn: newSpawn })
}
