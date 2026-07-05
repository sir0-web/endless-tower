import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { MONSTER_REGISTRY } from '../game/dungeon'
import { RichTextEditor, RichTextView } from './RichText'
import type { Announcement } from '../game/announcements'
import {
  NORMAL_MONSTERS, MINI_BOSSES, MVP_BOSSES, AREA_BOSSES,
  EQUIPMENT, SPELLS, EQUIP_BONUS_LABELS, EQUIP_SLOT_LABELS,
} from '../game/catalog'
import { HEAL_ITEMS, WING_ITEMS } from '../game/items'
import type { OverrideCategory } from '../game/overrides'
import { enemyImagePath, ENEMY_FALLBACK_COLOR } from '../game/enemyTextures'

// 編集フォームのフィールド定義（カテゴリ別）。type: text=文字 / num=数値 / area=複数行
const DB_SCHEMA: Record<OverrideCategory, { fields: { key: string; label: string; type: 'text' | 'num' | 'area' }[]; image: boolean }> = {
  monster_normal: { image: true, fields: [
    { key: 'name', label: '名前', type: 'text' }, { key: 'minFloor', label: '出現F(最小)', type: 'num' }, { key: 'maxFloor', label: '出現F(最大)', type: 'num' },
    { key: 'hpBase', label: 'HP', type: 'num' }, { key: 'atkBase', label: 'ATK', type: 'num' }, { key: 'defBase', label: 'DEF', type: 'num' },
    { key: 'str', label: 'STR', type: 'num' }, { key: 'vit', label: 'VIT', type: 'num' }, { key: 'agi', label: 'AGI', type: 'num' }, { key: 'luk', label: 'LUK', type: 'num' },
  ] },
  monster_mini: { image: true, fields: [
    { key: 'name', label: '名前', type: 'text' }, { key: 'hpMult', label: 'HP倍率', type: 'num' }, { key: 'atkMult', label: 'ATK倍率', type: 'num' }, { key: 'defMult', label: 'DEF倍率', type: 'num' },
  ] },
  monster_mvp: { image: true, fields: [
    { key: 'name', label: '名前', type: 'text' }, { key: 'hpMult', label: 'HP倍率', type: 'num' }, { key: 'atkMult', label: 'ATK倍率', type: 'num' }, { key: 'defMult', label: 'DEF倍率', type: 'num' },
  ] },
  monster_area: { image: true, fields: [
    { key: 'name', label: '名前', type: 'text' }, { key: 'minFloor', label: '出現F(最小)', type: 'num' }, { key: 'maxFloor', label: '出現F(最大)', type: 'num' },
  ] },
  equip: { image: false, fields: [
    { key: 'name', label: '名前', type: 'text' }, { key: 'minFloor', label: '最低F', type: 'num' },
    { key: 'hpBonus', label: 'HP', type: 'num' }, { key: 'strBonus', label: 'STR', type: 'num' }, { key: 'agiBonus', label: 'AGI', type: 'num' },
    { key: 'dexBonus', label: 'DEX', type: 'num' }, { key: 'intBonus', label: 'INT', type: 'num' }, { key: 'vitBonus', label: 'VIT', type: 'num' }, { key: 'lukBonus', label: 'LUK', type: 'num' },
  ] },
  item: { image: false, fields: [
    { key: 'name', label: '名前', type: 'text' }, { key: 'healAmount', label: 'HP回復', type: 'num' }, { key: 'staminaPercent', label: 'スタミナ回復%', type: 'num' },
    { key: 'cost', label: 'コイン枚数(羽)', type: 'num' }, { key: 'desc', label: '説明(羽)', type: 'text' },
  ] },
  spell: { image: false, fields: [
    { key: 'name', label: '名前', type: 'text' }, { key: 'effect', label: '効果', type: 'area' },
  ] },
}

const PROD_URL = import.meta.env.VITE_SUPABASE_URL as string
const PROD_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY as string | undefined
const LOCAL_URL = 'http://localhost:54321'
const LOCAL_DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqp8La5JAmZB9bFTJFa3o-PxnRmmHzM_s'

type EnvMode = 'production' | 'local'
type Tab = 'maintenance' | 'message' | 'dm' | 'event' | 'ranking' | 'worldlog' | 'users' | 'reports' | 'stats' | 'news' | 'database'
type DbTab = 'monster' | 'equip' | 'item' | 'spell'

interface OnlinePlayer { player_id: string; player_name: string; floor: number; updated_at: string }

interface MaintenanceWindow { from: number; to: number | null }
interface RankingEntry { id: number; player_name: string; floor: number; level: number; created_at: string }
interface WorldNotif { id: number; type: string; title: string; message: string; player_name: string; created_at: string }
interface EditingRanking { id: number; player_name: string; floor: number; level: number }

// active_sessions.state に保存されるプレイヤー状態スナップショット（心拍で同期）
interface PlayerStateSnapshot {
  level: number; exp: number; hp: number; maxHp: number; stamina: number; maxStamina: number
  floor: number; turn: number
  str: number; agi: number; dex: number; int: number; vit: number; luk: number; statPoints: number
  equipment: { slot: string; name: string; refine: number }[]
  spells: string[]
  heals: { name: string; count: number }[]
  bagEquip: { name: string; refine: number }[]
}
interface PlayerSession {
  player_id: string; player_name: string; floor: number; updated_at: string
  state: PlayerStateSnapshot | null
}

interface Report {
  id: number; category: string; content: string
  player_name: string | null; image_url: string | null
  status: 'new' | 'read' | 'done'; created_at: string
}

async function adminDelete(table: string, ids: number[]): Promise<{ deleted?: number; error?: string }> {
  try {
    const res = await fetch('/api/admin-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, ids, adminKey: ADMIN_KEY }),
    })
    const json = await res.json()
    if (!res.ok) return { error: json.error ?? `HTTP ${res.status}` }
    return json
  } catch (e) {
    return { error: String(e) }
  }
}

const JST = 9 * 60 * 60 * 1000
function fromJstInput(s: string): number { return new Date(s + ':00.000Z').getTime() - JST }
function fmtJst(ms: number): string { return new Date(ms + JST).toISOString().replace('T', ' ').slice(0, 16) }
function fmtJstDate(iso: string): string { return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) }
function winActive(w: MaintenanceWindow, now: number): boolean { return now >= w.from && (w.to === null || now < w.to) }
function winPast(w: MaintenanceWindow, now: number): boolean { return w.to !== null && now >= w.to }

// モンスター詳細パネル用：ゲーム内で実際に表示されている見た目をプレビューする。
// 優先順位は「公開中の上書き画像 → 静的アセット → 代替表示（カテゴリ色の塗りブロック）」で、
// ゲーム本体の解決順（ovr_* > enemies/<key>.png > 色矩形フォールバック）に一致させている。
function GameAppearancePreview({ category, refName, pubImage }: { category: OverrideCategory; refName: string; pubImage: string | null }) {
  const [imgError, setImgError] = useState(false)
  const staticPath = enemyImagePath(refName)
  const src = pubImage || staticPath
  const fallbackColor = ENEMY_FALLBACK_COLOR[category] ?? '#ff4444'
  const sourceLabel = !src || imgError
    ? '代替表示（画像なし→色ブロック）'
    : pubImage ? '公開中の上書き画像' : '静的アセット'
  return (
    <div style={{ marginTop: 12 }}>
      <label style={S.label}>ゲーム内表示プレビュー（{sourceLabel}）</label>
      {src && !imgError ? (
        // 透過が見やすいよう市松模様の上に重ねる
        <div style={{ display: 'inline-block', padding: 6, borderRadius: 6, border: '1px solid #2a2a4a',
          backgroundColor: '#2a2a3a',
          backgroundImage: 'linear-gradient(45deg,#3a3a4a 25%,transparent 25%,transparent 75%,#3a3a4a 75%),linear-gradient(45deg,#3a3a4a 25%,transparent 25%,transparent 75%,#3a3a4a 75%)',
          backgroundSize: '16px 16px', backgroundPosition: '0 0,8px 8px' }}>
          <img src={src} alt={refName} onError={() => setImgError(true)}
            style={{ display: 'block', maxWidth: 120, maxHeight: 120, imageRendering: 'pixelated' }} />
        </div>
      ) : (
        // 画像が無い敵をゲームが描画する代替表示（カテゴリ色の塗りつぶし矩形）を再現
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 64, height: 64, background: fallbackColor, borderRadius: 4, border: '1px solid #00000055' }} />
          <span style={{ fontSize: 12, color: '#888' }}>
            画像未登録のため、ゲーム内ではこの色の四角で表示されます。
          </span>
        </div>
      )}
    </div>
  )
}

