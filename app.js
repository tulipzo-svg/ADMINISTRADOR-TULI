/* =========================================================
   VALLERY · Interfaz y lógica
   Requiere data.js (cargado antes).
   ========================================================= */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  usuaria: null,
  productos: [], ventas: [], movs: [], act: [], lotes: [], empaques: [],
  recordatorios: [], notas: [], tasas: [], perfiles: [],
  lastActId: null,
  tab: "inicio",
  carrito: [],
  selVenta: null,
  selDetalle: { talla: null, color: null, cantidad: 1 },
  empaque: { bolsa: null, manual: false, etiquetas: 1 },
  compraLineas: [],
  filtroInv: { q: "", chip: "todos" },
  rangoCaja: "mes",
  analitica: { modo: "dia", ventana: 7, off: 0 },
  chart: null,
  canal: null,
};

const DEFECTO_VENTANA = { dia: 7, semana: 8, mes: 6, anio: 5 };
const NOMBRE_BOLSA = { bolsa_mediana: "Bolsa mediana", bolsa_grande: "Bolsa grande" };

const kpi = (t, v, s = "") => `<div class="card kpi"><small>${t}</small><strong>${v}</strong>${s ? `<span>${s}</span>` : ""}</div>`;
const fotoHTML = p => p.foto_url
  ? `<img src="${esc(p.foto_url)}" alt="${esc(p.nombre)}" loading="lazy">`
  : `<div class="ph">✿</div>`;
const stockTotal = p => suma(p.variantes || [], v => v.stock);
const fechaCorta = iso => new Date(iso).toLocaleString("es-VE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const empaque = id => state.empaques.find(e => e.id === id) || { cantidad: 0, costo_unit: 0 };
function tiempoRelativo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-VE", { day: "numeric", month: "short" });
}
const saludoHora = () => { const h = new Date().getHours(); return h < 12 ? "Buen día" : h < 19 ? "Buenas tardes" : "Buenas noches"; };

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------- MÉTRICAS ---------- */
function enRango(iso, r) {
  if (r === "todo") return true;
  const d = new Date(iso), n = new Date();
  if (r === "hoy") return ymd(d) === ymd(n);
  if (r === "mes") return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  if (r === "anio") return d.getFullYear() === n.getFullYear();
  return true;
}

function metricas(r) {
  const ventas = state.ventas.filter(v => enRango(v.creado_en, r));
  const movs = state.movs.filter(m => enRango(m.creado_en, r));
  const ingresos = suma(ventas, v => v.total);
  const costo = suma(ventas, v => v.costo_total);
  const gastos = suma(movs.filter(m => m.tipo === "gasto"), m => m.monto);
  const mercancia = suma(movs.filter(m => m.tipo === "mercancia"), m => m.monto);
  const retiros = suma(movs.filter(m => m.tipo === "retiro"), m => m.monto);
  const capital = suma(movs.filter(m => m.tipo === "capital"), m => m.monto);
  const bruta = ingresos - costo;
  return {
    ventas: ventas.length, ingresos, costo, bruta, gastos,
    neta: bruta - gastos, mercancia, retiros,
    capital, caja: ingresos - gastos - mercancia - retiros + capital,
  };
}

function unidadesPorProducto() {
  const m = new Map();
  for (const v of state.ventas) for (const it of v.items) m.set(it.producto_id, (m.get(it.producto_id) || 0) + Number(it.cantidad));
  return m;
}

// Productos ordenados por unidades vendidas (todas las ventas)
function ranking() {
  const mapa = new Map(state.productos.map(p => [p.id, { id: p.id, nombre: p.nombre, unidades: 0, ingresos: 0 }]));
  for (const v of state.ventas) for (const it of v.items) {
    if (!mapa.has(it.producto_id)) mapa.set(it.producto_id, { id: it.producto_id, nombre: it.nombre, unidades: 0, ingresos: 0 });
    const r = mapa.get(it.producto_id);
    r.unidades += Number(it.cantidad);
    r.ingresos += Number(it.precio) * Number(it.cantidad);
  }
  return [...mapa.values()].sort((a, b) => b.unidades - a.unidades || a.nombre.localeCompare(b.nombre));
}

/* ---------- PERIODOS PARA LA GRÁFICA ---------- */
function inicioPeriodo(d, modo) {
  if (modo === "dia") return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (modo === "semana") {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  if (modo === "mes") return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d.getFullYear(), 0, 1);
}
function siguientePeriodo(d, modo) {
  const x = new Date(d);
  if (modo === "dia") x.setDate(x.getDate() + 1);
  else if (modo === "semana") x.setDate(x.getDate() + 7);
  else if (modo === "mes") x.setMonth(x.getMonth() + 1);
  else x.setFullYear(x.getFullYear() + 1);
  return x;
}
function etiquetaPeriodo(d, modo) {
  if (modo === "dia") return d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit" });
  if (modo === "semana") return "Sem " + d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit" });
  if (modo === "mes") return d.toLocaleDateString("es-VE", { month: "short", year: "2-digit" });
  return String(d.getFullYear());
}
// Un bloque por periodo, sin huecos (los días sin ventas quedan en cero)
function buckets(modo) {
  if (!state.ventas.length) return [];
  const mapa = new Map();
  let min = null;
  for (const v of state.ventas) {
    const d = new Date(v.creado_en);
    const k = ymd(inicioPeriodo(d, modo));
    if (!mapa.has(k)) mapa.set(k, { total: 0, ganancia: 0, unidades: 0 });
    const b = mapa.get(k);
    b.total += Number(v.total);
    b.ganancia += Number(v.total) - Number(v.costo_total);
    b.unidades += suma(v.items, i => i.cantidad);
    if (!min || d < min) min = d;
  }
  const out = [];
  const fin = inicioPeriodo(new Date(), modo);
  for (let d = inicioPeriodo(min, modo); d <= fin; d = siguientePeriodo(d, modo)) {
    const b = mapa.get(ymd(d)) || { total: 0, ganancia: 0, unidades: 0 };
    out.push({ label: etiquetaPeriodo(d, modo), ...b });
  }
  return out;
}

/* ---------- RENDER ---------- */
function render() {
  pintarPerfilChip();
  pintarInicio();
  pintarVenta();
  pintarInventario();
  pintarGasto();
  pintarCaja();
  pintarNotas();
  pintarAnalitica();
  $("#fechaHoy").textContent = new Date().toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long" });
}

