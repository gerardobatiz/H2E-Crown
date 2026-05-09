// monitor.js — Detecta cambios en iSolve y manda correo a gerardobatiz@gmail.com
//
// SETUP (una sola vez):
//   1. Habilita 2FA en tu cuenta Google
//   2. Ve a https://myaccount.google.com/apppasswords
//   3. Crea una App Password para "Mail" + "Windows Computer"
//   4. Pega la contraseña de 16 caracteres en monitor-config.json → gmailAppPassword

const axios      = require('axios');
const https      = require('https');
const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');

// ── Config iSolve (mismas credenciales que server.js) ─────────────────────────
const BASE_URL = 'https://crowncity.isolveproduce.net';
const AUTH_B64 = Buffer.from('h2e:Solvegbe0281').toString('base64');
const agent    = new https.Agent({ rejectUnauthorized: false });

// ── Config email ───────────────────────────────────────────────────────────────
const CONFIG_PATH   = path.join(__dirname, 'monitor-config.json');
const SNAPSHOT_PATH = path.join(__dirname, 'monitor-snapshot.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

// ── Utilidades ─────────────────────────────────────────────────────────────────
const iSolveGet = url => axios.get(`${BASE_URL}/${url}`, {
  headers: { Authorization: `Basic ${AUTH_B64}` },
  httpsAgent: agent,
  timeout: 30000,
}).then(r => Array.isArray(r.data) ? r.data : []).catch(() => []);

const sumField = (arr, ...fields) => arr.reduce((s, r) => {
  for (const f of fields) { const v = parseFloat(r[f]); if (!isNaN(v)) return s + v; }
  return s;
}, 0);

const fmtAmt = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = n => n.toLocaleString('en-US');

const RENAME = { '2020': '2020/2021', '2021': '2021/2022', '2022': '2022/2023' };
const renameSeason = s => RENAME[s] || s;
const renameAll    = arr => arr.map(r => r.Season_Name ? { ...r, Season_Name: renameSeason(r.Season_Name) } : r);

function loadSnapshot() {
  try { return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')); }
  catch { return null; }
}

function saveSnapshot(data) {
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(data, null, 2));
}

// ── Fetch métricas de iSolve para temporadas recientes ────────────────────────
async function fetchCurrent() {
  const now   = new Date();
  const dFrom = '1/1/2024';
  const dTo   = `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()}`;

  const [sp, ex, ad, pAdj, inv] = (await Promise.all([
    iSolveGet(`GrwSalesByPostDateAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    iSolveGet(`GrwExpensesAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    iSolveGet(`GrwAdjByPostDateAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    iSolveGet(`GrwGrwPendingAdjByLotAPI.aspx`),
    iSolveGet(`GrwInventoryAPI.aspx?dAsOf=${dTo}`),
  ])).map(renameAll);

  const seasons = [...new Set([...sp, ...ex, ...ad, ...inv].map(r => r['Season_Name']).filter(s => s && /^\d{4}/.test(s)))];

  const result = {};
  for (const s of seasons) {
    const fsp  = sp.filter(r  => r['Season_Name'] === s);
    const fex  = ex.filter(r  => r['Season_Name'] === s);
    const fad  = ad.filter(r  => r['Season_Name'] === s);
    const fpAj = pAdj.filter(r => r['Season_Name'] === s);
    const finv = inv.filter(r  => r['Season_Name'] === s);

    const salesGross   = sumField(fsp, 'Amount');
    const adjAmt       = sumField(fad, 'Amount', 'Adj_Amt');

    result[s] = {
      pkgsInvoiced:   sumField(fsp, 'Qty'),
      netSales:       salesGross - adjAmt,
      expenses:       sumField(fex, 'Amount'),
      pendingAdj:     sumField(fpAj, 'Pend_Adj_Amount'),
      warehouseFloor: sumField(finv, 'Qty'),
    };
  }
  return result;
}

// ── Detecta diferencias entre snapshot y datos actuales ───────────────────────
const FIELDS = [
  { key: 'pkgsInvoiced',   label: 'Pkgs Invoiced',    fmt: fmtQty },
  { key: 'netSales',       label: 'Net Sales',         fmt: fmtAmt },
  { key: 'expenses',       label: 'Expenses',           fmt: fmtAmt },
  { key: 'pendingAdj',    label: 'Pending Adj',        fmt: fmtAmt },
  { key: 'warehouseFloor', label: 'Warehouse Floor',   fmt: fmtQty },
];

function detectChanges(prev, curr) {
  const changes = [];
  for (const s of Object.keys(curr)) {
    const p = prev[s];
    if (!p) continue; // temporada nueva — no alertar, solo guardar
    const diffs = FIELDS.filter(({ key }) => Math.abs((curr[s][key] || 0) - (p[key] || 0)) > 0.01)
      .map(({ key, label, fmt }) => ({ label, prev: fmt(p[key] || 0), curr: fmt(curr[s][key] || 0) }));
    if (diffs.length) changes.push({ season: s, diffs });
  }
  return changes;
}

// ── Construye HTML del correo ──────────────────────────────────────────────────
function buildEmail(changes) {
  const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Tijuana' });

  const tableStyle = 'border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px';
  const thStyle    = 'background:#1a5c38;color:#fff;padding:6px 12px;text-align:left';
  const tdStyle    = 'padding:6px 12px;border-bottom:1px solid #ddd';
  const tdNewStyle = 'padding:6px 12px;border-bottom:1px solid #ddd;font-weight:bold;color:#1a5c38';

  const sections = changes.map(({ season, diffs }) => `
    <h3 style="color:#1a5c38;margin:20px 0 8px">📦 Temporada ${season}</h3>
    <table style="${tableStyle}">
      <tr>
        <th style="${thStyle}">Campo</th>
        <th style="${thStyle}">Anterior</th>
        <th style="${thStyle}">Nuevo</th>
      </tr>
      ${diffs.map(d => `
        <tr>
          <td style="${tdStyle}">${d.label}</td>
          <td style="${tdStyle}">${d.prev}</td>
          <td style="${tdNewStyle}">${d.curr}</td>
        </tr>`).join('')}
    </table>`).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px">
      <div style="background:#1a5c38;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0">
        <b style="font-size:16px">🔔 H2E — Cambios detectados en iSolve</b>
      </div>
      <div style="padding:16px 20px;border:1px solid #ddd;border-top:none;border-radius:0 0 6px 6px">
        <p style="color:#666;margin:0 0 16px"><b>Revisado:</b> ${now}</p>
        ${sections}
        <hr style="margin:20px 0;border:none;border-top:1px solid #eee">
        <small style="color:#aaa">H2E Crown — iSolve Monitor automático</small>
      </div>
    </div>`;

  const text = changes.map(({ season, diffs }) =>
    `Temporada ${season}:\n` + diffs.map(d => `  ${d.label}: ${d.prev} → ${d.curr}`).join('\n')
  ).join('\n\n');

  return { html, text };
}

// ── Envía correo via Gmail ─────────────────────────────────────────────────────
async function sendEmail(config, changes) {
  const { html, text } = buildEmail(changes);
  const seasons = changes.map(c => c.season).join(', ');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.gmailUser, pass: config.gmailAppPassword },
  });

  await transporter.sendMail({
    from:    `"H2E Monitor" <${config.gmailUser}>`,
    to:      config.gmailTo || config.gmailUser,
    subject: `🔔 iSolve cambios: ${seasons}`,
    text,
    html,
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const ts = new Date().toLocaleString('es-MX', { timeZone: 'America/Tijuana' });
  console.log(`[${ts}] Revisando iSolve...`);

  const config   = loadConfig();
  const snapshot = loadSnapshot();
  const current  = await fetchCurrent();

  if (snapshot === null) {
    saveSnapshot(current);
    console.log('  Snapshot inicial guardado. Los próximos cambios dispararán correo.');
    return;
  }

  const changes = detectChanges(snapshot, current);

  // Guarda siempre el estado más reciente
  saveSnapshot({ ...snapshot, ...current });

  if (!changes.length) {
    console.log('  Sin cambios detectados.');
    return;
  }

  console.log(`  ${changes.length} temporada(s) con cambios.`);

  if (!config.gmailAppPassword || config.gmailAppPassword === 'PONER_APP_PASSWORD_AQUI') {
    console.warn('  ⚠  Configura monitor-config.json con tu Gmail App Password para enviar correos.');
    changes.forEach(({ season, diffs }) => {
      console.log(`  ${season}:`);
      diffs.forEach(d => console.log(`    ${d.label}: ${d.prev} → ${d.curr}`));
    });
    return;
  }

  await sendEmail(config, changes);
  console.log('  ✅ Correo enviado.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
