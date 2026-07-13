import { supabase } from './supabase'
import type { WorldNotifType } from './worldNotify'

export interface WorldNotif {
  id: number
  type: WorldNotifType
  title: string
  message: string
  player_name: string | null
  player_id: string | null
  display_ms: number | null
  created_at: string
}

type NewListener = (n: WorldNotif) => void
type LogListener = (log: WorldNotif[]) => void

const MAX_LOG = 100

// ── 単一の Realtime チャンネルを Telop / Log で共有する。参照カウントで購読を1本に保つ ──
let log: WorldNotif[] = []
const newListeners = new Set<NewListener>()
const logListeners = new Set<LogListener>()
let channel: ReturnType<typeof supabase.channel> | null = null
let refCount = 0

function emitNew(n: WorldNotif) { newListeners.forEach(l => l(n)) }
function emitLog() { logListeners.forEach(l => l(log)) }

async function fetchInitial() {
  const { data, error } = await supabase
    .from('world_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(MAX_LOG)
  if (error) { console.warn('world_log取得失敗:', error.message); return }
  if (data) { log = data as WorldNotif[]; emitLog() }
}

function start() {
  if (channel) return
  void fetchInitial()
  channel = supabase
    .channel('world_notif')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'world_notifications' },
      (p) => {
        const partial = p.new as { id: number }
        // Realtime ペイロードは display_ms 等の列を省略することがあるため、フル行を取得する
        void supabase
          .from('world_notifications')
          .select('*')
          .eq('id', partial.id)
          .single()
          .then(({ data }) => {
            const n = (data ?? p.new) as WorldNotif
            log = [n, ...log].slice(0, MAX_LOG)
            emitNew(n)
            emitLog()
          })
      },
    )
    .subscribe()
}

function stop() {
  if (channel) { supabase.removeChannel(channel); channel = null }
}

// ── バックグラウンド時はWebSocket購読を切って発熱・電池消費を抑える ──
// 復帰時は start() が fetchInitial() でログを取り直すため、非表示中の取りこぼしは
// ワールドログ側では復元される（テロップは非表示中の分だけ流れないが、見えていないので実害なし）。
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stop()
    } else if (refCount > 0) {
      start()
    }
  })
}

/** フィードの利用開始（参照カウント+1。最初の1人で購読を張る）。 */
export function acquireFeed(): void {
  refCount++
  // 非表示中に購読者が現れても張らない（復帰時のvisibilitychangeで張る）
  if (refCount === 1 && !document.hidden) start()
}

/** フィードの利用終了（参照カウント-1。最後の1人で購読を解除）。 */
export function releaseFeed(): void {
  refCount = Math.max(0, refCount - 1)
  if (refCount === 0) stop()
}

/** 新着通知（テロップ用）。購読解除関数を返す。 */
export function onNewNotif(l: NewListener): () => void {
  newListeners.add(l)
  return () => { newListeners.delete(l) }
}

/** ログ更新（ワールドログ用）。登録時に現在のログを即時に渡す。購読解除関数を返す。 */
export function onLogUpdate(l: LogListener): () => void {
  logListeners.add(l)
  l(log)
  return () => { logListeners.delete(l) }
}
