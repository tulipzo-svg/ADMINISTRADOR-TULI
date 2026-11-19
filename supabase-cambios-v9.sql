-- =====================================================
-- TULI · Cambios v9: FOTOS DE LA PÁGINA DE LA TIENDA EN SUPABASE
-- Ejecutar DESPUÉS de supabase-cambios-v8.sql (SQL Editor → Run).
-- Es seguro ejecutarlo más de una vez.
--
-- Solo hay DOS fotos editables (no es un catálogo):
--   'inicio'    → la foto grande que está al lado de «Tu outfit perfecto»
--   'nosotros'  → la foto de «Descubre nuestra tienda» (las etiquetas con el logo)
-- Las fotos se guardan en el bucket público «fotos» (carpeta sitio/).
-- =====================================================

create table if not exists public.sitio_imagenes (
  clave          text primary key check (clave in ('inicio', 'nosotros')),
  url            text,                                   -- URL pública en Storage (null = aún sin foto)
  actualizado_en timestamptz not null default now()
);

insert into public.sitio_imagenes (clave) values ('inicio'), ('nosotros')
on conflict (clave) do nothing;

alter table public.sitio_imagenes enable row level security;

-- La tienda (sin iniciar sesión) puede leer; solo las cuentas autorizadas pueden cambiar la URL
drop policy if exists "sitio_imagenes_ver"    on public.sitio_imagenes;
drop policy if exists "sitio_imagenes_editar" on public.sitio_imagenes;
create policy "sitio_imagenes_ver"    on public.sitio_imagenes for select to anon, authenticated using (true);
create policy "sitio_imagenes_editar" on public.sitio_imagenes for update to authenticated using (true) with check (true);

-- Las fotos se suben al bucket «fotos» (ya existente), en la carpeta sitio/.
-- Las reglas de ese bucket (fotos_subir / fotos_editar) ya limitan la subida a cuentas autorizadas.
