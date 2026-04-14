// =============================================
// HEALTH ROUTES — Anti-hibernação + Monitoramento
// =============================================
import { Router } from 'express';
import { getRedis } from '../services/cache.service.js';
import { supabaseAdmin } from '../services/supabase.service.js';
import { getQueue } from '../jobs/queue.js';
import os from 'os';

const router = Router();

router.get('/', async (req, res) => {
  const inicio = Date.now();
  const checks = {};

  // Redis
  try {
    await getRedis().ping();
    checks.redis = 'ok';
  } catch { checks.redis = 'error'; }

  // Supabase
  try {
    await supabaseAdmin.from('tenants').select('count').limit(1);
    checks.database = 'ok';
  } catch { checks.database = 'error'; }

  // Fila
  try {
    const queue = getQueue();
    const waiting = queue ? await queue.getWaitingCount() : 0;
    checks.queue = { status: 'ok', waiting };
  } catch { checks.queue = 'error'; }

  const todasOk = Object.values(checks).every(v => v === 'ok' || v?.status === 'ok');

  res.status(todasOk ? 200 : 503).json({
    status: todasOk ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    latency_ms: Date.now() - inicio,
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    cpu_load: os.loadavg()[0].toFixed(2),
    checks,
    timestamp: new Date().toISOString()
  });
});

export default router;
