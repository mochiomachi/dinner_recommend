import { RecommendationAgent, UserRequest, RecommendationContext } from './agent';
import { PROMPTS, renderPrompt, PromptVariables, loadAndRenderMarkdownPrompt } from './prompts/index';

export interface Env {
	DB: D1Database;
	OPENAI_API_KEY: string;
	LINE_CHANNEL_SECRET: string;
	LINE_CHANNEL_ACCESS_TOKEN: string;
	OPENWEATHER_API_KEY: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// D1 Database Test Endpoint
		if (request.method === 'GET' && url.pathname === '/db-test') {
			console.log('=== D1 Database Test ===');
			console.log('env.DB:', env.DB);
			console.log('typeof env.DB:', typeof env.DB);
			console.log('env.DB === null:', env.DB === null);
			console.log('env.DB === undefined:', env.DB === undefined);
			
			if (env.DB) {
				try {
					const result = await env.DB.prepare('SELECT 1 as test, "DB Connection Success" as message').first();
					return new Response(JSON.stringify(result, null, 2), {
						headers: { 'Content-Type': 'application/json' }
					});
				} catch (error) {
					return new Response(`DB Error: ${error}`, { status: 500 });
				}
			} else {
				return new Response('❌ env.DB is null or undefined', { status: 500 });
			}
		}
		
		if (request.method === 'POST' && url.pathname === '/webhook') {
			console.log('Webhook called!');
			return handleLineWebhook(request, env, ctx);
		}
		
		if (request.method === 'GET' && url.pathname === '/health') {
			return new Response('OK', { status: 200 });
		}
		
		// プロンプトテスト用エンドポイント
		if (request.method === 'POST' && url.pathname === '/test-prompt') {
			return await handlePromptTest(request, env);
		}
		
		// マークダウンプロンプトテスト用エンドポイント
		if (request.method === 'POST' && url.pathname === '/test-markdown-prompt') {
			return await handleMarkdownPromptTest(request, env);
		}
		
		// OpenAI API実行テスト用エンドポイント
		if (request.method === 'POST' && url.pathname === '/test-openai-output') {
			return await handleOpenAIOutputTest(request, env);
		}
		
		// Cron機能テスト用エンドポイント（ローカル開発用）
		if (request.method === 'POST' && url.pathname === '/test-cron') {
			console.log('🕐 Manual cron trigger test started');
			ctx.waitUntil(sendDailyRecommendations(env));
			return new Response('Cron test triggered - check logs for execution details', { 
				status: 200,
				headers: { 'Content-Type': 'text/plain' }
			});
		}
		
		// 環境変数確認用エンドポイント
		if (request.method === 'GET' && url.pathname === '/test-env') {
			const envCheck = {
				hasOpenAI: !!env.OPENAI_API_KEY,
				openAIKeyLength: env.OPENAI_API_KEY?.length || 0,
				openAIKeyPrefix: env.OPENAI_API_KEY?.substring(0, 8) || 'not set',
				hasLineSecret: !!env.LINE_CHANNEL_SECRET,
				hasLineToken: !!env.LINE_CHANNEL_ACCESS_TOKEN,
				hasWeatherKey: !!env.OPENWEATHER_API_KEY
			};
			return new Response(JSON.stringify(envCheck, null, 2), {
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		// DB Recommendations Debug Endpoint
		if (request.method === 'GET' && url.pathname === '/debug-recommendations') {
			console.log('=== Debug Recommendations ===');
			try {
				// 最新のセッションを取得
				const latestSessionResult = await env.DB.prepare(`
					SELECT session_id, user_id, created_at 
					FROM user_sessions 
					ORDER BY created_at DESC 
					LIMIT 1
				`).first();
				
				if (!latestSessionResult) {
					return new Response('No sessions found', { status: 404 });
				}
				
				console.log('Latest session:', latestSessionResult);
				
				// そのセッションの推薦データを取得
				const recommendationsResult = await env.DB.prepare(`
					SELECT dish_name, recommendation_order, recommended_at 
					FROM recommended_dishes 
					WHERE session_id = ? 
					ORDER BY recommendation_order ASC
				`).bind(latestSessionResult.session_id).all();
				
				console.log('Recommendations:', recommendationsResult);
				
				return new Response(JSON.stringify({
					session: latestSessionResult,
					recommendations: recommendationsResult.results || [],
					expected: "1番目に「温かい豚汁」があるのが正常"
				}, null, 2), {
					headers: { 'Content-Type': 'application/json' }
				});
				
			} catch (error) {
				console.error('Debug recommendations error:', error);
				return new Response(`Debug failed: ${error}`, { status: 500 });
			}
		}

		// Users table debug endpoint
		if (request.method === 'GET' && url.pathname === '/debug-users') {
			console.log('=== Debug Users ===');
			try {
				const allUsers = await env.DB.prepare('SELECT id, invited, allergies, dislikes, created_at FROM users').all();
				const invitedUsers = await env.DB.prepare('SELECT id, invited, allergies, dislikes, created_at FROM users WHERE invited = 1').all();
				
				return new Response(JSON.stringify({
					totalUsers: allUsers.results?.length || 0,
					invitedUsers: invitedUsers.results?.length || 0,
					allUsers: allUsers.results,
					invitedOnly: invitedUsers.results
				}, null, 2), {
					headers: { 'Content-Type': 'application/json' }
				});
			} catch (error) {
				console.error('Debug users error:', error);
				return new Response(`Debug failed: ${error}`, { status: 500 });
			}
		}

		// D1 Meals Table Test Endpoint
		if (request.method === 'GET' && url.pathname === '/d1-meals-test') {
			console.log('=== D1 Meals Table Test ===');
			try {
				const userId = 'U8908fdb52a3705527eed6b130b62fc0c'; // Test user
				
				// Test 1: Simple count query with timeout
				console.log('Test 1: Simple COUNT query with timeout...');
				const countPromise = env.DB.prepare('SELECT COUNT(*) as count FROM meals WHERE user_id = ?').bind(userId).first();
				const countTimeout = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Count query timeout after 5s')), 5000)
				);
				
				const countResult = await Promise.race([countPromise, countTimeout]);
				console.log('Count result:', countResult);
				
				// Test 2: Simple SELECT query with LIMIT and timeout
				console.log('Test 2: Simple SELECT with LIMIT...');
				const selectPromise = env.DB.prepare('SELECT dish, rating FROM meals WHERE user_id = ? LIMIT 3').bind(userId).all();
				const selectTimeout = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Select query timeout after 5s')), 5000)
				);
				
				const selectResult = await Promise.race([selectPromise, selectTimeout]);
				console.log('Select result:', selectResult);
				
				// Test 3: Date-filtered query (the problematic one)
				console.log('Test 3: Date-filtered query...');
				const datePromise = env.DB.prepare(`
					SELECT dish, rating FROM meals 
					WHERE user_id = ? AND ate_date >= date('now', '-14 days')
					LIMIT 5
				`).bind(userId).all();
				const dateTimeout = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Date query timeout after 8s')), 8000)
				);
				
				const dateResult = await Promise.race([datePromise, dateTimeout]);
				console.log('Date query result:', dateResult);
				
				return new Response(JSON.stringify({
					status: 'success',
					count: countResult,
					select: selectResult,
					dateQuery: dateResult
				}, null, 2), {
					headers: { 'Content-Type': 'application/json' }
				});
				
			} catch (error) {
				console.error('D1 meals test error:', error);
				return new Response(`D1 Meals Test Failed: ${error}`, { status: 500 });
			}
		}
		
		// OpenAI API Test Endpoint
		if (request.method === 'GET' && url.pathname === '/openai-test') {
			console.log('=== OpenAI API Test ===');
			try {
				console.log('Testing OpenAI API key...');
				
				const testPromise = fetch('https://api.openai.com/v1/chat/completions', {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: 'gpt-4o-mini',
						messages: [{ role: 'user', content: 'Hello' }],
						max_tokens: 5,
					}),
				});
				
				const timeoutPromise = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Timeout after 10s')), 10000)
				);
				
				const response = await Promise.race([testPromise, timeoutPromise]) as Response;
				
				if (!response.ok) {
					const errorText = await response.text();
					return new Response(`OpenAI API Error: ${response.status} - ${errorText}`, { status: 500 });
				}
				
				const data = await response.json() as any;
				return new Response(JSON.stringify({
					status: 'success',
					response_status: response.status,
					model: data.model,
					content: data.choices?.[0]?.message?.content || 'No content'
				}, null, 2), {
					headers: { 'Content-Type': 'application/json' }
				});
				
			} catch (error) {
				console.error('OpenAI test error:', error);
				return new Response(`OpenAI Test Failed: ${error}`, { status: 500 });
			}
		}
		
		return new Response('Not Found', { status: 404 });
	},

	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		// Daily recommendation push at 14:00 JST
		ctx.waitUntil(sendDailyRecommendations(env));
	}
} satisfies ExportedHandler<Env>;

/**
 * プロンプトテスト用ハンドラー
 */
