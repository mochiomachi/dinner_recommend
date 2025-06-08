// RecommendationAgent - 食事提案エージェント機能
import { loadAndRenderMarkdownPrompt } from './prompts/index';

export interface RecommendationSession {
  id: string;
  userId: string;
  sessionStart: Date;
  lastActivity: Date;
}

export interface RecommendedDish {
  id?: number;
  sessionId: string;
  dishName: string;
  genre: string;
  mainIngredient: string;
  cookingMethod: string;
  recommendedAt: Date;
  selected: boolean;
  userFeedback?: string;
}

export interface UserRequest {
  type: 'diverse' | 'light' | 'hearty' | 'different' | 'general';
  originalMessage: string;
  timestamp: Date;
}

export interface AvoidanceStrategy {
  avoidIngredients: string[];
  avoidGenres: string[];
  avoidCookingMethods: string[];
  reason: string;
}

export interface RecommendationContext {
  user: {
    id: string;
    allergies?: string;
    dislikes?: string;
  };
  recentMeals: Array<{
    dish: string;
    rating: number;
    mood: string;
    ate_date: string;
  }>;
  preferredDishes: string[];
  previousRecommendations: RecommendedDish[];
  userRequest: UserRequest;
  weather?: {
    temp: number;
    feelsLike: number;
    description: string;
    humidity: number;
    windSpeed: number;
    season: string;
    cookingContext: string;
  };
  avoidanceStrategy: AvoidanceStrategy;
}

export class RecommendationAgent {
  constructor(private db: D1Database, private openaiKey: string, private prompts?: any, private renderPrompt?: any) {}

  /**
   * ユーザーメッセージから再提案要求を分析
   */
  /**
   * 再提案専用の詳細分析 - 要求タイプに基づく推薦戦略を決定
   */
  analyzeReRecommendationStrategy(userRequest: UserRequest): {
    strategy: string;
    description: string;
    priorityFactors: string[];
  } {
    const strategies = {
      diverse: {
        strategy: 'maximum_variety',
        description: '前回と完全に異なるジャンル・調理法・食材での多様性確保',
        priorityFactors: ['ジャンル差別化', '調理法変更', '主材料変更', '味付け変更']
      },
      light: {
        strategy: 'light_focused',
        description: 'あっさり系料理に特化した選択（蒸し物・茹で物・サラダ等）',
        priorityFactors: ['脂質控えめ', '蒸し・茹で調理', '野菜中心', '消化良好']
      },
      hearty: {
        strategy: 'hearty_focused', 
        description: 'ボリューム重視の満足感ある料理選択',
        priorityFactors: ['高カロリー', '肉類中心', '炭水化物併用', '満腹感重視']
      },
      different: {
        strategy: 'contrast_maximization',
        description: '前回提案との対比を最大化する完全対照的選択',
        priorityFactors: ['前回逆特性', '季節感変更', '調理時間差別化', '食感変更']
      },
      general: {
        strategy: 'balanced_variety',
        description: 'バランス重視の標準的多様性確保',
        priorityFactors: ['栄養バランス', '季節適応', '調理難易度', '材料入手性']
      }
    };

    return strategies[userRequest.type] || strategies.general;
  }

  /**
   * 前回の提案を分析して回避戦略を立てる
   */
  async analyzePreviousRecommendations(sessionId: string): Promise<AvoidanceStrategy> {
    try {
      // 最新の3件のみ取得（直前の推薦セットのみを回避対象とする）
      const previousDishes = await this.db.prepare(`
        SELECT dish_name, genre, main_ingredient, cooking_method, recommended_at
        FROM recommended_dishes 
        WHERE session_id = ?
        ORDER BY recommended_at DESC
        LIMIT 3
      `).bind(sessionId).all();

      const dishes = (previousDishes.results as any[]) || [];
      
      if (dishes.length === 0) {
        return {
          avoidIngredients: [],
          avoidGenres: [],
          avoidCookingMethods: [],
          reason: '初回提案のため回避対象なし'
        };
      }

      // 前回提案の分析（効率化とログ改善）
      const ingredients = [...new Set(dishes.map(d => d.main_ingredient).filter(Boolean))];
      const genres = [...new Set(dishes.map(d => d.genre).filter(Boolean))];
      const methods = [...new Set(dishes.map(d => d.cooking_method).filter(Boolean))];

      const strategy = {
        avoidIngredients: ingredients,
        avoidGenres: genres,
        avoidCookingMethods: methods,
        reason: `前回提案した${dishes.length}品の特徴を回避: ${dishes.map(d => d.dish_name).join(', ')}`
      };

      console.log(`🚫 Avoidance strategy: 食材${ingredients.length}種類, ジャンル${genres.length}種類, 調理法${methods.length}種類`);
      console.log(`📋 Previous dishes: ${dishes.map(d => `${d.dish_name}(${d.genre})`).join(', ')}`);

      return strategy;

    } catch (error) {
      console.error('Previous recommendations analysis failed:', error);
      return {
        avoidIngredients: [],
        avoidGenres: [],
        avoidCookingMethods: [],
        reason: 'エラーにより回避対象設定失敗'
      };
    }
  }

