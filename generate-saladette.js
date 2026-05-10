'use strict';
const PDFDocument = require('pdfkit');
const fs   = require('fs');
const path = require('path');

const LOGO    = path.join(__dirname, 'public', 'logo.png');
const OUT_DIR = path.join(__dirname, 'Info para Claude', 'Reportes', 'Empaque');
const M = 36; // margen

const C = {
  verde:   '#1b4332',  // verde oscuro  — encabezado / EMPAQUE
  ambar:   '#78350f',  // ámbar oscuro  — EMBARQUE
  pizarra: '#1f2937',  // pizarra       — EXISTENCIA
  lgreen:  '#e8f5ee',  // verde pálido  — alternado filas
  lgris:   '#f5f5f4',  // gris muy suave
  grisMid: '#d6d3d1',  // separadores
  alt:     '#fafaf9',  // fila alternada
  white:   '#ffffff',
  gray:    '#57534e',
  text:    '#1c1917',
  yellow:  '#fef08a',  // amarillo — destacado × ha
  goldL:   '#fdf6e3',  // fondo cálido
};

const fN = n  => (n != null && n !== 0) ? Math.round(n).toLocaleString('es-MX') : '—';
const fD = (n, d=1) => n != null ? n.toFixed(d) : '—';
const fP = n  => n != null ? (n * 100).toFixed(0) + '%' : '—';
const fM = n  => n != null ? '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

const hoy   = new Date();
const DIAS  = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const fechaStr  = `${DIAS[hoy.getDay()]} ${hoy.getDate()} de ${MESES[hoy.getMonth()]} de ${hoy.getFullYear()}`;
const fechaFile = `${String(hoy.getDate()).padStart(2,'0')}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getFullYear()).slice(2)}`;

// ════════════════════════════════════════════════════════════════════
//  DATOS EDITABLES — Actualizar cada día antes de generar
// ════════════════════════════════════════════════════════════════════
const DATA = {
  diaEmpaque: 9,
  rancho:     'Mayela',
  temporada:  '2E 25-26',
  precioEst:  450.00,
  recXCaj:    414.00,
  pesoXCaja:  12.5,

  // Cajas empacadas hoy por tamaño
  cajas: { Jb: 255, Xl: 36, Lg: 11, Md: 6, Sm: 4, Mixto: 0 },

  // Embarque del día { bajas, exp, nac }
  embarque: {
    Jb:    { bajas: 0, exp: 0, nac: 290 },
    Xl:    { bajas: 0, exp: 0, nac: 0 },
    Lg:    { bajas: 0, exp: 0, nac: 0 },
    Md:    { bajas: 0, exp: 0, nac: 0 },
    Sm:    { bajas: 0, exp: 0, nac: 0 },
    Mixto: { bajas: 0, exp: 0, nac: 0 },
  },

  // Existencia de ayer por tamaño (inventario anterior al día de hoy)
  existenciaAnt: { Jb: 263, Xl: 23, Lg: 7, Md: 4, Sm: 5, Mixto: 0 },

  // Recepción
  recepcion: { antYReemp: 0, bins: 11.3, cajas: 0 },
  kgBin:    387,
  kgCubeta: 13,   // kg promedio por cubeta

  // Semana acumulada
  semana: { cajas: 826, xHa: 661, jbXlPct: 0.94 },

  // Acumulado temporada
  acum: { cajas: 972 },
};

// ════════════════════════════════════════════════════════════════════
//  CÁLCULOS
// ════════════════════════════════════════════════════════════════════
const sizes = ['Jb','Xl','Lg','Md','Sm','Mixto'];

const filas = sizes.map(sz => {
  const caj  = DATA.cajas[sz];
  const emb  = DATA.embarque[sz];
  const ant  = DATA.existenciaAnt[sz];
  const exist = ant + caj - emb.bajas - emb.exp - emb.nac;
  return { sz, caj, emb, ant, exist, recAprox: caj * DATA.recXCaj };
});