function pintarInicio() {
  $("#saludo").textContent = `${saludoHora()}, ${state.usuaria.nombre}`;
  const h = metricas("hoy"), m = metricas("mes"), t = metricas("todo");
  // Modo privado (perfil): oculta los montos de Inicio
  const oc = miPerfil().ocultar_montos;
  const M = v => (oc ? "•••••" : v);
  $("#fraseHoy").textContent = miPerfil().frase || fraseDelDia();
  $("#kpisInicio").innerHTML = [
    kpi("Ventas hoy", M(money(h.ingresos)), `${h.ventas} venta(s)`),
    kpi("Ventas del mes", M(money(m.ingresos)), `${m.ventas} venta(s)`),
    kpi("Ganancia neta del mes", M(money(m.neta)), "Después de costos y gastos"),
    kpi("Saldo en caja", M(money(t.caja)), oc ? "Modo privado activo" : lineaBs(t.caja)),
  ].join("");

  $("#feed").innerHTML = state.act.slice(0, 15).map(a => `
    <li class="feed-item">
      <span class="avatar">${esc(a.usuaria[0] || "?")}</span>
      <div><b>${esc(a.usuaria)}</b> ${esc(a.texto)}<small>${tiempoRelativo(a.creado_en)}</small></div>
    </li>`).join("") || `<li class="muted">Aún no hay actividad.</li>`;

  const bajos = [];
  for (const p of state.productos) for (const v of p.variantes) if (v.stock <= 1) bajos.push({ p, v });
  $("#bajoStock").innerHTML = bajos.slice(0, 12).map(({ p, v }) => `
    <li class="linea"><div><b>${esc(p.nombre)}</b><small>${esc(v.talla)} · ${esc(v.color)}</small></div>
    <strong class="${v.stock <= 0 ? "neg" : ""}">${v.stock} ud.</strong></li>`).join("")
    || `<li class="muted">Todo con buena existencia.</li>`;
}

/* ---------- VENTA ---------- */
function pintarVenta() {
  const q = $("#buscarVenta").value.trim().toLowerCase();
  const res = q ? state.productos.filter(p => (p.nombre + " " + p.categoria).toLowerCase().includes(q)) : [];
  $("#resVenta").innerHTML = res.length
    ? res.map(p => `
      <button class="mini" data-pick="${esc(p.id)}">
        <span class="thumb">${fotoHTML(p)}</span>
        <div><b>${esc(p.nombre)}</b><small>${money(p.precio)} · ${stockTotal(p)} disp.</small></div>
      </button>`).join("")
    : `<p class="muted small">${q ? `No encontramos "${esc(q)}".` : "Escribe el nombre de la prenda para buscarla."}</p>`;
  pintarSeleccion();
  pintarCarrito();
  pintarEmpaqueVenta();
}

function pintarSeleccion() {
  const box = $("#selVenta");
  const p = state.productos.find(x => x.id === state.selVenta);
  if (!p) { box.innerHTML = ""; return; }
  const sd = state.selDetalle;
  const tallas = [...new Set(p.variantes.map(v => v.talla))];
  const colores = [...new Set(p.variantes.map(v => v.color))];
  const unica = tallas.length === 1 && tallas[0] === "Única"; // talla única: no se elige talla
  if (unica) sd.talla = "Única";

  const disp = (t, c) => {
    const v = p.variantes.find(x => x.talla === t && x.color === c);
    if (!v) return 0;
    const enCarrito = state.carrito
      .filter(i => i.producto_id === p.id && i.talla === t && i.color === c)
      .reduce((a, i) => a + i.cantidad, 0);
    return Math.max(0, v.stock - enCarrito);
  };
  const tallaOk = t => colores.some(c => disp(t, c) > 0);
  const colorOk = c => (sd.talla ? disp(sd.talla, c) > 0 : tallas.some(t => disp(t, c) > 0));
  const max = sd.talla && sd.color ? disp(sd.talla, sd.color) : 0;
  const listo = max > 0;
  if (sd.cantidad > max) sd.cantidad = Math.max(1, max);

  const tallasHTML = unica
    ? `<p class="small muted">Talla única</p>`
    : `<div><p class="small muted">Talla</p><div class="opts">${tallas.map(t => `<button class="opt ${sd.talla === t ? "on" : ""}" data-talla="${esc(t)}" ${tallaOk(t) ? "" : "disabled"}>${esc(t)}</button>`).join("")}</div></div>`;

  box.innerHTML = `
    <div class="sel">
      <div class="sel-head">
        <div class="thumb">${fotoHTML(p)}</div>
        <div><small class="cat">${esc(p.categoria)}</small><h4>${esc(p.nombre)}</h4><strong>${money(p.precio)}</strong></div>
      </div>
      ${tallasHTML}
      <div><p class="small muted">Color</p>
        <div class="opts">${colores.map(c => `<button class="opt ${sd.color === c ? "on" : ""}" data-color="${esc(c)}" ${colorOk(c) ? "" : "disabled"}>${esc(c)}</button>`).join("")}</div></div>
      <div class="stepper-row">
        <div class="stepper">
          <button data-delta="-1" ${sd.cantidad <= 1 ? "disabled" : ""} aria-label="Quitar uno">−</button>
          <span>${sd.cantidad}</span>
          <button data-delta="1" ${!listo || sd.cantidad >= max ? "disabled" : ""} aria-label="Agregar uno">+</button>
        </div>
        <small class="muted">${sd.talla && sd.color ? `Disponibles: ${max}` : "Elige el color"}</small>
      </div>
      <button class="btn" id="btnAgregar" ${listo ? "" : "disabled"}>Agregar a la venta</button>
    </div>`;
}

function agregarAlCarrito() {
  const p = state.productos.find(x => x.id === state.selVenta);
  const sd = state.selDetalle;
  if (!p || !sd.talla || !sd.color) return;
  const it = state.carrito.find(x => x.producto_id === p.id && x.talla === sd.talla && x.color === sd.color);
  if (it) it.cantidad += sd.cantidad;
  else state.carrito.push({ producto_id: p.id, nombre: p.nombre, talla: sd.talla, color: sd.color, cantidad: sd.cantidad, precio: p.precio, costo: p.costo });
  state.selVenta = null;
  state.selDetalle = { talla: null, color: null, cantidad: 1 };
  $("#buscarVenta").value = "";
  pintarVenta();
  toast("Agregado a la venta");
}

