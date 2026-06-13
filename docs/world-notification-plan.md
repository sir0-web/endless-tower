# ワールド通知システム（v1）実装計画

> **✅ 2026-06-13 実装完了**（tsc/build パス）。残タスクは Supabase 側のテーブル作成のみ（§2 のSQLをダッシュボードで実行）。
> 実装ファイル: `src/game/{playerName,worldNotify,worldFeed}.ts` / `src/components/{WorldTelop,WorldLog}.tsx` ＋ GameScene 7発火点・Title/GameOver/StatusBar の表示名UI。
>
> このドキュメントは arcana-guild-site セッションでの事前調査結果をまとめた**実装ハンドオフ**です。
> 調査日: 2026-06-13 / 対象コミット: `e214ecd`

---

## 0. プロジェクト前提（調査済み）

- スタック: **Vite + React 19 + Phaser 4 + Supabase + TypeScript**
- Supabase は導入済み: `src/game/supabase.ts`
  - 既存: `supabase` クライアント / `getPlayerId()`（匿名UUID, localStorage `et_player_id`） / `logEvent()`（fire-and-forget insert の手本） / `submitRanking()` / `fetchRanking()`
  - 環境変数: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`（`.env` に設定済み）
- React ⇄ Phaser ブリッジ: `window.gameState` ＋ `window.show*` 系グローバル関数。型は `src/types/index.ts` の `declare global` に集約。
- React オーバーレイは `src/App.tsx` で Phaser canvas と並べてマウント（`SlotAnnouncement`/`GameToast`/`EventMsgBar` などが既に同じ仕組みで動作）。
- localStorage 既存キー: `et_player_id`, `endless-tower-save`, `keyMode`
- 既存のステータス表示（ここに表示名を足す）:
  - スマホ: `src/components/MobileStatusBar.tsx` L80-92 — `Basement {floor}{ord} Floor` / `Lv {level}` バッジ
  - PC: `src/components/UIPanel.tsx` L128-131 — `B{floor}F` / `Lv {level}` バッジ

---

## 1. アーキテクチャ方針

```
[GameScene 発火点] --fireWorldNotification()--> [Supabase: world_notifications テーブル INSERT]
                                                          |
                                              Supabase Realtime (postgres_changes INSERT)
                                                          |
                              全クライアントの [WorldTelop.tsx] が受信 → キュー → 上部テロップ表示
                                                          |
                                                   表示後 [WorldLog] に蓄積（直近100件）
```

- 発火は **fire-and-forget**（`logEvent` と同じ思想）。ゲーム進行を絶対に止めない。
- 既存ゲームロジックは変更禁止。**各発火点に1行 `fireWorldNotification(...)` を足すだけ**。

---

## 2. DB設計（Supabase SQL）

```sql
create table world_notifications (
  id          bigint generated always as identity primary key,
  type        text not null,              -- world | boss | achievement | system | event | maintenance
  title       text not null,              -- 例: 【MVP討伐】【ワールド】【女神の祝福】
  message     text not null,              -- 例: MASAHIROさんがドラキュラを討伐しました！
  player_name text,                        -- 表示名（system/event/maintenance では null 可）
  player_id   text,                        -- 匿名UUID（将来のフィルタ/重複解析用）
  created_at  timestamptz not null default now()
);

create index world_notifications_created_at_idx on world_notifications (created_at desc);

alter table world_notifications enable row level security;
create policy "anyone can read"   on world_notifications for select using (true);
create policy "anyone can insert" on world_notifications for insert with check (true);
```

Realtime 有効化（Supabaseダッシュボード → Database → Replication、または SQL）:
```sql
alter publication supabase_realtime add table world_notifications;
```

---

## 3. type 設計（仕様準拠）

| type | 用途 | 含む通知 |
|---|---|---|
| `world` | 通常 | レベル到達 / 階層到達 / モンスターハウス遭遇 |
| `boss` | ボス | MINI討伐 / MVP討伐 / エリアボス討伐 |
| `achievement` | 達成 | 精錬成功(+5以上) / 影装成功 / アルカナチャンス当選 |
| `system` | システム | ランキング更新 / 全体配布 / システム告知（将来） |
| `event` | イベント | 開始 / 終了 / 特殊ボーナス（将来） |
| `maintenance` | メンテ | 予告 / 開始 / 中（将来。手動INSERT運用想定） |

---

## 4. 表示名システム

新規モジュール `src/game/playerName.ts`:

```ts
const KEY = 'et_display_name'
const HEX = () => Math.random().toString(16).slice(2, 6).toUpperCase() // 4桁

