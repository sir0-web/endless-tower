import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ovutdzjddrwbguwjwmuw.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

const GIVEN_DAILY_CAP = 20   // 1人が1日に送れるいいね数
const RECV_DAILY_CAP  = 30   // 1人が1日に報酬を受け取れるいいね数（複数アカ狙い撃ち対策）

const POTION_NAMES = ['黄ポーション', '白ポーション', '赤ポーション', 'スタミナポーション']

type Reward = { reward_type: 'potion' | 'coin' | 'point' | 'none'; reward_name: string | null }

// ポーション70% / 女神のコイン28% / 1ポイント2%
function rollReward(): Reward {
  const r = Math.random()
  if (r < 0.02)        return { reward_type: 'point',  reward_name: null }
  if (r < 0.02 + 0.28) return { reward_type: 'coin',   reward_name: '女神のコイン' }
  return { reward_type: 'potion', reward_name: POTION_NAMES[Math.floor(Math.random() * POTION_NAMES.length)] }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!SERVICE_KEY) return res.status(500).json({ ok: false, reason: 'service key missing' })

  const { notification_id, from_player_id, from_name, to_player_id, to_name } = req.body ?? {}
  if (typeof notification_id !== 'number' || !from_player_id || !to_player_id) {
    return res.status(400).json({ ok: false, reason: 'invalid params' })
  }
  if (from_player_id === to_player_id) {
    return res.json({ ok: false, reason: 'self', message: '自分にはいいねできません' })
  }
  if (to_player_id === 'system' || to_player_id === 'admin-broadcast') {
    return res.json({ ok: false, reason: 'not_likeable', message: 'この通知にはいいねできません' })
  }

  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // 送る側の1日上限：超えても「いいね」自体は通す（報酬の有無だけ切り替え）。
    // 上限超過時はアイテム無しの“通知のみ”＝コミュニケーションとして成立させる。
    const { count: givenCount } = await db.from('likes')
      .select('id', { count: 'exact', head: true })
      .eq('from_player_id', from_player_id)
      .gte('created_at', since)
    const senderOverCap = (givenCount ?? 0) >= GIVEN_DAILY_CAP

    // 二度押し防止：likes にINSERT（unique(notification_id, from_player_id) 違反＝いいね済み）
    const { error: likeErr } = await db.from('likes').insert({
      notification_id,
      from_player_id,
      from_name: from_name ?? null,
      to_player_id,
      to_name: to_name ?? null,
    })
    if (likeErr) {
      if (likeErr.code === '23505') {
        return res.json({ ok: false, reason: 'already', message: 'もういいね済みです' })
      }
      console.error('[like] insert error', likeErr)
      return res.json({ ok: false, reason: 'error' })
    }

    // 受け取る側の1日上限：超えても通知は必ず届ける（報酬の有無だけ切り替え）。
    const { count: recvCount } = await db.from('likes')
      .select('id', { count: 'exact', head: true })
      .eq('to_player_id', to_player_id)
      .gte('created_at', since)
    const recvOverCap = (recvCount ?? 0) > RECV_DAILY_CAP

    // 上限内は通常抽選、上限超過は「報酬なし＝通知のみ」
    const NO_REWARD: Reward = { reward_type: 'none', reward_name: null }
    const likerReward = senderOverCap ? NO_REWARD : rollReward()
    const likeeReward = recvOverCap   ? NO_REWARD : rollReward()

    // 相手へは常に1件入れて「いいねされた」通知を必ず届ける（報酬は上限内のときだけ実物）
    const { error: rewardErr } = await db.from('like_rewards').insert({
      to_player_id,
      from_name: from_name ?? '冒険者',
      reward_type: likeeReward.reward_type,
      reward_name: likeeReward.reward_name,
    })
    if (rewardErr) console.error('[like] reward insert error', rewardErr)

    return res.json({ ok: true, reward: likerReward, to_name: to_name ?? '冒険者' })
  } catch (e: any) {
    console.error('[like] exception', e)
    return res.json({ ok: false, reason: 'error' })
  }
}