function pintarCarrito() {
  $("#lineasVenta").innerHTML = state.carrito.length
    ? state.carrito.map((i, idx) => `
      <li class="linea">
        <div><b>${esc(i.nombre)}</b><small>${i.talla === "Única" ? "Talla única" : esc(i.talla)} · ${esc(i.color)} · ${money(i.precio)} c/u</small></div>
        <div class="linea-r"><span>× ${i.cantidad}</span><strong>${money(i.precio * i.cantidad)}</strong>
          <button class="x" data-quitar="${idx}" aria-label="Quitar">✕</button></div>
      </li>`).join("")
    : `<li class="muted small">Aún no hay prendas en la venta.</li>`;
  const total = state.carrito.reduce((a, i) => a + i.precio * i.cantidad, 0);
  $("#totalVenta").textContent = money(total);
  $("#btnCobrar").disabled = !state.carrito.length;
}

// Bolsa sugerida: 1-2 prendas → mediana; 3 o más → grande
function bolsaSugerida() {
  const piezas = suma(state.carrito, i => i.cantidad);
  if (!piezas) return null;
  return piezas >= 3 ? "bolsa_grande" : "bolsa_mediana";
}

function pintarEmpaqueVenta() {
  const box = $("#empaqueVenta");
  if (!state.carrito.length) {
    state.empaque = { bolsa: null, manual: false, etiquetas: 1 };
    box.innerHTML = "";
    return;
  }
  if (!state.empaque.manual) state.empaque.bolsa = bolsaSugerida();
  const e = state.empaque;
  const boton = id => `<button class="opt ${e.bolsa === id ? "on" : ""}" data-bolsa="${id}" ${empaque(id).cantidad < 1 ? "disabled" : ""}>
      ${NOMBRE_BOLSA[id]}<small>quedan ${empaque(id).cantidad}</small></button>`;
  box.innerHTML = `
    <div class="empaque">
      <p class="small muted">Empaque de esta venta</p>
      <div class="opts">
        ${boton("bolsa_mediana")}${boton("bolsa_grande")}
        <button class="opt ${e.manual && !e.bolsa ? "on" : ""}" data-bolsa="">Sin bolsa</button>
      </div>
      <div class="stepper-row">
        <span class="small">Etiqueta de agradecimiento</span>
        <div class="stepper">
          <button data-etq="-1" ${e.etiquetas <= 0 ? "disabled" : ""} aria-label="Quitar etiqueta">−</button>
          <span>${e.etiquetas}</span>
          <button data-etq="1" ${e.etiquetas >= empaque("etiqueta").cantidad ? "disabled" : ""} aria-label="Agregar etiqueta">+</button>
        </div>
        <small class="muted">quedan ${empaque("etiqueta").cantidad}</small>
      </div>
    </div>`;
}

async function cobrar() {
  const btn = $("#btnCobrar");
  const { bolsa, etiquetas } = state.empaque;
  if (bolsa && empaque(bolsa).cantidad < 1) return toast(`No hay ${NOMBRE_BOLSA[bolsa].toLowerCase()} disponible`);
  btn.disabled = true;
  try {
    await DB.venta(
      state.carrito.map(i => ({ producto_id: i.producto_id, talla: i.talla, color: i.color, cantidad: i.cantidad })),
      bolsa, etiquetas
    );
    state.carrito = [];
    toast("Venta registrada ✔");
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo registrar la venta");
    btn.disabled = false;
  }
}

/* ---------- INVENTARIO / CATÁLOGO ---------- */
function pintarInventario() {
  const { q, chip } = state.filtroInv;
  const cats = [...new Set(state.productos.map(p => p.categoria))].sort();
  const uds = unidadesPorProducto();
  const topIds = [...uds.entries()].filter(([, u]) => u > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);

  const chips = [["todos", "Todos"], ["destacados", "Destacados"], ["vendidos", "Más vendidos"], ["bajo", "Poca existencia"],
    ...cats.map(c => ["cat:" + c, c])];
  $("#chips").innerHTML = chips.map(([k, l]) => `<button class="chip ${chip === k ? "on" : ""}" data-chip="${esc(k)}">${esc(l)}</button>`).join("");

  const lista = state.productos.filter(p => {
    if (q && !(p.nombre + " " + p.categoria).toLowerCase().includes(q)) return false;
    if (chip === "destacados") return p.destacado;
    if (chip === "vendidos") return topIds.includes(p.id);
    if (chip === "bajo") return stockTotal(p) <= 3;
    if (chip.startsWith("cat:")) return p.categoria === chip.slice(4);
    return true;
  });
  if (chip === "vendidos") lista.sort((a, b) => topIds.indexOf(a.id) - topIds.indexOf(b.id));

  $("#gridProd").innerHTML = lista.map(p => {
    const total = stockTotal(p);
    const estado = total <= 0 ? "agotado" : total <= 3 ? "bajo" : "";
    return `
    <article class="prod card">
      <button class="prod-foto foto-btn" data-foto-ver="${esc(p.id)}" aria-label="Ver foto de ${esc(p.nombre)} en grande" title="Toca para ver la foto grande">
        ${fotoHTML(p)}${p.destacado ? '<span class="badge">Destacado</span>' : ""}
      </button>
      <div class="prod-body">
        <small class="cat">${esc(p.categoria)}</small>
        <h4>${esc(p.nombre)}</h4>
        <div class="precio"><strong>${money(p.precio)}</strong><span class="stock-chip ${estado}">${total} ud.</span></div>
        <details class="vars-det">
          <summary>Tallas y colores</summary>
          <div class="vars">${p.variantes.map(v => `<span class="var ${v.stock <= 0 ? "agotado" : v.stock <= 1 ? "bajo" : ""}">${v.talla === "Única" ? "Única" : esc(v.talla)} · ${esc(v.color)}: ${v.stock}</span>`).join("")}</div>
        </details>
        <div class="acc">
          <button class="btn sm" data-editar="${esc(p.id)}">Editar</button>
          <button class="btn sm ghost icono" data-destacar="${esc(p.id)}" aria-label="${p.destacado ? "Quitar destacado" : "Destacar"}" title="${p.destacado ? "Quitar destacado" : "Destacar"}">${p.destacado ? "★" : "☆"}</button>
          <button class="btn sm danger icono" data-borrar="${esc(p.id)}" aria-label="Eliminar ${esc(p.nombre)}" title="Eliminar">🗑</button>
        </div>
      </div>
    </article>`;
  }).join("") || `<p class="muted empty">No hay prendas con este filtro.</p>`;

  $("#demoNota").innerHTML = DEMO
    ? `Modo demostración. <button class="btn sm ghost" id="btnReset">Reiniciar demostración en cero</button>`
    : "";
}

