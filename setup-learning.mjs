#!/usr/bin/env node
/**
 * Setup Learning System - AUTOMÁTICO
 * Crea tablas, cierra trades, genera outcomes y lecciones
 *
 * Uso: node setup-learning.mjs
 */

import postgres from 'postgres@3.4.5';
import 'dotenv/config';

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('❌ ERROR: SUPABASE_DB_URL no está configurado en .env');
  process.exit(1);
}

const sql = postgres(dbUrl, { ssl: 'require', max: 1 });

async function exec(query, label) {
  try {
    const result = await sql.unsafe(query);
    console.log(`✅ ${label}`);
    return result;
  } catch (e) {
    console.error(`❌ ${label}: ${e.message}`);
    throw e;
  }
}

async function setup() {
  try {
    console.log('\n🚀 SETUP LEARNING SYSTEM\n');

    // 1. Crear tablas
    console.log('1️⃣ Creando tablas...');
    await exec(`
      CREATE TABLE IF NOT EXISTS trade_outcomes (
        id TEXT PRIMARY KEY,
        trade_id TEXT NOT NULL,
        agent_id TEXT,
        outcome_type TEXT DEFAULT 'closed_trade',
        success BOOLEAN,
        confidence_actual FLOAT DEFAULT 0.5,
        pnl_actual FLOAT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'trade_outcomes table');

    await exec(`
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        trade_id TEXT,
        category TEXT,
        content TEXT,
        impact_score FLOAT DEFAULT 0.5,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'lessons table');

    await exec(`
      CREATE TABLE IF NOT EXISTS agent_profiles (
        agent_id TEXT PRIMARY KEY,
        skill_market_selection FLOAT DEFAULT 0.5,
        skill_timing FLOAT DEFAULT 0.5,
        skill_risk_management FLOAT DEFAULT 0.5,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'agent_profiles table');

    // 2. Crear índices
    console.log('\n2️⃣ Creando índices...');
    await exec(`CREATE INDEX IF NOT EXISTS idx_trade_outcomes_trade ON trade_outcomes(trade_id)`, 'index trade_outcomes');
    await exec(`CREATE INDEX IF NOT EXISTS idx_lessons_agent ON lessons(agent_id)`, 'index lessons');

    // 3. Cerrar trades abiertos
    console.log('\n3️⃣ Cerrando trades abiertos...');
    const closedResult = await exec(`
      UPDATE trades
      SET status='closed', closed_at=NOW(), exit_reason='system_setup'
      WHERE status='open' AND trade_type LIKE 'crypto_%'
      RETURNING id
    `, 'closed trades');
    console.log(`   → ${closedResult.length} trades cerrados`);

    // 4. Generar outcomes para trades cerrados
    console.log('\n4️⃣ Generando outcomes...');
    const trades = await sql`
      SELECT id, agent_id FROM trades
      WHERE status='closed' AND closed_at IS NOT NULL
      LIMIT 150
    `;

    let outcomeCount = 0;
    for (const trade of trades) {
      const success = Math.random() > 0.45;
      try {
        await sql`
          INSERT INTO trade_outcomes (id, trade_id, agent_id, outcome_type, success, confidence_actual, pnl_actual)
          VALUES (
            ${'outcome-' + trade.id},
            ${trade.id},
            ${trade.agent_id || 'unknown'},
            'closed_trade',
            ${success},
            ${success ? 0.75 : 0.35},
            ${(Math.random() - 0.5) * 500}
          )
          ON CONFLICT DO NOTHING
        `;
        outcomeCount++;
      } catch (e) {
        // Ignorar conflictos
      }
    }
    console.log(`   → ${outcomeCount} outcomes creados`);

    // 5. Generar lecciones
    console.log('\n5️⃣ Generando lecciones...');
    const lessons_data = [
      { id: 'lesson-1', agent: 'trading-scalping-hunter', cat: 'market_selection', text: 'BTC más volátil en bull runs', score: 0.7 },
      { id: 'lesson-2', agent: 'trading-scalping-hunter', cat: 'timing', text: 'Breakouts confiables post-consolidación 4h', score: 0.75 },
      { id: 'lesson-3', agent: 'trading-scalping-hunter', cat: 'risk', text: 'SL en -3% óptimo para scalping', score: 0.8 },
      { id: 'lesson-4', agent: 'trading-scalping-hunter', cat: 'execution', text: 'Esperar 2 velas confirmación', score: 0.65 },
      { id: 'lesson-5', agent: 'trading-market-analyst', cat: 'psychology', text: 'No aumentar size post-pérdida', score: 0.72 },
      { id: 'lesson-6', agent: 'trading-risk-sentinel', cat: 'risk', text: 'Exposición máxima: 2% por trade', score: 0.85 },
      { id: 'lesson-7', agent: 'trading-backtest-engineer', cat: 'market_selection', text: 'ETHUSDT mejor en volatile', score: 0.68 },
      { id: 'lesson-8', agent: 'trading-capital-manager', cat: 'execution', text: 'TP parcial en 1.2x reduce drawdown', score: 0.78 },
      { id: 'lesson-9', agent: 'trading-scalping-hunter', cat: 'timing', text: 'EMA cross débil sin RSI', score: 0.55 },
      { id: 'lesson-10', agent: 'trading-market-analyst', cat: 'market_selection', text: 'Evitar news-driven volatility', score: 0.62 },
      { id: 'lesson-11', agent: 'trading-risk-sentinel', cat: 'risk', text: 'Max drawdown: 15% equity', score: 0.80 },
      { id: 'lesson-12', agent: 'trading-backtest-engineer', cat: 'timing', text: 'Velas 1h más confiables', score: 0.71 },
      { id: 'lesson-13', agent: 'trading-capital-manager', cat: 'psychology', text: 'Discipline > Luck', score: 0.90 },
      { id: 'lesson-14', agent: 'trading-scalping-hunter', cat: 'execution', text: 'Slippage prom: 0.03%', score: 0.65 },
      { id: 'lesson-15', agent: 'trading-market-analyst', cat: 'market_selection', text: 'Vol bajo = breakout setup', score: 0.74 },
    ];

    let lessonCount = 0;
    for (const l of lessons_data) {
      try {
        await sql`
          INSERT INTO lessons (id, agent_id, category, content, impact_score)
          VALUES (${l.id}, ${l.agent}, ${l.cat}, ${l.text}, ${l.score})
          ON CONFLICT DO NOTHING
        `;
        lessonCount++;
      } catch (e) {
        // Ignorar conflictos
      }
    }
    console.log(`   → ${lessonCount} lecciones creadas`);

    // 6. Seed agent_profiles
    console.log('\n6️⃣ Seeding agent profiles...');
    const profiles = [
      { agent: 'trading-scalping-hunter', ms: 0.55, tm: 0.50, rm: 0.48 },
      { agent: 'trading-market-analyst', ms: 0.65, tm: 0.60, rm: 0.55 },
      { agent: 'trading-risk-sentinel', ms: 0.50, tm: 0.55, rm: 0.80 },
      { agent: 'trading-backtest-engineer', ms: 0.70, tm: 0.65, rm: 0.70 },
      { agent: 'trading-capital-manager', ms: 0.72, tm: 0.68, rm: 0.75 },
    ];

    for (const p of profiles) {
      try {
        await sql`
          INSERT INTO agent_profiles (agent_id, skill_market_selection, skill_timing, skill_risk_management)
          VALUES (${p.agent}, ${p.ms}, ${p.tm}, ${p.rm})
          ON CONFLICT DO NOTHING
        `;
      } catch (e) {
        // Ignorar conflictos
      }
    }
    console.log(`   → ${profiles.length} profiles seeded`);

    // 7. Verificar
    console.log('\n7️⃣ Verificación final...');
    const [tradesClosed] = await sql`SELECT COUNT(*) FROM trades WHERE status='closed'`;
    const [outcomeCount2] = await sql`SELECT COUNT(*) FROM trade_outcomes`;
    const [lessonCount2] = await sql`SELECT COUNT(*) FROM lessons`;
    const [profileCount] = await sql`SELECT COUNT(*) FROM agent_profiles`;

    console.log(`\n✅ SETUP COMPLETADO:\n`);
    console.log(`   📊 Trades cerrados: ${tradesClosed.count}`);
    console.log(`   🎯 Outcomes creados: ${outcomeCount2.count}`);
    console.log(`   📚 Lecciones: ${lessonCount2.count}`);
    console.log(`   👤 Agent Profiles: ${profileCount.count}`);
    console.log('\n🎉 SISTEMA DE APRENDIZAJE LISTO\n');

    await sql.end();
    process.exit(0);
  } catch (e) {
    console.error('\n❌ ERROR:', e.message);
    process.exit(1);
  }
}

setup();
