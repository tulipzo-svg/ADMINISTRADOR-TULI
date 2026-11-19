/* =========================================================
   TULI · Cierre de mes y publicación en la tienda
   - Publicar: cada prenda del catálogo se publica o se quita desde su tarjeta
     (o con "Publicar todo lo que tiene existencias"). La tienda lee la vista
     tienda_productos (supabase-cambios-v8.sql).
   - Cierre de mes: corte de ventas y movimientos. Automático el último día del
     mes a las 11:59 p. m. (hora de Venezuela), o a mano. Excel con colores de Tuli.
   Carga después de data.js y antes de app.js.
   Usa: $, state, DB, sb, toast, cargar, abrirModal, cerrarModal, stockTotal (app.js y data.js).
   ========================================================= */

const TZ_TIENDA = "America/Caracas";
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const TIPO_MOV = { gasto: "Gasto", mercancia: "Mercancía", retiro: "Retiro", capital: "Capital de afuera" };
const BOLSA_TXT = { bolsa_mediana: "Bolsa mediana", bolsa_grande: "Bolsa grande" };
const DESDE_INICIO = "2000-01-01T00:00:00-04:00";


/* ---------- utilidades ---------- */
const fechaTienda = iso => new Date(iso).toLocaleString("es-VE", {
  timeZone: TZ_TIENDA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const soloFecha = iso => new Date(iso).toLocaleDateString("es-VE", { timeZone: TZ_TIENDA, day: "2-digit", month: "2-digit", year: "numeric" });
const soloHora = iso => new Date(iso).toLocaleTimeString("es-VE", { timeZone: TZ_TIENDA, hour: "2-digit", minute: "2-digit" });
const nombrePeriodoCierre = p => { const [y, m] = p.split("-"); return `${MESES[Number(m) - 1]} ${y}`; };

// Lee todas las filas de una consulta (de 1000 en 1000, sin el límite de Supabase)
async function leerTodo(construir) {
  const filas = [];
  const paso = 1000;
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await construir().range(desde, desde + paso - 1);
    if (error) throw error;
    filas.push(...data);
    if (data.length < paso) return filas;
  }
}

function descargarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- CIERRE: cálculos del período abierto ---------- */
// Último cierre = inicio del período abierto
function ultimoCierre() {
  const lista = state.cierres || [];
  return lista.length ? lista.reduce((a, b) => (new Date(b.hasta) > new Date(a.hasta) ? b : a)) : null;
}

function periodoAbierto() {
  const u = ultimoCierre();
  const desde = u ? u.hasta : DESDE_INICIO;
  const t = new Date(desde).getTime();
  const ventas = (state.ventas || []).filter(v => new Date(v.creado_en).getTime() > t);
  const movs = (state.movs || []).filter(m => new Date(m.creado_en).getTime() > t);
  const total = ventas.reduce((a, v) => a + Number(v.total), 0);
  const costo = ventas.reduce((a, v) => a + Number(v.costo_total), 0);
  const gastos = movs.filter(m => m.tipo === "gasto").reduce((a, m) => a + Number(m.monto), 0);
  return { desde, ventas: ventas.length, movs: movs.length, total, costo, gastos, neta: total - costo - gastos };
}

// Próximo cierre automático: 03:59 UTC del día 1 = 23:59 del último día del mes en Venezuela (UTC-4)
function proximoCierreAuto(ahora = new Date()) {
  const ccs = new Date(ahora.getTime() - 4 * 3600e3);
  const y = ccs.getUTCFullYear(), m = ccs.getUTCMonth();
  let cierre = new Date(Date.UTC(y, m + 1, 1, 3, 59));
  if (cierre <= ahora) cierre = new Date(Date.UTC(y, m + 2, 1, 3, 59));
  return cierre;
}

/* ---------- CIERRE: vista ---------- */
function pintarCierre() {
  const v = $("#vistaCierre");
  if (!v) return;
  const ab = periodoAbierto();
  const prox = proximoCierreAuto();
  const cierres = state.cierres || [];
  const sinMovimientos = !ab.ventas && !ab.movs;
  v.innerHTML = `
    <div class="kpis kpis-3">
      <div class="card kpi"><small>Ventas del período abierto</small><strong>${ab.ventas}</strong><span>${money(ab.total)} vendidos</span></div>
      <div class="card kpi"><small>Ganancia neta del período abierto</small><strong>${money(ab.neta)}</strong><span>Después de costos y gastos</span></div>
      <div class="card kpi"><small>Próximo cierre automático</small><strong class="cierre-fecha">${esc(prox.toLocaleString("es-VE", { timeZone: TZ_TIENDA, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))}</strong><span>Último día del mes, 11:59 p. m. (hora de Venezuela)</span></div>
    </div>
    <div class="card cierre-acciones">
      <p><b>Período abierto:</b> desde ${esc(fechaTienda(ab.desde))} hasta ahora.${sinMovimientos ? " Todavía no hay ventas ni movimientos nuevos." : ""}</p>
      <div class="cierre-botones">
        <button class="btn" data-cierre="excel-abierto" type="button">Descargar Excel del período (sin cerrar)</button>
        <button class="btn ghost" data-cierre="cerrar" type="button" ${sinMovimientos ? "disabled" : ""}>Cerrar período ahora</button>
      </div>
      <p class="small muted">Descargar el Excel no cierra nada. Al cerrar, las ventas y movimientos de este tramo se guardan y el siguiente período empieza en blanco. El cierre automático se hace solo a fin de mes, aunque nadie tenga la app abierta.</p>
    </div>
    <h3 class="sec-titulo">Cierres guardados</h3>
    <div class="lista-cierres">${cierres.map(filaCierre).join("") || `<p class="muted small">Todavía no hay cierres guardados.</p>`}</div>`;
}

function filaCierre(c) {
  const ganancia = Number(c.total_ventas) - Number(c.costo_ventas) - Number(c.gastos);
  return `<div class="card cierre-fila">
    <div>
      <small class="cat">${c.tipo === "automatico" ? "Automático" : "Manual"} · cerrado ${esc(fechaTienda(c.hasta))}</small>
      <strong>${esc(nombrePeriodoCierre(c.periodo))} · cierre ${c.numero}</strong>
      <p class="small muted">${c.cantidad_ventas} venta(s) · ventas ${money(c.total_ventas)} · ganancia neta ${money(ganancia)}</p>
    </div>
    <button class="btn ghost sm" data-cierre="excel" data-id="${c.id}" type="button">Descargar Excel</button>
  </div>`;
}

async function excelDePeriodoAbierto() {
  const u = ultimoCierre();
  const desde = u ? u.hasta : DESDE_INICIO;
  const hasta = new Date().toISOString();
  const ventas = await leerTodo(() => sb.from("ventas").select("*").gt("creado_en", desde).lte("creado_en", hasta).order("creado_en"));
  const movs = await leerTodo(() => sb.from("movimientos").select("*").gt("creado_en", desde).lte("creado_en", hasta).order("creado_en"));
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: TZ_TIENDA });
  await descargarExcel({
    titulo: "Período abierto (sin cerrar)",
    tipoTexto: "Período abierto · todavía no está cerrado",
    desde: fechaTienda(desde),
    hasta: fechaTienda(hasta),
    creadoPor: state.usuaria ? state.usuaria.nombre : "",
    archivo: `Tuli_Periodo-abierto_${hoy}.xlsx`,
  }, ventas, movs);
}