let editProd = null;
let fotoBlob = null;

// Tallas se marcan con casillas. "Talla única" excluye S, M y L.
const tallasSel = () => $$("#formProd input[name=t]:checked").map(x => x.value);

function abrirFormProducto(p = null) {
  editProd = p;
  fotoBlob = null;
  const marcadas = new Set(p ? p.variantes.map(v => v.talla) : []);
  const coloresTxt = p ? [...new Set(p.variantes.map(v => v.color))].join(", ") : "";
  const cats = [...new Set(state.productos.map(x => x.categoria))].sort();
  const tog = (v, l) => `<label class="tog"><input type="checkbox" name="t" value="${v}" ${marcadas.has(v) ? "checked" : ""}> ${l}</label>`;
  $("#modal .sheet").innerHTML = `
    <form id="formProd" class="stack">
      <div class="sheet-head"><h3>${p ? "Editar prenda" : "Nueva prenda"}</h3>
        <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button></div>

      <label class="foto-up">
        <div class="foto-prev" id="fotoPrev">${p && p.foto_url ? `<img src="${esc(p.foto_url)}" alt="">` : "<span>📷 Toca para subir una foto</span>"}</div>
        <input type="file" id="fotoIn" accept="image/*" class="sr">
      </label>

      <label>Nombre<input name="nombre" required maxlength="80" value="${esc(p?.nombre || "")}"></label>
      <div class="row2">
        <label>Categoría<input name="categoria" list="listaCats" required maxlength="40" value="${esc(p?.categoria || "")}"></label>
        <label>Destacado<select name="destacado"><option value="no" ${p?.destacado ? "" : "selected"}>No</option><option value="si" ${p?.destacado ? "selected" : ""}>Sí</option></select></label>
      </div>
      <datalist id="listaCats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
      <div class="row2">
        <label>Precio de venta (USD)<input name="precio" type="number" min="0" step="0.01" inputmode="decimal" required value="${p ? p.precio : ""}"></label>
        <label>Costo por unidad (USD)<input name="costo" type="number" min="0" step="0.01" inputmode="decimal" value="${p ? p.costo : 0}"></label>
      </div>

      <div>
        <p class="small muted" style="margin-bottom:6px">Tallas</p>
        <div class="opts">${tog("S", "S")}${tog("M", "M")}${tog("L", "L")}${tog("Única", "Talla única")}</div>
      </div>
      <label>Colores (separados por coma)<input name="colores" required placeholder="Ej: Negro, Blanco" value="${esc(coloresTxt)}"></label>

      <div>
        <p class="small muted" style="margin-bottom:6px">Existencias por talla y color</p>
        <div id="grilla"></div>
      </div>

      <div class="acc" style="justify-content:flex-end">
        <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
        <button class="btn" type="submit">Guardar</button>
      </div>
    </form>`;
  pintarGrilla(new Map((p ? p.variantes : []).map(v => [v.talla + "|" + v.color, v.stock])));
  abrirModal();
}

function leerGrilla() {
  return new Map($$("#grilla input").map(i => [i.dataset.t + "|" + i.dataset.c, i.value]));
}

function pintarGrilla(prev = new Map()) {
  const f = $("#formProd");
  if (!f) return;
  const tallas = tallasSel();
  const colores = splitLista(f.colores.value);
  const g = $("#grilla");
  if (!tallas.length || !colores.length) {
    g.innerHTML = `<p class="muted small">Elige tallas y escribe los colores para ver las existencias de cada variante.</p>`;
    return;
  }
  const nombreT = t => (t === "Única" ? "Talla única" : t);
  g.innerHTML = `<div class="tabla-wrap"><table class="tab-stock">
    <thead><tr><th></th>${colores.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${tallas.map(t => `<tr><th>${esc(nombreT(t))}</th>${colores.map(c => `
      <td><input type="number" min="0" step="1" inputmode="numeric" data-t="${esc(t)}" data-c="${esc(c)}"
        value="${esc(prev.get(t + "|" + c) ?? 0)}" aria-label="Stock ${esc(nombreT(t))} ${esc(c)}"></td>`).join("")}</tr>`).join("")}
    </tbody></table></div>`;
}

async function guardarProducto(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  if (!tallasSel().length) return toast("Elige al menos una talla o talla única");
  const variantes = $$("#grilla input").map(i => ({
    talla: i.dataset.t, color: i.dataset.c, stock: Math.max(0, parseInt(i.value || "0", 10) || 0),
  }));
  if (!variantes.length) return toast("Escribe al menos un color");
  const precio = Number(f.precio.value), costo = Number(f.costo.value || 0);
  if (!(precio >= 0) || !(costo >= 0)) return toast("Revisa precio y costo");

  btn.disabled = true;
  try {
    let foto_url = editProd ? editProd.foto_url || null : null;
    if (fotoBlob) foto_url = await DB.subirFoto(fotoBlob);
    await DB.guardarProducto({
      id: editProd ? editProd.id : undefined,
      nombre: f.nombre.value.trim(),
      categoria: f.categoria.value.trim(),
      precio, costo,
      destacado: f.destacado.value === "si",
      foto_url,
      variantes,
    });
    cerrarModal();
    toast(editProd ? "Prenda actualizada ✔" : "Prenda agregada ✔");
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo guardar la prenda");
    btn.disabled = false;
  }
}

/* ---------- CAJA, TASA BCV Y CAPITAL DE AFUERA ---------- */
const LABEL_TIPO = { gasto: "Gasto operativo", mercancia: "Compra de mercancía", retiro: "Retiro", capital: "Capital de afuera" };

