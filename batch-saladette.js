'use strict';
const ExcelJS    = require('exceljs');
const PDFDocument = require('pdfkit');
const fs   = require('fs');
const path = require('path');

const EXCEL = path.join(__dirname, 'Info para Claude', 'Reportes', 'Empaque',
                        'Formato de Empaque 2E 25-26 (Saladette).xlsm');
const OUT   = path.join(__dirname, 'Info para Claude', 'Reportes', 'Empaque', 'Diarios');
const M = 36;

// ── Colores ───────────────────────────────────────────────────────────────────
const C = {
  verde:   '#1b4332', ambar:   '#78350f', pizarra: '#1f2937',
  lgreen:  '#e8f5ee', lgris:   '#f5f5f4', grisMid: '#d6d3d1',
  alt:     '#fafaf9', white:   '#ffffff', gray:    '#57534e',
  text:    '#1c1917', yellow:  '#fef08a',
};

// ── Formateadores ─────────────────────────────────────────────────────────────
const fN  = n  => (n != null && n !== 0) ? Math.round(n).toLocaleString('es-MX') : '—';
const fD  = (n,d=1) => n != null ? (+n).toFixed(d) : '—';
const fP  = n  => n != null ? (n * 100).toFixed(0) + '%' : '—';

const DIAS  = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
               'septiembre','octubre','noviembre','diciembre'];

// ── Columnas de la tabla ───────────────────────────────────────────────────────
const COLS = [
  { key:'desc',  label:'Descripción',  w:120, grp:'empaque',    color:C.verde,   align:'left'   },
  { key:'peso',  label:'Peso kg',       w:55,  grp:'empaque',    color:C.verde,   align:'center' },
  { key:'cajas', label:'Cajas Emp',     w:70,  grp:'empaque',    color:C.verde,   align:'right'  },
  { key:'pct',   label:'%',             w:45,  grp:'empaque',    color:C.verde,   align:'center' },
  { key:'bajas', label:'Bajas / Reemp', w:90,  grp:'empaque',    color:C.verde,   align:'right', last:true },
  { key:'exp',   label:'Exp',           w:75,  grp:'embarque',   color:C.ambar,   align:'right'  },
  { key:'nac',   label:'Nac',           w:85,  grp:'embarque',   color:C.ambar,   align:'right', last:true },
  { key:'exist', label:'Existencia',    w:105, grp:'existencia', color:C.pizarra, align:'right'  },
  { key:'pallt', label:'Pallets',       w:75,  grp:'existencia', color:C.pizarra, align:'center', last:true },
];
const GRP_LABELS = { empaque:'EMPAQUE', embarque:'EMBARQUE', existencia:'EXISTENCIA' };

// ── Helpers PDF ───────────────────────────────────────────────────────────────
const fillR  = (doc,x,y,w,h,clr) => doc.rect(x,y,w,h).fill(clr);
const cellT  = (doc,txt,x,y,w,h,{align='left',bold=false,size=9,color=C.text,pad=4}={}) =>
  doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color)
     .text(String(txt??'—'), x+pad, y+(h-size)/2, {width:w-pad*2, align, lineBreak:false});
const hline  = (doc,x1,y,x2,clr=C.grisMid,w=0.4) =>
  doc.moveTo(x1,y).lineTo(x2,y).strokeColor(clr).lineWidth(w).stroke();
const vline  = (doc,x,y1,y2,clr=C.white,w=2) =>
  doc.moveTo(x,y1).lineTo(x,y2).strokeColor(clr).lineWidth(w).stroke();

// ── Extraer datos de una hoja ─────────────────────────────────────────────────
function cv(ws, col, row) {
  const v = ws.getCell(col + row).value;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v.result !== undefined) return v.result;
  if (typeof v === 'object' && v.error) return null;
  if (typeof v === 'object' && v.formula) return null; // fórmula sin resultado cacheado
  return v;
}

const SIZES = ['Jb','Xl','Lg','Md','Sm','Mixto'];
const ROWS  = { Jb:26, Xl:27, Lg:28, Md:29, Sm:30, Mixto:31 };

