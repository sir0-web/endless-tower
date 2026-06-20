import { useEffect, useRef, useState } from 'react'
import { supabase } from '../game/supabase'

// ── HTMLサニタイズ（ADMIN作成の本文を表示前に無害化）──
const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'P', 'BR', 'DIV', 'SPAN', 'FONT',
  'IMG', 'A', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE',
])
const ALLOWED_STYLE = ['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-align', 'text-decoration']

function filterStyle(style: string): string {
  return style
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(decl => {
      const prop = decl.split(':')[0]?.trim().toLowerCase()
      if (!ALLOWED_STYLE.includes(prop)) return false
      if (/url\s*\(|expression|javascript:/i.test(decl)) return false
      return true
    })
    .join('; ')
}

function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^data:image\//i.test(url)
}

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild as HTMLElement
  if (!root) return ''

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        // 不許可タグは中身だけ残して展開（script/style等は丸ごと削除）
        if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') child.remove()
        else child.replaceWith(...Array.from(child.childNodes))
        continue
      }
      // 属性フィルタ
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on')) { child.removeAttribute(attr.name); continue }
        if (name === 'style') { const s = filterStyle(attr.value); if (s) child.setAttribute('style', s); else child.removeAttribute('style'); continue }
        if (child.tagName === 'IMG' && name === 'src') { if (!isSafeUrl(attr.value)) child.remove(); continue }
        if (child.tagName === 'A'   && name === 'href') { if (!isSafeUrl(attr.value)) child.removeAttribute('href'); continue }
        if (child.tagName === 'FONT' && (name === 'color' || name === 'size')) continue
        if (name === 'alt' || name === 'target' || name === 'rel') continue
        child.removeAttribute(attr.name)
      }
      if (child.tagName === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer') }
      walk(child)
    }
  }
  walk(root)
  return root.innerHTML
}

/** 表示用：サニタイズ済みHTMLをレンダリング（画像は幅100%に収める） */
export function RichTextView({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={className}
      style={{ lineHeight: 1.7, wordBreak: 'break-word' }}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  )
}

// ── 編集用リッチテキストエディタ（ADMIN）──
const COLORS = ['#3a2a14', '#b00000', '#c25e00', '#1d6b1d', '#1450a0', '#7a2da0', '#888888']
const SIZES: { label: string; value: string }[] = [
  { label: '小', value: '2' }, { label: '中', value: '3' },
  { label: '大', value: '5' }, { label: '特大', value: '6' },
]

interface EditorProps {
  initialHtml: string
  onChange: (html: string) => void
}

export function RichTextEditor({ initialHtml, onChange }: EditorProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)

  // 初期値はマウント時に一度だけ流し込む（contentEditableはアンコントロールド運用）
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== initialHtml) ref.current.innerHTML = initialHtml
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = () => { if (ref.current) onChange(ref.current.innerHTML) }

  // execCommand実行前にエディタへフォーカスを戻し、選択範囲を保つ
  const exec = (cmd: string, value?: string) => {
    ref.current?.focus()
    document.execCommand('styleWithCSS', false, 'true')
    document.execCommand(cmd, false, value)
    emit()
  }

  const insertImage = async (file?: File) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { alert('画像は5MB以下にしてください'); return }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop() ?? 'png'
      const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`
      const { data: up, error } = await supabase.storage
        .from('announcement-images').upload(path, file, { contentType: file.type })
      if (error || !up) { alert(`画像アップロード失敗: ${error?.message ?? '不明'}`); return }
      const { data: pub } = supabase.storage.from('announcement-images').getPublicUrl(up.path)
      ref.current?.focus()
      document.execCommand('insertHTML', false,
        `<img src="${pub.publicUrl}" alt="" style="max-width:100%;border-radius:6px;margin:6px 0;" /><br/>`)
      emit()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ border: '1px solid #2a2a4a', borderRadius: 6, background: '#12122a' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 6, borderBottom: '1px solid #2a2a4a' }}>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => exec('bold')} style={tb} title="太字"><b>B</b></button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => exec('italic')} style={tb} title="斜体"><i>I</i></button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => exec('underline')} style={tb} title="下線"><u>U</u></button>
        <span style={{ width: 1, background: '#2a2a4a', margin: '0 2px' }} />
        {SIZES.map(s => (
          <button key={s.value} type="button" onMouseDown={e => e.preventDefault()}
            onClick={() => exec('fontSize', s.value)} style={tb} title={`サイズ${s.label}`}>{s.label}</button>
        ))}
        <span style={{ width: 1, background: '#2a2a4a', margin: '0 2px' }} />
        {COLORS.map(c => (
          <button key={c} type="button" onMouseDown={e => e.preventDefault()}
            onClick={() => exec('foreColor', c)} title={`文字色 ${c}`}
            style={{ ...tb, width: 22, padding: 0, background: c, border: '1px solid #00000055' }} />
        ))}
        <input type="color" onMouseDown={e => e.preventDefault()}
          onChange={e => exec('foreColor', e.target.value)} title="任意の文字色"
          style={{ width: 26, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
        <span style={{ width: 1, background: '#2a2a4a', margin: '0 2px' }} />
        <label style={{ ...tb, cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1 }} title="画像を挿入">
          {uploading ? '⏳' : '🖼画像'}
          <input type="file" accept="image/*" disabled={uploading}
            onChange={e => insertImage(e.target.files?.[0])} style={{ display: 'none' }} />
        </label>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        style={{ minHeight: 180, maxHeight: 360, overflowY: 'auto', padding: '10px 12px', color: '#e8e8f8', fontSize: 14, outline: 'none', lineHeight: 1.7 }}
      />
    </div>
  )
}

const tb: React.CSSProperties = {
  minWidth: 26, height: 26, padding: '0 6px', background: '#1d1d3a',
  border: '1px solid #2a2a4a', borderRadius: 4, color: '#cfcff0',
  cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
