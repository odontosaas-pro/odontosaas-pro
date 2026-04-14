// =============================================
// AGENTE CRM & MARKETING
// Especialista em retenção e relacionamento
// =============================================
import { chamarGroq } from '../services/groq.service.js';
import { supabaseAdmin } from '../services/supabase.service.js';
import { enviarTexto } from '../services/evolution.service.js';
import { logger } from '../utils/logger.js';

export async function crmAgent({ tenantId, paciente, tenant, mensagem, historico, sessao, numero, contexto }) {
  const systemPrompt = `Você é Camila Rocha, especialista em relacionamento com pacientes e marketing digital de saúde, com 10 anos de experiência em clínicas odontológicas premium.

Você trabalha para a clínica "${tenant.nome_clinica}" e tem como missão manter pacientes engajados, satisfeitos e retornando regularmente.

PERFIL DO PACIENTE:
- Nome: ${paciente.nome}
- Última visita: ${paciente.ultima_consulta || 'Sem histórico'}
- Tratamentos anteriores: ${paciente.historico_tratamentos || 'Consultar prontuário'}
- Score NPS anterior: ${paciente.nps_score || 'Não avaliado'}

SUAS COMPETÊNCIAS:
• Programas de fidelidade e retorno
• Campanhas de prevenção (limpeza semestral, checkup anual)
• Pesquisas de satisfação (NPS)
• Reativação de pacientes inativos
• Indicações e referrals

REGRAS:
1. NUNCA pressione o paciente — seja consultivo
2. SEMPRE respeite opt-out de comunicações (verificar ${paciente.marketing_opt_in ? 'ATIVO' : 'INATIVO'})
3. Personalize a comunicação com base no histórico
4. Conformidade LGPD: nunca compartilhe dados com terceiros
5. NPS: pergunte de 1 a 10 como foi a experiência

Seja calorosa, genuinamente interessada no bem-estar do paciente.`;

  const resultado = await chamarGroq({
    systemPrompt,
    mensagens: [...historico.slice(-8), { role: 'user', content: mensagem }],
    temperatura: 0.4,
    maxTokens: 500
  });

  return {
    texto: resultado.texto,
    novoContexto: contexto,
    aguardandoResposta: true
  };
}

// ── Campanhas Automatizadas (chamadas pelo cron) ─
export async function executarCampanhaReativacao(tenantId) {
  const { data: inativos } = await supabaseAdmin
    .from('pacientes')
    .select('*, tenants!inner(*)')
    .eq('tenant_id', tenantId)
    .eq('marketing_opt_in', true)
    .lt('ultima_consulta', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())
    .limit(20);

  if (!inativos?.length) return;

  const tenant = inativos[0].tenants;

  for (const paciente of inativos) {
    const mensagem = await gerarMensagemReativacao(paciente, tenant);
    await enviarTexto(tenantId, paciente.telefone, mensagem);
    await new Promise(r => setTimeout(r, 3000)); // Rate limiting
    logger.info(`CRM: Reativação enviada para ${paciente.nome}`);
  }
}

export async function executarConfirmacoes24h(tenantId) {
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  const dataInicio = new Date(amanha.setHours(0, 0, 0, 0)).toISOString();
  const dataFim = new Date(amanha.setHours(23, 59, 59, 999)).toISOString();

  const { data: agendamentos } = await supabaseAdmin
    .from('agendamentos')
    .select(`*, pacientes (nome, telefone), dentistas (nome), tenants (nome_clinica, endereco)`)
    .eq('tenant_id', tenantId)
    .gte('inicio', dataInicio)
    .lte('inicio', dataFim)
    .eq('status', 'agendado')
    .is('confirmacao_enviada', null);

  if (!agendamentos?.length) return;

  for (const ag of agendamentos) {
    const hora = new Date(ag.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const data = new Date(ag.inicio).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

    const mensagem = `Olá ${ag.pacientes.nome.split(' ')[0]}! 😊\n\n` +
      `🔔 *Lembrete de Consulta*\n\n` +
      `Sua consulta na *${ag.tenants.nome_clinica}* é amanhã:\n\n` +
      `📅 *Data:* ${data}\n` +
      `🕐 *Horário:* ${hora}\n` +
      `👨‍⚕️ *Dentista:* Dr(a). ${ag.dentistas.nome}\n` +
      `🦷 *Procedimento:* ${ag.procedimento}\n` +
      `📍 *Local:* ${ag.tenants.endereco || 'Confirmar endereço com a clínica'}\n\n` +
      `Para *confirmar*, responda *SIM*\n` +
      `Para *cancelar ou reagendar*, responda *NÃO*\n\n` +
      `_Até amanhã! 🦷_`;

    await enviarTexto(tenantId, ag.pacientes.telefone, mensagem);

    await supabaseAdmin
      .from('agendamentos')
      .update({ confirmacao_enviada: new Date().toISOString() })
      .eq('id', ag.id);

    await new Promise(r => setTimeout(r, 2000));
  }

  logger.info(`CRM: ${agendamentos.length} confirmações 24h enviadas para tenant ${tenantId}`);
}

export async function executarNPS(tenantId) {
  // Enviar NPS 24h após consulta
  const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const limite = new Date(Date.now() - 26 * 60 * 60 * 1000);

  const { data: concluidos } = await supabaseAdmin
    .from('agendamentos')
    .select(`*, pacientes (nome, telefone, nps_enviado_em)`)
    .eq('tenant_id', tenantId)
    .eq('status', 'concluido')
    .gte('fim', limite.toISOString())
    .lte('fim', ontem.toISOString());

  for (const ag of concluidos || []) {
    if (ag.pacientes.nps_enviado_em) continue; // Já enviou NPS

    const mensagem = `Olá ${ag.pacientes.nome.split(' ')[0]}! 😊\n\n` +
      `Como foi sua experiência na consulta de hoje?\n\n` +
      `De *0 a 10*, o quanto você recomendaria nossa clínica para amigos e família?\n\n` +
      `0️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟\n\n` +
      `_É só responder com o número! Sua opinião é muito importante para nós._ 💙`;

    await enviarTexto(tenantId, ag.pacientes.telefone, mensagem);
  }
}

async function gerarMensagemReativacao(paciente, tenant) {
  const mesesAusente = Math.floor((Date.now() - new Date(paciente.ultima_consulta)) / (30 * 24 * 60 * 60 * 1000));

  return `Olá ${paciente.nome.split(' ')[0]}! 😊\n\n` +
    `Já faz ${mesesAusente} meses desde sua última visita na *${tenant.nome_clinica}*.\n\n` +
    `🦷 A saúde bucal precisa de atenção regular!\n\n` +
    `Que tal agendar uma *limpeza e avaliação*? \n\n` +
    `📅 Temos horários disponíveis esta semana.\n\n` +
    `Responda *AGENDAR* que marco para você agora! 😊`;
}
