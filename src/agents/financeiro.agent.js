// =============================================
// AGENTE FINANCEIRO
// Especialista em finanças clínicas, 12 anos exp.
// =============================================
import { chamarGroq } from '../services/groq.service.js';
import { criarCobranca, getCobrancasPendentes } from '../services/supabase.service.js';
import axios from 'axios';

export async function financeiroAgent({ tenantId, paciente, tenant, mensagem, historico, sessao, numero, contexto }) {

  // Buscar pendências do paciente
  let pendencias = [];
  try {
    const todasPendencias = await getCobrancasPendentes(tenantId);
    pendencias = todasPendencias.filter(p => p.paciente_id === paciente.id);
  } catch {}

  const systemPrompt = `Você é Ana Paula Mendes, gerente financeira com 12 anos de experiência em administração de clínicas odontológicas da clínica "${tenant.nome_clinica}".

Você é especialista em negociação amigável, parcelamentos, cobranças e esclarecimento de dúvidas financeiras. Você trata cada paciente com respeito e busca sempre uma solução que funcione para ambas as partes.

DADOS DO PACIENTE:
- Nome: ${paciente.nome}
- CPF (parcial): ${paciente.cpf ? '***.' + paciente.cpf.slice(-6) : 'Não cadastrado'}
- Pendências financeiras: ${pendencias.length > 0
    ? pendencias.map(p => `R$ ${p.valor.toFixed(2)} (vence ${new Date(p.vencimento).toLocaleDateString('pt-BR')})`).join(', ')
    : 'Nenhuma pendência em aberto'}

CONDIÇÕES DE PAGAMENTO DA CLÍNICA:
${tenant.condicoes_pagamento || `
• À vista: 5% de desconto
• 2x sem juros no cartão
• 3-6x: 1.5% a.m.
• Boleto bancário: sem acréscimo
• PIX: pagamento imediato, 5% desconto
• Convênios aceitos: ${tenant.convenios?.join(', ') || 'Consultar recepção'}
`}

SUAS REGRAS:
1. NUNCA prometa desconto sem autorização da clínica (a menos que seja a política padrão)
2. Para renegociação de dívidas: escute, proponha parcelamento e registre no sistema
3. SEMPRE valide CPF antes de gerar boleto/link de pagamento
4. Orçamentos: são estimativas, valor final depende de avaliação presencial
5. Para convênios: solicite número da carteirinha e nome do convênio
6. Tom: profissional, empático, sem julgamento

IMPORTANTE: Se paciente perguntar sobre orçamento, sempre:
1. Informe o valor aproximado com "a partir de"
2. Explique que o valor exato é definido após avaliação
3. Sugira agendamento de consulta de avaliação gratuita (se for política da clínica)

Responda de forma clara, objetiva e profissional.`;

  const resultado = await chamarGroq({
    systemPrompt,
    mensagens: [
      ...historico.slice(-10),
      { role: 'user', content: mensagem }
    ],
    temperatura: 0.1,
    maxTokens: 600
  });

  let resposta = resultado.texto;

  // Detectar solicitação de link de pagamento / PIX
  const solicitaLink = /link|pix|boleto|pagar|pagamento/i.test(mensagem);
  if (solicitaLink && pendencias.length > 0) {
    const pendencia = pendencias[0];
    const linkPagamento = await gerarLinkPagamento(tenant, paciente, pendencia);
    if (linkPagamento) {
      resposta += `\n\n💳 *Link de pagamento gerado:*\n${linkPagamento}\n\n_Válido por 3 dias_`;
    }
  }

  return {
    texto: resposta,
    novoContexto: { ...contexto },
    aguardandoResposta: true
  };
}

async function gerarLinkPagamento(tenant, paciente, cobranca) {
  if (!process.env.ASAAS_API_KEY) return null;

  try {
    const { data } = await axios.post(
      `${process.env.ASAAS_BASE_URL}/payments`,
      {
        customer: paciente.asaas_id || null,
        billingType: 'UNDEFINED', // PIX + Boleto + Cartão
        value: cobranca.valor,
        dueDate: new Date(cobranca.vencimento).toISOString().split('T')[0],
        description: `Serviço odontológico - ${tenant.nome_clinica}`,
        externalReference: cobranca.id
      },
      {
        headers: {
          'access_token': process.env.ASAAS_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    return data.invoiceUrl || data.bankSlipUrl;
  } catch {
    return null;
  }
}
