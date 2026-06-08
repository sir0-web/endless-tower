import { useEffect, useState } from 'react'

interface ToastState {
  message: string
}

interface ConfirmState {
  message: string
  onYes: () => void
  onNo: () => void
}

export function GameToast() {
  const [toast,   setToast]   = useState<ToastState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  useEffect(() => {
    window.showGameToast = (message) => {
      setToast({ message })
      setTimeout(() => setToast(null), 2800)
    }
    window.showResumeConfirm = (onYes, onNo) => {
      setConfirm({ message: '前回の中断データがあります。\n中断データから再開しますか？', onYes, onNo })
    }
    return () => {
      window.showGameToast    = undefined
      window.showResumeConfirm = undefined
    }
  }, [])

  return (
    <>
      {toast && (
        <div className="g-toast">
          {toast.message.split('\n').map((line, i) => (
            <span key={i}>{line}{i < toast.message.split('\n').length - 1 && <br />}</span>
          ))}
        </div>
      )}

      {confirm && (
        <div className="g-confirm-backdrop">
          <div className="g-confirm">
            <p className="g-confirm-msg">
              {confirm.message.split('\n').map((line, i) => (
                <span key={i}>{line}{i < confirm.message.split('\n').length - 1 && <br />}</span>
              ))}
            </p>
            <div className="g-confirm-btns">
              <button
                className="g-confirm-yes"
                onClick={() => { confirm.onYes(); setConfirm(null) }}
              >はい</button>
              <button
                className="g-confirm-no"
                onClick={() => { confirm.onNo(); setConfirm(null) }}
              >いいえ</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
