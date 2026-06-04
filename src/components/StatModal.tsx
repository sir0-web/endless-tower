import { useEffect, useState } from 'react'
import type { AllocStat } from '../types'

interface LocalStats {
  str: number; agi: number; dex: number
  int: number; vit: number; luk: number
  statPoints: number
}

const STAT_DEFS: { key: AllocStat; label: string }[] = [
  { key: 'str', label: 'STR' },
  { key: 'agi', label: 'AGI' },
  { key: 'dex', label: 'DEX' },
  { key: 'int', label: 'INT' },
  { key: 'vit', label: 'VIT' },
  { key: 'luk', label: 'LUK' },
]

const INIT: LocalStats = { str: 1, agi: 1, dex: 1, int: 1, vit: 1, luk: 1, statPoints: 0 }

export function StatModal() {
  const [visible, setVisible] = useState(false)
  const [ls, setLs] = useState<LocalStats>(INIT)

  useEffect(() => {
    const onOpen = () => {
      if (window.gameState) {
        const { str, agi, dex, int: i, vit, luk, statPoints } = window.gameState
        setLs({ str, agi, dex, int: i, vit, luk, statPoints })
        setVisible(true)
      }
    }
    const onUpdate = () => {
      if (!window.gameState) return
      const { str, agi, dex, int: i, vit, luk, statPoints } = window.gameState
      setLs({ str, agi, dex, int: i, vit, luk, statPoints })
      if (statPoints <= 0) setVisible(false)
    }
    window.addEventListener('stat-alloc-open', onOpen)
    window.addEventListener('gamestate-update', onUpdate)
    return () => {
      window.removeEventListener('stat-alloc-open', onOpen)
      window.removeEventListener('gamestate-update', onUpdate)
    }
  }, [])

  if (!visible) return null

  return (
    <div className="stat-overlay">
      <div className="stat-modal">
        <p className="stat-modal-title">⬆ レベルアップ！ステータス振り分け</p>
        <p className="stat-modal-pts">
          残りポイント：<span className="pts-num">{ls.statPoints}</span>
        </p>
        <div className="stat-alloc-list">
          {STAT_DEFS.map(({ key, label }) => (
            <div key={key} className="stat-alloc-row">
              <span className="sa-label">{label}</span>
              <span className="sa-val">{ls[key]}</span>
              <button
                className="sa-btn"
                onClick={() => window.allocateStat?.(key)}
                disabled={ls.statPoints <= 0}
              >
                +1
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
