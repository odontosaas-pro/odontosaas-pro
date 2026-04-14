// =============================================
// AGENDA ROUTES
// =============================================
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  getAgendamentosHoje, criarAgendamento, atualizarAgendamento,
  getDentistas, getDisponibilidadeDentista, supabaseAdmin
} from '../services/supabase.service.js';

const router = Router();
router.use(authMiddleware);

// GET /api/agenda?data=2025-01-15
router.get('/', async (req, res) => {
  try {
    const { data, dentista_id, status } = req.query;
    const tenantId = req.tenantId;

    let query = supabaseAdmin
      .from('agendamentos')
      .select(`
        id, inicio, fim, procedimento, status, observacoes, confirmado_em,
        pacientes (id, nome, telefone),
        dentistas (id, nome, especialidades)
      `)
      .eq('tenant_id', tenantId)
      .order('inicio');

    if (data) {
      query = query
        .gte('inicio', `${data}T00:00:00`)
        .lte('inicio', `${data}T23:59:59`);
    }
    if (dentista_id) query = query.eq('dentista_id', dentista_id);
    if (status) query = query.eq('status', status);

    const { data: agendamentos, error } = await query;
    if (error) throw error;

    res.json(agendamentos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agenda
router.post('/', async (req, res) => {
  try {
    const { paciente_id, dentista_id, procedimento, inicio, fim, observacoes } = req.body;

    if (!paciente_id || !dentista_id || !procedimento || !inicio) {
      return res.status(400).json({ error: 'Campos obrigatórios: paciente_id, dentista_id, procedimento, inicio' });
    }

    const agendamento = await criarAgendamento({
      tenant_id: req.tenantId,
      paciente_id, dentista_id, procedimento, inicio, fim,
      status: 'agendado',
      observacoes,
      criado_por: req.user.userId
    });

    res.status(201).json(agendamento);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agenda/:id
router.patch('/:id', async (req, res) => {
  try {
    const atualizado = await atualizarAgendamento(req.params.id, req.tenantId, req.body);
    res.json(atualizado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agenda/disponibilidade?dentista_id=xxx&data=2025-01-15
router.get('/disponibilidade', async (req, res) => {
  try {
    const { dentista_id, data } = req.query;
    if (!dentista_id || !data) return res.status(400).json({ error: 'dentista_id e data obrigatórios' });

    const disponibilidade = await getDisponibilidadeDentista(req.tenantId, dentista_id, data);
    res.json(disponibilidade);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agenda/dentistas
router.get('/dentistas', async (req, res) => {
  try {
    const dentistas = await getDentistas(req.tenantId);
    res.json(dentistas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
