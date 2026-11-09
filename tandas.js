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

/* ---------- FORMULARIO: NUEVA TANDA ---------- */
function abrirFormCompra() {
  state.compraLineas = [{ producto_id: "", talla: "", color: "", cantidad: 1, costo_unit: 0 }];
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
      <div id="cLineas" class="stack"></div>
      <button type="button" class="btn ghost sm" id="btnAddLinea" style="align-self:flex-start">+ Agregar prenda</button>

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

function pintarLineasCompra() {
  const f = $("#formCompra");
  if (!f) return;
  $("#cLineas").innerHTML = state.compraLineas.map((l, i) => {
    const p = state.productos.find(x => x.id === l.producto_id);
    const tallas = p ? [...new Set(p.variantes.map(v => v.talla))] : [];
    const colores = p ? [...new Set(p.variantes.map(v => v.color))] : [];
    return `
    <div class="card linea-compra">
      <select data-i="${i}" data-f="producto" aria-label="Prenda">
        <option value="">Elige la prenda…</option>
        ${state.productos.map(x => `<option value="${esc(x.id)}" ${x.id === l.producto_id ? "selected" : ""}>${esc(x.nombre)} · hay ${stockTotal(x)}</option>`).join("")}
      </select>
      <div class="row3">
        <select data-i="${i}" data-f="talla" aria-label="Talla" ${p ? "" : "disabled"}>
          ${tallas.map(t => `<option value="${esc(t)}" ${t === l.talla ? "selected" : ""}>${esc(nombreTalla(t))}</option>`).join("")}
        </select>
        <select data-i="${i}" data-f="color" aria-label="Color" ${p ? "" : "disabled"}>
          ${colores.map(c => `<option value="${esc(c)}" ${c === l.color ? "selected" : ""}>${esc(c)}</option>`).join("")}
        </select>
        <label class="cant">Cantidad
          <input type="number" min="1" step="1" inputmode="numeric" value="${l.cantidad}" data-i="${i}" data-f="cantidad" aria-label="Cantidad">
          <small class="hint" data-hint-linea="${i}"></small>
        </label>
      </div>
      <div class="row2">
        <label>Costo c/u (USD)<input type="number" min="0" step="0.01" inputmode="decimal" value="${l.costo_unit}" data-i="${i}" data-f="costo"></label>
        <button type="button" class="btn ghost sm" data-i="${i}" data-f="quitar" style="align-self:end">Quitar</button>
      </div>
    </div>`;
  }).join("");
  recalcCompra();
}

// Recalcula total, nombre de la tanda y los hints "Hay X · quedarán Y"
function recalcCompra() {
  const f = $("#formCompra");
  if (!f) return;

  state.compraLineas.forEach((l, i) => {
    const h = f.querySelector(`[data-hint-linea="${i}"]`);
    if (!h) return;
    if (!l.producto_id) { h.textContent = ""; return; }
    const hay = stockVariante(l.producto_id, l.talla, l.color);
    h.textContent = `Hay ${hay} · quedarán ${hay + (Number(l.cantidad) || 0)}`;
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
