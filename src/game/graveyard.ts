import { supabase } from './supabase'

// 墓標（ebt_graveyard）：全プレイヤー共有の死亡記録。ゲームオーバー画面下部に一覧表示し、
// 「誰が・どの階で・何に倒され・魂がどうなったか（ドッペルゲンガー化／浄化）」を他プレイヤーにも共有する。
export type SoulFate = 'doppelganger' | 'purified'

export interface GraveyardEntry {
  id: number
  player_name: string
  floor: number
  death_cause: string
  soul: SoulFate
  created_at: string
}

// 墓標登録はfire-and-forget（失敗してもゲームオーバー画面の進行は妨げない）
export async function submitGraveyardEntry(
  playerName: string,
  floor: number,
  deathCause: string,
  soul: SoulFate,
): Promise<void> {
  const { error } = await supabase.from('ebt_graveyard').insert({
    player_name: playerName || '（名無し）',
    floor,
    death_cause: deathCause,
    soul,
  })
  if (error) console.warn('墓標登録エラー:', error.message)
}

export async function fetchGraveyard(limit = 8): Promise<GraveyardEntry[]> {
  const { data, error } = await supabase
    .from('ebt_graveyard')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.warn('墓標取得エラー:', error.message)
    return []
  }
  return (data ?? []) as GraveyardEntry[]
}

// 全世界死亡総数（AdminツールのStatsタブと同じ集計元：game_eventsのevent_type='death'件数）
export async function fetchTotalDeathCount(): Promise<number | null> {
  const { count, error } = await supabase
    .from('game_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'death')
  if (error) {
    console.warn('死亡総数取得エラー:', error.message)
    return null
  }
  return count ?? 0
}

// ── 未読判定（あるかなひろばの墓標の「！」マーク用）──
// 全プレイヤー共有データなので、signboardUnreadのようなセーブデータではなく
// ブラウザ単位のlocalStorageで「最後に見た墓標id」を管理する。
const LAST_SEEN_KEY = 'et_graveyard_last_seen_id'

export function getLastSeenGraveyardId(): number {
  return Number(localStorage.getItem(LAST_SEEN_KEY) ?? '0')
}

export function setLastSeenGraveyardId(id: number): void {
  localStorage.setItem(LAST_SEEN_KEY, String(id))
}

// 未読判定専用の軽量取得（最新1件のidのみ）
export async function fetchLatestGraveyardId(): Promise<number | null> {
  const { data, error } = await supabase
    .from('ebt_graveyard')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) return null
  return data[0].id
}
