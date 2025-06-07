# 夕食レコメンド LINE Bot

家族の夕食決めを自動化するLINE Botです。毎日14:00に夕食候補をプッシュし、食事記録・レシピ生成・買い物リスト作成機能を提供します。

## アーキテクチャ

- **フロントエンド**: LINE Messaging API
- **バックエンド**: Cloudflare Workers (TypeScript)
- **データベース**: Cloudflare D1 (SQLite)
- **LLM**: OpenAI GPT-4o-mini
- **外部API**: OpenWeather API
- **定時実行**: Cloudflare Cron Triggers

## 機能

### 実装済み機能

1. **食事入力・評価登録** - ⭐で評価付き食事記録
2. **ユーザー設定** - `/setup`でアレルギー・嫌いな食材登録
3. **レコメンド生成** - 過去履歴・天気・気分を考慮した3候補提案
4. **レシピ生成** - 選択した料理の材料・手順・買い物リスト自動生成
5. **定時プッシュ** - 毎日14:00 JST自動レコメンド配信

## セットアップ

### 前提条件

- Node.js 18+
- Cloudflare アカウント
- LINE Official Account
- OpenAI API キー
- OpenWeather API キー

### 環境構築

1. **依存関係インストール**
```bash
npm install
```

2. **Cloudflare D1 データベース作成**
```bash
wrangler d1 create dinner-recommend-db
```

3. **データベーステーブル作成**
```bash
wrangler d1 execute dinner-recommend-db --file=./schema.sql
```

4. **環境変数設定**
```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put OPENWEATHER_API_KEY
```

5. **wrangler.tomlの`database_id`を更新**

### デプロイ

**初回デプロイの方**: [first-deploy-guide.md](./first-deploy-guide.md) で順序立てて解説  
**詳細なデプロイ手順**: [deployment-guide.md](./deployment-guide.md) を参照

```bash
# 簡易デプロイ（事前設定完了後）
npm run deploy
```

### 開発

```bash
npm run dev
```

## LINE Bot設定

1. LINE Official Accountでチャネル作成
2. Webhook URL設定: `https://your-worker-domain.workers.dev/webhook`
3. Message API有効化

## 使用方法

### 基本コマンド

- `/setup` - ユーザー設定（アレルギー・嫌いな食材）
- `⭐3 ハンバーグ美味しかった` - 食事記録
- `1` or `これにします` - レコメンド選択→レシピ生成

### 自動機能

- 毎日14:00に夕食候補3品をプッシュ
- 天気・過去履歴・ユーザー設定を考慮した提案
- 選択後の自動レシピ・買い物リスト生成

## データベーススキーマ

### users テーブル
- `id` (TEXT PRIMARY KEY) - LINE userId
- `name` (TEXT) - ユーザー名
- `allergies` (TEXT) - アレルギー情報
- `dislikes` (TEXT) - 嫌いな食材
- `invited` (BOOLEAN) - 招待済みフラグ

### meals テーブル
- `id` (INTEGER PRIMARY KEY) - 自動採番
- `user_id` (TEXT) - ユーザーID
- `ate_date` (DATE) - 食事日
- `dish` (TEXT) - 料理名
- `tags` (TEXT) - ジャンルタグ
- `rating` (INTEGER) - 1-5評価
- `mood` (TEXT) - 気分キーワード
- `decided` (BOOLEAN) - 確定フラグ

## コスト見積り

- Cloudflare Workers: 無料枠内
- Cloudflare D1: 無料枠内
- OpenAI API: 月0.5USD以下想定
- OpenWeather API: 無料枠内

合計: **月数百円以下**

## ライセンス

MIT