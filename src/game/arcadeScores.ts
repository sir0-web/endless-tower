import { supabase, getPlayerId } from './supabase'
import { getDisplayName } from './playerName'

// げーせんの全ミニゲーム共通スコアテーブル（ebt_arcade_scores）：全プレイヤー共有ランキング。
// game列でミニゲームを区別する（dodge=だんまくよけ/tap=反射神経タップ/mole=モグラ叩き）。
// time_ms列はゲームによって意味が変わる「スコア値」の入れ物として流用する
//（dodge=生存ms、tap=平均反応ms、mole=撃破数）。列名はdodge由来だが、追加マイグレーションを避けるため共用する。
// テーブル/game列未作成の環境でも登録/取得エラーはゲーム進行を止めない。
export type ArcadeGameId = 'dodge' | 'tap' | 'mole'

export interface ArcadeScoreEntry {
  id: number
  player_name: string
  time_ms: number
  created_at: string
}

// スコア登録はfire-and-forget（失敗してもミニゲームの結果画面は表示され続ける）
export async function submitArcadeScore(game: ArcadeGameId, value: number): Promise<void> {
  const { error } = await supabase.from('ebt_arcade_scores').insert({
    player_name: getDisplayName() || '（名無し）',
    player_id: getPlayerId(),
    game,
    time_ms: Math.round(value),
  })
  if (error) console.warn('げーせんスコア登録エラー:', error.message)
}

// ascending=true のゲーム（反射神経タップ等、値が小さいほど上位）は昇順で取得する
export async function fetchArcadeRanking(game: ArcadeGameId, ascending: boolean, limit = 10): Promise<ArcadeScoreEntry[]> {
  const { data, error } = await supabase
    .from('ebt_arcade_scores')
    .select('*')
    .eq('game', game)
    .order('time_ms', { ascending })
    .limit(limit)
  if (error) {
    console.warn('げーせんランキング取得エラー:', error.message)
    return []
  }
  return (data ?? []) as ArcadeScoreEntry[]
}