  /**
   * 多様性を確保した料理推薦を生成
   */
  async generateDiverseRecommendations(context: RecommendationContext): Promise<RecommendedDish[]> {
    const { user, recentMeals, userRequest, avoidanceStrategy, weather } = context;

    // 新しい戦略分析を活用
    const strategy = this.analyzeReRecommendationStrategy(userRequest);
    console.log(`🎯 Re-recommendation strategy: ${strategy.strategy} - ${strategy.description}`);

    // 前回の提案情報を取得（テンプレート用）
    const previousRecommendationsText = context.previousRecommendations.length > 0 
      ? context.previousRecommendations.map(r => `${r.dishName} (${r.genre}・${r.mainIngredient}・${r.cookingMethod})`).join(', ')
      : '初回提案のため前回履歴なし';

    // プロンプト変数を準備
    const variables = {
      strategy: strategy.strategy,
      strategyDescription: strategy.description,
      priorityFactors: strategy.priorityFactors.join(', '),
      allergies: user.allergies || 'なし',
      dislikes: user.dislikes || 'なし',
      recentMeals: recentMeals.length > 0 
        ? recentMeals.map(m => `- ${m.dish} (評価: ${m.rating}/5, 気分: ${m.mood}, 日付: ${m.ate_date})`).join('\n')
        : '履歴なし（新規ユーザーまたはデータなし）',
      preferredDishes: context.preferredDishes.slice(0, 3).join(', ') || '情報なし',
      requestType: userRequest.type,
      originalMessage: userRequest.originalMessage,
      previousRecommendations: previousRecommendationsText,
      avoidIngredients: avoidanceStrategy.avoidIngredients.join(', ') || 'なし',
      avoidGenres: avoidanceStrategy.avoidGenres.join(', ') || 'なし',
      avoidCookingMethods: avoidanceStrategy.avoidCookingMethods.join(', ') || 'なし',
      temperature: weather ? weather.temp.toString() : '20',
      weather: weather ? `${weather.description}（体感気温${weather.feelsLike}°C、湿度${weather.humidity}%、${weather.season}、${weather.cookingContext}）` : '情報なし'
    };

    // マークダウンプロンプトを使用
    const prompt = await loadAndRenderMarkdownPrompt('re-recommendation', variables);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,  // 初回と同じ
          temperature: 0.9,  // 初回と同じ創造性
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json() as any;
      const recommendationText = data.choices[0].message.content;
      
      // 初回と同じように詳細な文章から料理名を抽出
      const dishes = this.extractDishNamesFromRecommendation(recommendationText);
      
      return dishes.map((dishName, index) => ({
        sessionId: '', // セッション更新時に設定
        dishName: dishName,
        genre: 'unknown', // 後で改善可能
        mainIngredient: 'unknown', // 後で改善可能
        cookingMethod: 'unknown', // 後で改善可能
        recommendedAt: new Date(),
        selected: false,
        userFeedback: recommendationText // 詳細な説明全体を保存
      }));

    } catch (error) {
      console.error('Diverse recommendations generation failed:', error);
      // フォールバック推薦
      return this.getFallbackRecommendations(userRequest.type);
    }
  }

  /**
   * セッション情報を更新
   */
  async updateSession(sessionId: string, recommendations: RecommendedDish[], context: RecommendationContext): Promise<void> {
    try {
      // セッション最終活動時刻を更新
      await this.db.prepare(`
        UPDATE recommendation_sessions 
        SET last_activity = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).bind(sessionId).run();

      // 推薦料理を記録
      for (const dish of recommendations) {
        await this.db.prepare(`
          INSERT INTO recommended_dishes 
          (session_id, dish_name, genre, main_ingredient, cooking_method, user_feedback)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          sessionId,
          dish.dishName,
          dish.genre,
          dish.mainIngredient,
          dish.cookingMethod,
          dish.userFeedback
        ).run();
      }

    } catch (error) {
      console.error('Session update failed:', error);
    }
  }

  /**
   * 新しいセッションを開始
   */
  async startNewSession(userId: string): Promise<string> {
    const sessionId = `session_${userId}_${Date.now()}`;
    
    try {
      await this.db.prepare(`
        INSERT INTO recommendation_sessions (id, user_id)
        VALUES (?, ?)
      `).bind(sessionId, userId).run();
      
      return sessionId;
    } catch (error) {
      console.error('New session creation failed:', error);
      return sessionId; // フォールバック
    }
  }

  /**
   * 最新のセッションIDを取得
   */
  async getCurrentSession(userId: string): Promise<string> {
    try {
      // セッション有効期限チェック付きクエリ（24時間以内）
      const result = await this.db.prepare(`
        SELECT id, last_activity 
        FROM recommendation_sessions 
        WHERE user_id = ? 
          AND datetime(last_activity) >= datetime('now', '-24 hours')
        ORDER BY last_activity DESC 
        LIMIT 1
      `).bind(userId).first();

      if (result) {
        const sessionData = result as any;
        console.log(`♻️ Reusing existing session: ${sessionData.id} (last_activity: ${sessionData.last_activity})`);
        return sessionData.id;
      } else {
        console.log(`🆕 No valid session found for user ${userId}, creating new session`);
      }
    } catch (error) {
      console.error('Get current session failed:', error);
    }

    // 有効なセッションが見つからない場合は新規作成
    return await this.startNewSession(userId);
  }

  /**
   * 推薦テキストから料理名を抽出
   */
  private extractDishNamesFromRecommendation(text: string): string[] {
    const patterns = [
      // パターン1: "1. **料理名** - 説明"
      /\d+\.\s*\*\*([^*]+)\*\*/g,
      // パターン2: "1. 料理名 - 説明"  
      /\d+\.\s*([^-\n]+?)(?:\s*[-ー]|$)/g,
      // パターン3: "**料理名**"
      /\*\*([^*]+)\*\*/g
    ];
    
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches && matches.length >= 3) {
        const dishNames = matches.slice(0, 3).map(m => {
          return m.replace(/\*\*/g, '')
                  .replace(/^\d+\.\s*/, '')
                  .replace(/\s*[-ー].*$/, '')
                  .trim();
        }).filter(name => name.length > 1 && name.length < 30);
        
        if (dishNames.length >= 3) {
          return dishNames;
        }
      }
    }
    
    // フォールバック
    return ['推薦料理1', '推薦料理2', '推薦料理3'];
  }

  /**
   * フォールバック推薦
   */
  private getFallbackRecommendations(type: UserRequest['type']): RecommendedDish[] {
    const recommendations = {
      diverse: [
        { dishName: '親子丼', genre: '和食', mainIngredient: '鶏肉', cookingMethod: '煮る', userFeedback: '定番の和食料理' },
        { dishName: 'ペペロンチーノ', genre: '洋食', mainIngredient: 'パスタ', cookingMethod: '炒める', userFeedback: 'シンプルなイタリアン' },
        { dishName: '麻婆豆腐', genre: '中華', mainIngredient: '豆腐', cookingMethod: '炒める', userFeedback: 'ピリ辛中華料理' }
      ],
      light: [
        { dishName: 'サラダ', genre: '洋食', mainIngredient: '野菜', cookingMethod: '生', userFeedback: 'さっぱり野菜料理' },
        { dishName: '茶碗蒸し', genre: '和食', mainIngredient: '卵', cookingMethod: '蒸す', userFeedback: 'やさしい和食' },
        { dishName: 'おかゆ', genre: '和食', mainIngredient: '米', cookingMethod: '煮る', userFeedback: '胃にやさしい' }
      ],
      hearty: [
        { dishName: 'カツ丼', genre: '和食', mainIngredient: '豚肉', cookingMethod: '揚げる', userFeedback: 'ボリューム満点' },
        { dishName: 'ハンバーグ', genre: '洋食', mainIngredient: '牛肉', cookingMethod: '焼く', userFeedback: 'がっつり洋食' },
        { dishName: 'ラーメン', genre: '中華', mainIngredient: '麺', cookingMethod: '茹でる', userFeedback: '満腹感のある一品' }
      ],
      different: [
        { dishName: 'オムライス', genre: '洋食', mainIngredient: '卵', cookingMethod: '炒める', userFeedback: '見た目も楽しい' },
        { dishName: '焼き魚', genre: '和食', mainIngredient: '魚', cookingMethod: '焼く', userFeedback: 'ヘルシーな和食' },
        { dishName: 'パスタ', genre: '洋食', mainIngredient: 'パスタ', cookingMethod: '茹でる', userFeedback: 'アレンジ豊富' }
      ],
      general: [
        { dishName: 'カレーライス', genre: '洋食', mainIngredient: '野菜', cookingMethod: '煮る', userFeedback: '定番の人気料理' },
        { dishName: '焼き鳥', genre: '和食', mainIngredient: '鶏肉', cookingMethod: '焼く', userFeedback: '手軽で美味しい' },
        { dishName: 'みそ汁', genre: '和食', mainIngredient: '味噌', cookingMethod: '煮る', userFeedback: 'ほっとする味' }
      ]
    };

    const dishes = recommendations[type] || recommendations.general;
    return dishes.map(dish => ({
      sessionId: '',
      dishName: dish.dishName,
      genre: dish.genre,
      mainIngredient: dish.mainIngredient, 
      cookingMethod: dish.cookingMethod,
      recommendedAt: new Date(),
      selected: false,
      userFeedback: dish.userFeedback
    }));
  }
}