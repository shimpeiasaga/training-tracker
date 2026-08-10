// Cookie関連のユーティリティ + セッションIDの発行
// セッション自体の保存(作成・取得・削除)はdb.js経由でファイル/MongoDBに保存する
// (以前はこのファイル内のメモリ上のMapに保存していたが、Renderがスリープ・再起動すると
//  ログイン状態が全員分消えてしまうため、他のデータと同じくDB側に永続化するようにした)
const crypto = require('crypto');

function generateSessionId() {
  return crypto.randomBytes(24).toString('hex');
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

module.exports = { generateSessionId, parseCookies, cookieHeader, clearCookieHeader };
