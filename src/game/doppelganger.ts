import { supabase, getPlayerId } from './supabase'
import type { Player, Equipment } from '../types'

// ドッペルゲンガー：GAME OVER画面で「ドッペルゲンガーとして生き続ける」を選ぶと、
// 生前のステータス・装備のまま死亡階の記録が登録される。以降、他プレイヤーが
// （死亡階±10階・10階未満は対象外）を通過した際、1階につき1体まで30%の確率で
// モンスターとして出現する。撃破すると生前に獲得したステータスポイントをまるごと
// 受け継げるが、DBの記録自体は削除しない（撃破した本人のその周回中だけ再出現しない。
// 記録は10階バンドごとの保持上限に達するまで、他プレイヤーや次回以降の周回に対して
// 何度でも出現候補であり続ける）。
// DBは ebt_doppelgangers（docs/doppelganger-setup.md参照、匿名insert/select許可）。

const SPAWN_FLOOR_RANGE = 10   // 死亡階からこの階数以内なら出現候補になる
const MIN_SPAWN_FLOOR   = 10   // これ未満の階には出現しない
const RETENTION_PER_BAND = 10  // 10階バンドごとに保持する最大件数（超過分は古い順に削除）

export interface DoppelgangerRecord {
  id: number
  player_id: string
  player_name: string
  floor: number
  level: number
  str: number
  agi: number
  dex: number
  intelligence: number
  vit: number
  luk: number
  max_hp: number
  stat_point_reward: number
  equipment: Equipment | null
}

/**
 * GAME OVER画面で「はい」を選んだ時に登録する。生涯累計で獲得したステータスポイントを
 * 撃破報酬として記録し、10階バンドごとの保持上限（最新10体）を超えた分は古い順に削除する。
 * fire-and-forget想定（失敗してもゲーム進行を妨げない）。
 */
export async function registerDeadCharacter(playerName: string, player: Player): Promise<void> {
  const reward = Math.max(0, Math.floor(player.totalStatPointsEarned ?? player.statPoints ?? 0))
  const floor = player.floor

  const { error } = await supabase.from('ebt_doppelgangers').insert({
    player_id: getPlayerId(),
    player_name: playerName,
    floor,
    level: player.level,
    str: player.str, agi: player.agi, dex: player.dex, intelligence: player.int, vit: player.vit, luk: player.luk,
    max_hp: player.maxHp,
    stat_point_reward: reward,
    equipment: player.equipment,
  })
  if (error) {
    console.warn('ドッペルゲンガー情報の登録に失敗:', error.message)
    return
  }

  // 保持上限：この階が属する10階バンド内で最新10体のみ残し、古いものから削除する
  try {
    const bandEnd   = Math.ceil(floor / RETENTION_PER_BAND) * RETENTION_PER_BAND
    const bandStart = bandEnd - RETENTION_PER_BAND
    const { data } = await supabase
      .from('ebt_doppelgangers')
      .select('id, created_at')
      .gt('floor', bandStart)
      .lte('floor', bandEnd)
      .order('created_at', { ascending: true })
    if (data && data.length > RETENTION_PER_BAND) {
      const toDelete = data.slice(0, data.length - RETENTION_PER_BAND).map(d => d.id)
      await supabase.from('ebt_doppelgangers').delete().in('id', toDelete)
    }
  } catch (e) {
    console.warn('ドッペルゲンガー保持上限の整理に失敗:', e)
  }
}

/**
 * 現在階±10階（10階未満は対象外）の記録からランダムに1件返す（自分自身の記録・
 * 引数で渡された「この周回で既に撃破済み」のIDは除外）。無ければnull。
 * 1回のフロア到達につき1体のみの抽選に使う想定。
 */
export async function fetchDoppelgangerCandidate(
  floor: number,
  excludeIds: ReadonlySet<number> = new Set(),
): Promise<DoppelgangerRecord | null> {
  if (floor < MIN_SPAWN_FLOOR) return null
  try {
    const { data, error } = await supabase
      .from('ebt_doppelgangers')
      .select('*')
      .gte('floor', floor - SPAWN_FLOOR_RANGE)
      .lte('floor', floor + SPAWN_FLOOR_RANGE)
      .neq('player_id', getPlayerId())
      .limit(50)
    if (error || !data || data.length === 0) return null
    const candidates = (data as DoppelgangerRecord[]).filter(r => !excludeIds.has(r.id))
    if (candidates.length === 0) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  } catch {
    return null
  }
}
