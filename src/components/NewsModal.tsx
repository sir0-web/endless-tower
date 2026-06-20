import { useCallback, useEffect, useState } from 'react'
import {
  fetchPublishedAnnouncements, registerView, isNew,
  type Announcement,
} from '../game/announcements'
import { RichTextView } from './RichText'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '.')
}

export function NewsModal() {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [list, setList]       = useState<Announcement[]>([])
  const [selected, setSelected] = useState<Announcement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchPublishedAnnouncements()
    setList(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    window.showNews = () => { setOpen(true); setSelected(null); void load() }
  }, [load])

  const openDetail = (a: Announcement) => { setSelected(a); void registerView(a.id) }
  const close = () => { setOpen(false); setSelected(null) }

  if (!open) return null

  return (
    <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) close() }}>
      <div style={S.scroll}>
        {/* ── ヘッダー（巻物の上飾り）── */}
        <div style={S.header}>
          <span style={S.title}>📜 冒険者への報せ</span>
          <button onClick={close} style={S.closeX} aria-label="閉じる">✕</button>
        </div>
        <div style={S.rule} />

        {/* ── 本体 ── */}
        <div style={S.body}>
          {loading && <p style={S.dim}>読み込み中…</p>}

          {!loading && !selected && (
            list.length === 0
              ? <p style={S.dim}>まだお知らせはありません。</p>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {list.map(a => (
                    <button key={a.id} onClick={() => openDetail(a)} style={S.row}>
                      <span style={S.rowDate}>{fmtDate(a.published_at)}</span>
                      <span style={S.rowTitle}>{a.title}</span>
                      {isNew(a) && <span style={S.newTag}>NEW</span>}
                    </button>
                  ))}
                </div>
              )
          )}

          {!loading && selected && (
            <div>
              <div style={S.detailDate}>{fmtDate(selected.published_at)}</div>
              <h2 style={S.detailTitle}>{selected.title}</h2>
              <div style={S.rule} />
              <RichTextView html={selected.body_html} className="news-body" />
              <div style={{ ...S.rule, marginTop: 18 }} />
              <button onClick={() => setSelected(null)} style={S.backBtn}>← 一覧へ戻る</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 羊皮紙の巻物テーマ（PC=中央モーダル / スマホ=ほぼ全幅・縦スクロール）──
const PARCH = 'linear-gradient(180deg, #f3e4c2 0%, #ecdab0 55%, #e2cb98 100%)'
const INK   = '#3a2a14'
const GOLD  = '#9c7a33'

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.78)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  scroll: {
    width: '100%', maxWidth: 540, maxHeight: '92vh', display: 'flex', flexDirection: 'column',
    background: PARCH, color: INK,
    border: `3px solid ${GOLD}`, borderRadius: 10,
    boxShadow: '0 10px 50px rgba(0,0,0,0.75), inset 0 0 40px rgba(120,80,20,0.18)',
    fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", serif',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px 6px',
  },
  title: { fontSize: 18, fontWeight: 700, color: '#5a3d12', letterSpacing: 1 },
  closeX: { background: 'none', border: 'none', color: '#7a5a2a', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 6px' },
  rule: { height: 2, margin: '0 16px', background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` },
  body: { padding: '12px 18px 18px', overflowY: 'auto' },
  dim: { color: '#8a7244', textAlign: 'center', padding: '24px 0' },

  row: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
    padding: '11px 8px', background: 'none', border: 'none', borderBottom: '1px dashed #c9b07e',
    cursor: 'pointer', color: INK, fontFamily: 'inherit',
  },
  rowDate: { fontSize: 12, color: '#9a7b3d', flexShrink: 0, minWidth: 78, fontVariantNumeric: 'tabular-nums' },
  rowTitle: { fontSize: 15, flex: 1, fontWeight: 600 },
  newTag: { fontSize: 10, fontWeight: 700, color: '#fff', background: '#c0392b', borderRadius: 4, padding: '2px 6px', flexShrink: 0 },

  detailDate: { fontSize: 12, color: '#9a7b3d', marginBottom: 4 },
  detailTitle: { fontSize: 20, fontWeight: 700, color: '#5a3d12', margin: '0 0 10px' },
  backBtn: {
    marginTop: 14, padding: '9px 18px', background: 'rgba(120,80,20,0.12)',
    border: `1px solid ${GOLD}`, borderRadius: 6, color: '#5a3d12', cursor: 'pointer',
    fontSize: 14, fontFamily: 'inherit',
  },
}
