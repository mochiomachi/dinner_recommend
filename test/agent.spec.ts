import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecommendationAgent, UserRequest } from '../src/agent';

describe('RecommendationAgent', () => {
  let agent: RecommendationAgent;
  let mockDB: any;
  
  beforeEach(() => {
    // Mock OpenAI API responses
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      if (url.includes('openai.com')) {
        const body = JSON.parse(options.body);
        
        // Mock user request analysis
        if (body.messages[0].content.includes('再提案要求かどうか')) {
          const message = body.messages[0].content.match(/"(.+)"/)?.[1] || '';
          let type = 'general';
          
          if (message.includes('他の')) type = 'diverse';
          else if (message.includes('あっさり')) type = 'light';
          else if (message.includes('がっつり')) type = 'hearty';
          
          return new Response(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  type,
                  isRecommendationRequest: type !== 'general'
                })
              }
            }]
          }));
        }
        
        // Mock recommendation generation
        if (body.messages[0].content.includes('多様性のある料理')) {
          return new Response(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  recommendations: [
                    { dish: 'テスト料理1', genre: '和食', mainIngredient: '鶏肉', cookingMethod: '煮る', reason: 'テスト' },
                    { dish: 'テスト料理2', genre: '洋食', mainIngredient: '豚肉', cookingMethod: '焼く', reason: 'テスト' },
                    { dish: 'テスト料理3', genre: '中華', mainIngredient: '牛肉', cookingMethod: '炒める', reason: 'テスト' }
                  ]
                })
              }
            }]
          }));
        }
      }
      
      return new Response('{}', { status: 404 });
    });
    // Mock D1 Database
    mockDB = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: () => Promise.resolve({ id: 'test-session' }),
          all: () => Promise.resolve({ 
            results: [
              { dish_name: 'ハンバーグ', genre: '洋食', main_ingredient: '豚肉', cooking_method: '焼く' }
            ]
          }),
          run: () => Promise.resolve()
        })
      })
    };
    
    agent = new RecommendationAgent(mockDB, 'fake-openai-key');
  });

  describe('User Request Analysis', () => {
    it('should detect diverse request', async () => {
      const request = await agent.analyzeUserRequest('他の料理を提案して');
      expect(request.type).toBe('diverse');
      expect(request.originalMessage).toBe('他の料理を提案して');
    });

    it('should detect light request', async () => {
      const request = await agent.analyzeUserRequest('もっとあっさりしたものがいい');
      expect(request.type).toBe('light');
    });

    it('should detect hearty request', async () => {
      const request = await agent.analyzeUserRequest('がっつり食べたい');
      expect(request.type).toBe('hearty');
    });

    it('should fallback to general for unknown patterns', async () => {
      const request = await agent.analyzeUserRequest('天気はどう？');
      expect(request.type).toBe('general');
    });
  });

  describe('Avoidance Strategy', () => {
    it('should analyze previous recommendations', async () => {
      const strategy = await agent.analyzePreviousRecommendations('test-session');
      
      expect(strategy.avoidIngredients).toContain('豚肉');
      expect(strategy.avoidGenres).toContain('洋食');
      expect(strategy.avoidCookingMethods).toContain('焼く');
    });

    it('should handle empty previous recommendations', async () => {
      // Mock empty results
      mockDB.prepare = () => ({
        bind: () => ({
          all: () => Promise.resolve({ results: [] })
        })
      });

      const strategy = await agent.analyzePreviousRecommendations('empty-session');
      
      expect(strategy.avoidIngredients).toEqual([]);
      expect(strategy.avoidGenres).toEqual([]);
      expect(strategy.avoidCookingMethods).toEqual([]);
      expect(strategy.reason).toBe('初回提案のため回避対象なし');
    });
  });

  describe('Session Management', () => {
    it('should start new session', async () => {
      const sessionId = await agent.startNewSession('test-user');
      expect(sessionId).toMatch(/^session_test-user_\d+$/);
    });

    it('should get current session', async () => {
      const sessionId = await agent.getCurrentSession('test-user');
      expect(sessionId).toBe('test-session');
    });
  });

  describe('Fallback Recommendations', () => {
    it('should provide diverse fallback recommendations', async () => {
      // Mock OpenAI API failure
      global.fetch = vi.fn().mockRejectedValue(new Error('OpenAI API Error'));

      const context = {
        user: { id: 'test-user' },
        recentMeals: [],
        previousRecommendations: [],
        userRequest: { type: 'diverse' as UserRequest['type'], originalMessage: 'テスト', timestamp: new Date() },
        weather: undefined,
        avoidanceStrategy: {
          avoidIngredients: [],
          avoidGenres: [],
          avoidCookingMethods: [],
          reason: 'テスト'
        }
      };

      const recommendations = await agent.generateDiverseRecommendations(context);
      
      expect(recommendations).toHaveLength(3);
      expect(recommendations).toEqual(['親子丼', 'ペペロンチーノ', '麻婆豆腐']);
    });

    it('should provide light fallback recommendations', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('OpenAI API Error'));

      const context = {
        user: { id: 'test-user' },
        recentMeals: [],
        previousRecommendations: [],
        userRequest: { type: 'light' as UserRequest['type'], originalMessage: 'テスト', timestamp: new Date() },
        weather: undefined,
        avoidanceStrategy: {
          avoidIngredients: [],
          avoidGenres: [],
          avoidCookingMethods: [],
          reason: 'テスト'
        }
      };

      const recommendations = await agent.generateDiverseRecommendations(context);
      
      expect(recommendations).toHaveLength(3);
      expect(recommendations).toEqual(['サラダ', '茶碗蒸し', 'おかゆ']);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Mock database error
      mockDB.prepare = () => {
        throw new Error('Database Error');
      };

      const strategy = await agent.analyzePreviousRecommendations('error-session');
      
      expect(strategy.reason).toBe('エラーにより回避対象設定失敗');
      expect(strategy.avoidIngredients).toEqual([]);
    });

    it('should handle OpenAI API errors', async () => {
      // Mock fetch error
      global.fetch = vi.fn().mockRejectedValue(new Error('Network Error'));

      const request = await agent.analyzeUserRequest('エラーテスト');
      
      // Should fallback to keyword-based analysis
      expect(request.type).toBe('general');
      expect(request.originalMessage).toBe('エラーテスト');
    });
  });
});