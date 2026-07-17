import { useEffect, useState } from 'react'
import type { AllocStat } from '../types'
import { HoldRepeatButton } from './HoldRepeatButton'

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
  // ステータスごとの一括入力欄（「1000ずつ長押し」がつらい問題への対処）。キー未入力time="" 扱い。
  const [bulkInputs, setBulkInputs] = useState<Partial<Record<AllocStat, string>>>({})
  // [指定]を押したステータスのみ、+1/指定ボタンの代わりに入力欄を表示する（同時に1つだけ開く）
  const [activeKey, setActiveKey] = useState<AllocStat | null>(null)

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
          {STAT_DEFS.map(({ key, label }) => {
            const applyBulk = () => {
              const n = parseInt(bulkInputs[key] ?? '', 10)
              if (!Number.isFinite(n) || n <= 0) return
              window.allocateStatBulk?.(key, n)
              setBulkInputs(prev => ({ ...prev, [key]: '' }))
              setActiveKey(null)
            }
            const isActive = activeKey === key
            return (
              <div key={key} className="stat-alloc-row">
                <span className="sa-label">{label}</span>
                <span className="sa-val">{ls[key]}</span>
                {isActive ? (
                  <div className="sa-bulk">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={ls.statPoints}
                      placeholder="個数"
                      className="sa-bulk-input"
                      autoFocus
                      value={bulkInputs[key] ?? ''}
                      disabled={ls.statPoints <= 0}
                      onChange={e => setBulkInputs(prev => ({ ...prev, [key]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') applyBulk(); if (e.key === 'Escape') setActiveKey(null) }}
                    />
                    <button
                      type="button"
                      className="sa-bulk-btn"
                      disabled={ls.statPoints <= 0 || !bulkInputs[key]}
                      onClick={applyBulk}
                    >
                      追加
                    </button>
                    <button
                      type="button"
                      className="sa-bulk-cancel"
                      onClick={() => setActiveKey(null)}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="sa-action-row">
                    <HoldRepeatButton
                      className="sa-btn sa-btn-plus1"
                      onPress={() => window.allocateStat?.(key)}
                      disabled={ls.statPoints <= 0}
                    >
                      +1
                    </HoldRepeatButton>
                    <button
                      type="button"
                      className="sa-btn-designate"
                      disabled={ls.statPoints <= 0}
                      onClick={() => setActiveKey(key)}
                    >
                      指定
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