export function AdminPanel() {
  const [authed, setAuthed] = useState(false)
  const [pw, setPw]         = useState('')
  const [tab, setTab]       = useState<Tab>('maintenance')

  // ── 環境 ──
  const [envMode, setEnvMode]           = useState<EnvMode>('production')
  const [serviceKey, setServiceKey]     = useState('')
  const [localKey, setLocalKey]         = useState(LOCAL_DEFAULT_KEY)
  const [showEnvPanel, setShowEnvPanel] = useState(false)

  const db = useMemo<SupabaseClient>(() => {
    const url = envMode === 'local' ? LOCAL_URL : PROD_URL
    const key = serviceKey.trim() || (envMode === 'local' ? localKey : PROD_KEY)
    return createClient(url, key)
  }, [envMode, serviceKey, localKey])

  // ── Maintenance ──
  const [windows, setWindows]       = useState<MaintenanceWindow[]>([])
  const [mLoading, setMLoading]     = useState(false)
  const [mSaving, setMSaving]       = useState(false)
  const [mMsg, setMMsg]             = useState('')
  const [newFrom, setNewFrom]       = useState('')
  const [newTo, setNewTo]           = useState('')
  const [mHeading, setMHeading]     = useState('より良いゲームをお届けするために\nスタッフが鋭意準備中です')
  const [mLead, setMLead]           = useState('⏰次回のオープンβテスト期間⏰')
  const [mNote, setMNote]           = useState('このページは開いたままお待ちください。\n自動で更新されます。')
  const [mMsgSaving, setMMsgSaving] = useState(false)
  const [mMsgResult, setMMsgResult] = useState('')

  // ── Message ──
  const [msgType, setMsgType]             = useState('system')
  const [msgTitle, setMsgTitle]           = useState('')
  const [msgBody, setMsgBody]             = useState('')
  const [msgDisplaySec, setMsgDisplaySec] = useState('4')
  const [msgSending, setMsgSending]       = useState(false)
  const [msgResult, setMsgResult]         = useState('')

  // ── Ranking ──
  const [rankings, setRankings]           = useState<RankingEntry[]>([])
  const [rLoading, setRLoading]           = useState(false)
  const [rSearch, setRSearch]             = useState('')
  const [rMsg, setRMsg]                   = useState('')
  const [editingRanking, setEditingRanking] = useState<EditingRanking | null>(null)

  // ── World Log ──
  const [wlogs, setWlogs]     = useState<WorldNotif[]>([])
  const [wlLoading, setWlLoading] = useState(false)
  const [wlSearch, setWlSearch]   = useState('')
  const [wlType, setWlType]       = useState('')
  const [wlMsg, setWlMsg]         = useState('')

  // ── User Management ──
  const [uSearch, setUSearch]     = useState('')
  const [uSearched, setUSearched] = useState('')
  const [uRankings, setURankings] = useState<RankingEntry[]>([])
  const [uNotifs, setUNotifs]     = useState<WorldNotif[]>([])
  const [uLoading, setULoading]   = useState(false)
  const [uMsg, setUMsg]           = useState('')
  const [uEditingRanking, setUEditingRanking] = useState<EditingRanking | null>(null)
  const [uSessions, setUSessions] = useState<PlayerSession[]>([])

  // ── Reports ──
  const [reports, setReports]         = useState<Report[]>([])
  const [repLoading, setRepLoading]   = useState(false)
  const [repMsg, setRepMsg]           = useState('')
  const [repStatusF, setRepStatusF]   = useState<'' | 'new' | 'read' | 'done'>('')
  const [repCatF, setRepCatF]         = useState('')
  const [repDetail, setRepDetail]     = useState<Report | null>(null)

  // ── Bulk selection ──
  const [wlSelected, setWlSelected]     = useState<Set<number>>(new Set())
  const [rankSelected, setRankSelected] = useState<Set<number>>(new Set())
  const [repSelected, setRepSelected]   = useState<Set<number>>(new Set())

  // ── Stats ──
  const [stats, setStats] = useState<{ totalDeaths: number; totalKills: number; floorDist: [string,number][]; slotDist: [string,number][]; killDist: [string,number][]; skulporinTotal: number; skulporinDefeated: number; skulporinEscaped: number } | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)

  // ── Event ──
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([])
  const [evLoading, setEvLoading]   = useState(false)
  const [evMsg, setEvMsg]           = useState('')
  const [evTargetId, setEvTargetId] = useState('')       // モンスターポップ用ターゲット
  const [evMhTargetId, setEvMhTargetId] = useState('')   // モンスターハウス用ターゲット
  const [evMonster, setEvMonster]   = useState(MONSTER_REGISTRY[0]?.name ?? '')
  const [evFloor, setEvFloor]       = useState('')

  // ── DM ──
  const [dmTargetId, setDmTargetId]   = useState('')
  const [dmManualId, setDmManualId]   = useState('')   // player_id 直接入力
  const [dmTitle, setDmTitle]         = useState('')
  const [dmBody, setDmBody]           = useState('')
  const [dmMsg, setDmMsg]             = useState('')
  const [dmSending, setDmSending]     = useState(false)
  const [dmThreads, setDmThreads]     = useState<{ player_id: string; player_name: string | null; last_body: string; last_at: string; unread: number }[]>([])
  const [dmUnread, setDmUnread]       = useState(0)
  const [dmReply, setDmReply]         = useState('')                    // スレッド返信用（新規DM本文とは別）
  const [dmOpenId, setDmOpenId]       = useState<string | null>(null)   // 開いているスレッドのplayer_id
  const [dmThread, setDmThread]       = useState<{ id: number; sender: string; title: string | null; body: string; read: boolean; created_at: string }[]>([])

  // ゲームのグローバルCSSがhtml/body/#rootにoverflow:hidden+height:100%を設定しているためAdmin画面でスクロールを許可する
  useEffect(() => {
    const root = document.getElementById('root')
    const prevBodyOv = document.body.style.overflow
    const prevBodyH  = document.body.style.height
    const prevRootOv = root?.style.overflow ?? ''
    const prevRootH  = root?.style.height  ?? ''
    document.documentElement.style.overflow = 'auto'
    document.documentElement.style.height   = 'auto'
    document.body.style.overflow = 'auto'
    document.body.style.height   = 'auto'
    if (root) { root.style.overflow = 'auto'; root.style.height = 'auto' }
    return () => {
      document.documentElement.style.overflow = ''
      document.documentElement.style.height   = ''
      document.body.style.overflow = prevBodyOv
      document.body.style.height   = prevBodyH
      if (root) { root.style.overflow = prevRootOv; root.style.height = prevRootH }
    }
  }, [])

  const login = () => {
    if (!ADMIN_KEY) { alert('VITE_ADMIN_KEY 環境変数が未設定です'); return }
    if (pw === ADMIN_KEY) setAuthed(true)
    else alert('パスワードが違います')
  }

  // ── Maintenance ──
  const loadMaintenance = useCallback(async () => {
    setMLoading(true)
    const [{ data: winData }, { data: msgData }] = await Promise.all([
      db.from('system_config').select('value').eq('key', 'maintenance_windows').single(),
      db.from('system_config').select('value').eq('key', 'maintenance_message').single(),
    ])
    if (winData) setWindows((winData.value ?? []) as MaintenanceWindow[])
    if (msgData?.value) {
      const v = msgData.value as { heading?: string; lead?: string; note?: string }
      if (v.heading != null) setMHeading(v.heading)
      if (v.lead    != null) setMLead(v.lead)
      if (v.note    != null) setMNote(v.note)
    }
    setMLoading(false)
  }, [db])

  const saveMaintenance = async () => {
    setMSaving(true); setMMsg('')
    const { error } = await db.from('system_config').upsert({ key: 'maintenance_windows', value: windows, updated_at: new Date().toISOString() })
    setMMsg(error ? `エラー: ${error.message}` : '保存しました ✓')
    setMSaving(false)
  }

  const addWindow = () => {
    if (!newFrom) return
    setWindows(ws => [...ws, { from: fromJstInput(newFrom), to: newTo ? fromJstInput(newTo) : null }].sort((a, b) => a.from - b.from))
    setNewFrom(''); setNewTo('')
  }

  const removeWindow = (i: number) => setWindows(ws => ws.filter((_, j) => j !== i))

  const saveMaintenanceMessage = async () => {
    setMMsgSaving(true); setMMsgResult('')
    const { error } = await db.from('system_config').upsert({ key: 'maintenance_message', value: { heading: mHeading, lead: mLead, note: mNote }, updated_at: new Date().toISOString() })
    setMMsgResult(error ? `エラー: ${error.message}` : '保存しました ✓')
    setMMsgSaving(false)
  }

  const openNow = () => {
    const now = Date.now()
    setWindows(ws => {
      const next = ws.filter(w => w.to === null || w.to > now)
      if (next.some(w => winActive(w, now))) return next
      return [...next, { from: now, to: now + 24 * 3600 * 1000 }].sort((a, b) => a.from - b.from)
    })
  }

  const closeNow = () => {
    const now = Date.now()
    setWindows(ws => ws.map(w => winActive(w, now) ? { ...w, to: now } : w).filter(w => w.to === null || w.from < w.to))
  }

  // ── Messages ──
  const sendMessage = async () => {
    if (!msgTitle || !msgBody) return
    setMsgSending(true)
    const displayMs = Math.max(1, parseFloat(msgDisplaySec) || 4) * 1000
    const { error } = await db.from('world_notifications').insert({ type: msgType, title: msgTitle, message: msgBody, player_name: 'ADMIN', player_id: 'admin-broadcast', display_ms: displayMs })
    setMsgResult(error ? `エラー: ${error.message}` : '送信しました ✓')
    if (!error) { setMsgTitle(''); setMsgBody('') }
    setMsgSending(false)
  }

  // ── Ranking ──
  const loadRankings = useCallback(async (search = '') => {
    setRLoading(true); setRMsg('')
    let q = db.from('ebt_rankings').select('*').order('floor', { ascending: false }).limit(100)
    if (search) q = q.ilike('player_name', `%${search}%`)
    const { data } = await q
    setRankings((data ?? []) as RankingEntry[])
    setRankSelected(new Set())
    setRLoading(false)
  }, [db])

  const deleteRanking = async (id: number) => {
    if (!confirm('このランキングエントリを削除しますか？')) return
    const { deleted, error } = await adminDelete('ebt_rankings', [id])
    if (error) { setRMsg(`削除エラー: ${error}`); return }
    if (!deleted) { setRMsg('削除できませんでした'); return }
    setRMsg('削除しました ✓')
    setRankings(rs => rs.filter(r => r.id !== id))
  }

  const saveEditRanking = async () => {
    if (!editingRanking) return
    const { error } = await db.from('ebt_rankings').update({ player_name: editingRanking.player_name, floor: editingRanking.floor, level: editingRanking.level }).eq('id', editingRanking.id)
    if (error) { setRMsg(`更新エラー: ${error.message}`); return }
    setRMsg('更新しました ✓')
    setRankings(rs => rs.map(r => r.id === editingRanking.id ? { ...r, ...editingRanking } : r))
    setEditingRanking(null)
  }

  // ── World Log ──
  const loadWorldLogs = useCallback(async (search = '', typeFilter = '') => {
    setWlLoading(true); setWlMsg('')
    let q = db.from('world_notifications').select('*').order('created_at', { ascending: false }).limit(200)
    if (search.trim()) q = q.ilike('player_name', `%${search.trim()}%`)
    if (typeFilter) q = q.eq('type', typeFilter)
    const { data, error } = await q
    if (error) setWlMsg(`エラー: ${error.message}`)
    setWlogs((data ?? []) as WorldNotif[])
    setWlSelected(new Set())
    setWlLoading(false)
  }, [db])

  const deleteWorldLog = async (id: number) => {
    if (!confirm('このワールドログを削除しますか？')) return
    const { deleted, error } = await adminDelete('world_notifications', [id])
    if (error) { setWlMsg(`削除エラー: ${error}`); return }
    if (!deleted) { setWlMsg('削除できませんでした'); return }
    setWlMsg('削除しました ✓')
    setWlogs(ls => ls.filter(l => l.id !== id))
  }

  // ── User Management ──
  const searchUser = async () => {
    if (!uSearch.trim()) return
    setULoading(true); setUMsg(''); setUEditingRanking(null)
    const name = uSearch.trim()
    setUSearched(name)
    const [{ data: ranks }, { data: notifs }] = await Promise.all([
      db.from('ebt_rankings').select('*').ilike('player_name', `%${name}%`).order('floor', { ascending: false }).limit(50),
      db.from('world_notifications').select('*').ilike('player_name', `%${name}%`).order('created_at', { ascending: false }).limit(100),
    ])
    setURankings((ranks ?? []) as RankingEntry[])
    setUNotifs((notifs ?? []) as WorldNotif[])
    // 現在のステータス・装備（active_sessions.state）はservice key経由のAPIで取得
    setUSessions([])
    if (ADMIN_KEY) {
      try {
        const res = await fetch('/api/admin-event', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminKey: ADMIN_KEY, action: 'player_state', name }),
        })
        if (res.ok) { const j = await res.json(); setUSessions((j.sessions ?? []) as PlayerSession[]) }
      } catch { /* API不在（ローカル等）→ 空のまま */ }
    }
    setULoading(false)
  }

  const deleteURanking = async (id: number) => {
    if (!confirm('削除しますか？')) return
    const { deleted, error } = await adminDelete('ebt_rankings', [id])
    if (error) { setUMsg(`エラー: ${error}`); return }
    if (!deleted) { setUMsg('削除できませんでした'); return }
    setUMsg('ランキング削除 ✓')
    setURankings(rs => rs.filter(r => r.id !== id))
  }

  const saveUEditRanking = async () => {
    if (!uEditingRanking) return
    const { error } = await db.from('ebt_rankings').update({ player_name: uEditingRanking.player_name, floor: uEditingRanking.floor, level: uEditingRanking.level }).eq('id', uEditingRanking.id)
    if (error) { setUMsg(`エラー: ${error.message}`); return }
    setUMsg('更新しました ✓')
    setURankings(rs => rs.map(r => r.id === uEditingRanking.id ? { ...r, ...uEditingRanking } : r))
    setUEditingRanking(null)
  }

  const deleteUNotif = async (id: number) => {
    if (!confirm('削除しますか？')) return
    const { deleted, error } = await adminDelete('world_notifications', [id])
    if (error) { setUMsg(`エラー: ${error}`); return }
    if (!deleted) { setUMsg('削除できませんでした'); return }
    setUMsg('ログ削除 ✓')
    setUNotifs(ns => ns.filter(n => n.id !== id))
  }

  // ── Reports ──
  const loadReports = useCallback(async (statusF = '', catF = '') => {
    setRepLoading(true); setRepMsg('')
    let q = db.from('reports').select('*').order('created_at', { ascending: false }).limit(300)
    if (statusF) q = q.eq('status', statusF)
    if (catF) q = q.eq('category', catF)
    const { data, error } = await q
    if (error) setRepMsg(`エラー: ${error.message}`)
    setReports((data ?? []) as Report[])
    setRepSelected(new Set())
    setRepLoading(false)
  }, [db])

  // 報告のステータス更新・削除は service key 経由のAPIで行う（reportsはanon更新/削除をRLSで弾くため）
  const reportApi = async (body: Record<string, unknown>): Promise<{ ok?: boolean; deleted?: number; error?: string }> => {
    if (!ADMIN_KEY) return { error: 'VITE_ADMIN_KEY 未設定' }
    try {
      const res = await fetch('/api/admin-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey: ADMIN_KEY, ...body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return { error: json.error ?? `HTTP ${res.status}` }
      return json
    } catch (e) { return { error: String(e) } }
  }

  const updateRepStatus = async (id: number, status: Report['status']) => {
    const { error } = await reportApi({ action: 'set_status', id, status })
    if (error) { setRepMsg(`エラー: ${error}`); return }
    setReports(rs => rs.map(r => r.id === id ? { ...r, status } : r))
    if (repDetail?.id === id) setRepDetail(d => d ? { ...d, status } : d)
  }

  const deleteReport = async (id: number) => {
    if (!confirm('この報告を削除しますか？')) return
    const { deleted, error } = await reportApi({ action: 'delete', ids: [id] })
    if (error) { setRepMsg(`エラー: ${error}`); return }
    if (!deleted) { setRepMsg('削除できませんでした'); return }
    setRepMsg('削除しました ✓')
    setReports(rs => rs.filter(r => r.id !== id))
    if (repDetail?.id === id) setRepDetail(null)
  }

  const bulkDeleteRankings = async () => {
    const ids = [...rankSelected]
    if (ids.length === 0) return
    if (!confirm(`選択した ${ids.length} 件のランキングを削除しますか？`)) return
    const { deleted, error } = await adminDelete('ebt_rankings', ids)
    if (error) { setRMsg(`削除エラー: ${error}`); return }
    if (!deleted) { setRMsg('削除できませんでした'); return }
    setRankings(rs => rs.filter(r => !ids.includes(r.id)))
    setRankSelected(new Set())
    setRMsg(`${deleted} 件を削除しました ✓`)
  }

  const bulkDeleteWorldLogs = async () => {
    const ids = [...wlSelected]
    if (ids.length === 0) return
    if (!confirm(`選択した ${ids.length} 件のログを削除しますか？`)) return
    const { deleted, error } = await adminDelete('world_notifications', ids)
    if (error) { setWlMsg(`削除エラー: ${error}`); return }
    if (!deleted) { setWlMsg('削除できませんでした'); return }
    setWlogs(ls => ls.filter(l => !ids.includes(l.id)))
    setWlSelected(new Set())
    setWlMsg(`${deleted} 件を削除しました ✓`)
  }

  const bulkDeleteReports = async () => {
    const ids = [...repSelected]
    if (ids.length === 0) return
    if (!confirm(`選択した ${ids.length} 件の報告を削除しますか？`)) return
    const { deleted, error } = await reportApi({ action: 'delete', ids })
    if (error) { setRepMsg(`エラー: ${error}`); return }
    if (!deleted) { setRepMsg('削除できませんでした'); return }
    setReports(rs => rs.filter(r => !ids.includes(r.id)))
    if (repDetail && ids.includes(repDetail.id)) setRepDetail(null)
    setRepSelected(new Set())
    setRepMsg(`${deleted} 件を削除しました ✓`)
  }

  const openRepDetail = async (r: Report) => {
    setRepDetail(r)
    if (r.status === 'new') await updateRepStatus(r.id, 'read')
  }

  // ── Stats ──
  // PostgREST は1リクエスト最大1000行しか返さないため、.range() でページ送りして全行を取得する。
  const fetchAllRows = useCallback(async (
    columns: string,
    eventType: string,
    extra?: (q: any) => any,
  ): Promise<any[]> => {
    const PAGE = 1000
    const all: any[] = []
    for (let from = 0; ; from += PAGE) {
      let q = db.from('game_events').select(columns).eq('event_type', eventType).range(from, from + PAGE - 1)
      if (extra) q = extra(q)
      const { data, error } = await q
      if (error) throw error
      const rows = data ?? []
      all.push(...rows)
      if (rows.length < PAGE) break   // 最終ページ
    }
    return all
  }, [db])

  const loadStats = useCallback(async () => {
    setStats(null); setStatsError(null)
    try {
      // 総数は count クエリで正確に取得（行数制限の影響を受けない）
      const [{ count: deathCount }, { count: killCount }, { count: skulporinTotal }, { count: skulporinDefeated }, { count: skulporinEscaped }] = await Promise.all([
        db.from('game_events').select('id', { count: 'exact', head: true }).eq('event_type', 'death'),
        db.from('game_events').select('id', { count: 'exact', head: true }).eq('event_type', 'kill'),
        db.from('skulporin_spawns').select('id', { count: 'exact', head: true }),
        db.from('skulporin_spawns').select('id', { count: 'exact', head: true }).eq('status', 'defeated'),
        db.from('skulporin_spawns').select('id', { count: 'exact', head: true }).eq('status', 'escaped'),
      ])
      // 分布はページネーションで全行を取得
      const [deaths, slots, kills] = await Promise.all([
        fetchAllRows('floor', 'death'),
        fetchAllRows('slot_result', 'slot_result', q => q.not('slot_result', 'is', null)),
        fetchAllRows('enemy_name', 'kill'),
      ])
      const floorMap: Record<string, number> = {}
      for (const d of deaths) { const k = `${d.floor ?? '?'}F`; floorMap[k] = (floorMap[k] ?? 0) + 1 }
      const slotMap: Record<string, number> = {}
      for (const s of slots) { const k = s.slot_result ?? '?'; slotMap[k] = (slotMap[k] ?? 0) + 1 }
      const killMap: Record<string, number> = {}
      for (const k of kills) { const n = k.enemy_name ?? '不明'; killMap[n] = (killMap[n] ?? 0) + 1 }
      setStats({
        totalDeaths: deathCount ?? deaths.length,
        totalKills:  killCount ?? kills.length,
        floorDist: Object.entries(floorMap).sort((a, b) => parseInt(b[0]) - parseInt(a[0])),
        slotDist:  Object.entries(slotMap).sort((a, b) => b[1] - a[1]),
        killDist:  Object.entries(killMap).sort((a, b) => b[1] - a[1]),
        skulporinTotal:    skulporinTotal    ?? 0,
        skulporinDefeated: skulporinDefeated ?? 0,
        skulporinEscaped:  skulporinEscaped  ?? 0,
      })
    } catch (err: any) {
      setStatsError(`Supabaseエラー: ${err?.message} (code: ${err?.code})`)
      setStats({ totalDeaths: 0, totalKills: 0, floorDist: [], slotDist: [], killDist: [], skulporinTotal: 0, skulporinDefeated: 0, skulporinEscaped: 0 })
    }
  }, [db, fetchAllRows])

  // ── Event ──
  const loadOnlinePlayers = useCallback(async () => {
    setEvLoading(true); setEvMsg('')
    try {
      const res = await fetch('/api/admin-event', { method: 'GET' })
      const json = await res.json()
      if (!res.ok) { setEvMsg(`エラー: ${json.error ?? res.status}`); setOnlinePlayers([]) }
      else setOnlinePlayers((json.players ?? []) as OnlinePlayer[])
    } catch (e) {
      setEvMsg(`エラー: ${String(e)}`)
    }
    setEvLoading(false)
  }, [])

  const postEvent = async (body: Record<string, unknown>): Promise<boolean> => {
    setEvMsg('')
    try {
      const res = await fetch('/api/admin-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey: ADMIN_KEY, ...body }),
      })
      const json = await res.json()
      if (!res.ok) { setEvMsg(`エラー: ${json.error ?? res.status}`); return false }
      setEvMsg('送信しました ✓')
      return true
    } catch (e) {
      setEvMsg(`エラー: ${String(e)}`)
      return false
    }
  }

  const fireSkulporin = async () => {
    if (!confirm('すかるぽりんを全プレイヤーに強制出現させますか？')) return
    const ok = await postEvent({ action: 'skulporin' })
    if (ok) window.triggerSkulporinCheck?.()
  }

  const fireMonsterHouse = async () => {
    if (!evMhTargetId) { setEvMsg('対象プレイヤーを選択してください'); return }
    const p = onlinePlayers.find(o => o.player_id === evMhTargetId)
    await postEvent({ action: 'monster_house', target_player_id: evMhTargetId, target_player_name: p?.player_name })
  }

  const fireSpawnMonster = async () => {
    if (!evTargetId) { setEvMsg('対象プレイヤーを選択してください'); return }
    if (!evMonster)  { setEvMsg('モンスターを選択してください'); return }
    const p = onlinePlayers.find(o => o.player_id === evTargetId)
    const entry = MONSTER_REGISTRY.find(m => m.name === evMonster)
    const parsedFloor = evFloor.trim() ? parseInt(evFloor, 10) : null
    const floorNum = parsedFloor != null ? Math.max(1, parsedFloor) : (p?.floor ?? null)
    await postEvent({
      action: 'spawn_monster',
      target_player_id: evTargetId,
      target_player_name: p?.player_name,
      monster_name: evMonster,
      monster_behavior: entry?.behavior ?? 'normal',
      target_floor: floorNum,
    })
  }

  // ── DM ──
  const postMail = async (body: Record<string, unknown>): Promise<any | null> => {
    try {
      const res = await fetch('/api/admin-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey: ADMIN_KEY, ...body }),
      })
      const json = await res.json()
      if (!res.ok) { setDmMsg(`エラー: ${json.error ?? res.status}`); return null }
      return json
    } catch (e) {
      setDmMsg(`エラー: ${String(e)}`); return null
    }
  }

  const loadDmInbox = useCallback(async () => {
    try {
      const res = await fetch('/api/admin-mail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey: ADMIN_KEY, action: 'inbox' }),
      })
      const json = await res.json()
      if (res.ok) { setDmThreads(json.threads ?? []); setDmUnread(json.unread ?? 0) }
    } catch { /* ignore */ }
  }, [])

  const sendDm = async () => {
    const targetId = (dmManualId.trim() || dmTargetId).trim()
    if (!targetId) { setDmMsg('宛先（プレイヤー）を選択 or 入力してください'); return }
    if (!dmTitle.trim() || !dmBody.trim()) { setDmMsg('件名・本文を入力してください'); return }
    setDmSending(true); setDmMsg('')
    const p = onlinePlayers.find(o => o.player_id === targetId)
    const ok = await postMail({
      action: 'send', to_player_id: targetId,
      to_player_name: p?.player_name ?? dmThreads.find(t => t.player_id === targetId)?.player_name ?? null,
      title: dmTitle.trim(), body: dmBody.trim(),
    })
    setDmSending(false)
    if (ok) { setDmMsg('送信しました ✓'); setDmTitle(''); setDmBody('') }
  }

  const openDmThread = async (player_id: string) => {
    setDmOpenId(player_id)
    const json = await postMail({ action: 'thread', player_id })
    if (json) { setDmThread(json.messages ?? []); void loadDmInbox() }   // 開くと既読化→受信箱更新
  }

  const replyToThread = async () => {
    if (!dmOpenId || !dmReply.trim()) { setDmMsg('本文を入力してください'); return }
    setDmSending(true); setDmMsg('')
    const t = dmThreads.find(x => x.player_id === dmOpenId)
    const ok = await postMail({ action: 'send', to_player_id: dmOpenId, to_player_name: t?.player_name ?? null, title: '運営より', body: dmReply.trim() })
    setDmSending(false)
    if (ok) { setDmReply(''); void openDmThread(dmOpenId) }
  }

  // ── データベース（参照＋編集）──
  const [dbTab, setDbTab] = useState<DbTab>('monster')
  const [dbRows, setDbRows] = useState<Record<string, unknown>[]>([])   // 上書き行（下書き含む）
  const [dbEditing, setDbEditing] = useState<{ category: OverrideCategory; ref: string; defaults: Record<string, unknown> } | null>(null)
  const [dbForm, setDbForm] = useState<Record<string, string>>({})
  const [dbImage, setDbImage] = useState<string | null>(null)
  const [dbMsg, setDbMsg] = useState('')
  const [dbBusy, setDbBusy] = useState(false)

  const loadDbRows = useCallback(async () => {
    if (!ADMIN_KEY) return
    try {
      const res = await fetch('/api/admin-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey: ADMIN_KEY, action: 'list' }),
      })
      if (res.ok) { const j = await res.json(); setDbRows((j.rows ?? []) as Record<string, unknown>[]) }
    } catch { /* ローカル等でAPI不在 → 空のまま */ }
  }, [])

  const dbRowOf = (category: string, ref: string) =>
    dbRows.find(r => r.category === category && r.ref === ref)

  // 一覧に表示する実効値：下書きパッチ(draft_patch)があればそれ、なければデフォルト。
  // 編集パネル(openDbEditor)と同じ規則でマージするため、一覧と詳細の表示が必ず一致する。
  // （以前は一覧がハードコードのデフォルト値だけを表示し、編集が反映されないように見えていた）
  const dbMerged = <T extends Record<string, unknown>>(category: OverrideCategory, defaults: T): T => {
    const row = dbRowOf(category, String(defaults.name))
    const draft = (row?.draft_patch ?? {}) as Record<string, unknown>
    const merged: Record<string, unknown> = { ...defaults }
    for (const k of Object.keys(draft)) {
      const v = draft[k]
      if (v !== undefined && v !== null && v !== '') merged[k] = v
    }
    return merged as T
  }

  const dbStatusOf = (category: string, ref: string): '' | 'draft' | 'pub' => {
    const r = dbRowOf(category, ref)
    if (!r) return ''
    return r.is_published ? 'pub' : 'draft'
  }

  const openDbEditor = (category: OverrideCategory, defaults: Record<string, unknown>) => {
    const ref = String(defaults.name)
    const row = dbRowOf(category, ref)
    const draft = (row?.draft_patch ?? {}) as Record<string, unknown>
    const form: Record<string, string> = {}
    for (const f of DB_SCHEMA[category].fields) {
      const v = draft[f.key] ?? defaults[f.key]
      form[f.key] = v === undefined || v === null ? '' : String(v)
    }
    setDbForm(form)
    setDbImage((row?.draft_image as string) ?? null)
    setDbEditing({ category, ref, defaults })
    setDbMsg('')
  }

  const dbApi = async (body: Record<string, unknown>): Promise<boolean> => {
    if (!ADMIN_KEY) { setDbMsg('VITE_ADMIN_KEY 未設定'); return false }
    setDbBusy(true)
    try {
      const res = await fetch('/api/admin-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey: ADMIN_KEY, ...body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setDbMsg(`エラー: ${j.error ?? res.status}`); return false }
      return true
    } catch (e) { setDbMsg(`エラー: ${String(e)}`); return false }
    finally { setDbBusy(false) }
  }

  // フォーム → patch（デフォルトと異なるフィールドだけ）
  const buildPatch = (): Record<string, unknown> => {
    if (!dbEditing) return {}
    const patch: Record<string, unknown> = {}
    for (const f of DB_SCHEMA[dbEditing.category].fields) {
      const raw = (dbForm[f.key] ?? '').trim()
      if (raw === '') continue
      const val: unknown = f.type === 'num' ? Number(raw) : raw
      if (f.type === 'num' && Number.isNaN(val as number)) continue
      const def = dbEditing.defaults[f.key]
      if (String(def) === String(val)) continue   // デフォルトと同じなら上書き不要
      patch[f.key] = val
    }
    return patch
  }

  const saveDb = async () => {
    if (!dbEditing) return
    const ok = await dbApi({ action: 'save', category: dbEditing.category, ref: dbEditing.ref, patch: buildPatch(), image: dbImage })
    if (ok) { setDbMsg('下書き保存しました（公開でライブ反映）'); await loadDbRows() }
  }
  const publishDb = async () => {
    if (!dbEditing) return
    const ok = await dbApi({ action: 'save', category: dbEditing.category, ref: dbEditing.ref, patch: buildPatch(), image: dbImage })
      && await dbApi({ action: 'publish', category: dbEditing.category, ref: dbEditing.ref })
    if (ok) { setDbMsg('公開しました（全プレイヤーの次回読み込みから反映）'); await loadDbRows() }
  }
  const unpublishDb = async () => {
    if (!dbEditing) return
    if (await dbApi({ action: 'unpublish', category: dbEditing.category, ref: dbEditing.ref })) { setDbMsg('公開を停止しました（デフォルトに戻る）'); await loadDbRows() }
  }
  const deleteDb = async () => {
    if (!dbEditing) return
    if (!confirm('この上書きを削除してデフォルトに戻しますか？')) return
    if (await dbApi({ action: 'delete', category: dbEditing.category, ref: dbEditing.ref })) { setDbMsg('削除しました'); setDbEditing(null); await loadDbRows() }
  }

  const dbStatusCell = (cat: OverrideCategory, ref: string) => {
    const s = dbStatusOf(cat, ref)
    return <td style={S.td}>{s === 'pub' ? <span style={S.dbPub}>公開</span> : s === 'draft' ? <span style={S.dbDraft}>下書</span> : <span style={{ color: '#444' }}>−</span>}</td>
  }
  const dbRowStyle = (cat: OverrideCategory, ref: string): React.CSSProperties => ({
    cursor: 'pointer',
    background: dbEditing?.category === cat && dbEditing?.ref === ref ? 'rgba(79,70,229,0.12)' : 'transparent',
  })

  const uploadDbImage = async (file?: File) => {
    if (!file || !dbEditing) return
    if (file.size > 5 * 1024 * 1024) { setDbMsg('画像は5MB以下にしてください'); return }
    setDbBusy(true)
    try {
      const ext = file.name.split('.').pop() ?? 'png'
      const path = `${dbEditing.category}/${Date.now()}-${crypto.randomUUID()}.${ext}`
      const { data: up, error } = await db.storage.from('entity-images').upload(path, file, { contentType: file.type })
      if (error || !up) { setDbMsg(`画像アップロード失敗: ${error?.message ?? '不明'}`); return }
      const { data: pub } = db.storage.from('entity-images').getPublicUrl(up.path)
      setDbImage(pub.publicUrl)
      setDbMsg('画像をアップロードしました（保存/公開で反映）')
    } finally { setDbBusy(false) }
  }

  // ── お知らせ（NEWS）──
  const [news, setNews]             = useState<Announcement[]>([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsMsg, setNewsMsg]       = useState('')
  const [editingId, setEditingId]   = useState<number | null>(null)  // null=新規作成中, number=編集中, -1=フォーム閉
  const [nfTitle, setNfTitle]       = useState('')
  const [nfBody, setNfBody]         = useState('')
  const [nfPublished, setNfPublished] = useState(true)
  const [editorKey, setEditorKey]   = useState(0)   // エディタ再マウント用（読み込み時に初期値を流し込む）
  const [formOpen, setFormOpen]     = useState(false)

  const loadNews = useCallback(async () => {
    setNewsLoading(true)
    // まずAPI(全件・下書き含む)を試し、失敗時はdb直読(RLSで公開分のみ)へフォールバック
    let rows: Announcement[] | null = null
    if (ADMIN_KEY) {
      try {
        const res = await fetch('/api/admin-news', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminKey: ADMIN_KEY, action: 'list' }),
        })
        if (res.ok) { const j = await res.json(); rows = (j.rows ?? []) as Announcement[] }
      } catch { /* fallthrough to db */ }
    }
    if (!rows) {
      const { data, error } = await db
        .from('ebt_announcements')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(200)
      if (error) { setNewsMsg(`エラー: ${error.message}`); setNewsLoading(false); return }
      rows = (data ?? []) as Announcement[]
    }
    setNews(rows)
    setNewsLoading(false)
  }, [db])

  const newsApi = async (body: Record<string, unknown>): Promise<boolean> => {
    if (!ADMIN_KEY) { setNewsMsg('VITE_ADMIN_KEY 未設定'); return false }
    try {
      const res = await fetch('/api/admin-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey: ADMIN_KEY, ...body }),
      })
      const json = await res.json()
      if (!res.ok) { setNewsMsg(`エラー: ${json.error ?? res.status}`); return false }
      return true
    } catch (e) { setNewsMsg(`エラー: ${String(e)}`); return false }
  }

  const openNewForm = () => {
    setEditingId(null); setNfTitle(''); setNfBody(''); setNfPublished(true)
    setEditorKey(k => k + 1); setFormOpen(true); setNewsMsg('')
  }
  const openEditForm = (a: Announcement) => {
    setEditingId(a.id); setNfTitle(a.title); setNfBody(a.body_html); setNfPublished(a.is_published)
    setEditorKey(k => k + 1); setFormOpen(true); setNewsMsg('')
  }
  const closeForm = () => { setFormOpen(false); setEditingId(-1) }

  const saveNews = async () => {
    if (!nfTitle.trim()) { setNewsMsg('タイトルを入力してください'); return }
    const ok = editingId && editingId > 0
      ? await newsApi({ action: 'update', id: editingId, title: nfTitle.trim(), body_html: nfBody, is_published: nfPublished })
      : await newsApi({ action: 'create', title: nfTitle.trim(), body_html: nfBody, is_published: nfPublished })
    if (ok) { setNewsMsg('保存しました'); setFormOpen(false); await loadNews() }
  }

  const togglePublish = async (a: Announcement) => {
    if (await newsApi({ action: 'update', id: a.id, is_published: !a.is_published })) await loadNews()
  }

  const deleteNews = async (a: Announcement) => {
    if (!confirm(`「${a.title}」を削除しますか？`)) return
    if (await newsApi({ action: 'delete', id: a.id })) { setNewsMsg('削除しました'); await loadNews() }
  }

  useEffect(() => {
    if (!authed) return
    if (tab === 'maintenance') loadMaintenance()
    if (tab === 'ranking')     loadRankings()
    if (tab === 'worldlog')    loadWorldLogs()
    if (tab === 'reports')     loadReports()
    if (tab === 'stats')       loadStats()
    if (tab === 'event')       loadOnlinePlayers()
    if (tab === 'news')        loadNews()
    if (tab === 'database')    loadDbRows()
    if (tab === 'dm')          { loadOnlinePlayers(); loadDmInbox() }
  }, [authed, tab, loadMaintenance, loadRankings, loadWorldLogs, loadReports, loadStats, loadOnlinePlayers, loadNews, loadDbRows, loadDmInbox])

  const now = Date.now()
  const isOpen = windows.some(w => winActive(w, now))

  if (!authed) return (
    <div style={S.page}>
      <div style={S.loginCard}>
        <div style={S.loginTitle}>🏰 Endless Tower Admin</div>
        <input type="password" value={pw} autoFocus
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && login()}
          placeholder="管理パスワード" style={S.input} />
        <button onClick={login} style={S.btnPrimary}>ログイン</button>
      </div>
    </div>
  )

  const TAB_LABELS: Record<Tab, string> = {
    maintenance: 'メンテナンス', message: 'メッセージ配信', dm: `DM${dmUnread > 0 ? `(${dmUnread})` : ''}`, event: 'イベント',
    ranking: 'ランキング', worldlog: 'ワールドログ',
    users: 'ユーザー管理', reports: '報告BOX', stats: '統計', news: 'お知らせ', database: 'データベース',
  }

  const REP_STATUS_COLOR: Record<string, string> = {
    new: '#ef4444', read: '#60a5fa', done: '#4ade80',
  }
  const REP_STATUS_LABEL: Record<string, string> = {
    new: '新規', read: '確認済', done: '完了',
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <span style={{ fontWeight: 700 }}>🏰 Endless Tower Admin</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setEnvMode(m => m === 'production' ? 'local' : 'production')}
            style={{ ...S.btnSm, background: envMode === 'production' ? 'rgba(79,70,229,0.25)' : 'rgba(22,163,74,0.25)', border: `1px solid ${envMode === 'production' ? '#6366f1' : '#22c55e'}`, color: envMode === 'production' ? '#a5b4fc' : '#4ade80' }}
          >
            {envMode === 'production' ? '🌐 本番' : '💻 ローカル'}
          </button>
          <button onClick={() => setShowEnvPanel(p => !p)} style={S.btnSm}>⚙ 接続設定</button>
          <button onClick={() => setAuthed(false)} style={S.btnSm}>ログアウト</button>
        </div>
      </div>

      {showEnvPanel && (
        <div style={{ background: '#0d0d20', borderBottom: '1px solid #1e1e38', padding: '12px 20px' }}>
          <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={S.label}>接続先</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['production', 'local'] as EnvMode[]).map(m => (
                  <button key={m} onClick={() => setEnvMode(m)}
                    style={{ ...S.btnSm, background: envMode === m ? 'rgba(79,70,229,0.35)' : 'transparent', border: `1px solid ${envMode === m ? '#6366f1' : '#2a2a4a'}`, color: envMode === m ? '#a5b4fc' : '#666' }}>
                    {m === 'production' ? '🌐 本番 (Supabase Cloud)' : '💻 ローカル (localhost:54321)'}
                  </button>
                ))}
              </div>
            </div>
            {envMode === 'local' && (
              <div style={{ flex: 1, minWidth: 260 }}>
                <label style={S.label}>ローカル Anon Key</label>
                <input value={localKey} onChange={e => setLocalKey(e.target.value)} style={S.input} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 260 }}>
              <label style={S.label}>Service Role Key（任意 — RLS を bypass）</label>
              <input type="password" value={serviceKey} onChange={e => setServiceKey(e.target.value)} placeholder="eyJ..." style={S.input} />
            </div>
            <div style={{ fontSize: 11, color: '#555', alignSelf: 'center' }}>
              {envMode === 'production' ? PROD_URL : LOCAL_URL}
            </div>
          </div>
        </div>
      )}

      <div style={S.tabs}>
        {(Object.keys(TAB_LABELS) as Tab[]).map(key => (
          <button key={key} onClick={() => setTab(key)}
            style={tab === key ? { ...S.tab, ...S.tabActive } : S.tab}>
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>

      <div style={S.body}>

        {/* ══ メンテナンス ══ */}
        {tab === 'maintenance' && (
          <div>
            <div style={S.row}>
              <span style={{ ...S.badge, background: isOpen ? '#14532d' : '#7f1d1d', border: `1px solid ${isOpen ? '#22c55e' : '#ef4444'}` }}>
                {isOpen ? '🟢 現在公開中' : '🔴 現在メンテ中'}
              </span>
              <button onClick={openNow} style={S.btnGreen}>今すぐ開く (+24h)</button>
              <button onClick={closeNow} style={S.btnRed}>今すぐ閉じる</button>
            </div>

            {mLoading ? <p style={S.muted}>読み込み中…</p> : <>
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>開始 (JST)</th><th style={S.th}>終了 (JST)</th>
                  <th style={S.th}>状態</th><th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {windows.map((w, i) => {
                    const active = winActive(w, now); const past = winPast(w, now)
                    return (
                      <tr key={i} style={active ? { background: 'rgba(34,197,94,0.07)' } : past ? { opacity: 0.45 } : {}}>
                        <td style={S.td}>{fmtJst(w.from)}</td>
                        <td style={S.td}>{w.to === null ? <span style={{ color: '#60a5fa' }}>― 無期限</span> : fmtJst(w.to)}</td>
                        <td style={S.td}>
                          {active ? <span style={{ color: '#22c55e' }}>● 公開中</span>
                            : past ? <span style={{ color: '#666' }}>終了</span>
                            : <span style={{ color: '#facc15' }}>予定</span>}
                        </td>
                        <td style={S.td}><button onClick={() => removeWindow(i)} style={S.btnDanger}>削除</button></td>
                      </tr>
                    )
                  })}
                  {windows.length === 0 && (
                    <tr><td colSpan={4} style={{ ...S.td, color: '#666', textAlign: 'center' }}>公開ウィンドウなし（= 常時メンテ）</td></tr>
                  )}
                </tbody>
              </table>

              <div style={S.card}>
                <div style={S.cardTitle}>新規ウィンドウ追加（JST）</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={S.label}>開始</label>
                  <input type="datetime-local" value={newFrom} onChange={e => setNewFrom(e.target.value)} style={{ ...S.input, width: 'auto' }} />
                  <label style={S.label}>終了（任意）</label>
                  <input type="datetime-local" value={newTo} onChange={e => setNewTo(e.target.value)} style={{ ...S.input, width: 'auto' }} />
                  {newTo && <button onClick={() => setNewTo('')} style={S.btnSm}>終了クリア</button>}
                  <button onClick={addWindow} disabled={!newFrom} style={S.btnPrimary}>追加</button>
                </div>
                <p style={{ ...S.muted, marginTop: 8, marginBottom: 0 }}>終了を空欄にすると「開始以降ずっと公開（無期限）」になります。</p>
              </div>

              <div style={S.row}>
                <button onClick={saveMaintenance} disabled={mSaving} style={S.btnPrimary}>{mSaving ? '保存中…' : '変更を保存（Supabase）'}</button>
                {mMsg && <span style={{ color: mMsg.includes('エラー') ? '#f87171' : '#4ade80' }}>{mMsg}</span>}
              </div>

              <div style={{ ...S.card, marginTop: 24 }}>
                <div style={S.cardTitle}>メンテナンス画面のメッセージ編集</div>
                <div style={S.formGroup}>
                  <label style={S.label}>見出し（h1）</label>
                  <textarea value={mHeading} onChange={e => setMHeading(e.target.value)} rows={2} style={{ ...S.input, resize: 'vertical' }} />
                </div>
                <div style={S.formGroup}>
                  <label style={S.label}>リード文</label>
                  <input value={mLead} onChange={e => setMLead(e.target.value)} style={S.input} />
                </div>
                <div style={S.formGroup}>
                  <label style={S.label}>補足文</label>
                  <textarea value={mNote} onChange={e => setMNote(e.target.value)} rows={2} style={{ ...S.input, resize: 'vertical' }} />
                </div>
                <div style={{ ...S.row, marginTop: 8 }}>
                  <button onClick={saveMaintenanceMessage} disabled={mMsgSaving} style={S.btnPrimary}>{mMsgSaving ? '保存中…' : 'メッセージを保存'}</button>
                  {mMsgResult && <span style={{ color: mMsgResult.includes('エラー') ? '#f87171' : '#4ade80' }}>{mMsgResult}</span>}
                </div>
                <p style={{ ...S.muted, marginTop: 8 }}>改行は画面上でも改行されます。</p>
              </div>
            </>}
          </div>
        )}

        {/* ══ メッセージ配信 ══ */}
        {tab === 'message' && (
          <div>
            <div style={S.formGroup}>
              <label style={S.label}>タイプ</label>
              <select value={msgType} onChange={e => setMsgType(e.target.value)} style={S.input}>
                <option value="system">system</option>
                <option value="event">event</option>
                <option value="maintenance">maintenance</option>
                <option value="achievement">achievement</option>
              </select>
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>タイトル</label>
              <input value={msgTitle} onChange={e => setMsgTitle(e.target.value)} style={S.input} placeholder="例：お知らせ" />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>本文</label>
              <textarea value={msgBody} onChange={e => setMsgBody(e.target.value)} style={{ ...S.input, height: 90, resize: 'vertical' }} placeholder="例：本日18:00よりアップデートを行います。" />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>表示時間（秒）</label>
              <input type="number" min="1" max="60" step="0.5" value={msgDisplaySec} onChange={e => setMsgDisplaySec(e.target.value)} style={{ ...S.input, width: 100 }} />
              <span style={{ fontSize: 11, color: '#8888cc', marginTop: 4, display: 'block' }}>デフォルト 4 秒。長いお知らせは 8〜15 秒推奨。</span>
            </div>
            <div style={S.row}>
              <button onClick={sendMessage} disabled={msgSending || !msgTitle || !msgBody} style={S.btnPrimary}>{msgSending ? '送信中…' : '🌐 全ユーザーに送信'}</button>
              {msgResult && <span style={{ color: msgResult.includes('エラー') ? '#f87171' : '#4ade80' }}>{msgResult}</span>}
            </div>
          </div>
        )}

        {/* ══ イベント ══ */}
        {tab === 'dm' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <button onClick={() => { loadDmInbox(); loadOnlinePlayers() }} style={S.btnSm}>🔄 更新</button>
              <span style={S.muted}>未読返信: {dmUnread} 件 / オンライン: {onlinePlayers.length} 人</span>
            </div>
            {dmMsg && <div style={{ color: dmMsg.includes('エラー') ? '#f87171' : '#4ade80', marginBottom: 12 }}>{dmMsg}</div>}

            {/* 受信箱（プレイヤー返信スレッド一覧） */}
            <div style={S.section}>
              <div style={S.sectionTitle}>受信箱（プレイヤーからの返信）</div>
              {dmThreads.length === 0 && <p style={S.muted}>まだ返信はありません。</p>}
              {dmThreads.map(t => (
                <div key={t.player_id}
                  onClick={() => void openDmThread(t.player_id)}
                  style={{ ...S.card, marginTop: 8, cursor: 'pointer', borderColor: t.unread > 0 ? '#e23b2e' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700 }}>{t.player_name ?? '（無名）'}</span>
                    {t.unread > 0 && <span style={{ background: '#e23b2e', color: '#fff', borderRadius: 8, padding: '1px 8px', fontSize: 12, fontWeight: 800 }}>未読{t.unread}</span>}
                    <span style={{ ...S.muted, marginLeft: 'auto', fontSize: 12 }}>{new Date(t.last_at).toLocaleString('ja-JP')}</span>
                  </div>
                  <div style={{ ...S.muted, marginTop: 4, ...S.cellScroll }}>{t.last_body}</div>
                </div>
              ))}
            </div>

            {/* スレッド表示＋返信 */}
            {dmOpenId && (
              <div style={S.section}>
                <div style={S.sectionTitle}>
                  会話：{dmThreads.find(t => t.player_id === dmOpenId)?.player_name ?? dmOpenId}
                  <button onClick={() => { setDmOpenId(null); setDmThread([]) }} style={{ ...S.btnSm, marginLeft: 10 }}>閉じる</button>
                </div>
                <div style={{ ...S.card, marginTop: 0, maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dmThread.map(m => (
                    <div key={m.id} style={{
                      alignSelf: m.sender === 'admin' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%', padding: '6px 10px', borderRadius: 8,
                      background: m.sender === 'admin' ? 'rgba(80,120,200,0.25)' : 'rgba(120,160,90,0.25)',
                    }}>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>
                        {m.sender === 'admin' ? '運営' : 'プレイヤー'}・{new Date(m.created_at).toLocaleString('ja-JP')}{m.title ? `・${m.title}` : ''}
                        {m.sender === 'admin' && <span style={{ color: m.read ? '#4ade80' : '#f0a020', fontWeight: 700 }}>・{m.read ? '既読' : '未読'}</span>}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
                  <textarea value={dmReply} onChange={e => setDmReply(e.target.value)} placeholder="返信を入力…" rows={2} style={{ ...S.input, flex: 1, resize: 'none' }} />
                  <button onClick={() => void replyToThread()} disabled={dmSending || !dmReply.trim()} style={S.btnPrimary}>{dmSending ? '送信中…' : '返信'}</button>
                </div>
              </div>
            )}

            {/* 新規DM送信 */}
            <div style={S.section}>
              <div style={S.sectionTitle}>新規DM送信</div>
              <div style={{ ...S.card, marginTop: 0 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={S.label}>宛先（オンライン中）</label>
                    <select value={dmTargetId} onChange={e => { setDmTargetId(e.target.value); setDmManualId('') }} style={S.input}>
                      <option value="">― 選択 ―</option>
                      {onlinePlayers.map(p => (
                        <option key={p.player_id} value={p.player_id}>{p.player_name}（B{p.floor}F）</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={S.label}>or player_id 直接入力</label>
                    <input value={dmManualId} onChange={e => { setDmManualId(e.target.value); if (e.target.value) setDmTargetId('') }} placeholder="et_player_id" style={S.input} />
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <label style={S.label}>件名</label>
                  <input value={dmTitle} onChange={e => setDmTitle(e.target.value)} placeholder="運営からのお知らせ" style={S.input} />
                </div>
                <div style={{ marginTop: 8 }}>
                  <label style={S.label}>本文</label>
                  <textarea value={dmBody} onChange={e => setDmBody(e.target.value)} rows={4} placeholder="本文" style={{ ...S.input, resize: 'vertical' }} />
                </div>
                <button onClick={() => void sendDm()} disabled={dmSending} style={{ ...S.btnPrimary, marginTop: 10 }}>{dmSending ? '送信中…' : '✉️ DMを送信'}</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'event' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <button onClick={loadOnlinePlayers} style={S.btnSm}>🔄 オンライン更新</button>
              <span style={S.muted}>オンライン中: {onlinePlayers.length} 人{evLoading ? '（読み込み中…）' : ''}</span>
            </div>
            {evMsg && <div style={{ color: evMsg.includes('エラー') ? '#f87171' : '#4ade80', marginBottom: 12 }}>{evMsg}</div>}

            {/* イベント強制発動 */}
            <div style={S.section}>
              <div style={S.sectionTitle}>イベント強制発動</div>
              <div style={{ ...S.card, marginTop: 0 }}>
                <div style={S.cardTitle}>すかるぽりん出現（全プレイヤー対象・即時）</div>
                <button onClick={fireSkulporin} style={S.btnPrimary}>👹 すかるぽりんを出現させる</button>
              </div>
              <div style={S.card}>
                <div style={S.cardTitle}>モンスターハウス強制発動（指定プレイヤーの次フロア）</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <label style={S.label}>対象プレイヤー（オンライン中）</label>
                    <select value={evMhTargetId} onChange={e => setEvMhTargetId(e.target.value)} style={S.input}>
                      <option value="">― 選択 ―</option>
                      {onlinePlayers.map(p => (
                        <option key={p.player_id} value={p.player_id}>{p.player_name}（B{p.floor}F）</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={fireMonsterHouse} disabled={!evMhTargetId} style={S.btnPrimary}>🏠 モンスターハウス発動</button>
                </div>
                <p style={{ ...S.muted, marginTop: 8, marginBottom: 0 }}>対象が次のフロアへ進んだ時にモンスターハウス化します。</p>
              </div>
            </div>

            {/* モンスター強制ポップ */}
            <div style={S.section}>
              <div style={S.sectionTitle}>モンスター強制ポップ</div>
              <div style={{ ...S.card, marginTop: 0 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ minWidth: 200 }}>
                    <label style={S.label}>モンスター</label>
                    <select value={evMonster} onChange={e => setEvMonster(e.target.value)} style={S.input}>
                      {MONSTER_REGISTRY.map(m => (
                        <option key={m.name} value={m.name}>[{m.category}] {m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={S.label}>対象プレイヤー（オンライン中）</label>
                    <select value={evTargetId} onChange={e => { setEvTargetId(e.target.value); const p = onlinePlayers.find(o => o.player_id === e.target.value); if (p) setEvFloor(String(p.floor)) }} style={S.input}>
                      <option value="">― 選択 ―</option>
                      {onlinePlayers.map(p => (
                        <option key={p.player_id} value={p.player_id}>{p.player_name}（B{p.floor}F）</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={S.label}>出現フロア</label>
                    <input type="number" min="1" value={evFloor} onChange={e => setEvFloor(e.target.value === '' ? '' : String(Math.max(1, parseInt(e.target.value, 10) || 1)))} placeholder="現在階" style={{ ...S.input, width: 100 }} />
                  </div>
                  <button onClick={fireSpawnMonster} disabled={!evTargetId} style={S.btnPrimary}>⚡ 出現させる</button>
                </div>
                <p style={{ ...S.muted, marginTop: 8, marginBottom: 0 }}>
                  通常モンスター=通常戦闘 / MINI・MVP・エリア=ボス仕様 / すかるぽりん=特殊仕様。
                  対象が現在いる階と異なる階を指定した場合、その階に到達した時に出現します。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ══ ランキング ══ */}
        {tab === 'ranking' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={rSearch} onChange={e => setRSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadRankings(rSearch)}
                placeholder="プレイヤー名で検索" style={{ ...S.input, flex: 1 }} />
              <button onClick={() => loadRankings(rSearch)} style={S.btnPrimary}>検索</button>
              <button onClick={() => { setRSearch(''); loadRankings('') }} style={S.btnSm}>全件</button>
              {rankSelected.size > 0 && (
                <button onClick={bulkDeleteRankings} style={S.btnDanger}>選択削除 ({rankSelected.size})</button>
              )}
            </div>

            {rMsg && <div style={{ color: rMsg.includes('エラー') ? '#f87171' : '#4ade80', marginBottom: 8 }}>{rMsg}</div>}

            {editingRanking && (
              <div style={{ ...S.card, marginBottom: 12 }}>
                <div style={S.cardTitle}>編集中 — ID: {editingRanking.id}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div>
                    <label style={S.label}>プレイヤー名</label>
                    <input value={editingRanking.player_name}
                      onChange={e => setEditingRanking(r => r && { ...r, player_name: e.target.value })}
                      style={{ ...S.input, width: 180 }} />
                  </div>
                  <div>
                    <label style={S.label}>最深階</label>
                    <input type="number" value={editingRanking.floor}
                      onChange={e => setEditingRanking(r => r && { ...r, floor: parseInt(e.target.value) || 0 })}
                      style={{ ...S.input, width: 80 }} />
                  </div>
                  <div>
                    <label style={S.label}>レベル</label>
                    <input type="number" value={editingRanking.level}
                      onChange={e => setEditingRanking(r => r && { ...r, level: parseInt(e.target.value) || 0 })}
                      style={{ ...S.input, width: 80 }} />
                  </div>
                  <button onClick={saveEditRanking} style={S.btnPrimary}>保存</button>
                  <button onClick={() => setEditingRanking(null)} style={S.btnSm}>キャンセル</button>
                </div>
              </div>
            )}

            {rLoading ? <p style={S.muted}>読み込み中…</p> : (
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>
                    <input type="checkbox"
                      checked={rankings.length > 0 && rankSelected.size === rankings.length}
                      onChange={e => setRankSelected(e.target.checked ? new Set(rankings.map(r => r.id)) : new Set())} />
                  </th>
                  <th style={S.th}>#</th><th style={S.th}>ID</th>
                  <th style={S.th}>プレイヤー名</th><th style={S.th}>最深</th>
                  <th style={S.th}>Lv</th><th style={S.th}>日時 (JST)</th>
                  <th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {rankings.map((r, i) => (
                    <tr key={r.id} style={editingRanking?.id === r.id ? { background: 'rgba(79,70,229,0.08)' } : rankSelected.has(r.id) ? { background: 'rgba(239,68,68,0.07)' } : {}}>
                      <td style={S.td}>
                        <input type="checkbox" checked={rankSelected.has(r.id)}
                          onChange={e => setRankSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(r.id) : s.delete(r.id); return s })} />
                      </td>
                      <td style={S.td}>{i + 1}</td>
                      <td style={{ ...S.td, color: '#666' }}>{r.id}</td>
                      <td style={S.td}>{r.player_name}</td>
                      <td style={S.td}>{r.floor}F</td>
                      <td style={S.td}>Lv{r.level}</td>
                      <td style={S.td}>{fmtJstDate(r.created_at)}</td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => setEditingRanking({ id: r.id, player_name: r.player_name, floor: r.floor, level: r.level })} style={S.btnSm}>編集</button>
                          <button onClick={() => deleteRanking(r.id)} style={S.btnDanger}>削除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rankings.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#666', textAlign: 'center' }}>データなし</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ══ ワールドログ ══ */}
        {tab === 'worldlog' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <input value={wlSearch} onChange={e => setWlSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadWorldLogs(wlSearch, wlType)}
                placeholder="プレイヤー名で絞り込み" style={{ ...S.input, flex: 1, minWidth: 140 }} />
              <select value={wlType} onChange={e => setWlType(e.target.value)} style={{ ...S.input, width: 'auto' }}>
                <option value="">全タイプ</option>
                <option value="world">world</option>
                <option value="boss">boss</option>
                <option value="achievement">achievement</option>
                <option value="system">system</option>
                <option value="event">event</option>
                <option value="maintenance">maintenance</option>
              </select>
              <button onClick={() => loadWorldLogs(wlSearch, wlType)} style={S.btnPrimary}>検索</button>
              <button onClick={() => { setWlSearch(''); setWlType(''); loadWorldLogs() }} style={S.btnSm}>リセット</button>
              {wlSelected.size > 0 && (
                <button onClick={bulkDeleteWorldLogs} style={S.btnDanger}>選択削除 ({wlSelected.size})</button>
              )}
            </div>

            {wlMsg && <div style={{ color: wlMsg.includes('エラー') ? '#f87171' : '#4ade80', marginBottom: 8 }}>{wlMsg}</div>}

            {wlLoading ? <p style={S.muted}>読み込み中…</p> : (
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>
                    <input type="checkbox"
                      checked={wlogs.length > 0 && wlSelected.size === wlogs.length}
                      onChange={e => setWlSelected(e.target.checked ? new Set(wlogs.map(n => n.id)) : new Set())} />
                  </th>
                  <th style={S.th}>ID</th><th style={S.th}>日時 (JST)</th>
                  <th style={S.th}>タイプ</th><th style={S.th}>プレイヤー</th>
                  <th style={S.th}>タイトル</th><th style={S.th}>本文</th>
                  <th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {wlogs.map(n => (
                    <tr key={n.id} style={wlSelected.has(n.id) ? { background: 'rgba(239,68,68,0.07)' } : {}}>
                      <td style={S.td}>
                        <input type="checkbox" checked={wlSelected.has(n.id)}
                          onChange={e => setWlSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(n.id) : s.delete(n.id); return s })} />
                      </td>
                      <td style={{ ...S.td, color: '#666' }}>{n.id}</td>
                      <td style={S.td}>{fmtJstDate(n.created_at)}</td>
                      <td style={S.td}><span style={{ padding: '2px 6px', background: 'rgba(79,70,229,0.2)', borderRadius: 4, fontSize: 11 }}>{n.type}</span></td>
                      <td style={S.td}>{n.player_name}</td>
                      <td style={S.td}>{n.title}</td>
                      <td style={{ ...S.td, maxWidth: 200 }}><div style={S.cellScroll}>{n.message}</div></td>
                      <td style={S.td}><button onClick={() => deleteWorldLog(n.id)} style={S.btnDanger}>削除</button></td>
                    </tr>
                  ))}
                  {wlogs.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#666', textAlign: 'center' }}>データなし</td></tr>}
                </tbody>
              </table>
            )}
            <p style={S.muted}>最新 200 件表示</p>
          </div>
        )}

        {/* ══ ユーザー管理 ══ */}
        {tab === 'users' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input value={uSearch} onChange={e => setUSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchUser()}
                placeholder="プレイヤー名で検索（部分一致）" style={{ ...S.input, flex: 1 }} />
              <button onClick={searchUser} disabled={uLoading} style={S.btnPrimary}>検索</button>
            </div>

            {uMsg && <div style={{ color: uMsg.includes('エラー') ? '#f87171' : '#4ade80', marginBottom: 10 }}>{uMsg}</div>}
            {uLoading && <p style={S.muted}>読み込み中…</p>}

            {uSearched && !uLoading && (
              <>
                {/* 現在のステータス・装備（最終同期：active_sessions.state） */}
                <div style={S.section}>
                  <div style={S.sectionTitle}>現在のステータス・装備 — "{uSearched}" ({uSessions.length} 件)</div>
                  <p style={S.muted}>※ プレイ中の心拍（約30秒ごと）で同期される最終状態です。オフラインの場合は最後に同期された時点の内容です。</p>
                  {uSessions.length === 0 && <p style={S.muted}>同期データなし（未プレイ／古いバージョン／state列未追加の可能性）。</p>}
                  {uSessions.map(sess => {
                    const st = sess.state
                    return (
                      <div key={sess.player_id} style={{ ...S.card, marginBottom: 10 }}>
                        <div style={S.cardTitle}>
                          {sess.player_name}
                          <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>最終同期: {fmtJstDate(sess.updated_at)}</span>
                        </div>
                        {!st ? <p style={S.muted}>状態スナップショットなし（floor {sess.floor}F）</p> : (
                          <>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 13, marginBottom: 8 }}>
                              <span>Lv <b>{st.level}</b></span>
                              <span>EXP {st.exp}</span>
                              <span>到達 <b>{st.floor}F</b></span>
                              <span>HP {st.hp}/{st.maxHp}</span>
                              <span>スタミナ {st.stamina}/{st.maxStamina}</span>
                              <span>ターン {st.turn}</span>
                              <span>未割振Pt {st.statPoints}</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 13, marginBottom: 8, color: '#a5b4fc' }}>
                              <span>STR {st.str}</span><span>AGI {st.agi}</span><span>DEX {st.dex}</span>
                              <span>INT {st.int}</span><span>VIT {st.vit}</span><span>LUK {st.luk}</span>
                            </div>
                            <div style={{ fontSize: 13 }}>
                              <div style={{ color: '#888', marginBottom: 2 }}>装備</div>
                              {st.equipment.length === 0 ? <span style={{ color: '#666' }}>なし</span> : (
                                <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                                  {st.equipment.map((e, i) => (
                                    <li key={i}>{EQUIP_SLOT_LABELS[e.slot] ?? e.slot}：{e.name}{e.refine ? ` +${e.refine}` : ''}</li>
                                  ))}
                                </ul>
                              )}
                              <div style={{ color: '#888', marginBottom: 2 }}>魔法の書</div>
                              <div style={{ marginBottom: 8 }}>{st.spells.length ? st.spells.join('、') : <span style={{ color: '#666' }}>なし</span>}</div>
                              <div style={{ color: '#888', marginBottom: 2 }}>所持品（回復/コイン）</div>
                              <div style={{ marginBottom: 8 }}>{st.heals.length ? st.heals.map(h => `${h.name}×${h.count}`).join('、') : <span style={{ color: '#666' }}>なし</span>}</div>
                              <div style={{ color: '#888', marginBottom: 2 }}>バッグ内装備</div>
                              <div>{st.bagEquip.length ? st.bagEquip.map(b => `${b.name}${b.refine ? ` +${b.refine}` : ''}`).join('、') : <span style={{ color: '#666' }}>なし</span>}</div>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* ランキング */}
                <div style={S.section}>
                  <div style={S.sectionTitle}>ランキング記録 — "{uSearched}" ({uRankings.length} 件)</div>

                  {uEditingRanking && (
                    <div style={{ ...S.card, marginBottom: 10 }}>
                      <div style={S.cardTitle}>編集中 — ID: {uEditingRanking.id}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div>
                          <label style={S.label}>プレイヤー名</label>
                          <input value={uEditingRanking.player_name}
                            onChange={e => setUEditingRanking(r => r && { ...r, player_name: e.target.value })}
                            style={{ ...S.input, width: 180 }} />
                        </div>
                        <div>
                          <label style={S.label}>最深階（階層移動）</label>
                          <input type="number" value={uEditingRanking.floor}
                            onChange={e => setUEditingRanking(r => r && { ...r, floor: parseInt(e.target.value) || 0 })}
                            style={{ ...S.input, width: 90 }} />
                        </div>
                        <div>
                          <label style={S.label}>レベル（ステータス修正）</label>
                          <input type="number" value={uEditingRanking.level}
                            onChange={e => setUEditingRanking(r => r && { ...r, level: parseInt(e.target.value) || 0 })}
                            style={{ ...S.input, width: 90 }} />
                        </div>
                        <button onClick={saveUEditRanking} style={S.btnPrimary}>保存</button>
                        <button onClick={() => setUEditingRanking(null)} style={S.btnSm}>キャンセル</button>
                      </div>
                    </div>
                  )}

                  <table style={S.table}>
                    <thead><tr>
                      <th style={S.th}>ID</th><th style={S.th}>プレイヤー名</th>
                      <th style={S.th}>最深</th><th style={S.th}>Lv</th>
                      <th style={S.th}>日時 (JST)</th><th style={S.th}></th>
                    </tr></thead>
                    <tbody>
                      {uRankings.map(r => (
                        <tr key={r.id} style={uEditingRanking?.id === r.id ? { background: 'rgba(79,70,229,0.08)' } : {}}>
                          <td style={{ ...S.td, color: '#666' }}>{r.id}</td>
                          <td style={S.td}>{r.player_name}</td>
                          <td style={S.td}>{r.floor}F</td>
                          <td style={S.td}>Lv{r.level}</td>
                          <td style={S.td}>{fmtJstDate(r.created_at)}</td>
                          <td style={S.td}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => setUEditingRanking({ id: r.id, player_name: r.player_name, floor: r.floor, level: r.level })} style={S.btnSm}>編集</button>
                              <button onClick={() => deleteURanking(r.id)} style={S.btnDanger}>削除</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {uRankings.length === 0 && <tr><td colSpan={6} style={{ ...S.td, color: '#666', textAlign: 'center' }}>データなし</td></tr>}
                    </tbody>
                  </table>
                </div>

                {/* ワールドログ */}
                <div style={S.section}>
                  <div style={S.sectionTitle}>ワールドログ — "{uSearched}" ({uNotifs.length} 件)</div>
                  <table style={S.table}>
                    <thead><tr>
                      <th style={S.th}>ID</th><th style={S.th}>日時 (JST)</th>
                      <th style={S.th}>タイプ</th><th style={S.th}>タイトル</th>
                      <th style={S.th}>本文</th><th style={S.th}></th>
                    </tr></thead>
                    <tbody>
                      {uNotifs.map(n => (
                        <tr key={n.id}>
                          <td style={{ ...S.td, color: '#666' }}>{n.id}</td>
                          <td style={S.td}>{fmtJstDate(n.created_at)}</td>
                          <td style={S.td}><span style={{ padding: '2px 6px', background: 'rgba(79,70,229,0.2)', borderRadius: 4, fontSize: 11 }}>{n.type}</span></td>
                          <td style={S.td}>{n.title}</td>
                          <td style={{ ...S.td, maxWidth: 180 }}><div style={S.cellScroll}>{n.message}</div></td>
                          <td style={S.td}><button onClick={() => deleteUNotif(n.id)} style={S.btnDanger}>削除</button></td>
                        </tr>
                      ))}
                      {uNotifs.length === 0 && <tr><td colSpan={6} style={{ ...S.td, color: '#666', textAlign: 'center' }}>データなし</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══ 報告BOX ══ */}
        {tab === 'reports' && (
          <div>
            {/* Filter bar */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={repCatF} onChange={e => setRepCatF(e.target.value)} style={{ ...S.input, width: 'auto' }}>
                <option value="">全カテゴリ</option>
                <option value="要望">要望</option>
                <option value="不具合報告">不具合報告</option>
                <option value="質問">質問</option>
                <option value="その他">その他</option>
              </select>
              {(['', 'new', 'read', 'done'] as const).map(st => (
                <button key={st} onClick={() => setRepStatusF(st)}
                  style={{ ...S.btnSm, background: repStatusF === st ? 'rgba(79,70,229,0.35)' : 'transparent', border: `1px solid ${repStatusF === st ? '#6366f1' : '#2a2a4a'}`, color: repStatusF === st ? '#a5b4fc' : '#666' }}>
                  {st === '' ? '全件' : REP_STATUS_LABEL[st]}
                  {st === 'new' && reports.filter(r => r.status === 'new').length > 0 && repStatusF !== 'new' && (
                    <span style={{ marginLeft: 4, background: '#ef4444', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {reports.filter(r => r.status === 'new').length}
                    </span>
                  )}
                </button>
              ))}
              <button onClick={() => loadReports(repStatusF, repCatF)} style={S.btnPrimary}>検索</button>
              <button onClick={() => { setRepStatusF(''); setRepCatF(''); loadReports() }} style={S.btnSm}>リセット</button>
              {repSelected.size > 0 && (
                <button onClick={bulkDeleteReports} style={S.btnDanger}>選択削除 ({repSelected.size})</button>
              )}
            </div>

            {repMsg && <div style={{ color: repMsg.includes('エラー') ? '#f87171' : '#4ade80', marginBottom: 10 }}>{repMsg}</div>}

            {/* Detail panel */}
            {repDetail && (
              <div style={{ ...S.card, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontWeight: 700 }}>
                    <span style={{ padding: '2px 8px', background: 'rgba(79,70,229,0.25)', borderRadius: 4, fontSize: 12, marginRight: 8 }}>{repDetail.category}</span>
                    {repDetail.player_name ?? '（匿名）'}
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#666' }}>ID:{repDetail.id} — {fmtJstDate(repDetail.created_at)}</span>
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      value={repDetail.status}
                      onChange={e => updateRepStatus(repDetail.id, e.target.value as Report['status'])}
                      style={{ ...S.input, width: 'auto', fontSize: 12 }}>
                      <option value="new">新規</option>
                      <option value="read">確認済</option>
                      <option value="done">完了</option>
                    </select>
                    <button onClick={() => deleteReport(repDetail.id)} style={S.btnDanger}>削除</button>
                    <button onClick={() => setRepDetail(null)} style={S.btnSm}>閉じる</button>
                  </div>
                </div>
                <div style={{ fontSize: 14, color: '#e8e8f8', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#080818', padding: '10px 12px', borderRadius: 6, border: '1px solid #1e1e38' }}>
                  {repDetail.content}
                </div>
                {repDetail.image_url && (
                  <div style={{ marginTop: 10 }}>
                    <a href={repDetail.image_url} target="_blank" rel="noreferrer">
                      <img src={repDetail.image_url} alt="添付画像"
                        style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 6, border: '1px solid #2a2a4a' }} />
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Table */}
            {repLoading ? <p style={S.muted}>読み込み中…</p> : (
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>
                    <input type="checkbox"
                      checked={reports.length > 0 && repSelected.size === reports.length}
                      onChange={e => setRepSelected(e.target.checked ? new Set(reports.map(r => r.id)) : new Set())} />
                  </th>
                  <th style={S.th}>ID</th><th style={S.th}>日時 (JST)</th>
                  <th style={S.th}>カテゴリ</th><th style={S.th}>内容（抜粋）</th>
                  <th style={S.th}>名前</th><th style={S.th}>画像</th>
                  <th style={S.th}>ステータス</th><th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {reports.map(r => (
                    <tr key={r.id}
                      onClick={() => openRepDetail(r)}
                      style={{ cursor: 'pointer', background: repDetail?.id === r.id ? 'rgba(79,70,229,0.08)' : repSelected.has(r.id) ? 'rgba(239,68,68,0.07)' : r.status === 'new' ? 'rgba(239,68,68,0.05)' : 'transparent' }}>
                      <td style={S.td} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={repSelected.has(r.id)}
                          onChange={e => setRepSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(r.id) : s.delete(r.id); return s })} />
                      </td>
                      <td style={{ ...S.td, color: '#666' }}>{r.id}</td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{fmtJstDate(r.created_at)}</td>
                      <td style={S.td}><span style={{ padding: '2px 6px', background: 'rgba(79,70,229,0.2)', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap' }}>{r.category}</span></td>
                      <td style={{ ...S.td, maxWidth: 220 }}><div style={S.cellScroll}>{r.content}</div></td>
                      <td style={S.td}>{r.player_name ?? <span style={{ color: '#555' }}>─</span>}</td>
                      <td style={S.td}>{r.image_url ? <span style={{ color: '#60a5fa' }}>📎</span> : <span style={{ color: '#555' }}>─</span>}</td>
                      <td style={S.td}>
                        <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: `${REP_STATUS_COLOR[r.status]}22`, color: REP_STATUS_COLOR[r.status], border: `1px solid ${REP_STATUS_COLOR[r.status]}55` }}>
                          {REP_STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td style={S.td} onClick={e => e.stopPropagation()}>
                        <button onClick={() => deleteReport(r.id)} style={S.btnDanger}>削除</button>
                      </td>
                    </tr>
                  ))}
                  {reports.length === 0 && <tr><td colSpan={9} style={{ ...S.td, color: '#666', textAlign: 'center' }}>データなし</td></tr>}
                </tbody>
              </table>
            )}
            <p style={S.muted}>行クリックで詳細表示・既読マーク。最大300件。</p>
          </div>
        )}

        {/* ══ お知らせ ══ */}
        {tab === 'news' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={openNewForm} style={S.btnPrimary}>＋ 新規作成</button>
              <button onClick={loadNews} style={S.btnSm}>再読込</button>
              {newsMsg && <span style={{ color: newsMsg.includes('エラー') ? '#f87171' : '#4ade80', fontSize: 13 }}>{newsMsg}</span>}
            </div>

            {/* 作成・編集フォーム */}
            {formOpen && (
              <div style={{ ...S.card, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontWeight: 700 }}>{editingId && editingId > 0 ? `編集 (ID:${editingId})` : '新規お知らせ'}</span>
                  <button onClick={closeForm} style={S.btnSm}>閉じる</button>
                </div>
                <label style={S.label}>タイトル</label>
                <input value={nfTitle} onChange={e => setNfTitle(e.target.value)} maxLength={120}
                  placeholder="例：新アイテム『蝶の羽』登場！" style={{ ...S.input, marginBottom: 10 }} />
                <label style={S.label}>本文（太字 / サイズ / 色 / 画像挿入が可能）</label>
                <RichTextEditor key={editorKey} initialHtml={nfBody} onChange={setNfBody} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#cfcff0' }}>
                    <input type="checkbox" checked={nfPublished} onChange={e => setNfPublished(e.target.checked)} />
                    公開する
                  </label>
                  <button onClick={saveNews} style={S.btnPrimary}>保存</button>
                </div>
                {/* プレビュー */}
                <div style={{ marginTop: 14 }}>
                  <label style={S.label}>プレビュー</label>
                  <div style={{ background: 'linear-gradient(180deg,#f3e4c2,#e2cb98)', color: '#3a2a14', borderRadius: 8, padding: 14, border: '2px solid #9c7a33' }}>
                    <div style={{ fontWeight: 700, fontSize: 18, color: '#5a3d12', marginBottom: 8 }}>{nfTitle || '（タイトル未入力）'}</div>
                    <RichTextView html={nfBody} className="news-body" />
                  </div>
                </div>
              </div>
            )}

            {/* 一覧（VIEW数つき）*/}
            {newsLoading ? <p style={S.muted}>読み込み中…</p> : (
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>ID</th><th style={S.th}>掲載日 (JST)</th>
                  <th style={S.th}>タイトル</th><th style={S.th}>公開</th>
                  <th style={S.th}>VIEW</th><th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {news.map(a => (
                    <tr key={a.id} style={{ background: editingId === a.id ? 'rgba(79,70,229,0.08)' : 'transparent' }}>
                      <td style={{ ...S.td, color: '#666' }}>{a.id}</td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{fmtJstDate(a.published_at)}</td>
                      <td style={{ ...S.td, maxWidth: 260 }}><div style={S.cellScroll}>{a.title}</div></td>
                      <td style={S.td}>
                        <button onClick={() => togglePublish(a)}
                          style={{ ...S.btnSm, background: a.is_published ? 'rgba(20,83,45,0.5)' : 'transparent', border: `1px solid ${a.is_published ? '#22c55e' : '#666'}`, color: a.is_published ? '#4ade80' : '#888' }}>
                          {a.is_published ? '公開中' : '非公開'}
                        </button>
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.view_count}</td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => openEditForm(a)} style={S.btnSm}>編集</button>
                          <button onClick={() => deleteNews(a)} style={S.btnDanger}>削除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {news.length === 0 && <tr><td colSpan={6} style={{ ...S.td, color: '#666', textAlign: 'center' }}>お知らせはまだありません</td></tr>}
                </tbody>
              </table>
            )}
            <p style={S.muted}>VIEW数は同一ブラウザ1記事1カウント（水増し防止）。最大200件表示。</p>
          </div>
        )}

        {/* ══ 統計 ══ */}
        {tab === 'stats' && (
          <div>
            <button onClick={loadStats} style={{ ...S.btnSm, marginBottom: 16 }}>🔄 更新</button>
            {statsError && (
              <div style={{ padding: '10px 14px', background: 'rgba(127,29,29,0.4)', border: '1px solid #dc2626', borderRadius: 8, marginBottom: 16 }}>
                <div style={{ color: '#f87171', fontWeight: 700, marginBottom: 4 }}>エラー</div>
                <div style={{ color: '#fca5a5', fontSize: 13 }}>{statsError}</div>
                <div style={{ color: '#aaa', fontSize: 11, marginTop: 8 }}>考えられる原因: game_eventsテーブルが未作成 / RLSでSELECTが禁止されている</div>
              </div>
            )}
            {!stats ? <p style={S.muted}>読み込み中…</p> : <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                <div style={S.statCard}>
                  <div style={S.statLabel}>総死亡回数</div>
                  <div style={S.statValue}>{stats.totalDeaths.toLocaleString()}</div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>総撃破数</div>
                  <div style={S.statValue}>{stats.totalKills.toLocaleString()}</div>
                </div>
              </div>
              <div style={S.section}>
                <div style={S.sectionTitle}>💀 すかるぽりん</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={S.statCard}>
                    <div style={S.statLabel}>出現回数</div>
                    <div style={S.statValue}>{stats.skulporinTotal.toLocaleString()}</div>
                  </div>
                  <div style={S.statCard}>
                    <div style={S.statLabel}>討伐数</div>
                    <div style={{ ...S.statValue, color: '#4ade80' }}>{stats.skulporinDefeated.toLocaleString()}</div>
                  </div>
                  <div style={S.statCard}>
                    <div style={S.statLabel}>逃走数</div>
                    <div style={{ ...S.statValue, color: '#f87171' }}>{stats.skulporinEscaped.toLocaleString()}</div>
                  </div>
                  <div style={S.statCard}>
                    <div style={S.statLabel}>討伐率</div>
                    <div style={S.statValue}>
                      {stats.skulporinTotal > 0
                        ? `${Math.round(stats.skulporinDefeated / stats.skulporinTotal * 100)}%`
                        : '—'}
                    </div>
                  </div>
                </div>
              </div>
              <div style={S.section}>
                <div style={S.sectionTitle}>撃破数ランキング（全敵種）</div>
                {stats.killDist.length === 0
                  ? <p style={S.muted}>データなし（killイベントがまだ記録されていません）</p>
                  : stats.killDist.map(([name, count]) => {
                      const maxCount = stats.killDist[0][1]
                      return (
                        <div key={name} style={S.distRow}>
                          <span style={{ ...S.distLabel, width: 160, wordBreak: 'break-word' }}>{name}</span>
                          <div style={{ ...S.distBar, width: Math.max(4, Math.round(count / maxCount * 260)) }} />
                          <span style={S.distCount}>{count.toLocaleString()}</span>
                        </div>
                      )
                    })
                }
              </div>
              <div style={S.section}>
                <div style={S.sectionTitle}>死亡フロア分布（上位20）</div>
                {stats.floorDist.slice(0, 20).map(([floor, count]) => (
                  <div key={floor} style={S.distRow}>
                    <span style={{ ...S.distLabel, width: 50 }}>{floor}</span>
                    <div style={{ ...S.distBar, width: Math.min(260, count * 10) }} />
                    <span style={S.distCount}>{count}</span>
                  </div>
                ))}
              </div>
              <div style={S.section}>
                <div style={S.sectionTitle}>スロット結果分布</div>
                {stats.slotDist.map(([result, count]) => (
                  <div key={result} style={S.distRow}>
                    <span style={{ ...S.distLabel, width: 130 }}>{result}</span>
                    <div style={{ ...S.distBar, width: Math.min(260, count * 4) }} />
                    <span style={S.distCount}>{count}</span>
                  </div>
                ))}
              </div>
            </>}
          </div>
        )}

        {/* ══ データベース（参照専用・ゲームデータを直接参照）══ */}
        {tab === 'database' && (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {([['monster', `モンスター (${NORMAL_MONSTERS.length + MINI_BOSSES.length + MVP_BOSSES.length + AREA_BOSSES.length})`],
                 ['equip', `装備 (${EQUIPMENT.length})`],
                 ['item', `アイテム (${HEAL_ITEMS.length + Object.keys(WING_ITEMS).length + 1})`],
                 ['spell', `魔法の書 (${SPELLS.length})`]] as [DbTab, string][]).map(([key, label]) => (
                <button key={key} onClick={() => { setDbTab(key); setDbEditing(null) }}
                  style={{ ...S.btnSm, background: dbTab === key ? 'rgba(79,70,229,0.35)' : 'transparent', border: `1px solid ${dbTab === key ? '#6366f1' : '#2a2a4a'}`, color: dbTab === key ? '#a5b4fc' : '#888' }}>
                  {label}
                </button>
              ))}
              <button onClick={loadDbRows} style={S.btnSm}>再読込</button>
            </div>
            <p style={S.muted}>行をクリックすると編集できます。<b>保存</b>=下書き / <b>公開</b>=全プレイヤーの次回読み込みから反映。画像はモンスターのみ（自動透過＋主人公サイズ調整）。</p>

            {/* 編集パネル */}
            {dbEditing && (
              <div style={{ ...S.card, margin: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontWeight: 700 }}>
                    編集：{dbEditing.ref}
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>({dbEditing.category})</span>
                    {dbStatusOf(dbEditing.category, dbEditing.ref) === 'pub' && <span style={{ ...S.dbPub, marginLeft: 8 }}>公開中</span>}
                    {dbStatusOf(dbEditing.category, dbEditing.ref) === 'draft' && <span style={{ ...S.dbDraft, marginLeft: 8 }}>下書きあり</span>}
                  </span>
                  <button onClick={() => setDbEditing(null)} style={S.btnSm}>閉じる</button>
                </div>
                {dbEditing.category.startsWith('monster_') && (
                  <GameAppearancePreview
                    key={dbEditing.ref}
                    category={dbEditing.category}
                    refName={dbEditing.ref}
                    pubImage={(dbRowOf(dbEditing.category, dbEditing.ref)?.pub_image as string | undefined) ?? null}
                  />
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                  {DB_SCHEMA[dbEditing.category].fields.map(f => (
                    <div key={f.key}>
                      <label style={S.label}>{f.label}</label>
                      {f.type === 'area'
                        ? <textarea value={dbForm[f.key] ?? ''} onChange={e => setDbForm(s => ({ ...s, [f.key]: e.target.value }))} rows={2} style={{ ...S.input, resize: 'vertical' }} />
                        : <input type={f.type === 'num' ? 'number' : 'text'} value={dbForm[f.key] ?? ''} onChange={e => setDbForm(s => ({ ...s, [f.key]: e.target.value }))} style={S.input} />}
                    </div>
                  ))}
                </div>
                {DB_SCHEMA[dbEditing.category].image && (
                  <div style={{ marginTop: 12 }}>
                    <label style={S.label}>画像（アップロード→保存/公開で反映。自動透過＋可視部分を主人公サイズに調整）</label>
                    <input type="file" accept="image/*" disabled={dbBusy} onChange={e => uploadDbImage(e.target.files?.[0])} style={{ fontSize: 13, color: '#aaa', display: 'block' }} />
                    {dbImage && <div style={{ marginTop: 8 }}><img src={dbImage} alt="" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 6, border: '1px solid #2a2a4a', background: '#222' }} /></div>}
                  </div>
                )}
                {dbMsg && <div style={{ marginTop: 10, color: /エラー|失敗/.test(dbMsg) ? '#f87171' : '#4ade80', fontSize: 13 }}>{dbMsg}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <button onClick={saveDb} disabled={dbBusy} style={S.btnSm}>下書き保存</button>
                  <button onClick={publishDb} disabled={dbBusy} style={S.btnPrimary}>公開（ライブ反映）</button>
                  <button onClick={unpublishDb} disabled={dbBusy} style={S.btnSm}>公開停止</button>
                  <button onClick={deleteDb} disabled={dbBusy} style={S.btnDanger}>削除（デフォルトに戻す）</button>
                </div>
              </div>
            )}

            {dbTab === 'monster' && (
              <>
                <div style={S.dbHead}>通常モンスター（レアリティ：通常）</div>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>状態</th><th style={S.th}>名前</th><th style={S.th}>出現F</th><th style={S.th}>HP</th><th style={S.th}>ATK</th><th style={S.th}>DEF</th>
                    <th style={S.th}>STR</th><th style={S.th}>VIT</th><th style={S.th}>AGI</th><th style={S.th}>LUK</th>
                  </tr></thead>
                  <tbody>
                    {NORMAL_MONSTERS.map(m => {
                      const v = dbMerged('monster_normal', m)
                      return (
                      <tr key={m.name} onClick={() => openDbEditor('monster_normal', m)} style={dbRowStyle('monster_normal', m.name)}>
                        {dbStatusCell('monster_normal', m.name)}
                        <td style={S.td}>{v.name}</td>
                        <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{v.minFloor}〜{v.maxFloor}</td>
                        <td style={S.td}>{v.hpBase}</td><td style={S.td}>{v.atkBase}</td><td style={S.td}>{v.defBase}</td>
                        <td style={S.td}>{v.str}</td><td style={S.td}>{v.vit}</td><td style={S.td}>{v.agi}</td><td style={S.td}>{v.luk}</td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p style={S.muted}>※ HP/ATK/DEF はベース値。実際は出現フロアに応じてスケールします。</p>

                <div style={S.dbHead}>MINIボス</div>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>状態</th><th style={S.th}>出現F</th><th style={S.th}>名前</th><th style={S.th}>HP倍率</th><th style={S.th}>ATK倍率</th><th style={S.th}>DEF倍率</th></tr></thead>
                  <tbody>
                    {MINI_BOSSES.map(b => {
                      const v = dbMerged('monster_mini', b)
                      return (
                      <tr key={`mini-${b.floor}-${b.name}`} onClick={() => openDbEditor('monster_mini', b)} style={dbRowStyle('monster_mini', b.name)}>
                        {dbStatusCell('monster_mini', b.name)}<td style={S.td}>B{b.floor}</td><td style={S.td}>{v.name}</td><td style={S.td}>×{v.hpMult}</td><td style={S.td}>×{v.atkMult}</td><td style={S.td}>×{v.defMult}</td></tr>
                      )
                    })}
                  </tbody>
                </table>

                <div style={S.dbHead}>MVPボス</div>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>状態</th><th style={S.th}>出現F</th><th style={S.th}>名前</th><th style={S.th}>HP倍率</th><th style={S.th}>ATK倍率</th><th style={S.th}>DEF倍率</th></tr></thead>
                  <tbody>
                    {MVP_BOSSES.map(b => {
                      const v = dbMerged('monster_mvp', b)
                      return (
                      <tr key={`mvp-${b.floor}-${b.name}`} onClick={() => openDbEditor('monster_mvp', b)} style={dbRowStyle('monster_mvp', b.name)}>
                        {dbStatusCell('monster_mvp', b.name)}<td style={S.td}>B{b.floor}</td><td style={S.td}>{v.name}</td><td style={S.td}>×{v.hpMult}</td><td style={S.td}>×{v.atkMult}</td><td style={S.td}>×{v.defMult}</td></tr>
                      )
                    })}
                  </tbody>
                </table>

                <div style={S.dbHead}>エリアボス</div>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>状態</th><th style={S.th}>名前</th><th style={S.th}>出現F</th></tr></thead>
                  <tbody>
                    {AREA_BOSSES.map(b => {
                      const v = dbMerged('monster_area', b)
                      return (
                      <tr key={`area-${b.name}`} onClick={() => openDbEditor('monster_area', b)} style={dbRowStyle('monster_area', b.name)}>
                        {dbStatusCell('monster_area', b.name)}<td style={S.td}>{v.name}</td><td style={S.td}>B{v.minFloor}〜B{v.maxFloor}</td></tr>
                      )
                    })}
                  </tbody>
                </table>
                <p style={S.muted}>※ ボスは通常モンスター基準値に倍率を掛けて生成されます。</p>
              </>
            )}

            {dbTab === 'equip' && (
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>状態</th><th style={S.th}>スロット</th><th style={S.th}>名前</th><th style={S.th}>最低F</th>
                  {EQUIP_BONUS_LABELS.map(b => <th key={b.key} style={S.th}>{b.label}</th>)}
                </tr></thead>
                <tbody>
                  {EQUIPMENT.map(e => {
                    const ev = dbMerged('equip', e)
                    return (
                    <tr key={e.name} onClick={() => openDbEditor('equip', e)} style={dbRowStyle('equip', e.name)}>
                      {dbStatusCell('equip', e.name)}
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{EQUIP_SLOT_LABELS[e.equipSlot] ?? e.equipSlot}</td>
                      <td style={S.td}>{ev.name}</td>
                      <td style={S.td}>{ev.minFloor ?? 1}</td>
                      {EQUIP_BONUS_LABELS.map(b => {
                        const bv = ev[b.key]
                        return <td key={b.key} style={{ ...S.td, color: bv ? '#4ade80' : '#444' }}>{bv ? `+${bv}` : '−'}</td>
                      })}
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {dbTab === 'item' && (
              <>
                <div style={S.dbHead}>ポーション類</div>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>状態</th><th style={S.th}>名前</th><th style={S.th}>HP回復</th><th style={S.th}>スタミナ回復</th></tr></thead>
                  <tbody>
                    {HEAL_ITEMS.map(h => {
                      const v = dbMerged('item', h)
                      return (
                      <tr key={h.name} onClick={() => openDbEditor('item', h)} style={dbRowStyle('item', h.name)}>
                        {dbStatusCell('item', h.name)}<td style={S.td}>{v.name}</td><td style={S.td}>{v.healAmount ? `+${v.healAmount}` : '−'}</td><td style={S.td}>{v.staminaPercent ? `+${v.staminaPercent}%` : '−'}</td></tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={S.dbHead}>羽（行商人）</div>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>状態</th><th style={S.th}>名前</th><th style={S.th}>コイン枚数</th><th style={S.th}>説明</th></tr></thead>
                  <tbody>
                    {Object.values(WING_ITEMS).map(w => {
                      const v = dbMerged('item', w)
                      return (
                      <tr key={w.name} onClick={() => openDbEditor('item', w)} style={dbRowStyle('item', w.name)}>
                        {dbStatusCell('item', w.name)}<td style={S.td}>{v.name}</td><td style={S.td}>🪙{v.cost}</td><td style={S.td}>{v.desc}</td></tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={S.dbHead}>特殊</div>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>名前</th><th style={S.th}>効果</th></tr></thead>
                  <tbody>
                    <tr><td style={S.td}>女神のコイン</td><td style={S.td}>使うとスロットを1回まわせる（編集対象外）</td></tr>
                  </tbody>
                </table>
              </>
            )}

            {dbTab === 'spell' && (
              <table style={S.table}>
                <thead><tr><th style={S.th}>状態</th><th style={S.th}>名前</th><th style={S.th}>効果</th></tr></thead>
                <tbody>
                  {SPELLS.map(s => {
                    const v = dbMerged('spell', s)
                    return (
                    <tr key={s.name} onClick={() => openDbEditor('spell', s)} style={dbRowStyle('spell', s.name)}>
                      {dbStatusCell('spell', s.name)}<td style={{ ...S.td, whiteSpace: 'nowrap' }}>{v.name}</td><td style={S.td}>{v.effect}</td></tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page:        { minHeight: '100vh', background: '#0a0a14', color: '#e8e8f8', fontFamily: 'system-ui,sans-serif', fontSize: 14 },
  header:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: '#12122a', borderBottom: '1px solid #1e1e38' },
  loginCard:   { maxWidth: 320, margin: '80px auto', background: '#12122a', border: '1px solid #1e1e38', borderRadius: 12, padding: 32, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center' },
  loginTitle:  { fontSize: 20, fontWeight: 700, marginBottom: 8 },
  tabs:        { display: 'flex', borderBottom: '1px solid #1e1e38', background: '#0d0d20', flexWrap: 'wrap' },
  tab:         { padding: '10px 16px', background: 'none', border: 'none', color: '#8888cc', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderBottom: '2px solid transparent' },
  tabActive:   { color: '#fff', borderBottom: '2px solid #6366f1' },
  body:        { padding: 20, maxWidth: 960, margin: '0 auto' },
  input:       { padding: '6px 10px', background: '#12122a', border: '1px solid #2a2a4a', borderRadius: 6, color: '#e8e8f8', fontSize: 13, width: '100%', boxSizing: 'border-box' },
  label:       { display: 'block', fontSize: 11, color: '#8888cc', marginBottom: 4 },
  formGroup:   { marginBottom: 14 },
  row:         { display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' },
  card:        { marginTop: 14, padding: 12, background: 'rgba(18,18,42,0.8)', border: '1px solid #1e1e38', borderRadius: 8 },
  cardTitle:   { fontWeight: 700, fontSize: 12, color: '#8888cc', marginBottom: 8 },
  badge:       { padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: 13 },
  table:       { width: '100%', borderCollapse: 'collapse', marginTop: 8 },
  th:          { padding: '7px 10px', textAlign: 'left', color: '#8888cc', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', borderBottom: '1px solid #1e1e38' },
  td:          { padding: '6px 10px', borderBottom: '1px solid #12122a', fontSize: 13 },
  // 長文セル用：折り返して全文を表示し、高さ超過分は縦スクロールで読めるようにする
  cellScroll:  { maxHeight: 72, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  muted:       { color: '#666', fontSize: 13 },
  dbHead:      { marginTop: 22, marginBottom: 2, color: '#a5b4fc', fontWeight: 700, fontSize: 14, borderLeft: '3px solid #6366f1', paddingLeft: 8 },
  dbPub:       { padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: 'rgba(20,83,45,0.5)', color: '#4ade80', border: '1px solid #22c55e' },
  dbDraft:     { padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: 'rgba(120,80,20,0.4)', color: '#fbbf24', border: '1px solid #a16207' },
  btnPrimary:  { padding: '7px 18px', background: '#4f46e5', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13, flexShrink: 0 },
  btnGreen:    { padding: '6px 13px', background: 'rgba(20,83,45,0.6)', border: '1px solid #22c55e', borderRadius: 6, color: '#4ade80', cursor: 'pointer', fontWeight: 700, fontSize: 12 },
  btnRed:      { padding: '6px 13px', background: 'rgba(127,29,29,0.6)', border: '1px solid #ef4444', borderRadius: 6, color: '#f87171', cursor: 'pointer', fontWeight: 700, fontSize: 12 },
  btnDanger:   { padding: '3px 8px', background: 'rgba(127,29,29,0.4)', border: '1px solid #dc2626', borderRadius: 4, color: '#f87171', cursor: 'pointer', fontSize: 11 },
  btnSm:       { padding: '5px 12px', background: 'rgba(30,30,60,0.8)', border: '1px solid #2a2a4a', borderRadius: 6, color: '#aaaacc', cursor: 'pointer', fontSize: 12 },
  statCard:    { display: 'inline-block', padding: '16px 24px', background: '#12122a', border: '1px solid #1e1e38', borderRadius: 8, marginBottom: 16 },
  statLabel:   { fontSize: 11, color: '#8888cc', marginBottom: 4 },
  statValue:   { fontSize: 32, fontWeight: 700 },
  section:     { marginBottom: 24 },
  sectionTitle: { fontWeight: 700, fontSize: 13, color: '#aaaaee', marginBottom: 8, borderBottom: '1px solid #1e1e38', paddingBottom: 4 },
  distRow:     { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  distLabel:   { fontSize: 12, color: '#aaa', flexShrink: 0 },
  distBar:     { height: 14, background: '#4f46e5', borderRadius: 3, minWidth: 4 },
  distCount:   { fontSize: 12, color: '#666' },
}
