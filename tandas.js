/* =========================================================
   VALLERY · Gasto corporativo
   Tandas (compras de mercancía), empaques e inventario en vivo.
   Carga después de data.js y antes de app.js.
   Usa las variables y funciones de app.js (state, $, cargar, etc.)
   ========================================================= */

const EMP_IDS = ["bolsa_mediana", "bolsa_grande", "etiqueta"];
const EMP_NOMBRE = {
  bolsa_mediana: "Bolsa mediana",
  bolsa_grande: "Bolsa grande",
  etiqueta: "Etiqueta / tarjeta de agradecimiento",
};
const EMP_CORTO = { bolsa_mediana: "Bolsas medianas", bolsa_grande: "Bolsas grandes", etiqueta: "Etiquetas" };

const siguienteNumero = () => Math.max(0, ...state.lotes.map(l => Number(l.numero) || 0)) + 1;
const nombreTalla = t => (t === "Única" ? "Talla única" : t);

// Stock actual de una variante (talla + color) de una prenda
function stockVariante(productoId, talla, color) {
  const p = state.productos.find(x => x.id === productoId);
  const v = p && p.variantes.find(x => x.talla === talla && x.color === color);
  return v ? Number(v.stock) || 0 : 0;
}

// Inventario disponible: empaques + mercancía por prenda, talla y color
function htmlInventario() {
  const empaques = `<div class="kpis kpis-3">${EMP_IDS.map(id => {
    const e = empaque(id);
    return `<div class="card kpi">
      <small>${EMP_CORTO[id]}</small>
      <strong class="${e.cantidad <= 5 ? "neg" : ""}">${e.cantidad}</strong>
      <span>disponibles</span>
    </div>`;
  }).join("")}</div>`;

  const prendas = state.productos.map(p => {
    const total = stockTotal(p);
    return `<div class="inv-prod">
      <div class="inv-head"><b>${esc(p.nombre)}</b><span class="${total <= 0 ? "neg" : ""}">${total} ud.</span></div>
      <div class="vars">${p.variantes.map(v => `<span class="var ${v.stock <= 0 ? "agotado" : v.stock <= 1 ? "bajo" : ""}">${v.talla === "Única" ? "Única" : esc(v.talla)} · ${esc(v.color)}: ${v.stock}</span>`).join("")}</div>
    </div>`;
  }).join("");

  const vacio = state.productos.every(p => stockTotal(p) === 0) && state.empaques.every(e => e.cantidad === 0);
  return `${vacio ? '<p class="nombre-prev">Todavía no hay inventario cargado. Toca "Inventario inicial" y escribe lo que tienes físicamente.</p>' : ""}
    ${empaques}
    <p class="inv-sub">Prendas</p>
    <div class="inv-grid">${prendas || `<p class="muted small">Aún no hay prendas.</p>`}</div>`;
}

// Refresca todos los paneles de inventario (vista y formulario abierto)
function refrescarInventario() {
  const v = $("#inventarioVivo");
  if (v) v.innerHTML = htmlInventario();
  const m = $("#inventarioModal");
  if (m) m.innerHTML = htmlInventario();
  if ($("#formCompra")) recalcCompra();
}

/* ---------- VISTA: GASTO CORPORATIVO ---------- */
function pintarGasto() {
  $("#listaLotes").innerHTML = state.lotes.map(tarjetaTanda).join("")
    || `<p class="muted">Aún no hay tandas. Registra la primera con "Nueva tanda".</p>`;
  refrescarInventario();
}

