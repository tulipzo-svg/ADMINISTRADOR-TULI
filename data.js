/* =========================================================
   VALLERY · Datos, configuración y archivos Excel de tandas
   - Si SUPABASE_URL y SUPABASE_ANON_KEY están vacíos → MODO DEMO
     (todo se guarda solo en este navegador, sin contraseña).
   - Con Supabase: login real, datos compartidos entre celulares.
   ========================================================= */

/* ---------- 1) CONFIGURACIÓN ---------- */
const SUPABASE_URL = "https://wfvyncjfxcrwljticufo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmdnluY2pmeGNyd2xqdGljdWZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNTQ1NzEsImV4cCI6MjEwOTczMDU3MX0.FZsF6geVNDe5JcfbT80r6d06BNUz7NoERlRoDDz1nUI";
const DEMO = false;

// Las contraseñas NO van en el código: se crean en Supabase → Authentication → Users.
const USUARIAS = [
  { nombre: "Rosainer", email: "RosainerNAZ026@tuli.com" },
  { nombre: "Vallery",  email: "ValleryNAZ029@tuli.com" },
];

// Catálogo inicial (fotos, nombres, categorías y precios). El stock empieza en cero:
// se carga con el botón "Inventario inicial" de Gasto corporativo.
// [foto, nombre, categoría, precio, costo, destacado, variantes [talla, color, stock]]
// Talla "Única" = talla única (no se combina con S/M/L).
// PRECIOS SIN DATO EN EL EXCEL: costo + 3 (blusas, bodys) o costo + 8 (vestidos). Confirmar.
const SEED = [
  ["vestido-dani.jpg",   "Vestido Dani",   "Vestidos", 20, 12,   true,  [["S","Vinotinto",1],["M","Vinotinto",1],["L","Vinotinto",1]]],
  ["vestido-aurora.jpg", "Vestido Aurora", "Vestidos", 24, 16,   true,  [["S","Rosa pastel",1],["M","Rosa pastel",1],["L","Rosa pastel",1]]],
  ["blusa-elenor.jpg",   "Blusa Elenor",   "Blusas",   13, 10,   false, [["S","Blanco",1],["M","Blanco",1]]],
  ["blusa-alicia.jpg",   "Blusa Alicia",   "Blusas",   18, 15,   true,  [["S","Negro",1],["M","Negro",1],["L","Negro",1]]],
  ["blusa-amalia.jpg",   "Blusa Amalia",   "Blusas",   16, 13,   false, [["S","Blanco",1],["M","Blanco",1],["L","Blanco",1]]],
  ["body-ross.jpg",      "Body Ross",      "Bodys",    10.5, 7.5, false, [["Única","Rojo con contorno rosa",2],["Única","Rojo con contorno blanco",1]]],
  ["body-julia.jpg",     "Body Julia",     "Bodys",    10.5, 7.5, true,  [["Única","Marrón",2],["Única","Azul oscuro",1]]],
  ["body-val.jpg",       "Body Val",       "Bodys",    10.5, 7.5, false, [["Única","Vinotinto",1],["Única","Negro",2]]],
  ["body-elena.jpg",     "Body Elena",     "Bodys",    10.5, 7.5, false, [["Única","Negro",1],["Única","Blanco",1],["Única","Azul oscuro",1]]],
  ["vestido-lucia.jpg",  "Vestido Lucía",  "Vestidos", 12, 7,    false, [["S","Negro",1],["M","Negro",1]]],
  ["vestido-dakota.jpg", "Vestido Dakota", "Vestidos", 15, 12,   false, [["S","Vinotinto",1],["M","Vinotinto",1]]],
  ["top-ruby.jpg",       "Top Ruby",       "Tops",     10, 6,    true,  [["S","Blanco con negro",1],["M","Blanco con negro",1]]],
  ["top-mary.jpg",       "Top Mary",       "Tops",     10, 6.9,  false, [["S","Negro",2],["M","Vinotinto",1]]],
];

// Empaques del Excel (hoja "Gastos operativos"). Ajustar cantidades reales.
// La hoja dice 24 bolsas de tela (repartidas 12 y 12) y "1 m" de tarjetas (se asumió 1 millar).
const EMPAQUES_SEED = [
  { id: "bolsa_mediana", nombre: "Bolsa mediana", tipo: "bolsa",    cantidad: 12,   costo_unit: 1.4 },
  { id: "bolsa_grande",  nombre: "Bolsa grande",  tipo: "bolsa",    cantidad: 12,   costo_unit: 1.4 },
  { id: "etiqueta",      nombre: "Etiqueta / tarjeta de agradecimiento", tipo: "etiqueta", cantidad: 1000, costo_unit: 0.012 },
];

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Subir este número reinicia la demostración en cero (se conserva el catálogo)
const DEMO_VERSION = 5;

