// プロンプト管理ユーティリティ

export interface PromptVariables {
  [key: string]: string;
}

// テンプレート変数を置換する関数
export function renderPrompt(template: string, variables: PromptVariables): string {
  let rendered = template;
  
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    rendered = rendered.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
  }
  
  return rendered;
}

// マークダウンプロンプトを読み込み・レンダリングする関数
export async function loadAndRenderMarkdownPrompt(
  filename: string, 
  variables: PromptVariables
): Promise<string> {
  try {
    // Cloudflare Workers環境では、ファイルを直接読み込めないため
    // プロンプトをインラインで定義する必要があります
    const { MARKDOWN_PROMPTS } = await import('./markdown-prompts');
    const template = MARKDOWN_PROMPTS[filename];
    
    if (!template) {
      throw new Error(`Prompt template ${filename} not found`);
    }
    
    return renderPrompt(template, variables);
  } catch (error) {
    console.error(`Error loading prompt ${filename}:`, error);
    throw error;
  }
}

// プロンプトテンプレート定義
export const PROMPTS = {
  // 初回推薦
  RECOMMENDATION: {
    SYSTEM: `あなたは親しみやすく、料理が大好きなAIアシスタントです。定番料理のちょっとしたアレンジや時短テクニックが得意で、ユーザーが「作ってみたい！」と思えるような楽しい提案をします。常に30分以内で完成する簡単レシピを心がけ、フレンドリーで親近感のある口調で話します。`,
    
    USER: `今日の夕食、一緒に考えましょう！😊 以下の情報を基に、手軽で美味しい3つの夕食を提案しますね。

【あなたの情報】
- 最近食べた料理: {{recentList}}
- お気に入りの料理: {{preferredDishes}}
- アレルギー: {{allergies}}
- 苦手な食材: {{dislikes}}

【今日の環境】
- 気温: {{temperature}}°C
- 天気: {{weather}}

【提案のポイント】
- 定番料理に少しアレンジを加えた、新鮮で作りやすいメニュー
- 調理時間30分以内で完成する簡単レシピ
- 和食・洋食・中華など異なるジャンルでバリエーション豊かに
- 今日の気温と気分にぴったりな料理
- アレルギーや苦手食材は絶対に使いません

親しみやすく、ワクワクする提案をお願いします！

フォーマット:
🍽️ **今日のおすすめ夕食**

1. **[料理名]** - [なぜこの料理？どんなアレンジ？]
2. **[料理名]** - [なぜこの料理？どんなアレンジ？]
3. **[料理名]** - [なぜこの料理？どんなアレンジ？]

気になる料理の番号を送ってくれれば、詳しいレシピをお教えします！✨`
  },

  // 再提案
  RE_RECOMMENDATION: {
    SYSTEM: `あなたは多様な料理ジャンルに精通したAIアシスタントです。エージェント的思考で前回の提案を分析し、完全に異なるアプローチの料理を提案します。

【エージェント思考プロセス】
1. 前回提案の分析：主材料・調理法・ジャンルを特定
2. 回避戦略の策定：前回と重複する要素をすべて除外
3. 新提案の生成：完全に異なる軸での料理選択

和食→洋食、肉→魚、炒め物→煮物のような大胆な変更を躊躇しません。材料や味付けが似ている料理は絶対に避けます。`,

    USER: `{{userRequest}}という追加のご要望にお応えして、前回とは完全に異なる新しい夕食を3つ提案します！😊

【前回の提案分析】
前回提案した料理: {{previousRecommendations}}
↓
【回避すべき要素】
- 主材料: {{avoidIngredients}}
- 調理法: {{avoidCookingMethods}}
- ジャンル: {{avoidGenres}}

【あなたの情報】
- 最近食べた料理: {{recentList}}
- お気に入りの料理: {{preferredDishes}}
- アレルギー: {{allergies}}
- 苦手な食材: {{dislikes}}

【今日の環境】
- 気温: {{temperature}}°C
- 天気: {{weather}}

【今回の特別な条件】
- 追加のご要望: {{userRequest}}
- 避けたい料理: {{avoidList}}

【エージェント的提案戦略】
1. 前回と完全に異なる主材料を選択（豚→魚、鶏→豆腐等）
2. 異なる調理法を採用（炒める→煮る→焼く等）
3. 異なるジャンルから選択（和→洋→中→エスニック）
4. ユーザー要望を最優先に考慮

【多様性確保の例】
- 前回が「豚の生姜焼き」なら→「魚のグリル」「豆腐ハンバーグ」
- 前回が「炒め物」なら→「煮物」「オーブン料理」
- 前回が「和食」なら→「イタリアン」「メキシカン」

フォーマット:
🔄 **前回とは完全に異なる新提案**

1. **[料理名]** - [前回との違い・ご要望との関連]
2. **[料理名]** - [前回との違い・ご要望との関連]  
3. **[料理名]** - [前回との違い・ご要望との関連]

気になる料理の番号を送ってくれれば、詳しいレシピをお教えします！`
  },

  // エージェント機能
  AGENT: {
    USER_REQUEST_ANALYSIS: `以下のメッセージが再提案要求かどうかを判定し、タイプを分類してください。

メッセージ: "{{message}}"

分類基準:
- diverse: "他の提案", "違うの", "別の料理" など、多様性を求める
- light: "あっさり", "さっぱり", "軽いもの" など、軽い料理を求める  
- hearty: "がっつり", "しっかり", "ボリューム" など、重い料理を求める
- different: "前回と違う", "似てない", "変化" など、前回との差別化を求める
- general: その他の一般的な再提案要求

JSON形式で回答してください:
{
  "type": "diverse|light|hearty|different|general",
  "isRecommendationRequest": true/false
}`,

    DIVERSE_RECOMMENDATION: `食事推薦エージェントとして、ユーザーの要求に基づいて多様性のある料理を3品提案してください。

## ユーザー情報
- アレルギー: {{allergies}}
- 苦手な食べ物: {{dislikes}}

## 最近の食事履歴
{{recentMeals}}

## ユーザー要求
- タイプ: {{requestType}}
- 元メッセージ: "{{originalMessage}}"

## 回避すべき要素 (前回提案との重複回避)
- 避ける食材: {{avoidIngredients}}
- 避けるジャンル: {{avoidGenres}}  
- 避ける調理法: {{avoidCookingMethods}}

## 天気情報
{{weather}}

## 提案ルール
1. 前回提案と完全に異なる軸で選択する
2. 3品は互いに主材料・ジャンル・調理法が重複しないようにする
3. ユーザー要求タイプに応じた特性を持たせる
4. 季節・天気に適した料理を優先する

JSON形式で回答してください:
{
  "recommendations": [
    {
      "dish": "料理名",
      "genre": "和食/洋食/中華/エスニック等",
      "mainIngredient": "主材料", 
      "cookingMethod": "調理法",
      "reason": "選択理由"
    }
  ]
}`
  },

  // 分析系
  ANALYSIS: {
    RE_RECOMMENDATION_CHECK: {
      SYSTEM: `ユーザーのメッセージが「料理の再提案を求めているかどうか」を判定してください。「他のも提案して」「もっとあっさりしたもの」「違うのがいい」などは再提案要求です。「はい」または「いいえ」で答えてください。`,
      USER: `このメッセージは料理の再提案を求めていますか？: "{{messageText}}"`
    },

    USER_REQUEST: {
      SYSTEM: `ユーザーの料理リクエストから要望を抽出してください。「さっぱり」「肉を使った」「簡単な」等の要素を分析し、簡潔に要約してください。`,
      USER: `この文章から料理への要望を抽出してください: "{{requestText}}"`
    },

    DISH_EXTRACTION: {
      SYSTEM: `Extract the dish name from user message. Return only the dish name.`,
      USER: `Extract dish name from: "{{text}}"`
    }
  }
};