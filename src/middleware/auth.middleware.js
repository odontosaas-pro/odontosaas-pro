// =============================================
// AUTH MIDDLEWARE
// =============================================
import jwt from 'jsonwebtoken';
import { getTenant } from '../services/supabase.service.js';
import { logger } from '../utils/logger.js';

export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    req.tenantId = payload.tenantId;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  next();
}
