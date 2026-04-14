// =============================================
// ANTI-HIBERNAÇÃO RENDER — 3 Camadas
// =============================================
import cron from 'node-cron';
import axios from 'axios';
import { logger } from '../utils/logger.js';

export function startKeepalive() {
  const appUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;

  // CAMADA 1: Self-ping a cada 10 minutos
  cron.schedule('*/10 * * * *', async () => {
    try {
      const start = Date.now();
      const res = await axios.get(`${appUrl}/health`, { timeout: 8000 });
      const ms = Date.now() - start;
      logger.debug(`[Keepalive] Self-ping OK (${ms}ms) — status: ${res.data?.status}`);
    } catch (err) {
      logger.warn(`[Keepalive] Self-ping falhou: ${err.message}`);
    }
  });

  // CAMADA 2: Ping externo (backup) — se UPTIME_PING_URL configurado
  if (process.env.UPTIME_PING_URL) {
    cron.schedule('*/7 * * * *', async () => {
      try {
        await axios.get(process.env.UPTIME_PING_URL, { timeout: 5000 });
      } catch {}
    });
  }

  logger.info(`[Keepalive] Anti-hibernação ativo — pingando ${appUrl}/health a cada 10min`);
}
