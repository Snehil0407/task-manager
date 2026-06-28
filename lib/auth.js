'use strict';

const crypto = require('crypto');

const SECRET = process.env.AUTH_SECRET || 'change-me-in-production-please-set-AUTH_SECRET';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/* ------------------------------ passwords ------------------------------ */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* -------------------------------- tokens ------------------------------- */

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

function signToken(payload) {
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const data = base64url(JSON.stringify(body));
  const sig = sign(data);
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  if (sign(data) !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
