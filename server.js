const express = require('express');
const axios   = require('axios');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = 3000;

const BASE_URL = 'https://crowncity.isolveproduce.net';
const AUTH_B64 = Buffer.from('h2e:Solvegbe0281').toString('base64');
const agent    = new https.Agent({ rejectUnauthorized: false });

const axiosOpts = { headers: { Authorization: `Basic ${AUTH_B64}` }, httpsAgent: agent, timeout: 30000 };
const apiCall   = url => axios.get(`${BASE_URL}/${url}`, axiosOpts)
  .then(r => Array.isArray(r.data) ? r.data : []).catch(() => []);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '5mb' }));

// Datos suplementarios (Sent to Repack, Received from Repack, Dumped, Pending Cash Receipts)
const SUPP_PATH = path.join(__dirname, 'supplemental-data.json');
const loadSupp  = () => { try { return JSON.parse(fs.readFileSync(SUPP_PATH, 'utf8')); } catch(e) { return {}; } };

// Trouble Claims lookup: Trouble_No → { complaint, posted, status }
const TROUBLE_PATH = path.join(__dirname, 'trouble-claims.json');
const loadTrouble  = () => { try { return JSON.parse(fs.readFileSync(TROUBLE_PATH, 'utf8')); } catch(e) { return {}; } };

// Renombres de temporadas para display
const SEASON_RENAME = { '2020': '2020/2021', '2021': '2021/2022', '2022': '2022/2023' };
const renameSeason  = s => SEASON_RENAME[s] || s;
const renameAll     = arr => arr.map(r => r.Season_Name
  ? { ...r, Season_Name: renameSeason(r.Season_Name) } : r);

// Orden: slash-season (XX/YY) antes que año sencillo del mismo año final
// 2024/2025 → 2025 → 2025/2026 → 2026 → 2026/2027
const seasonSortKey = s => {
  const parts = String(s).trim().split(/[-\/]/);
  const endY  = parseInt(parts[parts.length - 1]);
  const full  = endY < 100 ? 2000 + endY : endY;
  return full * 2 + (parts.length > 1 ? 0 : 1);
};

function proxy(apiFile) {
  return async (req, res) => {
    const qs  = new URLSearchParams(req.query).toString();
    const url = `${BASE_URL}/${apiFile}${qs ? '?' + qs : ''}`;
    console.log(`[${new Date().toLocaleTimeString()}] → ${url}`);
    try {
      const { data } = await axios.get(url, axiosOpts);
      const arr = Array.isArray(data) ? data : [];
      res.json(arr.map(r => r.Season_Name && SEASON_RENAME[r.Season_Name]
        ? { ...r, Season_Name: renameSeason(r.Season_Name) } : r));
    } catch (err) {
      const status = err.response?.status || 502;
      const msg    = err.response?.statusText || err.message;
      console.error(`  ✗ ${status} ${msg}`);
      res.status(status).json({ error: `${status} — ${msg}` });
    }
  };
}

app.get('/api/sales-ship-date', proxy('GrwNetSalesByShipDateAPI.aspx'));
app.get('/api/sales-post-date', proxy('GrwSalesByPostDateAPI.aspx'));
app.get('/api/expenses',        proxy('GrwExpensesAPI.aspx'));
app.get('/api/inventory',       proxy('GrwInventoryAPI.aspx'));
app.get('/api/adj-post-date',   proxy('GrwAdjByPostDateAPI.aspx'));
app.get('/api/pending-adj',     proxy('GrwGrwPendingAdjByLotAPI.aspx'));

// ── Normaliza "2025-26" → "2025/2026" ─────────────────────────────────────────
function normSeason(s) {
  const m = s.trim().match(/^(\d{4})[-\/](\d{2,4})$/);
  if (!m) return s.trim();
  const y1 = parseInt(m[1]);
  const y2 = m[2].length === 2 ? y1 + 1 : parseInt(m[2]);
  return `${y1}/${y2}`;
}