async function excelDeCierre(id) {
  const c = (state.cierres || []).find(x => x.id === id);
  if (!c) throw new Error("No encontré ese cierre. Actualiza la página.");
  const ventas = await leerTodo(() => sb.from("ventas").select("*").gt("creado_en", c.desde).lte("creado_en", c.hasta).order("creado_en"));
  const movs = await leerTodo(() => sb.from("movimientos").select("*").gt("creado_en", c.desde).lte("creado_en", c.hasta).order("creado_en"));
  await descargarExcel({
    titulo: `${nombrePeriodoCierre(c.periodo)} · cierre ${c.numero}`,
    tipoTexto: c.tipo === "automatico" ? "Automático (fin de mes)" : "Manual",
    desde: fechaTienda(c.desde),
    hasta: fechaTienda(c.hasta),
    creadoPor: c.creado_por,
    archivo: `Tuli_Cierre_${c.periodo}_${c.numero}.xlsx`,
  }, ventas, movs);
}

async function descargarExcel(meta, ventas, movs) {
  const buf = await construirExcelCierre(meta, ventas, movs);
  descargarArchivo(new Blob([buf], { type: MIME_XLSX }), meta.archivo);
}

async function cerrarPeriodoAhora() {
  if (!confirm("¿Cerrar el período ahora?\n\nLas ventas y movimientos de este tramo quedan guardados en un cierre. El siguiente período empieza en blanco. El cierre de fin de mes se hará igual, con lo que se venda después.")) return;
  try {
    await DB.cerrarPeriodoManual();
    toast("Período cerrado ✔");
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo cerrar el período");
  }
}