function tarjetaTanda(l) {
  const piezas = suma(l.items || [], i => i.cantidad);
  const emp = suma(l.empaques || [], e => e.cantidad * e.costo_unit);
  return `
  <article class="card lote">
    <div class="lote-head">
      <div><small class="cat">${fechaCorta(l.creado_en)} · ${esc(l.usuaria)}</small><h3>${esc(l.nombre)}</h3></div>
      <strong>${money(l.total)}</strong>
    </div>
    <p class="small muted">${piezas} prenda(s) · envío ${money(l.costo_envio)} · empaques ${money(emp)}</p>
    <details class="lote-det">
      <summary class="small">Ver detalle</summary>
      <ul class="lista small">
        ${(l.items || []).map(i => `<li class="linea"><span>${esc(i.nombre)} · ${esc(nombreTalla(i.talla))} · ${esc(i.color)}</span><span>× ${i.cantidad} · ${money(i.costo_unit)} c/u</span></li>`).join("")}
        ${(l.empaques || []).map(e => `<li class="linea"><span>${esc(e.nombre)}</span><span>× ${e.cantidad} · ${money(e.costo_unit)} c/u</span></li>`).join("")}
        ${l.costo_envio > 0 ? `<li class="linea"><span>Envío</span><span>${money(l.costo_envio)}</span></li>` : ""}
      </ul>
    </details>
    <div class="acc">
      <button class="btn sm ghost" data-excel="${esc(l.id)}">Descargar Excel</button>
    </div>
  </article>`;
}

/* ---------- EXCEL DE LA TANDA ---------- */
// Nombre de archivo seguro: "Tanda 1 · Fresa" → "Tanda_1_Fresa.xlsx"
const nombreArchivo = n => (n || "Tanda").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") + ".xlsx";

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function descargarTanda(id) {
  const l = state.lotes.find(x => x.id === id);
  if (!l) return;
  try {
    let blob = await DB.archivoLote(l);
    if (!blob) {
      // Tandas anteriores a esta versión: se genera el Excel ahora y se guarda
      blob = new Blob([generarXlsx(l)], { type: MIME_XLSX });
      await DB.archivarLote(l.id, blob).catch(() => {});
    }
    descargarBlob(blob, nombreArchivo(l.nombre));
  } catch (err) {
    toast("No se pudo abrir el Excel de esta tanda");
  }
}

// Arma los datos de la tanda recién registrada para crear su Excel
function armarLoteExcel(r, envio, items, empaques) {
  const lineas = items.map(i => ({
    ...i,
    nombre: (state.productos.find(p => p.id === i.producto_id) || {}).nombre || "",
  }));
  const empl = empaques.map(e => ({ ...e, nombre: EMP_NOMBRE[e.id] || e.id }));
  const total = suma(lineas, i => i.cantidad * i.costo_unit) + envio + suma(empl, e => e.cantidad * e.costo_unit);
  return {
    id: r.id, nombre: r.nombre, usuaria: state.usuaria.nombre,
    creado_en: new Date().toISOString(), costo_envio: envio,
    items: lineas, empaques: empl, total,
  };
}

/* ---------- FORMULARIO: NUEVA TANDA ----------
   1) Buscas la prenda por nombre.
   2) Ves TODAS sus tallas y colores, con cuánto hay de cada uno.
   3) Escribes cuánto llegó de cada color y su costo.
   Si llega un color que la prenda no tiene, lo agregas ahí mismo. */
let compraProdId = null;        // prenda abierta en la tabla
let compraColoresExtra = [];    // colores nuevos agregados mientras se arma la tanda: [{producto_id, talla, color}]

