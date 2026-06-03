import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

export async function submitRanking(playerName: string, floor: number) {
  const { error } = await supabase
    .from('rankings')
    .insert({ player_name: playerName, floor })
  
  if (error) console.error('ランキング登録エラー:', error)
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