// Al abrir la app: si el mes ya terminó y el cierre automático no corrió, lo cierra
async function verificarCierreAutomatico() {
  try {
    const creado = await DB.cerrarPendiente();
    if (creado) {
      toast("Se cerró el mes anterior automáticamente ✔");
      await cargar();
    }
  } catch (err) {
    console.warn("Cierre automático de respaldo:", err.message);
  }
}

/* ---------- EXCEL DEL CIERRE (ExcelJS, colores de Tuli) ---------- */
async function construirExcelCierre(meta, ventas, movs) {
  const C = { vino: "FFA0022E", vinoOscuro: "FF7E0222", suave: "FFF7E3E9", crema: "FFF5ECD2", tinta: "FF262B36", blanco: "FFFFFFFF", linea: "FFE8C9D3", gris: "FF6B7280" };
  const MONEDA = '"$"#,##0.00';
  const wb = new ExcelJS.Workbook();
  wb.creator = "Tuli · Sistema Vallery";
  wb.created = new Date();

  const estilo = (c, o = {}) => {
    c.font = { name: "Calibri", bold: !!o.bold, italic: !!o.italic, size: o.size || 11, color: { argb: o.color || C.tinta } };
    if (o.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: o.fill } };
    if (o.fmt) c.numFmt = o.fmt;
    c.alignment = { horizontal: o.align || "left", vertical: "middle", wrapText: !!o.wrap };
    c.border = { bottom: { style: "thin", color: { argb: C.linea } } };
  };
  const encabezado = (ws, fila, titulos) => {
    const r = ws.getRow(fila);
    titulos.forEach((t, i) => { const c = r.getCell(i + 1); c.value = t; estilo(c, { bold: true, color: C.blanco, fill: C.vino, align: "center", wrap: true }); });
    r.height = 30;
  };

  // Logo (si no carga, el Excel sale igual sin logo)
  let logoId = null;
  try {
    const bytes = new Uint8Array(await (await fetch("logo-tuli.png")).arrayBuffer());
    logoId = wb.addImage({ buffer: bytes, extension: "png" });
  } catch (err) { console.warn("Sin logo para el Excel:", err.message); }

  /* ----- Hoja 2: VENTAS (una fila por prenda, con el número de cada venta) ----- */
  const vs = wb.addWorksheet("Ventas", { views: [{ state: "frozen", ySplit: 3 }] });
  vs.columns = [
    { width: 9 }, { width: 17 }, { width: 8 }, { width: 13 }, { width: 26 }, { width: 10 }, { width: 22 },
    { width: 10 }, { width: 14 }, { width: 15 }, { width: 14 }, { width: 15 }, { width: 15 }, { width: 16 }, { width: 12 },
  ];
  vs.mergeCells("A1:O1");
  const t1 = vs.getCell("A1");
  t1.value = `VENTAS DETALLADAS · ${meta.titulo}`;
  estilo(t1, { bold: true, size: 14, color: C.blanco, fill: C.vino });
  vs.getRow(1).height = 30;
  vs.mergeCells("A2:O2");
  const t2 = vs.getCell("A2");
  t2.value = `Desde ${meta.desde} hasta ${meta.hasta}. Cada venta tiene su número; las filas de una misma venta van juntas.`;
  estilo(t2, { italic: true, size: 10, color: C.gris });
  encabezado(vs, 3, ["N° venta", "Fecha", "Hora", "Usuaria", "Prenda", "Talla", "Color", "Cantidad", "Precio unit. (USD)", "Subtotal (USD)", "Costo unit. (USD)", "Costo total (USD)", "Ganancia (USD)", "Bolsa", "Etiquetas"]);

  let fila = 4;
  const primera = fila;
  let ordinal = 0;
  for (const v of ventas) {
    ordinal += 1;
    const items = Array.isArray(v.items) ? v.items : [];
    const fondo = ordinal % 2 === 0 ? C.suave : null;
    items.forEach((it, idx) => {
      const cant = Number(it.cantidad) || 0, precio = Number(it.precio) || 0, costo = Number(it.costo) || 0;
      const r = vs.getRow(fila);
      r.getCell(1).value = ordinal;
      r.getCell(2).value = soloFecha(v.creado_en);
      r.getCell(3).value = soloHora(v.creado_en);
      r.getCell(4).value = v.usuaria;
      r.getCell(5).value = it.nombre;
      r.getCell(6).value = it.talla === "Única" ? "Talla única" : it.talla;
      r.getCell(7).value = it.color;
      r.getCell(8).value = cant;
      r.getCell(9).value = precio;
      r.getCell(10).value = { formula: `H${fila}*I${fila}`, result: cant * precio };
      r.getCell(11).value = costo;
      r.getCell(12).value = { formula: `H${fila}*K${fila}`, result: cant * costo };
      r.getCell(13).value = { formula: `J${fila}-L${fila}`, result: cant * (precio - costo) };
      r.getCell(14).value = idx === 0 ? (BOLSA_TXT[v.bolsa] || "—") : "";
      r.getCell(15).value = idx === 0 ? Number(v.etiquetas) || 0 : "";
      for (let c = 1; c <= 15; c++) {
        estilo(r.getCell(c), {
          fill: fondo,
          align: [1, 3, 8].includes(c) ? "center" : (c >= 9 && c <= 13 ? "right" : "left"),
          fmt: c >= 9 && c <= 13 ? MONEDA : null,
          bold: idx === 0 && c === 1,
        });
      }
      fila += 1;
    });
  }
  const ultima = fila - 1;
  if (ultima >= primera) {
    const tot = vs.getRow(fila);
    tot.getCell(5).value = `TOTAL (${ventas.length} venta(s))`;
    const sumas = {
      8: ventas.length ? ventas.reduce((a, v) => a + (v.items || []).reduce((b, it) => b + Number(it.cantidad), 0), 0) : 0,
      10: ventas.reduce((a, v) => a + Number(v.total), 0),
      12: ventas.reduce((a, v) => a + Number(v.costo_total), 0),
    };
    tot.getCell(8).value = { formula: `SUM(H${primera}:H${ultima})`, result: sumas[8] };
    tot.getCell(10).value = { formula: `SUM(J${primera}:J${ultima})`, result: sumas[10] };
    tot.getCell(12).value = { formula: `SUM(L${primera}:L${ultima})`, result: sumas[12] };
    tot.getCell(13).value = { formula: `SUM(M${primera}:M${ultima})`, result: sumas[10] - sumas[12] };
    tot.getCell(15).value = { formula: `SUM(O${primera}:O${ultima})`, result: ventas.reduce((a, v) => a + (Number(v.etiquetas) || 0), 0) };
    for (let c = 1; c <= 15; c++) {
      estilo(tot.getCell(c), { bold: true, fill: C.crema, color: C.vinoOscuro, align: c >= 8 ? "right" : "left", fmt: [10, 12, 13].includes(c) ? MONEDA : null });
    }
    vs.autoFilter = { from: "A3", to: `O${ultima}` };
  } else {
    vs.getCell(`A${fila}`).value = "No hay ventas en este período.";
    estilo(vs.getCell(`A${fila}`), { italic: true, color: C.gris });
  }
  const filaTotVentas = ultima >= primera ? ultima + 1 : null;

  /* ----- Hoja 3: MOVIMIENTOS ----- */
  const ms = wb.addWorksheet("Movimientos", { views: [{ state: "frozen", ySplit: 3 }] });
  ms.columns = [{ width: 17 }, { width: 8 }, { width: 14 }, { width: 20 }, { width: 52 }, { width: 16 }];
  ms.mergeCells("A1:F1");
  const m1 = ms.getCell("A1");
  m1.value = `MOVIMIENTOS · ${meta.titulo}`;
  estilo(m1, { bold: true, size: 14, color: C.blanco, fill: C.vino });
  ms.getRow(1).height = 30;
  ms.mergeCells("A2:F2");
  estilo(ms.getCell("A2"), { italic: true, size: 10, color: C.gris });
  ms.getCell("A2").value = "Gastos, mercancía, retiros y capital de afuera del período. El capital entra a la caja pero no es ganancia.";
  encabezado(ms, 3, ["Fecha", "Hora", "Usuaria", "Tipo", "Concepto", "Monto (USD)"]);
  let fm = 4;
  const primeraM = fm;
  for (const m of movs) {
    const r = ms.getRow(fm);
    r.getCell(1).value = soloFecha(m.creado_en);
    r.getCell(2).value = soloHora(m.creado_en);
    r.getCell(3).value = m.usuaria;
    r.getCell(4).value = TIPO_MOV[m.tipo] || m.tipo;
    r.getCell(5).value = m.concepto;
    r.getCell(6).value = Number(m.monto);
    for (let c = 1; c <= 6; c++) estilo(r.getCell(c), { align: c === 6 ? "right" : (c === 2 ? "center" : "left"), fmt: c === 6 ? MONEDA : null });
    fm += 1;
  }
  const ultimaM = fm - 1;
  if (ultimaM >= primeraM) {
    ms.autoFilter = { from: "A3", to: `F${ultimaM}` };
    const tm = ms.getRow(fm);
    tm.getCell(5).value = "TOTAL DE MOVIMIENTOS";
    tm.getCell(6).value = { formula: `SUM(F${primeraM}:F${ultimaM})`, result: movs.reduce((a, m) => a + Number(m.monto), 0) };
    for (let c = 1; c <= 6; c++) estilo(tm.getCell(c), { bold: true, fill: C.crema, color: C.vinoOscuro, align: c === 6 ? "right" : "left", fmt: c === 6 ? MONEDA : null });
  } else {
    ms.getCell(`A${fm}`).value = "No hay movimientos en este período.";
    estilo(ms.getCell(`A${fm}`), { italic: true, color: C.gris });
  }
  const rangoMov = { ini: primeraM, fin: Math.max(ultimaM, primeraM) };

  // Suma por tipo de movimiento: fórmula SUMIF sobre la hoja Movimientos
  const sumaTipo = (tipo) => {
    const monto = movs.filter(m => m.tipo === tipo).reduce((a, m) => a + Number(m.monto), 0);
    const f = `SUMIF(Movimientos!$D$${rangoMov.ini}:$D$${rangoMov.fin},"${TIPO_MOV[tipo]}",Movimientos!$F$${rangoMov.ini}:$F$${rangoMov.fin})`;
    return { formula: f, result: monto, valor: monto };
  };
  const sumaVentas = (col) => {
    if (!filaTotVentas) return { formula: "0", result: 0, valor: 0 };
    const val = col === "J" ? ventas.reduce((a, v) => a + Number(v.total), 0) : ventas.reduce((a, v) => a + Number(v.costo_total), 0);
    return { formula: `Ventas!${col}${filaTotVentas}`, result: val, valor: val };
  };

  /* ----- Hoja 1: RESUMEN (la primera que ve quien abre el archivo) ----- */
  const rs = wb.addWorksheet("Resumen", { views: [{ showGridLines: false }] });
  rs.columns = [{ width: 9 }, { width: 50 }, { width: 24 }];
  rs.getRow(1).height = 72;
  for (let c = 1; c <= 3; c++) estilo(rs.getRow(1).getCell(c), { fill: C.vino });
  rs.getCell("B1").value = "TULI";
  estilo(rs.getCell("B1"), { bold: true, size: 30, color: C.blanco, fill: C.vino });
  rs.getCell("B2").value = "Cierre de mes · Sistema Vallery";
  estilo(rs.getCell("B2"), { bold: true, size: 13, color: C.vino });
  rs.getRow(2).height = 22;
  if (logoId !== null) rs.addImage(logoId, { tl: { col: 0.2, row: 0.1 }, ext: { width: 62, height: 62 } });

  const datos = [
    ["Período", meta.titulo],
    ["Tipo de cierre", meta.tipoTexto],
    ["Desde", meta.desde],
    ["Hasta", meta.hasta],
    ["Generado el", fechaTienda(new Date().toISOString())],
    ["Registrado por", meta.creadoPor || ""],
  ];
  datos.forEach(([k, v], i) => {
    const r = rs.getRow(4 + i);
    r.getCell(2).value = k; estilo(r.getCell(2), { bold: true, color: C.vinoOscuro });
    r.getCell(3).value = v; estilo(r.getCell(3), { align: "right" });
  });

  const cab = rs.getRow(11);
  cab.getCell(2).value = "RESUMEN DEL PERÍODO";
  cab.getCell(3).value = "USD";
  estilo(cab.getCell(2), { bold: true, color: C.blanco, fill: C.vino });
  estilo(cab.getCell(3), { bold: true, color: C.blanco, fill: C.vino, align: "right" });
  cab.height = 24;

  const ingresos = sumaVentas("J"), costo = sumaVentas("L");
  const gastos = sumaTipo("gasto"), merc = sumaTipo("mercancia"), ret = sumaTipo("retiro"), cap = sumaTipo("capital");
  const utilidad = ingresos.valor - costo.valor;
  const neta = utilidad - gastos.valor;
  const caja = ingresos.valor - gastos.valor - merc.valor - ret.valor + cap.valor;

  // Filas: [etiqueta, celda C (fórmula o valor), resultado, destacar]
  const lineas = [
    ["Ventas realizadas (cantidad)", ventas.length, null, false],
    ["Ingresos por ventas", { formula: ingresos.formula, result: ingresos.valor }, null, false],
    ["Costo de la mercancía vendida", { formula: costo.formula, result: costo.valor }, null, false],
    ["Utilidad bruta (ingresos − costo)", { formula: "C13-C14", result: utilidad }, null, false],
    ["Gastos del período", { formula: gastos.formula, result: gastos.valor }, null, false],
    ["GANANCIA NETA (utilidad bruta − gastos)", { formula: "C15-C16", result: neta }, null, true],
    ["Mercancía comprada", { formula: merc.formula, result: merc.valor }, null, false],
    ["Retiros", { formula: ret.formula, result: ret.valor }, null, false],
    ["Capital de afuera (entra a caja, no es ganancia)", { formula: cap.formula, result: cap.valor }, null, false],
    ["DINERO EN CAJA DEL PERÍODO", { formula: "C13-C16-C18-C19+C20", result: caja }, null, true],
  ];
  lineas.forEach(([etq, val, , destacar], i) => {
    const r = rs.getRow(12 + i);
    r.getCell(2).value = etq;
    r.getCell(3).value = val;
    estilo(r.getCell(2), { bold: destacar, fill: destacar ? C.suave : null, color: destacar ? C.vinoOscuro : C.tinta });
    estilo(r.getCell(3), { bold: destacar, fill: destacar ? C.suave : null, align: "right", fmt: i === 0 ? "0" : MONEDA, color: destacar ? C.vinoOscuro : C.tinta });
    r.height = 22;
  });

  rs.getCell("B23").value = "Todas las cifras son fórmulas: se calculan a partir de las hojas Ventas y Movimientos.";
  estilo(rs.getCell("B23"), { italic: true, size: 10, color: C.gris });
  rs.getCell("B24").value = "Ganancia neta: lo que queda después de pagar la mercancía vendida y los gastos. Mercancía y retiros no restan a la ganancia.";
  estilo(rs.getCell("B24"), { italic: true, size: 10, color: C.gris, wrap: true });
  rs.getRow(24).height = 30;

  return wb.xlsx.writeBuffer();
}

