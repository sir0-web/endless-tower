import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

export default async function handler(req: any, res: any) {
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const now = new Date()

  const { data: spawns } = await db
    .from('skulporin_spawns')
    .select('*')
    .order('id', { ascending: false })
    .limit(10)

  const { count: dailyCount } = await db
    .from('skulporin_spawns')
    .select('id', { count: 'exact', head: true })
    .eq('spawn_date', now.toISOString().slice(0, 10))

  const { data: active } = await db
    .from('skulporin_spawns')
    .select('*')
    .eq('status', 'active')
    .gt('escapes_at', now.toISOString())
    .limit(1)
    .single()

  const { data: last } = await db
    .from('skulporin_spawns')
    .select('spawned_at, status')
    .order('spawned_at', { ascending: false })
    .limit(1)
    .single()

  const cooldownRemainMs = last
    ? Math.max(0, 20 * 60 * 1000 - (Date.now() - new Date(last.spawned_at).getTime()))
    : 0

  res.setHeader('Content-Type', 'application/json')
  return res.json({
    now: now.toISOString(),
    activeSpawn: active ?? null,
    lastSpawn: last ?? null,
    cooldownRemainSec: Math.ceil(cooldownRemainMs / 1000),
    dailyCount,
    recentSpawns: spawns ?? [],
  })
}
