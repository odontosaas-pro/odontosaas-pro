// =============================================
// ODONTOSAAS PRO — SERVER PRINCIPAL
// Node.js 20 ESM | Express | Anti-Hibernação
// =============================================
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createClient } from '@supabase/supabase-js';

import { logger } from './utils/logger.js';
import { initQueues } from './jobs/queue.js';
import { startCrons } from './jobs/crons.js';
import { startKeepalive } from './jobs/keepalive.job.js';
import { initCache } from './services/cache.service.js';

// Rotas
import webhookRoutes from './routes/webhook.routes.js';
import agendaRoutes from './routes/agenda.routes.js';
import authRoutes from './routes/auth.routes.js';
import healthRoutes from './routes/health.routes.js';
import { pacienteRouter, financeiroRouter, tenantRouter, adminRouter } from './routes/all.routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ── Segurança & Middlewares ──────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(compression());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.RENDER_EXTERNAL_URL, /\.odontosaaspro\.com\.br$/]
    : '*',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── SEO: Servir landing page estática ────────
app.use(express.static('public', {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// ── Rotas da API ─────────────────────────────
app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/agenda', agendaRoutes);
app.use('/api/pacientes', pacienteRouter);
app.use('/api/financeiro', financeiroRouter);
app.use('/api/tenants', tenantRouter);
app.use('/api/admin', adminRouter);

// ── 404 Handler ──────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ── Error Handler Global ─────────────────────
app.use((err, req, res, next) => {
  logger.error('Erro não tratado:', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// ── Inicialização com Warmup ─────────────────
async function bootstrap() {
  try {
    logger.info('🦷 OdontoSaaS Pro iniciando...');

    // 1. Inicializar cache Redis
    await initCache();
    logger.info('✅ Cache Redis conectado');

    // 2. Inicializar filas BullMQ
    await initQueues();
    logger.info('✅ Filas BullMQ prontas');

    // 3. Iniciar servidor HTTP
    app.listen(PORT, () => {
      logger.info(`✅ Servidor rodando na porta ${PORT}`);
    });

    // 4. Aguardar 3s para estabilização
    await new Promise(r => setTimeout(r, 3000));

    // 5. Iniciar crons (confirmações, CRM, relatórios)
    await startCrons();
    logger.info('✅ Crons agendados');

    // 6. Anti-hibernação Render — CAMADA 1
    startKeepalive();
    logger.info('✅ Anti-hibernação ativado');

    logger.info('🚀 OdontoSaaS Pro 100% operacional!');

  } catch (err) {
    logger.error('FATAL: Falha na inicialização', err);
    process.exit(1);
  }
}

bootstrap();

// ── Graceful Shutdown ────────────────────────
process.on('SIGTERM', () => {
  logger.info('SIGTERM recebido. Encerrando graciosamente...');
  process.exit(0);
});
