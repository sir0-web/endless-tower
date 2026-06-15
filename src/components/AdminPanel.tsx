import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const PROD_URL = import.meta.env.VITE_SUPABASE_URL as string
const PROD_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY as string | undefined
const LOCAL_URL = 'http://localhost:54321'
const LOCAL_DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqp8La5JAmZB9bFTJFa3o-PxnRmmHzM_s'

type EnvMode = 'production' | 'local'
type Tab = 'maintenance' | 'message' | 'ranking' | 'worldlog' | 'users' | 'reports' | 'stats'

interface MaintenanceWindow { from: number; to: number | null }
interface RankingEntry { id: number; player_name: string; floor: number; level: number; created_at: string }
interface WorldNotif { id: number; type: string; title: string; message: string; player_name: string; created_at: string }
interface EditingRanking { id: number; player_name: string; floor: number; level: number }

interface Report {
  id: number; category: string; content: string
  player_name: string | null; image_url: string | null
  status: 'new' | 'read' | 'done'; created_at: string
}

const JST = 9 * 60 * 60 * 1000
function fromJstInput(s: string): number { return new Date(s + ':00.000Z').getTime() - JST }
function fmtJst(ms: number): string { return new Date(ms + JST).toISOString().replace('T', ' ').slice(0, 16) }
function fmtJstDate(iso: string): string { return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) }
function winActive(w: MaintenanceWindow, now: number): boolean { return now >= w.from && (w.to === null || now < w.to) }
function winPast(w: MaintenanceWindow, now: number): boolean { return w.to !== null && now >= w.to }

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

  // ── Reports ──
  const [reports, setReports]         = useState<Report[]>([])
  const [repLoading, setRepLoading]   = useState(false)
  const [repMsg, setRepMsg]           = useState('')
  const [repStatusF, setRepStatusF]   = useState<'' | 'new' | 'read' | 'done'>('')
  const [repCatF, setRepCatF]         = useState('')
  const [repDetail, setRepDetail]     = useState<Report | null>(null)

  // ── Stats ──
  const [stats, setStats] = useState<{ totalDeaths: number; floorDist: [string,number][]; slotDist: [string,number][] } | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)

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
    let q = db.from('rankings').select('*').order('floor', { ascending: false }).limit(100)
    if (search) q = q.ilike('player_name', `%${search}%`)
    const { data } = await q
    setRankings((data ?? []) as RankingEntry[])
    setRLoading(false)
  }, [db])

  const deleteRanking = async (id: number) => {
    if (!confirm('このランキングエントリを削除しますか？')) return
    const { error } = await db.from('rankings').delete().eq('id', id)
    if (error) { setRMsg(`削除エラー: ${error.message}`); return }
    setRMsg('削除しました ✓')
    setRankings(rs => rs.filter(r => r.id !== id))
  }

  const saveEditRanking = async () => {
    if (!editingRanking) return
    const { error } = await db.from('rankings').update({ player_name: editingRanking.player_name, floor: editingRanking.floor, level: editingRanking.level }).eq('id', editingRanking.id)
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
    setWlLoading(false)
  }, [db])

  const deleteWorldLog = async (id: number) => {
    if (!confirm('このワールドログを削除しますか？')) return
    const { error } = await db.from('world_notifications').delete().eq('id', id)
    if (error) { setWlMsg(`削除エラー: ${error.message}`); return }
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
      db.from('rankings').select('*').ilike('player_name', `%${name}%`).order('floor', { ascending: false }).limit(50),
      db.from('world_notifications').select('*').ilike('player_name', `%${name}%`).order('created_at', { ascending: false }).limit(100),
    ])
    setURankings((ranks ?? []) as RankingEntry[])
    setUNotifs((notifs ?? []) as WorldNotif[])
    setULoading(false)
  }

  const deleteURanking = async (id: number) => {
    if (!confirm('削除しますか？')) return
    const { error } = await db.from('rankings').delete().eq('id', id)
    if (error) { setUMsg(`エラー: ${error.message}`); return }
    setUMsg('ランキング削除 ✓')
    setURankings(rs => rs.filter(r => r.id !== id))
  }

  const saveUEditRanking = async () => {
    if (!uEditingRanking) return
    const { error } = await db.from('rankings').update({ player_name: uEditingRanking.player_name, floor: uEditingRanking.floor, level: uEditingRanking.level }).eq('id', uEditingRanking.id)
    if (error) { setUMsg(`エラー: ${error.message}`); return }
    setUMsg('更新しました ✓')
    setURankings(rs => rs.map(r => r.id === uEditingRanking.id ? { ...r, ...uEditingRanking } : r))
    setUEditingRanking(null)
  }

  const deleteUNotif = async (id: number) => {
    if (!confirm('削除しますか？')) return
    const { error } = await db.from('world_notifications').delete().eq('id', id)
    if (error) { setUMsg(`エラー: ${error.message}`); return }
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
    setRepLoading(false)
  }, [db])

  const updateRepStatus = async (id: number, status: Report['status']) => {
    const { error } = await db.from('reports').update({ status }).eq('id', id)
    if (error) { setRepMsg(`エラー: ${error.message}`); return }
    setReports(rs => rs.map(r => r.id === id ? { ...r, status } : r))
    if (repDetail?.id === id) setRepDetail(d => d ? { ...d, status } : d)
  }

  const deleteReport = async (id: number) => {
    if (!confirm('この報告を削除しますか？')) return
    const { error } = await db.from('reports').delete().eq('id', id)
    if (error) { setRepMsg(`エラー: ${error.message}`); return }
    setRepMsg('削除しました ✓')
    setReports(rs => rs.filter(r => r.id !== id))
    if (repDetail?.id === id) setRepDetail(null)
  }

  const openRepDetail = async (r: Report) => {
    setRepDetail(r)
    if (r.status === 'new') await updateRepStatus(r.id, 'read')
  }

  // ── Stats ──
  const loadStats = useCallback(async () => {
    setStats(null); setStatsError(null)
    const [{ data: deaths, error: e1 }, { data: slots, error: e2 }] = await Promise.all([
      db.from('game_events').select('floor').eq('event_type', 'death').limit(10000),
      db.from('game_events').select('slot_result').eq('event_type', 'slot_result').not('slot_result', 'is', null).limit(10000),
    ])
    const err = e1 ?? e2
    if (err) { setStatsError(`Supabaseエラー: ${err.message} (code: ${err.code})`); setStats({ totalDeaths: 0, floorDist: [], slotDist: [] }); return }
    const floorMap: Record<string, number> = {}
    for (const d of (deaths ?? [])) { const k = `${d.floor ?? '?'}F`; floorMap[k] = (floorMap[k] ?? 0) + 1 }
    const slotMap: Record<string, number> = {}
    for (const s of (slots ?? [])) { const k = s.slot_result ?? '?'; slotMap[k] = (slotMap[k] ?? 0) + 1 }
    setStats({ totalDeaths: (deaths ?? []).length, floorDist: Object.entries(floorMap).sort((a, b) => parseInt(b[0]) - parseInt(a[0])), slotDist: Object.entries(slotMap).sort((a, b) => b[1] - a[1]) })
  }, [db])

  useEffect(() => {
    if (!authed) return
    if (tab === 'maintenance') loadMaintenance()
    if (tab === 'ranking')     loadRankings()
    if (tab === 'worldlog')    loadWorldLogs()
    if (tab === 'reports')     loadReports()
    if (tab === 'stats')       loadStats()
  }, [authed, tab, loadMaintenance, loadRankings, loadWorldLogs, loadReports, loadStats])

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
    maintenance: 'メンテナンス', message: 'メッセージ配信',
    ranking: 'ランキング', worldlog: 'ワールドログ',
    users: 'ユーザー管理', reports: '報告BOX', stats: '統計',
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

        {/* ══ ランキング ══ */}
        {tab === 'ranking' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={rSearch} onChange={e => setRSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadRankings(rSearch)}
                placeholder="プレイヤー名で検索" style={{ ...S.input, flex: 1 }} />
              <button onClick={() => loadRankings(rSearch)} style={S.btnPrimary}>検索</button>
              <button onClick={() => { setRSearch(''); loadRankings('') }} style={S.btnSm}>全件</button>
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
                  <th style={S.th}>#</th><th style={S.th}>ID</th>
                  <th style={S.th}>プレイヤー名</th><th style={S.th}>最深</th>
                  <th style={S.th}>Lv</th><th style={S.th}>日時 (JST)</th>
                  <th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {rankings.map((r, i) => (
                    <tr key={r.id} style={editingRanking?.id === r.id ? { background: 'rgba(79,70,229,0.08)' } : {}}>
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
                  {rankings.length === 0 && <tr><td colSpan={7} style={{ ...S.td, color: '#666', textAlign: 'center' }}>データなし</td></tr>}
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
            </div>

            {wlMsg && <div style={{ color: wlMsg.includes('エラー') ? '#f87171' : '#4ade80', marginBottom: 8 }}>{wlMsg}</div>}

            {wlLoading ? <p style={S.muted}>読み込み中…</p> : (
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>ID</th><th style={S.th}>日時 (JST)</th>
                  <th style={S.th}>タイプ</th><th style={S.th}>プレイヤー</th>
                  <th style={S.th}>タイトル</th><th style={S.th}>本文</th>
                  <th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {wlogs.map(n => (
                    <tr key={n.id}>
                      <td style={{ ...S.td, color: '#666' }}>{n.id}</td>
                      <td style={S.td}>{fmtJstDate(n.created_at)}</td>
                      <td style={S.td}><span style={{ padding: '2px 6px', background: 'rgba(79,70,229,0.2)', borderRadius: 4, fontSize: 11 }}>{n.type}</span></td>
                      <td style={S.td}>{n.player_name}</td>
                      <td style={S.td}>{n.title}</td>
                      <td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</td>
                      <td style={S.td}><button onClick={() => deleteWorldLog(n.id)} style={S.btnDanger}>削除</button></td>
                    </tr>
                  ))}
                  {wlogs.length === 0 && <tr><td colSpan={7} style={{ ...S.td, color: '#666', textAlign: 'center' }}>データなし</td></tr>}
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
                          <td style={{ ...S.td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</td>
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
                  <th style={S.th}>ID</th><th style={S.th}>日時 (JST)</th>
                  <th style={S.th}>カテゴリ</th><th style={S.th}>内容（抜粋）</th>
                  <th style={S.th}>名前</th><th style={S.th}>画像</th>
                  <th style={S.th}>ステータス</th><th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {reports.map(r => (
                    <tr key={r.id}
                      onClick={() => openRepDetail(r)}
                      style={{ cursor: 'pointer', background: repDetail?.id === r.id ? 'rgba(79,70,229,0.08)' : r.status === 'new' ? 'rgba(239,68,68,0.05)' : 'transparent' }}>
                      <td style={{ ...S.td, color: '#666' }}>{r.id}</td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{fmtJstDate(r.created_at)}</td>
                      <td style={S.td}><span style={{ padding: '2px 6px', background: 'rgba(79,70,229,0.2)', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap' }}>{r.category}</span></td>
                      <td style={{ ...S.td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.content}</td>
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
                  {reports.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#666', textAlign: 'center' }}>データなし</td></tr>}
                </tbody>
              </table>
            )}
            <p style={S.muted}>行クリックで詳細表示・既読マーク。最大300件。</p>
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
              <div style={S.statCard}>
                <div style={S.statLabel}>総死亡回数</div>
                <div style={S.statValue}>{stats.totalDeaths.toLocaleString()}</div>
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
  muted:       { color: '#666', fontSize: 13 },
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