async function handlePromptTest(request: Request, env: Env): Promise<Response> {
	try {
		const body = await request.json() as any;
		const { testType, ...params } = body;
		
		const agent = new RecommendationAgent(env.DB, env.OPENAI_API_KEY, PROMPTS, renderPrompt);
		
		if (testType === 'userRequest') {
			const result = analyzeRequestTypeFromMessage(params.message || 'おすすめして');
			return new Response(JSON.stringify(result, null, 2), {
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		if (testType === 'recommendation') {
			const mockContext = {
				user: {
					id: 'test-user',
					allergies: params.allergies || 'なし',
					dislikes: params.dislikes || 'なし'
				},
				recentMeals: params.recentMeals || [
					{ dish: 'カレーライス', rating: 4, mood: '満足', ate_date: '2025-06-06' }
				],
				previousRecommendations: [],
				userRequest: {
					type: params.requestType || 'general',
					originalMessage: params.message || 'おすすめして',
					timestamp: new Date()
				},
				weather: params.weather || { temp: 20, description: '曇り' },
				avoidanceStrategy: {
					avoidIngredients: params.avoidIngredients || [],
					avoidGenres: params.avoidGenres || [],
					avoidCookingMethods: params.avoidCookingMethods || [],
					reason: 'テスト用'
				}
			};
			
			const result = await agent.generateDiverseRecommendations(mockContext);
			return new Response(JSON.stringify(result, null, 2), {
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		return new Response('Invalid testType. Use "userRequest" or "recommendation"', { 
			status: 400 
		});
		
	} catch (error) {
		return new Response(`Prompt test error: ${error}`, { status: 500 });
	}
}

async function handleOpenAIOutputTest(request: Request, env: Env): Promise<Response> {
	try {
		const body = await request.json() as any;
		const { promptType, ...variables } = body;
		
		// デフォルト値を設定
		const defaultVariables = {
			recentMeals: variables.recentMeals || 'カレーライス、ハンバーグ、焼き魚',
			preferredDishes: variables.preferredDishes || '唐揚げ、肉じゃが',
			allergies: variables.allergies || 'なし',
			dislikes: variables.dislikes || 'なし',
			temperature: variables.temperature || '15',
			weather: variables.weather || '冬の季節、寒い日（温かい料理・煮込み料理がおすすめ）、雨の日で温かい室内料理が良い',
			previousRecommendations: variables.previousRecommendations || '肉じゃが（和食・じゃがいも・煮込み）、ハンバーグ（洋食・ひき肉・焼き）、麻婆豆腐（中華・豆腐・炒め）',
			requestType: variables.requestType || 'diverse',
			originalMessage: variables.originalMessage || '他の提案も見たい',
			avoidIngredients: variables.avoidIngredients || 'じゃがいも、ひき肉、豆腐',
			avoidGenres: variables.avoidGenres || '和食、洋食、中華',
			avoidCookingMethods: variables.avoidCookingMethods || '煮込み、焼き、炒め'
		};
		
		let promptName;
		if (promptType === 'initial') {
			promptName = 'initial-recommendation';
		} else if (promptType === 're-recommendation') {
			promptName = 're-recommendation';
		} else {
			return new Response('Invalid promptType. Use "initial" or "re-recommendation"', { 
				status: 400 
			});
		}
		
		// プロンプト生成
		const renderedPrompt = await loadAndRenderMarkdownPrompt(promptName, defaultVariables);
		
		// OpenAI API呼び出し
		console.log(`🤖 Testing OpenAI API with ${promptType} prompt...`);
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [{ role: 'user', content: renderedPrompt }],
				max_tokens: 1000,
				temperature: 0.7,
			}),
		});

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.status}`);
		}

		const data = await response.json() as any;
		const openaiOutput = data.choices[0].message.content;
		
		console.log(`✅ OpenAI API response received`);
		console.log(`📝 Output length: ${openaiOutput.length} characters`);
		
		return new Response(JSON.stringify({
			promptType,
			variables: defaultVariables,
			renderedPrompt,
			openaiOutput,
			usage: data.usage
		}, null, 2), {
			headers: { 'Content-Type': 'application/json' }
		});
		
	} catch (error) {
		console.error(`❌ OpenAI output test error:`, error);
		return new Response(`OpenAI output test error: ${error}`, { status: 500 });
	}
}

async function handleMarkdownPromptTest(request: Request, env: Env): Promise<Response> {
	try {
		const body = await request.json() as any;
		const { promptType, ...variables } = body;
		
		// デフォルト値を設定
		const defaultVariables = {
			recentMeals: variables.recentMeals || 'カレーライス、ハンバーグ、焼き魚',
			preferredDishes: variables.preferredDishes || '唐揚げ、肉じゃが',
			allergies: variables.allergies || 'なし',
			dislikes: variables.dislikes || 'なし',
			temperature: variables.temperature || '20',
			weather: variables.weather || '曇り、涼しい風',
			previousRecommendations: variables.previousRecommendations || '肉じゃが（和食・じゃがいも・煮込み）、ハンバーグ（洋食・ひき肉・焼き）、麻婆豆腐（中華・豆腐・炒め）',
			requestType: variables.requestType || 'diverse',
			originalMessage: variables.originalMessage || '他の提案も見たい',
			avoidIngredients: variables.avoidIngredients || 'じゃがいも、ひき肉、豆腐',
			avoidGenres: variables.avoidGenres || '和食、洋食、中華',
			avoidCookingMethods: variables.avoidCookingMethods || '煮込み、焼き、炒め'
		};
		
		let promptName;
		if (promptType === 'initial') {
			promptName = 'initial-recommendation';
		} else if (promptType === 're-recommendation') {
			promptName = 're-recommendation';
		} else {
			return new Response('Invalid promptType. Use "initial" or "re-recommendation"', { 
				status: 400 
			});
		}
		
		const renderedPrompt = await loadAndRenderMarkdownPrompt(promptName, defaultVariables);
		
		return new Response(JSON.stringify({
			promptType,
			variables: defaultVariables,
			renderedPrompt
		}, null, 2), {
			headers: { 'Content-Type': 'application/json' }
		});
		
	} catch (error) {
		return new Response(`Markdown prompt test error: ${error}`, { status: 500 });
	}
}

async function handleLineWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	try {
		const body = await request.text();
		const signature = request.headers.get('x-line-signature');
		
		console.log('Body received:', body);
		console.log('Signature:', signature);
		
		// Verify LINE signature
		if (!signature || !(await verifyLineSignature(body, signature, env.LINE_CHANNEL_SECRET))) {
			console.log('Signature verification failed');
			return new Response('Unauthorized', { status: 401 });
		}
		
		const data = JSON.parse(body);
		console.log('Parsed data:', JSON.stringify(data));
		
		for (const event of data.events) {
			console.log('Processing event:', JSON.stringify(event));
			if (event.type === 'message' && event.message.type === 'text') {
				await handleTextMessage(event, env, ctx);
			}
		}
		
		return new Response('OK', { status: 200 });
	} catch (error) {
		console.error('Webhook error:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
}

async function handleTextMessage(event: any, env: Env, ctx: ExecutionContext): Promise<void> {
	const userId = event.source.userId;
	const messageText = event.message.text;
	const replyToken = event.replyToken;
	
	// Check if user is invited/registered, or handle invitation
	let user = await getUser(userId, env);
	
	if (!user) {
		// Create new user
		await createUser(userId, env);
		await sendLineReply(replyToken, '🎉 夕食レコメンドBotへようこそ！\n\n招待コードを入力するか、/setupコマンドで設定を開始してください。', env);
		return;
	}
	
	if (!user.invited) {
		// Handle invitation codes
		if (messageText.startsWith('INVITE-') || messageText === 'family2024') {
			await inviteUser(userId, env);
			await sendLineReply(replyToken, '✅ 招待コードが確認されました！\n/setupコマンドで設定を開始してください。', env);
			return;
		} else {
			await sendLineReply(replyToken, '招待コードを入力してください。', env);
			return;
		}
	}
	
	if (messageText.startsWith('/setup')) {
		await handleSetupCommand(replyToken, env);
	} else if (messageText.includes('アレルギー') && (messageText.includes('海産物') || messageText.includes('魚') || messageText.includes('アニサキス'))) {
		await handleSeafoodAllergyUpdate(userId, replyToken, env);
	} else if (messageText.includes('嫌いな食材') || (messageText.includes('嫌い') && (messageText.includes('食材') || messageText.includes('野菜') || messageText.includes('豆')))) {
		await handleDislikedFoodsUpdate(userId, replyToken, messageText, env);
	} else if (messageText.includes('⭐') || messageText.includes('★')) {
		await handleMealInput(userId, replyToken, messageText, env);
	} else if (messageText.match(/^[1-3]$/) || messageText.includes('選ぶ') || messageText.includes('これ')) {
		await handleRecipeRequest(userId, replyToken, messageText, env, ctx);
	} else if (messageText.includes('おすすめ') || messageText.includes('レコメンド') || messageText.includes('今日の夕食')) {
		// 初回推薦専用処理
		await handleInitialRecommendation(userId, replyToken, messageText, user, env, ctx);
	} else if (messageText.includes('他の') || messageText.includes('違う') || messageText.includes('別の') || 
			   messageText.includes('あっさり') || messageText.includes('さっぱり') || 
			   messageText.includes('がっつり') || messageText.includes('ボリューム') || messageText.includes('提案') ||
			   messageText.includes('系') || messageText.includes('料理が良い')) {
		// 再提案専用処理
		await handleUnifiedRecommendationRequest(userId, replyToken, messageText, user, env, ctx);
	} else if (messageText.includes('満足') || messageText.includes('ありがとう') || messageText.includes('いいですね')) {
		// 満足メッセージへの応答
		await sendLineReply(replyToken, '😊 ありがとうございます！お料理を楽しんでくださいね。\n\n食事の記録は ⭐ で評価と一緒に投稿してください！', env);
	} else if (messageText.includes('使い方') || messageText.includes('ヘルプ') || messageText.toLowerCase().includes('help')) {
		// ヘルプメッセージの表示
		await handleHelpRequest(replyToken, env);
	} else {
		// 一般メッセージ処理（推薦要求でない場合）
		await handleGeneralMessage(replyToken, messageText, env);
	}
}

async function handleHelpRequest(replyToken: string, env: Env): Promise<void> {
	const helpMessage = `🤖 **夕食レコメンドBot 使い方ガイド**

📝 **基本機能：**
• 「おすすめ教えて」→ 今日の夕食を提案
• 「他の提案」→ 別の料理を提案  
• 「さっぱり系」→ あっさり料理を提案
• 「がっつり系」→ ボリューム料理を提案

🍳 **レシピ機能：**
• 数字「1」「2」「3」→ 選択した料理のレシピ表示

📊 **食事記録：**
• 「⭐3 ハンバーグ美味しかった」→ 評価付きで記録
• ⭐の数で満足度を表現（1-5個）

⚙️ **設定機能：**
• 「/setup」→ 初期設定開始
• 「アレルギー 海産物」→ 海産物アレルギー登録
• 「嫌いな食材 そら豆、インゲン豆」→ 嫌いな食材登録

💡 **その他：**
• 毎日14時に自動でおすすめ料理を配信
• 天気や過去の食事を考慮した提案

何か質問があれば「使い方」と送信してください！`;

	await sendLineReply(replyToken, helpMessage, env);
}

async function handleDislikedFoodsUpdate(userId: string, replyToken: string, messageText: string, env: Env): Promise<void> {
	try {
		// 嫌いな食材をメッセージから抽出
		let dislikedFoods = '';
		
		// パターン1: "嫌いな食材 そら豆、インゲン豆"
		const pattern1 = messageText.match(/嫌いな食材[：:\s]*(.+)/);
		if (pattern1) {
			dislikedFoods = pattern1[1].trim();
		} else {
			// パターン2: "嫌い そら豆、インゲン豆"
			const pattern2 = messageText.match(/嫌い[：:\s]*(.+)/);
			if (pattern2) {
				dislikedFoods = pattern2[1].trim();
			}
		}
		
		if (!dislikedFoods) {
			await sendLineReply(replyToken, 
				'嫌いな食材を教えてください。\n\n例：「嫌いな食材 そら豆、インゲン豆」', 
				env
			);
			return;
		}
		
		// データベースに保存
		await env.DB.prepare(`
			UPDATE users SET dislikes = ? 
			WHERE id = ?
		`).bind(dislikedFoods, userId).run();
		
		console.log(`✅ Disliked foods updated for user: ${userId} - ${dislikedFoods}`);
		
		await sendLineReply(replyToken, 
			`🚫 嫌いな食材情報を更新しました！\n\n登録内容: ${dislikedFoods}\n\n今後の推薦ではこれらの食材を含む料理は除外されます。\n\n変更したい場合は再度「嫌いな食材 ○○、△△」と送信してください。`, 
			env
		);
	} catch (error) {
		console.error('Failed to update disliked foods:', error);
		await sendLineReply(replyToken, '申し訳ございません。嫌いな食材情報の更新に失敗しました。', env);
	}
}

async function handleSeafoodAllergyUpdate(userId: string, replyToken: string, env: Env): Promise<void> {
	try {
		// 海産物アレルギーを設定
		await env.DB.prepare(`
			UPDATE users SET allergies = '海産物全般（魚、海老、蟹、貝類、海藻類）' 
			WHERE id = ?
		`).bind(userId).run();
		
		console.log(`✅ Seafood allergy updated for user: ${userId}`);
		
		await sendLineReply(replyToken, 
			'🚫 海産物アレルギー情報を更新しました！\n\n今後の推薦では魚、海老、蟹、貝類、海藻類を含む料理は除外されます。\n\n変更したい場合は再度「アレルギー 海産物」と送信してください。', 
			env
		);
	} catch (error) {
		console.error('Failed to update seafood allergy:', error);
		await sendLineReply(replyToken, '申し訳ございません。アレルギー情報の更新に失敗しました。', env);
	}
}

async function handleSetupCommand(replyToken: string, env: Env): Promise<void> {
	const setupMessage = `設定を開始します。以下の情報を教えてください：

1. アレルギー（ある場合）
2. 嫌いな食材
3. 好きな料理ジャンル

例: "アレルギー: 卵、乳製品
嫌いな食材: セロリ、パクチー
好きなジャンル: 和食、イタリアン"

🐟 海産物アレルギーの場合は「アレルギー 海産物」と送信してください`;

	await sendLineReply(replyToken, setupMessage, env);
}

async function handleMealInput(userId: string, replyToken: string, messageText: string, env: Env): Promise<void> {
	try {
		// Try OpenAI API first
		let mealData = await extractMealData(messageText, env);
		
		if (!mealData) {
			// Fallback to simple parsing if OpenAI fails
			console.log('OpenAI failed, using fallback parsing');
			const stars = messageText.match(/⭐/g) || [];
			const blackStars = messageText.match(/★/g) || [];
			const numbers = messageText.match(/[1-5]/g) || [];
			
			let rating = 3; // Default
			if (stars.length > 0) rating = stars.length;
			else if (blackStars.length > 0) rating = blackStars.length;
			else if (numbers.length > 0) rating = parseInt(numbers[0] || '3');
			
			rating = Math.min(Math.max(rating, 1), 5); // Ensure 1-5 range
			
			// Extract dish name (remove stars and common words)
			const dishText = messageText.replace(/[⭐★]/g, '').replace(/[0-9]/g, '').trim();
			const dishes = [dishText || '料理'];
			
			mealData = {
				dishes: dishes,
				rating: rating,
				mood: '満足',
				tags: ['その他']
			};
		}
		
		// Save to database
		await saveMealRecord(userId, mealData, env);
		
		// Send confirmation with OpenAI result indicator
		const aiStatus = mealData.mood !== '満足' || mealData.tags[0] !== 'その他' ? '🤖 AI解析済み' : '📝 簡易解析';
		
		await sendLineReply(replyToken, 
			`🍽️ 食事を記録しました！ ${aiStatus}\n\n料理: ${mealData.dishes.join(', ')}\n評価: ${'⭐'.repeat(mealData.rating)}\n気分: ${mealData.mood}\nジャンル: ${mealData.tags.join(', ')}`, 
			env
		);
		
	} catch (error) {
		console.error('handleMealInput error:', error);
		await sendLineReply(replyToken, '申し訳ございません。食事記録でエラーが発生しました。', env);
	}
}

/**
 * 統合推薦関数 - エージェント機能を使用して初回/再提案を統一処理
 */
async function handleUnifiedRecommendationRequest(
	userId: string,
	replyToken: string,
	messageText: string,
	user: any,
	env: Env,
	ctx: ExecutionContext
): Promise<void> {
	const agent = new RecommendationAgent(env.DB, env.OPENAI_API_KEY, PROMPTS, renderPrompt);
	
	try {
		console.log(`🤖 Unified recommendation request from user: ${userId}, message: "${messageText}"`);
		
		// 1. メッセージから直接要求タイプを判定（OpenAI API呼び出し削除）
		const userRequest = analyzeRequestTypeFromMessage(messageText);
		console.log(`📊 Request type determined: ${userRequest.type}`);
		
		// 2. セッション管理
		const sessionId = await agent.getCurrentSession(userId);
		console.log(`📝 Current session: ${sessionId}`);
		
		// 3. 前回提案の分析（再提案の場合は回避戦略を立てる）
		const avoidanceStrategy = await agent.analyzePreviousRecommendations(sessionId);
		console.log(`🚫 Avoidance strategy: avoid ${avoidanceStrategy.avoidIngredients.length} ingredients, ${avoidanceStrategy.avoidGenres.length} genres`);
		
		// 4. 即座にレスポンス
		const responseMessage = userRequest.type === 'general' 
			? '🤖 AIが最適な料理を選定中...\n30秒以内にお送りします！'
			: `🎯 ${getRequestTypeEmoji(userRequest.type)} ${getRequestTypeMessage(userRequest.type)}\n30秒以内にお送りします！`;
		
		await sendLineReply(replyToken, responseMessage, env);
		
		// 5. バックグラウンドで推薦生成
		console.log('🔄 Starting background recommendation generation...');
		ctx.waitUntil(
			generateAndSendRecommendations(userId, sessionId, userRequest, avoidanceStrategy, user, env, agent)
		);
		
	} catch (error) {
		console.error('Unified recommendation failed:', error);
		await sendLineReply(replyToken, '申し訳ございません。推薦の生成に失敗しました。', env);
	}
}

/**
 * 初回推薦専用処理 - 詳細説明形式で魅力的な提案
 */
async function handleInitialRecommendation(
	userId: string,
	replyToken: string,
	messageText: string,
	user: any,
	env: Env,
	ctx: ExecutionContext
): Promise<void> {
	try {
		console.log(`🎯 Initial recommendation request from user: ${userId}, message: "${messageText}"`);
		
		// 即座にレスポンス
		await sendLineReply(replyToken, '🍽️ あなたにぴったりの夕食を提案中...\n30秒以内にお送りします！', env);
		
		// バックグラウンドで初回推薦生成
		console.log('🔄 Starting background initial recommendation generation...');
		ctx.waitUntil(
			generateInitialRecommendation(userId, user, env)
		);
		
	} catch (error) {
		console.error('Initial recommendation failed:', error);
		await sendLineReply(replyToken, '申し訳ございません。推薦の生成に失敗しました。', env);
	}
}

/**
 * 初回推薦生成処理
 */
async function generateInitialRecommendation(userId: string, user: any, env: Env): Promise<void> {
	try {
		console.log(`🚀 generateInitialRecommendation START for user: ${userId}`);
		
		// 食事履歴取得
		console.log('📝 Querying meal history...');
		let recentMeals;
		try {
			const mealQueryPromise = env.DB.prepare(`
				SELECT dish, rating, mood, ate_date FROM meals 
				WHERE user_id = ? AND ate_date >= date('now', '-14 days')
				ORDER BY ate_date DESC
			`).bind(userId).all();
			
			const mealTimeoutPromise = new Promise((_, reject) => 
				setTimeout(() => reject(new Error('Meal query timeout after 8s')), 8000)
			);
			
			recentMeals = await Promise.race([mealQueryPromise, mealTimeoutPromise]) as any;
			console.log(`✅ Meal history retrieved: ${(recentMeals as any)?.results?.length || 0} records`);
		} catch (error) {
			console.error('❌ Meal history query failed:', error);
			recentMeals = { results: [] };
		}

		// 天気情報取得
		console.log('🌤️ Getting detailed weather data...');
		const weather = await getWeatherData(env);
		console.log(`✅ Weather data: ${weather.temp}°C (体感${weather.feelsLike}°C), ${weather.description}, ${weather.season}`);
		console.log(`🍽️ Cooking context: ${weather.cookingContext}`);
		
		// 食事データ分析
		const mealHistory = recentMeals.results || [];
		const recentDishes = mealHistory.slice(0, 7).map((m: any) => m.dish);
		const highRatedMeals = mealHistory.filter((m: any) => m.rating >= 4).map((m: any) => m.dish);
		
		// プロンプト変数準備（強化された天気情報を含む）
		const variables = {
			recentMeals: recentDishes.slice(0, 5).join(', ') || '情報なし',
			preferredDishes: highRatedMeals.slice(0, 3).join(', ') || '情報なし',
			allergies: user?.allergies || 'なし',
			dislikes: user?.dislikes || 'なし',
			temperature: weather.temp.toString(),
			weather: `${weather.description}（体感気温${weather.feelsLike}°C、湿度${weather.humidity}%、${weather.season}、${weather.cookingContext}）`
		};
		
		// 新しいマークダウンプロンプトを使用
		console.log('📝 Rendering initial recommendation prompt...');
		const prompt = await loadAndRenderMarkdownPrompt('initial-recommendation', variables);
		console.log('✅ Prompt rendered');

		// OpenAI API呼び出し
		console.log('🤖 Calling OpenAI API for initial recommendation...');
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [{ role: 'user', content: prompt }],
				max_tokens: 1000,
				temperature: 0.9,
			}),
		});

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.status}`);
		}

		const data = await response.json() as any;
		const recommendationText = data.choices[0].message.content;
		
		console.log('✅ Initial recommendation generated');

		// 料理名を抽出してデータベースに保存
		await extractAndSaveInitialRecommendations(userId, recommendationText, env);

		// クイックリプライボタン付きで送信
		await sendLineMessageWithQuickReply(
			userId, 
			recommendationText, 
			createRecommendationQuickReply(),
			env
		);
		
		console.log('✅ Initial recommendation sent to user');
		
	} catch (error) {
		console.error('Initial recommendation generation failed:', error);
		// フォールバック: シンプルなメッセージ
		await sendLineMessage(userId, '申し訳ございません。推薦の生成に失敗しました。再度お試しください。', env);
	}
}