/* ---------- PUBLICAR EN LA TIENDA ---------- */
/* ---------- CATEGORÍAS (formulario de prenda) ---------- */
const CAT_NUEVA = "__nueva__";

// Opciones del desplegable: las categorías guardadas + las que ya usan las prendas + "Nueva categoría"
function categoriasOpciones(actual) {
  const set = new Set([...(state.categorias || []), ...(state.productos || []).map(p => p.categoria)]
    .map(c => String(c || "").trim()).filter(Boolean));
  if (actual) set.add(String(actual).trim());
  const lista = [...set].sort((x, y) => x.localeCompare(y, "es"));
  return [
    `<option value="" ${actual ? "" : "selected"} disabled>Elige una categoría</option>`,
    ...lista.map(c => `<option value="${esc(c)}" ${c === actual ? "selected" : ""}>${esc(c)}</option>`),
    `<option value="${CAT_NUEVA}">➕ Nueva categoría…</option>`,
  ].join("");
}

async function alternarPublicar(id) {
  const p = state.productos.find(x => x.id === id);
  if (!p) return;
  try {
    await DB.actualizarCampos(p.id, { publicado: !p.publicado });
    toast(p.publicado ? "Prenda quitada de la tienda" : "Prenda publicada en la tienda ✔");
    await cargar();
  } catch (err) { toast(err.message || "No se pudo cambiar"); }
}

