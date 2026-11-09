/* =========================================================
   VALLERY · Notas y recordatorios
   Recordatorios de cobros y pagos + notas rápidas.
   Carga después de tandas.js y antes de app.js.
   Usa state, $, suma, money, esc, fechaCorta, cargar, toast (app.js).
   ========================================================= */

const TIPOS_REC = { cobro: "Me deben", pago: "Debo pagar", otro: "Otro" };

function pintarNotas() {
  pintarRecordatorios();
  pintarListaNotas();
}

function pintarRecordatorios() {
  const pend = state.recordatorios.filter(r => !r.hecho);
  $("#recResumen").innerHTML = [["cobro", "Por cobrar"], ["pago", "Por pagar"]].map(([tipo, titulo]) => {
    const lista = pend.filter(r => r.tipo === tipo);
    return `<div class="card kpi">
      <small>${titulo}</small>
      <strong>${money(suma(lista, r => r.monto))}</strong>
      <span>${lista.length} pendiente(s)</span>
    </div>`;
  }).join("");

  // Pendientes primero, los más recientes arriba
  const orden = [...state.recordatorios].sort((a, b) =>
    (Number(a.hecho) - Number(b.hecho)) || String(b.creado_en).localeCompare(String(a.creado_en)));
  $("#listaRec").innerHTML = orden.map(r => `
    <li class="rec tipo-${esc(r.tipo)} ${r.hecho ? "hecho" : ""}">
      <button class="check" data-rec-toggle="${esc(r.id)}" aria-label="${r.hecho ? "Marcar como pendiente" : "Marcar como hecho"}">${r.hecho ? "✔" : ""}</button>
      <div class="rec-txt">
        <b>${esc(r.texto)}</b>
        <small>${esc(TIPOS_REC[r.tipo] || "Otro")}${r.monto ? " · " + money(r.monto) : ""} · ${esc(r.usuaria)} · ${fechaCorta(r.creado_en)}</small>
      </div>
      <button class="x" data-rec-borrar="${esc(r.id)}" aria-label="Eliminar recordatorio">✕</button>
    </li>`).join("") || `<li class="muted small">Aún no hay recordatorios.</li>`;
}

function pintarListaNotas() {
  const orden = [...state.notas].sort((a, b) =>
    (Number(a.hecha) - Number(b.hecha)) || String(b.creado_en).localeCompare(String(a.creado_en)));
  $("#listaNotas").innerHTML = orden.map(n => `
    <li class="nota-item ${n.hecha ? "hecho" : ""}">
      <button class="check" data-nota-toggle="${esc(n.id)}" aria-label="${n.hecha ? "Marcar como pendiente" : "Marcar como hecha"}">${n.hecha ? "✔" : ""}</button>
      <span>${esc(n.texto)}</span>
      <button class="x" data-nota-borrar="${esc(n.id)}" aria-label="Eliminar nota">✕</button>
    </li>`).join("") || `<li class="muted small">No hay notas. Escribe tu primer pendiente arriba.</li>`;
}

// Ejecuta una operación contra la base de datos y actualiza la pantalla
async function operar(fn, ok) {
  try {
    await fn();
    if (ok) toast(ok);
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo guardar");
  }
}

// Pone una opción rápida en el formulario (el texto se puede editar antes de guardar)
function prefillRec(tipo, texto) {
  const f = $("#formRec");
  f.tipo.value = tipo;
  f.texto.value = texto;
  f.texto.focus();
}

// Clics dentro de la sección. Devuelve true si el clic fue para esta sección.
function accionNotas(t) {
  let el;
  if ((el = t.closest("[data-rq]"))) { prefillRec(el.dataset.rq, el.dataset.texto); return true; }

  if ((el = t.closest("[data-rec-toggle]"))) {
    const r = state.recordatorios.find(x => x.id === el.dataset.recToggle);
    if (r) operar(() => DB.cambiarRecordatorio(r.id, { hecho: !r.hecho }));
    return true;
  }
  if ((el = t.closest("[data-rec-borrar]"))) {
    if (confirm("¿Eliminar este recordatorio?")) operar(() => DB.borrarRecordatorio(el.dataset.recBorrar), "Recordatorio eliminado");
    return true;
  }
  if ((el = t.closest("[data-nota-toggle]"))) {
    const n = state.notas.find(x => x.id === el.dataset.notaToggle);
    if (n) operar(() => DB.cambiarNota(n.id, { hecha: !n.hecha }));
    return true;
  }
  if ((el = t.closest("[data-nota-borrar]"))) {
    operar(() => DB.borrarNota(el.dataset.notaBorrar), "Nota eliminada");
    return true;
  }
  return false;
}

async function guardarRecordatorio(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  const texto = f.texto.value.trim();
  if (!texto) return toast("Escribe el recordatorio");
  const monto = f.monto.value === "" ? null : Number(f.monto.value);
  if (monto !== null && !(monto >= 0)) return toast("Revisa el monto");

  btn.disabled = true;
  try {
    await DB.guardarRecordatorio({ tipo: f.tipo.value, texto, monto });
    f.reset();
    toast("Recordatorio agregado ✔");
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo guardar el recordatorio");
  } finally {
    btn.disabled = false;
  }
}

async function guardarNota(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  const texto = f.texto.value.trim();
  if (!texto) return toast("Escribe la nota");

  btn.disabled = true;
  try {
    await DB.guardarNota(texto);
    f.reset();
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo guardar la nota");
  } finally {
    btn.disabled = false;
  }
}
