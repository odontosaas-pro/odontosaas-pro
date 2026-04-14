// =============================================
// SUPABASE SERVICE — Multi-tenant com RLS
// =============================================
import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';

// Cliente com SERVICE KEY (bypass RLS para operações internas do backend)
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

// Cliente com ANON KEY (respeitando RLS — para operações do frontend)
export const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── Queries de Tenant ────────────────────────
export async function getTenant(tenantId) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .eq('ativo', true)
    .single();

  if (error) throw new Error(`Tenant não encontrado: ${error.message}`);
  return data;
}

export async function getTenantByPhone(phone) {
  const normalized = phone.replace(/\D/g, '');
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('whatsapp_numero', normalized)
    .eq('ativo', true)
    .single();
  return data || null;
}

// ── Pacientes ────────────────────────────────
export async function findOrCreatePaciente(tenantId, phone, nome = null) {
  const { data: existing } = await supabaseAdmin
    .from('pacientes')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('telefone', phone)
    .single();

  if (existing) return existing;

  const { data: novo, error } = await supabaseAdmin
    .from('pacientes')
    .insert({
      tenant_id: tenantId,
      telefone: phone,
      nome: nome || `Paciente ${phone.slice(-4)}`,
      lgpd_consent: true,
      lgpd_consent_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw new Error(`Erro ao criar paciente: ${error.message}`);
  return novo;
}

export async function getPacienteHistorico(tenantId, pacienteId) {
  const { data } = await supabaseAdmin
    .from('agendamentos')
    .select(`
      *,
      dentistas (nome, especialidades),
      prontuarios (odontograma, anamnese)
    `)
    .eq('tenant_id', tenantId)
    .eq('paciente_id', pacienteId)
    .order('inicio', { ascending: false })
    .limit(10);
  return data || [];
}

// ── Agendamentos ─────────────────────────────
export async function getAgendamentosHoje(tenantId) {
  const hoje = new Date();
  const inicio = new Date(hoje.setHours(0, 0, 0, 0)).toISOString();
  const fim = new Date(hoje.setHours(23, 59, 59, 999)).toISOString();

  const { data } = await supabaseAdmin
    .from('agendamentos')
    .select(`*, pacientes (nome, telefone), dentistas (nome)`)
    .eq('tenant_id', tenantId)
    .gte('inicio', inicio)
    .lte('inicio', fim)
    .order('inicio');
  return data || [];
}

export async function getDisponibilidadeDentista(tenantId, dentistaId, data) {
  // Buscar horários ocupados
  const dataInicio = `${data}T00:00:00`;
  const dataFim = `${data}T23:59:59`;

  const { data: ocupados } = await supabaseAdmin
    .from('agendamentos')
    .select('inicio, fim, procedimento')
    .eq('tenant_id', tenantId)
    .eq('dentista_id', dentistaId)
    .gte('inicio', dataInicio)
    .lte('inicio', dataFim)
    .neq('status', 'cancelado');

  const { data: dentista } = await supabaseAdmin
    .from('dentistas')
    .select('horario_disponibilidade, nome')
    .eq('id', dentistaId)
    .single();

  return { ocupados: ocupados || [], dentista };
}

export async function criarAgendamento(dados) {
  const { data, error } = await supabaseAdmin
    .from('agendamentos')
    .insert(dados)
    .select()
    .single();
  if (error) throw new Error(`Erro ao criar agendamento: ${error.message}`);
  return data;
}

export async function atualizarAgendamento(id, tenantId, updates) {
  const { data, error } = await supabaseAdmin
    .from('agendamentos')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (error) throw new Error(`Erro ao atualizar agendamento: ${error.message}`);
  return data;
}

// ── Dentistas ────────────────────────────────
export async function getDentistas(tenantId) {
  const { data } = await supabaseAdmin
    .from('dentistas')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('ativo', true);
  return data || [];
}

// ── Financeiro ───────────────────────────────
export async function criarCobranca(dados) {
  const { data, error } = await supabaseAdmin
    .from('financeiro')
    .insert(dados)
    .select()
    .single();
  if (error) throw new Error(`Erro ao criar cobrança: ${error.message}`);
  return data;
}

export async function getCobrancasPendentes(tenantId) {
  const { data } = await supabaseAdmin
    .from('financeiro')
    .select(`*, pacientes (nome, telefone)`)
    .eq('tenant_id', tenantId)
    .eq('status', 'pendente')
    .lt('vencimento', new Date().toISOString());
  return data || [];
}

// ── Estoque ──────────────────────────────────
export async function getEstoqueCritico(tenantId) {
  const { data } = await supabaseAdmin
    .from('estoque')
    .select('*')
    .eq('tenant_id', tenantId)
    .filter('quantidade', 'lte', 'minimo_alerta');
  return data || [];
}

// ── Audit Log ────────────────────────────────
export async function logAgentAudit(tenantId, agente, input, output, confianca, escalado = false) {
  await supabaseAdmin
    .from('agent_audit_log')
    .insert({
      tenant_id: tenantId,
      agente,
      input_resumo: input.substring(0, 500),
      output_resumo: output.substring(0, 500),
      confianca,
      escalado
    });
}

// ── Conversas ────────────────────────────────
export async function salvarConversa(tenantId, pacienteId, sessaoId, mensagens, agente, intencao, confianca) {
  const { data: existing } = await supabaseAdmin
    .from('conversas_whatsapp')
    .select('id, mensagens')
    .eq('sessao_id', sessaoId)
    .single();

  if (existing) {
    await supabaseAdmin
      .from('conversas_whatsapp')
      .update({ mensagens, agente_utilizado: agente, intencao_detectada: intencao, confianca, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await supabaseAdmin
      .from('conversas_whatsapp')
      .insert({ tenant_id: tenantId, paciente_id: pacienteId, sessao_id: sessaoId, mensagens, agente_utilizado: agente, intencao_detectada: intencao, confianca });
  }
}

export async function getConversaHistorico(sessaoId) {
  const { data } = await supabaseAdmin
    .from('conversas_whatsapp')
    .select('mensagens, agente_utilizado, intencao_detectada')
    .eq('sessao_id', sessaoId)
    .single();
  return data?.mensagens || [];
}
