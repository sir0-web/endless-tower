import { useEffect, useState } from 'react'
import type { AllocStat } from '../types'

interface LocalStats {
  str: number; agi: number; dex: number
  int: number; vit: number; luk: number
  statPoints: number
}

const STAT_DEFS: { key: AllocStat; label: string; desc: string }[] = [
  { key: 'str', label: 'STR', desc: '物理攻撃力  +0.5 ATK/pt' },
  { key: 'agi', label: 'AGI', desc: '攻撃速度  50毎に攻撃回数+1' },
  { key: 'dex', label: 'DEX', desc: '命中率  基本90%→最大99%' },
  { key: 'int', label: 'INT', desc: '魔法攻撃力  (将来実装)' },
  { key: 'vit', label: 'VIT', desc: '物理防御力  +0.3 DEF/pt' },
  { key: 'luk', label: 'LUK', desc: 'クリティカル  0.1%/pt・1.5倍ダメージ' },
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
          {STAT_DEFS.map(({ key, label, desc }) => (
            <div key={key} className="stat-alloc-row">
              <span className="sa-label">{label}</span>
              <span className="sa-val">{ls[key]}</span>
              <span className="sa-desc">{desc}</span>
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
