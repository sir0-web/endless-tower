import { supabase, getPlayerId } from './supabase'
import { getDisplayName } from './playerName'

export type WorldNotifType = 'world' | 'boss' | 'achievement' | 'system' | 'event' | 'maintenance'

// 1ラン内の重複防止（レベル/階層マイルストーン用）。新規ゲーム開始時に resetWorldNotifyDedup() でクリアする。
const sent = new Set<string>()
export function resetWorldNotifyDedup(): void { sent.clear() }

/**
 * ワールド通知を Supabase に INSERT する。fire-and-forget（await しない）でゲーム進行を絶対に止めない。
 * dedupKey を渡すと、同一ラン内では同じキーの通知を1度しか送らない。
 */
export function fireWorldNotification(
  type: WorldNotifType,
  title: string,
  message: string,
  dedupKey?: string,
): void {
  // ローカル開発中（npm run dev）はテストプレイが本番のワールド通知欄を荒らさないよう送信しない
  if (import.meta.env.DEV) return
  if (dedupKey) {
    if (sent.has(dedupKey)) return
    sent.add(dedupKey)
  }
  void supabase
    .from('world_notifications')
    .insert({ type, title, message, player_name: getDisplayName(), player_id: getPlayerId() })
    .then(({ error }) => { if (error) console.warn('world_notify失敗:', error.message) })
}
