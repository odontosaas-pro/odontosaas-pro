// =============================================
// WEBHOOK ROUTES — Evolution API
// =============================================
import { Router } from 'express';
import { adicionarNaFila } from '../jobs/queue.js';
import { extrairNumero } from '../services/evolution.service.js';
import { getTenant } from '../services/supabase.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// POST /api/webhook/whatsapp/:tenantId
router.post('/whatsapp/:tenantId', async (req, res) => {
  // Responder 200 imediatamente (Evolution API não gosta de timeout)
  res.status(200).json({ received: true });

  const { tenantId } = req.params;
  const payload = req.body;

  try {
    // Filtrar apenas mensagens recebidas (não enviadas pelo sistema)
    const evento = payload.event || payload.type;
    if (evento !== 'MESSAGES_UPSERT' && evento !== 'messages.upsert') return;

    const mensagemData = payload.data || payload;
    const msgObj = mensagemData.message || mensagemData.messages?.[0];
    if (!msgObj) return;

    // Ignorar mensagens próprias
    if (msgObj.key?.fromMe || mensagemData.key?.fromMe) return;

    // Ignorar grupos
    const remoteJid = msgObj.key?.remoteJid || mensagemData.key?.remoteJid || '';
    if (remoteJid.includes('@g.us')) return;

    // Extrair texto da mensagem
    const mensagem = extrairTextoMensagem(msgObj);
    if (!mensagem || mensagem.trim().length === 0) return;

    const numero = extrairNumero(remoteJid);
    const nomeContato = msgObj.pushName || mensagemData.pushName || null;

    logger.info(`[Webhook] Nova mensagem de ${numero} (tenant: ${tenantId}): "${mensagem.substring(0, 50)}..."`);

    // Adicionar na fila para processamento assíncrono
    const prioridade = /emergência|urgente|dor|urgent/i.test(mensagem) ? 1 : 0;
    await adicionarNaFila({ tenantId, numero, mensagem, nomeContato }, prioridade);

  } catch (err) {
    logger.error('[Webhook] Erro ao processar webhook:', err.message);
  }
});

function extrairTextoMensagem(msgObj) {
  const msg = msgObj.message || msgObj;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.buttonsResponseMessage?.selectedDisplayText ||
    msg.listResponseMessage?.title ||
    msg.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  );
}

export default router;
