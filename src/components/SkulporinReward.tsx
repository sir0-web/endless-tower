import { useCallback, useEffect, useRef, useState } from 'react'
import type { Item } from '../types'

interface Props {
  equips: Item[]
  spells: Item[]
  onAccept: () => void
}

function RewardScreen({ equips, spells, onAccept }: Props) {
  const [done, setDone] = useState(false)

  const handle = () => {
    if (done) return
    setDone(true)
    onAccept()
  }

  const slotLabel: Record<string, string> = {
    weapon: '武器', armor: '鎧', shoulder: '肩', boots: 'ブーツ',
    accessory1: '指輪1', accessory2: '指輪2', charm: 'お守り',
  }

  return (
    <div className="skulporin-reward-overlay">
      <div className="skulporin-reward-box">
        <div className="skulporin-reward-header">
          <span className="skulporin-reward-icon">💀</span>
          <h2 className="skulporin-reward-title">すかるぽりんを倒した！</h2>
          <p className="skulporin-reward-sub">豪華な報酬をゲット！</p>
        </div>

        <div className="skulporin-reward-sections">
          <div className="skulporin-reward-section">
            <h3 className="skulporin-reward-section-title">⚔️ 装備品 × {equips.length}</h3>
            <ul className="skulporin-reward-list">
              {equips.map(item => (
                <li key={item.id} className="skulporin-reward-item equip">
                  <span className="skulporin-reward-item-slot">[{slotLabel[item.equipSlot ?? ''] ?? item.equipSlot}]</span>
                  <span className="skulporin-reward-item-name">{item.name}</span>
                  <span className="skulporin-reward-item-stats">
                    {[
                      item.strBonus ? `STR+${item.strBonus}` : '',
                      item.vitBonus ? `VIT+${item.vitBonus}` : '',
                      item.agiBonus ? `AGI+${item.agiBonus}` : '',
                      item.dexBonus ? `DEX+${item.dexBonus}` : '',
                      item.intBonus ? `INT+${item.intBonus}` : '',
                      item.lukBonus ? `LUK+${item.lukBonus}` : '',
                      item.hpBonus  ? `HP+${item.hpBonus}`   : '',
                    ].filter(Boolean).join(' ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="skulporin-reward-section">
            <h3 className="skulporin-reward-section-title">📖 魔法の書 × {spells.length}</h3>
            <ul className="skulporin-reward-list">
              {spells.map(item => (
                <li key={item.id} className="skulporin-reward-item spell">
                  {item.name}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="skulporin-reward-arcana-note">＋ アルカナチャンス！</p>

        <button className="skulporin-reward-btn" onClick={handle} disabled={done}>
          {done ? '受け取り中...' : '受け取る！'}
        </button>
      </div>
    </div>
  )
}

export function SkulporinReward() {
  const [payload, setPayload] = useState<{ equips: Item[]; spells: Item[]; onAccept: () => void } | null>(null)
  const onAcceptRef = useRef<(() => void) | null>(null)

  const close = useCallback(() => setPayload(null), [])

  useEffect(() => {
    window.showSkulporinReward = (equips, spells, onAccept) => {
      onAcceptRef.current = onAccept
      setPayload({ equips, spells, onAccept: () => { close(); onAccept() } })
    }
    return () => { window.showSkulporinReward = undefined }
  }, [close])

  if (!payload) return null
  return (
    <RewardScreen
      equips={payload.equips}
      spells={payload.spells}
      onAccept={payload.onAccept}
    />
  )
}
