# kanji

小学生向け漢字読み問題アプリ。Cloudflare Workers + D1 + Vite(バニラTS/SPA)。

## コマンド

| 目的 | コマンド |
|------|----------|
| フロント開発サーバ | `npm run dev` (Vite) |
| ビルド | `npm run build` (`tsc && vite build` → `dist/`) |
| Worker 型チェック | `npm run typecheck:worker` |
| ローカル実行(Worker+DB) | `npx wrangler dev` (要 `npm run build` 済み) |
| デプロイ | `npx wrangler deploy` |

## ディレクトリ

- `src/` … フロント(SPA)。`main.ts` がエントリ、`router.ts` はハッシュルーティング(`#/`, `#/login`, `#/challenge`, `#/admin`)。
  - `src/pages/` … 画面単位(home / login / challenge / admin-kanji / admin-questions)。各 `render*()` + `attach*Events()` の対。
  - `src/ui/` … 共有UI部品。 `src/api.ts` … fetch ラッパ。 `src/types.ts` … 共有型。
- `worker/` … Cloudflare Worker(API)。`index.ts` がルータ本体。
  - `worker/routes/` … `public.ts`(公開API) / `admin-kanji.ts` / `admin-questions.ts`。`/api/admin/*` は管理者セッション必須。
  - `worker/auth.ts` 認証 / `kana.ts` かな正規化 / `tags.ts` タグ / `spice.ts` 難易度。
- `db/` … `schema.sql`(現行スキーマの正) と `db/migrations/`。
- `wrangler.jsonc` … D1 バインディング `DB`、静的アセットは `dist/`。

## 規約・注意

- **`db/migrations/applied/` は適用済み。読む・編集する必要はない**(seed/backfill は数万〜十数万行あり、検索対象からも外して良い)。スキーマ確認は `schema.sql` を見る。
- `dist/`, `node_modules/`, `.wrangler/`, `package-lock.json` は参照不要。
- 問題は「読み問題」のみ。`questions.type` / `choices` は廃止済み(古い migration に痕跡が残るが現行コードは不使用)。
- コード分割済み。1画面=1ファイル、機能単位で追加する方針(直近のリファクタ方針を踏襲)。
- コメント・UI文言は日本語。