/**
 * 初回提案から料理名を抽出してデータベースに保存（より強固な抽出ロジック）
 */
async function extractAndSaveInitialRecommendations(userId: string, recommendationText: string, env: Env): Promise<void> {
	try {
		console.log('🔍 Extracting dish names from initial recommendation...');
		console.log('📄 Full recommendation text:', recommendationText);
		
		let dishNames: string[] = [];
		
		// Method 1: 複数の正規表現パターンで直接抽出
		const patterns = [
			// パターン1: "1. **料理名** - 説明"
			/\d+\.\s*\*\*([^*]+)\*\*/g,
			// パターン2: "1. 料理名 - 説明"  
			/\d+\.\s*([^-\n]+?)(?:\s*[-ー]|$)/g,
			// パターン3: "**料理名**"
			/\*\*([^*]+)\*\*/g,
			// パターン4: "1. 料理名"（行末まで）
			/\d+\.\s*([^\n]+)/g
		];
		
		for (const pattern of patterns) {
			const matches = recommendationText.match(pattern);
			if (matches && matches.length >= 3) {
				dishNames = matches.slice(0, 3).map(m => {
					return m.replace(/\*\*/g, '')
							.replace(/^\d+\.\s*/, '')
							.replace(/\s*[-ー].*$/, '')
							.trim();
				}).filter(name => name.length > 1 && name.length < 30);
				
				if (dishNames.length >= 3) {
					console.log(`✅ Pattern extraction successful with pattern: ${pattern}`, dishNames);
					break;
				}
			}
		}
		
		// Method 2: OpenAI による抽出（フォールバック）
		if (dishNames.length < 3) {
			console.log('🤖 Trying OpenAI extraction as fallback...');
			try {
				const extractPromise = fetch('https://api.openai.com/v1/chat/completions', {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: 'gpt-4o-mini',
						messages: [
							{ 
								role: 'system', 
								content: 'あなたは料理名抽出の専門家です。テキストから正確に3つの料理名を抽出し、JSON配列で返してください。料理名のみで、説明や装飾は含めないでください。' 
							},
							{ 
								role: 'user', 
								content: `以下のテキストから1番目、2番目、3番目の料理名を抽出してください。料理名のみを含むJSON配列で回答してください：\n\n${recommendationText}` 
							}
						],
						max_tokens: 150,
						temperature: 0.1,
					}),
				});

				const extractTimeout = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('OpenAI extraction timeout')), 8000)
				);

				const response = await Promise.race([extractPromise, extractTimeout]) as Response;

				if (response.ok) {
					const data = await response.json() as any;
					const extracted = JSON.parse(data.choices[0].message.content);
					if (Array.isArray(extracted) && extracted.length >= 3) {
						dishNames = extracted.slice(0, 3);
						console.log('✅ OpenAI extraction successful:', dishNames);
					}
				}
			} catch (aiError) {
				console.error('OpenAI extraction failed:', aiError);
			}
		}
		
		// Method 3: 最終フォールバック - 分析的抽出
		if (dishNames.length < 3) {
			console.log('🔧 Using analytical fallback extraction...');
			const lines = recommendationText.split('\n');
			const candidateLines = lines.filter(line => 
				/^\d+\./.test(line.trim()) && line.length > 5 && line.length < 200
			);
			
			if (candidateLines.length >= 3) {
				dishNames = candidateLines.slice(0, 3).map(line => {
					// より詳細なクリーンアップ
					return line.replace(/^\d+\.\s*/, '')
							   .replace(/\*\*/g, '')
							   .replace(/[-ー].*$/, '')
							   .replace(/^【.*?】/, '')
							   .replace(/\s+$/, '')
							   .trim();
				}).filter(name => name.length > 1);
				
				console.log('🔧 Analytical extraction result:', dishNames);
			}
		}
		
		// 最終的なフォールバック
		if (dishNames.length < 3) {
			console.log('⚠️ All extraction methods failed, using generic names');
			dishNames = ['本日の料理1', '本日の料理2', '本日の料理3'];
		}

		console.log('🍽️ Final extracted dish names:', dishNames);

		// セッションを作成または取得
		const agent = new RecommendationAgent(env.DB, env.OPENAI_API_KEY, PROMPTS, renderPrompt);
		const sessionId = await agent.startNewSession(userId);

		// 各料理をrecommended_dishesテーブルに保存
		for (let i = 0; i < dishNames.length; i++) {
			const dishName = dishNames[i];
			try {
				const savePromise = env.DB.prepare(`
					INSERT INTO recommended_dishes (session_id, dish_name, genre, main_ingredient, cooking_method, recommendation_order, recommended_at)
					VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
				`).bind(sessionId, dishName, '未分類', '不明', '不明', i + 1).run();

				const saveTimeout = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Save timeout after 5s')), 5000)
				);

				await Promise.race([savePromise, saveTimeout]);
				console.log(`✅ Saved dish ${i + 1}: ${dishName}`);
			} catch (saveError) {
				console.error(`Failed to save dish ${i + 1}:`, saveError);
			}
		}

		console.log('✅ All initial recommendations saved to database');

	} catch (error) {
		console.error('Failed to extract and save initial recommendations:', error);
		// エラーが発生してもアプリケーションは継続
	}
}