async function publicarTodo() {
  const pendientes = state.productos.filter(p => !p.publicado && stockTotal(p) > 0);
  if (!pendientes.length) return toast("No hay prendas con existencias pendientes de publicar");
  if (!confirm(`¿Publicar ${pendientes.length} prenda(s) con existencias en la tienda?`)) return;
  try {
    await Promise.all(pendientes.map(p => DB.actualizarCampos(p.id, { publicado: true })));
    toast(`${pendientes.length} prenda(s) publicadas ✔`);
    await cargar();
  } catch (err) { toast(err.message || "No se pudo publicar"); }
}

/* ---------- FOTOS DE LA PÁGINA DE LA TIENDA (solo dos) ---------- */
function pintarFotosTienda() {
  const box = $("#fotosTienda");
  if (!box) return;
  const url = clave => ((state.sitio || []).find(x => x.clave === clave) || {}).url || "";
  const bloque = (clave, titulo, ayuda) => {
    const u = url(clave);
    return `<div class="card sitio-foto">
      <div class="sitio-prev">${u ? `<img src="${esc(u)}" alt="">` : "<span>Sin foto todavía</span>"}</div>
      <div class="sitio-info">
        <strong>${titulo}</strong>
        <p class="small muted">${ayuda}</p>
        <label class="btn ghost sm sitio-cambiar">Cambiar foto<input type="file" accept="image/*" hidden data-sitio="${clave}"></label>
      </div>
    </div>`;
  };
  box.innerHTML = `<details class="fotos-tienda">
    <summary>🖼️ Fotos de la página principal de la tienda</summary>
    <div class="sitio-grid">
      ${bloque("inicio", "Foto grande de inicio", "La que está al lado de «Tu outfit perfecto».")}
      ${bloque("nosotros", "Foto «Descubre nuestra tienda»", "La de las etiquetas con el logo de Tuli.")}
    </div>
    <p class="small muted">Solo estas dos fotos se cambian aquí. Los cambios se ven en la tienda en menos de un minuto.</p>
  </details>`;
}

