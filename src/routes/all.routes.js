// =============================================
// PACIENTE ROUTES
// =============================================
import { Router as PacRouter } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { supabaseAdmin, findOrCreatePaciente, getPacienteHistorico } from '../services/supabase.service.js';

export const pacienteRouter = PacRouter();
pacienteRouter.use(authMiddleware);

pacienteRouter.get('/', async (req, res) => {
  try {
    const { busca, limit = 50, offset = 0 } = req.query;
    let query = supabaseAdmin
      .from('pacientes')
      .select('id, nome, telefone, email, ultima_consulta, created_at')
      .eq('tenant_id', req.tenantId)
      .order('nome')
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (busca) {
      query = query.or(`nome.ilike.%${busca}%,telefone.ilike.%${busca}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ pacientes: data, total: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

pacienteRouter.get('/:id', async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('pacientes')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single();

    if (!data) return res.status(404).json({ error: 'Paciente não encontrado' });

    const historico = await getPacienteHistorico(req.tenantId, req.params.id);
    res.json({ ...data, historico });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

pacienteRouter.post('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('pacientes')
      .insert({ ...req.body, tenant_id: req.tenantId, lgpd_consent: true, lgpd_consent_at: new Date().toISOString() })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

pacienteRouter.patch('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('pacientes')
      .update(req.body)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// FINANCEIRO ROUTES
// =============================================
import { Router as FinRouter } from 'express';

export const financeiroRouter = FinRouter();
financeiroRouter.use(authMiddleware);

financeiroRouter.get('/', async (req, res) => {
  try {
    const { status, mes, paciente_id } = req.query;
    let query = supabaseAdmin
      .from('financeiro')
      .select(`*, pacientes (nome, telefone)`)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (paciente_id) query = query.eq('paciente_id', paciente_id);
    if (mes) {
      const [ano, m] = mes.split('-');
      query = query
        .gte('created_at', `${ano}-${m}-01`)
        .lt('created_at', `${ano}-${String(Number(m) + 1).padStart(2, '0')}-01`);
    }

    const { data, error } = await query.limit(200);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

financeiroRouter.post('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('financeiro')
      .insert({ ...req.body, tenant_id: req.tenantId })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

financeiroRouter.get('/resumo', async (req, res) => {
  try {
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
    const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const { data } = await supabaseAdmin
      .from('financeiro')
      .select('valor, status, tipo')
      .eq('tenant_id', req.tenantId)
      .gte('created_at', inicioMes)
      .lte('created_at', fimMes);

    const resumo = {
      receita_total: data?.filter(f => f.status === 'pago' && f.tipo === 'receita').reduce((a, b) => a + b.valor, 0) || 0,
      pendente: data?.filter(f => f.status === 'pendente').reduce((a, b) => a + b.valor, 0) || 0,
      inadimplente: data?.filter(f => f.status === 'vencido').reduce((a, b) => a + b.valor, 0) || 0,
      total_transacoes: data?.length || 0
    };

    res.json(resumo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// TENANT ROUTES
// =============================================
import { Router as TenRouter } from 'express';
import { adminOnly } from '../middleware/auth.middleware.js';
import { criarInstancia, getStatusInstancia, getQRCode } from '../services/evolution.service.js';

export const tenantRouter = TenRouter();
tenantRouter.use(authMiddleware);

// GET /api/tenants/me — dados da clínica
tenantRouter.get('/me', async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', req.tenantId)
      .single();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tenants/me
tenantRouter.patch('/me', adminOnly, async (req, res) => {
  try {
    const camposPermitidos = ['nome_clinica', 'telefone', 'endereco', 'horario_funcionamento',
      'especialidades', 'convenios', 'tabela_precos', 'condicoes_pagamento', 'email', 'site'];
    const updates = {};
    camposPermitidos.forEach(c => { if (req.body[c] !== undefined) updates[c] = req.body[c]; });

    const { data, error } = await supabaseAdmin
      .from('tenants')
      .update(updates)
      .eq('id', req.tenantId)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tenants/whatsapp/conectar
tenantRouter.post('/whatsapp/conectar', adminOnly, async (req, res) => {
  try {
    const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/api/webhook/whatsapp/${req.tenantId}`;
    const instancia = await criarInstancia(req.tenantId, webhookUrl);
    res.json({ message: 'Instância criada. Escaneie o QR Code.', instancia });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tenants/whatsapp/qrcode
tenantRouter.get('/whatsapp/qrcode', adminOnly, async (req, res) => {
  try {
    const qr = await getQRCode(req.tenantId);
    res.json(qr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tenants/whatsapp/status
tenantRouter.get('/whatsapp/status', async (req, res) => {
  try {
    const status = await getStatusInstancia(req.tenantId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// ADMIN ROUTES
// =============================================
import { Router as AdmRouter } from 'express';

export const adminRouter = AdmRouter();
adminRouter.use(authMiddleware, adminOnly);

adminRouter.get('/dashboard', async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];

    const [agendamentos, pacientes, financeiro] = await Promise.all([
      supabaseAdmin.from('agendamentos').select('status').eq('tenant_id', req.tenantId)
        .gte('inicio', `${hoje}T00:00:00`).lte('inicio', `${hoje}T23:59:59`),
      supabaseAdmin.from('pacientes').select('id', { count: 'exact' }).eq('tenant_id', req.tenantId),
      supabaseAdmin.from('financeiro').select('valor, status').eq('tenant_id', req.tenantId)
        .gte('created_at', `${hoje.substring(0, 7)}-01`)
    ]);

    res.json({
      hoje: {
        total: agendamentos.data?.length || 0,
        confirmados: agendamentos.data?.filter(a => a.status === 'confirmado').length || 0,
        cancelados: agendamentos.data?.filter(a => a.status === 'cancelado').length || 0
      },
      pacientes_total: pacientes.count || 0,
      financeiro_mes: {
        receita: financeiro.data?.filter(f => f.status === 'pago').reduce((a, b) => a + b.valor, 0) || 0,
        pendente: financeiro.data?.filter(f => f.status === 'pendente').reduce((a, b) => a + b.valor, 0) || 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/usuarios', async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('usuarios_clinica')
      .select('id, nome, email, role, ativo, ultimo_acesso, created_at')
      .eq('tenant_id', req.tenantId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/usuarios', async (req, res) => {
  try {
    const bcrypt = await import('bcryptjs');
    const { nome, email, senha, role } = req.body;
    const senhaHash = await bcrypt.default.hash(senha, 12);

    const { data, error } = await supabaseAdmin
      .from('usuarios_clinica')
      .insert({ tenant_id: req.tenantId, nome, email: email.toLowerCase(), senha_hash: senhaHash, role: role || 'recepcao' })
      .select('id, nome, email, role')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/estoque', async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('estoque')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('produto');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/dentistas', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('dentistas')
      .insert({ ...req.body, tenant_id: req.tenantId, ativo: true })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
