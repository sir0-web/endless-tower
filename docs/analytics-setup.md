# 行動ログ（game_events）セットアップ

バランス調整のための行動ログを Supabase に記録する。
**フロア到達 / スロット結果 / 死亡時Lv** を匿名プレイヤーID（`player_id`）ごとに記録する。

## 1. Supabase でテーブルを作成

Supabase ダッシュボード → SQL Editor で以下を実行する。

```sql
-- 行動ログテーブル
create table game_events (
  id          bigint generated always as identity primary key,
  player_id   text not null,        -- localStorage の匿名UUID（同一ブラウザ＝同一ID）
  event_type  text not null,        -- 'floor_reached' | 'slot_result' | 'death'
  floor       int,                  -- 到達/死亡フロア
  level       int,                  -- Lv（死亡時など）
  slot_result text,                 -- スロット結果（'777' | 'triple' | 'skulls' | 'lr_match' | 'adjacent' | 'sequential' | 'miss'）
  created_at  timestamptz default now()
);

-- 統計クエリ高速化
create index idx_game_events_type   on game_events(event_type);
create index idx_game_events_player on game_events(player_id);
create index idx_game_events_floor  on game_events(floor);

-- RLS：匿名キーからは INSERT のみ許可（SELECT はダッシュボード/サービスロールで実施）
alter table game_events enable row level security;
create policy "anon insert events" on game_events
  for insert to anon with check (true);
```

> 注: `rankings` テーブルが既に anon insert を許可している前提。`game_events` も同様に
> INSERT のみ開放し、閲覧は Supabase ダッシュボードの SQL Editor（サービスロール）で行う。

## 2. 統計クエリ例（SQL Editor で実行）

### 到達フロア分布（どこで離脱するか）
```sql
-- 各フロアに「到達したユニークプレイヤー数」→ 離脱カーブ
select floor, count(distinct player_id) as players
from game_events
where event_type = 'floor_reached'
group by floor
order by floor;
```

### 死亡フロア・Lv分布（どこで詰まるか）
```sql
select floor, count(*) as deaths, round(avg(level), 1) as avg_level
from game_events
where event_type = 'death'
group by floor
order by deaths desc;
```

### スロット結果の出現率
```sql
select slot_result,
       count(*) as cnt,
       round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
from game_events
where event_type = 'slot_result'
group by slot_result
order by cnt desc;
```

### プレイヤーごとの最高到達フロア
```sql
select player_id, max(floor) as best_floor
from game_events
where event_type = 'floor_reached'
group by player_id
order by best_floor desc;
```

### 日別ユニークプレイヤー数（DAU・補助指標）
```sql
select date(created_at) as day, count(distinct player_id) as dau
from game_events
group by day
order by day desc;
```

## 3. 実装メモ

- `src/game/supabase.ts`
  - `getPlayerId()` … localStorage `et_player_id` に匿名UUIDを永続化
  - `logEvent(type, payload)` … fire-and-forget。失敗してもゲーム進行を妨げない
- 発火ポイント
  - フロア到達 … `GameScene.enterNormalFloor()`（`floor++` 直後）
  - 死亡 … `GameScene` のゲームオーバー遷移直前
  - スロット結果 … `SlotMachine.tsx`（全リール停止・評価時）