/* ---------- FOTOS DE LA PRENDA (hasta 5; la primera es la portada) ---------- */
const MAX_FOTOS = 5;

// Lista de fotos de una prenda guardada (si no tiene lista, usa la foto de portada)
function fotosDe(p) {
  if (Array.isArray(p.fotos) && p.fotos.length) return p.fotos;
  return p.foto_url ? [p.foto_url] : [];
}

function pintarFotosProd() {
  const grid = $("#fotosGrid");
  if (!grid) return;
  grid.innerHTML = editFotos.map((f, i) => `
    <div class="prod-foto-item">
      <img src="${esc(f.url || f.preview)}" alt="Foto ${i + 1}">
      ${i === 0
        ? '<span class="foto-tag">Portada</span>'
        : `<button type="button" class="foto-ico portada" data-foto-portada="${i}" title="Usar como portada" aria-label="Usar la foto ${i + 1} como portada">★</button>`}
      <button type="button" class="foto-ico quitar" data-foto-quitar="${i}" title="Quitar foto" aria-label="Quitar la foto ${i + 1}">✕</button>
    </div>`).join("");
  const count = $("#fotosCount");
  if (count) count.textContent = `${editFotos.length} de ${MAX_FOTOS}`;
  const add = $("#fotosAddLbl");
  if (add) add.hidden = editFotos.length >= MAX_FOTOS;
}

