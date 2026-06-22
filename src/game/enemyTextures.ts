// ── 敵キャラクターの名前→テクスチャキー対応（ゲーム描画とADMINプレビューで共有）──
// 画像パスは /assets/characters/enemies/<key>.png に統一。
// ゲーム実行時(GameScene)は上書き画像(ovr_*)のキーをこのオブジェクトへ追記して使う。
export const ENEMY_TEXTURE_MAP: Record<string, string> = {
  'ぽり男':              'pori',
  'ルナティック':        'lunatic',
  'ビタタ':              'bitata',
  'ウィスパー':          'whisper',
  'スモーキー':          'smokey',
  '白蓮玉':              'hakurengoku',
  'ソルジャースケルトン': 'soldierskeleton',
  'クリーミー':          'kurimi',
  'スポア':              'supoa',
  'ヨーヨー':            'yoyo',
  'ヒドラ':              'hidora',
  'ゾンビ':              'zonbi',
  'ペコペコ':            'pekopeko',
  'フロッグ':            'flog',
  'ボーカル':            'bokaru',
  'パイレーツスケルトン': 'paisuke',
  'マンティス':          'manthis',
  'ガイアス':            'gaiasu',
  'フローラ':            'flora',
  'サスカッチ':          'sasukachi',
  'マリンスフィア':      'marinsfia',
  'イシス':              'isis',
  'マルデューク':        'marudyuku',
  'フェン':              'fen',
  'マリナ':              'marina',
  'ボンゴン':            'bongon',
  'アヌビス':            'anybis',
  'ハンマーコボルド':    'hankobo',
  'ジャック':            'jack',
  'ソフィー':            'sofi',
  'ジルタス':            'jirutasu',
  'ジョーカー':          'joker',
  'クランプ':            'kuranp',
  'ジェスター':          'jesta',
  'ムナック':            'munack',
  'デビルチ':            'devilchi',
  'ゴーレム':            'golem',
  'マミー':              'mummy',
  'アラーム':            'alarm',
  'フェンダーク':        'fendark',
  'ミノタウロス':        'minotaur',
  'オットー':            'otto',
  'チンピラ':            'chinpira',
  '半魚人':              'fishman',
  'ナイトメア':          'nightmare',
  '深淵の騎士':          'abyssalknight',
  '黄金蟲':              'goldenbug',
  'オシリス':            'osiris',
  'ストラウフ':          'stra',
  'エクリプス':          'eclipse',
  'エンジェリング':      'angeling',
  'デビルリング':        'deviling',
  'マスターリング':      'masterring',
  'ゴーストリング':      'ghostring',
  'ドレイク':            'drake',
  'トード':              'toad',
  'キングドラモ':        'kingdramo',
  'さすらい狼':          'wanderwolf',
  'ダークプリースト':    'darkpri',
  'キメラ':              'kimera',
  'ミステルテイン':      'mistel',
  'ネクロマンサー':      'nekuro',
  'ドラゴンフライ':      'dragonfly',
  'フリオニ':            'furioni',
  'オークヒーロー':      'oakhero',
  'オークロード':        'oaklord',
  'アモンラー':          'amon',
  'ダークロード':        'dark',
  'ファラオ':            'farao',
  'モロク':              'moroku',
  '月夜花（ヤファ）':    'yafa',
  'ドラキュラ':          'dorakyura',
  'オウルデューク':      'oul',
  'ミュータントドラゴン': 'myutant',
  'すかるぽりん':        'scullporin',
}

/** モンスター名から静的アセットのURLを返す（対応キーが無ければ null）。実ファイルの有無は呼び出し側で <img onError> で判定する。 */
export function enemyImagePath(name: string): string | null {
  const key = ENEMY_TEXTURE_MAP[name]
  return key ? `/assets/characters/enemies/${key}.png` : null
}

/** 画像が無い敵をゲームが代替表示する際の色（カテゴリ別の塗りつぶし矩形の色）。 */
export const ENEMY_FALLBACK_COLOR: Record<string, string> = {
  monster_normal: '#ff4444',  // 通常モンスター（赤）
  monster_mini:   '#ff00ff',  // MINIボス（マゼンタ）
  monster_mvp:    '#ff8800',  // MVPボス（オレンジ）
  monster_area:   '#ffff00',  // エリアボス（黄）
}