/**
 * メッセージから要求タイプを直接判定（OpenAI API不要）
 */
function analyzeRequestTypeFromMessage(message: string): UserRequest {
	const lowerMessage = message.toLowerCase();
	
	// 各タイプのキーワードパターン
	const patterns = {
		light: ['あっさり', 'さっぱり', '軽い', 'ライト', '淡白'],
		hearty: ['がっつり', 'しっかり', 'ボリューム', '満腹', '重い', 'こってり'],
		different: ['違う', '別の', '他の', '変える', '別れたい', '似てない'],
		diverse: ['多様', 'バリエーション', '選択肢', '種類']
	};
	
	// パターンマッチング
	for (const [type, keywords] of Object.entries(patterns)) {
		if (keywords.some(keyword => lowerMessage.includes(keyword))) {
			return {
				type: type as UserRequest['type'],
				originalMessage: message,
				timestamp: new Date()
			};
		}
	}
	
	// デフォルトは general
	return {
		type: 'general',
		originalMessage: message,
		timestamp: new Date()
	};
}

/**
 * 要求タイプに応じた絵文字を取得
 */
function getRequestTypeEmoji(type: UserRequest['type']): string {
	const emojis = {
		diverse: '🎲',
		light: '🥗', 
		hearty: '🍖',
		different: '✨',
		general: '🍽️'
	};
	return emojis[type] || emojis.general;
}

