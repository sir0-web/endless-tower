import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ToastState   { message: string }
interface ConfirmState { message: string; onYes: () => void; onNo: () => void }

// iOS Safari でも確実にスクロールを止める（position:fixed パターン）
function lockScroll() {
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
      setConfirm({ message: '前回の中断データがあります。\n中断データから再開しますか？', onYes, onNo })
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

  const handleYes = () => { confirm?.onYes(); setConfirm(null) }
  const handleNo  = () => { confirm?.onNo();  setConfirm(null) }

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
              <button className="g-confirm-yes" onClick={handleYes}>はい</button>
              <button className="g-confirm-no"  onClick={handleNo}>いいえ</button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
