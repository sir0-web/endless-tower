# クラウドセーブ セットアップ（手動SQL）

端末を問わないセーブ機能。名前（スロット名）＋パスワードで Supabase にセーブを保存し、
別端末でも同じ名前＋パスワードで再開できる。

- パスワードはクライアントで **SHA-256** ハッシュ化して送信（平文は保存しない）。
- テーブルへは直接アクセスさせず、**SECURITY DEFINER の RPC 経由**で「名前＋ハッシュ一致時のみ
  読める/上書きできる」ようサーバー側で制御する（anon キーが公開でも他人のセーブを読めない）。
- ライフサイクル：ロードで行を削除（消費）／死亡で削除（permadeath維持）。

## Supabase SQL Editor で以下を実行

```sql
-- 1) テーブル（直接アクセスは RLS で遮断し、RPC からのみ操作）
create table if not exists ebt_cloud_saves (
  name          text primary key,
  password_hash text not null,
  data          jsonb not null,
  updated_at    timestamptz not null default now()
);
alter table ebt_cloud_saves enable row level security;
-- anon 向けポリシーは作らない（直接 select/insert を不可にする）

-- 2) 保存（upsert）。同名・別パスワードは 'name_taken' で拒否
create or replace function cloud_save(p_name text, p_hash text, p_data jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare existing text;
begin
  select password_hash into existing from ebt_cloud_saves where name = p_name;
  if existing is not null and existing <> p_hash then
    return 'name_taken';
  end if;
  insert into ebt_cloud_saves(name, password_hash, data, updated_at)
    values (p_name, p_hash, p_data, now())
    on conflict (name) do update
      set data = excluded.data, password_hash = excluded.password_hash, updated_at = now();
  return 'ok';
end;
$$;

-- 3) 読み込み（名前＋ハッシュ一致時のみ data を返す。不一致は null）
create or replace function cloud_load(p_name text, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  select data into result from ebt_cloud_saves where name = p_name and password_hash = p_hash;
  return result;
end;
$$;

-- 4) 削除（名前＋ハッシュ一致時のみ）
create or replace function cloud_delete(p_name text, p_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from ebt_cloud_saves where name = p_name and password_hash = p_hash;
end;
$$;

-- 5) anon ロールに RPC 実行権限を付与
grant execute on function cloud_save(text, text, jsonb) to anon;
grant execute on function cloud_load(text, text)        to anon;
grant execute on function cloud_delete(text, text)      to anon;
```

実行前でもアプリは落ちない（クラウド保存/再開が失敗扱いになるだけで、ローカル自動セーブは従来どおり動作）。
実行後からクラウドセーブ／クラウド再開が有効になる。
