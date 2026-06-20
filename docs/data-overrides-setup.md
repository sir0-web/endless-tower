# データベース編集（ADMIN）セットアップ手順

ADMINの「データベース」タブで、モンスター/装備/アイテム/魔法の書を編集して本番へ反映する機能です。
**下書き → 公開** の2段階で、公開したものだけが全プレイヤーへ反映されます。
ゲームは起動時に「公開中の上書き」を読み込み、ハードコードのデフォルトへマージします
（取得に失敗してもデフォルトで動くので安全です）。

## 1. テーブル `ebt_data_overrides`

Supabase → SQL Editor で実行：

```sql
create table if not exists public.ebt_data_overrides (
  id           bigint generated always as identity primary key,
  category     text not null,          -- monster_normal/mini/mvp/area, equip, item, spell
  ref          text not null,          -- 元の名前（不変キー）
  draft_patch  jsonb not null default '{}'::jsonb,  -- 編集中の変更
  draft_image  text,                   -- 編集中の画像URL
  pub_patch    jsonb,                  -- 公開中の変更（ゲームが読む）
  pub_image    text,                   -- 公開中の画像URL（ゲームが読む）
  is_published boolean not null default false,
  updated_at   timestamptz not null default now(),
  unique (category, ref)
);

-- ゲームは「公開中の上書き」だけを匿名readする
alter table public.ebt_data_overrides enable row level security;

create policy "public read published overrides"
  on public.ebt_data_overrides
  for select
  using (is_published = true);
```

> 作成・編集・公開・削除はすべて Service Role Key を使うAPI（`/api/admin-data`）経由でRLSをバイパスします。
> 匿名で読めるのは公開分のみ（`is_published = true`）です。

## 2. ストレージバケット `entity-images`

Supabase → Storage → New bucket：

- **Name**: `entity-images`
- **Public bucket**: ✅ オン

ポリシー（SQL Editor）：

```sql
create policy "public read entity images"
  on storage.objects for select
  using (bucket_id = 'entity-images');

create policy "anyone can upload entity images"
  on storage.objects for insert
  with check (bucket_id = 'entity-images');
```

> 画像は `report-images` / `announcement-images` と同じ運用です。
> ゲームはアップロードされた画像を**起動時に自動透過処理 → 可視部分を計算して主人公サイズに調整**して描画します
> （既存のキャラ画像処理パイプラインを再利用）。

## 3. 使い方

1. `/admin` → 「データベース」タブ → 対象の行をクリック
2. 名称・数値・効果を編集（モンスターは画像アップロードも可）
3. **保存** … 下書きとして保存（まだライブには出ない）
4. **公開** … 下書きをライブへ反映（全プレイヤーの次回ゲーム読み込みから反映）
5. **公開停止 / 削除** … デフォルト値へ戻す

## 注意

- 画像は**モンスターのみ**反映されます（装備/アイテム/魔法の書はゲーム内で絵文字表示のため画像なし）。
- 反映タイミングは「公開」後、各プレイヤーが**次にゲームを開いた（リロードした）とき**です。
- 環境変数は既存のものを流用（`VITE_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` / `VITE_ADMIN_KEY`）。追加不要。
