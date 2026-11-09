/* =========================================================
   VALLERY · Mi perfil
   Cada usuaria personaliza SU perfil: foto, emoji, color del avatar,
   frase personal, pantalla con la que abre la app y modo privado.
   El nombre, el correo y la contraseña NO se cambian aquí.
   Carga después de recordatorios.js y antes de app.js.
   ========================================================= */

const PERFIL_EMOJIS = ["🌷", "🌸", "✨", "💜", "🦋", "🌙", "🍒", "🐚", "🌺", "🎀", "💎", "🌟", "🐞", "🍀"];
const PERFIL_COLORES = [
  ["#A0022E", "Vino"], ["#C58B2B", "Dorado"], ["#E07A9B", "Rosa"], ["#2F5D8A", "Azul"],
  ["#2E7D5B", "Verde"], ["#6D4AA3", "Violeta"], ["#8C7B5A", "Café"],
];
const PERFIL_PANTALLAS = [
  ["inicio", "Inicio"], ["venta", "Venta rápida"], ["inventario", "Catálogo"], ["compras", "Gasto corporativo"],
  ["caja", "Caja"], ["notas", "Notas y recordatorios"], ["analitica", "Analítica"],
];
const FRASES_DEFECTO = [
  "Hoy es un buen día para vender bonito ✨",
  "Cada venta cuenta. ¡Tú puedes! 💪",
  "Mucho color y mucho estilo 🌷",
  "Una prenda bonita cambia el día 💜",
  "Paso a paso también se vende mucho 🦋",
];

// Perfil de la usuaria que tiene la sesión abierta (vacío si aún no hay ninguno)
const miPerfil = () => (state.usuaria && state.perfiles.find(p => p.usuaria === state.usuaria.nombre)) || {};
const fraseDelDia = () => FRASES_DEFECTO[new Date().getDate() % FRASES_DEFECTO.length];

// Avatar: la foto si la hay; si no, el emoji sobre el color elegido
function avatarHTML(p, nombre = "") {
  if (p && p.foto_url) return `<img class="avatar-img" src="${esc(p.foto_url)}" alt="Foto de ${esc(nombre)}">`;
  const color = (p && p.color) || "#A0022E";
  return `<span class="avatar-emo" style="background:${esc(color)}">${esc((p && p.emoji) || "🌷")}</span>`;
}

// Pinta el botón de perfil de la barra lateral y el del celular
function pintarPerfilChip() {
  if (!state.usuaria) return;
  const nombre = state.usuaria.nombre;
  const html = avatarHTML(miPerfil(), nombre);
  $("#chipUsuaria").innerHTML = `<span class="perfil-ico">${html}</span>
    <span class="perfil-txt"><b>${esc(nombre)}</b><small>Mi perfil ✎</small></span>`;
  const movil = $("#avatarMovil");
  if (movil) movil.innerHTML = html;
}

