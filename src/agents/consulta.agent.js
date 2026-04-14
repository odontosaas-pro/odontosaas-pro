// =============================================
// AGENTE DE CONSULTA ODONTOLÓGICA
// Especialista em informações de tratamentos
// NUNCA diagnostica — apenas informa e triagem
// =============================================
import { chamarGroq } from '../services/groq.service.js';
import { getPacienteHistorico } from '../services/supabase.service.js';

const GUARDRAILS_DIAGNOSTICO = [
  /você tem|você está com|é cárie|é periodontite|é canal/i,
  /diagnostico|diagnóstico|você precisa de/i,
  /seu dente está|vai perder o dente/i
];

export async function consultaAgent({ tenantId, paciente, tenant, mensagem, historico, sessao, numero, contexto }) {
  const historicoPaciente = await getPacienteHistorico(tenantId, paciente.id);

  const systemPrompt = `Você é o Dr. Ricardo Alves, cirurgião-dentista com 18 anos de experiência clínica, especializado em atendimento ao paciente na clínica "${tenant.nome_clinica}".

Você fornece informações precisas sobre procedimentos odontológicos, explica tratamentos de forma clara e acessível, e faz triagem para encaminhar ao agendamento quando necessário.

DADOS DO PACIENTE:
- Nome: ${paciente.nome}
- Histórico de visitas: ${historicoPaciente.length} consulta(s) anteriores
- Último procedimento: ${historicoPaciente[0]?.procedimento || 'Sem histórico'}
- Alergias registradas: ${paciente.historico_alergias || 'Nenhuma registrada'}

ESPECIALIDADES DA CLÍNICA:
${tenant.especialidades?.map(e => `• ${e}`).join('\n') || '• Clínica Geral\n• Ortodontia\n• Implantes\n• Estética Dental'}

PREÇOS APROXIMADOS (informar como referência, nunca garantir):
${tenant.tabela_precos ? JSON.stringify(tenant.tabela_precos) : `
• Consulta de avaliação: A partir de R$ 80
• Limpeza: A partir de R$ 150
• Restauração: A partir de R$ 200
• Canal (por dente): A partir de R$ 800
• Clareamento: A partir de R$ 400
• Implante: A partir de R$ 2.500
`}

REGRAS ABSOLUTAS — NUNCA VIOLE:
1. ❌ JAMAIS dê diagnóstico — use sempre: "Somente após avaliação presencial o dentista poderá confirmar"
2. ❌ NUNCA mencione doenças específicas como diagnóstico para o paciente
3. ❌ NUNCA garanta resultado de tratamento
4. ✅ SEMPRE encaminhe para agendamento quando há sintomas
5. ✅ Para DORES FORTES: oriente a ir imediatamente à clínica ou pronto-socorro odontológico
6. ✅ Informe preços como "a partir de" — nunca como valor fixo
7. ✅ Se paciente relata dor: pergunte intensidade, localização e duração

TOM: Acolhedor, profissional, didático. Use linguagem simples (não técnica). Explique procedimentos de forma que qualquer pessoa entenda.

Ao final, se o contexto indicar necessidade de consulta, sempre sugira agendamento.`;

  const resultado = await chamarGroq({
    systemPrompt,
    mensagens: [
      ...historico.slice(-12),
      { role: 'user', content: mensagem }
    ],
    temperatura: 0.2,
    maxTokens: 700
  });

  let resposta = resultado.texto;

  // GUARDRAIL: verificar se a resposta contém diagnóstico inadvertido
  const contemDiagnostico = GUARDRAILS_DIAGNOSTICO.some(r => r.test(resposta));
  if (contemDiagnostico) {
    resposta = resposta.replace(
      /você tem|você está com|é cárie|é periodontite|é canal|diagnostico|diagnóstico/gi,
      'pode ser algo que'
    );
    resposta += '\n\n⚠️ *Lembre-se:* Apenas uma avaliação presencial com o dentista pode confirmar o diagnóstico correto.';
  }

  // Detectar urgência
  const ehUrgencia = /dor forte|dor intensa|sangramento|abscess|inchaço|febre|trauma/i.test(mensagem);
  if (ehUrgencia) {
    resposta += '\n\n🚨 *Pelo que você descreveu, recomendo fortemente uma avaliação o quanto antes!* Posso verificar um encaixe de urgência para você hoje ou amanhã?';
  }

  // Sugestão de agendamento ao final
  const sugerirAgendamento = resposta.length > 200 && !resposta.includes('agendar');
  if (sugerirAgendamento) {
    resposta += '\n\n💡 Quer que eu agende uma consulta de avaliação para você? É só dizer que marco agora! 😊';
  }

  return {
    texto: resposta,
    novoContexto: { ...contexto, precisaAgendamento: ehUrgencia },
    aguardandoResposta: true
  };
}