/**
 * 要求タイプに応じたメッセージを取得
 */
function getRequestTypeMessage(type: UserRequest['type']): string {
	const messages = {
		diverse: '多様な料理を分析中...',
		light: 'あっさりした料理を分析中...',
		hearty: 'がっつりした料理を分析中...',
		different: '前回とは違う料理を分析中...',
		general: '最適な料理を分析中...'
	};
	return messages[type] || messages.general;
}

// 旧関数（後方互換性のため一時的に保持）
async function handleRecommendationRequest(userId: string, replyToken: string, user: any, env: Env, ctx: ExecutionContext): Promise<void> {
	// 統合関数にリダイレクト
	console.log('⚠️ Legacy function called, redirecting to unified handler...');
	await handleUnifiedRecommendationRequest(userId, replyToken, 'おすすめ', user, env, ctx);
}

/**
 * バックグラウンドで推薦を生成してユーザーに送信
 */
async function generateAndSendRecommendations(
	userId: string,
	sessionId: string,
	userRequest: UserRequest,
	avoidanceStrategy: any,
	user: any,
	env: Env,
	agent: RecommendationAgent
): Promise<void> {
	try {
		console.log(`🔄 generateAndSendRecommendations START for user: ${userId}, session: ${sessionId}`);
		
		// 1. コンテキスト構築
		const context = await buildRecommendationContext(userId, user, userRequest, avoidanceStrategy, env);
		
		// 2. エージェント機能で多様性を確保した推薦生成
		const recommendations = await agent.generateDiverseRecommendations(context);
		console.log(`✅ Generated ${recommendations.length} recommendations: ${recommendations.map(r => r.dishName).join(', ')}`);
		
		// 3. セッション更新（提案履歴を記録）
		await agent.updateSession(sessionId, recommendations, context);
		console.log(`📝 Session updated with new recommendations`);
		
		// 4. 再提案では既に詳細な推薦文が生成されているのでそのまま使用
		const detailedResponse = recommendations[0].userFeedback || 'エラーが発生しました';
		const quickReplyButtons = createRecommendationQuickReply();
		await sendLineMessageWithQuickReply(userId, detailedResponse, quickReplyButtons, env);
		console.log(`✅ Recommendations sent to user ${userId}`);
		
	} catch (error) {
		console.error('Background recommendation generation failed:', error);
		await sendLineMessage(userId, '申し訳ございません。推薦の生成に失敗しました。しばらく後に再度お試しください。', env);
	}
}

// 旧Background async function（後方互換性のため一時的に保持）
async function generateRecommendationsAsync(userId: string, user: any, env: Env): Promise<void> {
	try {
		console.log(`🔄 generateRecommendationsAsync START for user: ${userId} (legacy function)`);
		const recommendations = await generateRecommendations(userId, user, env);
		console.log('📤 Sending recommendations to user...');
		await sendLineMessage(userId, recommendations, env);
		console.log('✅ generateRecommendationsAsync COMPLETE');
	} catch (error) {
		console.error('❌ generateRecommendationsAsync error:', error);
		await sendLineMessage(userId, '🤖 AI分析完了できませんでした\n\n📝 本日の簡易提案：\n1. **豚肉と野菜炒め** - 手軽で栄養バランス◎\n2. **鮭のムニエル** - あっさり美味しい\n3. **カレーライス** - 定番で安心\n\n詳しいレシピが必要でしたら「1」などの番号を送信してください！', env);
		console.log('📤 Fallback message sent');
	}
}

async function handleRecipeRequest(userId: string, replyToken: string, messageText: string, env: Env, ctx: ExecutionContext): Promise<void> {
	try {
		console.log(`🍳 Recipe request from user ${userId}: "${messageText}"`);
		
		// 即座にレスポンス
		await sendLineReply(replyToken, '🍳 レシピを準備中です...\n30秒以内にお送りします！', env);
		
		let dishName = '';
	
		if (messageText.match(/^[1-3]$/)) {
			// User selected a number, get from recent recommendations
			try {
				const selectedIndex = parseInt(messageText) - 1; // 0-indexed
				
				// Get the latest session for this user with timeout
				const agent = new RecommendationAgent(env.DB, env.OPENAI_API_KEY, PROMPTS, renderPrompt);
				
				const sessionPromise = agent.getCurrentSession(userId);
				const sessionTimeout = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Session query timeout after 5s')), 5000)
				);
				
				const sessionId = await Promise.race([sessionPromise, sessionTimeout]) as string;
				
				// Get recent recommendations from this session with timeout
				const recommendationPromise = env.DB.prepare(`
					SELECT dish_name FROM recommended_dishes 
					WHERE session_id = ? 
					ORDER BY recommendation_order ASC, recommended_at DESC 
					LIMIT 3
				`).bind(sessionId).all();
				
				const recommendationTimeout = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Recommendation query timeout after 5s')), 5000)
				);
				
				const recentRecommendations = await Promise.race([recommendationPromise, recommendationTimeout]) as any;
				
				const dishes = (recentRecommendations.results as any[]) || [];
				if (dishes.length > selectedIndex) {
					dishName = dishes[selectedIndex].dish_name;
				} else {
					dishName = `候補${messageText}`; // Fallback
				}
				
			} catch (error) {
				console.error('Failed to get recommended dish:', error);
				dishName = `候補${messageText}`; // Fallback
			}
		} else {
			// Extract dish name from message using OpenAI
			const extractedDish = await extractDishFromMessage(messageText, env);
			dishName = extractedDish || '選択された料理';
		}
		
		console.log(`🍳 Generating recipe for: ${dishName}`);
		
		// バックグラウンドでレシピ生成
		ctx.waitUntil(
			generateAndSendRecipe(userId, dishName, env)
		);
		
		
	} catch (error) {
		console.error('❌ Recipe request failed:', error);
		await sendLineMessage(userId, '申し訳ございません。レシピの生成に失敗しました。もう一度お試しください。', env);
	}
}

/**
 * バックグラウンドでレシピを生成してユーザーに送信
 */