function extractSheet(ws) {
  const diaEmpaque = cv(ws,'K',2) ?? 0;
  const fechaRaw   = cv(ws,'H',4);
  const fecha      = fechaRaw instanceof Date ? fechaRaw : new Date(fechaRaw ?? Date.now());
  const pesoXCaja  = cv(ws,'B',26) ?? 12.5;
  const kgBin      = cv(ws,'X',3) ?? 385;
  const kgCubeta   = cv(ws,'X',1) ?? 13;
  const bins       = cv(ws,'N',4) ?? 0;
  const kgEmp      = cv(ws,'R',2) ?? 0;
  const pctJbXl    = cv(ws,'S',3) ?? null;
  const cajasXBin  = cv(ws,'R',5) ?? null;
  const cajasXCub  = cv(ws,'R',4) ?? null;

  const cajas = {}, embarque = {}, exist = {};
  SIZES.forEach(sz => {
    const r = ROWS[sz];
    const c = cv(ws,'C',r) || 0;
    const g = cv(ws,'G',r) || 0;
    const h = cv(ws,'H',r) || 0;
    const i = cv(ws,'I',r) || 0;
    const j = cv(ws,'J',r);
    cajas[sz]   = c;
    embarque[sz] = { bajas:g, exp:h, nac:i };
    exist[sz]    = (j != null && typeof j === 'number') ? j : c - g - h - i;
  });

  // x ha de la semana: fila 60, col C
  const semXHa   = cv(ws,'C',60) ?? null;
  // Acum x ha: fila 72, col B  (etiqueta en A71: "Acum a fecha x ha")
  const acumXHa  = cv(ws,'B',72) ?? null;
  // V1=precio est de venta, V3=recuperación por caja
  const precioEst = cv(ws,'V',1) ?? null;
  const recXCaj   = cv(ws,'V',3) ?? null;

  return { diaEmpaque, fecha, pesoXCaja, kgBin, kgCubeta, bins, kgEmp,
           pctJbXl, cajasXBin, cajasXCub, cajas, embarque, exist,
           semXHa, acumXHa, precioEst, recXCaj };
}