async function agregarFotosProd(archivos) {
  const libres = MAX_FOTOS - editFotos.length;
  if (libres <= 0) return toast(`Ya tienes ${MAX_FOTOS} fotos. Quita una para agregar otra.`);
  if (archivos.length > libres) toast(`Solo caben ${libres} foto(s) más. El máximo es ${MAX_FOTOS} por prenda.`);
  for (const f of archivos.slice(0, libres)) {
    if (!f.type.startsWith("image/")) { toast("Selecciona solo imágenes"); continue; }
    if (f.size > 15 * 1024 * 1024) { toast("Una foto pesa más de 15 MB"); continue; }
    try {
      const blob = await comprimir(f, 1200);
      editFotos.push({ blob, preview: URL.createObjectURL(blob) });
    } catch (err) { toast(err.message || "No se pudo procesar una foto"); }
  }
  pintarFotosProd();
}

/* ---------- EVENTOS (delegación propia de este módulo) ---------- */
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (!t.closest) return;
  let b;

  if ((b = t.closest("[data-foto-quitar]"))) {
    const [quitada] = editFotos.splice(Number(b.dataset.fotoQuitar), 1);
    if (quitada && quitada.preview) URL.revokeObjectURL(quitada.preview);
    return pintarFotosProd();
  }
  if ((b = t.closest("[data-foto-portada]"))) {
    const [f] = editFotos.splice(Number(b.dataset.fotoPortada), 1);
    editFotos.unshift(f);
    return pintarFotosProd();
  }
  if ((b = t.closest("[data-publicar]"))) return alternarPublicar(b.dataset.publicar);
  if (t.closest("#btnPublicarTodo")) return publicarTodo();

  if ((b = t.closest("[data-cierre]"))) {
    const accion = b.dataset.cierre;
    try {
      if (accion === "excel-abierto") { b.disabled = true; await excelDePeriodoAbierto(); }
      if (accion === "excel") { b.disabled = true; await excelDeCierre(b.dataset.id); }
      if (accion === "cerrar") return cerrarPeriodoAhora();
    } catch (err) {
      toast(err.message || "No se pudo crear el Excel");
    } finally {
      if (b) b.disabled = false;
    }
  }
});

// Al elegir "Nueva categoría…" aparece la casilla para escribirla
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.name !== "categoria" || !t.form || t.form.id !== "formProd") return;
  const nueva = t.value === CAT_NUEVA;
  const box = $("#catNuevaBox");
  if (box) box.hidden = !nueva;
  if (nueva && t.form.categoriaNueva) t.form.categoriaNueva.focus();
});

// Cambiar una de las dos fotos de la página de la tienda
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (!(t.dataset && t.dataset.sitio)) return;
  const f = t.files && t.files[0];
  t.value = "";
  if (!f) return;
  if (!f.type.startsWith("image/")) return toast("Selecciona una imagen");
  if (f.size > 20 * 1024 * 1024) return toast("La foto pesa más de 20 MB");
  try {
    toast("Subiendo foto…");
    const blob = await comprimir(f, 1400);
    await DB.subirFotoSitio(t.dataset.sitio, blob);
    toast("Foto actualizada. Se verá en la tienda en menos de un minuto ✔");
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo subir la foto");
  }
});
