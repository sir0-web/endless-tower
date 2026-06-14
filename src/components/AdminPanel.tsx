import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../game/supabase'

const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY as string | undefined

type Tab = 'maintenance' | 'message' | 'ranking' | 'stats'

interface MaintenanceWindow { from: number; to: number }

interface RankingEntry {
  id: number; player_name: string; floor: number; level: number; created_at: string
}

interface WorldNotif {
  id: number; type: string; title: string; message: string
  player_name: string; created_at: string
}

// ── JST ヘルパ ──
const JST = 9 * 60 * 60 * 1000
function fromJstInput(s: string): number {
  return new Date(s + ':00.000Z').getTime() - JST
}
function fmtJst(ms: number): string {
  const d = new Date(ms + JST)
  return d.toISOString().replace('T', ' ').slice(0, 16)
}

export function AdminPanel() {
  const [authed, setAuthed]     = useState(false)
  const [pw, setPw]             = useState('')
  const [tab, setTab]           = useState<Tab>('maintenance')

  // Maintenance
  const [windows, setWindows]   = useState<MaintenanceWindow[]>([])
  const [mLoading, setMLoading] = useState(false)
  const [mSaving, setMSaving]   = useState(false)
  const [mMsg, setMMsg]         = useState('')
  const [newFrom, setNewFrom]   = useState('')
  const [newTo, setNewTo]       = useState('')

  // Maintenance message
  const [mHeading, setMHeading]       = useState('より良いゲームをお届けするために\nスタッフが鋭意準備中です')
  const [mLead, setMLead]             = useState('⏰次回のオープンβテスト期間⏰')
  const [mNote, setMNote]             = useState('このページは開いたままお待ちください。\n自動で更新されます。')
  const [mMsgSaving, setMMsgSaving]   = useState(false)
  const [mMsgResult, setMMsgResult]   = useState('')

  // Message
  const [msgType, setMsgType]     = useState('system')
  const [msgTitle, setMsgTitle]   = useState('')
  const [msgBody, setMsgBody]     = useState('')
  const [msgDisplaySec, setMsgDisplaySec] = useState('4')
  const [msgSending, setMsgSending] = useState(false)
  const [msgResult, setMsgResult]   = useState('')

  // Ranking
  const [rankings, setRankings]     = useState<RankingEntry[]>([])
  const [rLoading, setRLoading]     = useState(false)
  const [rSearch, setRSearch]       = useState('')
  const [notifPlayer, setNotifPlayer] = useState<string | null>(null)
  const [notifs, setNotifs]           = useState<WorldNotif[] | null>(null)

  // Stats
  const [stats, setStats] = useState<{
    totalDeaths: number
    floorDist: [string, number][]
    slotDist: [string, number][]
  } | null>(null)

  // ── ログイン ──
  const login = () => {
    if (!ADMIN_KEY) { alert('VITE_ADMIN_KEY 環境変数が未設定です'); return }
    if (pw === ADMIN_KEY) { setAuthed(true) }
    else { alert('パスワードが違います') }
  }

  // ── Maintenance ──
  const loadMaintenance = useCallback(async () => {
    setMLoading(true)
    const [{ data: winData }, { data: msgData }] = await Promise.all([
      supabase.from('system_config').select('value').eq('key', 'maintenance_windows').single(),
      supabase.from('system_config').select('value').eq('key', 'maintenance_message').single(),
    ])
    if (winData) setWindows((winData.value ?? []) as MaintenanceWindow[])
    if (msgData?.value) {
      const v = msgData.value as { heading?: string; lead?: string; note?: string }
      if (v.heading != null) setMHeading(v.heading)
      if (v.lead    != null) setMLead(v.lead)
      if (v.note    != null) setMNote(v.note)
    }
    setMLoading(false)
  }, [])

  const saveMaintenance = async () => {
    setMSaving(true); setMMsg('')
    const { error } = await supabase.from('system_config').upsert({
      key: 'maintenance_windows',
      value: windows,
      updated_at: new Date().toISOString(),
    })
    setMMsg(error ? `エラー: ${error.message}` : '保存しました ✓')
    setMSaving(false)
  }

  const addWindow = () => {
    if (!newFrom || !newTo) return
    setWindows(ws =>
      [...ws, { from: fromJstInput(newFrom), to: fromJstInput(newTo) }]
        .sort((a, b) => a.from - b.from)
    )
    setNewFrom(''); setNewTo('')
  }

  const removeWindow = (i: number) => setWindows(ws => ws.filter((_, j) => j !== i))

  const saveMaintenanceMessage = async () => {
    setMMsgSaving(true); setMMsgResult('')
    const { error } = await supabase.from('system_config').upsert({
      key: 'maintenance_message',
      value: { heading: mHeading, lead: mLead, note: mNote },
      updated_at: new Date().toISOString(),
    })
    setMMsgResult(error ? `エラー: ${error.message}` : '保存しました ✓')
    setMMsgSaving(false)
  }

  const openNow = () => {
    const now = Date.now()
    setWindows(ws => {
      const next = ws.filter(w => w.to > now)
      if (next.some(w => now >= w.from && now < w.to)) return next
      return [...next, { from: now, to: now + 24 * 3600 * 1000 }].sort((a, b) => a.from - b.from)
    })
  }

  const closeNow = () => {
    const now = Date.now()
    setWindows(ws =>
      ws.map(w => now >= w.from && now < w.to ? { ...w, to: now } : w)
        .filter(w => w.from < w.to)
    )
  }

  // ── Messages ──
  const sendMessage = async () => {
    if (!msgTitle || !msgBody) return
    setMsgSending(true)
    const displayMs = Math.max(1, parseFloat(msgDisplaySec) || 4) * 1000
    const { error } = await supabase.from('world_notifications').insert({
      type: msgType, title: msgTitle, message: msgBody,
      player_name: 'ADMIN', player_id: 'admin-broadcast',
      display_ms: displayMs,
    })
    setMsgResult(error ? `エラー: ${error.message}` : '送信しました ✓')
    if (!error) { setMsgTitle(''); setMsgBody('') }
    setMsgSending(false)
  }

  // ── Ranking ──
  const loadRankings = useCallback(async (search = '') => {
    setRLoading(true)
    let q = supabase.from('rankings').select('*').order('floor', { ascending: false }).limit(100)
    if (search) q = q.ilike('player_name', `%${search}%`)
    const { data } = await q
    setRankings((data ?? []) as RankingEntry[])
    setRLoading(false)
  }, [])

  const loadNotifs = async (playerName: string) => {
    setNotifPlayer(playerName); setNotifs(null)
    const { data } = await supabase
      .from('world_notifications')
      .select('*')
      .eq('player_name', playerName)
      .order('created_at', { ascending: false })
      .limit(50)
    setNotifs((data ?? []) as WorldNotif[])
  }

  // ── Stats ──
  const loadStats = useCallback(async () => {
    setStats(null)
    const [{ data: deaths }, { data: slots }] = await Promise.all([
      supabase.from('game_events').select('floor').eq('event_type', 'death'),
      supabase.from('game_events').select('slot_result').eq('event_type', 'slot_result').not('slot_result', 'is', null),
    ])

    const floorMap: Record<string, number> = {}
    for (const d of (deaths ?? [])) {
      const k = `${d.floor ?? '?'}F`; floorMap[k] = (floorMap[k] ?? 0) + 1
    }
    const slotMap: Record<string, number> = {}
    for (const s of (slots ?? [])) {
      const k = s.slot_result ?? '?'; slotMap[k] = (slotMap[k] ?? 0) + 1
    }

    setStats({
      totalDeaths: (deaths ?? []).length,
      floorDist: Object.entries(floorMap).sort((a, b) => parseInt(b[0]) - parseInt(a[0])),
      slotDist:  Object.entries(slotMap).sort((a, b) => b[1] - a[1]),
    })
  }, [])

  useEffect(() => {
    if (!authed) return
    if (tab === 'maintenance') loadMaintenance()
    if (tab === 'ranking') loadRankings()
    if (tab === 'stats') loadStats()
  }, [authed, tab, loadMaintenance, loadRankings, loadStats])

  const now = Date.now()
  const isOpen = windows.some(w => now >= w.from && now < w.to)

  // ── Login screen ──
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

  return (
    <div style={S.page}>
      <div style={S.header}>
        <span style={{ fontWeight: 700 }}>🏰 Endless Tower Admin</span>
        <button onClick={() => setAuthed(false)} style={S.btnSm}>ログアウト</button>
      </div>

      <div style={S.tabs}>
        {(['maintenance','message','ranking','stats'] as Tab[]).map(key => (
          <button key={key} onClick={() => setTab(key)}
            style={tab === key ? { ...S.tab, ...S.tabActive } : S.tab}>
            {{ maintenance:'メンテナンス', message:'メッセージ配信', ranking:'ランキング', stats:'統計' }[key]}
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
                    const active = now >= w.from && now < w.to
                    const past   = now >= w.to
                    return (
                      <tr key={i} style={active ? { background: 'rgba(34,197,94,0.07)' } : past ? { opacity: 0.45 } : {}}>
                        <td style={S.td}>{fmtJst(w.from)}</td>
                        <td style={S.td}>{fmtJst(w.to)}</td>
                        <td style={S.td}>
                          {active ? <span style={{ color: '#22c55e' }}>● 公開中</span>
                            : past ? <span style={{ color: '#666' }}>終了</span>
                            : <span style={{ color: '#facc15' }}>予定</span>}
                        </td>
                        <td style={S.td}>
                          <button onClick={() => removeWindow(i)} style={S.btnDanger}>削除</button>
                        </td>
                      </tr>
                    )
                  })}
                  {windows.length === 0 && (
                    <tr><td colSpan={4} style={{ ...S.td, color: '#666', textAlign: 'center' }}>
                      公開ウィンドウなし（= 常時メンテ）
                    </td></tr>
                  )}
                </tbody>
              </table>

              <div style={S.card}>
                <div style={S.cardTitle}>新規ウィンドウ追加（JST）</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={S.label}>開始</label>
                  <input type="datetime-local" value={newFrom} onChange={e => setNewFrom(e.target.value)} style={{ ...S.input, width: 'auto' }} />
                  <label style={S.label}>終了</label>
                  <input type="datetime-local" value={newTo} onChange={e => setNewTo(e.target.value)} style={{ ...S.input, width: 'auto' }} />
                  <button onClick={addWindow} style={S.btnPrimary}>追加</button>
                </div>
              </div>

              <div style={S.row}>
                <button onClick={saveMaintenance} disabled={mSaving} style={S.btnPrimary}>
                  {mSaving ? '保存中…' : '変更を保存（Supabase）'}
                </button>
                {mMsg && <span style={{ color: mMsg.includes('エラー') ? '#f87171' : '#4ade80' }}>{mMsg}</span>}
              </div>

              <div style={{ ...S.card, marginTop: 24 }}>
                <div style={S.cardTitle}>メンテナンス画面のメッセージ編集</div>
                <div style={S.formGroup}>
                  <label style={S.label}>見出し（h1）</label>
                  <textarea value={mHeading} onChange={e => setMHeading(e.target.value)}
                    rows={2} style={{ ...S.input, resize: 'vertical' }}
                    placeholder="例：より良いゲームをお届けするために&#10;スタッフが鋭意準備中です" />
                </div>
                <div style={S.formGroup}>
                  <label style={S.label}>リード文</label>
                  <input value={mLead} onChange={e => setMLead(e.target.value)}
                    style={S.input} placeholder="例：⏰次回のオープンβテスト期間⏰" />
                </div>
                <div style={S.formGroup}>
                  <label style={S.label}>補足文</label>
                  <textarea value={mNote} onChange={e => setMNote(e.target.value)}
                    rows={2} style={{ ...S.input, resize: 'vertical' }}
                    placeholder="例：このページは開いたままお待ちください。&#10;自動で更新されます。" />
                </div>
                <div style={{ ...S.row, marginTop: 8 }}>
                  <button onClick={saveMaintenanceMessage} disabled={mMsgSaving} style={S.btnPrimary}>
                    {mMsgSaving ? '保存中…' : 'メッセージを保存'}
                  </button>
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
              <textarea value={msgBody} onChange={e => setMsgBody(e.target.value)}
                style={{ ...S.input, height: 90, resize: 'vertical' }}
                placeholder="例：本日18:00よりアップデートを行います。" />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>表示時間（秒）</label>
              <input
                type="number" min="1" max="60" step="0.5"
                value={msgDisplaySec}
                onChange={e => setMsgDisplaySec(e.target.value)}
                style={{ ...S.input, width: 100 }}
              />
              <span style={{ fontSize: 11, color: '#8888cc', marginTop: 4, display: 'block' }}>デフォルト 4 秒。長いお知らせは 8〜15 秒推奨。</span>
            </div>
            <div style={S.row}>
              <button onClick={sendMessage} disabled={msgSending || !msgTitle || !msgBody} style={S.btnPrimary}>
                {msgSending ? '送信中…' : '🌐 全ユーザーに送信'}
              </button>
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

            {notifPlayer && (
              <div style={S.card}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700 }}>📋 {notifPlayer} のワールドログ履歴</span>
                  <button onClick={() => { setNotifPlayer(null); setNotifs(null) }} style={S.btnSm}>閉じる</button>
                </div>
                {notifs === null ? <p style={S.muted}>読み込み中…</p> : (
                  <table style={S.table}>
                    <thead><tr>
                      <th style={S.th}>日時 (JST)</th><th style={S.th}>タイプ</th>
                      <th style={S.th}>タイトル</th><th style={S.th}>本文</th>
                    </tr></thead>
                    <tbody>
                      {notifs.map(n => (
                        <tr key={n.id}>
                          <td style={S.td}>{new Date(n.created_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</td>
                          <td style={S.td}>{n.type}</td>
                          <td style={S.td}>{n.title}</td>
                          <td style={S.td}>{n.message}</td>
                        </tr>
                      ))}
                      {notifs.length === 0 && <tr><td colSpan={4} style={{...S.td,color:'#666',textAlign:'center'}}>履歴なし</td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {rLoading ? <p style={S.muted}>読み込み中…</p> : (
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>#</th><th style={S.th}>プレイヤー名</th>
                  <th style={S.th}>最深</th><th style={S.th}>Lv</th>
                  <th style={S.th}>日時 (JST)</th><th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {rankings.map((r, i) => (
                    <tr key={r.id}>
                      <td style={S.td}>{i + 1}</td>
                      <td style={S.td}>{r.player_name}</td>
                      <td style={S.td}>{r.floor}F</td>
                      <td style={S.td}>Lv{r.level}</td>
                      <td style={S.td}>{new Date(r.created_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</td>
                      <td style={S.td}><button onClick={() => loadNotifs(r.player_name)} style={S.btnSm}>履歴</button></td>
                    </tr>
                  ))}
                  {rankings.length === 0 && <tr><td colSpan={6} style={{...S.td,color:'#666',textAlign:'center'}}>データなし</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ══ 統計 ══ */}
        {tab === 'stats' && (
          <div>
            <button onClick={loadStats} style={{ ...S.btnSm, marginBottom: 16 }}>🔄 更新</button>
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
  page:       { minHeight:'100vh', background:'#0a0a14', color:'#e8e8f8', fontFamily:'system-ui,sans-serif', fontSize:14 },
  header:     { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 20px', background:'#12122a', borderBottom:'1px solid #1e1e38' },
  loginCard:  { maxWidth:320, margin:'80px auto', background:'#12122a', border:'1px solid #1e1e38', borderRadius:12, padding:32, display:'flex', flexDirection:'column', gap:12, textAlign:'center' },
  loginTitle: { fontSize:20, fontWeight:700, marginBottom:8 },
  tabs:       { display:'flex', borderBottom:'1px solid #1e1e38', background:'#0d0d20' },
  tab:        { padding:'10px 18px', background:'none', border:'none', color:'#8888cc', cursor:'pointer', fontSize:13, fontWeight:600, borderBottom:'2px solid transparent' },
  tabActive:  { color:'#fff', borderBottom:'2px solid #6366f1' },
  body:       { padding:20, maxWidth:920, margin:'0 auto' },
  input:      { padding:'6px 10px', background:'#12122a', border:'1px solid #2a2a4a', borderRadius:6, color:'#e8e8f8', fontSize:13, width:'100%', boxSizing:'border-box' },
  label:      { display:'block', fontSize:11, color:'#8888cc', marginBottom:4 },
  formGroup:  { marginBottom:14 },
  row:        { display:'flex', alignItems:'center', gap:10, marginTop:16, flexWrap:'wrap' },
  card:       { marginTop:14, padding:12, background:'rgba(18,18,42,0.8)', border:'1px solid #1e1e38', borderRadius:8 },
  cardTitle:  { fontWeight:700, fontSize:12, color:'#8888cc', marginBottom:8 },
  badge:      { padding:'6px 14px', borderRadius:20, fontWeight:700, fontSize:13 },
  table:      { width:'100%', borderCollapse:'collapse', marginTop:8 },
  th:         { padding:'7px 10px', textAlign:'left', color:'#8888cc', fontSize:11, fontWeight:700, letterSpacing:'0.06em', borderBottom:'1px solid #1e1e38' },
  td:         { padding:'6px 10px', borderBottom:'1px solid #12122a', fontSize:13 },
  muted:      { color:'#666', fontSize:13 },
  btnPrimary: { padding:'7px 18px', background:'#4f46e5', border:'none', borderRadius:6, color:'#fff', cursor:'pointer', fontWeight:700, fontSize:13, flexShrink:0 },
  btnGreen:   { padding:'6px 13px', background:'rgba(20,83,45,0.6)', border:'1px solid #22c55e', borderRadius:6, color:'#4ade80', cursor:'pointer', fontWeight:700, fontSize:12 },
  btnRed:     { padding:'6px 13px', background:'rgba(127,29,29,0.6)', border:'1px solid #ef4444', borderRadius:6, color:'#f87171', cursor:'pointer', fontWeight:700, fontSize:12 },
  btnDanger:  { padding:'3px 8px', background:'rgba(127,29,29,0.4)', border:'1px solid #dc2626', borderRadius:4, color:'#f87171', cursor:'pointer', fontSize:11 },
  btnSm:      { padding:'5px 12px', background:'rgba(30,30,60,0.8)', border:'1px solid #2a2a4a', borderRadius:6, color:'#aaaacc', cursor:'pointer', fontSize:12 },
  statCard:   { display:'inline-block', padding:'16px 24px', background:'#12122a', border:'1px solid #1e1e38', borderRadius:8, marginBottom:16 },
  statLabel:  { fontSize:11, color:'#8888cc', marginBottom:4 },
  statValue:  { fontSize:32, fontWeight:700 },
  section:    { marginBottom:20 },
  sectionTitle:{ fontWeight:700, fontSize:13, color:'#aaaaee', marginBottom:8, borderBottom:'1px solid #1e1e38', paddingBottom:4 },
  distRow:    { display:'flex', alignItems:'center', gap:8, marginBottom:4 },
  distLabel:  { fontSize:12, color:'#aaa', flexShrink:0 },
  distBar:    { height:14, background:'#4f46e5', borderRadius:3, minWidth:4 },
  distCount:  { fontSize:12, color:'#666' },
}
