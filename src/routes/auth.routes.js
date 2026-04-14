// =============================================
// AUTH ROUTES
// =============================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../services/supabase.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const { data: usuario } = await supabaseAdmin
      .from('usuarios_clinica')
      .select('*, tenants (id, nome_clinica, plano, ativo)')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (!usuario) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (!usuario.tenants?.ativo) return res.status(403).json({ error: 'Clínica inativa. Contate o suporte.' });

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaCorreta) return res.status(401).json({ error: 'Credenciais inválidas' });

    const token = jwt.sign(
      {
        userId: usuario.id,
        tenantId: usuario.tenant_id,
        role: usuario.role,
        nome: usuario.nome
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Atualizar último acesso
    await supabaseAdmin
      .from('usuarios_clinica')
      .update({ ultimo_acesso: new Date().toISOString() })
      .eq('id', usuario.id);

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
        clinica: usuario.tenants.nome_clinica,
        tenantId: usuario.tenant_id,
        plano: usuario.tenants.plano
      }
    });

  } catch (err) {
    logger.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/auth/register-tenant (criação de nova clínica)
router.post('/register-tenant', async (req, res) => {
  try {
    const { nome_clinica, cnpj, email, senha, telefone, endereco, nome_responsavel } = req.body;

    // Validações básicas
    if (!nome_clinica || !email || !senha) {
      return res.status(400).json({ error: 'Campos obrigatórios: nome_clinica, email, senha' });
    }

    // Verificar se email já existe
    const { data: emailExistente } = await supabaseAdmin
      .from('usuarios_clinica')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (emailExistente) return res.status(400).json({ error: 'Email já cadastrado' });

    // Criar tenant
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .insert({
        nome_clinica,
        cnpj: cnpj?.replace(/\D/g, ''),
        email,
        telefone: telefone?.replace(/\D/g, ''),
        endereco,
        plano: 'starter',
        ativo: true
      })
      .select()
      .single();

    if (tenantError) throw tenantError;

    // Criar usuário admin
    const senhaHash = await bcrypt.hash(senha, 12);
    const { data: usuario } = await supabaseAdmin
      .from('usuarios_clinica')
      .insert({
        tenant_id: tenant.id,
        nome: nome_responsavel || nome_clinica,
        email: email.toLowerCase(),
        senha_hash: senhaHash,
        role: 'admin'
      })
      .select()
      .single();

    const token = jwt.sign(
      { userId: usuario.id, tenantId: tenant.id, role: 'admin', nome: usuario.nome },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    logger.info(`Nova clínica cadastrada: ${nome_clinica} (${tenant.id})`);

    res.status(201).json({
      message: 'Clínica cadastrada com sucesso!',
      token,
      tenantId: tenant.id,
      clinica: nome_clinica
    });

  } catch (err) {
    logger.error('Erro ao registrar tenant:', err);
    res.status(500).json({ error: 'Erro ao cadastrar clínica' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    const novoToken = jwt.sign(
      { userId: payload.userId, tenantId: payload.tenantId, role: payload.role, nome: payload.nome },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token: novoToken });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

export default router;