function abrirFormCompra() {
  state.compraLineas = [];
  compraProdId = null;
  compraColoresExtra = [];
  const filaEmpaque = id => `
    <div class="row3 emp-row">
      <span>${EMP_NOMBRE[id]}</span>
      <label>Cantidad<input type="number" min="0" step="1" inputmode="numeric" value="0" data-emp="${id}" data-k="cantidad">
        <small class="hint" data-hint-emp="${id}"></small></label>
      <label>Costo c/u (USD)<input type="number" min="0" step="0.0001" inputmode="decimal" value="${empaque(id).costo_unit}" data-emp="${id}" data-k="costo"></label>
    </div>`;
  $("#modal .sheet").innerHTML = `
    <form id="formCompra" class="stack">
      <div class="sheet-head"><h3>Nueva tanda</h3>
        <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button></div>

      <details class="inv-modal" open>
        <summary>Inventario disponible</summary>
        <div id="inventarioModal" class="stack" style="margin-top:12px"></div>
      </details>

      <div class="row2">
        <label>Detalle (opcional)<input name="descripcion" maxlength="60" placeholder="Ej: Fresa, Verano" autocomplete="off"></label>
        <label>Costo de envío (USD)<input name="envio" type="number" min="0" step="0.01" inputmode="decimal" value="0"></label>
      </div>
      <p class="nombre-prev" id="cNombre"></p>

      <h4>Prendas que llegaron</h4>
      <div class="buscar-tanda">
        <input id="buscarTanda" class="input" placeholder="Escribe el nombre de la prenda…" autocomplete="off">
        <div id="resTanda" class="mini-grid"></div>
      </div>
      <div id="detalleTanda"></div>
      <div id="resumenTanda"></div>

      <h4>Empaques de esta tanda</h4>
      ${EMP_IDS.map(filaEmpaque).join("")}

      <div class="total"><span>Total de la tanda</span><strong id="cTotal">$0.00</strong></div>
      <div class="acc" style="justify-content:flex-end">
        <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
        <button class="btn" type="submit">Guardar tanda</button>
      </div>
    </form>`;
  pintarLineasCompra();
  refrescarInventario();
  abrirModal();
}

// Resultados del buscador de prendas (por nombre o categoría)
function pintarBuscadorTanda() {
  const q = $("#buscarTanda").value.trim().toLowerCase();
  const res = q ? state.productos.filter(p => (p.nombre + " " + p.categoria).toLowerCase().includes(q)) : [];
  $("#resTanda").innerHTML = res.length
    ? res.map(p => `
      <button type="button" class="mini" data-tanda-pick="${esc(p.id)}">
        <span class="thumb">${fotoHTML(p)}</span>
        <div><b>${esc(p.nombre)}</b><small>${esc(p.categoria)} · hay ${stockTotal(p)}</small></div>
      </button>`).join("")
    : (q ? `<p class="muted small">No encontramos "${esc(q)}".</p>` : "");
}

// Tallas que se pueden elegir al agregar un color nuevo
function tallasPosibles(p) {
  const existentes = [...new Set(p.variantes.map(v => v.talla))];
  if (existentes.includes("Única")) return ["Única"];
  return [...new Set(["S", "M", "L", ...existentes])];
}

// Todas las combinaciones talla + color de la prenda, más los colores nuevos
function filasTanda(p) {
  const filas = [];
  const vistos = new Set();
  const añadir = (talla, color, stock) => {
    const k = talla + "|" + color;
    if (vistos.has(k)) return;
    vistos.add(k);
    filas.push({ talla, color, stock });
  };
  p.variantes.forEach(v => añadir(v.talla, v.color, Number(v.stock) || 0));
  state.compraLineas.filter(l => l.producto_id === p.id).forEach(l => añadir(l.talla, l.color, stockVariante(p.id, l.talla, l.color)));
  compraColoresExtra.filter(x => x.producto_id === p.id).forEach(x => añadir(x.talla, x.color, stockVariante(p.id, x.talla, x.color)));
  return filas;
}

