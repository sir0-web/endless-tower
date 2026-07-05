import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// ── 通信タイムアウト ──
// モバイル回線では応答が永久に返らないことがあり、await がハングすると
// GAME OVER画面の「登録中...」が固まったままになる。一定時間で必ず結果を返す。
// （元のリクエスト自体は中断しない。タイムアウト後に遅れて成功する可能性はあるが、
//   再送によるランキングの重複は表示上の実害が小さいため許容する）
const NET_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => { setTimeout(() => resolve(fallback), NET_TIMEOUT_MS) }),
  ])
}

export function submitRanking(
  playerName: string,
  floor: number,
  level: number,
  refineTotal = 0,
  jackpotWins = 0,
): Promise<string | null> {
  return withTimeout(
    submitRankingNow(playerName, floor, level, refineTotal, jackpotWins)
      .catch(() => '通信エラーが発生しました。もう一度お試しください'),
    '通信がタイムアウトしました。電波状況を確認して、もう一度お試しください',
  )
}

async function submitRankingNow(
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

export function fetchRanking() {
  // タイムアウト時は空配列を返す（登録成功後にここでハングすると
  // ランキング画面へ遷移できず固まって見えるため、必ず抜けられるようにする）
  return withTimeout(fetchRankingNow().catch(() => []), [])
}

async function fetchRankingNow() {
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