const totalCajas  = filas.reduce((s,r) => s + r.caj,       0);
const totalBajas  = filas.reduce((s,r) => s + r.emb.bajas, 0);
const totalExp    = filas.reduce((s,r) => s + r.emb.exp,   0);
const totalNac    = filas.reduce((s,r) => s + r.emb.nac,   0);
const totalExist  = filas.reduce((s,r) => s + r.exist,     0);
const totalPallt  = totalCajas / 64;
const precioTotal = totalCajas * DATA.precioEst;
const recTotal    = totalCajas * DATA.recXCaj;
const kgRecib     = DATA.recepcion.bins * DATA.kgBin;
const kgEmp       = totalCajas * DATA.pesoXCaja;
const pctEmpKg    = kgRecib > 0 ? kgEmp / kgRecib : 0;
const cajasXBin    = DATA.recepcion.bins > 0 ? totalCajas / DATA.recepcion.bins : 0;
const cajasXCubeta = kgRecib > 0 ? (totalCajas * DATA.kgCubeta) / kgRecib : 0;
const jbXlPct     = totalCajas > 0 ? (DATA.cajas.Jb + DATA.cajas.Xl) / totalCajas : 0;

// ════════════════════════════════════════════════════════════════════
//  COLUMNAS DE LA TABLA
//  group 'last:true' = marca visual al final de esa sección
// ════════════════════════════════════════════════════════════════════
const COLS = [
  { key:'desc',  label:'Descripción',  w:120, grp:'empaque',    color:C.verde,  align:'left'   },
  { key:'peso',  label:'Peso kg',       w:55,  grp:'empaque',    color:C.verde,  align:'center' },
  { key:'cajas', label:'Cajas Emp',     w:70,  grp:'empaque',    color:C.verde,  align:'right'  },
  { key:'pct',   label:'%',             w:45,  grp:'empaque',    color:C.verde,  align:'center' },
  { key:'bajas', label:'Bajas / Reemp', w:90,  grp:'empaque',    color:C.verde,  align:'right', last:true },
  { key:'exp',   label:'Exp',           w:75,  grp:'embarque',   color:C.ambar,   align:'right'  },
  { key:'nac',   label:'Nac',           w:85,  grp:'embarque',   color:C.ambar,   align:'right', last:true },
  { key:'exist', label:'Existencia',    w:105, grp:'existencia', color:C.pizarra, align:'right'  },
  { key:'pallt', label:'Pallets',       w:75,  grp:'existencia', color:C.pizarra, align:'center', last:true },
];
// Total: 120+55+70+45+90+75+85+105+75 = 720 ✓

const GRP_LABELS = {
  empaque:    'EMPAQUE',
  embarque:   'EMBARQUE',
  existencia: 'EXISTENCIA',
};

// ════════════════════════════════════════════════════════════════════
//  HELPERS DE DIBUJO
// ════════════════════════════════════════════════════════════════════
function rect(doc, x, y, w, h, fill) {
  doc.rect(x, y, w, h).fill(fill);
}

function cell(doc, text, x, y, w, h, opts = {}) {
  const { align = 'left', bold = false, size = 9, color = C.text, pad = 4 } = opts;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(size)
     .fillColor(color)
     .text(String(text), x + pad, y + (h - size) / 2, { width: w - pad * 2, align, lineBreak: false });
}

function hline(doc, x1, y, x2, color = C.grisMid, w = 0.4) {
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(w).stroke();
}

function vline(doc, x, y1, y2, color = C.white, w = 2) {
  doc.moveTo(x, y1).lineTo(x, y2).strokeColor(color).lineWidth(w).stroke();
}

