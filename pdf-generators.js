'use strict';
const fs   = require('fs');
const path = require('path');

const LOGO_PATH = path.join(__dirname, 'public', 'logo.png');
const M = 36; // page margin in points

const C = {
  green:  '#1b4332',
  lgreen: '#d8f3dc',
  cgreen: '#c8edce',
  alt:    '#f6fcf8',
  white:  '#ffffff',
  gray:   '#64748b',
  text:   '#1e293b',
  red:    '#dc2626',
  blue:   '#1e3a8a',
};

const fC = n => {
  if (n == null) return '—';
  const abs = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
  return n < 0 ? `(${abs})` : abs;
};
const fN = n => (n != null ? Math.round(n).toLocaleString('en-US') : '—');

// ── Shared page helpers ───────────────────────────────────────────────────────
function drawHeader(doc, title, subtitle) {
  const W = doc.page.width;
  if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, M, 18, { height: 36 });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(C.green)
     .text(title, 160, 22, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(C.gray)
     .text('Crown City Trading  —  H2E Mexico SA de CV', 160, 42)
     .text(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 160, 54);
  if (subtitle)
    doc.font('Helvetica').fontSize(8).fillColor(C.green)
       .text(subtitle, 160, 65, { lineBreak: false });
  doc.moveTo(M, 72).lineTo(W - M, 72).strokeColor(C.green).lineWidth(1).stroke();
}

function drawFooter(doc) {
  const W = doc.page.width;
  const Y = doc.page.height - 28;
  doc.font('Helvetica').fontSize(7.5).fillColor(C.gray)
     .text('H2E iSolve Dashboard  |  Crown City Trading  |  Confidential',
           M, Y, { width: W - M * 2, align: 'center' });
}

// ── Generic flat-table PDF ────────────────────────────────────────────────────
function buildFlatTablePDF(doc, { title, subtitle = '', cols, rows, amtCols = [], numCols = [] }) {
  const amtSet = new Set(amtCols);
  const numSet = new Set(numCols);
  const W      = doc.page.width;
  const availW = W - M * 2;

  // Widths: usd=60pt, num=42pt, text splits remainder
  const raw   = cols.map(c => amtSet.has(c) ? 60 : numSet.has(c) ? 42 : 0);
  const fixed = raw.reduce((s, w) => s + w, 0);
  const textN = raw.filter(w => w === 0).length;
  const textW = textN > 0 ? Math.max(28, (availW - fixed) / textN) : 0;
  let cw = raw.map(w => w === 0 ? textW : w);
  const tot = cw.reduce((s, w) => s + w, 0);
  if (tot > availW) { const sc = availW / tot; cw = cw.map(w => w * sc); }

  const ROW_H  = 20;
  const HEAD_H = 26;
  const isRight = c => amtSet.has(c) || numSet.has(c);

  const fmtVal = (c, v) => {
    if (v == null || v === '') return '—';
    if (amtSet.has(c) && typeof v === 'number') return fC(v);
    if (numSet.has(c) || typeof v === 'number') return fN(v);
    return String(v);
  };

  // Only total USD columns
  const totals = {};
  cols.forEach(c => {
    if (amtSet.has(c))
      totals[c] = rows.reduce((s, r) => s + (parseFloat(r[c]) || 0), 0);
  });

  const drawHead = y => {
    let x = M;
    cols.forEach((col, i) => {
      doc.rect(x, y, cw[i], HEAD_H).fill(C.green);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.white)
         .text(col.replace(/_/g, ' '), x + 3, y + (HEAD_H - 9) / 2,
               { width: cw[i] - 6, align: isRight(col) ? 'right' : 'left', lineBreak: false });
      x += cw[i];
    });
    return y + HEAD_H;
  };

  drawHeader(doc, title, subtitle);
  let curY = drawHead(84);

  rows.forEach((row, idx) => {
    if (curY + ROW_H > doc.page.height - 50) {
      drawFooter(doc); doc.addPage(); drawHeader(doc, title, subtitle); curY = drawHead(84);
    }
    const bg = idx % 2 === 0 ? C.alt : C.white;
    let x = M;
    cols.forEach((col, ci) => {
      const v     = row[col];
      const first = ci === 0;
      doc.rect(x, curY, cw[ci], ROW_H).fill(first ? C.lgreen : bg);
      const val   = fmtVal(col, v);
      const color = (amtSet.has(col) && typeof v === 'number' && v < 0) ? C.red
                  : first ? C.green : C.text;
      doc.font(first ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(color)
         .text(val, x + 4, curY + (ROW_H - 8) / 2,
               { width: cw[ci] - 8, align: isRight(col) ? 'right' : 'left', lineBreak: false });
      x += cw[ci];
    });
    curY += ROW_H;
  });

  // TOTAL row (USD columns only)
  if (Object.keys(totals).length > 0) {
    if (curY + ROW_H + 2 > doc.page.height - 50) {
      drawFooter(doc); doc.addPage(); drawHeader(doc, title, subtitle); curY = drawHead(84);
    }
    let x = M;
    cols.forEach((col, ci) => {
      doc.rect(x, curY, cw[ci], ROW_H + 2).fill(C.green);
      const val = ci === 0 ? 'TOTAL'
                : totals[col] != null ? fC(totals[col]) : '';
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
         .text(val, x + 4, curY + (ROW_H - 6) / 2,
               { width: cw[ci] - 8, align: ci === 0 ? 'left' : 'right', lineBreak: false });
      x += cw[ci];
    });
  }

  drawFooter(doc);
  doc.end();
}