function abrirPerfil() {
  if (!state.usuaria) return;
  const p = miPerfil();
  const nombre = state.usuaria.nombre;
  const emoji = p.emoji || "🌷";
  const color = p.color || "#A0022E";
  $("#modal .sheet").innerHTML = `
    <form id="formPerfil" class="stack">
      <div class="sheet-head"><h3>Mi perfil</h3>
        <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button></div>

      <div class="perfil-hero">
        <div class="grande" id="perfilPreview">${avatarHTML({ foto_url: p.foto_url, emoji, color }, nombre)}</div>
        <div class="stack" style="gap:8px">
          <label class="btn sm ghost" for="fotoPerfilIn" style="cursor:pointer">📷 Subir foto</label>
          <input type="file" id="fotoPerfilIn" accept="image/*" class="sr">
          <button type="button" class="btn sm ghost" data-quitar-foto ${p.foto_url ? "" : "disabled"}>Quitar foto</button>
        </div>
      </div>

      <p class="nombre-prev">Tu nombre, correo y contraseña los administra la dueña de la cuenta.</p>

      <div>
        <p class="small muted">Emoji (se usa si no tienes foto)</p>
        <div class="opts">${PERFIL_EMOJIS.map(e => `<button type="button" class="emo ${e === emoji ? "on" : ""}" data-perfil-emoji="${e}" aria-label="Emoji ${e}">${e}</button>`).join("")}</div>
      </div>

      <div>
        <p class="small muted">Color de tu avatar</p>
        <div class="opts">${PERFIL_COLORES.map(([c, n]) => `<button type="button" class="sw ${c === color ? "on" : ""}" data-perfil-color="${c}" style="background:${c}" aria-label="${n}" title="${n}"></button>`).join("")}</div>
      </div>

      <label>Frase personal
        <input name="frase" maxlength="60" placeholder="Ej: Hoy vendo bonito" value="${esc(p.frase || "")}">
      </label>

      <label>Pantalla con la que abro la app
        <select name="pantalla">${PERFIL_PANTALLAS.map(([k, l]) => `<option value="${k}" ${(p.pantalla || "inicio") === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>

      <label class="tog"><input type="checkbox" name="privado" ${p.ocultar_montos ? "checked" : ""}> Modo privado: ocultar montos en Inicio</label>

      <input type="hidden" name="emoji" value="${esc(emoji)}">
      <input type="hidden" name="color" value="${esc(color)}">

      <div class="acc" style="justify-content:flex-end">
        <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
        <button class="btn" type="submit">Guardar perfil</button>
      </div>
    </form>`;
  abrirModal();
}

// Cambia el emoji o el color elegido dentro del formulario, sin guardar todavía
function elegirPerfil(campo, valor) {
  const f = $("#formPerfil");
  if (!f) return;
  f[campo].value = valor;
  const selector = campo === "emoji" ? "[data-perfil-emoji]" : "[data-perfil-color]";
  $$(selector, f).forEach(b => b.classList.toggle("on", (b.dataset.perfilEmoji || b.dataset.perfilColor) === valor));
  const vista = $("#perfilPreview .avatar-emo");
  if (vista) {
    if (campo === "emoji") vista.textContent = valor;
    else vista.style.background = valor;
  }
}

async function subirFotoPerfil(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast("Selecciona una imagen");
  if (file.size > 15 * 1024 * 1024) return toast("La foto es muy pesada (máx. 15 MB)");
  const nombre = state.usuaria.nombre;
  try {
    toast("Subiendo foto…");
    const blob = await comprimir(file, 400);
    const url = await DB.subirFotoPerfil(nombre, blob);
    await DB.guardarPerfil(nombre, { foto_url: url });
    await cargar();
    $("#perfilPreview").innerHTML = avatarHTML(miPerfil(), nombre);
    const quitar = $("[data-quitar-foto]");
    if (quitar) quitar.disabled = false;
    toast("Foto de perfil actualizada ✔");
  } catch (err) {
    toast(err.message || "No se pudo subir la foto");
  }
}

async function quitarFotoPerfil() {
  const nombre = state.usuaria.nombre;
  try {
    await DB.guardarPerfil(nombre, { foto_url: null });
    await cargar();
    const f = $("#formPerfil");
    $("#perfilPreview").innerHTML = avatarHTML({ foto_url: null, emoji: f.emoji.value, color: f.color.value }, nombre);
    $("[data-quitar-foto]").disabled = true;
    toast("Foto quitada");
  } catch (err) {
    toast(err.message || "No se pudo quitar la foto");
  }
}

async function guardarPerfilForm(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    await DB.guardarPerfil(state.usuaria.nombre, {
      emoji: f.emoji.value,
      color: f.color.value,
      frase: f.frase.value.trim().slice(0, 60),
      pantalla: f.pantalla.value,
      ocultar_montos: f.privado.checked,
    });
    cerrarModal();
    toast("Perfil guardado ✔ 🎉");
    await cargar();
  } catch (err) {
    toast(err.message || "No se pudo guardar el perfil");
    btn.disabled = false;
  }
}
