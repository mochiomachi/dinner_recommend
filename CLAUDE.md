# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Development
npm run dev          # Start local development server with Wrangler
npm run start        # Alias for dev

# Testing  
npm run test         # Run Vitest tests

# Deployment
npm run deploy       # Deploy to Cloudflare Workers

# Debugging
npm run logs         # View real-time logs

# Data Import
npm run import-sample-data  # Import sample meal data from CSV
```

## Architecture Overview

This is a **LINE Bot** for dinner recommendations built on **Cloudflare Workers** with TypeScript. The application:

- **Frontend**: LINE Messaging API webhook integration
- **Backend**: Single Cloudflare Worker (`src/index.ts`) handling all logic
- **Database**: Cloudflare D1 (SQLite) with `users` and `meals` tables
- **LLM**: OpenAI GPT-4o-mini for meal extraction, recommendations, and recipe generation
- **External APIs**: OpenWeather API for weather-based recommendations
- **Scheduling**: Cloudflare Cron Triggers for daily 14:00 JST recommendations

## Key Application Flow

1. **Daily Push**: Cron trigger at 14:00 JST sends recommendations to all invited users
2. **Meal Logging**: Users send messages like "⭐3 ハンバーグ美味しかった" → OpenAI extracts dish, rating, mood
3. **Recipe Generation**: Users select recommendations (1, 2, 3) → OpenAI generates recipes + shopping lists
4. **User Management**: Invitation system with codes before access

## Database Schema

- **users**: `id` (LINE userId), `name`, `allergies`, `dislikes`, `invited`, `created_at`
- **meals**: `id`, `user_id`, `ate_date`, `dish`, `tags`, `rating`, `mood`, `decided`, `created_at`

## Environment Setup

Required secrets (set via `wrangler secret put`):
- `OPENAI_API_KEY`
- `LINE_CHANNEL_SECRET` 
- `LINE_CHANNEL_ACCESS_TOKEN`
- `OPENWEATHER_API_KEY`

Database setup:
```bash
wrangler d1 create dinner-recommend-db
wrangler d1 execute dinner-recommend-db --file=./schema.sql
```

Update `database_id` in `wrangler.toml` after D1 creation.

## Testing Framework

Uses **Vitest** with `@cloudflare/vitest-pool-workers` for Cloudflare Workers testing environment. Tests cover webhook handling, signature verification, and utility functions.

## Core Functions Architecture

All logic is in `src/index.ts`:
- `fetch()`: Handles webhook routing (/webhook, /health)
- `scheduled()`: Cron trigger handler for daily recommendations
- `handleTextMessage()`: Main message processing logic with pattern matching
- OpenAI functions: `extractMealData()`, `generateRecommendations()`, `generateRecipe()`
- LINE API: `sendLineMessage()`, `verifyLineSignature()`
- Database helpers: `getUser()`, `saveMealRecord()`, etc.

## Japanese Language Context

This is a Japanese LINE Bot. All user interactions, OpenAI prompts, and responses are in Japanese. The bot handles Japanese food names, cooking terminology, and cultural preferences.

## Problem-Solving Guidelines

### Investigation Priority Framework
When encountering technical issues, follow this systematic approach:

1. **Technology-Specific Constraints First**
   - Research platform-specific limitations and best practices
   - Check official documentation for known issues
   - Understand runtime environment constraints

2. **Execution Context Analysis**
   - Compare working vs failing implementations
   - Identify differences in execution environment
   - Analyze synchronous vs asynchronous contexts

3. **Reference Implementation Study**
   - Find similar projects using the same tech stack
   - Study architectural patterns and solutions
   - Learn from community best practices

4. **Systematic Debugging**
   - Isolate variables step by step
   - Test minimal reproducible cases
   - Focus on differential analysis

### Cloudflare Workers Specific Guidelines

**Critical Requirements:**
- Use `ctx.waitUntil()` for ALL background/async operations that should complete
- Never use bare async calls without proper execution context management
- Background processes MUST be wrapped in ExecutionContext for completion guarantee

**Common Patterns:**
```typescript
// ❌ WRONG: Will be terminated by runtime
someAsyncFunction();

// ✅ CORRECT: Guaranteed to complete  
ctx.waitUntil(someAsyncFunction());
```

**D1 Database Considerations:**
- D1 queries can hang in certain execution contexts
- Always implement timeout protection for database operations
- Test database operations in isolation when debugging
- Consider fallback mechanisms for critical flows

### Lesson Learned: ctx.waitUntil() Issue
**Problem**: OpenAI API calls worked in test endpoints but hung in recommendation flow
**Root Cause**: Missing `ctx.waitUntil()` for background async operations
**Key Insight**: Success/failure pattern analysis revealed execution context differences
**Solution**: Proper ExecutionContext management with `ctx.waitUntil()`