async function generateAndSendRecipe(userId: string, dishName: string, env: Env): Promise<void> {
	try {
		console.log(`🍳 Background recipe generation for: ${dishName}`);
		const recipe = await generateRecipe(dishName, env);
		await sendLineMessage(userId, recipe, env);
		
		// Save as decided meal with timeout protection
		try {
			const today = new Date().toISOString().split('T')[0];
			const savePromise = env.DB.prepare(`
				INSERT INTO meals (user_id, ate_date, dish, decided)
				VALUES (?, ?, ?, 1)
			`).bind(userId, today, dishName).run();
			
			const saveTimeout = new Promise((_, reject) => 
				setTimeout(() => reject(new Error('Save meal timeout after 5s')), 5000)
			);
			
			await Promise.race([savePromise, saveTimeout]);
			console.log(`✅ Recipe sent and meal recorded: ${dishName}`);
		} catch (saveError) {
			console.error('Failed to save meal record:', saveError);
		}
		
	} catch (error) {
		console.error('Background recipe generation failed:', error);
		await sendLineMessage(userId, `申し訳ございません。${dishName}のレシピ生成に失敗しました。もう一度お試しください。`, env);
	}
}

/**
 * 推薦コンテキストを構築
 */
async function buildRecommendationContext(
	userId: string, 
	user: any, 
	userRequest: UserRequest, 
	avoidanceStrategy: any, 
	env: Env
): Promise<RecommendationContext> {
	// 最近の食事履歴を取得
	let recentMeals = [];
	let preferredDishes = [];
	try {
		const mealResult = await env.DB.prepare(`
			SELECT dish, rating, mood, ate_date 
			FROM meals 
			WHERE user_id = ? AND ate_date >= date('now', '-14 days')
			ORDER BY ate_date DESC 
			LIMIT 10
		`).bind(userId).all();
		
		recentMeals = (mealResult.results as any[]) || [];
		// 高評価料理を分析（初回提案と同じロジック）
		preferredDishes = recentMeals.filter((m: any) => m.rating >= 4).map((m: any) => m.dish);
		console.log(`📊 Retrieved ${recentMeals.length} recent meals, ${preferredDishes.length} preferred dishes for user ${userId}`);
	} catch (error) {
		console.error('Failed to get recent meals:', error);
	}
	
	// 天気情報を取得
	let weather = undefined;
	try {
		weather = await getWeatherData(env);
		console.log(`🌤️ Weather data retrieved: ${weather.temp}°C (体感${weather.feelsLike}°C), ${weather.description}, ${weather.season}`);
	} catch (error) {
		console.error('Failed to get weather:', error);
	}
	
	return {
		user: {
			id: userId,
			allergies: user.allergies,
			dislikes: user.dislikes
		},
		recentMeals,
		preferredDishes,
		previousRecommendations: [], // セッションから取得が必要
		userRequest,
		weather,
		avoidanceStrategy
	};
}

/**
 * 詳細な推薦テキストを生成（初回と同じ詳細形式）
 */
async function generateDetailedRecommendationText(recommendations: RecommendedDish[], userRequest: UserRequest, env: Env): Promise<string> {
	try {
		// 推薦情報を整理
		const dishNames = recommendations.map(r => r.dishName).join(', ');
		const genres = recommendations.map(r => r.genre).join(', ');
		const ingredients = recommendations.map(r => r.mainIngredient).join(', ');
		
		const typeMessages = {
			diverse: '🎲 多様な料理をご提案します',
			light: '🥗 あっさりした料理をご提案します',
			hearty: '🍖 がっつりした料理をご提案します', 
			different: '✨ 前回とは違う料理をご提案します',
			general: '🍽️ おすすめの料理をご提案します'
		};
		
		const header = typeMessages[userRequest.type] || typeMessages.general;
		
		// OpenAIで詳細説明を生成
		const prompt = `以下の3つの料理について、それぞれ魅力的で詳細な説明文を作成してください。

料理名: ${dishNames}
ジャンル: ${genres}
主要食材: ${ingredients}
要求タイプ: ${userRequest.type}

各料理について以下の形式で出力してください：
1. **[料理名]** - [選んだ理由と魅力的な説明（30文字程度）]
2. **[料理名]** - [選んだ理由と魅力的な説明（30文字程度）]
3. **[料理名]** - [選んだ理由と魅力的な説明（30文字程度）]

説明は具体的で食欲をそそる内容にしてください。`;

		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [{ role: 'user', content: prompt }],
				max_tokens: 400,
				temperature: 0.7,
			}),
		});

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.status}`);
		}

		const data = await response.json() as any;
		const detailedList = data.choices[0].message.content;
		
		return `${header}\n\n${detailedList}\n\n番号を選択するとレシピを確認できます！`;
		
	} catch (error) {
		console.error('Failed to generate detailed recommendation text:', error);
		// フォールバック: シンプル形式
		return formatDetailedRecommendationResponse(recommendations, userRequest);
	}
}

/**
 * 詳細な推薦レスポンスをフォーマット（フォールバック用）
 */
function formatDetailedRecommendationResponse(recommendations: RecommendedDish[], userRequest: UserRequest): string {
	const typeHeaders = {
		diverse: '🎲 **多様な料理をご提案します**',
		light: '🥗 **あっさりした料理をご提案します**',
		hearty: '🍖 **がっつりした料理をご提案します**', 
		different: '✨ **前回とは違う料理をご提案します**',
		general: '🍽️ **今日のおすすめ夕食**'
	};
	
	const header = typeHeaders[userRequest.type] || typeHeaders.general;
	
	const dishList = recommendations.map((dish, index) => 
		`${index + 1}. **${dish.dishName}** - ${dish.userFeedback || `${dish.genre}の${dish.mainIngredient}を使った${dish.cookingMethod}料理`}`
	).join('\n\n');
	
	return `${header}\n\n${dishList}\n\n番号を選択するとレシピを確認できます！`;
}

/**
 * クイックリプライ付きでLINEメッセージを送信
 */
async function sendLineMessageWithQuickReply(userId: string, message: string, quickReplyItems: any[], env: Env): Promise<void> {
	try {
		const response = await fetch('https://api.line.me/v2/bot/message/push', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				to: userId,
				messages: [
					{
						type: 'text',
						text: message,
						quickReply: {
							items: quickReplyItems
						}
					}
				]
			})
		});

		if (!response.ok) {
			throw new Error(`LINE API error: ${response.status} ${response.statusText}`);
		}
		
		console.log('✅ LINE message with quick reply sent successfully');
	} catch (error) {
		console.error('Failed to send LINE message with quick reply:', error);
		// フォールバック: 通常のメッセージとして送信
		await sendLineMessage(userId, message, env);
	}
}

/**
 * 推薦後のクイックリプライボタンを作成
 */
function createRecommendationQuickReply(): any[] {
	return [
		{
			type: 'action',
			action: {
				type: 'message',
				label: 'レシピ①',
				text: '1'
			}
		},
		{
			type: 'action',
			action: {
				type: 'message',
				label: 'レシピ②',
				text: '2'
			}
		},
		{
			type: 'action',
			action: {
				type: 'message',
				label: 'レシピ③',
				text: '3'
			}
		},
		{
			type: 'action',
			action: {
				type: 'message',
				label: '他の提案を見る',
				text: '他の提案を見る'
			}
		}
	];
}

/**
 * シンプルな推薦レスポンスをフォーマット（旧形式）
 */
function formatRecommendationResponse(recommendations: string[], userRequest: UserRequest): string {
	const typeMessages = {
		diverse: '🎲 多様な料理をご提案します',
		light: '🥗 あっさりした料理をご提案します',
		hearty: '🍖 がっつりした料理をご提案します', 
		different: '✨ 前回とは違う料理をご提案します',
		general: '🍽️ おすすめの料理をご提案します'
	};
	
	const header = typeMessages[userRequest.type] || typeMessages.general;
	const dishList = recommendations.map((dish, index) => `${index + 1}. ${dish}`).join('\n');
	
	return `${header}\n\n${dishList}\n\n番号を選択するとレシピを確認できます！`;
}

async function handleGeneralMessage(replyToken: string, messageText: string, env: Env): Promise<void> {
	// アレルギーや設定関連のキーワードが含まれている場合は設定案内
	if (messageText.includes('アレルギー') || messageText.includes('設定') || messageText.includes('嫌い') || messageText.includes('苦手')) {
		await sendLineReply(replyToken, 
			'⚙️ 設定に関するお問い合わせですね！\n\n' +
			'• 初期設定：「/setup」\n' +
			'• 海産物アレルギー：「アレルギー 海産物」\n' +
			'• 嫌いな食材：「嫌いな食材 そら豆、インゲン豆」\n' +
			'• 使い方確認：「使い方」\n\n' +
			'と送信してください。',
			env
		);
	} else {
		// 一般メッセージへの応答
		await sendLineReply(replyToken, 
			'メッセージを受け取りました。\n\n' +
			'📝 食事記録：⭐ で評価と一緒に投稿\n' +
			'🍽️ 料理提案：「おすすめ教えて」\n' +
			'❓ 使い方：「使い方」\n\n' +
			'お気軽にお声かけください！',
			env
		);
	}
}

async function sendDailyRecommendations(env: Env): Promise<void> {
	console.log('🕐 sendDailyRecommendations START');
	
	try {
		const users = await getAllUsers(env);
		console.log(`👥 Found ${users.length} total users`);
		
		const invitedUsers = users.filter(user => user.invited);
		console.log(`✅ Found ${invitedUsers.length} invited users`);
		
		if (invitedUsers.length === 0) {
			console.log('⚠️ No invited users found - skipping daily recommendations');
			return;
		}
		
		for (const user of invitedUsers) {
			try {
				console.log(`📤 Sending recommendations to user: ${user.id}`);
				const recommendations = await generateRecommendations(user.id, user, env);
				await sendLineMessage(user.id, recommendations, env);
				console.log(`✅ Successfully sent recommendations to ${user.id}`);
			} catch (error) {
				console.error(`❌ Failed to send recommendations to ${user.id}:`, error);
			}
		}
		
		console.log('🕐 sendDailyRecommendations COMPLETE');
	} catch (error) {
		console.error('❌ sendDailyRecommendations FAILED:', error);
	}
}

// Database functions with timeout protection
async function getUser(userId: string, env: Env): Promise<any> {
	try {
		console.log(`🗄️ getUser START for userId: ${userId}`);
		console.log('🔗 Preparing D1 query...');
		
		// Add timeout protection (10 seconds)
		const queryPromise = env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
		const timeoutPromise = new Promise((_, reject) => 
			setTimeout(() => reject(new Error('D1 query timeout after 10s')), 10000)
		);
		
		console.log('⚡ Executing D1 query with timeout...');
		const result = await Promise.race([queryPromise, timeoutPromise]);
		console.log(`✅ getUser COMPLETE - result: ${result ? 'found' : 'not found'}`);
		return result;
	} catch (error) {
		console.error(`❌ getUser ERROR for ${userId}:`, error);
		// Return null if query fails to allow fallback behavior
		return null;
	}
}

async function getAllUsers(env: Env): Promise<any[]> {
	const result = await env.DB.prepare('SELECT * FROM users WHERE invited = 1').all();
	return result.results || [];
}

async function saveMealRecord(userId: string, mealData: any, env: Env): Promise<void> {
	const today = new Date().toISOString().split('T')[0];
	
	for (const dish of mealData.dishes) {
		await env.DB.prepare(`
			INSERT INTO meals (user_id, ate_date, dish, tags, rating, mood, decided)
			VALUES (?, ?, ?, ?, ?, ?, 1)
		`).bind(
			userId,
			today,
			dish,
			JSON.stringify(mealData.tags || []),
			mealData.rating,
			mealData.mood
		).run();
	}
}

// OpenAI functions
async function extractMealData(text: string, env: Env): Promise<any> {
	const prompt = `Extract meal information from this text: "${text}"
	
