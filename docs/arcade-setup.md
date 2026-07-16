# げーせん（弾幕よけミニゲーム） セットアップ手順

あるかなひろばの「げーせん」筐体（噴水の右）で遊べる弾幕よけミニゲームのランキングを
動かすために、Supabase 側で **テーブル1つ** を作成してください。

## テーブル `ebt_arcade_scores`

Supabase ダッシュボード → SQL Editor で以下を実行：

```sql
create table if not exists public.ebt_arcade_scores (
  id           bigint generated always as identity primary key,
  player_name  text not null,
  player_id    text,
  time_ms      integer not null,
  created_at   timestamptz not null default now()
);

-- ランキング取得（time_ms降順）を速くする
create index if not exists idx_ebt_arcade_scores_time
  on public.ebt_arcade_scores (time_ms desc);

-- RLS：既存の ebt_graveyard / ebt_rankings と同じく、クライアントから直接insert/select
alter table public.ebt_arcade_scores enable row level security;

create policy "public read arcade scores"
  on public.ebt_arcade_scores
  for select
  using (true);

create policy "public insert arcade scores"
  on public.ebt_arcade_scores
  for insert
  with check (true);
```

## 動作確認

1. あるかなひろば到着 → 噴水の右にある「げーせん」筐体に体当たり（またはタップ）
2. 「スタート」→ 画面をなぞってプレイヤー（水色の球）を動かし、赤い弾を避け続ける
3. 弾に当たるとゲームオーバー → 生存時間が記録され、ランキングに反映されることを確認

テーブル未作成の状態でも遊べます（登録/取得はfire-and-forgetで失敗してもゲーム進行は止まりません）。
