const crypto = require('crypto');
const { TRACK, digits, q, readTab, ensureTracking, writeCells, readSettings, istNow } = require('./_lib');

// Receives WhatsApp events from Meta (Callback URL = https://YOUR-DOMAIN/api/webhook).
//  GET  = Meta checks the Verify token once when you press "Verify and save".
//  POST = delivery updates and replies. A STOP reply marks the contact "Opted out", any other reply marks "Replied".
// Vercel settings: WHATSAPP_VERIFY_TOKEN (you invent it), WHATSAPP_APP_SECRET (Meta app > Settings > Basic),
//                  WA_SHEET_ID (the sheet whose contacts get updated), WA_TAB (optional, defaults to the first tab).

const same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

async function readRaw(req) { // the exact bytes Meta sent, needed to check the signature
  if (req.rawBody != null) return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody));
  if (req.readable === false) return null; // platform already parsed it, original bytes are gone
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

const OPT_OUT = /^(stop|stop all|unsubscribe|cancel|opt ?out|remove me|dont message|don't message|do not message|do not contact|dnd)$/i;
const isOptOut = (t) => OPT_OUT.test(String(t || '').trim().replace(/[.!\s]+$/g, ''));

function pickPhoneCol(header, saved) {
  if (saved && Number.isInteger(saved.p) && saved.p >= 0) return saved.p;
  const f = (...res) => { for (const re of res) { const i = header.findIndex((h) => re.test(String(h || ''))); if (i >= 0) return i; } return -1; };
  return f(/whatsapp/i, /^(phone|mobile|contact\s*(no|number)|number|tel)/i, /phone|mobile/i);
}
function findRow(values, col, from) {
  const want = digits(from).slice(-10);
  for (let i = 1; i < values.length; i++) {
    const parts = String((values[i] || [])[col] == null ? '' : values[i][col]).split(/[\/,;\n]|\bor\b/i);
    if (parts.some((p) => digits(p).slice(-10) === want && want.length === 10)) return i + 1; // 1-based sheet row
  }
  return 0;
}

async function handleInbound(sheetId, tab, msgs) {
  const values = await readTab(sheetId, tab);
  if (!values.length) return;
  let saved = null;
  try { const s = (await readSettings(sheetId))[`map_${sheetId}|${tab}`]; if (s) saved = JSON.parse(s); } catch (e) {}
  const col = pickPhoneCol(values[0], saved);
  if (col < 0) { console.log('webhook: no phone column found in', tab); return; }
  const map = await ensureTracking(sheetId, tab, values[0]);
  for (const m of msgs) {
    const row = findRow(values, col, m.from);
    const text = (m.text && m.text.body) || (m.button && (m.button.text || m.button.payload)) || (m.interactive && JSON.stringify(m.interactive)) || '';
    if (!row) { console.log('webhook: message from a number that is not in the sheet (…' + digits(m.from).slice(-4) + ')'); continue; }
    const cell = (name) => String(((values[row - 1] || [])[map[name]]) || '').trim();
    const now = istNow(), cells = [];
    if (isOptOut(text)) {
      cells.push({ r: row, c: map['WA Status'], v: 'Opted out' }, { r: row, c: map['Outcome'], v: 'Opted out' });
      if (!cell('Notes')) cells.push({ r: row, c: map['Notes'], v: 'Opted out by WhatsApp reply on ' + now });
    } else if (cell('WA Status') !== 'Opted out') {
      if (!cell('Replied')) cells.push({ r: row, c: map['Replied'], v: now });
      cells.push({ r: row, c: map['WA Status'], v: 'Replied' });
      if (!cell('Notes') && text && m.type === 'text') cells.push({ r: row, c: map['Notes'], v: ('Reply: ' + text).slice(0, 200) });
    }
    if (cells.length) await writeCells(sheetId, tab, cells);
    console.log('webhook:', isOptOut(text) ? 'opt-out recorded' : (cells.length ? 'reply recorded' : 'ignored (already opted out)'), 'for row', row);
  }
}

module.exports = async (req, res) => {
  const end = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'text/plain'); res.setHeader('Cache-Control', 'no-store'); res.end(body || ''); };

  if (req.method === 'GET') { // Meta's one-time check
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query || {};
    const mine = process.env.WHATSAPP_VERIFY_TOKEN || '';
    if (mode === 'subscribe' && mine && token && same(token, mine)) return end(200, String(challenge || ''));
    return end(403, 'Verify token does not match');
  }
  if (req.method !== 'POST') return end(405, 'Method not allowed');

  try {
    const raw = await readRaw(req);
    const secret = process.env.WHATSAPP_APP_SECRET || '';
    if (!secret) { console.log('webhook: WHATSAPP_APP_SECRET is not set, ignoring event'); return end(200, 'ok'); }
    if (!raw) { console.log('webhook: raw body not available, cannot check the signature'); return end(401, 'No raw body'); }
    const sig = String(req.headers['x-hub-signature-256'] || '');
    const good = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (!sig || !same(sig, good)) return end(401, 'Bad signature');

    const body = JSON.parse(raw.toString('utf8') || '{}');
    const inbound = [];
    for (const entry of body.entry || []) for (const ch of entry.changes || []) {
      const v = ch.value || {};
      (v.messages || []).forEach((m) => inbound.push(m));
      (v.statuses || []).forEach((s) => console.log('webhook: message', s.status, s.errors ? '(error ' + ((s.errors[0] || {}).code) + ')' : ''));
    }
    const sheetId = process.env.WA_SHEET_ID;
    if (inbound.length && sheetId) {
      let tab = process.env.WA_TAB;
      if (!tab) { // first normal tab of the sheet
        const { listConnected } = require('./_lib');
        const s = (await listConnected()).find((x) => x.id === sheetId);
        tab = s && s.tabs && s.tabs[0] && s.tabs[0].title;
      }
      if (tab) await handleInbound(sheetId, tab, inbound);
    } else if (inbound.length) console.log('webhook: WA_SHEET_ID is not set, replies are not written to the sheet');
    return end(200, 'ok');
  } catch (e) {
    console.error('webhook error:', e.message);
    return end(500, 'error'); // Meta will retry, so a STOP is not lost if Google was briefly unavailable
  }
};
module.exports.config = { api: { bodyParser: false } }; // keep the exact bytes so the signature can be checked
