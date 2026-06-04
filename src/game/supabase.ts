import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

export async function submitRanking(playerName: string, floor: number, level: number): Promise<string | null> {
  const { error } = await supabase
    .from('rankings')
    .insert({ player_name: playerName, floor, level })

  if (error) {
    console.error('ランキング登録エラー:', error)
    return error.message
  }
  return null
}

export async function fetchRanking() {
  const { data, error } = await supabase
    .from('rankings')
    .select('*')
    .order('floor', { ascending: false })
    .limit(10)
  
  if (error) {
    console.error('ランキング取得エラー:', error)
    return []
  }
  return data
}