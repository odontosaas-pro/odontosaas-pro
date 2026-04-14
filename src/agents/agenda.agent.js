// =============================================
// AGENTE DE AGENDA
// Especialista sênior em agendamentos odontológicos
// 15+ anos de experiência em recepção clínica
// =============================================
import { chamarGroq } from '../services/groq.service.js';
import {
  getDentistas,
  getDisponibilidadeDentista,
  criarAgendamento,
  atualizarAgendamento,
  getAgendamentosHoje
} from '../services/supabase.service.js';

const DURACAO_PROCEDIMENTOS = {
  'limpeza': 60,
  'consulta': 30,
  'restauração': 60,
  'canal': 90,
  'extração': 45,
  'implante': 120,
  'clareamento': 90,
  'ortodontia': 45,
  'prótese': 60,
  'avaliação': 30,
  'emergência': 30,
  'padrão': 45
};

export async function agendaAgent({ tenantId, paciente, tenant, mensagem, historico, sessao, numero, contexto }) {
  const dentistas = await getDentistas(tenantId);

  const systemPrompt = `Você é Sofia, recepcionista sênior especializada em agendamentos da clínica "${tenant.nome_clinica}".
Você tem 15 anos de experiência em clínicas odontológicas e conhece profundamente os fluxos de agendamento.

DADOS DA CLÍNICA:
- Nome: ${tenant.nome_clinica}
- Horário: ${tenant.horario_funcionamento || 'Segunda a Sexta: 8h às 18h | Sábado: 8h às 12h'}
- Dentistas disponíveis: ${dentistas.map(d => `Dr(a). ${d.nome} (${d.especialidades?.join(', ') || 'Clínico Geral'})`).join(', ')}
- Procedimentos principais: Consulta, Limpeza, Restauração, Canal, Extração, Implante, Clareamento, Ortodontia

DADOS DO PACIENTE:
- Nome: ${paciente.nome}
- Telefone: ${paciente.telefone}
- Última consulta: ${paciente.ultima_consulta || 'Primeira vez'}

CONTEXTO ATUAL: ${JSON.stringify(contexto)}

SUAS REGRAS DE OURO:
1. SEMPRE confirme data E hora antes de agendar — nunca presuma
2. Se paciente não informou dentista de preferência, sugira o mais disponível
3. Para emergências: priorizar encaixe no mesmo dia ou próximo dia útil
4. Confirme o agendamento com TODOS os detalhes (data, hora, dentista, procedimento, endereço)
5. Pergunte se precisa de lembrete por WhatsApp (padrão: sim)
6. Tom: profissional, acolhedor, eficiente
7. NUNCA confirme horário sem verificar disponibilidade real
8. Se houver conflito, ofereça 3 alternativas

FLUXO DE AGENDAMENTO:
1. Identificar procedimento desejado
2. Verificar preferência de dentista
3. Consultar disponibilidade
4. Propor horários disponíveis
5. Confirmar escolha
6. Registrar agendamento
7. Enviar confirmação com detalhes completos

Responda de forma natural, empática e profissional. Use emojis com moderação.
Ao confirmar agendamento, inclua: data, hora, dentista, procedimento, endereço da clínica e instrução pré-consulta se necessário.`;

  // Verificar se está em fluxo de confirmação de agendamento
  if (contexto.aguardandoConfirmacao && contexto.agendamentoPendente) {
    return await processarConfirmacao({ tenantId, paciente, mensagem, contexto, dentistas, tenant });
  }

  // Verificar disponibilidade se tiver data/dentista no contexto
  let infoDisponibilidade = '';
  if (contexto.data && dentistas.length > 0) {
    const dentista = dentistas[0]; // ou filtrar por preferência
    const disponibilidade = await getDisponibilidadeDentista(tenantId, dentista.id, contexto.data);
    const horariosLivres = calcularHorariosLivres(disponibilidade, tenant);
    infoDisponibilidade = `\nHORÁRIOS DISPONÍVEIS para ${contexto.data}: ${horariosLivres.join(', ')}`;
  }

  const resultado = await chamarGroq({
    systemPrompt: systemPrompt + infoDisponibilidade,
    mensagens: [
      ...historico.slice(-10),
      { role: 'user', content: mensagem }
    ],
    temperatura: 0.15,
    maxTokens: 600
  });

  // Detectar se foi confirmado um agendamento na resposta
  const textoResposta = resultado.texto;
  const agendamentoConfirmado = textoResposta.toLowerCase().includes('agendamento confirmado') ||
    textoResposta.toLowerCase().includes('consulta marcada') ||
    textoResposta.toLowerCase().includes('horário reservado');

  if (agendamentoConfirmado && contexto.data && contexto.hora) {
    await registrarAgendamento({ tenantId, paciente, contexto, dentistas });
  }

  // Quebrar resposta longa em mensagens menores (mais natural no WhatsApp)
  const respostas = quebrarMensagem(textoResposta);

  return {
    respostas,
    texto: textoResposta,
    novoContexto: { ...contexto, agenteAtual: 'agendamento' },
    aguardandoResposta: true
  };
}