// 初回アクセスで仮名を生成・永続化（以降は安定）
export function getDisplayName(): string {
  let n = localStorage.getItem(KEY)
  if (!n) { n = `冒険者${HEX()}`; localStorage.setItem(KEY, n) }
  return n
}
export function setDisplayName(name: string): void {
  const v = name.trim().slice(0, 12)
  if (v) localStorage.setItem(KEY, v)
}
```

- 仕様: 名前入力は**任意**。未設定時は `冒険者XXXX`。いつでも変更可。ワールド通知は「現在保存中の表示名」を使う。
- **TitleScene** に表示名入力欄を追加（`GAME START` ボタンの上）。`prompt()` 方式が最小実装（GameOverScene L106-111 が手本）。表示名バッジ＋「✎ 名前を変更」で `setDisplayName` を呼ぶ。
- **GameOverScene** の既存 `playerName` 入力（L85-111）の初期値を `getDisplayName()` にし、登録時に `setDisplayName()` でも保存 → 次回反映。
- **ゲーム画面表示**: `MobileStatusBar` / `UIPanel` のバッジ行に `Name: {getDisplayName()}` を追加（既存デザインに馴染ませる。`level-badge` の隣に `name-badge`）。表示名変更を反映するため `gamestate-update` イベント時に読み直す。

---

## 5. 通知発火モジュール

新規 `src/game/worldNotify.ts`:

```ts
import { supabase } from './supabase'
import { getPlayerId } from './supabase'
import { getDisplayName } from './playerName'

type WType = 'world' | 'boss' | 'achievement' | 'system' | 'event' | 'maintenance'

// 1ラン内の重複防止（レベル/階層マイルストーン用）。ゲーム開始時に resetWorldNotifyDedup() でクリア
const sent = new Set<string>()
export function resetWorldNotifyDedup() { sent.clear() }