// Tasa BCV: la más reciente primero
const tasasOrdenadas = () => [...state.tasas].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
const tasaActual = () => tasasOrdenadas()[0] || null;
const fmtTasa = n => (Number(n) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const bsTxt = n => "Bs " + (Number(n) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaDia = iso => new Date(iso + "T12:00:00").toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" });

// Saldo en bolívares a la tasa más reciente (o aviso si aún no hay tasa)
function lineaBs(usd) {
  const t = tasaActual();
  return t ? `≈ ${bsTxt(usd * Number(t.valor))} · tasa ${fmtTasa(t.valor)}` : "Registra la tasa de hoy";
}

function pintarTasa() {
  const lista = tasasOrdenadas();
  const hoy = lista[0], ayer = lista[1];
  const f = $("#formTasa");
  if (f && !f.fecha.value) f.fecha.value = ymd(new Date());
  $("#tasaHoy").textContent = hoy ? `${fmtTasa(hoy.valor)} Bs por USD` : "Sin registrar";
  $("#tasaFecha").textContent = hoy ? `Del ${fechaDia(hoy.fecha)}` : "Registra la tasa BCV del día";
  // Variación porcentual de una tasa frente a otra anterior
  const variacion = (a, b) => (Number(a.valor) - Number(b.valor)) / Number(b.valor) * 100;
  $("#tasaVar").innerHTML = hoy && ayer
    ? (() => {
        const v = variacion(hoy, ayer);
        return `<span class="${v > 0 ? "sube" : v < 0 ? "baja" : ""}">${v > 0 ? "▲" : v < 0 ? "▼" : "="} ${Math.abs(v).toFixed(2)}%</span> frente a ${fechaDia(ayer.fecha)}`;
      })()
    : "";
  $("#tasasHist").innerHTML = lista.slice(0, 30).map((t, i) => {
    const prev = lista[i + 1];
    const v = prev ? variacion(t, prev) : null;
    const cls = v === null ? "" : v > 0 ? "sube" : v < 0 ? "baja" : "";
    const txt = v === null ? "—" : `${v > 0 ? "▲ +" : v < 0 ? "▼ " : "= "}${Math.abs(v).toFixed(2)}%`;
    return `<li class="linea"><div><b>${fmtTasa(t.valor)} Bs</b><small>${fechaDia(t.fecha)}</small></div><strong class="${cls}">${txt}</strong></li>`;
  }).join("") || `<li class="muted small">Aún no hay tasas registradas.</li>`;
}

function pintarCaja() {
  const R = state.rangoCaja;
  $("#chipsRango").innerHTML = [["hoy", "Hoy"], ["mes", "Este mes"], ["anio", "Este año"], ["todo", "Todo"]]
    .map(([k, l]) => `<button class="chip ${R === k ? "on" : ""}" data-rango="${k}">${l}</button>`).join("");
  const m = metricas(R);
  const saldo = metricas("todo").caja;
  const t = tasaActual();
  $("#kpisCaja").innerHTML = [
    kpi("Ingresos por ventas", money(m.ingresos), `${m.ventas} venta(s)`),
    kpi("Ganancia bruta", money(m.bruta), `Costo vendido ${money(m.costo)}`),
    kpi("Gastos operativos", money(m.gastos), "Envíos, empaques, alquiler…"),
    kpi("Ganancia neta", money(m.neta), "Bruta − gastos operativos"),
    kpi("Capital de afuera", money(m.capital), "Entró a la caja, no es ganancia"),
    kpi("Compras de mercancía", money(m.mercancia), "Inversión en prendas"),
    kpi("Retiros", money(m.retiros), "Dinero retirado"),
    kpi("Saldo en dólares", money(saldo), "Total acumulado"),
    kpi("Saldo en bolívares", t ? bsTxt(saldo * Number(t.valor)) : "—", t ? `A la tasa de ${fmtTasa(t.valor)}` : "Registra la tasa de hoy"),
  ].join("");
  pintarTasa();
  const movs = state.movs.filter(x => enRango(x.creado_en, R));
  $("#listaMovs").innerHTML = movs.slice(0, 60).map(x => `
    <li class="linea">
      <div><b>${esc(LABEL_TIPO[x.tipo] || x.tipo)}</b> — ${esc(x.concepto)}
        <small>${esc(x.usuaria)} · ${fechaCorta(x.creado_en)}</small></div>
      <strong class="${x.tipo === "retiro" ? "neg" : x.tipo === "capital" ? "pos" : ""}">${money(x.monto)}</strong>
    </li>`).join("") || `<li class="muted small">Sin movimientos en este periodo.</li>`;
}

async function registrarMov(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    await DB.movimiento(f.tipo.value, f.concepto.value.trim(), Number(f.monto.value));
    f.reset();
    toast("Movimiento registrado ✔");
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo registrar");
  } finally {
    btn.disabled = false;
  }
}

async function guardarTasaForm(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  const valor = Number(f.valor.value);
  if (!(valor > 0)) return toast("Escribe la tasa en Bs por USD");
  if (!f.fecha.value) return toast("Elige la fecha de la tasa");
  btn.disabled = true;
  try {
    await DB.guardarTasa(f.fecha.value, valor);
    f.valor.value = "";
    toast("Tasa guardada ✔");
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo guardar la tasa");
  } finally {
    btn.disabled = false;
  }
}

// Formulario para inyectar capital de afuera (en dólares o en bolívares convertidos)
function abrirFormCapital() {
  $("#modal .sheet").innerHTML = `
    <form id="formCapital" class="stack">
      <div class="sheet-head"><h3>Inyectar capital de afuera</h3>
        <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button></div>
      <p class="muted small">Dinero que entra a la caja y no viene de las ventas. No cuenta como ganancia.</p>
      <div class="row2">
        <label>Moneda
          <select name="moneda"><option value="usd">Dólares (USD)</option><option value="bs">Bolívares (Bs)</option></select>
        </label>
        <label>Monto
          <input name="monto" type="number" step="0.01" min="0.01" inputmode="decimal" required>
        </label>
      </div>
      <p class="nombre-prev" id="capEquiv"></p>
      <label>Concepto
        <input name="concepto" maxlength="160" value="Capital de afuera" required>
      </label>
      <div class="acc" style="justify-content:flex-end">
        <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
        <button class="btn" type="submit">Registrar capital</button>
      </div>
    </form>`;
  pintarEquivCapital();
  abrirModal();
}

function pintarEquivCapital() {
  const f = $("#formCapital");
  const out = $("#capEquiv");
  if (!f || !out) return;
  const monto = Number(f.monto.value) || 0;
  if (f.moneda.value !== "bs") {
    out.textContent = monto ? `Se registrarán ${money(monto)} en dólares.` : "Escribe el monto en dólares.";
    return;
  }
  const t = tasaActual();
  if (!t) { out.textContent = "Primero registra la tasa BCV de hoy para convertir Bs a dólares."; return; }
  out.textContent = monto
    ? `≈ ${money(monto / Number(t.valor))} con la tasa de ${fmtTasa(t.valor)} Bs por USD`
    : `Tasa de hoy: ${fmtTasa(t.valor)} Bs por USD`;
}

async function registrarCapital(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  let usd = Number(f.monto.value) || 0;
  let concepto = f.concepto.value.trim() || "Capital de afuera";
  if (f.moneda.value === "bs") {
    const t = tasaActual();
    if (!t) return toast("Primero registra la tasa BCV de hoy");
    concepto += ` (${bsTxt(usd)} a tasa ${fmtTasa(t.valor)})`;
    usd = usd / Number(t.valor);
  }
  usd = Math.round(usd * 100) / 100;
  if (!(usd > 0)) return toast("El monto debe ser mayor que cero");
  btn.disabled = true;
  try {
    await DB.movimiento("capital", concepto.slice(0, 200), usd);
    cerrarModal();
    toast("Capital registrado ✔");
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo registrar");
    btn.disabled = false;
  }
}

/* ---------- ANALÍTICA ---------- */
function pintarAnalitica() {
  const { modo, ventana, off } = state.analitica;
  $$("#segModo button").forEach(b => b.classList.toggle("on", b.dataset.modo === modo));
  const bs = buckets(modo);
  const n = bs.length;
  const v = Math.max(1, Math.min(ventana, n || 1));
  const maxOff = Math.max(0, n - v);
  const o = Math.min(off, maxOff);
  state.analitica.off = o;
  const vis = bs.slice(Math.max(0, n - v - o), n - o);
  const unidad = { dia: "días", semana: "semanas", mes: "meses", anio: "años" }[modo];
  $("#zLabel").textContent = `${v} ${unidad}`;
  $("#graficoVacio").textContent = n ? "" : "Aún no hay ventas registradas para graficar.";
  dibujarGrafico(vis);
  pintarRankings();
}

function dibujarGrafico(vis) {
  const css = getComputedStyle(document.documentElement);
  const v = n => css.getPropertyValue(n).trim();
  if (state.chart) { state.chart.destroy(); state.chart = null; }
  if (!vis.length) return;
  state.chart = new Chart($("#grafico"), {
    type: "bar",
    data: {
      labels: vis.map(b => b.label),
      datasets: [
        { label: "Ventas", data: vis.map(b => b.total), backgroundColor: v("--wine"), borderRadius: 8, maxBarThickness: 40 },
        { label: "Ganancia bruta", data: vis.map(b => b.ganancia), backgroundColor: v("--muted"), borderRadius: 8, maxBarThickness: 40 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: v("--ink") } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: v("--muted") }, grid: { display: false } },
        y: { ticks: { color: v("--muted"), callback: val => "$" + val }, grid: { color: v("--line") } },
      },
    },
  });
}