// ── Statement by Season PDF ───────────────────────────────────────────────────
function buildStatementBySeasonPDF(doc, { seasons, data, concepts }) {
  const W      = doc.page.width;
  const availW = W - M * 2;

  const isClosed = s => parseInt(String(s).trim().split('/').pop()) <= 2025;

  const get = (s, key) => {
    const sd = data[s];
    if (!sd) return 0;
    if (key.startsWith('exp_')) return sd.expenses[key.slice(4)] || 0;
    return sd[key] || 0;
  };

  const CONCEPT_W = 130;
  const nData     = seasons.length + 1;           // seasons + Total col
  const rawColW   = (availW - CONCEPT_W) / nData;
  const colW      = Math.max(48, rawColW);
  let fw = [CONCEPT_W, ...Array(nData).fill(colW)];
  const totalW = fw.reduce((s, w) => s + w, 0);
  if (totalW > availW) { const sc = availW / totalW; fw = fw.map(w => w * sc); }

  const nS     = seasons.length;
  const fs_    = nS > 8 ? 6.5 : nS > 6 ? 7 : 7.5;
  const ROW_H  = nS > 8 ? 14 : nS > 6 ? 15 : 16;
  const HEAD_H = nS > 8 ? 20 : 22;

  const ROWS = [
    { type: 'section', label: 'PACKAGES' },
    { type: 'data',  label: 'Pkgs Invoiced',       key: 'pkgsInvoiced',    fmt: 'qty' },
    { type: 'data',  label: '  Dumped, Etc.',       key: 'dumped',          fmt: 'qty', sub: true },
    { type: 'data',  label: '  Repack Shrinkage',   key: 'netAtRepack',     fmt: 'qty', sub: true },
    { type: 'data',  label: '  Pending to Invoice', key: 'pkgsPending',     fmt: 'qty', sub: true },
    { type: 'total', label: 'Total Pkgs Received',  key: 'pkgsTotal',       fmt: 'qty' },
    { type: 'section', label: 'SALES' },
    { type: 'data',  label: 'Gross Sales',          key: 'salesGross',      fmt: 'usd' },
    { type: 'data',  label: '  - Adjustments',      key: 'adjAmt',          fmt: 'usd', sub: true },
    { type: 'total', label: '= Net Sales',          key: 'netSales',        fmt: 'usd' },
    { type: 'data',  label: '  Avg Price (Gross)',  key: 'avgPriceGross',   fmt: 'usd', sub: true,
      totFn: d => { const g = seasons.reduce((a,x) => a+(d[x]?.salesGross||0),0); const p = seasons.reduce((a,x) => a+(d[x]?.pkgsTotal||0),0); return p ? g/p : 0; } },
    { type: 'data',  label: '  Avg Price (Net)',    key: 'avgPriceNet',     fmt: 'usd', sub: true,
      totFn: d => { const n = seasons.reduce((a,x) => a+(d[x]?.netSales||0),0); const p = seasons.reduce((a,x) => a+(d[x]?.pkgsTotal||0),0); return p ? n/p : 0; } },
    { type: 'data',  label: '  Pending Adj (Qty)',  key: 'pAdjQty',         fmt: 'qty', sub: true },
    { type: 'data',  label: '  Pending Adj ($)',    key: 'pAdjAmt',         fmt: 'usd', sub: true },
    { type: 'section', label: 'EXPENSES' },
    ...concepts.map(c => ({ type: 'data', label: c, key: `exp_${c}`, fmt: 'usd', sub: true })),
    { type: 'total', label: 'Total Expenses',       key: 'expTotal',        fmt: 'usd' },
    { type: 'section', label: 'WIRES' },
    { type: 'data',  label: '  Liquidation',        key: 'exp_Liquidation', fmt: 'usd', sub: true },
    { type: 'data',  label: '  Pick & Pack',        key: 'exp_Pick & Pack', fmt: 'usd', sub: true },
    { type: 'data',  label: '  Advances',           key: 'exp_Advances',    fmt: 'usd', sub: true },
    { type: 'total', label: 'Total Wires',          key: 'wiresTotal',      fmt: 'usd' },
    { type: 'data',  label: 'Ajustes', fmt: 'usd',
      valFn: s => isClosed(s) ? -(data[s]?.balance || 0) : 0 },
    { type: 'balance', label: 'BALANCE', fmt: 'usd',
      valFn: s => { const b = data[s]?.balance || 0; return b + (isClosed(s) ? -b : 0); } },
  ];

  const drawHead = y => {
    let x = M;
    ['Concepto', ...seasons, 'Total'].forEach((col, i) => {
      const w  = fw[i];
      const bg = i === seasons.length + 1 ? '#0d3321' : C.green;
      doc.rect(x, y, w, HEAD_H).fill(bg);
      doc.font('Helvetica-Bold').fontSize(fs_).fillColor(C.white)
         .text(col, x + 2, y + (HEAD_H - fs_) / 2,
               { width: w - 4, align: i === 0 ? 'left' : 'right', lineBreak: false });
      x += w;
    });
    return y + HEAD_H;
  };

  drawHeader(doc, 'Statement by Season');
  let curY = drawHead(84);

  for (const row of ROWS) {
    if (curY + ROW_H > doc.page.height - 50) {
      drawFooter(doc); doc.addPage(); drawHeader(doc, 'Statement by Season'); curY = drawHead(84);
    }

    if (row.type === 'section') {
      doc.rect(M, curY, W - M * 2, ROW_H).fill(C.green);
      doc.font('Helvetica-Bold').fontSize(fs_).fillColor(C.white)
         .text(row.label, M + 4, curY + (ROW_H - fs_) / 2, { lineBreak: false });
      curY += ROW_H;
      continue;
    }

    const isBalance = row.type === 'balance';
    const isTotal   = row.type === 'total';
    const rowFmt    = v => row.fmt === 'qty' ? fN(v) : fC(v);

    const vals   = row.valFn ? seasons.map(s => row.valFn(s)) : seasons.map(s => get(s, row.key));
    const rowTot = row.totFn ? row.totFn(data) : vals.reduce((a, b) => a + b, 0);
    const rowBg  = isBalance ? (rowTot >= 0 ? C.green : '#7f1d1d') : null;

    // Concept cell
    const lblBg = isBalance ? rowBg : isTotal ? C.lgreen : C.white;
    const lblTx = isBalance ? C.white : isTotal ? '#166534' : (row.sub ? C.gray : C.text);
    doc.rect(M, curY, fw[0], ROW_H).fill(lblBg);
    doc.font(isTotal || isBalance ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs_).fillColor(lblTx)
       .text(row.label, M + 3, curY + (ROW_H - fs_) / 2, { width: fw[0] - 6, lineBreak: false });

    // Data cells
    let x = M + fw[0];
    vals.forEach((v, i) => {
      const w   = fw[i + 1];
      const bg  = isBalance ? rowBg : isTotal ? C.cgreen : (i % 2 === 0 ? C.alt : C.white);
      const color = isBalance ? C.white
                  : (typeof v === 'number' && v < 0 && row.fmt === 'usd') ? C.red
                  : isTotal ? '#166534' : C.text;
      doc.rect(x, curY, w, ROW_H).fill(bg);
      doc.font(isTotal || isBalance ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs_).fillColor(color)
         .text(rowFmt(v), x + 2, curY + (ROW_H - fs_) / 2,
               { width: w - 4, align: 'right', lineBreak: false });
      x += w;
    });

    // Total column
    const totW    = fw[fw.length - 1];
    const totBg   = isBalance ? rowBg : isTotal ? '#d8f3dc' : C.alt;
    const totColor = isBalance ? C.white
                   : (rowTot < 0 && row.fmt === 'usd') ? C.red
                   : isTotal ? '#166534' : C.text;
    doc.rect(x, curY, totW, ROW_H).fill(totBg);
    doc.font(isTotal || isBalance ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs_).fillColor(totColor)
       .text(rowFmt(rowTot), x + 2, curY + (ROW_H - fs_) / 2,
             { width: totW - 4, align: 'right', lineBreak: false });

    curY += ROW_H;
  }

  drawFooter(doc);
  doc.end();
}

