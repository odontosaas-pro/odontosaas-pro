// =============================================
// AGENTE DE SUPORTE
// FAQ inteligente + escalação para humanos
// =============================================
import { chamarGroq } from '../services/groq.service.js';
import { supabaseAdmin } from '../services/supabase.service.js';

export async function suporteAgent({ tenantId, paciente, tenant, mensagem, historico, sessao, numero, contexto }) {

  // Detectar sentimento negativo para escalar
  const sentimentoNegativo = /insatisfeit|reclamação|absurdo|horrível|péssimo|nunca mais|processarei|procon/i.test(mensagem);
  const pedindoHumano = /atendente|humano|pessoa|falar com alguém|gerente|responsável/i.test(mensagem);

  if (sentimentoNegativo || pedindoHumano) {
    await escalarParaHumano(tenantId, paciente, mensagem, sessao);

    return {
      texto: `Olá ${paciente.nome.split(' ')[0]}! Entendo sua situação.\n\n` +
        `Já estou transferindo você para um de nossos atendentes que poderá te ajudar melhor. ⏳\n\n` +
        `*Tempo estimado de espera:* 5-10 minutos\n\n` +
        `Se preferir, você também pode nos ligar diretamente: ${tenant.telefone || 'Consulte no site'}\n\n` +
        `Obrigado pela paciência! 🙏`,
      escalado: true,
      aguardandoResposta: false
    };
  }

  const systemPrompt = `Você é Lucas Ferreira, especialista em suporte ao cliente da clínica "${tenant.nome_clinica}", com 8 anos de experiência em atendimento odontológico.

Você resolve dúvidas gerais, fornece informações sobre a clínica e garante a melhor experiência para o paciente.

INFORMAÇÕES DA CLÍNICA:
- Nome: ${tenant.nome_clinica}
- Endereço: ${tenant.endereco || 'Não configurado — solicitar ao administrador'}
- Telefone: ${tenant.telefone || 'Não configurado'}
- Horário: ${tenant.horario_funcionamento || 'Seg-Sex: 8h às 18h | Sáb: 8h às 12h'}
- Email: ${tenant.email || 'Não configurado'}
- Site: ${tenant.site || 'Não configurado'}
- Estacionamento: ${tenant.estacionamento || 'Verificar com a clínica'}
- Acessibilidade: ${tenant.acessibilidade || 'Verificar com a clínica'}
- Convênios: ${tenant.convenios?.join(', ') || 'Verificar com a recepção'}

DOCUMENTOS NECESSÁRIOS NA CONSULTA:
• RG ou CNH
• Cartão do plano (se convênio)
• Exames recentes (se tiver)
• Histórico médico (se relevante)

POLÍTICAS:
• Cancelamentos: avisar com mínimo 2h de antecedência
• Atraso: tolerância de 10 minutos após o horário
• Crianças menores de 12 anos: devem vir acompanhados dos pais/responsáveis

SUAS COMPETÊNCIAS:
- Responder FAQs sobre a clínica
- Fornecer informações de localização e horários
- Esclarecer políticas da clínica
- Coletar feedbacks

Para questões além do seu escopo: encaminhe ao agendamento ou sugira contato direto.
Tom: simpático, prestativo, eficiente.`;

  const resultado = await chamarGroq({
    systemPrompt,
    mensagens: [...historico.slice(-10), { role: 'user', content: mensagem }],
    temperatura: 0.25,
    maxTokens: 500
  });

  return {
    texto: resultado.texto,
    novoContexto: contexto,
    aguardandoResposta: true
  };
}

async function escalarParaHumano(tenantId, paciente, mensagem, sessao) {
  await supabaseAdmin
    .from('escalacoes_humano')
    .insert({
      tenant_id: tenantId,
      paciente_id: paciente.id,
      motivo: mensagem.substring(0, 300),
      historico: JSON.stringify(sessao.historico?.slice(-5) || []),
      status: 'aguardando',
      criado_em: new Date().toISOString()
    });
}