export function fireWorldNotification(
  type: WType, title: string, message: string, dedupKey?: string,
): void {
  if (dedupKey) { if (sent.has(dedupKey)) return; sent.add(dedupKey) }
  void supabase.from('world_notifications')
    .insert({ type, title, message, player_name: getDisplayName(), player_id: getPlayerId() })
    .then(({ error }) => { if (error) console.warn('world_notify失敗:', error.message) })
}
```

- `resetWorldNotifyDedup()` は `GameScene.startNewGame()`（新規開始）で呼ぶ。**ロード再開時は呼ばない**（既に通知済みのマイルストーンを再送しないため）。
  - 注意: ロード再開だとメモリ上の `sent` は空なので、再開後に同じLv/階を跨ぐと再送の可能性あり。許容するか、`et_player_id`＋ラン識別子をキーにするか要検討。v1は「マイルストーンは初到達時のみ＝通常プレイで1回」で十分。

---

## 6. 発火点（GameScene.ts ＋ 施設）— 既存行の直後に1行足すだけ

| # | 通知 | type | title | 発火場所（調査済み） | dedupKey |
|---|---|---|---|---|---|
| 1 | レベル到達(10刻み) | world | 【ワールド】 | `checkLevelUp()` L813 `player.level++` の直後。`if (newLevel % 10 === 0)` | `lv:${newLevel}` |
| 2 | 階層到達(B5刻み) | world | 【ワールド】 | `enterNormalFloor()` L1198-1200 `floor++` / `logEvent('floor_reached')` の隣。`if (floor % 5 === 0)` | `floor:${floor}` |
| 3 | ボス討伐 | boss | 種別で出し分け | `killEnemy()` L746-751。`enemy.isBoss` かつ `enemy.name` の接頭辞で判定 | なし(毎回) |
| 4 | モンスターハウス遭遇 | world | 【緊急速報】 | `enterNormalFloor()` L1243 `if (floorType === 'chaos') this.showMonsterHouseEffect()` の隣 | `mhouse:${floor}` |
| 5 | アルカナチャンス当選 | achievement | 【女神の祝福】 | `applySlotEffect()` L1568 `'🌌 アルカナチャンス発動！'` の所 | なし |
| 6 | 精錬成功(+5以上) | achievement | 【精錬成功】 | `runRefineChallenge()` L1361 `if(success)` 内。`if (level >= 5)` | なし |
| 7 | 影装成功 | achievement | 【影装強化】 | `runShadowChallenge()` L1388 `if(success)` 内 | なし |

### ボス種別判定（#3 詳細）— `dungeon.ts` 調査済み

ボス名は接頭辞付きで生成される（`makeBoss(..., prefix)`, `dungeon.ts` L175/197, L202-220）:
- `【MINI】<名前>` → 「【討伐速報】 〜がMINIボス〇〇を討伐しました！」（type: boss）
- `【MVP】<名前>`  → 「【MVP討伐】 〜が〇〇を討伐しました！」（type: boss）
- `【エリア】<名前>` → 「【エリアボス討伐】 〜が〇〇を討伐しました！」（type: boss）

`killEnemy` 内で:
```ts
if (enemy.isBoss) {
  const m = enemy.name.match(/^【(MINI|MVP|エリア)】(.+)$/)
  if (m) {
    const [, kind, bossName] = m
    const title = kind === 'MVP' ? '【MVP討伐】' : kind === 'エリア' ? '【エリアボス討伐】' : '【討伐速報】'
    fireWorldNotification('boss', title, `${getDisplayName()}さんが${bossName}を討伐しました！`)
  }
}
```
（メッセージ内の名前は `fireWorldNotification` 側で `player_name` に入るが、本文にも入れる仕様なので `getDisplayName()` を本文へ。）

> MINI/MVP/エリアボスの一覧（参考）: MINI=エクリプス/エンジェリング/…、MVP=フリオニ/オークヒーロー/…、エリア=黄金蟲/ドレイク/オシリス/… (`dungeon.ts` L127-162)

### メッセージ書式（仕様）
- Lv到達: `{name}さんがLv{n}に到達しました！`
- 階層到達: `{name}さんがB{floor}階に到達しました！`
- モンスターハウス: `{name}さんがモンスターハウスに遭遇しました！`
- アルカナ: `{name}さんがアルカナチャンスに当選しました！`
- 精錬: `{name}さんが+{level}精錬に成功しました！`
- 影装: `{name}さんが影装強化に成功しました！`

---

## 7. 上部ワールドテロップ（v1最優先）

新規 `src/components/WorldTelop.tsx`（`App.tsx` の `<GameToast />` 隣に追加）:

要件:
- 画面**上部中央固定**（`position: fixed; top: ~12px; left: 50%; transform: translateX(-50%)`、`z-index` は最前面、`pointer-events: none` でプレイ妨げない）
- フェードイン → **4秒表示** → フェードアウト
- **通知キュー**: 表示中に来た通知は捨てずに queue へ。現通知が消えてから次を表示（通知消失禁止）
- スマホ/PC両対応（max-width とフォント可変）
- 表示書式:
  ```
  ━━━━━━━━━━━
  【MVP討伐】
  MASAHIROさんがドラキュラを討伐しました！
  ━━━━━━━━━━━
  ```
- type別に色分け（boss=赤系/achievement=金系/world=青系/system=紫/maintenance=灰 等）

実装スケッチ:
```tsx
// state: queue: Notif[], current: Notif | null
// Realtime購読でqueueにpush
// useEffect([current]): currentがnullかつqueueありなら次をshift
//   → fadeIn(300ms) → wait(4000) → fadeOut(300ms) → current=null
useEffect(() => {
  const ch = supabase.channel('world_notif')
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'world_notifications' },
        (p) => { setQueue(q => [...q, p.new as Notif]); pushLog(p.new) })
    .subscribe()
  return () => { supabase.removeChannel(ch) }
}, [])
```

---

## 8. ワールドログ

- 直近100件保持。新規接続時/リロード時に再取得。
- 取得: `supabase.from('world_notifications').select('*').order('created_at',{ascending:false}).limit(100)`
- v1ではテロップが主役。ログは **トグルボタン（🌐）+ スクロールパネル** で表示（`WorldLog.tsx`、`UIPanel` 内 or 独立オーバーレイ）。
- 将来フィルタ追加できるよう、保持データは type 付きの生レコード配列で持つ。
- テロップ受信時に同じ購読でログにも push（重複購読を避けるため、Telopとログでstateを共有 or Context化を検討）。

---

## 9. 新規/変更ファイル一覧

新規:
- `src/game/playerName.ts`
- `src/game/worldNotify.ts`
- `src/components/WorldTelop.tsx`
- `src/components/WorldLog.tsx`（v1で時間あれば。最低テロップは必須）

変更:
- `src/types/index.ts` … 必要なら `window` に `getDisplayName` 等は不要（モジュール直 import で可）
- `src/scenes/GameScene.ts` … 発火点 #1-#7（import 追加＋各1行）＋ `startNewGame` で `resetWorldNotifyDedup()`
- `src/scenes/TitleScene.ts` … 表示名入力欄
- `src/scenes/GameOverScene.ts` … 初期値=表示名 / 登録時に保存
- `src/components/MobileStatusBar.tsx` … 表示名バッジ
- `src/components/UIPanel.tsx` … 表示名バッジ
- `src/App.tsx` … `<WorldTelop />`（＋`<WorldLog />`）追加

---

## 10. テスト（完了条件・必須）

Playwright で:
1. `npm run dev` で起動
2. 2つのタブ（A/B）で同じURLを開く
3. タブAで通知発火（最短: ブラウザconsoleから `warpFloor(5)` 等、または直接 `supabase.from('world_notifications').insert(...)`。確実なのはconsoleで `fireWorldNotification` 相当をINSERT）
4. **タブBの上部テロップにRealtimeで通知が出る**ことを確認
5. テロップのキュー（連続発火で消えずに順次表示）を確認

> dev中限定の `window.warpFloor` (GameScene L243) が使えるので、階層到達通知の実発火テストに利用可。

---

## 11. 完了報告テンプレ（仕様要求）

報告に含める: DB設計 / Realtime構成 / 通知テーブル構成 / type設計 / 表示名保存方式 / 変更ファイル一覧 / 通知発火箇所一覧 / 上部テロップ実装箇所 / ワールドログ実装箇所 / TOP(Title)の表示名UI / ゲーム画面内の表示名表示箇所 / Playwrightマルチタブ確認結果。

---

## 注意・既存破壊禁止

戦闘 / 階層進行 / スロット / 精錬 / 影装 / ランキング のロジックは変更しない。各発火点は**追記1行**のみ。`fireWorldNotification` は必ず fire-and-forget（await しない）。
