# ダンジョン素材一覧

ベースパス: `public/asetts/dungeon/`  
URL プレフィックス: `/asetts/dungeon/`

---

## 壁 (Wall) — 28枚

| ファイル名 | Phaser キー |
|-----------|------------|
| wall/tile_0001.png | `wall-0001` |
| wall/tile_0002.png | `wall-0002` |
| wall/tile_0003.png | `wall-0003` |
| wall/tile_0004.png | `wall-0004` |
| wall/tile_0005.png | `wall-0005` |
| wall/tile_0006.png | `wall-0006` |
| wall/tile_0007.png | `wall-0007` |
| wall/tile_0008.png | `wall-0008` |
| wall/tile_0009.png | `wall-0009` |
| wall/tile_0010.png | `wall-0010` |
| wall/tile_0011.png | `wall-0011` |
| wall/tile_0013.png | `wall-0013` |
| wall/tile_0014.png | `wall-0014` |
| wall/tile_0015.png | `wall-0015` |
| wall/tile_0016.png | `wall-0016` |
| wall/tile_0017.png | `wall-0017` |
| wall/tile_0018.png | `wall-0018` |
| wall/tile_0019.png | `wall-0019` |
| wall/tile_0020.png | `wall-0020` |
| wall/tile_0021.png | `wall-0021` |
| wall/tile_0022.png | `wall-0022` |
| wall/tile_0023.png | `wall-0023` |
| wall/tile_0040.png | `wall-0040` |
| wall/tile_0046.png | `wall-0046` |
| wall/tile_0047.png | `wall-0047` |
| wall/tile_0057.png | `wall-0057` |
| wall/tile_0058.png | `wall-0058` |
| wall/tile_0059.png | `wall-0059` |

---

## 床 (Floor) — 12枚

| ファイル名 | Phaser キー |
|-----------|------------|
| floor/tile_0000.png | `floor-0000` |
| floor/tile_0012.png | `floor-0012` |
| floor/tile_0024.png | `floor-0024` |
| floor/tile_0042.png | `floor-0042` |
| floor/tile_0048.png | `floor-0048` |
| floor/tile_0049.png | `floor-0049` |
| floor/tile_0050.png | `floor-0050` |
| floor/tile_0051.png | `floor-0051` |
| floor/tile_0052.png | `floor-0052` |
| floor/tile_0053.png | `floor-0053` |
| floor/tile_0061.png | `floor-0061` |
| floor/tile_0062.png | `floor-0062` |

---

## 階段 (Stairs) — 1枚

| ファイル名 | Phaser キー |
|-----------|------------|
| stairs/tile_0039.png | `stairs-0039` |

---

## 宝箱 (Box) — 2枚

| ファイル名 | Phaser キー | 用途 |
|-----------|------------|------|
| box/tile_0089.png | `box-0089` | 装備品アイテム表示 |
| box/tile_0092.png | `box-0092` | 装備品アイテム表示（サブ） |

---

## 描画ルール

1. **壁** — 28種からランダム選択（フロア生成時に決定、固定）
2. **床** — 12種からランダム選択（フロア生成時に決定、固定）
3. **宝箱** — 装備品アイテムの位置に `box-0089` / `box-0092` を配置
4. **階段** — `stairs-0039` 固定

---

## 未使用素材

- ベノムダスト（trap）: スプライト素材なし → 床タイル＋紫ティント
- 回復アイテム: スプライト素材なし → 💊 絵文字
- 魔法の書: スプライト素材なし → 📖 絵文字
