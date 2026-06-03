import Phaser from 'phaser'

const TILE = 48
const MAP  = 15   // 15×15

// 現在利用可能なファイル（2025-06-03 スキャン確定）
const FLOOR_FILES  = ['tile_0000', 'tile_0048', 'tile_0049', 'tile_0053']
const WALL_FILES   = ['tile_0014', 'tile_0040']
const STAIRS_FILE  = 'tile_0039'
const BOX_FILES    = ['tile_0089', 'tile_0092']

export class TestScene extends Phaser.Scene {
  constructor() { super({ key: 'TestScene' }) }

  preload() {
    for (const f of FLOOR_FILES)
      this.load.image(`floor_${f}`, `/asetts/dungeon/floor/${f}.png`)
    for (const f of WALL_FILES)
      this.load.image(`wall_${f}`,  `/asetts/dungeon/wall/${f}.png`)
    this.load.image(`stairs_${STAIRS_FILE}`, `/asetts/dungeon/stairs/${STAIRS_FILE}.png`)
    for (const f of BOX_FILES)
      this.load.image(`box_${f}`,   `/asetts/dungeon/box/${f}.png`)
  }

  create() {
    const W  = this.scale.width
    const H  = this.scale.height
    const ox = Math.floor((W - MAP * TILE) / 2)
    const oy = Math.floor((H - MAP * TILE) / 2)

    const px = (x: number) => ox + x * TILE + TILE / 2
    const py = (y: number) => oy + y * TILE + TILE / 2

    const rnd = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

    // 1. 壁（外周）
    for (let y = 0; y < MAP; y++) {
      for (let x = 0; x < MAP; x++) {
        if (x > 0 && x < MAP - 1 && y > 0 && y < MAP - 1) continue
        const key = `wall_${rnd(WALL_FILES)}`
        this.add.image(px(x), py(y), key).setDisplaySize(TILE, TILE)
      }
    }

    // 2. 床（内部）
    for (let y = 1; y < MAP - 1; y++) {
      for (let x = 1; x < MAP - 1; x++) {
        const key = `floor_${rnd(FLOOR_FILES)}`
        this.add.image(px(x), py(y), key).setDisplaySize(TILE, TILE)
      }
    }

    // 3. 宝箱（左上よりの内部: x=2, y=2）
    this.add.image(px(2), py(2), `box_${rnd(BOX_FILES)}`).setDisplaySize(TILE - 4, TILE - 4)

    // 4. 階段（右下よりの内部: x=12, y=12）
    this.add.image(px(12), py(12), `stairs_${STAIRS_FILE}`).setDisplaySize(TILE, TILE)

    // 5. プレイヤー（中央: x=7, y=7）
    this.add.rectangle(px(7), py(7), TILE - 6, TILE - 6, 0x44ff44)

    // 進むボタン
    const btn = this.add.text(W - 10, H - 10, '▶ ゲームスタート', {
      fontSize: '18px', color: '#00ff88',
      backgroundColor: '#003322', padding: { x: 14, y: 8 },
    }).setOrigin(1, 1).setDepth(10)
    btn.setInteractive({ useHandCursor: true })
    btn.on('pointerdown', () => this.scene.start('TitleScene'))
    btn.on('pointerover', () => btn.setColor('#ffffff'))
    btn.on('pointerout',  () => btn.setColor('#00ff88'))
  }
}
