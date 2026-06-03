import { useEffect, useRef } from 'react'
import type { MinimapData } from '../types'

const MINI = 5      // canvas px per tile
const VISION_R = 5  // fog of war radius

export function MinimapCanvas({ data }: { data: MinimapData | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !data) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { tiles, playerPos, enemies, items } = data
    const W = tiles[0]?.length ?? 30
    const H = tiles.length ?? 30
    const isBright = window.gameState?.floorType === 'lucky'

    const visible = (x: number, y: number) => {
      if (isBright) return true
      const dx = x - playerPos.x
      const dy = y - playerPos.y
      return dx * dx + dy * dy <= VISION_R * VISION_R
    }

    // 背景
    ctx.fillStyle = '#111111'
    ctx.fillRect(0, 0, W * MINI, H * MINI)

    // タイル
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!visible(x, y)) continue
        const tile = tiles[y]?.[x]
        if (tile === 'wall')        ctx.fillStyle = '#2a2a2a'
        else if (tile === 'floor')  ctx.fillStyle = '#d4c89a'
        else if (tile === 'stairs') ctx.fillStyle = '#4488ff'
        else if (tile === 'trap')   ctx.fillStyle = '#9900cc'
        else continue
        ctx.fillRect(x * MINI, y * MINI, MINI, MINI)
      }
    }

    // アイテム（黄色）
    ctx.fillStyle = '#ffdd00'
    for (const item of items) {
      if (!visible(item.x, item.y)) continue
      ctx.beginPath()
      ctx.arc(item.x * MINI + MINI / 2, item.y * MINI + MINI / 2, 1.8, 0, Math.PI * 2)
      ctx.fill()
    }

    // 敵（赤）・ボス（オレンジ）
    for (const enemy of enemies) {
      if (!visible(enemy.x, enemy.y)) continue
      ctx.fillStyle = enemy.isBoss ? '#ff8800' : '#ff3333'
      const r = enemy.isBoss ? 2.8 : 1.8
      ctx.beginPath()
      ctx.arc(enemy.x * MINI + MINI / 2, enemy.y * MINI + MINI / 2, r, 0, Math.PI * 2)
      ctx.fill()
    }

    // プレイヤー（緑・大きめ）
    ctx.fillStyle = '#00ff55'
    ctx.beginPath()
    ctx.arc(playerPos.x * MINI + MINI / 2, playerPos.y * MINI + MINI / 2, 3.5, 0, Math.PI * 2)
    ctx.fill()
    // 縁取り
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.arc(playerPos.x * MINI + MINI / 2, playerPos.y * MINI + MINI / 2, 3.5, 0, Math.PI * 2)
    ctx.stroke()

  }, [data])

  return (
    <canvas
      ref={canvasRef}
      width={30 * MINI}
      height={30 * MINI}
      className="minimap-canvas"
    />
  )
}