function pintarRankings() {
  const r = ranking();
  if (!r.length) {
    $("#rankings").innerHTML = `<div class="card"><p class="muted">Cuando registres ventas, aquí verás el ranking.</p></div>`;
    return;
  }
  const max = r[0];
  const min = r[r.length - 1];
  const medio = r.slice(1, -1);
  $("#rankings").innerHTML = `
    <div class="card">
      <p class="eyebrow">Más vendido</p>
      <div class="rank-big">${esc(max.nombre)}<small>${max.unidades} unidad(es) · ${money(max.ingresos)}</small></div>
    </div>
    <div class="card">
      <p class="eyebrow">Menos vendido</p>
      <div class="rank-big">${esc(min.nombre)}<small>${min.unidades} unidad(es) · ${money(min.ingresos)}</small></div>
    </div>
    <div class="card">
      <p class="eyebrow">Rango medio</p>
      ${medio.length ? medio.map(x => `<div class="rank-item"><span>${esc(x.nombre)}</span><strong>${x.unidades} ud.</strong></div>`).join("")
        : `<p class="muted small">No hay productos intermedios todavía.</p>`}
    </div>`;
}

function cambiarZoom(delta) {
  state.analitica.ventana = Math.max(2, state.analitica.ventana + delta);
  pintarAnalitica();
}

/* ---------- MODAL ---------- */
function abrirModal() { $("#modal").hidden = false; document.body.classList.add("lock"); }
function cerrarModal() {
  $("#modal").hidden = true;
  $("#modal .sheet").innerHTML = "";
  document.body.classList.remove("lock");
  editProd = null;
  fotoBlob = null;
  state.compraLineas = [];
}

/* ---------- VISOR DE FOTO (ver la foto grande) ---------- */
function abrirVisor(id) {
  const p = state.productos.find(x => x.id === id);
  if (!p || !p.foto_url) return;
  $("#visorImg").src = p.foto_url;
  $("#visorImg").alt = p.nombre;
  $("#visorNombre").textContent = p.nombre;
  $("#visor").hidden = false;
  document.body.classList.add("lock");
}
function cerrarVisor() {
  $("#visor").hidden = true;
  $("#visorImg").removeAttribute("src");
  document.body.classList.remove("lock");
}

