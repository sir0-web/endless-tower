import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// =======================
// 🎯 ランキング
// =======================

export interface RankingEntry {
  player_name: string
  floor: number
  max_level: number
  created_at?: string
}

// 送信
export async function submitRanking(
  player_name: string,
  floor: number,
  max_level: number
): Promise<string | null> {
  const { error } = await supabase
    .from('ebt_rankings')
.insert({
  player_name,
  floor,
  level,
})

  if (error) {
    console.error('ランキング登録エラー:', error)
    return error.message
  }

  return null
}

// 取得
export async function fetchRanking(): Promise<RankingEntry[]> {
  const { data, error } = await supabase
    .from('ebt_rankings')
    .select('player_name, floor, max_level, created_at')
    .order('floor', { ascending: false })
    .limit(10)

  if (error) {
    console.error('ランキング取得エラー:', error)
    return []
  }

  return (data ?? []) as RankingEntry[]
}

// =======================
// 👤 プレイヤーID
// =======================

const PLAYER_ID_KEY = 'et_player_id'

export function getPlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(PLAYER_ID_KEY, id)
  }
  return id
}

// =======================
// 📊 行動ログ
// =======================

type GameEventType =
  | 'floor_reached'
  | 'slot_result'
  | 'death'
  | 'kill'

interface GameEventPayload {
  floor?: number
  level?: number   
  slot_result?: string
  enemy_name?: string
  is_boss?: boolean
}

export function logEvent(
  eventType: GameEventType,
  payload: GameEventPayload = {}
): void {
  void supabase
    .from('game_events')
    .insert({
      player_id: getPlayerId(),
      event_type: eventType,
      ...payload,
    })
    .then(({ error }) => {
      if (error) console.warn('行動ログ送信失敗:', error.message)
    })
}