// Tabla de la prenda elegida: un renglón por talla y color
function pintarDetalleTanda() {
  const box = $("#detalleTanda");
  const p = state.productos.find(x => x.id === compraProdId);
  if (!p) { box.innerHTML = ""; return; }

  const filas = filasTanda(p).map(f => {
    const prev = state.compraLineas.find(l => l.producto_id === p.id && l.talla === f.talla && l.color === f.color);
    const cant = prev ? prev.cantidad : "";
    const costo = prev ? prev.costo_unit : p.costo;
    return `
    <tr data-fila data-talla="${esc(f.talla)}" data-color="${esc(f.color)}">
      <td>${esc(nombreTalla(f.talla))}</td>
      <td><b>${esc(f.color)}</b></td>
      <td class="num">${f.stock}</td>
      <td>
        <input class="celda" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="${cant}" data-tc="cant" aria-label="Cantidad de ${esc(f.color)}">
        <small class="hint" data-hint-fila></small>
      </td>
      <td><input class="celda" type="number" min="0" step="0.01" inputmode="decimal" value="${costo}" data-tc="costo" aria-label="Costo de ${esc(f.color)}"></td>
      <td class="num" data-sub>$0.00</td>
    </tr>`;
  }).join("");

  box.innerHTML = `
  <div class="card tanda-prod">
    <div class="tanda-head">
      <div class="thumb-sm">${fotoHTML(p)}</div>
      <div class="tanda-titulo">
        <small class="cat">${esc(p.categoria)}</small>
        <h4>${esc(p.nombre)}</h4>
        <small class="muted">Hay ${stockTotal(p)} en total</small>
      </div>
      <button type="button" class="x" data-tanda-cambiar aria-label="Elegir otra prenda">✕</button>
    </div>

    <div class="tabla-wrap">
      <table class="tab-tanda">
        <thead><tr><th>Talla</th><th>Color</th><th>Hay</th><th>Llegan</th><th>Costo c/u</th><th>Subtotal</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>

    <div class="color-nuevo">
      <p class="small muted">¿Llegó un color que esta prenda no tiene?</p>
      <div class="color-nuevo-fila">
        <input id="nuevoColor" maxlength="40" placeholder="Ej: Amarillo" autocomplete="off" aria-label="Nombre del color nuevo">
        <select id="nuevaTalla" aria-label="Talla del color nuevo">
          ${tallasPosibles(p).map(t => `<option value="${esc(t)}">${esc(nombreTalla(t))}</option>`).join("")}
        </select>
        <button type="button" class="btn sm" data-tanda-nuevo>Agregar color</button>
      </div>
    </div>
  </div>`;
}

// Lo escrito en la tabla pasa a las prendas de la tanda (sin tocar las de otras prendas)
function sincronizarTanda() {
  const p = state.productos.find(x => x.id === compraProdId);
  if (!p || !$("#detalleTanda .tanda-prod")) return;
  const nuevas = $$("#detalleTanda tr[data-fila]").map(tr => ({
    producto_id: p.id,
    talla: tr.dataset.talla,
    color: tr.dataset.color,
    cantidad: Number(tr.querySelector('[data-tc="cant"]').value) || 0,
    costo_unit: Number(tr.querySelector('[data-tc="costo"]').value) || 0,
  })).filter(l => l.cantidad > 0);
  state.compraLineas = [...state.compraLineas.filter(l => l.producto_id !== p.id), ...nuevas];
}

// Resumen de todo lo que lleva la tanda (todas las prendas)
function pintarLineasCompra() {
  const f = $("#formCompra");
  if (!f) return;
  const lista = state.compraLineas;
  $("#resumenTanda").innerHTML = lista.length ? `
    <h4 class="sub-h">Esta tanda lleva</h4>
    <ul class="lista">${lista.map((l, i) => {
      const p = state.productos.find(x => x.id === l.producto_id);
      return `<li class="linea">
        <div><b>${esc(p ? p.nombre : "Prenda")}</b><small>${esc(nombreTalla(l.talla))} · ${esc(l.color)} · ${money(l.costo_unit)} c/u</small></div>
        <div class="linea-r"><span>× ${l.cantidad}</span><strong>${money(l.cantidad * l.costo_unit)}</strong>
          <button type="button" class="x" data-tanda-quitar="${i}" aria-label="Quitar">✕</button></div>
      </li>`;
    }).join("")}</ul>`
    : `<p class="muted small">Aún no agregas prendas. Busca una arriba y escribe cuánto llegó de cada color.</p>`;
}

function quitarLineaTanda(i) {
  state.compraLineas.splice(i, 1);
  pintarDetalleTanda();
  pintarLineasCompra();
  recalcCompra();
}

