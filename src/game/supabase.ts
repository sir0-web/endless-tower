import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

export async function submitRanking(
  playerName: string,
  floor: number,
  level: number,
  refineTotal = 0,
  jackpotWins = 0,
): Promise<string | null> {
  // 精錬値合計・ジャックポット当選回数を含めて登録。
  const { error } = await supabase
    .from('ebt_rankings')
    .insert({ player_name: playerName, floor, level, refine_total: refineTotal, jackpot_wins: jackpotWins })

  if (error) {
    // 新カラム（refine_total / jackpot_wins）未追加の環境ではここで失敗するため、
    // 基本項目のみで再送してランキング登録自体は止めない（マイグレーション前の保険）。
    const { error: retryError } = await supabase
      .from('ebt_rankings')
      .insert({ player_name: playerName, floor, level })
    if (retryError) {
      console.error('ランキング登録エラー:', retryError)
      return retryError.message
    }
    console.warn('ランキング: 新カラム未追加のため基本項目のみで登録しました', error.message)
    return null
  }
  return null
}

// ── プレイヤー識別（匿名UUID。同じブラウザ＝同じ player_id として集計可能）──
const PLAYER_ID_KEY = 'et_player_id'
export function getPlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(PLAYER_ID_KEY, id)
  }
  return id
}

// ── 行動ログ（バランス調整の統計用。fire-and-forget でゲーム進行を妨げない）──
type GameEventType = 'floor_reached' | 'slot_result' | 'death' | 'kill'
interface GameEventPayload {
  floor?: number
  level?: number
  slot_result?: string
  enemy_name?: string
  is_boss?: boolean
}

export function logEvent(eventType: GameEventType, payload: GameEventPayload = {}): void {
  void supabase
    .from('game_events')
    .insert({ player_id: getPlayerId(), event_type: eventType, ...payload })
    .then(({ error }) => {
      if (error) console.warn('行動ログ送信失敗:', error.message)
    })
}

export async function fetchRanking() {
  const { data, error } = await supabase
    .from('ebt_rankings')
    .select('*')
    .order('floor', { ascending: false })
    .limit(30)
  
  if (error) {
    console.error('ランキング取得エラー:', error)
    return []
  }
  return data
}