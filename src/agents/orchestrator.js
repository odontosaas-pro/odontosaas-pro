// =============================================
// ORQUESTRADOR — Cérebro do Sistema
// Roteia para o agente especialista correto
// =============================================
import { classificarIntencao } from '../services/groq.service.js';
import { getSession, updateSession } from '../services/cache.service.js';
import { getTenant } from '../services/supabase.service.js';
import { findOrCreatePaciente, getConversaHistorico, salvarConversa, logAgentAudit } from '../services/supabase.service.js';
import { enviarTexto, enviarBotoes, simularDigitando } from '../services/evolution.service.js';

import { agendaAgent } from './agenda.agent.js';
import { consultaAgent } from './consulta.agent.js';
import { financeiroAgent } from './financeiro.agent.js';
import { crmAgent } from './crm.agent.js';
import { suporteAgent } from './suporte.agent.js';

import { logger } from '../utils/logger.js';

const AGENTES = {
  agendamento: agendaAgent,
  cancelamento: agendaAgent,
  confirmacao: agendaAgent,
  consulta_info: consultaAgent,
  financeiro: financeiroAgent,
  resultado_exame: consultaAgent,
  reclamacao: suporteAgent,
  saudacao: null, // tratado inline
  outros: suporteAgent
};

export async function processarMensagem({ tenantId, numero, mensagem, nomeContato }) {
  const sessaoId = `${tenantId}:${numero}`;

  try {
    // 1. Carregar dados do tenant
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      logger.warn(`Tenant ${tenantId} não encontrado`);
      return;
    }

    // 2. Buscar/criar paciente
    const paciente = await findOrCreatePaciente(tenantId, numero, nomeContato);

    // 3. Carregar sessão atual
    let sessao = await getSession(sessaoId) || {
      pacienteId: paciente.id,
      historico: [],
      agenteAtual: null,
      contexto: {},
      tentativas: 0
    };

    // 4. Adicionar mensagem ao histórico
    const historicoDB = await getConversaHistorico(sessaoId);
    const historico = [...historicoDB, { role: 'user', content: mensagem }].slice(-20);

    // 5. Simular "digitando..." para resposta humana
    await simularDigitando(tenantId, numero, 1500);

    // 6. Verificar se está em fluxo de agente específico
    if (sessao.agenteAtual && sessao.contexto.aguardandoResposta) {
      const agente = AGENTES[sessao.agenteAtual];
      if (agente) {
        const resultado = await agente({
          tenantId, paciente, tenant, mensagem, historico,
          sessao, numero, contexto: sessao.contexto
        });
        await finalizarResposta({ tenantId, numero, sessaoId, paciente, sessao, resultado, historico });
        return;
      }
    }

    // 7. Classificar intenção
    const contextoClinica = `
      Clínica: ${tenant.nome_clinica}
      Especialidades: ${tenant.especialidades?.join(', ') || 'Odontologia Geral'}
      Horário: ${tenant.horario_funcionamento || 'Seg-Sex 8h-18h'}
    `.trim();

    const classificacao = await classificarIntencao(mensagem, contextoClinica);
    logger.info(`[Orquestrador] Intenção: ${classificacao.intencao} (${(classificacao.confianca * 100).toFixed(0)}%)`);

    // 8. Saudação inicial
    if (classificacao.intencao === 'saudacao' || !sessao.apresentado) {
      const resposta = gerarBoasVindas(tenant, paciente, classificacao.intencao === 'saudacao');
      await enviarTexto(tenantId, numero, resposta.texto);
      if (resposta.botoes) {
        await new Promise(r => setTimeout(r, 800));
        await enviarBotoes(tenantId, numero, resposta.tituloBotoes, resposta.descricaoBotoes, resposta.botoes);
      }
      await updateSession(sessaoId, { ...sessao, apresentado: true, pacienteId: paciente.id });
      return;
    }

    // 9. Confidence threshold — escalar para humano se muito baixo
    if (classificacao.confianca < 0.55) {
      await enviarTexto(tenantId, numero,
        `Olá ${paciente.nome.split(' ')[0]}! 😊 Não entendi muito bem. Posso te ajudar com:\n\n` +
        `*1.* 📅 Agendar consulta\n` +
        `*2.* 💰 Informações financeiras\n` +
        `*3.* 🦷 Dúvidas sobre tratamentos\n` +
        `*4.* 👤 Falar com atendente\n\n` +
        `É só digitar o número da opção!`
      );
      return;
    }

    // 10. Rotear para agente especialista
    const agente = AGENTES[classificacao.intencao] || suporteAgent;
    const novoContexto = { ...sessao.contexto, ...classificacao.entidades, intencao: classificacao.intencao };

    const resultado = await agente({
      tenantId, paciente, tenant, mensagem, historico,
      sessao: { ...sessao, contexto: novoContexto },
      numero, contexto: novoContexto
    });

    await finalizarResposta({
      tenantId, numero, sessaoId, paciente,
      sessao: { ...sessao, agenteAtual: classificacao.intencao, contexto: novoContexto },
      resultado, historico, classificacao
    });

  } catch (err) {
    logger.error(`[Orquestrador] Erro fatal para ${numero}:`, err);
    await enviarTexto(tenantId, numero,
      '😔 Ocorreu um erro inesperado. Nossa equipe foi notificada. Por favor, tente novamente em instantes ou ligue para a clínica.'
    );
  }
}