// ════════════════════════════════════════════════════════════════════
//  GENERADOR PRINCIPAL
// ════════════════════════════════════════════════════════════════════
async function generarPDF() {
  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: M, bottom: M, left: M, right: M },
  });

  const outFile = path.join(OUT_DIR, `Reporte Saladette ${fechaFile}.pdf`);
  doc.pipe(fs.createWriteStream(outFile));

  const W = doc.page.width; // 792

  // ── ENCABEZADO ─────────────────────────────────────────────────────
  // Banda verde superior
  rect(doc, 0, 0, W, 70, C.verde);

  // Título
  doc.font('Helvetica-Bold').fontSize(17).fillColor(C.white)
     .text('Reporte Diario de Empaque — Saladette', M, 14, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(C.lgreen)
     .text('H2E México SA de CV  ·  Confidencial', M, 35, { lineBreak: false });

  // Fecha (centro)
  doc.font('Helvetica').fontSize(10).fillColor(C.white)
     .text(fechaStr, 0, 52, { width: W, align: 'center', lineBreak: false });

  // Día Empaque (derecha)
  doc.font('Helvetica').fontSize(8).fillColor(C.lgreen)
     .text('Día Empaque #', W - 180, 14, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(24).fillColor(C.yellow)
     .text(String(DATA.diaEmpaque), W - 100, 8, { lineBreak: false });

  // Rancho (derecha debajo)
  doc.font('Helvetica').fontSize(8).fillColor(C.lgreen)
     .text('Rancho:', W - 180, 44, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.white)
     .text(DATA.rancho.toUpperCase(), W - 135, 42, { lineBreak: false });

  let curY = 76;

  // ── GRUPO DE COLUMNAS — header bicolor con etiquetas de sección ────
  const GRP_H = 13;
  const COL_H = 18;

  // Calcular rangos de x por grupo
  const grupos = {};
  let xAcc = M;
  COLS.forEach(col => {
    if (!grupos[col.grp]) grupos[col.grp] = { x: xAcc, w: 0, color: col.color };
    grupos[col.grp].w += col.w;
    xAcc += col.w;
  });

  // Dibujar fila de grupos
  Object.entries(grupos).forEach(([key, g]) => {
    rect(doc, g.x, curY, g.w, GRP_H, g.color);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.white)
       .text(GRP_LABELS[key], g.x + 2, curY + 3, { width: g.w - 4, align: 'center', lineBreak: false });
  });

  // Dibujar fila de columnas
  let xCol = M;
  COLS.forEach(col => {
    rect(doc, xCol, curY + GRP_H, col.w, COL_H, col.color);
    // Lighten column header slightly with a white overlay
    doc.rect(xCol, curY + GRP_H, col.w, COL_H).fillOpacity(0.12).fill(C.white);
    doc.fillOpacity(1);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.white)
       .text(col.label, xCol + 3, curY + GRP_H + (COL_H - 8) / 2,
             { width: col.w - 6, align: col.align === 'left' ? 'left' : col.align === 'center' ? 'center' : 'right',
               lineBreak: false });
    // Separador grueso al final de cada sección
    if (col.last) {
      vline(doc, xCol + col.w, curY, curY + GRP_H + COL_H, C.white, 2.5);
    }
    xCol += col.w;
  });

  curY += GRP_H + COL_H;

  // ── FILA DE PRODUCTO ───────────────────────────────────────────────
  const PROD_H = 13;
  rect(doc, M, curY, W - M * 2, PROD_H, C.lgris);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.verde)
     .text('Tomate Roma  ·  H2E (Orig.) × 80', M + 6, curY + 3, { lineBreak: false });
  curY += PROD_H;

  // ── FILAS DE DATOS ─────────────────────────────────────────────────
  const ROW_H = 17;

  filas.forEach((fila, idx) => {
    const bg = idx % 2 === 0 ? C.white : C.alt;
    rect(doc, M, curY, W - M * 2, ROW_H, bg);

    const vals = {
      desc:  fila.sz,
      peso:  fila.caj > 0 ? fD(DATA.pesoXCaja, 1) : '—',
      cajas: fila.caj > 0 ? fN(fila.caj) : '—',
      pct:   fila.caj > 0 ? fP(fila.caj / totalCajas) : '—',
      bajas: fila.emb.bajas > 0 ? fN(fila.emb.bajas) : '—',
      exp:   fila.emb.exp   > 0 ? fN(fila.emb.exp)   : '—',
      nac:   fila.emb.nac   > 0 ? fN(fila.emb.nac)   : '—',
      exist: (fila.caj > 0 || fila.ant > 0) ? fN(fila.exist) : '—',
      pallt: fila.caj > 0 ? fD(fila.caj / 64, 1) : '—',
    };

    const BOLD_COLS = new Set(['desc','cajas','exist']);
    const GRAY_COLS = new Set();

    let xv = M;
    COLS.forEach(col => {
      const isBold = BOLD_COLS.has(col.key);
      const clr = GRAY_COLS.has(col.key) ? C.gray : C.text;
      cell(doc, vals[col.key], xv, curY, col.w, ROW_H,
           { align: col.align, bold: isBold, size: 9, color: clr });
      if (col.last) {
        vline(doc, xv + col.w, curY, curY + ROW_H, col.color, 1.5);
      }
      xv += col.w;
    });

    hline(doc, M, curY + ROW_H, W - M, C.grisMid, 0.3);
    curY += ROW_H;
  });

  // ── TOTALES ────────────────────────────────────────────────────────
  const TOT_H = 19;
  hline(doc, M, curY, W - M, C.verde, 1.2);
  rect(doc, M, curY, W - M * 2, TOT_H, C.lgris);

  const totVals = {
    desc:  'TOTALES',
    peso:  '—',
    cajas: fN(totalCajas),
    pct:   '100%',
    bajas: totalBajas > 0 ? fN(totalBajas) : '—',
    exp:   totalExp   > 0 ? fN(totalExp)   : '—',
    nac:   totalNac   > 0 ? fN(totalNac)   : '—',
    exist: fN(totalExist),
    pallt: fD(totalPallt, 1),
  };

  let xv = M;
  COLS.forEach(col => {
    cell(doc, totVals[col.key], xv, curY, col.w, TOT_H,
         { align: col.align, bold: true, size: 9, color: C.text });
    if (col.last) {
      vline(doc, xv + col.w, curY, curY + TOT_H, col.color, 2);
    }
    xv += col.w;
  });
  hline(doc, M, curY + TOT_H, W - M, C.verde, 1.2);
  curY += TOT_H;

  // KPI sublínea
  curY += 4;
  doc.font('Helvetica').fontSize(8).fillColor(C.gray)
     .text(`Exp ${fN(totalExp)}   Nac ${fN(totalNac)}`, M, curY, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.verde)
     .text(`Cajas × bin: ${fD(cajasXBin, 1)}`, W - M - 140, curY, { lineBreak: false });
  curY += 13;

  // ── SECCIÓN: RECEPCIÓN + PESO EMPACADO ────────────────────────────
  curY += 6;
  const halfW = Math.floor((W - M * 2 - 10) / 2);
  const rx2   = M + halfW + 10;

  // Títulos de sección
  rect(doc, M,   curY, halfW, 14, C.ambar);
  rect(doc, rx2, curY, halfW, 14, C.pizarra);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
     .text('Recepción', M + 4, curY + 3, { width: halfW - 8, align: 'center', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
     .text('Peso Empacado', rx2 + 4, curY + 3, { width: halfW - 8, align: 'center', lineBreak: false });
  curY += 14;

  const REC_H = 15;
  const recRows = [
    ['Ant y Reemp', fN(DATA.recepcion.antYReemp), fN(DATA.recepcion.antYReemp > 0 ? DATA.recepcion.antYReemp * DATA.kgBin : null)],
    ['Bins',        fD(DATA.recepcion.bins, 1),   fN(Math.round(DATA.recepcion.bins * DATA.kgBin))],
    ['Cajas',       fN(DATA.recepcion.cajas),     '—'],
    ['Total',       '—',                          fN(Math.round(kgRecib))],
  ];

  const pesoRows = [
    ['kg Recibidos',  fN(Math.round(kgRecib))],
    ['kg Empacados',  fN(Math.round(kgEmp))],
    ['% emp kg',      fP(pctEmpKg)],
    ['% Jb / Xl',     fP(jbXlPct)],
    ['Cajas × bin',    fD(cajasXBin, 1)],
    ['Cajas × cubeta', fD(cajasXCubeta, 2)],
  ];

  const startY = curY;

  recRows.forEach((r, i) => {
    const isTotal = i === recRows.length - 1;
    const bg = isTotal ? C.lgris : (i % 2 === 0 ? C.white : C.alt);
    rect(doc, M, curY, halfW, REC_H, bg);
    const lw = halfW * 0.38;
    const vw = halfW * 0.28;
    cell(doc, r[0], M,           curY, lw,             REC_H, { bold: isTotal, size: 8.5, align: 'left' });
    cell(doc, r[1], M + lw,      curY, vw,             REC_H, { bold: isTotal, size: 8.5, align: 'center', color: C.grisD });
    cell(doc, r[2], M + lw + vw, curY, halfW - lw - vw, REC_H, { bold: isTotal, size: 8.5, align: 'right', color: C.verde });
    hline(doc, M, curY + REC_H, M + halfW, C.grisMid, 0.3);
    curY += REC_H;
  });

  let pesoY = startY;
  pesoRows.forEach((p, i) => {
    const bg = i % 2 === 0 ? C.white : C.alt;
    rect(doc, rx2, pesoY, halfW, REC_H, bg);
    cell(doc, p[0], rx2,               pesoY, halfW * 0.6,  REC_H, { size: 8.5, align: 'left' });
    cell(doc, p[1], rx2 + halfW * 0.6, pesoY, halfW * 0.35, REC_H, { bold: true, size: 9, align: 'right', color: C.pizarra });
    hline(doc, rx2, pesoY + REC_H, rx2 + halfW, C.grisMid, 0.3);
    pesoY += REC_H;
  });

  curY = Math.max(curY, pesoY) + 10;

  // ── SECCIÓN: SEMANA + ACUMULADO ────────────────────────────────────
  const SEM_H = 18;

  // Semana — título
  rect(doc, M, curY, halfW, 14, C.verde);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white)
     .text('Semana', M + 4, curY + 3, { width: halfW - 8, align: 'center', lineBreak: false });

  // Acumulado — título
  rect(doc, rx2, curY, halfW, 14, C.verde);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white)
     .text(`Acum. Temporada ${DATA.temporada}`, rx2 + 4, curY + 3, { width: halfW - 8, align: 'center', lineBreak: false });
  curY += 14;

  const semItems = [
    { label: 'Cajas',     val: fN(DATA.semana.cajas),   highlight: false },
    { label: '× ha',      val: fN(DATA.semana.xHa),     highlight: true  },
    { label: '% Jb / Xl', val: fP(DATA.semana.jbXlPct), highlight: false },
  ];

  const acumY = curY;
  semItems.forEach((si, i) => {
    const bg = si.highlight ? C.yellow : (i % 2 === 0 ? C.white : C.lgris);
    const valColor = si.highlight ? C.ambar : C.verde;
    rect(doc, M, curY, halfW, SEM_H, bg);
    cell(doc, si.label, M + 4,           curY, halfW * 0.45, SEM_H, { size: 9, align: 'right', color: C.gray });
    cell(doc, si.val,   M + halfW * 0.5, curY, halfW * 0.45, SEM_H, { bold: true, size: 13, align: 'left', color: valColor });
    curY += SEM_H;
  });

  // Acumulado — caja grande
  const acumBoxH = SEM_H * 3;
  rect(doc, rx2, acumY, halfW, acumBoxH, C.white);
  doc.rect(rx2, acumY, halfW, acumBoxH).strokeColor(C.verde).lineWidth(1.5).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(C.gray)
     .text('Cajas acumuladas temporada', rx2 + 4, acumY + 8, { width: halfW - 8, align: 'center', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(30).fillColor(C.verde)
     .text(fN(DATA.acum.cajas), rx2 + 4, acumY + 20, { width: halfW - 8, align: 'center', lineBreak: false });

  // ── PIE ────────────────────────────────────────────────────────────
  const footY = doc.page.height - M - 14;
  hline(doc, M, footY - 6, W - M, C.grisMid, 0.5);
  doc.font('Helvetica').fontSize(7.5).fillColor(C.gray)
     .text(`H2E México SA de CV  ·  Generado: ${hoy.toLocaleString('es-MX')}`,
           M, footY, { width: W - M * 2, align: 'center', lineBreak: false });

  doc.end();
  console.log(`✓ PDF generado: ${outFile}`);
}

generarPDF().catch(err => { console.error('Error:', err.message); process.exit(1); });