// Recalcula todo: lo de la tabla, el resumen, los "quedarán", subtotales, empaques y total
function recalcCompra() {
  const f = $("#formCompra");
  if (!f) return;

  const antes = JSON.stringify(state.compraLineas);
  sincronizarTanda();
  if (JSON.stringify(state.compraLineas) !== antes) pintarLineasCompra();

  const p = compraProdId;
  $$("#detalleTanda tr[data-fila]").forEach(tr => {
    const cant = Number(tr.querySelector('[data-tc="cant"]').value) || 0;
    const costo = Number(tr.querySelector('[data-tc="costo"]').value) || 0;
    const hay = stockVariante(p, tr.dataset.talla, tr.dataset.color);
    tr.querySelector("[data-hint-fila]").textContent = cant ? `quedarán ${hay + cant}` : "";
    tr.querySelector("[data-sub]").textContent = money(cant * costo);
  });

  let costoEmp = 0;
  for (const id of EMP_IDS) {
    const c = Number(f.querySelector(`[data-emp="${id}"][data-k="cantidad"]`).value) || 0;
    const k = Number(f.querySelector(`[data-emp="${id}"][data-k="costo"]`).value) || 0;
    costoEmp += c * k;
    const hay = empaque(id).cantidad;
    f.querySelector(`[data-hint-emp="${id}"]`).textContent = `Hay ${hay} · quedarán ${hay + c}`;
  }

  const prendas = suma(state.compraLineas, l => (Number(l.cantidad) || 0) * (Number(l.costo_unit) || 0));
  const envio = Number(f.envio.value) || 0;
  $("#cTotal").textContent = money(prendas + envio + costoEmp);

  const desc = f.descripcion.value.trim();
  $("#cNombre").innerHTML = `Se guardará como <b>${esc(`Tanda ${siguienteNumero()}` + (desc ? ` · ${desc}` : ""))}</b>`;
}

// Clics dentro del formulario de tanda: buscador, elegir otra prenda, agregar color, quitar
document.addEventListener("click", (e) => {
  const t = e.target;
  let el;
  if ((el = t.closest("[data-tanda-pick]"))) {
    compraProdId = el.dataset.tandaPick;
    $("#buscarTanda").value = "";
    $("#resTanda").innerHTML = "";
    pintarDetalleTanda();
    recalcCompra();
    return;
  }
  if (t.closest("[data-tanda-cambiar]")) {
    sincronizarTanda();
    compraProdId = null;
    $("#detalleTanda").innerHTML = "";
    recalcCompra();
    return;
  }
  if (t.closest("[data-tanda-nuevo]")) {
    const p = state.productos.find(x => x.id === compraProdId);
    if (!p) return;
    const color = $("#nuevoColor").value.trim();
    if (!color) return toast("Escribe el nombre del color");
    const talla = $("#nuevaTalla").value;
    const repetido = filasTanda(p).some(x => x.talla === talla && x.color.toLowerCase() === color.toLowerCase());
    if (repetido) return toast("Ese color ya está en la lista de esta prenda");
    sincronizarTanda();
    compraColoresExtra.push({ producto_id: p.id, talla, color });
    pintarDetalleTanda();
    recalcCompra();
    toast(`Color "${color}" agregado. Escribe cuánto llegó ✔`);
    return;
  }
  if ((el = t.closest("[data-tanda-quitar]"))) return quitarLineaTanda(Number(el.dataset.tandaQuitar));
});

// Buscador: se actualiza mientras escribes
document.addEventListener("input", (e) => {
  if (e.target.id === "buscarTanda") pintarBuscadorTanda();
});

async function guardarCompra(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  const items = state.compraLineas
    .filter(l => l.producto_id && Number(l.cantidad) > 0)
    .map(l => ({ producto_id: l.producto_id, talla: l.talla, color: l.color, cantidad: Number(l.cantidad), costo_unit: Number(l.costo_unit) || 0 }));
  if (!items.length) return toast("Agrega al menos una prenda");
  if (items.some(i => !i.talla || !i.color)) return toast("Elige talla y color de cada prenda");

  const empaques = EMP_IDS.map(id => ({
    id,
    cantidad: Number(f.querySelector(`[data-emp="${id}"][data-k="cantidad"]`).value) || 0,
    costo_unit: Number(f.querySelector(`[data-emp="${id}"][data-k="costo"]`).value) || 0,
  })).filter(x => x.cantidad > 0);
  const envio = Number(f.envio.value) || 0;
  const descripcion = f.descripcion.value.trim();

  btn.disabled = true;
  try {
    const r = await DB.registrarLote(descripcion, envio, items, empaques);

    // Excel de la tanda, guardado dentro de la base de datos
    let aviso = null;
    try {
      const bytes = generarXlsx(armarLoteExcel(r, envio, items, empaques));
      await DB.archivarLote(r.id, new Blob([bytes], { type: MIME_XLSX }));
    } catch (err) {
      console.error(err);
      aviso = "La tanda se guardó, pero no se pudo crear su Excel";
    }

    cerrarModal();
    toast(aviso || `${r.nombre} registrada ✔`);
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo registrar la tanda");
    btn.disabled = false;
  }
}

