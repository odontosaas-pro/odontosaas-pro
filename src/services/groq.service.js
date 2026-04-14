// =============================================
// GROQ SERVICE — LLM com Anti-Alucinação
// =============================================
import Groq from 'groq-sdk';
import { logger } from '../utils/logger.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODELOS = {
  RAPIDO: 'llama-3.1-8b-instant',      // Para classificação rápida
  PADRAO: 'llama-3.3-70b-versatile',    // Para respostas completas
  PRECISO: 'llama-3.3-70b-versatile'    // Para tarefas críticas
};

/**
 * Chamada base ao Groq com retry automático
 */
export async function chamarGroq({
  systemPrompt,
  mensagens,
  temperatura = 0.1,
  maxTokens = 1024,
  modelo = MODELOS.PADRAO,
  jsonMode = false
}) {
  const tentativas = 3;

  for (let i = 0; i < tentativas; i++) {
    try {
      const params = {
        model: modelo,
        temperature: temperatura,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mensagens
        ]
      };

      if (jsonMode) {
        params.response_format = { type: 'json_object' };
      }

      const response = await groq.chat.completions.create(params);
      const conteudo = response.choices[0]?.message?.content || '';

      return {
        texto: conteudo,
        tokens: response.usage?.total_tokens || 0,
        modelo: response.model
      };

    } catch (err) {
      logger.warn(`Groq tentativa ${i + 1} falhou: ${err.message}`);
      if (i === tentativas - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

/**
 * Classificação de intenção (modelo rápido)
 */
export async function classificarIntencao(texto, contexto = '') {
  const result = await chamarGroq({
    modelo: MODELOS.RAPIDO,
    temperatura: 0.0,
    maxTokens: 256,
    jsonMode: true,
    systemPrompt: `Você é um classificador de intenções para atendimento odontológico.
Analise a mensagem e retorne JSON com:
- intencao: "agendamento" | "consulta_info" | "financeiro" | "resultado_exame" | "reclamacao" | "cancelamento" | "confirmacao" | "saudacao" | "outros"
- confianca: número de 0.0 a 1.0
- entidades: { data, hora, procedimento, dentista, valor } (apenas as encontradas)
- urgente: boolean

Contexto da clínica: ${contexto}`,
    mensagens: [{ role: 'user', content: texto }]
  });

  try {
    return JSON.parse(result.texto);
  } catch {
    return { intencao: 'outros', confianca: 0.5, entidades: {}, urgente: false };
  }
}

export { MODELOS };