async function finalizarResposta({ tenantId, numero, sessaoId, paciente, sessao, resultado, historico, classificacao }) {
  // Enviar resposta(s)
  if (Array.isArray(resultado.respostas)) {
    for (const resp of resultado.respostas) {
      await simularDigitando(tenantId, numero, 800);
      await enviarTexto(tenantId, numero, resp);
      await new Promise(r => setTimeout(r, 600));
    }
  } else if (resultado.texto) {
    await enviarTexto(tenantId, numero, resultado.texto);
  }

  // Enviar botões se houver
  if (resultado.botoes?.length) {
    await new Promise(r => setTimeout(r, 500));
    await enviarBotoes(tenantId, numero, resultado.tituloBotoes || '📋 Opções', resultado.descricaoBotoes || 'Escolha uma opção:', resultado.botoes);
  }

  // Atualizar sessão
  const novaHistorico = [...historico, { role: 'assistant', content: resultado.texto || resultado.respostas?.[0] || '' }];
  await updateSession(sessaoId, {
    ...sessao,
    historico: novaHistorico.slice(-20),
    contexto: resultado.novoContexto || sessao.contexto,
    aguardandoResposta: resultado.aguardandoResposta || false,
    tentativas: 0
  });

  // Salvar no banco
  await salvarConversa(
    tenantId, paciente.id, sessaoId,
    novaHistorico, sessao.agenteAtual,
    classificacao?.intencao, classificacao?.confianca
  );

  // Audit log
  await logAgentAudit(
    tenantId,
    sessao.agenteAtual || 'orchestrator',
    resultado.textoUsuario || '',
    resultado.texto || '',
    classificacao?.confianca || 1.0,
    resultado.escalado || false
  );
}

function gerarBoasVindas(tenant, paciente, ehSaudacao) {
  const primeiroNome = paciente.nome.split(' ')[0];
  const ehPrimeiraVez = !paciente.ultima_consulta;

  const texto = ehPrimeiraVez
    ? `Olá ${primeiroNome}! 😊 Bem-vindo(a) à *${tenant.nome_clinica}*!\n\n` +
      `Sou a *Sofia*, assistente virtual da clínica. Estou aqui para te ajudar com agendamentos, informações sobre tratamentos, financeiro e muito mais! 🦷✨\n\n` +
      `Como posso te ajudar hoje?`
    : `Olá ${primeiroNome}! 😊 Que bom ter você de volta na *${tenant.nome_clinica}*!\n\n` +
      `Sou a *Sofia*. Como posso te ajudar hoje?`;

  return {
    texto,
    tituloBotoes: '🦷 Menu Principal',
    descricaoBotoes: 'Selecione uma opção:',
    botoes: ['📅 Agendar Consulta', '💰 Financeiro', '🦷 Info sobre Tratamentos', '📞 Falar com Atendente']
  };
}
