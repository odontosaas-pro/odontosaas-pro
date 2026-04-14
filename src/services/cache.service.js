// =============================================
// CACHE SERVICE — Redis/Upstash
// =============================================
import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

let redis;

export async function initCache() {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    enableOfflineQueue: false
  });

  redis.on('error', (err) => logger.error('Redis error:', err.message));
  redis.on('connect', () => logger.info('Redis conectado'));

  // Testar conexão
  await redis.ping();
  return redis;
}

export function getRedis() {
  return redis;
}

export async function cacheGet(key) {
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

export async function cacheSet(key, value, ttlSeconds = 3600) {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    logger.warn('Cache set falhou:', err.message);
  }
}

export async function cacheDel(key) {
  try { await redis.del(key); } catch {}
}

// Cache específico para sessões WhatsApp (TTL 30 min)
export async function getSession(phone) {
  return cacheGet(`session:${phone}`);
}

export async function setSession(phone, data) {
  return cacheSet(`session:${phone}`, data, 1800);
}

export async function updateSession(phone, updates) {
  const existing = await getSession(phone) || {};
  return setSession(phone, { ...existing, ...updates, updatedAt: Date.now() });
}

// Cache de configurações do tenant (TTL 1h)
export async function getTenantCache(tenantId) {
  return cacheGet(`tenant:${tenantId}`);
}

export async function setTenantCache(tenantId, data) {
  return cacheSet(`tenant:${tenantId}`, data, 3600);
}
