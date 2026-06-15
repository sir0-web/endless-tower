import { useState, useEffect, useRef } from 'react'
import { supabase } from '../game/supabase'

const MAX_SIZE = 5 * 1024 * 1024
const CATS = ['要望', '不具合報告', '質問', 'その他'] as const
type Cat = typeof CATS[number]

export function ReportModal() {
  const [open, setOpen]       = useState(false)
  const [cat, setCat]         = useState<Cat>('要望')
  const [content, setContent] = useState('')
  const [name, setName]       = useState('')
  const [file, setFile]       = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult]   = useState<{ ok: boolean; msg: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.showReport = () => { setOpen(true); setResult(null) }
  }, [])

  const handleFile = (f?: File) => {
    if (!f) { setFile(null); setPreview(null); return }
    if (f.size > MAX_SIZE) { alert('画像は5MB以下にしてください'); return }
    setFile(f)
    const r = new FileReader()
    r.onload = e => setPreview(e.target?.result as string)
    r.readAsDataURL(f)
  }

  const clearFile = () => {
    setFile(null); setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const reset = () => {
    setCat('要望'); setContent(''); setName(''); clearFile()
  }

  const close = () => { setOpen(false); reset(); setResult(null) }

  const submit = async () => {
    if (!content.trim()) return
    setSending(true); setResult(null)

    let imageUrl: string | null = null
    if (file) {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`
      const { data: up, error: upErr } = await supabase.storage
        .from('report-images').upload(path, file, { contentType: file.type })
      if (!upErr && up) {
        const { data: pub } = supabase.storage.from('report-images').getPublicUrl(up.path)
        imageUrl = pub.publicUrl
      }
    }

    const { error } = await supabase.from('reports').insert({
      category: cat,
      content: content.trim(),
      player_name: name.trim() || null,
      image_url: imageUrl,
      status: 'new',
    })

    if (error) {
      setResult({ ok: false, msg: `エラー: ${error.message}` })
    } else {
      setResult({ ok: true, msg: 'ご報告ありがとうございます！' })
      reset()
    }
    setSending(false)
  }

  if (!open) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div style={{ background: '#0e0e22', border: '1px solid #2a2a4a', borderRadius: 12, width: '100%', maxWidth: 460, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.8)' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #1e1e38', position: 'sticky', top: 0, background: '#0e0e22', zIndex: 1 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#e8e8f8' }}>📬 報告・お問い合わせ</span>
          <button onClick={close} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>

        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div>
            <label style={LS.label}>カテゴリ</label>
            <select value={cat} onChange={e => setCat(e.target.value as Cat)} style={LS.field}>
              {CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label style={LS.label}>内容 <span style={{ color: '#ef4444' }}>*</span></label>
            <textarea
              value={content} onChange={e => setContent(e.target.value)}
              placeholder="詳しく教えてください…"
              rows={5} style={{ ...LS.field, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={LS.label}>名前（任意）</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="例：冒険者A" maxLength={50} style={LS.field}
            />
          </div>

          <div>
            <label style={LS.label}>画像添付（任意・5MBまで）</label>
            <input
              ref={fileRef} type="file" accept="image/*"
              onChange={e => handleFile(e.target.files?.[0])}
              style={{ fontSize: 13, color: '#aaa', width: '100%' }}
            />
            {preview && (
              <div style={{ marginTop: 8, position: 'relative', display: 'inline-block' }}>
                <img src={preview} alt="プレビュー"
                  style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, border: '1px solid #2a2a4a', display: 'block' }} />
                <button onClick={clearFile}
                  style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
              </div>
            )}
          </div>

          {result && (
            <div style={{ padding: '10px 14px', borderRadius: 6, background: result.ok ? 'rgba(20,83,45,0.4)' : 'rgba(127,29,29,0.4)', border: `1px solid ${result.ok ? '#22c55e' : '#ef4444'}`, color: result.ok ? '#4ade80' : '#f87171', fontSize: 13 }}>
              {result.msg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingBottom: 4 }}>
            <button onClick={close} style={{ padding: '8px 18px', background: 'rgba(30,30,60,0.8)', border: '1px solid #2a2a4a', borderRadius: 6, color: '#aaaacc', cursor: 'pointer', fontSize: 14 }}>
              キャンセル
            </button>
            <button
              onClick={submit} disabled={sending || !content.trim()}
              style={{ padding: '8px 20px', background: sending || !content.trim() ? '#2a2a4a' : '#4f46e5', border: 'none', borderRadius: 6, color: '#fff', cursor: sending || !content.trim() ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 14 }}
            >
              {sending ? '送信中…' : '送信する'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}

const LS: Record<string, React.CSSProperties> = {
  label: { display: 'block', fontSize: 11, color: '#8888cc', marginBottom: 5 },
  field: { display: 'block', width: '100%', padding: '7px 10px', background: '#12122a', border: '1px solid #2a2a4a', borderRadius: 6, color: '#e8e8f8', fontSize: 14, boxSizing: 'border-box' },
}