// ── Expenses by Season PDF ────────────────────────────────────────────────────
function buildExpensesBySeasonPDF(doc, { seasons, rows, totals, grandTotal, wires, wireTotals, wireGrandTotal }) {
  const W      = doc.page.width;
  const availW = W - M * 2;
  const CONCEPT_W = 70;
  const TOTAL_W   = 58;
  const nS        = seasons.length;
  const rawSeasonW = (availW - CONCEPT_W - TOTAL_W) / Math.max(1, nS);
  const seasonW    = Math.max(40, rawSeasonW);
  const fs_        = nS > 7 ? 6.5 : 7;
  const ROW_H      = 18;
  const HEAD_H     = 22;

  let allW = [CONCEPT_W, ...Array(nS).fill(seasonW), TOTAL_W];
  const tot = allW.reduce((s, w) => s + w, 0);
  if (tot > availW) { const sc = availW / tot; allW = allW.map(w => w * sc); }
  const fw = allW;

  const drawPivotHead = (y, label, bg) => {
    let x = M;
    [label, ...seasons, 'Total'].forEach((col, i) => {
      const w   = fw[i];
      const colBg = col === 'Total' ? '#0d3321' : bg;
      doc.rect(x, y, w, HEAD_H).fill(colBg);
      doc.font('Helvetica-Bold').fontSize(fs_).fillColor(C.white)
         .text(col, x + 2, y + (HEAD_H - fs_) / 2,
               { width: w - 4, align: i === 0 ? 'left' : 'right', lineBreak: false });
      x += w;
    });
    return y + HEAD_H;
  };

  const drawDataRow = (y, row, idx) => {
    const bg = idx % 2 === 0 ? C.alt : C.white;
    let x = M;
    doc.rect(x, y, fw[0], ROW_H).fill(C.lgreen);
    doc.font('Helvetica-Bold').fontSize(fs_).fillColor(C.green)
       .text(row.concept, x + 3, y + (ROW_H - fs_) / 2, { width: fw[0] - 6, lineBreak: false });
    x += fw[0];
    seasons.forEach((s, i) => {
      const w = fw[i + 1];
      doc.rect(x, y, w, ROW_H).fill(bg);
      doc.font('Helvetica').fontSize(fs_).fillColor(C.text)
         .text(fC(row.amounts?.[s] || 0), x + 2, y + (ROW_H - fs_) / 2,
               { width: w - 4, align: 'right', lineBreak: false });
      x += w;
    });
    const totW = fw[fw.length - 1];
    doc.rect(x, y, totW, ROW_H).fill(C.cgreen);
    doc.font('Helvetica-Bold').fontSize(fs_).fillColor('#166534')
       .text(fC(row.total), x + 2, y + (ROW_H - fs_) / 2,
             { width: totW - 4, align: 'right', lineBreak: false });
    return y + ROW_H;
  };

  const drawTotRow = (y, sTotals, gTotal, bg) => {
    let x = M;
    doc.rect(x, y, fw[0], ROW_H + 2).fill(bg);
    doc.font('Helvetica-Bold').fontSize(fs_).fillColor(C.white)
       .text('TOTAL', x + 3, y + (ROW_H - fs_) / 2, { lineBreak: false });
    x += fw[0];
    seasons.forEach((s, i) => {
      const w = fw[i + 1];
      doc.rect(x, y, w, ROW_H + 2).fill(bg);
      doc.font('Helvetica-Bold').fontSize(fs_).fillColor(C.white)
         .text(fC(sTotals[s] || 0), x + 2, y + (ROW_H - fs_) / 2,
               { width: w - 4, align: 'right', lineBreak: false });
      x += w;
    });
    const totW = fw[fw.length - 1];
    doc.rect(x, y, totW, ROW_H + 2).fill(bg);
    doc.font('Helvetica-Bold').fontSize(fs_).fillColor(C.white)
       .text(fC(gTotal), x + 2, y + (ROW_H - fs_) / 2,
             { width: totW - 4, align: 'right', lineBreak: false });
    return y + ROW_H + 2;
  };

  const pageCheck = (y, h, title, sectionLabel, sectionBg) => {
    if (y + h > doc.page.height - 50) {
      drawFooter(doc); doc.addPage(); drawHeader(doc, title);
      return drawPivotHead(84, sectionLabel, sectionBg);
    }
    return y;
  };

  drawHeader(doc, 'Expenses by Season');
  let curY = drawPivotHead(84, 'EXPENSES', C.green);

  rows.forEach((row, idx) => {
    curY = pageCheck(curY, ROW_H, 'Expenses by Season', 'EXPENSES', C.green);
    curY = drawDataRow(curY, row, idx);
  });
  curY = pageCheck(curY, ROW_H + 2, 'Expenses by Season', 'EXPENSES', C.green);
  curY = drawTotRow(curY, totals, grandTotal, C.green);

  curY += 12;
  if (curY + HEAD_H > doc.page.height - 50) {
    drawFooter(doc); doc.addPage(); drawHeader(doc, 'Expenses by Season'); curY = 84;
  }
  curY = drawPivotHead(curY, 'WIRES', C.blue);

  wires.forEach((row, idx) => {
    curY = pageCheck(curY, ROW_H, 'Expenses by Season', 'WIRES', C.blue);
    curY = drawDataRow(curY, row, idx);
  });
  curY = pageCheck(curY, ROW_H + 2, 'Expenses by Season', 'WIRES', C.blue);
  drawTotRow(curY, wireTotals, wireGrandTotal, C.blue);

  drawFooter(doc);
  doc.end();
}