// ── Temporadas disponibles — consulta 3 APIs con rango amplio ─────────────────
app.get('/api/seasons', async (req, res) => {
  const now   = new Date();
  const dFrom = `1/1/2015`;
  const dTo   = `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()}`;

  try {
    const [sp, ss, ex] = await Promise.all([
      apiCall(`GrwSalesByPostDateAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
      apiCall(`GrwNetSalesByShipDateAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
      apiCall(`GrwExpensesAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    ]);

    const all     = renameAll([...sp, ...ss, ...ex]);
    const currentYear = new Date().getFullYear();
    const seasons = [...new Set(all.map(r => r['Season_Name']).filter(Boolean))]
      .filter(s => {
        if (!/^\d{4}/.test(s)) return false;
        const parts     = s.split(/[-\/]/);
        const startYear = parseInt(parts[0]);
        return startYear <= currentYear;
      })
      .sort((a, b) => seasonSortKey(a) - seasonSortKey(b));

    res.json(seasons);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Debug: muestra Season Names reales y conteos por API ──────────────────────
app.get('/api/debug-seasons', async (req, res) => {
  const now   = new Date();
  const dFrom = `1/1/${now.getFullYear() - 2}`;
  const dTo   = `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()}`;
  const call  = url => axios.get(`${BASE_URL}/${url}`, axiosOpts)
    .then(r => Array.isArray(r.data) ? r.data : [])
    .catch(e => ({ error: e.message }));

  const [sp, ss, ex, ad, inv, pAdj] = await Promise.all([
    call(`GrwSalesByPostDateAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    call(`GrwNetSalesByShipDateAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    call(`GrwExpensesAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    call(`GrwAdjByPostDateAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    call(`GrwInventoryAPI.aspx?dAsOf=${dTo}`),
    call(`GrwGrwPendingAdjByLotAPI.aspx`),
  ]);

  const seasons = arr => Array.isArray(arr)
    ? [...new Set(arr.map(r => r['Season_Name']).filter(Boolean))]
    : arr;

  res.json({
    dateRange: { dFrom, dTo },
    salesPostDate: { count: Array.isArray(sp)   ? sp.length   : 0, seasons: seasons(sp),   sample: Array.isArray(sp)   ? sp[0]   : sp   },
    salesShipDate: { count: Array.isArray(ss)   ? ss.length   : 0, seasons: seasons(ss),   sample: Array.isArray(ss)   ? ss[0]   : ss   },
    expenses:      { count: Array.isArray(ex)   ? ex.length   : 0, seasons: seasons(ex),   sample: Array.isArray(ex)   ? ex[0]   : ex   },
    adjPostDate:   { count: Array.isArray(ad)   ? ad.length   : 0, seasons: seasons(ad),   sample: Array.isArray(ad)   ? ad[0]   : ad   },
    inventory:     { count: Array.isArray(inv)  ? inv.length  : 0, seasons: seasons(inv),  sample: Array.isArray(inv)  ? inv[0]  : inv  },
    pendingAdj:    { count: Array.isArray(pAdj) ? pAdj.length : 0, seasons: seasons(pAdj), sample: Array.isArray(pAdj) ? pAdj[0] : pAdj },
  });
});

// ── Balance por temporada — 3 llamadas en paralelo ────────────────────────────
app.get('/api/balance-summary', async (req, res) => {
  const now   = new Date();
  const dFrom = '1/1/2015';
  const dTo   = `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()}`;

  console.log(`[Balance Summary] ${dFrom} → ${dTo}`);

  try {
    const [sp, ex, ad] = (await Promise.all([
      apiCall(`GrwSalesByPostDateAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
      apiCall(`GrwExpensesAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
      apiCall(`GrwAdjByPostDateAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    ])).map(renameAll);

    const map = {};
    const valid = s => s && /^\d{4}/.test(s);
    const ensure = s => { if (!map[s]) map[s] = { sales: 0, expenses: 0, adj: 0 }; };

    for (const r of sp) {
      if (!valid(r['Season_Name'])) continue;
      ensure(r['Season_Name']);
      map[r['Season_Name']].sales += parseFloat(r['Amount']) || 0;
    }
    for (const r of ex) {
      if (!valid(r['Season_Name'])) continue;
      ensure(r['Season_Name']);
      map[r['Season_Name']].expenses += parseFloat(r['Amount']) || 0;
    }
    for (const r of ad) {
      if (!valid(r['Season_Name'])) continue;
      ensure(r['Season_Name']);
      map[r['Season_Name']].adj += parseFloat(r['Amount'] || r['Adj_Amt']) || 0;
    }

    const now = new Date();
    const rows = Object.entries(map)
      .map(([season, v]) => ({
        season,
        netSales: v.sales - v.adj,
        expenses: v.expenses,
        balance:  (v.sales - v.adj) - v.expenses,
      }))
      .filter(r => {
        const startYear = parseInt(r.season.split(/[-\/]/)[0]);
        return startYear <= now.getFullYear();
      })
      .sort((a, b) => seasonSortKey(a.season) - seasonSortKey(b.season));

    const total = {
      netSales: rows.reduce((s, r) => s + r.netSales, 0),
      expenses: rows.reduce((s, r) => s + r.expenses, 0),
      balance:  rows.reduce((s, r) => s + r.balance,  0),
    };

    res.json({ rows, total });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── GWR Statement — llama las 6 APIs en paralelo y consolida ──────────────────
app.get('/api/statement', async (req, res) => {
  const season = (req.query.season || '2025/2026').trim();
  const now    = new Date();

  // Rango STD: desde ene del primer año de la temporada hasta hoy
  const startYear = parseInt(season.split(/[-\/]/)[0]) || now.getFullYear();
  const stdFrom   = `1/1/${startYear}`;
  const stdTo     = `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()}`;

  // Rango MTD: primer día del mes actual hasta hoy
  const mtdFrom   = `${now.getMonth()+1}/1/${now.getFullYear()}`;
  const mtdTo     = stdTo;

  console.log(`[Statement] season=${season}  STD ${stdFrom}→${stdTo}  MTD ${mtdFrom}→${mtdTo}`);

  try {
    const [spStd, spMtd, ssStd, ssMtd, exStd, exMtd, adStd, adMtd, inv, pAdj] =
      (await Promise.all([
        apiCall(`GrwSalesByPostDateAPI.aspx?dFrom=${stdFrom}&dTo=${stdTo}`),
        apiCall(`GrwSalesByPostDateAPI.aspx?dFrom=${mtdFrom}&dTo=${mtdTo}`),
        apiCall(`GrwNetSalesByShipDateAPI.aspx?dFrom=${stdFrom}&dTo=${stdTo}`),
        apiCall(`GrwNetSalesByShipDateAPI.aspx?dFrom=${mtdFrom}&dTo=${mtdTo}`),
        apiCall(`GrwExpensesAPI.aspx?dFrom=${stdFrom}&dTo=${stdTo}`),
        apiCall(`GrwExpensesAPI.aspx?dFrom=${mtdFrom}&dTo=${mtdTo}`),
        apiCall(`GrwAdjByPostDateAPI.aspx?dFrom=${stdFrom}&dTo=${stdTo}`),
        apiCall(`GrwAdjByPostDateAPI.aspx?dFrom=${mtdFrom}&dTo=${mtdTo}`),
        apiCall(`GrwInventoryAPI.aspx?dAsOf=${stdTo}`),
        apiCall(`GrwGrwPendingAdjByLotAPI.aspx`),
      ])).map(renameAll);

    const bySeason = arr => arr.filter(r => r['Season_Name'] === season);
    const fspS = bySeason(spStd), fspM = bySeason(spMtd);
    const fssS = bySeason(ssStd), fssM = bySeason(ssMtd);
    const fexS = bySeason(exStd), fexM = bySeason(exMtd);
    const fadS = bySeason(adStd), fadM = bySeason(adMtd);
    const finv = bySeason(inv);
    const fpAj = bySeason(pAdj);

    // Suma flexible (prueba varios nombres de campo)
    const sum = (arr, ...fields) => arr.reduce((s, r) => {
      for (const f of fields) { const v = parseFloat(r[f]); if (!isNaN(v)) return s + v; }
      return s;
    }, 0);

    // ── Packages ──────────────────────────────────────────────────────────────
    const invQty     = sum(finv, 'Qty');
    const spQtyS     = sum(fspS, 'Qty');               // Sales/Post Date
    const spQtyM     = sum(fspM, 'Qty');
    const ssQtyS     = sum(fssS, 'Ship_Qty', 'Inv_Qty'); // Sales/Ship Date usa Ship_Qty
    const ssQtyM     = sum(fssM, 'Ship_Qty', 'Inv_Qty');

    // ── Sales ─────────────────────────────────────────────────────────────────
    const spAmtS     = sum(fspS, 'Amount');
    const spAmtM     = sum(fspM, 'Amount');
    const ssAmtS     = sum(fssS, 'Gross_Amt');          // Ship Date usa Gross_Amt
    const ssAmtM     = sum(fssM, 'Gross_Amt');
    const adjAmtS    = sum(fadS, 'Amount', 'Adj_Amt');
    const adjAmtM    = sum(fadM, 'Amount', 'Adj_Amt');
    const pAdjQty    = sum(fpAj, 'Pend_Adj_Pkgs');
    const pAdjAmt    = sum(fpAj, 'Pend_Adj_Amount');

    // ── Expenses por concepto ─────────────────────────────────────────────────
    const conceptOf = r => r['Concept_Name'] || r['Concept'] || r['Description'] || 'Other';

    const expMap = {};
    for (const r of fexS) {
      const k = conceptOf(r);
      expMap[k] = expMap[k] || { std: 0, mtd: 0 };
      expMap[k].std += parseFloat(r['Amount']) || 0;
    }
    for (const r of fexM) {
      const k = conceptOf(r);
      expMap[k] = expMap[k] || { std: 0, mtd: 0 };
      expMap[k].mtd += parseFloat(r['Amount']) || 0;
    }

    const expenses  = Object.entries(expMap)
      .map(([concept, v]) => ({ concept, std: v.std, mtd: v.mtd }))
      .sort((a, b) => a.concept.localeCompare(b.concept));

    const expTotS   = sum(fexS, 'Amount');
    const expTotM   = sum(fexM, 'Amount');
    const netS = spAmtS - adjAmtS;
    const netM = spAmtM - adjAmtM;

    const supp        = loadSupp()[season] || {};
    const dumpedS     = supp.dumped || 0;
    const pendingStd  = supp.pendingToInvoice != null ? supp.pendingToInvoice : invQty;
    const netAtRepack = supp.sentToRepack != null
      ? (supp.sentToRepack - (supp.receivedFromRepack || 0))
      : 0;
    const receivedStd = spQtyS + pendingStd + dumpedS + netAtRepack;
    const pkgsDenS    = receivedStd || 1;

    res.json({
      season, asOf: stdTo,
      suppAsOf: supp.asOf || null,
      packages: {
        receivedMtd:            spQtyM,
        receivedStd,
        sentToRepackStd:        supp.sentToRepack          ?? null,
        receivedFromRepackStd:  supp.receivedFromRepack    ?? null,
        productForSaleStd:      supp.sentToRepack != null
          ? receivedStd - supp.sentToRepack + (supp.receivedFromRepack || 0)
          : null,
        dumpedStd:              dumpedS,
        pkgsInvoicedMtd:        spQtyM,
        pkgsInvoicedStd:        spQtyS,
        pendingToInvoiceStd:    pendingStd,
        shippedMtd:             ssQtyM,
        shippedStd:             ssQtyS,
        warehouseFloorStd:      pendingStd,
      },
      sales: {
        invoicingQtyMtd:     spQtyM,   invoicingAmtMtd: spAmtM,
        invoicingQtyStd:     spQtyS,   invoicingAmtStd: spAmtS,
        adjAmtMtd:           adjAmtM,  adjAmtStd: adjAmtS,
        netMtd:              netM,     netStd: netS,
        pAdjQty, pAdjAmt,
        pendingCashReceipts: supp.pendingCashReceipts ?? null,
        avgPriceGrossStd:    spAmtS / pkgsDenS,
        avgPriceNetStd:      netS   / pkgsDenS,
      },
      expenses, expTotMtd: expTotM, expTotStd: expTotS,
      balanceMtd: netM - expTotM,
      balanceStd: netS - expTotS,
    });

  } catch (err) {
    console.error('Statement error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── GWR Expenses por Temporada — pivot Concepto × Temporada ─────────────────
app.get('/api/expenses-by-season', async (req, res) => {
  const now   = new Date();
  const dFrom = req.query.dFrom || '1/1/2015';
  const dTo   = req.query.dTo   || `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()}`;

  const raw  = await apiCall(`GrwExpensesAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`);

  const WIRES = new Set(['Liquidation', 'Pick & Pack', 'Advances']);

  const valid = renameAll(raw).filter(r => r['Season_Name'] && r['Concept_Name']);

  const seasonSort = seasonSortKey;
  const seasons = [...new Set(valid.map(r => r['Season_Name']))].sort((a, b) => seasonSort(a) - seasonSort(b));

  const pivot = {};
  for (const r of valid) {
    const c = r['Concept_Name'];
    const s = r['Season_Name'];
    const a = parseFloat(r['Amount']) || 0;
    if (!pivot[c]) pivot[c] = {};
    pivot[c][s] = (pivot[c][s] || 0) + a;
  }

  const toRows = entries => entries
    .map(([concept, amounts]) => ({ concept, amounts, total: Object.values(amounts).reduce((s, v) => s + v, 0) }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total);

  const rows  = toRows(Object.entries(pivot).filter(([c]) => !WIRES.has(c)));
  const wires = toRows(Object.entries(pivot).filter(([c]) =>  WIRES.has(c)));

  const colTotals = arr => {
    const t = {};
    for (const s of seasons) t[s] = arr.reduce((sum, r) => sum + (r.amounts[s] || 0), 0);
    return t;
  };

  res.json({
    seasons,
    rows,   totals:      colTotals(rows),  grandTotal:      rows.reduce((s, r)  => s + r.total, 0),
    wires,  wireTotals:  colTotals(wires), wireGrandTotal:  wires.reduce((s, r) => s + r.total, 0),
  });
});

// ── Statement by Season — pivot líneas × temporadas ──────────────────────────
app.get('/api/statement-by-season', async (req, res) => {
  const now   = new Date();
  const dFrom = '1/1/2015';
  const dTo   = `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()}`;

  const [sp, ad, ex, inv, pAdj] = (await Promise.all([
    apiCall(`GrwSalesByPostDateAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    apiCall(`GrwAdjByPostDateAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    apiCall(`GrwExpensesAPI.aspx?dFrom=${dFrom}&dTo=${dTo}`),
    apiCall(`GrwInventoryAPI.aspx?dAsOf=${dTo}`),
    apiCall(`GrwGrwPendingAdjByLotAPI.aspx`),
  ])).map(renameAll);

  const WIRES = new Set(['Liquidation', 'Pick & Pack', 'Advances']);

  const seasonSort = seasonSortKey;
  const allSeasons = [...new Set([...sp, ...ad, ...ex, ...inv].map(r => r['Season_Name']).filter(Boolean))];
  const seasons    = allSeasons.sort((a, b) => seasonSort(a) - seasonSort(b));

  const sum = (arr, ...fields) => arr.reduce((s, r) => {
    for (const f of fields) { const v = parseFloat(r[f]); if (!isNaN(v)) return s + v; }
    return s;
  }, 0);

  const suppAll = loadSupp();
  const data = {};
  for (const s of seasons) {
    const fsp  = sp.filter(r  => r['Season_Name'] === s);
    const fad  = ad.filter(r  => r['Season_Name'] === s);
    const fex  = ex.filter(r  => r['Season_Name'] === s);
    const finv = inv.filter(r => r['Season_Name'] === s);
    const fpAj = pAdj.filter(r=> r['Season_Name'] === s);

    const expMap = {};
    for (const r of fex) {
      const c = r['Concept_Name'] || 'Other';
      expMap[c] = (expMap[c] || 0) + (parseFloat(r['Amount']) || 0);
    }

    const pkgsInvoiced = sum(fsp, 'Qty');
    const salesGross   = sum(fsp, 'Amount');
    const adjAmt       = sum(fad, 'Amount', 'Adj_Amt');
    const netSales     = salesGross - adjAmt;
    const expTotal     = Object.entries(expMap).filter(([c]) => !WIRES.has(c)).reduce((s,[,v]) => s+v, 0);
    const wiresTotal   = Object.entries(expMap).filter(([c]) =>  WIRES.has(c)).reduce((s,[,v]) => s+v, 0);

    const sSupp       = suppAll[s] || {};
    const dumped      = sSupp.dumped || 0;
    const invQty      = sum(finv, 'Qty');
    const pkgsPending = sSupp.pendingToInvoice != null ? sSupp.pendingToInvoice : invQty;
    const netAtRepack = sSupp.sentToRepack != null
      ? (sSupp.sentToRepack - (sSupp.receivedFromRepack || 0)) : 0;
    const pkgsTotal   = pkgsInvoiced + pkgsPending + dumped + netAtRepack;
    const pkgsDen     = pkgsTotal || 1;

    data[s] = {
      pkgsInvoiced,
      pkgsPending,
      pkgsTotal,
      salesGross, adjAmt, netSales,
      pAdjQty:  sum(fpAj, 'Pend_Adj_Pkgs'),
      pAdjAmt:  sum(fpAj, 'Pend_Adj_Amount'),
      expenses: expMap,
      expTotal, wiresTotal,
      balance:  netSales - expTotal - wiresTotal,
      dumped,
      netAtRepack,
      avgPriceGross: salesGross / pkgsDen,
      avgPriceNet:   netSales   / pkgsDen,
    };
  }

  // Conceptos de gasto (sin wires), ordenados por total descendente
  const conceptTotals = {};
  for (const s of seasons)
    for (const [c, v] of Object.entries(data[s].expenses))
      if (!WIRES.has(c)) conceptTotals[c] = (conceptTotals[c] || 0) + v;

  const concepts = Object.keys(conceptTotals).sort((a, b) => conceptTotals[b] - conceptTotals[a]);

  res.json({ seasons, data, concepts });
});

// ── Reporte de Ajustes: anota Año_Post y detecta fuera de temporada ───────────
app.get('/api/adj-season-report', async (req, res) => {
  const now   = new Date();
  const dFrom = req.query.dFrom || `1/1/${now.getFullYear() - 2}`;
  const dTo   = req.query.dTo   || `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()}`;

  const parseYear = s => { const p = s.trim().split('/'); return parseInt(p[p.length - 1]); };
  const fromYear  = parseYear(dFrom);
  const toYear    = parseYear(dTo);

  // Llama el API una vez por año para poder anotar en qué año se posteó cada ajuste
  const calls = [];
  for (let y = fromYear; y <= toYear; y++) {
    const yFrom = y === fromYear ? dFrom : `1/1/${y}`;
    const yTo   = y === toYear   ? dTo   : `12/31/${y}`;
    calls.push({ year: y, url: `GrwAdjByPostDateAPI.aspx?dFrom=${yFrom}&dTo=${yTo}` });
  }

  const shipFrom = `1/1/${fromYear - 1}`;

  const [chunks, shipRaw] = await Promise.all([
    Promise.all(
      calls.map(({ year, url }) =>
        axios.get(`${BASE_URL}/${url}`, axiosOpts)
          .then(r => (Array.isArray(r.data) ? r.data : [])
            .filter(rec => rec['Season_Name'] && rec['Season_Name'] !== 'No Data')
            .map(rec => ({ ...rec, Año_Post: year }))
          )
          .catch(() => [])
      )
    ),
    apiCall(`GrwNetSalesByShipDateAPI.aspx?dFrom=${shipFrom}&dTo=${dTo}`)
  ]);

  const shipMap = {};
  for (const rec of shipRaw) {
    const ord = rec['Order_No.'];
    if (ord && rec['Ship_Date'] && !shipMap[ord]) {
      const d = new Date(rec['Ship_Date']);
      shipMap[ord] = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    }
  }

  const seasonEndYear = name => {
    const parts = String(name).trim().split(/[-\/]/);
    const last  = parts[parts.length - 1].trim();
    const n     = parseInt(last);
    return n < 100 ? 2000 + n : n;
  };

  const troubleMap = loadTrouble();
  const fmtMDY = s => {
    if (!s) return null;
    const [m, d, y] = s.split('/');
    return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
  };
  const parseDMY = s => {
    if (!s || typeof s !== 'string') return null;
    const p = s.split('/');
    if (p.length !== 3) return null;
    return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
  };

  const all = chunks.flat().map(r => {
    const sName     = renameSeason(r['Season_Name']);
    const postY     = r['Año_Post'];
    const sEndY     = seasonEndYear(sName);
    const shipDate  = shipMap[r['Order_No.']] || null;
    const tbl       = troubleMap[String(r['Trouble_No.'])] || null;
    const ajuste    = tbl ? (fmtMDY(tbl.posted) || null) : null;
    const d1        = parseDMY(shipDate);
    const d2        = parseDMY(ajuste);
    const dias      = (d1 && d2) ? Math.round((d2 - d1) / 86400000) : null;
    return {
      ...r,
      Season_Name:    sName,
      Año_Fin_Temp:   shipDate || sEndY,
      Año_Post:       ajuste || postY,
      Complaint_Date:  tbl ? fmtMDY(tbl.complaint) : null,
      Trouble_Status:  tbl ? tbl.status : null,
      Dias:            dias,
    };
  });

  res.json(all);
});

app.get('/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Sales by Season PDF — genera y descarga on-demand ─────────────────────────
app.get('/report/sales-by-season', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const { buildPDF } = require('./generate-pdf');
    const apiRes = await axios.get(`http://localhost:${PORT}/api/statement-by-season`,
      { httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) });
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape',
      margins: { top: 40, bottom: 40, left: 36, right: 36 } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="H2E_Sales_by_Season.pdf"`);
    doc.pipe(res);
    buildPDF(doc, apiRes.data);
  } catch (err) {
    console.error('PDF error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard-style PDF routes ────────────────────────────────────────────────
{
  const PDFDocument = require('pdfkit');
  const pdfGen      = require('./pdf-generators');

  const mkPDF = (res, fname, layout, buildFn) => {
    const doc = new PDFDocument({ size: 'LETTER', layout,
      margins: { top: 40, bottom: 0, left: 36, right: 36 } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
    doc.pipe(res);
    buildFn(doc);
  };

  const selfGet = url =>
    axios.get(`http://localhost:${PORT}${url}`, { httpsAgent: agent, timeout: 30000 });

  // Flat table modules
  for (const [id, cfg] of Object.entries(pdfGen.FLAT)) {
    const apiEp = pdfGen.FLAT_API[id];
    app.get(`/report/${id}`, async (req, res) => {
      try {
        const apiQ = { ...req.query }; delete apiQ.sortCol; delete apiQ.sortDir;
        const qs  = new URLSearchParams(apiQ).toString();
        const { data } = await selfGet(apiEp + (qs ? '?' + qs : ''));
        let rows = Array.isArray(data) ? data : [];
        if (!rows.length) return res.status(204).end();

        let cols      = Object.keys(rows[0]);
        let amtCols   = cfg.amtCols;
        let numCols   = cfg.numCols;
        let shortCols = [];

        const sortCol = req.query.sortCol;
        const sortDir = parseInt(req.query.sortDir) || 1;
        if (sortCol) {
          rows.sort((a, b) => {
            const va = a[sortCol], vb = b[sortCol];
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortDir;
            return String(va ?? '').localeCompare(String(vb ?? '')) * sortDir;
          });
        }

        if (id === 'adj-report') {
          const KEY = {
            'Season_Name':    'Season',    'Trouble_No.':    'Trouble',
            'Trouble_Reason': 'Reason',    'Order_No.':      'Order',
            'Commodity_Name': 'Commodity', 'Variety_Name':   'Variety',
            'Size_Name':      'Size',      'Label_Name':     'Label',
            'Qty':            'Qty',       'Amount':         'Amount',
            'Año_Fin_Temp':   'Ship Date',
            'Complaint_Date': 'Open Date',
            'Año_Post':       'Adj. Date',
            'Dias':           'Days',
          };
          rows      = rows.map(r => Object.fromEntries(Object.entries(KEY).map(([k, label]) => [label, r[k] ?? null])));
          cols      = Object.values(KEY);
          amtCols   = ['Amount'];
          numCols   = ['Qty', 'Days'];
        }

        const layout = cols.length > 6 ? 'landscape' : 'portrait';
        let subtitle = '';
        if (req.query.dFrom) subtitle = `${req.query.dFrom} – ${req.query.dTo || 'today'}`;
        else if (req.query.dAsOf) subtitle = `As of: ${req.query.dAsOf}`;
        const fname = `H2E_${id}_${new Date().toISOString().slice(0, 10)}`;
        mkPDF(res, fname, layout, doc =>
          pdfGen.buildFlatTablePDF(doc, { title: cfg.title, subtitle, cols, rows,
            amtCols, numCols, shortCols }));
      } catch (err) {
        console.error('PDF error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }

  // Statement by Season
  app.get('/report/stmt-by-season', async (req, res) => {
    try {
      const { data } = await selfGet('/api/statement-by-season');
      const fname = `H2E_Statement_by_Season_${new Date().toISOString().slice(0, 10)}`;
      mkPDF(res, fname, 'landscape', doc => pdfGen.buildStatementBySeasonPDF(doc, data));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Expenses by Season
  app.get('/report/expenses-season', async (req, res) => {
    try {
      const qs = new URLSearchParams(req.query).toString();
      const { data } = await selfGet('/api/expenses-by-season' + (qs ? '?' + qs : ''));
      const fname = `H2E_Expenses_by_Season_${new Date().toISOString().slice(0, 10)}`;
      mkPDF(res, fname, 'landscape', doc => pdfGen.buildExpensesBySeasonPDF(doc, data));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Adj Report — POST with pre-filtered/sorted rows from client
  app.post('/report/adj-report', (req, res) => {
    try {
      let rows = Array.isArray(req.body) ? req.body : [];
      if (!rows.length) return res.status(204).end();
      const KEY = {
        'Season_Name':    'Season',    'Trouble_No.':    'Trouble',
        'Trouble_Reason': 'Reason',    'Order_No.':      'Order',
        'Commodity_Name': 'Commodity', 'Variety_Name':   'Variety',
        'Size_Name':      'Size',      'Label_Name':     'Label',
        'Qty':            'Qty',       'Amount':         'Amount',
        'Año_Fin_Temp':   'Ship Date',  'Complaint_Date':  'Open Date',
        'Año_Post':       'Adj. Date',  'Dias':            'Days',
      };
      rows = rows.map(r => Object.fromEntries(Object.entries(KEY).map(([k, l]) => [l, r[k] ?? null])));
      const cols = Object.values(KEY);
      const fname = `H2E_adj-report_${new Date().toISOString().slice(0, 10)}`;
      mkPDF(res, fname, 'landscape', doc =>
        pdfGen.buildFlatTablePDF(doc, { title: 'Adj Report', subtitle: '', cols, rows,
          amtCols: ['Amount'], numCols: ['Qty', 'Days'] }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GWR Statement (single season)
  app.get('/report/statement', async (req, res) => {
    try {
      const qs = new URLSearchParams(req.query).toString();
      const { data } = await selfGet('/api/statement' + (qs ? '?' + qs : ''));
      const season = (req.query.season || 'season').replace(/\//g, '-');
      const fname  = `H2E_GWR_Statement_${season}_${new Date().toISOString().slice(0, 10)}`;
      mkPDF(res, fname, 'portrait', doc => pdfGen.buildGWRStatementPDF(doc, data));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

// ── Nacional (CBE): lee el Excel del folder ───────────────────────────────────
{
  const XLSX             = require('xlsx');
  const multer           = require('multer');
  const XLSX_FILE        = path.join(__dirname, 'Info para Claude', 'Reportes', 'Nacional', 'Ventas CBE-H2E 2.xlsx');
  const COMPROBANTES_DIR = path.join(__dirname, 'comprobantes');
  const MANIFIESTOS_DIR  = path.join(__dirname, 'manifiestos');

  if (!fs.existsSync(COMPROBANTES_DIR)) fs.mkdirSync(COMPROBANTES_DIR);
  if (!fs.existsSync(MANIFIESTOS_DIR))  fs.mkdirSync(MANIFIESTOS_DIR);

  const mkUpload = (dir, prefix) => multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.pdf';
        cb(null, `${prefix}-${req.params.num}${ext}`);
      }
    }),
    limits: { fileSize: 20 * 1024 * 1024 }
  });

  const uploadComprobante = mkUpload(COMPROBANTES_DIR, 'comp');
  const uploadManifiesto  = mkUpload(MANIFIESTOS_DIR,  'manif');

  const parseNum = v => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/[\$,\s]/g, '');
    if (s === '-' || s === '') return 0;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  // Product sheets: row[0] = real column headers, row[1+] = data
  const parseProductSheet = (wb, name) => {
    if (!wb.SheetNames.includes(name)) return [];
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null, raw: false });
    if (raw.length < 2) return [];

    const keyToLabel = {};
    for (const [k, v] of Object.entries(raw[0])) {
      const label = v ? String(v).trim() : null;
      if (label) keyToLabel[k] = label;
    }

    const NUM = new Set(['Enviadas','Reportadas','x reportar','Precio','$ KG','Venta','Gastos','Subtotal','Comisión','Comisión CBE','Total','Estimado','Real + Est']);

    const rows = raw.slice(1).map(r => {
      const row = {};
      for (const [k, v] of Object.entries(r)) {
        const label = keyToLabel[k];
        if (!label) continue;
        row[label] = NUM.has(label) ? parseNum(v) : (v ? String(v).trim() : null);
      }
      return row;
    }).filter(r => r['Fecha'] || r['Manifiesto']);

    // Sort by Fecha descending (most recent first)
    // Handles ISO "2026-04-16" (Railway/Linux) and M/D/YY "4/16/26" (Windows)
    rows.sort((a, b) => String(b['Fecha'] || '').localeCompare(String(a['Fecha'] || '')));
    return rows;
  };

  // Acum sheet: row[0] = headers (venta, pagos, …), row[1+] = product rows
  const parseAcum = wb => {
    if (!wb.SheetNames.includes('acum')) return [];
    const raw = XLSX.utils.sheet_to_json(wb.Sheets['acum'], { defval: null, raw: false });
    if (raw.length < 2) return [];

    const keyToLabel = { 'Balance 2da Etapa': 'Producto' };
    for (const [k, v] of Object.entries(raw[0])) {
      const label = v ? String(v).trim() : null;
      if (label) keyToLabel[k] = label;
    }

    return raw.slice(1).map(r => {
      const row = {};
      for (const [k, v] of Object.entries(r)) {
        const label = keyToLabel[k];
        if (!label) continue;
        row[label] = label === 'Producto' ? (v ? String(v).trim() : null) : parseNum(v);
      }
      return row;
    }).filter(r => r['Producto']);
  };

  // Estado de Cuenta sheets: row[0] = aggregate, row[1] = headers, row[2+] = data
  const parseEstadoDeCuenta = (wb, name) => {
    if (!wb.SheetNames.includes(name)) return [];
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null, raw: false });
    if (raw.length < 3) return [];

    const hdrRow = raw[1];
    const keyToLabel = {};
    const seen = new Set();
    for (const [k, v] of Object.entries(hdrRow)) {
      let label = v ? String(v).trim() : null;
      if (!label) continue;
      if (label === 'Fecha')  label = seen.has('Fecha')  ? 'Fecha Pago'  : 'Fecha';
      if (label === 'Monto')  label = seen.has('Monto')  ? 'Monto Pago'  : 'Monto';
      if (label === '0')      label = 'Balance';
      keyToLabel[k] = label;
      seen.add(label);
    }

    const NUM_EDC = new Set(['Cajas','Precio','Gastos','Monto','Monto Pago','Balance']);

    return raw.slice(2).map(r => {
      const row = {};
      for (const [k, v] of Object.entries(r)) {
        const label = keyToLabel[k];
        if (!label) continue;
        row[label] = NUM_EDC.has(label) ? parseNum(v) : (v ? String(v).trim() : null);
      }
      return row;
    }).filter(r => r['Manifiesto'] || r['Fecha']);
  };

  const scanDir = (dir, prefix) => {
    const map = {};
    try {
      for (const f of fs.readdirSync(dir)) {
        const m = f.match(new RegExp(`^${prefix}-(\\d+)\\.`, 'i'));
        if (m) map[m[1]] = f;
      }
    } catch(e) {}
    return map;
  };

  app.get('/api/nacional', (req, res) => {
    try {
      const wb       = XLSX.readFile(XLSX_FILE);
      const products = ['Tomatillo', 'Morrón', 'Roma'];
      const sheets   = {};
      for (const p of products) sheets[p] = parseProductSheet(wb, p);
      res.json({ products, sheets, acum: parseAcum(wb), manifiestos: scanDir(MANIFIESTOS_DIR, 'manif') });
    } catch (err) {
      console.error('[Nacional]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/cobros', (req, res) => {
    try {
      const wb       = XLSX.readFile(XLSX_FILE);
      const products = ['Tomatillo', 'Morrón', 'Roma'];
      const sheetMap = { Tomatillo: 'Estado de Cuenta T', Roma: 'Estado de Cuenta R', 'Morrón': 'Estado de Cuenta M' };
      const sheets   = {};
      for (const p of products) sheets[p] = parseEstadoDeCuenta(wb, sheetMap[p]);
      res.json({ products, sheets, comprobantes: scanDir(COMPROBANTES_DIR, 'comp') });
    } catch (err) {
      console.error('[Cobros]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/manifiesto-pdf/:num', (req, res) => {
    const fname = scanDir(MANIFIESTOS_DIR, 'manif')[req.params.num];
    if (!fname) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(MANIFIESTOS_DIR, fname));
  });

  app.post('/api/upload-manifiesto/:num', (req, res) => {
    uploadManifiesto.single('file')(req, res, err => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No file' });
      res.json({ ok: true, file: req.file.filename });
    });
  });

  app.post('/api/upload-comprobante/:num', (req, res) => {
    uploadComprobante.single('file')(req, res, err => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No file' });
      res.json({ ok: true, file: req.file.filename });
    });
  });

  app.get('/api/comprobante/:num', (req, res) => {
    const fname = scanDir(COMPROBANTES_DIR, 'comp')[req.params.num];
    if (!fname) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(COMPROBANTES_DIR, fname));
  });
}

app.listen(PORT, () => {
  console.log(`\n  ✅  iSolve Dashboard  →  http://localhost:${PORT}\n`);
});
