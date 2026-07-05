import { useEffect, useState } from 'react'
import type { Item, PendingEquip } from '../types'

const BONUS_DEFS = [
  { key: 'hpBonus',  label: 'HP'  },
  { key: 'strBonus', label: 'STR' },
  { key: 'agiBonus', label: 'AGI' },
  { key: 'dexBonus', label: 'DEX' },
  { key: 'vitBonus', label: 'VIT' },
  { key: 'lukBonus', label: 'LUK' },
] as const

type BonusKey = typeof BONUS_DEFS[number]['key']

function val(item: Item | null, key: BonusKey): number {
  return ((item as Record<string, number | undefined> | null)?.[key] ?? 0)
}

function BonusTag({ label, cur, nxt }: { label: string; cur: number; nxt: number }) {
  if (nxt === 0) return null
  let color = '#c8c8f0'
  if (nxt > cur)  color = '#44dd88'
  if (nxt < cur)  color = '#ff5555'
  return <span className="equip-bonus-tag" style={{ color }}>{label}+{nxt}</span>
}

function CurrentBonusTag({ label, cur, nxt }: { label: string; cur: number; nxt: number }) {
  if (cur === 0) return null
  let color = '#c8c8f0'
  if (cur > nxt) color = '#44dd88'
  if (cur < nxt) color = '#ff5555'
  return <span className="equip-bonus-tag" style={{ color }}>{label}+{cur}</span>
}

export function EquipModal() {
  const [pending, setPending] = useState<PendingEquip | null>(null)

  useEffect(() => {
    const onUpdate = () => {
      // プレイ中以外は開かない（死亡直後の残タイマー等が古い pendingEquip 付きで
      // gamestate-update を飛ばしても、GAME OVER画面の上に再オープンさせない）
      if (!window.isGameSceneActive) { setPending(null); return }
      const pe = window.gameState?.pendingEquip ?? null
      setPending(pe)
    }
    // ゲームオーバー等でシーンが変わったら強制クローズ。
    // GameScene 停止後は window.resolveEquip が死んだシーンを指し、閉じる手段が無くなるため。
    const onSceneChanged = () => setPending(null)
    window.addEventListener('gamestate-update', onUpdate)
    window.addEventListener('game-scene-changed', onSceneChanged)
    return () => {
      window.removeEventListener('gamestate-update', onUpdate)
      window.removeEventListener('game-scene-changed', onSceneChanged)
    }
  }, [])

  if (!pending) return null

  const { newItem, currentItem } = pending

  const resolve = (equip: boolean) => {
    window.resolveEquip?.(equip)
  }

  return (
    <div className="equip-overlay" onClick={() => resolve(false)}>
      <div className="equip-modal" onClick={e => e.stopPropagation()}>
        <p className="equip-modal-title">
          {currentItem ? '装備を変更しますか？' : '装備しますか？'}
        </p>

        {currentItem && (
          <div className="equip-compare-row">
            <span className="equip-compare-label current-label">現在装備</span>
            <span className="equip-item-name">{currentItem.name}</span>
            <span className="equip-bonus-list">
              {BONUS_DEFS.map(({ key, label }) => (
                <CurrentBonusTag
                  key={key} label={label}
                  cur={val(currentItem, key)}
                  nxt={val(newItem, key)}
                />
              ))}
            </span>
          </div>
        )}

        <div className="equip-compare-row new-row">
          <span className="equip-compare-label new-label">
            {currentItem ? '新しい装備' : '装備品'}
          </span>
          <span className="equip-item-name">{newItem.name}</span>
          <span className="equip-bonus-list">
            {BONUS_DEFS.map(({ key, label }) => (
              <BonusTag
                key={key} label={label}
                cur={val(currentItem, key)}
                nxt={val(newItem, key)}
              />
            ))}
          </span>
        </div>

        <div className="equip-modal-btns">
          <button className="equip-yes-btn" onClick={() => resolve(true)}>はい</button>
          <button className="equip-no-btn" onClick={() => resolve(false)}>いいえ（保持）</button>
        </div>
      </div>
    </div>
  )
}
