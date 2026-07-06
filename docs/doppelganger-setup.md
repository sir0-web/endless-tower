# ドッペルゲンガー機能 セットアップ手順

「ドッペルゲンガー襲来！」イベントを動かすために、Supabase 側で **テーブル1つ** を作成し、
初期データ（プレースホルダーNPC）を投入してください。

## 1. テーブル `ebt_doppelgangers`

Supabase ダッシュボード → SQL Editor で以下を実行：

```sql
create table if not exists public.ebt_doppelgangers (
  id                 bigint generated always as identity primary key,
  player_id          text not null,        -- 死亡したプレイヤーの匿名UUID（自分自身には出現させないための除外用）
  player_name        text not null,
  floor              int not null,         -- 死亡階（出現候補の判定キー）
  level              int not null,
  str                int not null default 0,
  agi                int not null default 0,
  dex                int not null default 0,
  intelligence       int not null default 0,
  vit                int not null default 0,
  luk                int not null default 0,
  max_hp             int not null,
  stat_point_reward  int not null default 0,   -- 撃破時に付与する、生涯累計ステータスポイント
  equipment          jsonb,                     -- 装備スナップショット（参考記録。戦闘計算には使わない）
  created_at         timestamptz not null default now()
);

create index if not exists idx_ebt_doppelgangers_floor
  on public.ebt_doppelgangers (floor);

-- RLS：匿名キーから insert / select / delete を許可する。
-- insert = 死亡時の登録（本人のみが自分のデータを書く。書き込み内容の検証はしていないため
--          性質上いたずら書きは可能だが、ebt_rankings 等と同じ信頼モデルを踏襲する）。
-- select = 他プレイヤーがフロア通過時に出現候補を検索するために必要。
-- delete = 撃破では削除しない（記録は残り続け、他プレイヤーや次回以降の周回に出現し続ける）。
--          10階バンドごとの保持上限（最新10件）を超えた古い記録を自動整理するためだけに使う。
alter table public.ebt_doppelgangers enable row level security;

create policy "anon insert doppelgangers" on public.ebt_doppelgangers
  for insert to anon with check (true);
create policy "anon select doppelgangers" on public.ebt_doppelgangers
  for select to anon using (true);
create policy "anon delete doppelgangers" on public.ebt_doppelgangers
  for delete to anon using (true);
```

## 2. 初期データ（プレースホルダーNPC「まっちょ」）

サービス開始直後はプレイヤーの死亡記録が無く出現しないため、10階ごと・200階まで
一律ポイント30の「ドッペルゲンガー「まっちょ」」を種として配置しておく。

`player_id = 'seed'` は実プレイヤーの匿名UUID（`crypto.randomUUID()`）と衝突しない固定値のため、
誰に対しても除外されず出現候補になり続ける。ステータスはその階に到達した「平均的なキャラクター」を
想定した概算値（レベル=階数、獲得ポイントを6ステータスへ均等配分したと仮定）。

```sql
insert into public.ebt_doppelgangers
  (player_id, player_name, floor, level, str, agi, dex, intelligence, vit, luk, max_hp, stat_point_reward, equipment)
select
  'seed'                                    as player_id,
  'まっちょ'                                 as player_name,
  f                                          as floor,
  f                                          as level,
  3 + floor(((f - 1) * 5) / 6.0)             as str,
  1 + floor(((f - 1) * 5) / 6.0)             as agi,
  1 + floor(((f - 1) * 5) / 6.0)             as dex,
  1 + floor(((f - 1) * 5) / 6.0)             as intelligence,
  3 + floor(((f - 1) * 5) / 6.0)             as vit,
  1 + floor(((f - 1) * 5) / 6.0)             as luk,
  50 + (f - 1) * 5                          as max_hp,
  30                                         as stat_point_reward,
  null                                       as equipment
from generate_series(10, 200, 10) as f;
```

## 3. 仕様メモ（実装済み・2026-07-05）

- 登録タイミング：GAME OVER画面で「ドッペルゲンガーとして生き続けますか？」に「はい」と答えた場合のみ登録。
  「いいえ」を選ぶと登録されず、次の周回で他プレイヤーの前に出現することもない。
- 出現条件：フロア到達時、**死亡階±10階かつ10階未満は対象外**の範囲に記録があれば1階につき1体まで10%抽選。
  周回済み（自己最高到達階より下）のフロアは farming 対策として対象外。
- 撃破報酬：生涯累計で獲得したステータスポイント（消費済み含む、レベルアップ/いいね/アルカナ/ジャックポット/
  スロット等すべての経路の合計）をまるごと付与。経験値・アイテムドロップは無し。
- 撃破しても `ebt_doppelgangers` の記録は削除しない。撃破した本人のその周回中だけ再出現しないよう
  クライアント側（GameSceneインスタンスの `defeatedDoppelgangerIds`）で除外する。新規ゲーム開始で
  リセットされるため、次回以降の周回や他プレイヤーには引き続き出現しうる（10階バンドの保持上限に
  達して削除されるまで、何度でも遭遇・撃破・報酬獲得の対象になる）。
- 保持上限：10階バンド（1-10, 11-20, …）ごとに最新10件のみ保持し、超過分は古いものから自動削除
  （新規登録時に `src/game/doppelganger.ts` の `registerDeadCharacter` が実施。撃破とは無関係の
  ハウスキーピング処理）。
- 実装ファイル：`src/game/doppelganger.ts`（DBアクセス）／ `src/scenes/GameOverScene.ts`（同意モーダル）／
  `src/scenes/GameScene.ts`（出現・戦闘・撃破処理）／ `src/components/GameToast.tsx`（確認ダイアログ本体）。
