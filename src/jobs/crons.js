// =============================================
// CRONS — Jobs agendados
// =============================================
import cron from 'node-cron';
import { supabaseAdmin } from '../services/supabase.service.js';
import { executarConfirmacoes24h, executarCampanhaReativacao, executarNPS } from '../agents/crm.agent.js';
import { logger } from '../utils/logger.js';

export async function startCrons() {
  // Confirmações 24h antes das consultas — todo dia às 17h
  cron.schedule('0 17 * * *', async () => {
    logger.info('[Cron] Iniciando envio de confirmações 24h...');
    const tenants = await getTenantAtivos();
    for (const tenant of tenants) {
      await executarConfirmacoes24h(tenant.id).catch(e =>
        logger.error(`[Cron] Erro confirmações tenant ${tenant.id}:`, e.message)
      );
    }
  }, { timezone: 'America/Sao_Paulo' });

  // NPS pós-consulta — todo dia às 10h e 16h
  cron.schedule('0 10,16 * * *', async () => {
    logger.info('[Cron] Enviando NPS...');
    const tenants = await getTenantAtivos();
    for (const tenant of tenants) {
      await executarNPS(tenant.id).catch(e =>
        logger.error(`[Cron] Erro NPS tenant ${tenant.id}:`, e.message)
      );
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Campanhas de reativação — toda segunda-feira às 9h
  cron.schedule('0 9 * * 1', async () => {
    logger.info('[Cron] Iniciando campanhas de reativação...');
    const tenants = await getTenantAtivos();
    for (const tenant of tenants) {
      await executarCampanhaReativacao(tenant.id).catch(e =>
        logger.error(`[Cron] Erro reativação tenant ${tenant.id}:`, e.message)
      );
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Relatório diário — todo dia às 8h
  cron.schedule('0 8 * * 1-5', async () => {
    logger.info('[Cron] Gerando relatórios diários...');
    await gerarRelatoriosDiarios();
  }, { timezone: 'America/Sao_Paulo' });

  // Alertas de estoque crítico — todo dia às 8h30
  cron.schedule('30 8 * * 1-5', async () => {
    await verificarEstoqueCritico();
  }, { timezone: 'America/Sao_Paulo' });

  logger.info('✅ Todos os crons registrados com sucesso');
}

async function getTenantAtivos() {
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('id, nome_clinica')
    .eq('ativo', true);
  return data || [];
}

async function gerarRelatoriosDiarios() {
  const tenants = await getTenantAtivos();
  for (const tenant of tenants) {
    try {
      const hoje = new Date().toISOString().split('T')[0];
      const { data: stats } = await supabaseAdmin.rpc('get_daily_stats', {
        p_tenant_id: tenant.id,
        p_data: hoje
      });
      logger.info(`[Relatório] ${tenant.nome_clinica}: ${JSON.stringify(stats)}`);
    } catch (e) {
      logger.warn(`[Relatório] Erro para ${tenant.nome_clinica}:`, e.message);
    }
  }
}

async function verificarEstoqueCritico() {
  const { data: criticos } = await supabaseAdmin
    .from('estoque')
    .select(`*, tenants (nome_clinica, email_admin)`)
    .filter('quantidade', 'lte', 'minimo_alerta');

  if (criticos?.length) {
    logger.warn(`[Estoque] ${criticos.length} item(ns) em nível crítico`);
    // TODO: enviar alerta por email/WhatsApp para admin da clínica
  }
}