/* ---------- INVENTARIO INICIAL (conteo físico) ---------- */
// Reemplaza las existencias por lo que se cuenta hoy. No toca la caja.
function abrirFormInventario() {
  const prendas = state.productos.map(p => `
    <div class="card inv-edit">
      <div class="inv-head"><b>${esc(p.nombre)}</b><small class="muted">${esc(p.categoria)}</small></div>
      <div class="inv-vars">
        ${p.variantes.map((v, i) => `
          <label class="inv-var">${v.talla === "Única" ? "Única" : esc(v.talla)} · ${esc(v.color)}
            <input type="number" min="0" step="1" inputmode="numeric" value="${v.stock}"
              data-inv-prod="${esc(p.id)}" data-inv-var="${i}" aria-label="Existencias ${esc(p.nombre)} ${esc(v.color)}">
          </label>`).join("")}
      </div>
    </div>`).join("");

  $("#modal .sheet").innerHTML = `
    <form id="formInv" class="stack">
      <div class="sheet-head"><h3>Inventario inicial</h3>
        <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button></div>
      <p class="muted small">Escribe lo que cuentas hoy físicamente. Reemplaza las existencias actuales y no afecta la caja.</p>

      <h4>Empaques</h4>
      <div class="row3">
        ${EMP_IDS.map(id => `<label>${EMP_CORTO[id]}
          <input type="number" min="0" step="1" inputmode="numeric" value="${empaque(id).cantidad}" data-inv-emp="${id}"></label>`).join("")}
      </div>

      <h4>Prendas</h4>
      ${prendas ? `<div class="inv-edit-lista">${prendas}</div>` : `<p class="muted small">Aún no hay prendas en el catálogo.</p>`}

      <div class="acc" style="justify-content:flex-end">
        <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
        <button class="btn" type="submit">Guardar inventario</button>
      </div>
    </form>`;
  abrirModal();
}

async function guardarInventario(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  // Un número entero, cero o más; campo vacío = error (no cero por accidente)
  const leer = el => {
    if (!el || el.value.trim() === "") return NaN;
    const n = Number(el.value);
    return Number.isInteger(n) && n >= 0 ? n : NaN;
  };

  const productos = [];
  for (const p of state.productos) {
    const stocks = p.variantes.map((v, i) => leer(f.querySelector(`[data-inv-prod="${p.id}"][data-inv-var="${i}"]`)));
    if (stocks.some(Number.isNaN)) return toast(`Revisa las existencias de ${p.nombre}: solo números enteros, cero o más`);
    if (stocks.some((s, i) => s !== Number(p.variantes[i].stock))) productos.push({ id: p.id, stocks });
  }

  const empaques = [];
  for (const id of EMP_IDS) {
    const c = leer(f.querySelector(`[data-inv-emp="${id}"]`));
    if (Number.isNaN(c)) return toast("Revisa las cantidades de empaques: solo números enteros, cero o más");
    if (c !== empaque(id).cantidad) empaques.push({ id, cantidad: c });
  }

  if (!productos.length && !empaques.length) return toast("No hay cambios que guardar");
  if (!confirm("¿Reemplazar las existencias actuales por este conteo?")) return;

  btn.disabled = true;
  try {
    await DB.ajustarInventario(productos, empaques);
    cerrarModal();
    toast("Inventario guardado ✔");
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo guardar el inventario");
    btn.disabled = false;
  }
}
