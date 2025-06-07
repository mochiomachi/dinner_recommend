# 夕食レコメンド LINE Bot 要件定義 – v0.2 (MVP)

## 1. 背景・目的

* **背景**
  家族間の日々の「夕飯なに食べる？」問題を自動解決し、献立決めのストレスを削減する。加えて Cloudflare × OpenAI の構成で LLM 実装を学習する。
* **目的**

  * 毎日 14:00 JST に LINE で夕食候補をプッシュ
  * 候補決定後、材料・手順をチャット内で提示し、食事実績を記録
  * コストは数百円／月以下、インフラ運用を最小に抑える

---

## 2. 全体アーキテクチャ

```mermaid
graph TD
  subgraph Cloudflare
    A[Workers (TypeScript)] -->|fetch| B(OpenAI API)
    A -->|SQL| C[D1 (SQLite)]
    A --> D(Weather API)
    E[Cron 14:00] --> A
    F[KV Backup (Nightly)] --> C
  end
  LINE["LINE Official\n/Messaging API"] -->|Webhook| A
```

**キー構成要素**

| レイヤ    | 役割                       | 採択技術                                  |
| ------ | ------------------------ | ------------------------------------- |
| フロント   | LINE Bot (Messaging API) | LINE Official アカウント (フリー枠)            |
| バックエンド | ビジネスロジック・API 呼び出し        | Cloudflare Workers (TypeScript)       |
| LLM 推論 | 料理名抽出／レコメンド／材料生成         | OpenAI GPT-4o-mini (chat.completions) |
| 永続 DB  | 食事・ユーザー設定保存              | Cloudflare D1 (SQLite 互換)             |
| バッチ/定時 | 14:00 レコメンド Push         | Cloudflare Cron Triggers              |
| 外部 API | 天気取得                     | OpenWeather One Call (無料枠)            |
| バックアップ | DB snapshot              | Workers KV に夜間エクスポート（0:00 JST）        |

---

## 3. 機能要件

| ID      | 機能                       | 詳細                                                                                                                            |
| ------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **F-1** | **夕食入力 & 評価登録**          | - LINE で自由文送信（例:「⭐️3 今日は豚バラ大根と味噌汁！」）<br>- OpenAI で (a) 料理名リスト (b) 星評価 (c) ユーザーの気分キーワード を JSON 抽出<br>- `meals` テーブルへ INSERT    |
| **F-2** | **ユーザー設定**               | `/setup` コマンド or リッチメニューで<br>  - アレルギー<br>  - 嫌いな食材<br>  - 好きなジャンル を登録                                                        |
| **F-3** | **レコメンド生成**              | インプット:<br>  - 過去 14 日間の食事履歴<br>  - 当日の天気・気温<br>  - 当日ユーザーの気分 (最新メッセージ) <br>  - アレルギー・嫌い食材<br>OpenAI で候補 3 品を生成し、各候補に "理由" を付与 |
| **F-4** | **レシピ生成 (チャット完結)**       | - 候補が選択されたら OpenAI へ<br>  `"<料理名> の人数4人分の材料と手順を JSON で"`<br>- 返却 JSON を整形して LINE Flex Message で表示                             |
| **F-5** | **買い物リスト作成**             | F-4 の材料 JSON から食材名＋分量をリストアップし、箇条書き送信                                                                                          |
| **F-6** | **定時レコメンド Push**         | Cloudflare Cron → Workers → LINE push<br>14:00 JST に家族全員へ F-3 の結果送信                                                           |
| **F-7** | **実績保存**                 | 候補選択後、自動で `meals` に確定フラグ (`decided=true`) 更新                                                                                  |
| **F-8** | **認証**                   | - 家族 LINE グループに "招待コード" を送付<br>- コード送信で `users.invited=true` 設定<br>- もしくは Official アカウント友達追加＋内部 allow-list                    |
| **F-9** | **ログ／分析 (Nice-to-have)** | Workers Analytics + optional 日次集計を Notion へ Webhook                                                                           |

---

## 4. 非機能要件

| 項目     | 要件                                                                                       |
| ------ | ---------------------------------------------------------------------------------------- |
| レスポンス  | 通常 < 2 s（OpenAI API 呼び出し含む）                                                              |
| 耐障害性   | Cloudflare Workers Free: 99.9% 目安                                                        |
| セキュリティ | - HTTPS/TLS 終端は CF 任せ<br>- API キーは Wrangler Secret<br>- LINE userId ホワイトリスト or 招待コードチェック |
| コスト    | Workers & D1 無料枠、OpenAI 月≤ 0.5 USD 見込み                                                   |
| 運用     | GitHub Actions CI/CD、Sentry for Workers でエラーログ収集                                         |

---

## 5. データモデル（更新）

```sql
users (
  id TEXT PRIMARY KEY,   -- LINE userId
  name TEXT,
  allergies JSON,
  dislikes  JSON,
  invited   BOOLEAN,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id),
  ate_date DATE,
  dish TEXT,
  tags JSON,
  rating INTEGER,        -- 1–5 ⭐️
  mood  TEXT,            -- LLM 抽出キーワード
  decided BOOLEAN DEFAULT 0
);
```

---

## 6. OpenAI プロンプト設計 (要約)

| シーン         | System Prompt 骨子                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| 抽出 (F-1)    | "Extract dishes, rating (★1-5), mood keyword. Return pure JSON."                                     |
| レコメンド (F-3) | "Given past meals, dislikes, allergies, weather, mood → suggest 3 dinners with short reasons, JSON." |
| レシピ生成 (F-4) | "Return ingredients list (name, qty) & numbered steps for <dish>, for 4 people, JSON."               |

---

## 7. バックアップ方針

* **日次エクスポート**: 0:00 JST に `sqlite .dump` を Workers KV (`kv:backup`) に保存
* **保持期間**: 30 日ローテーション
* **リストア手順**: KV からダウンロード → `wrangler d1 import` で戻す

---

## 8. 未着手課題 / 今後決定事項

| ID  | 課題           | 期限  | 備考                            |
| --- | ------------ | --- | ----------------------------- |
| T-1 | 気分キーワードの分類粒度 | 実装前 | 例: "疲れ気味" / "ワクワク" など5〜6カテゴリ? |
| T-2 | レシピ出力フォーマット  | 実装前 | Flex Message or 画像カード?        |
| T-3 | 食材在庫管理との連携   | 将来  | Slack コマンド or 手入力?            |

---

## 9. マイルストーン

1. **v0.2 要件確定**（←イマココ）
2. **PoC**: LINE→Workers→OpenAI 抽出動線完成
3. **MVP**: F-1〜F-6 実装 + 手動 E2E テスト
4. **家族α運用**: 1 週間フィードバック → 重み調整
5. **v1.0**: 安定運用 & Nice-to-have 着手

---

> 以上です！ 次のステップとして不明点 (T-1〜T-3) の方向性や、追加で気になるところがあればコメントお願いします。
