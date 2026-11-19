-- =====================================================
-- TULI · Cambios v8: EL CATÁLOGO ES LA TIENDA
-- Ejecutar DESPUÉS de supabase-cambios-v7.sql (SQL Editor → Run).
-- Es seguro ejecutarlo más de una vez.
--
-- Qué hace:
--  1) Cada prenda del catálogo (inventario) tiene "publicado" y "sección en la tienda".
--  2) La tienda lee una VISTA pública que solo muestra prendas publicadas CON existencias.
--     La vista NO expone costos ni cantidades: solo nombre, precio, foto, tallas y colores disponibles.
--  3) Se elimina la lista separada "catalogo_web" (si todavía está vacía).
-- =====================================================

-- ---------- 1) Campos nuevos en el catálogo ----------
alter table public.productos add column if not exists publicado boolean not null default false;
alter table public.productos add column if not exists seccion_tienda text not null default 'tops';
alter table public.productos drop constraint if exists productos_seccion_tienda_check;
alter table public.productos add constraint productos_seccion_tienda_check
  check (seccion_tienda in ('tops', 'vestidos', 'bottoms'));

-- ---------- 2) Vista pública de la tienda (sin costos ni cantidades) ----------
-- Solo aparecen prendas: publicadas + con al menos una variante con existencias.
-- La vista se ejecuta con los permisos del dueño, por eso puede leer el catálogo
-- aunque la tabla productos solo se pueda leer con sesión iniciada.
create or replace view public.tienda_productos as
select
  p.id,
  p.nombre,
  p.categoria,
  p.seccion_tienda                                      as seccion,
  p.precio,
  p.destacado,
  p.foto_url,
  p.actualizado_en,
  coalesce((select jsonb_agg(distinct v->>'talla')
              from jsonb_array_elements(p.variantes) v
             where (v->>'stock')::int > 0), '[]'::jsonb) as tallas,
  coalesce((select jsonb_agg(distinct v->>'color')
              from jsonb_array_elements(p.variantes) v
             where (v->>'stock')::int > 0), '[]'::jsonb) as colores
from public.productos p
where p.publicado
  and exists (select 1 from jsonb_array_elements(p.variantes) v where (v->>'stock')::int > 0);

grant select on public.tienda_productos to anon, authenticated;

-- ---------- 3) Quitar la lista separada de la v7 (solo si está vacía) ----------
do $$
begin
  if to_regclass('public.catalogo_web') is not null then
    if not exists (select 1 from public.catalogo_web) then
      drop table public.catalogo_web;
      raise notice 'Lista separada catalogo_web eliminada (estaba vacía).';
    else
      raise notice 'catalogo_web tiene datos: no se borra. La tienda ya no la usa.';
    end if;
  end if;
end $$;
