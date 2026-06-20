import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ToastState   { message: string }
interface ConfirmState {
  message: string
  onYes: () => void
  onNo: () => void
  yesLabel?: string
  noLabel?: string
  // true のとき「いいえ」を強調色（取り返しのつかない操作用）にする
  danger?: boolean
}

// iOS Safari でも確実にスクロールを止める（position:fixed パターン）
function lockScroll() {
  // 既にロック中なら二重適用しない（二段階確認でスクロール位置が0に化けるのを防ぐ）
  if (document.body.dataset.lockedY !== undefined) return
  const y = window.scrollY
  document.body.style.position = 'fixed'
  document.body.style.top      = `-${y}px`
  document.body.style.left     = '0'
  document.body.style.width    = '100%'
  document.body.dataset.lockedY = String(y)
}
function unlockScroll() {
  const y = parseInt(document.body.dataset.lockedY ?? '0', 10)
  document.body.style.position = ''
  document.body.style.top      = ''
  document.body.style.left     = ''
  document.body.style.width    = ''
  delete document.body.dataset.lockedY
  window.scrollTo(0, y)
}

export function GameToast() {
  const [toast,   setToast]   = useState<ToastState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  // JS でビューポートサイズを取得（CSS の vw/dvh が iOS で外れる対策）
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    window.showGameToast = (message) => {
      setToast({ message })
      setTimeout(() => setToast(null), 2800)
    }
    window.showResumeConfirm = (onYes, onNo) => {
      lockScroll()
      // 「最初から」は中断データを完全削除する取り返しのつかない操作のため、
      // 二段階確認を挟んで誤タップによるセーブ消失を防ぐ。
      const confirmStartOver = () => {
        setConfirm({
          message: '本当に最初から始めますか？\n中断データは削除され、元に戻せません。',
          yesLabel: '削除して最初から',
          noLabel:  'やめる',
          danger: true,
          onYes: onNo,                    // 二段階目で「はい」→ 実際に clearSave + 新規開始
          onNo:  () => window.showResumeConfirm?.(onYes, onNo),  // 取り消し → 最初の選択に戻る
        })
      }
      setConfirm({
        message: '前回の中断データがあります。\n続きから再開しますか？',
        yesLabel: '続きから',
        noLabel:  '最初から',
        onYes,
        onNo: confirmStartOver,
      })
    }
    return () => {
      window.showGameToast     = undefined
      window.showResumeConfirm = undefined
      unlockScroll()
    }
  }, [])

  // confirm が消えたときもロック解除
  useLayoutEffect(() => {
    if (!confirm) unlockScroll()
  }, [confirm])

  // 先に閉じてからコールバックを呼ぶ。コールバック内で次の確認(setConfirm)を出す場合、
  // 後から呼ばれた setConfirm が勝つため、二段階確認への遷移が正しく行える。
  const handleYes = () => { const cb = confirm?.onYes; setConfirm(null); cb?.() }
  const handleNo  = () => { const cb = confirm?.onNo;  setConfirm(null); cb?.() }

  return createPortal(
    <>
      {toast && (
        <div className="g-toast">
          {toast.message.split('\n').map((line, i, arr) => (
            <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
          ))}
        </div>
      )}

      {confirm && (
        <div
          className="g-confirm-backdrop"
          style={{ position: 'fixed', top: 0, left: 0, width: vp.w, height: vp.h }}
        >
          <div className="g-confirm">
            <p className="g-confirm-msg">
              {confirm.message.split('\n').map((line, i, arr) => (
                <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
              ))}
            </p>
            <div className="g-confirm-btns">
              <button
                className={`g-confirm-yes${confirm.danger ? ' g-confirm-danger' : ''}`}
                onClick={handleYes}
              >
                {confirm.yesLabel ?? 'はい'}
              </button>
              <button className="g-confirm-no" onClick={handleNo}>
                {confirm.noLabel ?? 'いいえ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
