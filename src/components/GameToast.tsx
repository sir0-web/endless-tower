import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ToastState   { message: string }
interface ConfirmState { message: string; onYes: () => void; onNo: () => void }

function lockScroll()   { document.body.style.overflow = 'hidden' }
function unlockScroll() { document.body.style.overflow = '' }

export function GameToast() {
  const [toast,   setToast]   = useState<ToastState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  useEffect(() => {
    window.showGameToast = (message) => {
      setToast({ message })
      setTimeout(() => setToast(null), 2800)
    }
    window.showResumeConfirm = (onYes, onNo) => {
      // スクロール位置をリセットしてfixedが確実に画面中央に来るようにする
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      lockScroll()
      setConfirm({ message: '前回の中断データがあります。\n中断データから再開しますか？', onYes, onNo })
    }
    return () => {
      window.showGameToast     = undefined
      window.showResumeConfirm = undefined
      unlockScroll()
    }
  }, [])

  const handleYes = () => { unlockScroll(); confirm?.onYes(); setConfirm(null) }
  const handleNo  = () => { unlockScroll(); confirm?.onNo();  setConfirm(null) }

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
        <div className="g-confirm-backdrop">
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
