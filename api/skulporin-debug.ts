export default async function handler(_req: any, res: any) {
  // createClient を呼ばず、環境変数の有無だけ返す（絶対にクラッシュしない診断）
  const env = {
    VITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    urlHead: (process.env.VITE_SUPABASE_URL ?? '').slice(0, 20),
  }

  // ここまで来れば関数自体は動いている
  let dbStatus = 'not-tested'
  let dbError: string | null = null
  if (env.VITE_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const db = createClient(
        process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      )
      const { error } = await db.from('skulporin_spawns').select('id').limit(1)
      if (error) { dbStatus = 'query-error'; dbError = error.message }
      else dbStatus = 'ok'
    } catch (e: any) {
      dbStatus = 'exception'
      dbError = e?.message ?? String(e)
    }
  }

  res.setHeader('Content-Type', 'application/json')
  return res.status(200).json({ env, dbStatus, dbError })
}
