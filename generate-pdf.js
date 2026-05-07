const PDFDocument = require('pdfkit');
const axios       = require('axios');
const fs          = require('fs');
const path        = require('path');

const OUT_PATH  = path.join(__dirname, 'public', 'H2E_Sales_by_Season.pdf');
const LOGO_PATH = path.join(__dirname, 'public', 'logo.png');
const API_URL   = 'http://localhost:3000/api/statement-by-season';

const GREEN  = '#1b4332';
const LGREEN = '#d8f3dc';
const WHITE  = '#ffffff';
const GRAY   = '#64748b';
const RED    = '#dc2626';

const fmtUSD = n => n != null && n !== 0
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
  : '—';
const fmtNum = n => n ? Math.round(n).toLocaleString('en-US') : '—';

const COLS = [
  { label: 'Season',             key: null,           fmt: 'str', w: 62 },
  { label: 'Pkgs\nReceived',     key: 'pkgsTotal',    fmt: 'num', w: 52 },
  { label: 'Pkgs\nInvoiced',     key: 'pkgsInvoiced', fmt: 'num', w: 52 },
  { label: 'Dumped\nEtc.',       key: 'dumped',       fmt: 'num', w: 46 },
  { label: 'Repack\nShrinkage',  key: 'netAtRepack',  fmt: 'num', w: 52 },
  { label: 'Gross Sales',        key: 'salesGross',   fmt: 'usd', w: 74 },
  { label: 'Avg Price\n(Gross)', compute: r => r.pkgsTotal ? r.salesGross / r.pkgsTotal : 0, fmt: 'usd', w: 58 },
  { label: 'Adjustments',        key: 'adjAmt',       fmt: 'usd', w: 66 },
  { label: 'Net Sales',          key: 'netSales',     fmt: 'usd', w: 74, bold: true },
  { label: 'Avg Price\n(Net)',   compute: r => r.pkgsTotal ? r.netSales / r.pkgsTotal : 0, fmt: 'usd', w: 58, bold: true },
];

function buildPDF(doc, { seasons, data }) {
  const W = doc.page.width;
  const M = 36;

  const drawHeader = () => {
    if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, M, 18, { height: 36 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor(GREEN).text('Sales by Season Report', 160, 22);
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text('Crown City Trading  —  H2E Mexico SA de CV', 160, 42)
       .text(`Generated: ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}`, 160, 54);
    doc.moveTo(M, 72).lineTo(W - M, 72).strokeColor(GREEN).lineWidth(1).stroke();
  };

  const drawFooter = () => {
    const Y = doc.page.height - 28;
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
       .text('H2E iSolve Dashboard  |  Crown City Trading  |  Confidential', M, Y, { width: W - M * 2, align: 'center' });
  };

  const totals = {};
  COLS.forEach(c => { if (c.key) totals[c.key] = 0; });

  const rows = seasons.map(s => {
    const d = data[s] || {};
    COLS.forEach(c => { if (c.key) totals[c.key] = (totals[c.key] || 0) + (d[c.key] || 0); });
    return { season: s, ...d };
  });

  const ROW_H   = 22;
  const HEAD_H  = 28;
  const TABLE_Y = 84;
  const tableW  = COLS.reduce((s, c) => s + c.w, 0);
  const tableX  = (W - tableW) / 2;

  const drawHead = (curY) => {
    let curX = tableX;
    COLS.forEach(col => {
      doc.rect(curX, curY, col.w, HEAD_H).fill(GREEN);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE);
      const lines  = col.label.split('\n');
      const lineH  = 10;
      const startY = curY + (HEAD_H - lines.length * lineH) / 2;
      lines.forEach((line, i) => doc.text(line, curX + 3, startY + i * lineH, { width: col.w - 6, align: 'center' }));
      curX += col.w;
    });
    return curY + HEAD_H;
  };

  drawHeader();
  let curY = drawHead(TABLE_Y);

  rows.forEach((row, idx) => {
    if (curY + ROW_H > doc.page.height - 55) {
      drawFooter(); doc.addPage(); drawHeader(); curY = drawHead(TABLE_Y);
    }
    const bg = idx % 2 === 0 ? '#f6fcf8' : WHITE;
    let curX = tableX;
    COLS.forEach((col, ci) => {
      doc.rect(curX, curY, col.w, ROW_H).fill(ci === 0 ? LGREEN : bg);
      let val, align = 'right', color = '#1e293b';
      if (ci === 0) {
        val = row.season; align = 'left'; color = GREEN;
      } else {
        const v = col.compute ? col.compute(row) : row[col.key];
        if (col.fmt === 'usd') { val = fmtUSD(v); if (v < 0) color = RED; }
        else val = fmtNum(v);
      }
      doc.font(col.bold || ci === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(color);
      doc.text(val, curX + 4, curY + (ROW_H - 8.5) / 2, { width: col.w - 8, align, lineBreak: false });
      curX += col.w;
    });
    curY += ROW_H;
  });

  // Totals row
  if (curY + ROW_H > doc.page.height - 55) { drawFooter(); doc.addPage(); drawHeader(); curY = TABLE_Y; }
  let curX = tableX;
  COLS.forEach((col, ci) => {
    doc.rect(curX, curY, col.w, ROW_H + 2).fill(GREEN);
    let val, align = 'right';
    if (ci === 0) { val = 'TOTAL'; align = 'left'; }
    else {
      const v = col.compute ? col.compute(totals) : totals[col.key];
      val = col.fmt === 'usd' ? fmtUSD(v) : fmtNum(v);
    }
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(WHITE);
    doc.text(val, curX + 4, curY + (ROW_H - 6) / 2, { width: col.w - 8, align, lineBreak: false });
    curX += col.w;
  });

  drawFooter();
  doc.end();
}

async function generate() {
  console.log('Fetching data from API…');
  const { data: api } = await axios.get(API_URL);
  const doc    = new PDFDocument({ size: 'LETTER', layout: 'landscape', margins: { top: 40, bottom: 40, left: 36, right: 36 } });
  const stream = fs.createWriteStream(OUT_PATH);
  doc.pipe(stream);
  buildPDF(doc, api);
  await new Promise(resolve => stream.on('finish', resolve));
  console.log(`\n✅  PDF guardado en:\n    ${OUT_PATH}\n`);
}

module.exports = { buildPDF, COLS };
generate().catch(err => { console.error('Error:', err.message); process.exit(1); });
