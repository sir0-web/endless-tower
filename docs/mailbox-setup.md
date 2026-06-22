# メールBOX（運営→プレイヤーDM）セットアップ

ADMINから特定プレイヤー（端末＝匿名player_id）へDMを送り、受信側は**死んでもいつでも**メールBOXで読める機能のDBセットアップ。

Supabase の SQL Editor で以下を **一度だけ** 実行する。

```sql
-- 端末(player_id)を会話キーにした双方向DM。ランに紐づかないので死亡後も残る。
create table if not exists ebt_mails (
  id           bigint generated always as identity primary key,
  player_id    text not null,                                  -- 会話相手（端末＝匿名UUID）
  player_name  text,
  sender       text not null check (sender in ('admin','player')),
  title        text,                                           -- admin発のみ。playerの返信はnull可
  body         text not null,
  read         boolean not null default false,                 -- 受信側が既読にしたか
  created_at   timestamptz not null default now()
);

create index if not exists idx_ebt_mails_player
  on ebt_mails (player_id, created_at);
create index if not exists idx_ebt_mails_inbox
  on ebt_mails (sender, read) where sender = 'player';

-- service role 専用（ポリシー無し）。読み書きは API(/api/mailbox, /api/admin-mail)経由のみ。
alter table ebt_mails enable row level security;
```

## 仕組みの要点（双方向DM）
- **ADMIN→プレイヤー**: ADMIN「DM」タブ → オンライン一覧から宛先を選ぶ（or player_id 直接入力）→ 件名・本文を送信（`/api/admin-mail` action=send、adminKey 認証）。`sender='admin'`。
- **プレイヤー受信**: 画面の📧ボタン（TOP/ゲーム中どちらでも・新着は赤バッジ）からメールBOXを開く（`/api/mailbox`）。会話形式で表示、開くと admin発を既読化。
- **プレイヤー→ADMIN（返信）**: メールBOX下部の入力欄から返信（`/api/mailbox` action=reply）。`sender='player'`。
- **ADMIN受信**: ADMIN「DM」タブの受信箱に未読返信が着信（タブに件数バッジ）。スレッドを開くと既読化（`/api/admin-mail` action=inbox / thread）。
- `player_id` は `getPlayerId()`（localStorage `et_player_id`＝端末固有の匿名UUID）。**ランに紐づかないので死亡してもメールは残る**。
- テーブル未作成でもクラッシュせず、メール0件として動作する。
