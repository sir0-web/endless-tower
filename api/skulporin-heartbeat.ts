import { createClient } from '@supabase/supabase-js'

const SPAWN_COOLDOWN_MS  = 20 * 60 * 1000   // 20分クールダウン（強制発生）
const SPAWN_DURATION_MS  = 3  * 60 * 1000   // 出現後3分で逃げる
const MAX_DAILY_SPAWNS   = 50                // 1日の最大スポーン数

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()

  // 環境変数チェック
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[skulporin] env missing:', { SUPABASE_URL: !!SUPABASE_URL, SERVICE_KEY: !!SERVICE_KEY })
    return res.json({ spawn: null, _debug: 'env missing: check Vercel env vars' })
  }

  const { player_id, player_name, floor } = req.body ?? {}
  if (!player_id || typeof floor !== 'number') {
    return res.status(400).json({ error: 'invalid params' })
  }

  try {
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

    // 3. クールダウンチェック（最後のスポーンから20分）
    const { data: last } = await db
      .from('skulporin_spawns')
      .select('spawned_at')
      .order('spawned_at', { ascending: false })
      .limit(1)
      .single()

    if (last) {
      const lastTime = new Date(last.spawned_at).getTime()
      if (Date.now() - lastTime < SPAWN_COOLDOWN_MS) {
        return res.json({ spawn: null, _debug: `cooldown: ${Math.ceil((SPAWN_COOLDOWN_MS - (Date.now() - lastTime)) / 60000)}min remaining` })
      }
    }

    // 4. 本日の最大スポーン数チェック
    const today = now.toISOString().slice(0, 10)
    const { count: dailyCount } = await db
      .from('skulporin_spawns')
      .select('id', { count: 'exact', head: true })
      .eq('spawn_date', today)

    if ((dailyCount ?? 0) >= MAX_DAILY_SPAWNS) {
      return res.json({ spawn: null, _debug: 'daily limit reached' })
    }

    // 5. スポーン
    const escapesAt = new Date(Date.now() + SPAWN_DURATION_MS)

    const { data: newSpawn, error } = await db
      .from('skulporin_spawns')
      .insert({
        target_floor: floor,
        target_player_id: player_id,
        spawn_date: today,
        status: 'active',
        spawned_at: now.toISOString(),
        escapes_at: escapesAt.toISOString(),
      })
      .select()
      .single()

    if (error || !newSpawn) {
      console.error('[skulporin] insert error:', error)
      return res.json({ spawn: null, _debug: `insert error: ${error?.message ?? 'no data'}` })
    }

    // 6. ワールド通知
    await db.from('world_notifications').insert({
      type: 'event',
      title: '[緊急]すかるぽりんが出現しました！',
      message: 'どこかのフロアに「すかるぽりん」が出現したようです！冒険者の皆さんは至急討伐に向かってください！',
      player_name: 'SYSTEM',
      player_id: 'system',
    })

    return res.json({ spawn: newSpawn })

  } catch (e: any) {
    console.error('[skulporin] unhandled error:', e)
    return res.json({ spawn: null, _debug: `exception: ${e?.message}` })
  }
}
