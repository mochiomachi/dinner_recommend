import { PROMPTS, renderPrompt, PromptVariables } from './prompts/index';

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
				
				const data = await response.json();
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

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		// Daily recommendation push at 14:00 JST
		ctx.waitUntil(sendDailyRecommendations(env));
	}
} satisfies ExportedHandler<Env>;

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
	} else if (messageText.includes('⭐') || messageText.includes('★')) {
		await handleMealInput(userId, replyToken, messageText, env);
	} else if (messageText.match(/^[1-3]$/) || messageText.includes('選ぶ') || messageText.includes('これ')) {
		await handleRecipeRequest(userId, replyToken, messageText, env);
	} else if (messageText.includes('おすすめ') || messageText.includes('レコメンド') || messageText.includes('提案')) {
		await handleRecommendationRequest(userId, replyToken, user, env, ctx);
	} else {
		await handleGeneralMessage(replyToken, messageText, env);
	}
}

async function handleSetupCommand(replyToken: string, env: Env): Promise<void> {
	const setupMessage = `設定を開始します。以下の情報を教えてください：

1. アレルギー（ある場合）
2. 嫌いな食材
3. 好きな料理ジャンル

例: "アレルギー: 卵、乳製品
嫌いな食材: セロリ、パクチー
好きなジャンル: 和食、イタリアン"`;

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
			else if (numbers.length > 0) rating = parseInt(numbers[0]);
			
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

async function handleRecommendationRequest(userId: string, replyToken: string, user: any, env: Env, ctx: ExecutionContext): Promise<void> {
	try {
		// Send immediate response
		await sendLineReply(replyToken, '🤖 AIが食事履歴を分析中...\n30秒以内にパーソナライズされたレコメンドをお送りします！', env);
		
		// Generate recommendations in background using ctx.waitUntil()
		console.log('🔧 Using ctx.waitUntil() for background processing...');
		ctx.waitUntil(generateRecommendationsAsync(userId, user, env));
		
	} catch (error) {
		console.error('handleRecommendationRequest error:', error);
		await sendLineMessage(userId, '申し訳ございません。レコメンド生成でエラーが発生しました。', env);
	}
}

// Background async function
async function generateRecommendationsAsync(userId: string, user: any, env: Env): Promise<void> {
	try {
		console.log(`🔄 generateRecommendationsAsync START for user: ${userId}`);
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

async function handleRecipeRequest(userId: string, replyToken: string, messageText: string, env: Env): Promise<void> {
	// Get the last recommended dish or extract dish name from message
	let dishName = '';
	
	if (messageText.match(/^[1-3]$/)) {
		// User selected a number, get from recent recommendations
		dishName = `候補${messageText}`;
	} else {
		// Extract dish name from message using OpenAI
		const extractedDish = await extractDishFromMessage(messageText, env);
		dishName = extractedDish || '選択された料理';
	}
	
	const recipe = await generateRecipe(dishName, env);
	await sendLineReply(replyToken, recipe, env);
	
	// Save as decided meal
	const today = new Date().toISOString().split('T')[0];
	await env.DB.prepare(`
		INSERT INTO meals (user_id, ate_date, dish, decided)
		VALUES (?, ?, ?, 1)
	`).bind(userId, today, dishName).run();
}

async function handleGeneralMessage(replyToken: string, messageText: string, env: Env): Promise<void> {
	// Update user mood or handle other general messages
	await sendLineReply(replyToken, 'メッセージを受け取りました。食事の記録は ⭐ を含めて投稿してください。', env);
}

async function sendDailyRecommendations(env: Env): Promise<void> {
	const users = await getAllUsers(env);
	
	for (const user of users) {
		if (user.invited) {
			try {
				const recommendations = await generateRecommendations(user.id, user, env);
				await sendLineMessage(user.id, recommendations, env);
			} catch (error) {
				console.error(`Failed to send recommendations to ${user.id}:`, error);
			}
		}
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
			
			recentMeals = await Promise.race([mealQueryPromise, mealTimeoutPromise]);
			console.log(`✅ Meal history retrieved: ${recentMeals.results?.length || 0} records`);
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
			
			recentMeals = await Promise.race([mealQueryPromise, mealTimeoutPromise]);
			console.log(`✅ Meal history retrieved: ${recentMeals.results?.length || 0} records`);
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
		return {
			description: data.weather[0].description,
			temp: Math.round(data.main.temp)
		};
	} catch (error) {
		console.error('Weather API error:', error);
		return { description: '晴れ', temp: 20 };
	}
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
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
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

		const data = await response.json() as any;
		const recipe = data.choices[0].message.content;
		
		// Generate shopping list
		const shoppingList = await generateShoppingList(recipe, env);
		
		return `📝 ${dishName}のレシピ\n\n${recipe}\n\n🛒 買い物リスト\n${shoppingList}`;
	} catch (error) {
		console.error('Recipe generation error:', error);
		return `申し訳ございません。${dishName}のレシピ生成に失敗しました。`;
	}
}

async function generateShoppingList(recipe: string, env: Env): Promise<string> {
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
					{ role: 'system', content: 'Extract shopping list from recipe. Return as bullet points with quantities.' },
					{ role: 'user', content: `このレシピから買い物リストを作成してください：\n${recipe}` }
				],
				temperature: 0.1,
			}),
		});

		const data = await response.json() as any;
		return data.choices[0].message.content;
	} catch (error) {
		console.error('Shopping list generation error:', error);
		return '買い物リストの生成に失敗しました。';
	}
}

async function verifyLineSignature(body: string, signature: string, channelSecret: string): Promise<boolean> {
	try {
		const crypto = globalThis.crypto;
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