Return a JSON object with:
- dishes: array of dish names
- rating: number 1-5 (from stars)
- mood: mood keyword
- tags: array of cuisine tags

Example: {"dishes": ["豚バラ大根", "味噌汁"], "rating": 3, "mood": "満足", "tags": ["和食"]}`;

	try {
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{ role: 'system', content: 'Extract dishes, rating (★1-5), mood keyword. Return pure JSON.' },
					{ role: 'user', content: prompt }
				],
				temperature: 0.1,
			}),
		});

		const data = await response.json() as any;
		if (!data.choices?.[0]?.message?.content) {
			throw new Error('Invalid OpenAI response');
		}
		return JSON.parse(data.choices[0].message.content);
	} catch (error) {
		console.error('OpenAI extraction error:', error);
		return null;
	}
}

async function generateRecommendations(userId: string, user: any, env: Env): Promise<string> {
	try {
		console.log(`🚀 generateRecommendations START for user: ${userId}`);
		
		// Skip redundant user data retrieval - use passed user data
		console.log('📊 Using existing user data...');
		if (!user) {
			console.log('⚠️ No user data provided, proceeding without user preferences');
		} else {
			console.log('✅ User data available');
		}
		
		// Get focused meal history (restored with ctx.waitUntil() fix)
		console.log('📝 Querying meal history with timeout protection...');
		let recentMeals;
		try {
			const mealQueryPromise = env.DB.prepare(`
				SELECT dish, rating, mood, ate_date FROM meals 
				WHERE user_id = ? AND ate_date >= date('now', '-14 days')
				ORDER BY ate_date DESC
			`).bind(userId).all();
			
			const mealTimeoutPromise = new Promise((_, reject) => 
				setTimeout(() => reject(new Error('Meal query timeout after 8s')), 8000)
			);
			
			recentMeals = await Promise.race([mealQueryPromise, mealTimeoutPromise]) as any;
			console.log(`✅ Meal history retrieved: ${(recentMeals as any)?.results?.length || 0} records`);
		} catch (error) {
			console.error('❌ Meal history query failed:', error);
			// Fallback to mock data if D1 query fails
			recentMeals = {
				results: [
					{ dish: 'ハンバーグ', rating: 4, mood: '満足', ate_date: '2025-06-05' },
					{ dish: 'カレーライス', rating: 3, mood: '普通', ate_date: '2025-06-04' },
					{ dish: '焼き魚', rating: 5, mood: '美味しい', ate_date: '2025-06-03' }
				]
			};
			console.log('⚠️ Using mock meal history as fallback');
		}
		
		// Original query (commented out for testing)
		/*
		let recentMeals;
		try {
			const mealQueryPromise = env.DB.prepare(`
				SELECT dish, rating, mood, ate_date FROM meals 
				WHERE user_id = ? AND ate_date >= date('now', '-14 days')
				ORDER BY ate_date DESC
			`).bind(userId).all();
			
			const mealTimeoutPromise = new Promise((_, reject) => 
				setTimeout(() => reject(new Error('Meal query timeout after 8s')), 8000)
			);
			
			recentMeals = await Promise.race([mealQueryPromise, mealTimeoutPromise]) as any;
			console.log(`✅ Meal history retrieved: ${(recentMeals as any)?.results?.length || 0} records`);
		} catch (error) {
			console.error('❌ Meal history query failed:', error);
			recentMeals = { results: [] }; // Fallback to empty results
			console.log('⚠️ Using empty meal history as fallback');
		}
		*/

		// Get weather data
		console.log('🌤️ Getting Tokyo weather data...');
		const weather = await getWeatherData(env);
		console.log(`✅ Weather data ready: ${weather.temp}°C, ${weather.description}`);
		
		// Analyze meal patterns
		console.log('🧠 Analyzing meal patterns...');
		const mealHistory = recentMeals.results || [];
		const recentDishes = mealHistory.slice(0, 7).map((m: any) => m.dish);
		console.log(`✅ Analysis complete - ${recentDishes.length} recent dishes`);
		
		// Enhanced personalized prompt
		console.log('📝 Preparing personalized OpenAI prompt...');
		const recentList = recentDishes.slice(0, 5).join(', ');
		
		// Analyze user preferences from meal history
		const highRatedMeals = mealHistory.filter((m: any) => m.rating >= 4).map((m: any) => m.dish);
		const preferredDishes = highRatedMeals.slice(0, 3).join(', ');
		
		// Build comprehensive prompt
		const prompt = `あなたは夕食レコメンド専門AIです。以下の情報を基に、バラエティに富んだ3つの夕食を提案してください。

【ユーザー情報】
- 最近食べた料理（避ける）: ${recentList}
- 高評価だった料理（参考に）: ${preferredDishes || '情報なし'}
- アレルギー: ${user?.allergies || '情報なし'}
- 嫌いな食材: ${user?.dislikes || '情報なし'}

【環境情報】
- 今日の気温: ${weather.temp}°C
- 天気: ${weather.description}

【提案要件】
- 3つの料理は異なるジャンル（和食・洋食・中華など）にする
- アレルギーと嫌いな食材は絶対に避ける
- 気温に適した料理を選ぶ
- バリエーション豊かな提案をする

フォーマット:
1. **[料理名]** - [選んだ理由]
2. **[料理名]** - [選んだ理由]  
3. **[料理名]** - [選んだ理由]

詳しいレシピが必要な場合は番号を送信してください。`;
		console.log('✅ Prompt ready');

		console.log('🤖 Calling OpenAI API...');
		
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{ 
						role: 'system', 
						content: 'あなたは料理とグルメに詳しい夕食レコメンド専門AIです。ユーザーの好み、アレルギー、食事履歴、天気を考慮してパーソナライズされた提案をしてください。毎回異なるバラエティ豊かな料理を提案することが重要です。' 
					},
					{ role: 'user', content: prompt }
				],
				temperature: 0.7,
				max_tokens: 300,
			}),
		});
		console.log('✅ OpenAI API response received!');
		console.log(`✅ OpenAI API response received (status: ${response.status})`);

		// Check if response is ok before parsing
		if (!response.ok) {
			const errorText = await response.text();
			console.error(`❌ OpenAI API error: ${response.status} - ${errorText}`);
			throw new Error(`OpenAI API error: ${response.status}`);
		}
		
		const data = await response.json() as any;
		console.log('📋 Parsing OpenAI response...');
		console.log(`📊 Response data keys: ${Object.keys(data).join(', ')}`);
		
		if (!data.choices?.[0]?.message?.content) {
			console.error('❌ Invalid OpenAI response structure:', JSON.stringify(data));
			throw new Error('Invalid OpenAI response structure');
		}
		
		console.log('🎉 generateRecommendations COMPLETE');
		return data.choices[0].message.content;
		
	} catch (error) {
		console.error('Recommendation generation error:', error);
		return `🍽️ レコメンド生成エラー

