import { useEffect, useRef, useState } from 'react'
import { acquireJackpot, releaseJackpot, onJackpot } from '../game/jackpot'

// スロット筐体の最下段（AUTOボタンと 0/3 クレジットの間）に置く、全鯖共有ジャックポットの
// 豪華装飾フレーム付きカウンター。全プレイヤーのスロット回転で増え、ジャックポット成立で 0 にリセット。
export function JackpotCounter() {
  const [pool, setPool] = useState(0)
  const [bump, setBump] = useState(false)
  const prevRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    acquireJackpot()
    const off = onJackpot(next => {
      // 値が変わったら一瞬だけ強調（カウントアップ感）
      if (next !== prevRef.current) {
        prevRef.current = next
        setBump(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setBump(false), 280)
      }
      setPool(next)
    })
    return () => {
      off()
      releaseJackpot()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const maxed = pool >= 100

  return (
    <div
      className={`jackpot-plate${bump ? ' jp-bump' : ''}${maxed ? ' jp-maxed' : ''}`}
      aria-label="共有ジャックポット"
    >
      {/* 四隅の宝石オーナメント */}
      <span className="jp-gem jp-gem-tl" />
      <span className="jp-gem jp-gem-tr" />
      <span className="jp-gem jp-gem-bl" />
      <span className="jp-gem jp-gem-br" />

      <div className="jp-inner">
        <span className="jp-label">★ JACKPOT ★</span>
        <span className="jp-value">
          {pool.toLocaleString()}<span className="jp-unit">pt</span>
        </span>
      </div>

      {/* 光沢スイープ */}
      <span className="jp-shine" />
    </div>
  )
}
