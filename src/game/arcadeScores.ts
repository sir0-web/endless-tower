import { supabase, getPlayerId } from './supabase'
import { getDisplayName } from './playerName'

// げーせん「弾幕避け」のスコア（ebt_arcade_scores）：全プレイヤー共有ランキング。
// 生存時間(ms)が長いほど上位。テーブル未作成の環境でも登録/取得エラーはゲーム進行を止めない。
export interface ArcadeScoreEntry {
  id: number
  player_name: string
  time_ms: number
  created_at: string
}

// スコア登録はfire-and-forget（失敗してもミニゲームの結果画面は表示され続ける）
export async function submitArcadeScore(timeMs: number): Promise<void> {
  const { error } = await supabase.from('ebt_arcade_scores').insert({
    player_name: getDisplayName() || '（名無し）',
    player_id: getPlayerId(),
    time_ms: Math.round(timeMs),
  })
  if (error) console.warn('げーせんスコア登録エラー:', error.message)
}

export async function fetchArcadeRanking(limit = 10): Promise<ArcadeScoreEntry[]> {
  const { data, error } = await supabase
    .from('ebt_arcade_scores')
    .select('*')
    .order('time_ms', { ascending: false })
    .limit(limit)
  if (error) {
    console.warn('げーせんランキング取得エラー:', error.message)
    return []
  }
  return (data ?? []) as ArcadeScoreEntry[]
}