申し訳ございません。AI分析中にエラーが発生しました。

📝 緊急提案：
1. **冷しゃぶサラダ** - 暑い日にさっぱり
2. **チキン南蛮** - ボリューム満点
3. **冷製パスタ** - 夏らしく軽やか

再度「おすすめ教えて」と送信してください。`;
	}
}

// LINE Messaging API
async function sendLineMessage(userId: string, message: string, env: Env): Promise<void> {
	try {
		const response = await fetch('https://api.line.me/v2/bot/message/push', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				to: userId,
				messages: [
					{
						type: 'text',
						text: message
					}
				]
			}),
		});
		
		if (!response.ok) {
			throw new Error(`LINE API error: ${response.status} ${response.statusText}`);
		}
	} catch (error) {
		console.error('LINE message send error:', error);
	}
}

async function sendLineReply(replyToken: string, message: string, env: Env): Promise<void> {
	try {
		const response = await fetch('https://api.line.me/v2/bot/message/reply', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				replyToken: replyToken,
				messages: [
					{
						type: 'text',
						text: message
					}
				]
			}),
		});
		
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`LINE API error: ${response.status} ${response.statusText} - ${errorText}`);
		}
	} catch (error) {
		console.error('LINE reply send error:', error);
	}
}

// Weather API
async function getWeatherData(env: Env): Promise<any> {
	try {
		// Default to Tokyo coordinates
		const response = await fetch(
			`https://api.openweathermap.org/data/2.5/weather?lat=35.6762&lon=139.6503&appid=${env.OPENWEATHER_API_KEY}&units=metric&lang=ja`
		);
		const data = await response.json() as any;
		
		// 詳細な天気情報を取得
		const temp = Math.round(data.main.temp);
		const feelsLike = Math.round(data.main.feels_like);
		const humidity = data.main.humidity;
		const description = data.weather[0].description;
		const windSpeed = Math.round(data.wind?.speed || 0);
		
		// 季節情報を追加
		const season = getCurrentSeason();
		
		// 料理推薦用の天気コンテキストを生成
		const cookingContext = generateCookingWeatherContext(temp, description, season, humidity, feelsLike);
		
		return {
			temp,
			feelsLike,
			description,
			humidity,
			windSpeed,
			season,
			cookingContext
		};
	} catch (error) {
		console.error('Weather API error:', error);
		return { 
			temp: 20, 
			feelsLike: 20,
			description: '晴れ', 
			humidity: 60,
			windSpeed: 0,
			season: getCurrentSeason(),
			cookingContext: '快適な気候で、どんな料理でも楽しめる日です。'
		};
	}
}

/**
 * 現在の季節を取得
 */
function getCurrentSeason(): string {
	const month = new Date().getMonth() + 1; // 0-based to 1-based
	
	if (month >= 3 && month <= 5) return '春';
	if (month >= 6 && month <= 8) return '夏'; 
	if (month >= 9 && month <= 11) return '秋';
	return '冬';
}

/**
 * 料理推薦用の天気コンテキストを生成
 */
function generateCookingWeatherContext(temp: number, description: string, season: string, humidity: number, feelsLike: number): string {
	let context = `${season}の季節、`;
	
	// 気温による推薦
	if (temp <= 5) {
		context += '大変寒い日（温かい料理・スープ・鍋物がおすすめ）';
	} else if (temp <= 15) {
		context += '寒い日（温かい料理・煮込み料理がおすすめ）';
	} else if (temp <= 25) {
		context += '過ごしやすい日（様々な料理が楽しめる）';
	} else if (temp <= 30) {
		context += '暖かい日（さっぱりした料理がおすすめ）';
	} else {
		context += '暑い日（冷たい料理・あっさり系がおすすめ）';
	}
	
	// 天気による追加情報
	if (description.includes('雨')) {
		context += '、雨の日で温かい室内料理が良い';
	} else if (description.includes('雪')) {
		context += '、雪の日で体を温める料理が良い';
	} else if (description.includes('曇')) {
		context += '、曇りで落ち着いた雰囲気';
	} else if (description.includes('晴')) {
		context += '、晴れて気分も明るい';
	}
	
	// 湿度による追加
	if (humidity > 80) {
		context += '、湿度が高くさっぱり系が良い';
	} else if (humidity < 30) {
		context += '、乾燥しているので水分の多い料理が良い';
	}
	
	return context;
}

async function extractDishFromMessage(text: string, env: Env): Promise<string | null> {
	try {
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{ role: 'system', content: 'Extract the dish name from user message. Return only the dish name.' },
					{ role: 'user', content: `Extract dish name from: "${text}"` }
				],
				temperature: 0.1,
			}),
		});

		const data = await response.json() as any;
		return data.choices[0].message.content.trim();
	} catch (error) {
		console.error('Dish extraction error:', error);
		return null;
	}
}

async function generateRecipe(dishName: string, env: Env): Promise<string> {
	try {
		console.log(`🍳 Generating recipe for: ${dishName}`);
		
		const recipePromise = fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{ role: 'system', content: 'Return ingredients list (name, qty) & numbered steps for requested dish, for 4 people.' },
					{ role: 'user', content: `${dishName}の4人分のレシピを教えて。材料と手順を分けて書いてください。` }
				],
				temperature: 0.3,
			}),
		});

		const recipeTimeout = new Promise((_, reject) => 
			setTimeout(() => reject(new Error('Recipe generation timeout after 20s')), 20000)
		);

		const response = await Promise.race([recipePromise, recipeTimeout]) as Response;

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.status}`);
		}

		const data = await response.json() as any;
		const recipe = data.choices[0].message.content;
		
		console.log('✅ Recipe generated, generating shopping list...');
		
		// Generate shopping list with timeout
		let shoppingList = '';
		try {
			shoppingList = await generateShoppingList(recipe, env);
		} catch (error) {
			console.error('Shopping list generation failed:', error);
			shoppingList = '買い物リストの生成に失敗しました。';
		}
		
		return `📝 ${dishName}のレシピ\n\n${recipe}\n\n🛒 買い物リスト\n${shoppingList}`;
	} catch (error) {
		console.error('Recipe generation error:', error);
		return `申し訳ございません。${dishName}のレシピ生成に失敗しました。\n\n簡易レシピ:\n基本的な${dishName}の作り方をお調べいただくか、もう一度お試しください。`;
	}
}

async function generateShoppingList(recipe: string, env: Env): Promise<string> {
	try {
		const shoppingPromise = fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{ role: 'system', content: 'Extract shopping list from recipe. Return as bullet points with quantities.' },
					{ role: 'user', content: `このレシピから買い物リストを作成してください：\n${recipe}` }
				],
				temperature: 0.1,
			}),
		});

		const shoppingTimeout = new Promise((_, reject) => 
			setTimeout(() => reject(new Error('Shopping list timeout after 15s')), 15000)
		);

		const response = await Promise.race([shoppingPromise, shoppingTimeout]) as Response;

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.status}`);
		}

		const data = await response.json() as any;
		return data.choices[0].message.content;
	} catch (error) {
		console.error('Shopping list generation error:', error);
		return '買い物リストの生成に失敗しました。レシピを参考に必要な材料をご確認ください。';
	}
}

async function verifyLineSignature(body: string, signature: string, channelSecret: string): Promise<boolean> {
	try {
		const crypto = (globalThis as any).crypto;
		const encoder = new TextEncoder();
		const secretKey = encoder.encode(channelSecret);
		const bodyBytes = encoder.encode(body);
		
		// Create HMAC-SHA256 signature
		const key = await crypto.subtle.importKey(
			'raw',
			secretKey,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		
		const signatureBuffer = await crypto.subtle.sign('HMAC', key, bodyBytes);
		
		// Convert to base64
		const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
		
		const receivedSignature = signature.replace('sha256=', '');
		return base64Signature === receivedSignature;
	} catch (error) {
		console.error('Signature verification error:', error);
		return false;
	}
}

async function createUser(userId: string, env: Env): Promise<void> {
	await env.DB.prepare(`
		INSERT INTO users (id, invited, created_at)
		VALUES (?, 0, CURRENT_TIMESTAMP)
	`).bind(userId).run();
}

async function inviteUser(userId: string, env: Env): Promise<void> {
	await env.DB.prepare(`
		UPDATE users SET invited = 1 WHERE id = ?
	`).bind(userId).run();
}