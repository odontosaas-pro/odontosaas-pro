// =============================================
// QUEUE — BullMQ para processamento WhatsApp
// =============================================
import { Queue, Worker } from 'bullmq';
import { getRedis } from '../services/cache.service.js';
import { processarMensagem } from '../agents/orchestrator.js';
import { logger } from '../utils/logger.js';

let whatsappQueue;
let worker;

export async function initQueues() {
  const connection = getRedis();

  whatsappQueue = new Queue('whatsapp-incoming', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 50
    }
  });

  worker = new Worker('whatsapp-incoming', async (job) => {
    const { tenantId, numero, mensagem, nomeContato } = job.data;
    logger.info(`[Queue] Processando mensagem de ${numero} para tenant ${tenantId}`);
    await processarMensagem({ tenantId, numero, mensagem, nomeContato });
  }, {
    connection,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 } // Rate limit: 10 msgs/s
  });

  worker.on('failed', (job, err) => {
    logger.error(`[Queue] Job ${job?.id} falhou:`, err.message);
  });

  worker.on('completed', (job) => {
    logger.debug(`[Queue] Job ${job.id} concluído`);
  });

  return { whatsappQueue, worker };
}

export async function adicionarNaFila(dados, prioridade = 0) {
  if (!whatsappQueue) throw new Error('Fila não inicializada');
  return whatsappQueue.add('processar-mensagem', dados, { priority: prioridade });
}

export function getQueue() {
  return whatsappQueue;
}
