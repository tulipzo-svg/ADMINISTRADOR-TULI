-- =====================================================
-- TULI · Cambios v11: HASTA 5 FOTOS POR PRENDA (versión corregida)
-- Ejecutar DESPUÉS de supabase-cambios-v10.sql (SQL Editor → Run).
-- Es seguro ejecutarlo más de una vez.
--
-- productos.fotos es una lista de texto (text[]). La primera foto es la portada.
-- productos.foto_url se mantiene igual a la primera foto (compatibilidad).
-- =====================================================

-- 1) La columna: si ya existe (text[]) se usa tal cual; si no, se crea
alter table public.productos add column if not exists fotos text[] not null default '{}';
alter table public.productos alter column fotos set default '{}';
update public.productos set fotos = '{}' where fotos is null;
alter table public.productos alter column fotos set not null;

-- 2) Máximo 5: si alguna prenda tuviera más, se quedan las primeras 5
update public.productos set fotos = fotos[1:5] where cardinality(fotos) > 5;
alter table public.productos drop constraint if exists productos_fotos_check;
alter table public.productos add constraint productos_fotos_check check (cardinality(fotos) <= 5);

-- 3) Las prendas que ya tenían foto de portada pasan a tener esa foto en la lista
update public.productos
   set fotos = array[foto_url]
 where coalesce(foto_url, '') <> ''
   and cardinality(fotos) = 0;

-- 4) Vista de la tienda: igual que v10, más la lista de fotos
drop view if exists public.tienda_productos;

create view public.tienda_productos as
select
  p.id,
  p.nombre,
  p.categoria,
  p.seccion_tienda as seccion,
  p.precio,
  p.destacado,
  p.foto_url,
  p.actualizado_en,
  coalesce((select jsonb_agg(distinct v->>'talla')
              from jsonb_array_elements(p.variantes) v
             where coalesce((v->>'stock')::int, 0) > 0), '[]'::jsonb) as tallas,
  coalesce((select jsonb_agg(distinct v->>'color')
              from jsonb_array_elements(p.variantes) v
             where coalesce((v->>'stock')::int, 0) > 0), '[]'::jsonb) as colores,
  coalesce((select jsonb_agg(jsonb_build_object('talla', v->>'talla', 'color', v->>'color'))
              from jsonb_array_elements(p.variantes) v
             where coalesce((v->>'stock')::int, 0) > 0), '[]'::jsonb) as disponibles,
  coalesce(p.fotos, '{}'::text[]) as fotos
from public.productos p
where p.publicado
  and exists (select 1 from jsonb_array_elements(p.variantes) v where coalesce((v->>'stock')::int, 0) > 0);

grant select on public.tienda_productos to anon, authenticated;
