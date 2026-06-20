# お知らせ（NEWS）機能 セットアップ手順

ゲームTOPの「📜NEWS」ボタン／ADMINの「お知らせ」タブを動かすために、
Supabase 側で **テーブル1つ** と **ストレージバケット1つ** を作成してください。

## 1. テーブル `ebt_announcements`

Supabase ダッシュボード → SQL Editor で以下を実行：

```sql
create table if not exists public.ebt_announcements (
  id            bigint generated always as identity primary key,
  title         text not null,
  body_html     text not null default '',
  is_published  boolean not null default true,
  published_at  timestamptz not null default now(),
  view_count    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 公開順の取得を速くする
create index if not exists idx_ebt_announcements_pub
  on public.ebt_announcements (is_published, published_at desc);

-- RLS：公開中のお知らせは誰でも閲覧可。書き込み/更新/削除はサービスキー(API)経由のみ。
alter table public.ebt_announcements enable row level security;

create policy "public read published announcements"
  on public.ebt_announcements
  for select
  using (is_published = true);
```

> ADMIN の一覧（非公開含む）は Service Role Key またはADMIN画面の鍵で読むため、
> select ポリシーは「公開分のみ匿名可」で問題ありません。
> 作成・編集・削除・VIEW加算はすべて Service Role Key を使う API 経由なので RLS をバイパスします。

## 2. ストレージバケット `announcement-images`

Supabase ダッシュボード → Storage → New bucket：

- **Name**: `announcement-images`
- **Public bucket**: ✅ オン（画像URLを公開表示するため）

作成後、アップロード許可のポリシーが必要です（匿名アップロードを許可。ADMIN画面からのみ使用）。
SQL Editor で：

```sql
-- 画像の公開読み取り
create policy "public read announcement images"
  on storage.objects for select
  using (bucket_id = 'announcement-images');

-- 画像アップロード（ADMIN画面のエディタから。匿名キーで insert 許可）
create policy "anyone can upload announcement images"
  on storage.objects for insert
  with check (bucket_id = 'announcement-images');
```

> 既存の `report-images` バケットと同じ運用です。気になる場合は後でアップロードもAPI経由に寄せられます。

## 3. 環境変数（既存のものを流用）

追加の環境変数は不要です。以下が既に設定されていれば動きます：

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（フロント）
- `SUPABASE_SERVICE_ROLE_KEY`（API：作成/編集/削除/VIEW加算）
- `VITE_ADMIN_KEY`（ADMIN操作の認証）

## 動作確認

1. ADMIN → 「お知らせ」タブ → 「＋新規作成」→ タイトルと本文（太字/サイズ/色/画像）を入力 → 保存
2. ゲームTOP右上の「📜NEWS」を押す → 一覧に掲載日＋タイトル → クリックで巻物風の詳細表示
3. ADMIN の一覧で VIEW 数が増えることを確認（同一ブラウザは1記事1カウント）
