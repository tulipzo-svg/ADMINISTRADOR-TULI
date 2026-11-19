-- =====================================================
-- TULI · Cambios v7: CATÁLOGO WEB + CIERRE DE MES AUTOMÁTICO
-- Ejecutar DESPUÉS de supabase-cambios-v6.sql (SQL Editor → Run).
-- Es seguro ejecutarlo más de una vez.
-- =====================================================

-- ---------- 1) CATÁLOGO WEB (las prendas que se ven en la tienda) ----------
create table if not exists public.catalogo_web (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null check (char_length(nombre) between 1 and 80),
  categoria       text not null default '' check (char_length(categoria) <= 80),
  tipo            text not null default 'tops' check (tipo in ('tops','vestidos','bottoms')),
  precio          numeric(10,2) not null check (precio >= 0),
  descripcion     text not null default '' check (char_length(descripcion) <= 600),
  etiqueta        text not null default '' check (char_length(etiqueta) <= 24),
  destacado       boolean not null default false,
  activo          boolean not null default true,
  tallas          jsonb not null default '["S","M"]'::jsonb,        -- ["S","M","L"]
  colores         jsonb not null default '[]'::jsonb,              -- [{"nombre":"Negro","hex":"#252525","fotos":["https://…"]}]
  orden           int not null default 0,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

alter table public.catalogo_web enable row level security;

-- La tienda (sin iniciar sesión) ve solo las prendas visibles; la administración ve todas.
drop policy if exists "catalogo_web_ver" on public.catalogo_web;
create policy "catalogo_web_ver" on public.catalogo_web
  for select to anon, authenticated
  using (activo or auth.role() = 'authenticated');

drop policy if exists "catalogo_web_crear"  on public.catalogo_web;
drop policy if exists "catalogo_web_editar" on public.catalogo_web;
drop policy if exists "catalogo_web_borrar" on public.catalogo_web;
create policy "catalogo_web_crear"  on public.catalogo_web for insert to authenticated with check (true);
create policy "catalogo_web_editar" on public.catalogo_web for update to authenticated using (true) with check (true);
create policy "catalogo_web_borrar" on public.catalogo_web for delete to authenticated using (true);

-- Fotos del catálogo: bucket PÚBLICO (la tienda las muestra), solo la administración sube o borra.
insert into storage.buckets (id, name, public)
values ('catalogo-web', 'catalogo-web', true)
on conflict (id) do update set public = true;

drop policy if exists "catalogo_web_fotos_subir"  on storage.objects;
drop policy if exists "catalogo_web_fotos_editar" on storage.objects;
drop policy if exists "catalogo_web_fotos_borrar" on storage.objects;
create policy "catalogo_web_fotos_subir"  on storage.objects for insert to authenticated with check (bucket_id = 'catalogo-web');
create policy "catalogo_web_fotos_editar" on storage.objects for update to authenticated using (bucket_id = 'catalogo-web');
create policy "catalogo_web_fotos_borrar" on storage.objects for delete to authenticated using (bucket_id = 'catalogo-web');

-- Tiempo real: al guardar una prenda, la tienda y la administración se actualizan solas
do $$ begin
  alter publication supabase_realtime add table public.catalogo_web;
exception when duplicate_object then null; end $$;

-- Prendas iniciales de la tienda (mismos nombres, precios y descripciones; SIN fotos).
-- Las fotos se suben después desde Administración → Catálogo web.
insert into public.catalogo_web (nombre, categoria, tipo, precio, descripcion, etiqueta, destacado, tallas, colores, orden)
select * from (values
  ('Top Nudo Negro', 'Top halter con amarre', 'tops', 13::numeric,
   'Top negro ajustado con tirantes que se anudan al cuello y espalda descubierta. Un diseño corto para combinar con jeans.',
   'Favorita', true, '["S","M"]'::jsonb,
   '[{"nombre":"Negro","hex":"#252525","fotos":[]}]'::jsonb, 1),
  ('Top Animal Print', 'Top halter animal print', 'tops', 13::numeric,
   'Top halter con amarre al cuello y espalda descubierta, disponible en estampado animal y negro.',
   'Nuevo', true, '["S","M"]'::jsonb,
   '[{"nombre":"Animal print","hex":"#9b7359","fotos":[]},{"nombre":"Negro","hex":"#252525","fotos":[]}]'::jsonb, 2),
  ('Top Lunares', 'Top halter de lunares', 'tops', 13::numeric,
   'Top halter blanco con lunares negros, escote profundo y tirantes largos para anudar en la espalda.',
   'Nuevo', false, '["S","M"]'::jsonb,
   '[{"nombre":"Blanco con lunares","hex":"#f2f0e9","fotos":[]}]'::jsonb, 3),
  ('Vestido Borgoña', 'Vestido corto de un hombro', 'vestidos', 18::numeric,
   'Vestido corto borgoña de corte ajustado, con un hombro descubierto y detalle drapeado.',
   'Nuevo', false, '["S","M"]'::jsonb,
   '[{"nombre":"Borgoña","hex":"#9d304b","fotos":[]}]'::jsonb, 4),
  ('Vestido Negro', 'Vestido negro de cuello alto', 'vestidos', 18::numeric,
   'Vestido negro ajustado, sin mangas y de cuello alto. Una silueta sencilla que puedes llevar de día o de noche.',
   'Nuevo', false, '["S","M"]'::jsonb,
   '[{"nombre":"Negro","hex":"#252525","fotos":[]}]'::jsonb, 5)
) as v(nombre, categoria, tipo, precio, descripcion, etiqueta, destacado, tallas, colores, orden)
where not exists (select 1 from public.catalogo_web);

-- ---------- 2) CIERRES DE MES (cortes de ventas y movimientos) ----------
-- Cada cierre guarda un tramo: desde el cierre anterior hasta "hasta".
-- Así ninguna venta queda en dos cierres ni se pierde ninguna.
create table if not exists public.cierres (
  id                  uuid primary key default gen_random_uuid(),
  periodo             text not null,                      -- 'AAAA-MM' (mes al que corresponde)
  numero              int  not null check (numero >= 1),  -- 1 = primer cierre del mes, 2 = si hubo cierre manual antes
  tipo                text not null check (tipo in ('automatico','manual')),
  desde               timestamptz not null,
  hasta               timestamptz not null,
  cantidad_ventas     int          not null default 0,
  total_ventas        numeric(12,2) not null default 0,
  costo_ventas        numeric(12,2) not null default 0,
  gastos              numeric(12,2) not null default 0,
  mercancia           numeric(12,2) not null default 0,
  retiros             numeric(12,2) not null default 0,
  capital             numeric(12,2) not null default 0,
  cantidad_movimientos int         not null default 0,
  creado_por          text         not null,
  creado_en           timestamptz  not null default now(),
  unique (periodo, numero)
);