// ── Generar PDF para un día ───────────────────────────────────────────────────
function generarPDF(data, semCajas, acumCajas, acumData) {
  const { diaEmpaque, fecha, pesoXCaja, kgBin, kgCubeta,
          bins, kgEmp, cajas, embarque, exist } = data;

  const fechaStr  = `${DIAS[fecha.getUTCDay()]} ${fecha.getUTCDate()} de ${MESES[fecha.getUTCMonth()]} de ${fecha.getUTCFullYear()}`;
  const fechaFile = `${String(fecha.getUTCDate()).padStart(2,'0')}-${String(fecha.getUTCMonth()+1).padStart(2,'0')}-${String(fecha.getUTCFullYear()).slice(2)}`;

  // Cálculos
  const filas = SIZES.map(sz => ({
    sz, caj: cajas[sz], emb: embarque[sz], exist: exist[sz],
  }));
  const totalCajas = filas.reduce((s,r)=>s+r.caj, 0);
  const totalBajas = filas.reduce((s,r)=>s+r.emb.bajas, 0);
  const totalExp   = filas.reduce((s,r)=>s+r.emb.exp,   0);
  const totalNac   = filas.reduce((s,r)=>s+r.emb.nac,   0);
  const totalExist = filas.reduce((s,r)=>s+r.exist,     0);
  const totalPallt = totalCajas / 80;
  const kgRecib    = bins * kgBin;
  const pctEmpKg   = kgRecib > 0 ? kgEmp / kgRecib : 0;
  const cajasXBin  = data.cajasXBin ?? (bins > 0 ? totalCajas / bins : 0);
  const cajasXCub  = data.cajasXCub ?? (kgRecib > 0 ? (totalCajas * kgCubeta) / kgRecib : 0);
  const jbXlPct    = data.pctJbXl ?? (totalCajas > 0 ? (cajas.Jb + cajas.Xl) / totalCajas : 0);

  const doc = new PDFDocument({ size:'LETTER', layout:'landscape',
    margins:{top:M,bottom:M,left:M,right:M} });
  const outFile = path.join(OUT, `Reporte Saladette Día ${diaEmpaque} ${fechaFile}.pdf`);
  doc.pipe(fs.createWriteStream(outFile));

  const W = doc.page.width;

  // ── Encabezado ──────────────────────────────────────────────────────────────
  fillR(doc, 0, 0, W, 70, C.verde);
  doc.font('Helvetica-Bold').fontSize(17).fillColor(C.white)
     .text('Reporte Diario de Empaque — Saladette', M, 14, {lineBreak:false});
  doc.font('Helvetica').fontSize(9).fillColor(C.lgreen)
     .text('H2E México SA de CV', M, 35, {lineBreak:false});
  doc.font('Helvetica').fontSize(10).fillColor(C.white)
     .text(fechaStr, 0, 52, {width:W, align:'center', lineBreak:false});
  doc.font('Helvetica').fontSize(8).fillColor(C.lgreen)
     .text('Día Empaque #', W-180, 14, {lineBreak:false});
  doc.font('Helvetica-Bold').fontSize(24).fillColor(C.yellow)
     .text(String(diaEmpaque), W-100, 8, {lineBreak:false});
  doc.font('Helvetica').fontSize(8).fillColor(C.lgreen)
     .text('Rancho:', W-180, 44, {lineBreak:false});
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.white)
     .text('MAYELA', W-135, 42, {lineBreak:false});

  let curY = 76;
  const GRP_H = 13, COL_H = 18, ROW_H = 17, PROD_H = 13, TOT_H = 19;

  // ── Grupos de columnas ───────────────────────────────────────────────────────
  const grupos = {};
  let xA = M;
  COLS.forEach(col => {
    if (!grupos[col.grp]) grupos[col.grp] = {x:xA, w:0, color:col.color};
    grupos[col.grp].w += col.w; xA += col.w;
  });
  Object.entries(grupos).forEach(([key,g]) => {
    fillR(doc,g.x,curY,g.w,GRP_H,g.color);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.white)
       .text(GRP_LABELS[key], g.x+2, curY+3, {width:g.w-4, align:'center', lineBreak:false});
  });
  let xC = M;
  COLS.forEach(col => {
    fillR(doc,xC,curY+GRP_H,col.w,COL_H,col.color);
    doc.rect(xC,curY+GRP_H,col.w,COL_H).fillOpacity(0.12).fill(C.white);
    doc.fillOpacity(1);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.white)
       .text(col.label, xC+3, curY+GRP_H+(COL_H-8)/2,
             {width:col.w-6, align:col.align==='left'?'left':col.align==='center'?'center':'right',
              lineBreak:false});
    if (col.last) vline(doc, xC+col.w, curY, curY+GRP_H+COL_H, C.white, 2.5);
    xC += col.w;
  });
  curY += GRP_H + COL_H;

  // ── Fila producto ─────────────────────────────────────────────────────────────
  fillR(doc,M,curY,W-M*2,PROD_H,C.lgris);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.verde)
     .text('Tomate Roma  ·  H2E (Orig.) × 80', M+6, curY+3, {lineBreak:false});
  curY += PROD_H;

  // ── Filas de datos (omitir tamaños con cero cajas) ───────────────────────────
  const filasActivas = filas.filter(f => f.caj > 0);
  filasActivas.forEach((fila, idx) => {
    fillR(doc, M, curY, W-M*2, ROW_H, idx%2===0?C.white:C.alt);
    const vals = {
      desc:  fila.sz,
      peso:  fila.caj>0 ? fD(pesoXCaja,1) : '—',
      cajas: fila.caj>0 ? fN(fila.caj) : '—',
      pct:   fila.caj>0 ? fP(fila.caj/totalCajas) : '—',
      bajas: fila.emb.bajas>0 ? fN(fila.emb.bajas) : '—',
      exp:   fila.emb.exp>0   ? fN(fila.emb.exp)   : '—',
      nac:   fila.emb.nac>0   ? fN(fila.emb.nac)   : '—',
      exist: (fila.caj>0||fila.exist>0) ? fN(fila.exist) : '—',
      pallt: fila.caj>0 ? fD(fila.caj/80,1) : '—',
    };
    const BOLD = new Set(['desc','cajas','exist']);
    let xv = M;
    COLS.forEach(col => {
      cellT(doc, vals[col.key], xv, curY, col.w, ROW_H,
            {align:col.align, bold:BOLD.has(col.key), size:9});
      if (col.last) vline(doc, xv+col.w, curY, curY+ROW_H, col.color, 1.5);
      xv += col.w;
    });
    hline(doc, M, curY+ROW_H, W-M, C.grisMid, 0.3);
    curY += ROW_H;
  });

  // ── Totales ──────────────────────────────────────────────────────────────────
  hline(doc, M, curY, W-M, C.verde, 1.2);
  fillR(doc, M, curY, W-M*2, TOT_H, C.lgris);
  const totV = {
    desc:'TOTALES', peso:'—', cajas:fN(totalCajas), pct:'100%',
    bajas:totalBajas>0?fN(totalBajas):'—', exp:totalExp>0?fN(totalExp):'—',
    nac:totalNac>0?fN(totalNac):'—', exist:fN(totalExist), pallt:fD(totalPallt,1),
  };
  let xv = M;
  COLS.forEach(col => {
    cellT(doc, totV[col.key], xv, curY, col.w, TOT_H, {align:col.align, bold:true, size:9});
    if (col.last) vline(doc, xv+col.w, curY, curY+TOT_H, col.color, 2);
    xv += col.w;
  });
  hline(doc, M, curY+TOT_H, W-M, C.verde, 1.2);
  curY += TOT_H + 4;

  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.verde)
     .text(`Cajas × bin: ${fD(cajasXBin,1)}`, M, curY, {lineBreak:false});
  doc.font('Helvetica').fontSize(8).fillColor(C.gray)
     .text(`Exp ${fN(totalExp)}   Nac ${fN(totalNac)}`, W-M-170, curY, {lineBreak:false});
  curY += 13;

  // ── Recepción · Peso Empacado · Recuperación (tres paneles diarios) ───────────
  curY += 6;
  const thirdW = Math.floor((W - M*2) / 3);
  const rx2    = M + thirdW;
  const rx3    = M + thirdW * 2;
  const REC_H  = 13;

  fillR(doc, M,   curY, thirdW, 14, C.ambar);
  fillR(doc, rx2, curY, thirdW, 14, C.pizarra);
  fillR(doc, rx3, curY, thirdW, 14, C.ambar);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
     .text('Recepción',         M+4,   curY+3, {width:thirdW-8, align:'center', lineBreak:false});
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
     .text('Peso Empacado',     rx2+4, curY+3, {width:thirdW-8, align:'center', lineBreak:false});
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
     .text('Recuperación Est.', rx3+4, curY+3, {width:thirdW-8, align:'center', lineBreak:false});
  curY += 14;

  const kgRecibTot  = bins * kgBin;
  const blockStartY = curY;
  const recRows = [
    ['Bins',     fD(bins,2), fN(Math.round(kgRecibTot))],
    ['Cajas',    '—',        '—'],
    ['Total kg', '—',        fN(Math.round(kgRecibTot))],
  ];
  const pesoRows = [
    ['kg Recibidos',   fN(Math.round(kgRecibTot))],
    ['kg Empacados',   fN(Math.round(kgEmp))],
    ['% emp kg',       fP(pctEmpKg)],
    ['% Jb / Xl',      fP(jbXlPct)],
    ['Cajas × bin',    fD(cajasXBin,1)],
    ['Cajas × cubeta', fD(cajasXCub,2)],
  ];

  recRows.forEach((r, i) => {
    const isLast = i===recRows.length-1;
    fillR(doc, M, curY, thirdW, REC_H, isLast?C.lgris:(i%2===0?C.white:C.alt));
    const lw=thirdW*0.38, vw=thirdW*0.28;
    cellT(doc, r[0], M,       curY, lw,            REC_H, {bold:isLast, size:8.5, align:'left'});
    cellT(doc, r[1], M+lw,    curY, vw,            REC_H, {bold:isLast, size:8.5, align:'center', color:C.gray});
    cellT(doc, r[2], M+lw+vw, curY, thirdW-lw-vw,  REC_H, {bold:isLast, size:8.5, align:'right',  color:C.verde});
    hline(doc, M, curY+REC_H, M+thirdW, C.grisMid, 0.3);
    curY += REC_H;
  });

  let pesoY = blockStartY;
  pesoRows.forEach((p, i) => {
    fillR(doc, rx2, pesoY, thirdW, REC_H, i%2===0?C.white:C.alt);
    cellT(doc, p[0], rx2,             pesoY, thirdW*0.62, REC_H, {size:8.5, align:'left'});
    cellT(doc, p[1], rx2+thirdW*0.62, pesoY, thirdW*0.34, REC_H, {bold:true, size:9, align:'right', color:C.pizarra});
    hline(doc, rx2, pesoY+REC_H, rx2+thirdW, C.grisMid, 0.3);
    pesoY += REC_H;
  });

  // Panel Recuperación: V3 × cajas del día
  const recXCaj      = data.recXCaj;
  const recupTot     = recXCaj != null ? recXCaj * totalCajas : null;
  const recupPanelH  = Math.max(curY, pesoY) - blockStartY;
  const recupMidY    = blockStartY + recupPanelH / 2;
  fillR(doc, rx3, blockStartY, thirdW, recupPanelH, C.white);
  doc.rect(rx3, blockStartY, thirdW, recupPanelH).strokeColor(C.ambar).lineWidth(1).stroke();
  const precioEst = data.precioEst;
  const fmt$  = v => v!=null ? '$'+v.toLocaleString('es-MX',{minimumFractionDigits:2}) : '—';
  const fmt$r = v => v!=null ? '$'+Math.round(v).toLocaleString('es-MX') : '—';
  const third  = recupPanelH / 3;
  const lbl    = (txt, y) => doc.font('Helvetica').fontSize(7).fillColor(C.gray)
                                .text(txt, rx3+8, y, {width:thirdW-16, lineBreak:false});
  const val$   = (txt, y, sz, clr) => doc.font('Helvetica-Bold').fontSize(sz).fillColor(clr)
                                         .text(txt, rx3+4, y, {width:thirdW-8, align:'center', lineBreak:false});

  lbl('Precio est. de venta / caja', blockStartY+5);
  val$(fmt$(precioEst), blockStartY+14, 11, C.pizarra);
  hline(doc, rx3+6, blockStartY+third, rx3+thirdW-6, C.grisMid, 0.5);
  lbl('Rec × caja', blockStartY+third+4);
  val$(fmt$(recXCaj), blockStartY+third+13, 11, C.pizarra);
  hline(doc, rx3+6, blockStartY+third*2, rx3+thirdW-6, C.grisMid, 0.5);
  lbl('Recuperación estimada', blockStartY+third*2+4);
  val$(fmt$r(recupTot), blockStartY+third*2+13, 13, C.ambar);

  curY = Math.max(curY, pesoY) + 8;

  // ── Semana + Acum × ha (dos paneles) ─────────────────────────────────────────
  const halfW   = Math.floor((W - M*2) / 2);
  const halfX   = M + halfW;
  const SEM_H   = 16;

  fillR(doc, M,     curY, halfW, 13, C.verde);
  fillR(doc, halfX, curY, halfW, 13, C.verde);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
     .text('Semana', M+4, curY+3, {width:halfW-8, align:'center', lineBreak:false});
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
     .text('Acum. Temporada 2E 25-26', halfX+4, curY+3, {width:halfW-8, align:'center', lineBreak:false});
  curY += 13;

  const semStartY = curY;
  const semXHaVal = data.semXHa;
  const semItems  = [
    {label:'Cajas',     val:fN(semCajas),  hi:false},
    {label:'× ha',      val:fN(semXHaVal), hi:true },
    {label:'% Jb / Xl', val:fP(jbXlPct),  hi:false},
  ];
  semItems.forEach((si, i) => {
    fillR(doc, M, semStartY+i*SEM_H, halfW, SEM_H, si.hi?C.yellow:(i%2===0?C.white:C.lgris));
    cellT(doc, si.label, M+4,          semStartY+i*SEM_H, halfW*0.48, SEM_H,
          {size:9, align:'right', color:C.gray});
    cellT(doc, si.val,   M+halfW*0.52, semStartY+i*SEM_H, halfW*0.44, SEM_H,
          {bold:true, size:13, align:'left', color:si.hi?C.ambar:C.verde});
  });

  const acumXHaVal  = data.acumXHa ?? acumCajas;
  const acumPanelH  = SEM_H * 3;
  fillR(doc, halfX, semStartY, halfW, acumPanelH, C.white);
  doc.rect(halfX, semStartY, halfW, acumPanelH).strokeColor(C.verde).lineWidth(1.5).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(C.gray)
     .text('Acum. a fecha  ×  ha', halfX+4, semStartY+7, {width:halfW-8, align:'center', lineBreak:false});
  doc.font('Helvetica-Bold').fontSize(28).fillColor(C.verde)
     .text(fN(acumXHaVal), halfX+4, semStartY+20, {width:halfW-8, align:'center', lineBreak:false});

  curY = semStartY + acumPanelH + 8;

  // ── Acumulados de la temporada (tabla compacta) ───────────────────────────────
  if (acumData) {
    const acW = W - M*2;
    fillR(doc, M, curY, acW, 13, C.pizarra);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white)
       .text('Acumulados Temporada 2E 25-26  —  H2E (Orig.) × 80', M+4, curY+3,
             {width:acW-8, align:'center', lineBreak:false});
    curY += 13;

    const totAcTotal = SIZES.reduce((s,sz)=>s+(acumData[sz]?.cajas||0), 0);
    const AC = [
      {label:'Tamaño',     w:90,  align:'left'  },
      {label:'Cajas Acum', w:100, align:'right' },
      {label:'% del Total',w:80,  align:'center'},
      {label:'Exp Acum',   w:90,  align:'right' },
      {label:'Nac Acum',   w:90,  align:'right' },
      {label:'Existencia', w:100, align:'right' },
    ];
    const acTotW = AC.reduce((s,c)=>s+c.w, 0);
    const acOff  = M + (acW - acTotW) / 2;

    let axH = acOff;
    AC.forEach(col => {
      fillR(doc, axH, curY, col.w, 13, C.pizarra);
      doc.rect(axH, curY, col.w, 13).fillOpacity(0.15).fill(C.white); doc.fillOpacity(1);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.white)
         .text(col.label, axH+3, curY+3, {width:col.w-6, align:col.align, lineBreak:false});
      axH += col.w;
    });
    curY += 13;

    const AH = 13;
    SIZES.filter(sz=>acumData[sz]&&acumData[sz].cajas>0).forEach((sz, i) => {
      const a = acumData[sz];
      const pctTot = totAcTotal>0 ? a.cajas/totAcTotal : 0;
      fillR(doc, acOff, curY, acTotW, AH, i%2===0?C.white:C.alt);
      axH = acOff;
      const acVals = [sz, fN(a.cajas), fP(pctTot), fN(a.exp), fN(a.nac), fN(a.exist)];
      AC.forEach((col, ci) => {
        cellT(doc, acVals[ci], axH, curY, col.w, AH,
              {align:col.align, bold:ci===0||ci===1, size:8.5});
        axH += col.w;
      });
      hline(doc, acOff, curY+AH, acOff+acTotW, C.grisMid, 0.3);
      curY += AH;
    });

    // Total acum
    const totAc = SIZES.reduce((s,sz)=>({
      cajas:s.cajas+(acumData[sz]?.cajas||0), exp:s.exp+(acumData[sz]?.exp||0),
      nac:s.nac+(acumData[sz]?.nac||0),       exist:s.exist+(acumData[sz]?.exist||0),
    }), {cajas:0,exp:0,nac:0,exist:0});
    fillR(doc, acOff, curY, acTotW, 14, C.lgris);
    hline(doc, acOff, curY, acOff+acTotW, C.pizarra, 1);
    axH = acOff;
    const totAcVals = ['TOTALES', fN(totAc.cajas), '100%', fN(totAc.exp), fN(totAc.nac), fN(totAc.exist)];
    AC.forEach((col, ci) => {
      cellT(doc, totAcVals[ci], axH, curY, col.w, 14,
            {align:col.align, bold:true, size:8.5, color:C.pizarra});
      axH += col.w;
    });
    hline(doc, acOff, curY+14, acOff+acTotW, C.pizarra, 1);
    curY += 14;
  }

  // ── Pie ───────────────────────────────────────────────────────────────────────
  const footY = doc.page.height - M - 14;
  hline(doc,M,footY-6,W-M,C.grisMid,0.5);
  doc.font('Helvetica').fontSize(7.5).fillColor(C.gray)
     .text(`H2E México SA de CV  ·  Generado: ${new Date().toLocaleString('es-MX')}`,
           M, footY, {width:W-M*2, align:'center', lineBreak:false});

  doc.end();
  return outFile;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL);

  // Argumento opcional: número de día específico (ej. node batch-saladette.js 8)
  const soloDia = process.argv[2] ? parseInt(process.argv[2]) : null;

  // Determinar rango de hojas a leer
  const maxDia = soloDia ?? 9;
  const dias = [];
  for (let n = 1; n <= maxDia; n++) {
    const ws = wb.getWorksheet(`Empaque (${n})`);
    if (!ws) { console.warn(`Hoja "Empaque (${n})" no encontrada, se omite.`); continue; }
    const d = extractSheet(ws);
    if (!d.diaEmpaque) continue;
    dias.push(d);
  }
  dias.sort((a,b) => a.diaEmpaque - b.diaEmpaque);

  // Calcular acumulados progresivos
  let acumCajas = 0, semCajas = 0;
  for (const d of dias) {
    const totalHoy = Object.values(d.cajas).reduce((s,v)=>s+v, 0);
    semCajas  += totalHoy;
    acumCajas += totalHoy;
    d._semCajas  = semCajas;
    d._acumCajas = acumCajas;
  }

  // Leer × ha por semana de "Cajas x Semana" (fila 124, amarillo)
  const cajSemWs = wb.getWorksheet('Cajas x Semana');
  const semanas  = [];
  if (cajSemWs) {
    const cvSem = (row, col) => {
      const v = cajSemWs.getCell(row, col).value;
      if (v == null) return null;
      if (v instanceof Date) return v;
      if (typeof v === 'object' && v.result !== undefined) return v.result;
      if (typeof v === 'object') return null;
      return v;
    };
    for (let col = 3; col <= 20; col++) {
      const startRaw = cvSem(64, col);
      const endRaw   = cvSem(65, col);
      const xha      = cvSem(124, col);
      const cajas    = cvSem(122, col);
      if (!startRaw || !endRaw || xha == null) continue;
      const sd = startRaw instanceof Date ? startRaw : new Date(startRaw);
      const ed = endRaw   instanceof Date ? endRaw   : new Date(endRaw);
      semanas.push({
        startMs: Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), sd.getUTCDate()),
        endMs:   Date.UTC(ed.getUTCFullYear(), ed.getUTCMonth(), ed.getUTCDate()),
        xha, cajas,
      });
    }
    console.log(`  Semanas leídas de "Cajas x Semana": ${semanas.length}`);
  } else {
    console.warn('Hoja "Cajas x Semana" no encontrada; semXHa desde hoja Empaque.');
  }

  // Asignar semXHa y semCajas del cuadro semanal a cada día
  for (const d of dias) {
    const fMs = Date.UTC(d.fecha.getUTCFullYear(), d.fecha.getUTCMonth(), d.fecha.getUTCDate());
    const sem = semanas.find(s => fMs >= s.startMs && fMs <= s.endMs);
    if (sem) {
      d.semXHa    = sem.xha;
      d._semCajas = sem.cajas ?? d._semCajas;
    }
  }

  // Leer acumulados de la hoja Totales
  const totWs = wb.getWorksheet('Totales');
  const SIZES_T = ['Jb','Xl','Lg','Md','Sm','Mixto'];
  const ROWS_T  = { Jb:26, Xl:27, Lg:28, Md:29, Sm:30, Mixto:31 };
  const acumData = {};
  if (totWs) {
    SIZES_T.forEach(sz => {
      const r = ROWS_T[sz];
      acumData[sz] = {
        cajas: cv(totWs,'C',r) || 0,
        bajas: cv(totWs,'G',r) || 0,
        exp:   cv(totWs,'H',r) || 0,
        nac:   cv(totWs,'I',r) || 0,
        exist: cv(totWs,'J',r) || 0,
      };
    });
  } else {
    console.warn('Hoja "Totales" no encontrada; sección de acumulados omitida.');
  }

  // Generar solo el día solicitado, o todos
  const aGenerar = soloDia ? dias.filter(d=>d.diaEmpaque===soloDia) : dias;
  for (const d of aGenerar) {
    const outFile = generarPDF(d, d._semCajas, d._acumCajas, totWs ? acumData : null);
    console.log(`✓ Día ${d.diaEmpaque}: ${path.basename(outFile)}`);
  }
  console.log(`\n✓ ${aGenerar.length} reporte(s) en:\n  ${OUT}`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