// ── GWR Statement PDF (single season) ────────────────────────────────────────
function buildGWRStatementPDF(doc, d) {
  const W        = doc.page.width;
  const isClosed = parseInt(String(d.season).trim().split('/').pop()) <= 2025;
  const ajustes  = isClosed ? -(d.balanceStd) : 0;
  const balFinal = d.balanceStd + ajustes;
  const pk = d.packages;
  const sl = d.sales;

  const LW    = 190;
  const VW    = W - M * 2 - LW;
  const ROW_H = 20;

  const drawSection = (y, label) => {
    doc.rect(M, y, W - M * 2, 24).fill(C.green);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white)
       .text(label, M + 8, y + 7, { lineBreak: false });
    return y + 24;
  };

  const drawColHdr = (y, ...hdrs) => {
    const vw = VW / Math.max(1, hdrs.length);
    doc.rect(M, y, LW, 20).fill('#0d3321');
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white)
       .text('Description', M + 4, y + 6, { width: LW - 8, lineBreak: false });
    hdrs.forEach((h, i) => {
      doc.rect(M + LW + i * vw, y, vw, 20).fill('#0d3321');
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white)
         .text(h, M + LW + i * vw + 2, y + 6, { width: vw - 4, align: 'right', lineBreak: false });
    });
    return y + 20;
  };

  let rowIdx = 0;
  const drawRow = (y, label, vals, { isTotal = false, isSub = false, nCols = 1 } = {}) => {
    const bg  = isTotal ? C.lgreen : rowIdx++ % 2 === 0 ? C.alt : C.white;
    const vw  = VW / Math.max(1, nCols);
    doc.rect(M, y, LW, ROW_H).fill(bg);
    doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
       .fillColor(isTotal ? '#166534' : C.text)
       .text(label, M + (isSub ? 16 : 4), y + (ROW_H - 8.5) / 2, { width: LW - 20, lineBreak: false });
    vals.forEach((v, i) => {
      doc.rect(M + LW + i * vw, y, vw, ROW_H).fill(isTotal ? C.cgreen : C.white);
      const color = isTotal ? '#166534' : (typeof v === 'number' && v < 0 ? C.red : C.text);
      doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(color)
         .text(v != null ? String(v) : '—', M + LW + i * vw + 2, y + (ROW_H - 8.5) / 2,
               { width: vw - 4, align: 'right', lineBreak: false });
    });
    return y + ROW_H;
  };

  drawHeader(doc, 'GWR Statement', `Season: ${d.season}  |  Post Date: ${d.asOf}`);
  let curY = 84;

  // Packages
  curY = drawSection(curY, 'PACKAGES');
  curY = drawColHdr(curY, 'Season to Date');
  curY = drawRow(curY, 'Packages Received', [fN(pk.receivedStd)], { isTotal: true });
  if (pk.sentToRepackStd      != null) curY = drawRow(curY, '- Sent to Repack',          [fN(pk.sentToRepackStd)],      { isSub: true });
  if (pk.receivedFromRepackStd != null) curY = drawRow(curY, '+ Received from Repack',   [fN(pk.receivedFromRepackStd)], { isSub: true });
  curY = drawRow(curY, '= Product for Sale', [fN(pk.productForSaleStd ?? pk.receivedStd)], { isTotal: true });
  if (pk.dumpedStd) curY = drawRow(curY, 'Dumped, Etc.',      [fN(pk.dumpedStd)],           { isSub: true });
  curY = drawRow(curY, 'Packages Invoiced',  [fN(pk.pkgsInvoicedStd)],    { isSub: true });
  curY = drawRow(curY, 'Pending to Invoice', [fN(pk.pendingToInvoiceStd)], { isSub: true });
  curY += 6;

  // Sales
  curY = drawSection(curY, 'SALES');
  curY = drawColHdr(curY, 'Packages', 'Amount');
  rowIdx = 0;
  curY = drawRow(curY, 'Invoicing', [fN(sl.invoicingQtyStd), fC(sl.invoicingAmtStd)], { nCols: 2 });
  curY = drawRow(curY, '- Adjustment', ['', fC(sl.adjAmtStd)],  { isSub: true, nCols: 2 });
  curY = drawRow(curY, '= Net Sales Total', ['', fC(sl.netStd)], { isTotal: true, nCols: 2 });
  if (sl.pAdjQty) curY = drawRow(curY, 'Pending Adjustments', [fN(sl.pAdjQty), fC(sl.pAdjAmt)], { isSub: true, nCols: 2 });
  curY = drawRow(curY, 'Avg Price (Gross)', ['', fC(sl.avgPriceGrossStd)], { isSub: true, nCols: 2 });
  curY = drawRow(curY, 'Avg Price (Net)',   ['', fC(sl.avgPriceNetStd)],   { isSub: true, nCols: 2 });
  curY += 6;

  // Expenses
  curY = drawSection(curY, 'EXPENSES');
  curY = drawColHdr(curY, 'Amount');
  rowIdx = 0;
  for (const e of d.expenses) {
    if (curY + ROW_H > doc.page.height - 50) {
      drawFooter(doc); doc.addPage();
      drawHeader(doc, 'GWR Statement', `Season: ${d.season} (cont.)`);
      curY = drawSection(84, 'EXPENSES (cont.)');
      curY = drawColHdr(curY, 'Amount');
    }
    curY = drawRow(curY, e.concept, [fC(e.std)]);
  }
  curY = drawRow(curY, 'Expenses Total', [fC(d.expTotStd)], { isTotal: true });
  curY += 6;

  // Balance
  if (curY + ROW_H * 3 > doc.page.height - 50) {
    drawFooter(doc); doc.addPage();
    drawHeader(doc, 'GWR Statement', `Season: ${d.season}`);
    curY = 84;
  }
  curY = drawSection(curY, 'BALANCE');
  rowIdx = 0;
  if (isClosed) {
    curY = drawRow(curY, 'Balance (Net Sales − Expenses)', [fC(d.balanceStd)]);
    curY = drawRow(curY, 'Ajustes',                        [fC(ajustes)],        { isSub: true });
  }

  const balLabel = isClosed ? 'Balance Final' : 'Balance';
  const balBg    = balFinal >= 0 ? C.green : '#7f1d1d';
  doc.rect(M, curY, W - M * 2, ROW_H + 4).fill(balBg);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white)
     .text(balLabel, M + 8, curY + (ROW_H + 4 - 11) / 2, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white)
     .text(fC(balFinal), M + LW, curY + (ROW_H + 4 - 11) / 2,
           { width: VW - 4, align: 'right', lineBreak: false });

  drawFooter(doc);
  doc.end();
}