/* ---------- NAVEGACIÓN / TEMA ---------- */
function irA(tab) {
  state.tab = tab;
  $$("[data-view]").forEach(v => (v.hidden = v.dataset.view !== tab));
  $$("[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const titulos = { inicio: "Inicio", venta: "Venta rápida", inventario: "Catálogo", compras: "Gasto corporativo", caja: "Caja", notas: "Notas y recordatorios", analitica: "Analítica" };
  $("#tituloTab").textContent = titulos[tab];
  window.scrollTo(0, 0);
}

function aplicarTema(t) {
  document.documentElement.dataset.theme = t;
  $$(".ico-tema").forEach(e => (e.textContent = t === "dark" ? "☀️" : "🌙"));
  $$("[data-tema-txt]").forEach(e => (e.textContent = t === "dark" ? "Modo claro" : "Modo oscuro"));
  if (state.chart) pintarAnalitica();
}
function toggleTema() {
  const nuevo = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("tz_tema", nuevo);
  aplicarTema(nuevo);
}

/* ---------- SESIÓN ---------- */
function mostrarLogin() {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#loginDemo").hidden = !DEMO;
  $("#loginForm").hidden = DEMO;
  $("#loginAviso").textContent = DEMO
    ? "Modo demostración: los datos se guardan solo en este navegador."
    : "Ingresa con tu usuaria y contraseña.";
  if (DEMO) {
    $("#loginDemo").innerHTML = USUARIAS.map(u => `<button class="btn" data-demo="${esc(u.nombre)}">Entrar como ${esc(u.nombre)}</button>`).join("");
  } else {
    $("#selUsuaria").innerHTML = USUARIAS.map(u => `<option value="${esc(u.email)}">${esc(u.nombre)}</option>`).join("");
  }
}

async function entrar(u) {
  state.usuaria = u;
  if (DEMO) LS.set("sesion", u);
  $("#login").hidden = true;
  $("#app").hidden = false;
  if (!DEMO) suscribir();
  await cargar();
  irA(miPerfil().pantalla || "inicio");
}

async function login(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("button");
  const err = $("#loginError");
  err.hidden = true;
  btn.disabled = true;
  try {
    const email = f.elements.usuaria.value;
    const { error } = await sb.auth.signInWithPassword({ email, password: f.elements.password.value });
    if (error) throw error;
    f.elements.password.value = "";
    await entrar(USUARIAS.find(u => u.email === email));
  } catch {
    err.textContent = "Usuaria o contraseña incorrecta.";
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function salir() {
  if (DEMO) localStorage.removeItem("tz_sesion");
  else {
    if (state.canal) sb.removeChannel(state.canal);
    state.canal = null;
    await sb.auth.signOut();
  }
  state.usuaria = null;
  state.carrito = [];
  state.selVenta = null;
  state.lastActId = null;
  mostrarLogin();
}

function suscribir() {
  if (state.canal) sb.removeChannel(state.canal);
  state.canal = sb.channel("tulizoo-en-vivo")
    .on("postgres_changes", { event: "*", schema: "public" }, () => cargar())
    .subscribe();
}

/* ---------- CARGA DE DATOS ---------- */
async function cargar() {
  if (!state.usuaria) return;
  const [productos, ventas, movs, act, lotes, empaques, recordatorios, notas, tasas, perfiles] = await Promise.all([
    DB.productos(), DB.ventas(), DB.movs(), DB.act(), DB.lotes(), DB.empaques(),
    DB.recordatorios(), DB.notas(), DB.tasas(), DB.perfiles(),
  ]);
  const top = act[0];
  // Aviso en vivo cuando otra usuaria registra algo
  if (state.lastActId && top && top.id !== state.lastActId && top.usuaria !== state.usuaria.nombre) {
    toast(`${top.usuaria} ${top.texto}`);
  }
  state.lastActId = top ? top.id : null;
  Object.assign(state, { productos, ventas, movs, act, lotes, empaques, recordatorios, notas, tasas, perfiles });
  render();
}

async function resetDemo() {
  if (!confirm("¿Reiniciar la demostración en cero? Se borrarán todos los datos de prueba (el catálogo se conserva).")) return;
  ["productos", "ventas", "movimientos", "actividad", "lotes", "empaques", "recordatorios", "notas", "tasas", "perfiles"].forEach(k => localStorage.removeItem("tz_" + k));
  seedDemo();
  state.lastActId = null;
  await cargar();
  toast("Demostración reiniciada en cero");
}

/* ---------- EVENTOS (delegación) ---------- */
document.addEventListener("click", async (e) => {
  const t = e.target;
  const is = sel => t.closest(sel);
  let el;

  if (t.id === "modal") return cerrarModal();
  if (t.id === "visor" || is("[data-visor-cerrar]")) return cerrarVisor();
  if (is("[data-cerrar]")) return cerrarModal();
  if ((el = is("[data-tab]"))) return irA(el.dataset.tab);
  if (is("[data-action='tema']")) return toggleTema();
  if (is("[data-action='salir']")) return salir();
  if (is("[data-action='perfil']")) return abrirPerfil();
  if ((el = is("[data-demo]"))) return entrar(USUARIAS.find(u => u.nombre === el.dataset.demo));
  if (is("[data-action='capital']")) return abrirFormCapital();
  if ((el = is("[data-perfil-emoji]"))) return elegirPerfil("emoji", el.dataset.perfilEmoji);
  if ((el = is("[data-perfil-color]"))) return elegirPerfil("color", el.dataset.perfilColor);
  if (is("[data-quitar-foto]")) return quitarFotoPerfil();
  if (accionNotas(t)) return;

  // Venta
  if ((el = is("[data-pick]"))) {
    state.selVenta = el.dataset.pick;
    state.selDetalle = { talla: null, color: null, cantidad: 1 };
    return pintarVenta();
  }
  if ((el = is("[data-talla]"))) { state.selDetalle.talla = el.dataset.talla; state.selDetalle.cantidad = 1; return pintarSeleccion(); }
  if ((el = is("[data-color]"))) { state.selDetalle.color = el.dataset.color; state.selDetalle.cantidad = 1; return pintarSeleccion(); }
  if ((el = is("[data-delta]"))) { state.selDetalle.cantidad += Number(el.dataset.delta); return pintarSeleccion(); }
  if (is("#btnAgregar")) return agregarAlCarrito();
  if ((el = is("[data-quitar]"))) { state.carrito.splice(Number(el.dataset.quitar), 1); return pintarVenta(); }
  if ((el = is("[data-bolsa]"))) { state.empaque.bolsa = el.dataset.bolsa || null; state.empaque.manual = true; return pintarEmpaqueVenta(); }
  if ((el = is("[data-etq]"))) {
    const max = empaque("etiqueta").cantidad;
    state.empaque.etiquetas = Math.min(max, Math.max(0, state.empaque.etiquetas + Number(el.dataset.etq)));
    return pintarEmpaqueVenta();
  }
  if (is("#btnCobrar")) return cobrar();
  if (is("#btnVaciar")) { state.carrito = []; return pintarVenta(); }

  // Catálogo
  if ((el = is("[data-chip]"))) { state.filtroInv.chip = el.dataset.chip; return pintarInventario(); }
  if ((el = is("[data-foto-ver]"))) return abrirVisor(el.dataset.fotoVer);
  if ((el = is("[data-editar]"))) return abrirFormProducto(state.productos.find(p => p.id === el.dataset.editar));
  if ((el = is("[data-destacar]"))) {
    const p = state.productos.find(x => x.id === el.dataset.destacar);
    if (!p) return;
    try { await DB.actualizarCampos(p.id, { destacado: !p.destacado }); await cargar(); }
    catch (err) { toast(err.message); }
    return;
  }
  if ((el = is("[data-borrar]"))) {
    const p = state.productos.find(x => x.id === el.dataset.borrar);
    if (!p || !confirm(`¿Eliminar "${p.nombre}" del catálogo?`)) return;
    try { await DB.borrarProducto(p.id); toast("Prenda eliminada"); await cargar(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (is("#btnNueva")) return abrirFormProducto();
  if (is("#btnReset")) return resetDemo();

  // Compras
  if (is("#btnNuevaTanda")) return abrirFormCompra();
  if (is("#btnInvInicial")) return abrirFormInventario();
  if ((el = is("[data-excel]"))) return descargarTanda(el.dataset.excel);
  if (is("#btnAddLinea")) { state.compraLineas.push({ producto_id: "", talla: "", color: "", cantidad: 1, costo_unit: 0 }); return pintarLineasCompra(); }
  if ((el = is("[data-f='quitar']"))) { state.compraLineas.splice(Number(el.dataset.i), 1); return pintarLineasCompra(); }

  // Caja
  if ((el = is("[data-rango]"))) { state.rangoCaja = el.dataset.rango; return pintarCaja(); }

  // Analítica
  if ((el = is("[data-modo]"))) {
    const modo = el.dataset.modo;
    state.analitica = { modo, ventana: DEFECTO_VENTANA[modo], off: 0 };
    return pintarAnalitica();
  }
  if (is("#zIn")) return cambiarZoom(-1);
  if (is("#zOut")) return cambiarZoom(1);
  if (is("#pAtras")) { state.analitica.off += 1; return pintarAnalitica(); }
  if (is("#pAdel")) { state.analitica.off = Math.max(0, state.analitica.off - 1); return pintarAnalitica(); }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  const id = t.id;
  if (id === "buscarVenta") return pintarVenta();
  if (id === "buscarInv") { state.filtroInv.q = t.value.trim().toLowerCase(); return pintarInventario(); }
  if (t.form && t.form.id === "formCapital") return pintarEquivCapital();
  if (t.form && t.form.id === "formProd" && t.name === "colores") return pintarGrilla(leerGrilla());
  if (t.form && t.form.id === "formCompra") {
    const i = Number(t.dataset.i), f = t.dataset.f;
    if (!isNaN(i) && state.compraLineas[i]) {
      if (f === "cantidad") state.compraLineas[i].cantidad = t.value;
      if (f === "costo") state.compraLineas[i].costo_unit = t.value;
    }
    return recalcCompra();
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  // Formulario de prenda: talla única excluye S, M y L
  if (t.form && t.form.id === "formProd" && t.name === "t") {
    if (t.checked && t.value === "Única") $$("#formProd input[name=t]").forEach(x => { if (x.value !== "Única") x.checked = false; });
    if (t.checked && t.value !== "Única") { const u = $("#formProd input[name=t][value='Única']"); if (u) u.checked = false; }
    return pintarGrilla(leerGrilla());
  }
  // Formulario de tanda
  if (t.form && t.form.id === "formCompra" && t.dataset.f) {
    const i = Number(t.dataset.i);
    const l = state.compraLineas[i];
    if (!l) return;
    if (t.dataset.f === "producto") {
      const p = state.productos.find(x => x.id === t.value);
      l.producto_id = t.value;
      l.talla = p ? p.variantes[0].talla : "";
      l.color = p ? p.variantes[0].color : "";
      l.costo_unit = p ? p.costo : 0;
      return pintarLineasCompra();
    }
    if (t.dataset.f === "talla") l.talla = t.value;
    if (t.dataset.f === "color") l.color = t.value;
    return recalcCompra();
  }
  if (t.id === "fotoPerfilIn") return subirFotoPerfil(t.files[0]);
  // Foto de prenda
  if (t.id === "fotoIn") {
    const f = t.files[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast("Selecciona una imagen");
    if (f.size > 15 * 1024 * 1024) return toast("La foto es muy pesada (máx. 15 MB)");
    try {
      fotoBlob = await comprimir(f);
      $("#fotoPrev").innerHTML = `<img src="${URL.createObjectURL(fotoBlob)}" alt="Vista previa">`;
    } catch (err) { toast(err.message); }
  }
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.target.id === "loginForm") return login(e);
  if (e.target.id === "formMov") return registrarMov(e);
  if (e.target.id === "formProd") return guardarProducto(e);
  if (e.target.id === "formCompra") return guardarCompra(e);
  if (e.target.id === "formCapital") return registrarCapital(e);
  if (e.target.id === "formInv") return guardarInventario(e);
  if (e.target.id === "formPerfil") return guardarPerfilForm(e);
  if (e.target.id === "formTasa") return guardarTasaForm(e);
  if (e.target.id === "formRec") return guardarRecordatorio(e);
  if (e.target.id === "formNota") return guardarNota(e);
});

// Demo: si otra pestaña cambia los datos, esta se actualiza sola
window.addEventListener("storage", (e) => {
  if (DEMO && e.key && e.key.startsWith("tz_") && state.usuaria) cargar();
});

// Gráfica: rueda del mouse para acercar/alejar (PC)
document.addEventListener("wheel", (e) => {
  if (!e.target.closest || !e.target.closest(".chart-wrap")) return;
  e.preventDefault();
  cambiarZoom(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

// Esc cierra la foto grande
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#visor").hidden) cerrarVisor();
});

/* ---------- ARRANQUE ---------- */
async function init() {
  aplicarTema(localStorage.getItem("tz_tema") || "light");

  if (DEMO) {
    // Si la demo es de una versión anterior, se carga el inventario nuevo
    if (LS.get("version", 0) !== DEMO_VERSION) seedDemo();
    const s = LS.get("sesion", null);
    if (s) return entrar(s);
    return mostrarLogin();
  }

  const { data } = await sb.auth.getSession();
  if (data.session) {
    const u = USUARIAS.find(x => x.email.toLowerCase() === (data.session.user.email || "").toLowerCase());
    if (u) return entrar(u);
    await sb.auth.signOut();
  }
  mostrarLogin();
}

init();
