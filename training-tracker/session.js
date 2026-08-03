// 超シンプルなインメモリセッション管理(外部依存なし)
// ※サーバーを再起動するとログイン状態はリセットされます(小規模利用なので許容)
const crypto = require('crypto');

const sessions = new Map(); // sessionId -> { user, expires }
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30日

function createSession(user) {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { user, expires: Date.now() + SESSION_TTL });
  return id;
}

function getSession(id) {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expires < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return s;
}

function destroySession(id) {
  sessions.delete(id);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function cookieHeader(id, maxAgeSec) {
  return `sid=${id}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax`;
}

function clearCookieHeader() {
  return 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
}

module.exports = { createSession, getSession, destroySession, parseCookies, cookieHeader, clearCookieHeader };