async function processarConfirmacao({ tenantId, paciente, mensagem, contexto, dentistas, tenant }) {
  const confirmou = /sim|s|confirmo|ok|pode|isso|1/i.test(mensagem);
  const cancelou = /nao|não|n|cancela|cancelar/i.test(mensagem);

  if (confirmou && contexto.agendamentoPendente) {
    const ag = contexto.agendamentoPendente;
    const dentista = dentistas.find(d => d.id === ag.dentistaId) || dentistas[0];

    try {
      await criarAgendamento({
        tenant_id: tenantId,
        paciente_id: paciente.id,
        dentista_id: dentista.id,
        procedimento: ag.procedimento,
        inicio: `${ag.data}T${ag.hora}:00`,
        fim: calcularFim(`${ag.data}T${ag.hora}:00`, ag.procedimento),
        status: 'confirmado',
        observacoes: ag.observacoes || ''
      });

      return {
        respostas: [
          `✅ *Agendamento Confirmado!*\n\n` +
          `📅 *Data:* ${formatarData(ag.data)}\n` +
          `🕐 *Horário:* ${ag.hora}\n` +
          `👨‍⚕️ *Dentista:* Dr(a). ${dentista.nome}\n` +
          `🦷 *Procedimento:* ${ag.procedimento}\n` +
          `📍 *Local:* ${tenant.endereco || 'Confirmar com a clínica'}\n\n` +
          `Você receberá um lembrete 24h antes. Até lá! 😊`,

          `💡 *Dica:* ${obterDicaPreConsulta(ag.procedimento)}`
        ],
        novoContexto: { agendamentoPendente: null, aguardandoConfirmacao: false },
        aguardandoResposta: false
      };
    } catch (err) {
      return {
        texto: '😔 Houve um problema ao confirmar seu agendamento. Por favor, ligue para a clínica para finalizar. Lamentamos o inconveniente!',
        aguardandoResposta: false
      };
    }
  }

  if (cancelou) {
    return {
      texto: 'Tudo bem! 😊 Seu agendamento não foi realizado. Se quiser agendar em outro momento, é só me chamar. Posso te ajudar com mais alguma coisa?',
      novoContexto: { agendamentoPendente: null, aguardandoConfirmacao: false },
      aguardandoResposta: false
    };
  }

  return {
    texto: 'Não entendi bem. Você confirma o agendamento? Responda *Sim* para confirmar ou *Não* para cancelar.',
    aguardandoResposta: true
  };
}

async function registrarAgendamento({ tenantId, paciente, contexto, dentistas }) {
  try {
    const dentista = dentistas[0];
    await criarAgendamento({
      tenant_id: tenantId,
      paciente_id: paciente.id,
      dentista_id: dentista.id,
      procedimento: contexto.procedimento || 'Consulta',
      inicio: `${contexto.data}T${contexto.hora}:00`,
      fim: calcularFim(`${contexto.data}T${contexto.hora}:00`, contexto.procedimento),
      status: 'agendado'
    });
  } catch (err) {
    // Já logado pelo supabase service
  }
}

function calcularHorariosLivres(disponibilidade, tenant) {
  const horariosBase = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'];

  const ocupados = (disponibilidade.ocupados || []).map(a => a.inicio.substring(11, 16));
  return horariosBase.filter(h => !ocupados.includes(h)).slice(0, 6);
}

function calcularFim(inicio, procedimento) {
  const duracao = DURACAO_PROCEDIMENTOS[procedimento?.toLowerCase()] || DURACAO_PROCEDIMENTOS.padrão;
  const dt = new Date(inicio);
  dt.setMinutes(dt.getMinutes() + duracao);
  return dt.toISOString();
}

function formatarData(data) {
  const [ano, mes, dia] = data.split('-');
  const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const dt = new Date(data);
  return `${dias[dt.getDay()]}, ${dia}/${mes}/${ano}`;
}

function obterDicaPreConsulta(procedimento) {
  const dicas = {
    'canal': 'Para o tratamento de canal, tome um analgésico leve (como paracetamol) 1h antes se tiver dor.',
    'limpeza': 'Faça a escovação normalmente antes da consulta. A limpeza é indolor e leva cerca de 1 hora.',
    'implante': 'Não faça jejum. Venha com a boca higienizada. Traga exames recentes se tiver.',
    'clareamento': 'Evite alimentos coloridos (café, vinho, beterraba) nas 48h após o procedimento.',
    'extração': 'Tome café da manhã normalmente. Traga acompanhante se possível.',
    'padrão': 'Venha com a boca higienizada e, se possível, evite atrasos. 😊'
  };
  return dicas[procedimento?.toLowerCase()] || dicas.padrão;
}

function quebrarMensagem(texto, limite = 800) {
  if (texto.length <= limite) return [texto];
  const partes = [];
  const paragrafos = texto.split('\n\n');
  let atual = '';
  for (const p of paragrafos) {
    if ((atual + p).length > limite && atual) {
      partes.push(atual.trim());
      atual = p + '\n\n';
    } else {
      atual += p + '\n\n';
    }
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}
