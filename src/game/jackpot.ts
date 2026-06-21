import { supabase } from './supabase'

// ── 全鯖共有プログレッシブ・ジャックポット ──
// 全プレイヤーのスロット回転がひとつのプール(pool)に積み上がり、
// ジャックポット絵柄(3つ揃い)を引いた人がプールを総取りする。
// プールの増減は Supabase の RPC(increment_jackpot / claim_jackpot)で原子的に行い、
// 値の同期は ebt_jackpot テーブルの Realtime(UPDATE)で全クライアントへ配る。

let pool = 0
type Listener = (pool: number) => void
const listeners = new Set<Listener>()
let channel: ReturnType<typeof supabase.channel> | null = null
let refCount = 0

function emit() { listeners.forEach(l => l(pool)) }

async function fetchInitial() {
  const { data, error } = await supabase
    .from('ebt_jackpot')
    .select('pool')
    .eq('id', 1)
    .single()
  if (error) { console.warn('jackpot取得失敗:', error.message); return }
  if (data && typeof data.pool === 'number') { pool = data.pool; emit() }
}

function start() {
  void fetchInitial()
  channel = supabase
    .channel('jackpot')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'ebt_jackpot' },
      (p) => {
        const row = p.new as { pool?: number }
        if (typeof row.pool === 'number') { pool = row.pool; emit() }
      },
    )
    .subscribe()
}

function stop() {
  if (channel) { supabase.removeChannel(channel); channel = null }
}

/** プールの監視を開始（参照カウント+1。最初の1人で購読を張る）。 */
export function acquireJackpot(): void {
  refCount++
  if (refCount === 1) start()
}

/** プールの監視を終了（参照カウント-1。最後の1人で購読を解除）。 */
export function releaseJackpot(): void {
  refCount = Math.max(0, refCount - 1)
  if (refCount === 0) stop()
}

/** プール更新の購読。登録時に現在値を即時に渡す。購読解除関数を返す。 */
export function onJackpot(l: Listener): () => void {
  listeners.add(l)
  l(pool)
  return () => { listeners.delete(l) }
}

/** 現在のプール値（同期的に参照したいとき用）。 */
export function getJackpotPool(): number { return pool }

/**
 * スロットが回るたびにプールへ加算する。fire-and-forget でゲーム進行を止めない。
 * RPC のレスポンスで自分のローカル値も更新する（他クライアントへは Realtime で伝播）。
 */
export function incrementJackpot(amount = 1): void {
  void supabase
    .rpc('increment_jackpot', { amount })
    .then(({ data, error }) => {
      if (error) { console.warn('jackpot加算失敗:', error.message); return }
      if (typeof data === 'number') { pool = data; emit() }
    })
}

/**
 * ジャックポット成立時にプールを総取りする。総取りした額(リセット前のpool)を返す。
 * 同時成立しても row lock により1人だけが満額、他は0になる（原子的）。
 */
export async function claimJackpot(): Promise<number> {
  const { data, error } = await supabase.rpc('claim_jackpot')
  if (error) { console.warn('jackpot獲得失敗:', error.message); return 0 }
  const won = typeof data === 'number' ? data : 0
  // 自分のローカル値も即0へ（Realtime が届く前のチラつき防止）
  if (won > 0) { pool = 0; emit() }
  return won
}
