import { supabase } from './supabase'

// お知らせ1件。body_html は ADMIN のリッチテキストエディタが生成する HTML。
export interface Announcement {
  id: number
  title: string
  body_html: string
  is_published: boolean
  published_at: string
  view_count: number
  created_at: string
  updated_at: string
}

/** 公開中のお知らせを新しい順で取得（プレイヤー向け） */
export async function fetchPublishedAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('ebt_announcements')
    .select('*')
    .eq('is_published', true)
    .order('published_at', { ascending: false })
    .limit(100)
  if (error) {
    console.warn('お知らせ取得失敗:', error.message)
    return []
  }
  return (data ?? []) as Announcement[]
}

// ── 未読判定（TOPの NEW バッジ用）。最後に一覧を開いた時刻を localStorage に保存する ──
const LAST_SEEN_KEY = 'et_news_last_seen'
const VIEWED_KEY    = 'et_news_viewed'

export function getLastSeen(): number {
  const v = localStorage.getItem(LAST_SEEN_KEY)
  return v ? Number(v) : 0
}

/** 一覧を開いた時点で「既読」にする（最新の published_at を保存） */
export function markAnnouncementsSeen(list: Announcement[]): void {
  const latest = list.reduce((max, a) => Math.max(max, Date.parse(a.published_at)), 0)
  if (latest > 0) localStorage.setItem(LAST_SEEN_KEY, String(latest))
}

/** 未読（最後に見た時刻より新しい公開お知らせ）があるか */
export async function hasUnreadAnnouncements(): Promise<boolean> {
  const list = await fetchPublishedAnnouncements()
  if (list.length === 0) return false
  const latest = Date.parse(list[0].published_at)
  return latest > getLastSeen()
}

/** 個別お知らせの未読判定（一覧の NEW タグ用） */
export function isUnread(a: Announcement): boolean {
  return Date.parse(a.published_at) > getLastSeen()
}

// ── VIEW数カウント（同一ブラウザ・1記事1回まで。水増し防止）──
function getViewedIds(): number[] {
  try { return JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '[]') } catch { return [] }
}

/** 詳細を開いたときに呼ぶ。未カウントの記事だけサーバーで view_count を+1する */
export async function registerView(id: number): Promise<void> {
  const viewed = getViewedIds()
  if (viewed.includes(id)) return
  viewed.push(id)
  localStorage.setItem(VIEWED_KEY, JSON.stringify(viewed))
  try {
    await fetch('/api/news-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  } catch (e) {
    console.warn('VIEW数送信失敗:', e)
  }
}
