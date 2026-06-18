import { createClient } from '@supabase/supabase-js'

const SPAWN_COOLDOWN_MS  = 20 * 60 * 1000   // 20分クールダウン（強制発生）
const SPAWN_DURATION_MS  = 3  * 60 * 1000   // 出現後3分で逃げる
const MAX_DAILY_SPAWNS   = 50                // 1日の最大スポーン数

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ovutdzjddrwbguwjwmuw.supabase.co'
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SERVICE_KEY) {
    console.error('[skulporin] SERVICE_KEY missing')
    return res.json({ spawn: null, commands: [], _debug: 'SUPABASE_SERVICE_ROLE_KEY missing in Vercel' })
  }

  const { player_id, player_name, floor } = req.body ?? {}
  if (!player_id || typeof floor !== 'number') {
    return res.status(400).json({ error: 'invalid params' })
  }

  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const now = new Date()

    // 0-3: 時間切れactiveの掃除・セッション更新・ADMINコマンド取得・アクティブスポーン確認を並列実行
    //   掃除：オフライン等でクライアントがescape処理できないまま残った個体を escaped に倒す。
    //         これが無いと下のユニークインデックス(active=1体)が古い個体で詰まり新規が出なくなる。
    const [, , cmdsResult, activeResult] = await Promise.all([
      db.from('skulporin_spawns')
        .update({ status: 'escaped' })
        .eq('status', 'active')
        .lt('escapes_at', now.toISOString()),
      db.from('active_sessions').upsert({
        player_id,
        player_name: player_name ?? '冒険者',
        floor,
        updated_at: now.toISOString(),
      }),
      db.from('admin_event_commands')
        .select('*')
        .eq('target_player_id', player_id)
        .eq('status', 'pending'),
      db.from('skulporin_spawns')
        .select('*')
        .eq('status', 'active')
        .gt('escapes_at', now.toISOString())
        .limit(1)
        .maybeSingle(),
    ])

    // ADMINコマンドを消費
    let commands: any[] = []
    const cmds = cmdsResult.data
    if (cmds && cmds.length > 0) {
      commands = cmds
      await db.from('admin_event_commands')
        .update({ status: 'consumed' })
        .in('id', cmds.map((c: any) => c.id))
    }

    // アクティブなスポーンがあればそのまま返す
    const active = activeResult.data
    if (active) return res.json({ spawn: active, commands })

    // 4. クールダウンチェック（最後のスポーンから20分）
    const { data: last } = await db
      .from('skulporin_spawns')
      .select('spawned_at')
      .order('spawned_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (last) {
      const lastTime = new Date(last.spawned_at).getTime()
      if (Date.now() - lastTime < SPAWN_COOLDOWN_MS) {
        return res.json({ spawn: null, commands, _debug: `cooldown: ${Math.ceil((SPAWN_COOLDOWN_MS - (Date.now() - lastTime)) / 60000)}min remaining` })
      }
    }

    // 5. 本日の最大スポーン数チェック
    const today = now.toISOString().slice(0, 10)
    const { count: dailyCount } = await db
      .from('skulporin_spawns')
      .select('id', { count: 'exact', head: true })
      .eq('spawn_date', today)

    if ((dailyCount ?? 0) >= MAX_DAILY_SPAWNS) {
      return res.json({ spawn: null, commands, _debug: 'daily limit reached' })
    }

    // 6. スポーン
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
      // 23505 = unique_violation：別リクエストがほぼ同時にスポーン済み（出現レース）。
      //   uniq_skulporin_active により2体目のINSERTがここで弾かれる＝正常系として握りつぶす。
      if (error?.code === '23505') {
        return res.json({ spawn: null, commands, _debug: 'race: another active spawn already exists' })
      }
      console.error('[skulporin] insert error:', error)
      return res.json({ spawn: null, commands, _debug: `insert error: ${error?.message ?? 'no data'}` })
    }

    // 7. ワールド通知
    await db.from('world_notifications').insert({
      type: 'event',
      title: '[緊急]すかるぽりんが出現しました！',
      message: 'どこかのフロアに「すかるぽりん」が出現したようです！冒険者の皆さんは至急討伐に向かってください！',
      player_name: 'SYSTEM',
      player_id: 'system',
    })

    return res.json({ spawn: newSpawn, commands })

  } catch (e: any) {
    console.error('[skulporin] unhandled error:', e)
    return res.json({ spawn: null, commands: [], _debug: `exception: ${e?.message}` })
  }
}