// ── Module configs for flat tables ────────────────────────────────────────────
const FLAT = {
  'sales-ship': { title: 'Sales / Ship Date',   amtCols: ['Gross_Amt'],                  numCols: ['Ship_Qty', 'Inv_Qty'] },
  'sales-post': { title: 'Sales / Post Date',   amtCols: ['Amount', 'Avg_Price'],         numCols: ['Qty'] },
  'expenses':   { title: 'Expenses',            amtCols: ['Amount'],                      numCols: [] },
  'inventory':  { title: 'Inventory',           amtCols: ['Gross_Amount', 'Gross Amount'], numCols: ['Qty'] },
  'adj-post':   { title: 'Adj / Post Date',     amtCols: ['Amount', 'Adj_Amt'],           numCols: [] },
  'pend-adj':   { title: 'Pending Adjustments', amtCols: ['Pend_Adj_Amount', 'Adj_Amt'],  numCols: ['Pend_Adj_Pkgs'] },
  'adj-report': { title: 'Reporte de Ajustes',  amtCols: ['Amount', 'Adj_Amt'],           numCols: [] },
};

const FLAT_API = {
  'sales-ship': '/api/sales-ship-date',
  'sales-post': '/api/sales-post-date',
  'expenses':   '/api/expenses',
  'inventory':  '/api/inventory',
  'adj-post':   '/api/adj-post-date',
  'pend-adj':   '/api/pending-adj',
  'adj-report': '/api/adj-season-report',
};

module.exports = {
  buildFlatTablePDF, buildStatementBySeasonPDF,
  buildExpensesBySeasonPDF, buildGWRStatementPDF,
  FLAT, FLAT_API, drawHeader, drawFooter,
};
