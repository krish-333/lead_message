// Shared helpers for all API routes: login cookie, Google Sheets access, demo data.
const crypto = require('crypto');

const DEMO = process.env.DEMO_MODE === '1';
const SECRET = process.env.SESSION_SECRET || (DEMO ? 'demo-secret' : '');
const PASSWORD = process.env.APP_PASSWORD || (DEMO ? 'demo' : '');

// Columns the app adds to the right of your sheet if they are missing.
const TRACK = ['WA Status', 'First Sent', 'Follow-up 1 Sent', 'Follow-up 2 Sent', 'Replied', 'Outcome', 'Referral Code', 'Notes'];

/* ---------- login cookie (signed, no database needed) ---------- */
const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + hmac(body);
}
function verify(tok) {
  if (!tok || !SECRET) return null;
  const [body, sig] = String(tok).split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(hmac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const authed = (req) => !!verify(cookies(req).wa_session);
const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
};
function send(res, status, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(obj);
}

/* ---------- helpers ---------- */
const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
function colLetter(n) { // 0 -> A
  let s = '';
  n += 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const q = (tab) => "'" + String(tab).replace(/'/g, "''") + "'";
function istNow() { // "2026-11-13 14:32:05" in India time
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
}
function connectedIds() { // SHEET_IDS="id1,id2" or "id1|Label one,id2|Label two"
  return String(process.env.SHEET_IDS || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [id, label] = s.split('|');
    return { id: id.trim(), label: (label || '').trim() };
  });
}
function assertConnected(id) {
  if (DEMO) return;
  if (!connectedIds().some((c) => c.id === id)) {
    const e = new Error('That sheet is not connected.'); e.status = 403; throw e;
  }
}
function friendly(e) {
  const m = (e && e.message) || String(e);
  if (/not found|404/i.test(m)) return 'Sheet not found. Check the ID in SHEET_IDS.';
  if (/permission|403|forbidden/i.test(m)) return 'No access. Share the sheet with your service-account email as Editor.';
  return m.slice(0, 200);
}

/* ---------- demo store (DEMO_MODE=1, in memory, resets on restart) ---------- */
const demo = (() => {
  const head = ['Business Name', 'Phone', 'Phone Type', 'Area', 'Type', 'Website Status', 'Rating', 'Reviews'];
  const rows = [
    ['Mehta & Associates', '+91 98200 11111', 'Mobile', 'Panvel, Navi Mumbai', 'chartered accountant', 'has website', 4.9, 212],
    ['Shah Tax Consultants', '+91 98200 22222', 'Mobile', 'Kharghar, Navi Mumbai', 'GST practitioner tax consultant', 'none', 5, 14],
    ['Desai & Co', '+91 98200 33333', 'Mobile', 'Thane West, Mumbai', 'CA firm GST tax audit', 'has website', 4.7, 88],
    ['Patil Accounting', '022 2745 4444', 'Landline/Other', 'Vashi, Navi Mumbai', 'chartered accountant', 'none', 4.2, 9],
    ['Jain Associates', '+91 98200 55555', 'Mobile', 'Kamothe, Navi Mumbai', 'chartered accountant', 'none', 4.8, 41],
  ];
  const db = { demo1: { title: 'Demo: CA partners', tabs: { 'CA Leads': [head, ...rows] } } };
  return db;
})();

/* ---------- Google Sheets client ---------- */
let _sheets;
function sheetsClient() {
  if (_sheets) return _sheets;
  const { google } = require('googleapis');
  const key = String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

async function listConnected() {
  if (DEMO) {
    return Object.entries(demo).map(([id, s]) => ({
      id, title: s.title, ok: true,
      tabs: Object.entries(s.tabs).map(([title, v]) => ({ title, rows: v.length - 1 })),
    }));
  }
  const out = [];
  for (const { id, label } of connectedIds()) {
    try {
      const r = await sheetsClient().spreadsheets.get({
        spreadsheetId: id, fields: 'properties.title,sheets.properties(title,gridProperties(rowCount))',
      });
      out.push({
        id, title: label || r.data.properties.title, ok: true,
        tabs: r.data.sheets.map((s) => ({ title: s.properties.title, rows: Math.max(0, (s.properties.gridProperties.rowCount || 1) - 1) })),
      });
    } catch (e) { out.push({ id, title: label || id, ok: false, error: friendly(e) }); }
  }
  return out;
}

async function readTab(id, tab, range) {
  assertConnected(id);
  if (DEMO) {
    const t = demo[id] && demo[id].tabs[tab];
    if (!t) { const e = new Error('Tab not found'); e.status = 404; throw e; }
    return t.map((r) => r.slice());
  }
  const r = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: id, range: range || q(tab), valueRenderOption: 'FORMATTED_VALUE',
  });
  return r.data.values || [];
}

async function readCell(id, tab, row, col) {
  if (DEMO) { const t = demo[id].tabs[tab]; return (t[row - 1] || [])[col]; }
  const v = await readTab(id, tab, `${q(tab)}!${colLetter(col)}${row}`);
  return v[0] && v[0][0];
}

async function ensureColumns(id, tab, n) {
  if (DEMO) return;
  const s = sheetsClient();
  const r = await s.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(sheetId,title,gridProperties(columnCount))' });
  const sh = r.data.sheets.find((x) => x.properties.title === tab);
  if (!sh) { const e = new Error('Tab not found'); e.status = 404; throw e; }
  const have = sh.properties.gridProperties.columnCount || 0;
  if (have < n) {
    await s.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ appendDimension: { sheetId: sh.properties.sheetId, dimension: 'COLUMNS', length: n - have } }] },
    });
  }
}

async function writeCells(id, tab, cells) { // cells: [{ r (1-based row), c (0-based col), v }]
  assertConnected(id);
  if (!cells.length) return;
  if (DEMO) {
    const t = demo[id].tabs[tab];
    cells.forEach(({ r, c, v }) => { while (t.length < r) t.push([]); const row = t[r - 1]; while (row.length < c) row.push(''); row[c] = v; });
    return;
  }
  await sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      valueInputOption: 'RAW',
      data: cells.map(({ r, c, v }) => ({ range: `${q(tab)}!${colLetter(c)}${r}`, values: [[v]] })),
    },
  });
}

// Make sure the tracking columns exist in the header row; returns their positions.
async function ensureTracking(id, tab, headerRow) {
  const header = (headerRow || []).map((h) => String(h == null ? '' : h).trim());
  while (header.length && header[header.length - 1] === '') header.pop();
  const map = {}, missing = [];
  TRACK.forEach((name) => {
    const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (i >= 0) map[name] = i; else missing.push(name);
  });
  if (missing.length) {
    let next = header.length;
    const cells = [];
    for (const name of missing) { map[name] = next; cells.push({ r: 1, c: next, v: name }); next++; }
    await ensureColumns(id, tab, next);
    await writeCells(id, tab, cells);
  }
  return map;
}

module.exports = {
  DEMO, SECRET, PASSWORD, TRACK, sign, verify, cookies, authed, safeEq, send,
  digits, q, istNow, listConnected, readTab, readCell, writeCells, ensureTracking, assertConnected,
};
