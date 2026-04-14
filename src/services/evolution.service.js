// =============================================
// EVOLUTION API SERVICE — Multi-Tenant WhatsApp
// =============================================
import axios from 'axios';
import { logger } from '../utils/logger.js';

const EVOLUTION_BASE = process.env.EVOLUTION_API_URL;
const GLOBAL_KEY = process.env.EVOLUTION_API_KEY;

function getHeaders(instanceToken = null) {
  return {
    'Content-Type': 'application/json',
    'apikey': instanceToken || GLOBAL_KEY
  };
}

// ── Instâncias ───────────────────────────────

export async function criarInstancia(tenantId, webhookUrl) {
  const instanceName = `odonto_${tenantId}`;
  try {
    const { data } = await axios.post(
      `${EVOLUTION_BASE}/instance/create`,
      {
        instanceName,
        token: GLOBAL_KEY,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
          url: webhookUrl,
          byEvents: true,
          base64: false,
          events: [
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'CONNECTION_UPDATE',
            'SEND_MESSAGE'
          ]
        },
        chatwoot: false
      },
      { headers: getHeaders() }
    );
    return data;
  } catch (err) {
    logger.error(`Erro ao criar instância para tenant ${tenantId}:`, err.response?.data || err.message);
    throw err;
  }
}

export async function getQRCode(tenantId) {
  const instanceName = `odonto_${tenantId}`;
  const { data } = await axios.get(
    `${EVOLUTION_BASE}/instance/connect/${instanceName}`,
    { headers: getHeaders() }
  );
  return data;
}

export async function getStatusInstancia(tenantId) {
  const instanceName = `odonto_${tenantId}`;
  try {
    const { data } = await axios.get(
      `${EVOLUTION_BASE}/instance/connectionState/${instanceName}`,
      { headers: getHeaders() }
    );
    return data;
  } catch {
    return { state: 'disconnected' };
  }
}

// ── Envio de Mensagens ───────────────────────

export async function enviarTexto(tenantId, numero, texto) {
  const instanceName = `odonto_${tenantId}`;
  const numeroFormatado = formatarNumero(numero);

  const { data } = await axios.post(
    `${EVOLUTION_BASE}/message/sendText/${instanceName}`,
    {
      number: numeroFormatado,
      text: texto,
      delay: 1000 // delay humanizado em ms
    },
    { headers: getHeaders() }
  );
  return data;
}

export async function enviarBotoes(tenantId, numero, titulo, descricao, botoes) {
  const instanceName = `odonto_${tenantId}`;
  const numeroFormatado = formatarNumero(numero);

  try {
    const { data } = await axios.post(
      `${EVOLUTION_BASE}/message/sendButtons/${instanceName}`,
      {
        number: numeroFormatado,
        title: titulo,
        description: descricao,
        buttons: botoes.map((b, i) => ({
          buttonId: `btn_${i}`,
          buttonText: { displayText: b },
          type: 1
        })),
        footerText: 'OdontoSaaS Pro'
      },
      { headers: getHeaders() }
    );
    return data;
  } catch {
    // Fallback para texto simples se botões não suportados
    const texto = `${titulo}\n\n${descricao}\n\n${botoes.map((b, i) => `*${i + 1}.* ${b}`).join('\n')}`;
    return enviarTexto(tenantId, numero, texto);
  }
}

export async function enviarLista(tenantId, numero, titulo, descricao, secoes) {
  const instanceName = `odonto_${tenantId}`;
  const numeroFormatado = formatarNumero(numero);

  try {
    const { data } = await axios.post(
      `${EVOLUTION_BASE}/message/sendList/${instanceName}`,
      {
        number: numeroFormatado,
        title: titulo,
        description: descricao,
        buttonText: 'Ver opções',
        sections: secoes,
        footerText: 'OdontoSaaS Pro'
      },
      { headers: getHeaders() }
    );
    return data;
  } catch {
    const texto = `${titulo}\n\n${descricao}\n\n${secoes.map(s =>
      `*${s.title}*\n${s.rows.map((r, i) => `${i + 1}. ${r.title}`).join('\n')}`
    ).join('\n\n')}`;
    return enviarTexto(tenantId, numero, texto);
  }
}

export async function enviarImagem(tenantId, numero, urlImagem, legenda = '') {
  const instanceName = `odonto_${tenantId}`;
  const { data } = await axios.post(
    `${EVOLUTION_BASE}/message/sendMedia/${instanceName}`,
    {
      number: formatarNumero(numero),
      mediatype: 'image',
      media: urlImagem,
      caption: legenda
    },
    { headers: getHeaders() }
  );
  return data;
}

// ── Digitando... (efeito humano) ─────────────
export async function simularDigitando(tenantId, numero, duracaoMs = 2000) {
  const instanceName = `odonto_${tenantId}`;
  try {
    await axios.post(
      `${EVOLUTION_BASE}/chat/sendPresence/${instanceName}`,
      { number: formatarNumero(numero), options: { presence: 'composing', delay: duracaoMs } },
      { headers: getHeaders() }
    );
    await new Promise(r => setTimeout(r, duracaoMs));
  } catch {}
}

// ── Utilitários ──────────────────────────────
function formatarNumero(numero) {
  const limpo = numero.replace(/\D/g, '');
  // Adicionar código do Brasil se não tiver
  if (limpo.startsWith('55') && limpo.length >= 12) return `${limpo}@s.whatsapp.net`;
  if (limpo.length === 11 || limpo.length === 10) return `55${limpo}@s.whatsapp.net`;
  return `${limpo}@s.whatsapp.net`;
}

export function extrairNumero(remoteJid) {
  return remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
}
