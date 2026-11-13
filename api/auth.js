const { DEMO, SECRET, PASSWORD, sign, verify, cookies, safeEq, send } = require('./_lib');

const isHttps = (req) => (req.headers['x-forwarded-proto'] || '').includes('https');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return send(res, 200, { authed: !!verify(cookies(req).wa_session), demo: DEMO });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const b = req.body || {};
  const flags = 'Path=/; HttpOnly; SameSite=Strict' + (isHttps(req) ? '; Secure' : '');
  if (b.logout) {
    res.setHeader('Set-Cookie', `wa_session=; ${flags}; Max-Age=0`);
    return send(res, 200, { ok: true });
  }
  if (!PASSWORD || !SECRET) return send(res, 500, { error: 'The server is missing APP_PASSWORD or SESSION_SECRET.' });
  if (!safeEq(String(b.password || ''), PASSWORD)) {
    await new Promise((r) => setTimeout(r, 700));
    return send(res, 401, { error: 'Wrong password' });
  }
  const token = sign({ exp: Date.now() + 30 * 864e5 });
  res.setHeader('Set-Cookie', `wa_session=${token}; ${flags}; Max-Age=${30 * 86400}`);
  return send(res, 200, { ok: true });
};
