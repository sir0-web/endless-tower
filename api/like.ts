import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ovutdzjddrwbguwjwmuw.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

const GIVEN_DAILY_CAP = 20   // 1人が1日に送れるいいね数
const RECV_DAILY_CAP  = 30   // 1人が1日に報酬を受け取れるいいね数（複数アカ狙い撃ち対策）

const POTION_NAMES = ['黄ポーション', '白ポーション', '赤ポーション', 'スタミナポーション']

type Reward = { reward_type: 'potion' | 'coin' | 'point'; reward_name: string | null }

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

    // 1日上限（送る側）
    const { count: givenCount } = await db.from('likes')
      .select('id', { count: 'exact', head: true })
      .eq('from_player_id', from_player_id)
      .gte('created_at', since)
    if ((givenCount ?? 0) >= GIVEN_DAILY_CAP) {
      return res.json({ ok: false, reason: 'daily_limit', message: '今日のいいね上限に達しました' })
    }

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

    // 受け取り上限（超過なら相手への配布だけスキップ。押した本人はもらえる）
    const { count: recvCount } = await db.from('likes')
      .select('id', { count: 'exact', head: true })
      .eq('to_player_id', to_player_id)
      .gte('created_at', since)
    const deliverToTarget = (recvCount ?? 0) <= RECV_DAILY_CAP

    // 2人ぶん抽選（サーバー権威）
    const likerReward = rollReward()
    const likeeReward = rollReward()

    // 相手ぶんを保留キューへ（次プレイ時のheartbeatで受け取り）
    if (deliverToTarget) {
      await db.from('like_rewards').insert({
        to_player_id,
        from_name: from_name ?? '冒険者',
        reward_type: likeeReward.reward_type,
        reward_name: likeeReward.reward_name,
      })
    }

    return res.json({ ok: true, reward: likerReward, to_name: to_name ?? '冒険者' })
  } catch (e: any) {
    console.error('[like] exception', e)
    return res.json({ ok: false, reason: 'error' })
  }
}