/* ---------- 2) UTILIDADES ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => "$" + (Number(n) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const suma = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const splitLista = s => [...new Set(String(s || "").split(",").map(x => x.trim()).filter(Boolean))];
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function textoMovimiento(tipo, monto) {
  if (tipo === "capital") return `inyectó capital de afuera por ${money(monto)}`;
  if (tipo === "retiro") return `hizo un retiro de ${money(monto)}`;
  if (tipo === "mercancia") return `registró una compra de mercancía por ${money(monto)}`;
  return `registró un gasto por ${money(monto)}`;
}

// Reduce la foto del celular (puede pesar 5-10 MB) a ~900 px en JPG liviano
function comprimir(file, max = 900) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => (b ? resolve(b) : reject(new Error("No se pudo procesar la foto"))), "image/jpeg", 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Archivo de imagen no válido")); };
    img.src = url;
  });
}

/* ---------- 3) EXCEL DE CADA TANDA ----------
   Se genera con SheetJS (librería cargada en index.html).
   Los totales son fórmulas: si editas una cantidad en Excel, el total se recalcula. */
function generarXlsx(l) {
  const rows = [];
  const add = (...c) => { rows.push(c); return rows.length; };   // devuelve el número de fila (1 = primera)
  const fila = () => rows.length + 1;                              // número de la próxima fila

  add("VALLERY · REGISTRO DE TANDA");
  add("Tanda", l.nombre);
  add("Fecha", new Date(l.creado_en).toLocaleString("es-VE"));
  add("Registrada por", l.usuaria);
  add();
  add("PRENDAS");
  add("Prenda", "Talla", "Color", "Cantidad", "Costo c/u (USD)", "Total (USD)");
  const ini = fila();
  for (const i of l.items) {
    const r = fila();
    add(i.nombre, i.talla === "Única" ? "Talla única" : i.talla, i.color, i.cantidad, i.costo_unit,
      { t: "n", f: `D${r}*E${r}`, v: i.cantidad * i.costo_unit });
  }
  const fin = rows.length;
  const rSub = add("", "", "", "", "Subtotal prendas",
    { t: "n", f: `SUM(F${ini}:F${fin})`, v: suma(l.items, i => i.cantidad * i.costo_unit) });
  add();
  add("EMPAQUES Y ENVÍO");
  add("Concepto", "", "", "Cantidad", "Costo c/u (USD)", "Total (USD)");
  const ini2 = fila();
  for (const e of l.empaques) {
    const r = fila();
    add(e.nombre, "", "", e.cantidad, e.costo_unit, { t: "n", f: `D${r}*E${r}`, v: e.cantidad * e.costo_unit });
  }
  if (l.costo_envio > 0) {
    const r = fila();
    add("Envío", "", "", 1, l.costo_envio, { t: "n", f: `D${r}*E${r}`, v: l.costo_envio });
  }
  const fin2 = rows.length;
  let rEmp = null;
  if (fin2 >= ini2) {
    const valEmp = suma(l.empaques, e => e.cantidad * e.costo_unit) + (l.costo_envio || 0);
    rEmp = add("", "", "", "", "Subtotal empaques y envío", { t: "n", f: `SUM(F${ini2}:F${fin2})`, v: valEmp });
  }
  add();
  const formulaTotal = rEmp ? `F${rSub}+F${rEmp}` : `F${rSub}`;
  add("", "", "", "", "TOTAL DE LA TANDA", { t: "n", f: formulaTotal, v: l.total });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 36 }, { wch: 14 }, { wch: 26 }, { wch: 12 }, { wch: 22 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tanda");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

function bytesToDataUrl(bytes) {
  const u = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return `data:${MIME_XLSX};base64,${btoa(bin)}`;
}

/* ---------- 4) MODO DEMO (localStorage) ---------- */
const LS = {
  get(k, def) {
    try { const v = localStorage.getItem("tz_" + k); return v === null ? def : JSON.parse(v); }
    catch { return def; }
  },
  set(k, v) { localStorage.setItem("tz_" + k, JSON.stringify(v)); },
};

function seedDemo() {
  const ahora = new Date().toISOString();
  const productos = SEED.map(([foto, nombre, categoria, precio, costo, destacado, variantes]) => ({
    id: uid(), nombre, categoria, precio, costo, destacado,
    foto_url: "fotos/" + foto,
    variantes: variantes.map(([talla, color]) => ({ talla, color, stock: 0 })),
    creado_en: ahora, actualizado_en: ahora,
  }));
  LS.set("productos", productos);
  LS.set("empaques", EMPAQUES_SEED.map(e => ({ id: e.id, nombre: e.nombre, cantidad: 0, costo_unit: e.costo_unit })));
  LS.set("lotes", []);
  LS.set("movimientos", []);
  LS.set("ventas", []);
  LS.set("actividad", []);
  LS.set("recordatorios", []);
  LS.set("notas", []);
  LS.set("tasas", []);
  LS.set("perfiles", []);
  LS.set("version", DEMO_VERSION);
}

// Operaciones genéricas para las listas de demo (recordatorios, notas)
function colAdd(k, row) { const arr = LS.get(k, []); arr.unshift(row); LS.set(k, arr); }
function colUpd(k, id, campos) { const arr = LS.get(k, []); const x = arr.find(y => y.id === id); if (x) Object.assign(x, campos); LS.set(k, arr); }
function colDel(k, id) { LS.set(k, LS.get(k, []).filter(y => y.id !== id)); }

function demoLog(texto) {
  const a = LS.get("actividad", []);
  a.unshift({ id: uid(), usuaria: currentUserName(), texto, creado_en: new Date().toISOString() });
  LS.set("actividad", a.slice(0, 200));
}

const currentUserName = () => (typeof state !== "undefined" && state.usuaria ? state.usuaria.nombre : "—");

const demoDB = {
  async productos() { return LS.get("productos", []); },
  async ventas() { return LS.get("ventas", []); },
  async movs() { return LS.get("movimientos", []); },
  async act() { return LS.get("actividad", []); },
  async lotes() { return LS.get("lotes", []); },
  async empaques() { return LS.get("empaques", []); },
  async perfiles() { return LS.get("perfiles", []); },
  // Solo cambia los campos enviados; crea el perfil si no existe
  async guardarPerfil(usuaria, campos) {
    const arr = LS.get("perfiles", []);
    const x = arr.find(p => p.usuaria === usuaria);
    if (x) Object.assign(x, campos); else arr.push({ usuaria, ...campos });
    LS.set("perfiles", arr);
  },
  // Demo: la foto se guarda dentro de los datos del navegador (en data URL)
  subirFotoPerfil(usuaria, blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error("No se pudo leer la foto"));
      r.readAsDataURL(blob);
    });
  },
  async recordatorios() { return LS.get("recordatorios", []); },
  async notas() { return LS.get("notas", []); },
  async tasas() { return LS.get("tasas", []); },

  async guardarRecordatorio(r) {
    colAdd("recordatorios", { id: uid(), usuaria: currentUserName(), tipo: r.tipo, texto: r.texto, monto: r.monto, hecho: false, creado_en: new Date().toISOString() });
  },
  async cambiarRecordatorio(id, campos) { colUpd("recordatorios", id, campos); },
  async borrarRecordatorio(id) { colDel("recordatorios", id); },
  async guardarNota(texto) {
    colAdd("notas", { id: uid(), usuaria: currentUserName(), texto, hecha: false, creado_en: new Date().toISOString() });
  },
  async cambiarNota(id, campos) { colUpd("notas", id, campos); },
  async borrarNota(id) { colDel("notas", id); },
  // Una tasa por fecha: si ya existe para ese día, se reemplaza
  async guardarTasa(fecha, valor) {
    const arr = LS.get("tasas", []).filter(t => t.fecha !== fecha);
    arr.push({ fecha, valor, usuaria: currentUserName(), creado_en: new Date().toISOString() });
    LS.set("tasas", arr);
  },

  async guardarProducto(p) {
    const arr = LS.get("productos", []);
    const i = p.id ? arr.findIndex(x => x.id === p.id) : -1;
    const ahora = new Date().toISOString();
    if (i >= 0) arr[i] = { ...arr[i], ...p, actualizado_en: ahora };
    else arr.push({ ...p, id: uid(), creado_en: ahora, actualizado_en: ahora });
    LS.set("productos", arr);
  },
  async actualizarCampos(id, campos) {
    const arr = LS.get("productos", []);
    const p = arr.find(x => x.id === id);
    if (p) Object.assign(p, campos);
    LS.set("productos", arr);
  },
  async borrarProducto(id) {
    LS.set("productos", LS.get("productos", []).filter(x => x.id !== id));
  },
  // Inventario físico: reemplaza las existencias por el conteo real (no toca la caja)
  async ajustarInventario(productos, empaques) {
    const prods = LS.get("productos", []);
    const emp = LS.get("empaques", []);
    for (const p of productos) {
      const x = prods.find(y => y.id === p.id);
      if (!x) throw new Error("Una prenda ya no existe");
      if (p.stocks.length !== x.variantes.length) throw new Error("Las variantes de " + x.nombre + " no coinciden");
      if (p.stocks.some(s => !Number.isInteger(s) || s < 0)) throw new Error("Existencias inválidas para " + x.nombre);
    }
    for (const e of empaques) {
      if (!Number.isInteger(e.cantidad) || e.cantidad < 0) throw new Error("Cantidad de empaque inválida");
      if (!emp.find(y => y.id === e.id)) throw new Error("Empaque no válido");
    }
    for (const p of productos) {
      const x = prods.find(y => y.id === p.id);
      p.stocks.forEach((s, i) => { x.variantes[i].stock = s; });
    }
    for (const e of empaques) emp.find(y => y.id === e.id).cantidad = e.cantidad;
    LS.set("productos", prods);
    LS.set("empaques", emp);
    demoLog("ajustó el inventario físico");
  },
  subirFoto(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error("No se pudo leer la foto"));
      r.readAsDataURL(blob);
    });
  },

  async venta(items, bolsa, etiquetas) {
    const prods = LS.get("productos", []);
    const emp = LS.get("empaques", []);
    const etq = Number(etiquetas) || 0;
    const lineas = [];
    let total = 0, costo = 0;
    for (const it of items) {
      const p = prods.find(x => x.id === it.producto_id);
      if (!p) throw new Error("Una prenda ya no existe");
      const v = p.variantes.find(x => x.talla === it.talla && x.color === it.color);
      if (!v) throw new Error(`La variante elegida no existe para ${p.nombre}`);
      if (v.stock < it.cantidad) throw new Error(`Sin existencias de ${p.nombre} (${it.talla} ${it.color}). Quedan ${v.stock}`);
      v.stock -= it.cantidad;
      total += p.precio * it.cantidad;
      costo += p.costo * it.cantidad;
      lineas.push({ producto_id: p.id, nombre: p.nombre, talla: it.talla, color: it.color, cantidad: it.cantidad, precio: p.precio, costo: p.costo });
    }
    // Empaques: validar primero, descontar después
    if (bolsa) {
      const b = emp.find(x => x.id === bolsa);
      if (!b || b.cantidad < 1) throw new Error("No hay bolsas de ese tamaño disponibles");
      b.cantidad -= 1;
    }
    if (etq > 0) {
      const e = emp.find(x => x.id === "etiqueta");
      if (!e || e.cantidad < etq) throw new Error("No hay suficientes etiquetas");
      e.cantidad -= etq;
    }
    LS.set("productos", prods);
    LS.set("empaques", emp);
    const ventas = LS.get("ventas", []);
    ventas.push({ id: uid(), usuaria: currentUserName(), items: lineas, total, costo_total: costo, bolsa: bolsa || null, etiquetas: etq, creado_en: new Date().toISOString() });
    LS.set("ventas", ventas);
    demoLog(`registró una venta por ${money(total)}`);
  },

  async movimiento(tipo, concepto, monto) {
    if (!(["gasto", "mercancia", "retiro", "capital"].includes(tipo))) throw new Error("Tipo de movimiento inválido");
    if (!(monto > 0)) throw new Error("El monto debe ser mayor que cero");
    const arr = LS.get("movimientos", []);
    arr.unshift({ id: uid(), usuaria: currentUserName(), tipo, concepto, monto: Math.round(monto * 100) / 100, creado_en: new Date().toISOString() });
    LS.set("movimientos", arr);
    demoLog(textoMovimiento(tipo, monto));
  },

  // Devuelve { id, numero, nombre } igual que la función de Supabase
  async registrarLote(descripcion, envio, items, empaquesIn) {
    const desc = String(descripcion || "").trim().slice(0, 60);
    const env = Number(envio) || 0;
    if (env < 0) throw new Error("El envío no puede ser negativo");
    if (!items.length) throw new Error("La tanda no tiene prendas");
    const prods = LS.get("productos", []);
    const emp = LS.get("empaques", []);
    const lotes = LS.get("lotes", []);
    const numero = Math.max(0, ...lotes.map(l => Number(l.numero) || 0)) + 1;
    const nombre = `Tanda ${numero}` + (desc ? ` · ${desc}` : "");

    const lineas = [];
    let tPren = 0;
    for (const it of items) {
      if (!(it.cantidad > 0)) throw new Error("Cantidad inválida");
      if (!(it.costo_unit >= 0)) throw new Error("Costo inválido");
      const p = prods.find(x => x.id === it.producto_id);
      if (!p) throw new Error("Una prenda ya no existe");
      const v = p.variantes.find(x => x.talla === it.talla && x.color === it.color);
      if (v) v.stock += it.cantidad;
      else p.variantes.push({ talla: it.talla, color: it.color, stock: it.cantidad });
      p.costo = it.costo_unit;
      tPren += it.cantidad * it.costo_unit;
      lineas.push({ producto_id: p.id, nombre: p.nombre, talla: it.talla, color: it.color, cantidad: it.cantidad, costo_unit: it.costo_unit });
    }
    let tEmp = 0;
    const empl = [];
    for (const e of empaquesIn) {
      if (!(e.cantidad > 0)) continue;
      const x = emp.find(y => y.id === e.id);
      if (!x) throw new Error("Empaque no válido");
      x.cantidad += e.cantidad;
      x.costo_unit = e.costo_unit;
      tEmp += e.cantidad * e.costo_unit;
      empl.push({ id: x.id, nombre: x.nombre, cantidad: e.cantidad, costo_unit: e.costo_unit });
    }
    LS.set("productos", prods);
    LS.set("empaques", emp);

    const lote = {
      id: uid(), numero, descripcion: desc, nombre,
      usuaria: currentUserName(), costo_envio: env, items: lineas, empaques: empl,
      total: tPren + env + tEmp, creado_en: new Date().toISOString(),
    };
    lotes.unshift(lote);
    LS.set("lotes", lotes);

    const movs = LS.get("movimientos", []);
    const add = (tipo, concepto, monto) => movs.unshift({ id: uid(), usuaria: currentUserName(), tipo, concepto, monto: Math.round(monto * 100) / 100, creado_en: new Date().toISOString() });
    if (tPren > 0) add("mercancia", "Prendas · " + nombre, tPren);
    if (env > 0) add("gasto", "Envío · " + nombre, env);
    if (tEmp > 0) add("gasto", "Empaques · " + nombre, tEmp);
    LS.set("movimientos", movs);
    demoLog(`registró ${nombre} por ${money(lote.total)}`);
    return { id: lote.id, numero, nombre };
  },

  // Archivo Excel de la tanda (guardado dentro de los datos del navegador)
  async archivarLote(id, blob) {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error("No se pudo guardar el Excel"));
      r.readAsDataURL(blob);
    });
    const lotes = LS.get("lotes", []);
    const l = lotes.find(x => x.id === id);
    if (l) { l.archivo = dataUrl; LS.set("lotes", lotes); }
  },
  async archivoLote(l) {
    if (!l.archivo) return null;
    return (await fetch(l.archivo)).blob();
  },
};

