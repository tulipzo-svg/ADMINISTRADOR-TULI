-- =====================================================
-- TULI · Cambios v10: CATEGORÍAS + TALLAS POR COLOR EN LA TIENDA
-- Ejecutar DESPUÉS de supabase-cambios-v9.sql (SQL Editor → Run).
-- Es seguro ejecutarlo más de una vez.
--
--  1) Lista de categorías (se crean desde el catálogo y aparecen en la tienda).
--  2) La vista de la tienda trae las combinaciones talla+color con existencias,
--     para que la tienda no ofrezca una talla que no existe en ese color.
--     Sigue sin exponer costos ni cantidades.
-- =====================================================

-- ---------- 1) Categorías ----------
create table if not exists public.categorias (
  nombre    text primary key check (char_length(btrim(nombre)) between 1 and 40),
  creado_en timestamptz not null default now()
);

alter table public.categorias enable row level security;

drop policy if exists "categorias_ver"     on public.categorias;
drop policy if exists "categorias_crear"   on public.categorias;
drop policy if exists "categorias_editar"  on public.categorias;
drop policy if exists "categorias_borrar"  on public.categorias;
create policy "categorias_ver"    on public.categorias for select to authenticated using (true);
create policy "categorias_crear"  on public.categorias for insert to authenticated with check (true);
create policy "categorias_editar" on public.categorias for update to authenticated using (true) with check (true);
create policy "categorias_borrar" on public.categorias for delete to authenticated using (true);

-- Las categorías que ya usas en el catálogo pasan a la lista
insert into public.categorias (nombre)
select distinct btrim(categoria) from public.productos
where btrim(coalesce(categoria, '')) <> ''
on conflict (nombre) do nothing;

-- ---------- 2) Vista pública de la tienda (con combinaciones disponibles) ----------
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
             where coalesce((v->>'stock')::int, 0) > 0), '[]'::jsonb) as disponibles
from public.productos p
where p.publicado
  and exists (select 1 from jsonb_array_elements(p.variantes) v where coalesce((v->>'stock')::int, 0) > 0);

grant select on public.tienda_productos to anon, authenticated;
