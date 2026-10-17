'use strict';
// Autenticação de usuário único: senha com scrypt + cookie de sessão assinado (HMAC).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// Formato: scrypt$N$r$p$saltBase64$hashBase64
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const got = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  } catch (_) {
    return false;
  }
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Segredo da sessão: variável de ambiente, ou um arquivo gerado uma vez no volume de dados.
function loadSecret(envSecret, dataDir) {
  if (envSecret && envSecret.length >= 16) return envSecret;
  const file = path.join(dataDir, '.session-secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch (_) { /* gera abaixo */ }
  const s = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSession(secret, user, days) {
  const body = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + days * 86400000 })).toString('base64url');
  return body + '.' + sign(secret, body);
}

function readSession(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.indexOf('.');
  if (i < 1) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(secret, body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// Limitador de tentativas de login por IP (em memória).
function createLimiter(max, windowMs) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      if (!h) return 0;
      if (Date.now() - h.first > windowMs) { hits.delete(key); return 0; }
      return h.n >= max ? Math.ceil((h.first + windowMs - Date.now()) / 1000) : 0;
    },
    fail(key) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || now - h.first > windowMs) hits.set(key, { n: 1, first: now });
      else h.n++;
      if (hits.size > 5000) hits.clear();
    },
    reset(key) { hits.delete(key); }
  };
}

module.exports = { hashPassword, verifyPassword, safeEqual, loadSecret, createSession, readSession, parseCookies, createLimiter };