alter table public.cierres enable row level security;
drop policy if exists "cierres_leer" on public.cierres;
create policy "cierres_leer" on public.cierres for select to authenticated using (true);
-- Sin insert/update/delete directo: los cierres solo se crean con las funciones de abajo.

-- Núcleo del cierre: crea el registro del tramo (ventas y movimientos desde el último cierre hasta p_hasta).
create or replace function public._cerrar(p_tipo text, p_hasta timestamptz, p_usuaria text, p_exigir boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_desde   timestamptz;
  v_id      uuid;
  v_periodo text;
  v_numero  int;
  v_n       int;
  v_venta   numeric := 0;
  v_costo   numeric := 0;
  v_movs    int;
  v_gastos  numeric := 0;
  v_merc    numeric := 0;
  v_ret     numeric := 0;
  v_cap     numeric := 0;
begin
  select max(hasta) into v_desde from public.cierres;
  v_desde := coalesce(v_desde, '2000-01-01 00:00:00-04'::timestamptz);
  if p_hasta <= v_desde then return null; end if;

  select count(*), coalesce(sum(total), 0), coalesce(sum(costo_total), 0)
    into v_n, v_venta, v_costo
    from public.ventas where creado_en > v_desde and creado_en <= p_hasta;

  select count(*),
         coalesce(sum(monto) filter (where tipo = 'gasto'), 0),
         coalesce(sum(monto) filter (where tipo = 'mercancia'), 0),
         coalesce(sum(monto) filter (where tipo = 'retiro'), 0),
         coalesce(sum(monto) filter (where tipo = 'capital'), 0)
    into v_movs, v_gastos, v_merc, v_ret, v_cap
    from public.movimientos where creado_en > v_desde and creado_en <= p_hasta;

  -- Un cierre automático sin nada que cerrar no crea registro; uno manual exige algo que cerrar
  if p_exigir and v_n = 0 and v_movs = 0 then
    if p_tipo = 'manual' then
      raise exception 'No hay ventas ni movimientos desde el último cierre';
    end if;
    return null;
  end if;

  -- Mes al que corresponde: 1 minuto antes del corte (así el cierre de las 23:59 del 30 cuenta como noviembre)
  v_periodo := to_char(((p_hasta at time zone 'America/Caracas') - interval '1 minute')::date, 'YYYY-MM');
  select count(*) + 1 into v_numero from public.cierres where periodo = v_periodo;

  insert into public.cierres (periodo, numero, tipo, desde, hasta, cantidad_ventas, total_ventas, costo_ventas,
                              gastos, mercancia, retiros, capital, cantidad_movimientos, creado_por)
  values (v_periodo, v_numero, p_tipo, v_desde, p_hasta, v_n, v_venta, v_costo,
          v_gastos, v_merc, v_ret, v_cap, v_movs, coalesce(p_usuaria, 'Sistema automático'))
  returning id into v_id;

  insert into public.actividad (usuaria, texto)
  values (coalesce(p_usuaria, 'Sistema'),
          case when p_tipo = 'automatico' then 'cerró el mes automáticamente (cierre ' || v_numero || ' de ' || v_periodo || ')'
               else 'cerró el período (cierre ' || v_numero || ' de ' || v_periodo || ')' end);

  return v_id;
end $$;

-- Cierre MANUAL desde la app (hasta = ahora). Solo cuentas autorizadas.
create or replace function public.cerrar_periodo_manual()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_usuaria text := public.usuaria_actual();
begin
  return public._cerrar('manual', now(), v_usuaria, true);
end $$;

-- Cierre AUTOMÁTICO (lo llama pg_cron a las 23:59 del último día del mes, hora de Venezuela).
-- Solo el sistema puede ejecutarlo: se le quitan los permisos a los usuarios.
create or replace function public.cerrar_periodo_automatico()
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return public._cerrar('automatico', now(), null, true);
end $$;

-- Respaldo: si al abrir la app ya pasó el fin de mes y no hay cierre de ese mes, lo cierra.
-- (Sirve si pg_cron no está activo.) Devuelve true si creó un cierre.
create or replace function public.cerrar_pendiente()
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_inicio timestamptz;
  v_ultimo timestamptz;
  v_id     uuid;
begin
  perform public.usuaria_actual();   -- solo cuentas autorizadas
  v_inicio := date_trunc('month', now() at time zone 'America/Caracas') at time zone 'America/Caracas';
  select max(hasta) into v_ultimo from public.cierres;
  if v_ultimo is not null and v_ultimo >= v_inicio then return false; end if;
  v_id := public._cerrar('automatico', v_inicio, null, true);
  return v_id is not null;
end $$;

-- Permisos: solo las cuentas autorizadas pueden cerrar desde la app
revoke all on function public._cerrar(text, timestamptz, text, boolean) from public, anon, authenticated;
revoke all on function public.cerrar_periodo_automatico() from public, anon, authenticated;
revoke all on function public.cerrar_periodo_manual() from public, anon;
revoke all on function public.cerrar_pendiente() from public, anon;
grant execute on function public.cerrar_periodo_manual() to authenticated;
grant execute on function public.cerrar_pendiente() to authenticated;

-- ---------- 3) CIERRE AUTOMÁTICO CON pg_cron ----------
-- 03:59 UTC del día 1 = 23:59 del último día del mes en Venezuela (UTC-4, sin cambio de hora).
-- Si pg_cron no está disponible en tu proyecto, este bloque se salta sin error:
-- en ese caso el cierre se hace al abrir la app el primer día del mes (cerrar_pendiente).
do $$
begin
  execute 'create extension if not exists pg_cron';
  begin
    execute $sql$select cron.unschedule('cierre-mensual-tuli')$sql$;
  exception when others then null; end;
  execute $sql$select cron.schedule('cierre-mensual-tuli', '59 3 1 * *', 'select public.cerrar_periodo_automatico();')$sql$;
  raise notice 'Cierre automático programado: 23:59 del último día del mes (hora de Venezuela).';
exception when others then
  raise notice 'pg_cron no disponible (%). El cierre se hará al abrir la app el día 1.', sqlerrm;
end $$;
