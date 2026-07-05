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

// ── NEW 判定：掲載24時間以内 かつ このブラウザで未閲覧 ──
const RECENT_MS  = 24 * 60 * 60 * 1000
const VIEWED_KEY = 'et_news_viewed'   // このブラウザで詳細を開いた記事ID（VIEW重複防止と兼用）

function getViewedIds(): number[] {
  try { return JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '[]') } catch { return [] }
}

/** このブラウザで一度でも詳細を開いたか */
export function isViewed(id: number): boolean {
  return getViewedIds().includes(id)
}

/** 掲載から24時間以内か（時間条件のみ） */
export function isRecent(a: Announcement): boolean {
  return Date.now() - Date.parse(a.published_at) < RECENT_MS
}

/** NEW表示するか：掲載24時間以内 かつ このブラウザで未閲覧 */
export function isNew(a: Announcement): boolean {
  return isRecent(a) && !isViewed(a.id)
}

/** NEW対象（24時間以内・未閲覧）の投稿があるか（TOPの NEW バッジ用） */
export async function hasNewAnnouncement(): Promise<boolean> {
  const list = await fetchPublishedAnnouncements()
  return list.some(isNew)
}

// ── GAME START時の「未読お知らせ」ゲート ──
// isNew と違い24時間で消える一時的な目印ではなく、既読にするまで消えない「未読」状態を扱う。
// この機能の導入前に掲載されていた記事まで遡って強制既読を求めないよう、導入以降の掲載分のみ対象にする。
const GATE_SINCE_MS = Date.parse('2026-07-05T00:00:00+09:00')

function isGateTarget(a: Announcement): boolean {
  return Date.parse(a.published_at) >= GATE_SINCE_MS
}

/** GAME START時にモーダルで警告すべき「未読」があるか */
export async function hasUnreadAnnouncement(): Promise<boolean> {
  const list = await fetchPublishedAnnouncements()
  return list.some(a => isGateTarget(a) && !isViewed(a.id))
}

/**
 * 一覧に表示中の記事をまとめて既読にする（未読を1件ずつ開かず一気に解消するための機能）。
 * 個別に開いていないため view_count（実際に開かれた回数の指標）は増やさず、
 * このブラウザの既読状態だけをローカルで更新する。
 */
export function markAllAsRead(ids: number[]): void {
  const viewed = new Set(getViewedIds())
  for (const id of ids) viewed.add(id)
  localStorage.setItem(VIEWED_KEY, JSON.stringify([...viewed]))
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