/* ---------- 5) SUPABASE (producción) ---------- */
const sb = DEMO ? null : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const realDB = {
  async productos() {
    const { data, error } = await sb.from("productos").select("*").order("nombre");
    if (error) throw error; return data;
  },
  async ventas() {
    const { data, error } = await sb.from("ventas").select("*").order("creado_en", { ascending: false }).limit(1000);
    if (error) throw error; return data;
  },
  async movs() {
    const { data, error } = await sb.from("movimientos").select("*").order("creado_en", { ascending: false }).limit(1000);
    if (error) throw error; return data;
  },
  async act() {
    const { data, error } = await sb.from("actividad").select("*").order("creado_en", { ascending: false }).limit(200);
    if (error) throw error; return data;
  },
  async lotes() {
    const { data, error } = await sb.from("lotes").select("*").order("numero", { ascending: false }).limit(300);
    if (error) throw error; return data;
  },
  async empaques() {
    const { data, error } = await sb.from("empaques").select("*").order("id");
    if (error) throw error; return data;
  },
  async perfiles() {
    const { data, error } = await sb.from("perfiles").select("*");
    if (error) throw error; return data;
  },
  async guardarPerfil(usuaria, campos) {
    const { error } = await sb.from("perfiles").upsert({ usuaria, ...campos, actualizado_en: new Date().toISOString() }, { onConflict: "usuaria" });
    if (error) throw error;
  },
  // Foto en Storage → fotos/perfiles/<usuaria>.jpg (se reemplaza al subir otra)
  async subirFotoPerfil(usuaria, blob) {
    const path = `perfiles/${usuaria.toLowerCase()}.jpg`;
    const { error } = await sb.storage.from("fotos").upload(path, blob, { contentType: "image/jpeg", upsert: true, cacheControl: "60" });
    if (error) throw error;
    return sb.storage.from("fotos").getPublicUrl(path).data.publicUrl + "?v=" + Date.now();
  },
  async recordatorios() {
    const { data, error } = await sb.from("recordatorios").select("*").order("creado_en", { ascending: false }).limit(300);
    if (error) throw error; return data;
  },
  async notas() {
    const { data, error } = await sb.from("notas").select("*").order("creado_en", { ascending: false }).limit(300);
    if (error) throw error; return data;
  },
  async tasas() {
    const { data, error } = await sb.from("tasas").select("*").order("fecha", { ascending: false }).limit(400);
    if (error) throw error; return data;
  },
  async guardarRecordatorio(r) {
    const { error } = await sb.from("recordatorios").insert(r);
    if (error) throw error;
  },
  async cambiarRecordatorio(id, campos) {
    const { error } = await sb.from("recordatorios").update(campos).eq("id", id);
    if (error) throw error;
  },
  async borrarRecordatorio(id) {
    const { error } = await sb.from("recordatorios").delete().eq("id", id);
    if (error) throw error;
  },
  async guardarNota(texto) {
    const { error } = await sb.from("notas").insert({ texto });
    if (error) throw error;
  },
  async cambiarNota(id, campos) {
    const { error } = await sb.from("notas").update(campos).eq("id", id);
    if (error) throw error;
  },
  async borrarNota(id) {
    const { error } = await sb.from("notas").delete().eq("id", id);
    if (error) throw error;
  },
  async guardarTasa(fecha, valor) {
    const { error } = await sb.from("tasas").upsert({ fecha, valor }, { onConflict: "fecha" });
    if (error) throw error;
  },

  async guardarProducto(p) {
    const row = { ...p, actualizado_en: new Date().toISOString() };
    if (!row.id) delete row.id;
    const { error } = await sb.from("productos").upsert(row);
    if (error) throw error;
  },
  async actualizarCampos(id, campos) {
    const { error } = await sb.from("productos").update({ ...campos, actualizado_en: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  },
  async borrarProducto(id) {
    const { error } = await sb.from("productos").delete().eq("id", id);
    if (error) throw error;
  },
  async ajustarInventario(productos, empaques) {
    const { error } = await sb.rpc("ajustar_inventario", { p_productos: productos, p_empaques: empaques });
    if (error) throw error;
  },
  async subirFoto(blob) {
    const path = `${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from("fotos").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
    if (error) throw error;
    return sb.storage.from("fotos").getPublicUrl(path).data.publicUrl;
  },
  async venta(items, bolsa, etiquetas) {
    const { error } = await sb.rpc("registrar_venta", { p_items: items, p_bolsa: bolsa || null, p_etiquetas: Number(etiquetas) || 0 });
    if (error) throw error;
  },
  async movimiento(tipo, concepto, monto) {
    const { error } = await sb.rpc("registrar_movimiento", { p_tipo: tipo, p_concepto: concepto, p_monto: monto });
    if (error) throw error;
  },
  // Devuelve { id, numero, nombre }
  async registrarLote(descripcion, envio, items, empaques) {
    const { data, error } = await sb.rpc("registrar_lote", { p_descripcion: descripcion || "", p_envio: Number(envio) || 0, p_items: items, p_empaques: empaques });
    if (error) throw error;
    return data;
  },
  async archivarLote(id, blob) {
    const { error } = await sb.storage.from("tandas").upload(`${id}.xlsx`, blob, { contentType: MIME_XLSX, upsert: false });
    if (error) throw error;
  },
  async archivoLote(l) {
    const { data, error } = await sb.storage.from("tandas").download(`${l.id}.xlsx`);
    return error ? null : data;
  },
};

// Un solo nombre para la app: en demo usa localStorage, en producción Supabase
const DB = DEMO ? demoDB : realDB;