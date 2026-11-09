-- =====================================================
-- VALLERY · Cambios v2: tandas (lotes), empaques y venta con bolsa/etiqueta
-- Ejecutar DESPUÉS de supabase-schema.sql (en SQL Editor → Run)
-- =====================================================

-- ---------- 1) VENTAS: bolsa y etiquetas usadas ----------
alter table public.ventas add column if not exists bolsa text;
alter table public.ventas add column if not exists etiquetas int not null default 0 check (etiquetas >= 0);

-- ---------- 2) EMPAQUES (inventario de bolsas y etiquetas) ----------
create table if not exists public.empaques (
  id         text primary key,                 -- 'bolsa_mediana' | 'bolsa_grande' | 'etiqueta'
  nombre     text not null,
  tipo       text not null check (tipo in ('bolsa','etiqueta')),
  cantidad   int not null default 0 check (cantidad >= 0),
  costo_unit numeric(10,4) not null default 0 check (costo_unit >= 0)
);

insert into public.empaques (id, nombre, tipo, cantidad, costo_unit) values
  ('bolsa_mediana', 'Bolsa mediana',                          'bolsa',    0, 0),
  ('bolsa_grande',  'Bolsa grande',                           'bolsa',    0, 0),
  ('etiqueta',      'Etiqueta / tarjeta de agradecimiento',  'etiqueta', 0, 0)
on conflict (id) do nothing;

-- ---------- 3) TANDAS (lotes de compra) ----------
create table if not exists public.lotes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  fecha       date not null default current_date,
  usuaria     text not null,
  costo_envio numeric(10,2) not null default 0,
  items       jsonb not null default '[]'::jsonb,     -- [{producto_id,nombre,talla,color,cantidad,costo_unit}]
  empaques    jsonb not null default '[]'::jsonb,     -- [{id,nombre,cantidad,costo_unit}]
  total       numeric(10,2) not null default 0,
  creado_en   timestamptz not null default now()
);

alter table public.empaques enable row level security;
alter table public.lotes    enable row level security;
create policy "empaques_leer" on public.empaques for select to authenticated using (true);
create policy "lotes_leer"    on public.lotes    for select to authenticated using (true);
-- Sin insert/update/delete directo: todo pasa por las funciones de abajo.

-- ---------- 4) VENTA (reemplaza la anterior) ----------
drop function if exists public.registrar_venta(jsonb);

create or replace function public.registrar_venta(p_items jsonb, p_bolsa text, p_etiquetas int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_usuaria text := public.usuaria_actual();
  v_item    jsonb;
  v_prod    public.productos%rowtype;
  v_idx     int;
  v_stock   int;
  v_cant    int;
  v_total   numeric := 0;
  v_costo   numeric := 0;
  v_lineas  jsonb := '[]'::jsonb;
  v_etq     int := coalesce(p_etiquetas, 0);
  v_id      uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta está vacía';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item->>'cantidad')::int;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida'; end if;

    select * into v_prod from public.productos
     where id = (v_item->>'producto_id')::uuid for update;
    if not found then raise exception 'Una prenda ya no existe'; end if;

    v_idx := null;
    for i in 0 .. coalesce(jsonb_array_length(v_prod.variantes), 0) - 1 loop
      if v_prod.variantes->i->>'talla' = v_item->>'talla'
         and v_prod.variantes->i->>'color' = v_item->>'color' then
        v_idx := i; exit;
      end if;
    end loop;
    if v_idx is null then
      raise exception 'La variante elegida no existe para %', v_prod.nombre;
    end if;

    v_stock := (v_prod.variantes->v_idx->>'stock')::int;
    if v_stock < v_cant then
      raise exception 'Sin existencias de % (% %). Quedan %',
        v_prod.nombre, v_item->>'talla', v_item->>'color', v_stock;
    end if;

    v_prod.variantes := jsonb_set(v_prod.variantes, array[v_idx::text, 'stock'], to_jsonb(v_stock - v_cant));
    update public.productos set variantes = v_prod.variantes, actualizado_en = now() where id = v_prod.id;

    v_total := v_total + v_prod.precio * v_cant;
    v_costo := v_costo + v_prod.costo * v_cant;
    v_lineas := v_lineas || jsonb_build_object(
      'producto_id', v_prod.id, 'nombre', v_prod.nombre,
      'talla', v_item->>'talla', 'color', v_item->>'color',
      'cantidad', v_cant, 'precio', v_prod.precio, 'costo', v_prod.costo);
  end loop;

  -- Empaques: se descuentan solo si la venta los usa
  if p_bolsa is not null then
    if p_bolsa not in ('bolsa_mediana', 'bolsa_grande') then raise exception 'Bolsa no válida'; end if;
    update public.empaques set cantidad = cantidad - 1 where id = p_bolsa and cantidad >= 1;
    if not found then raise exception 'No hay bolsas de ese tamaño disponibles'; end if;
  end if;
  if v_etq > 0 then
    update public.empaques set cantidad = cantidad - v_etq where id = 'etiqueta' and cantidad >= v_etq;
    if not found then raise exception 'No hay suficientes etiquetas'; end if;
  end if;

  insert into public.ventas (usuaria, items, total, costo_total, bolsa, etiquetas)
  values (v_usuaria, v_lineas, v_total, v_costo, p_bolsa, v_etq)
  returning id into v_id;

  insert into public.actividad (usuaria, texto)
  values (v_usuaria, 'registró una venta por $' || to_char(v_total, 'FM999990.00'));

  return v_id;
end $$;

-- ---------- 5) TANDA: suma stock, actualiza costos y registra gastos ----------
create or replace function public.registrar_lote(p_nombre text, p_envio numeric, p_items jsonb, p_empaques jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_usuaria  text := public.usuaria_actual();
  v_nombre   text := left(trim(coalesce(p_nombre, '')), 80);
  v_envio    numeric := coalesce(p_envio, 0);
  v_item     jsonb;
  v_emp      jsonb;
  v_prod     public.productos%rowtype;
  v_idx      int;
  v_cant     int;
  v_costo    numeric;
  v_cant_e   int;
  v_costo_e  numeric;
  v_nom_e    text;
  v_tot_pren numeric := 0;
  v_tot_emp  numeric := 0;
  v_lineas   jsonb := '[]'::jsonb;
  v_empl     jsonb := '[]'::jsonb;
  v_id       uuid;
begin
  if v_nombre = '' then raise exception 'Escribe el nombre de la tanda'; end if;
  if v_envio < 0 then raise exception 'El envío no puede ser negativo'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La tanda no tiene prendas';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant  := (v_item->>'cantidad')::int;
    v_costo := (v_item->>'costo_unit')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida'; end if;
    if v_costo is null or v_costo < 0 then raise exception 'Costo inválido'; end if;

    select * into v_prod from public.productos
     where id = (v_item->>'producto_id')::uuid for update;
    if not found then raise exception 'Una prenda ya no existe'; end if;

    v_idx := null;
    for i in 0 .. coalesce(jsonb_array_length(v_prod.variantes), 0) - 1 loop
      if v_prod.variantes->i->>'talla' = v_item->>'talla'
         and v_prod.variantes->i->>'color' = v_item->>'color' then
        v_idx := i; exit;
      end if;
    end loop;

    if v_idx is null then
      v_prod.variantes := v_prod.variantes || jsonb_build_object(
        'talla', v_item->>'talla', 'color', v_item->>'color', 'stock', v_cant);
    else
      v_prod.variantes := jsonb_set(v_prod.variantes, array[v_idx::text, 'stock'],
        to_jsonb((v_prod.variantes->v_idx->>'stock')::int + v_cant));
    end if;

    update public.productos
       set variantes = v_prod.variantes, costo = v_costo, actualizado_en = now()
     where id = v_prod.id;

    v_tot_pren := v_tot_pren + v_cant * v_costo;
    v_lineas := v_lineas || jsonb_build_object(
      'producto_id', v_prod.id, 'nombre', v_prod.nombre,
      'talla', v_item->>'talla', 'color', v_item->>'color',
      'cantidad', v_cant, 'costo_unit', v_costo);
  end loop;

  for v_emp in select * from jsonb_array_elements(coalesce(p_empaques, '[]'::jsonb)) loop
    v_cant_e  := (v_emp->>'cantidad')::int;
    v_costo_e := (v_emp->>'costo_unit')::numeric;
    if v_cant_e is null or v_cant_e <= 0 then continue; end if;

    update public.empaques
       set cantidad = cantidad + v_cant_e, costo_unit = v_costo_e
     where id = v_emp->>'id'
     returning nombre into v_nom_e;
    if not found then raise exception 'Empaque no válido'; end if;

    v_tot_emp := v_tot_emp + v_cant_e * v_costo_e;
    v_empl := v_empl || jsonb_build_object(
      'id', v_emp->>'id', 'nombre', v_nom_e, 'cantidad', v_cant_e, 'costo_unit', v_costo_e);
  end loop;

  insert into public.lotes (nombre, usuaria, costo_envio, items, empaques, total)
  values (v_nombre, v_usuaria, v_envio, v_lineas, v_empl, v_tot_pren + v_envio + v_tot_emp)
  returning id into v_id;

  -- Dinero que sale de caja: prendas como mercancía; envío y empaques como gastos
  if v_tot_pren > 0 then
    insert into public.movimientos (usuaria, tipo, concepto, monto)
    values (v_usuaria, 'mercancia', 'Prendas · ' || v_nombre, round(v_tot_pren, 2));
  end if;
  if v_envio > 0 then
    insert into public.movimientos (usuaria, tipo, concepto, monto)
    values (v_usuaria, 'gasto', 'Envío · ' || v_nombre, round(v_envio, 2));
  end if;
  if v_tot_emp > 0 then
    insert into public.movimientos (usuaria, tipo, concepto, monto)
    values (v_usuaria, 'gasto', 'Empaques · ' || v_nombre, round(v_tot_emp, 2));
  end if;

  insert into public.actividad (usuaria, texto)
  values (v_usuaria, 'registró ' || v_nombre || ' por $' || to_char(v_tot_pren + v_envio + v_tot_emp, 'FM999990.00'));

  return v_id;
end $$;

-- ---------- 6) PERMISOS ----------
revoke execute on function public.registrar_venta(jsonb, text, int) from public, anon;
revoke execute on function public.registrar_lote(text, numeric, jsonb, jsonb) from public, anon;
grant  execute on function public.registrar_venta(jsonb, text, int) to authenticated;
grant  execute on function public.registrar_lote(text, numeric, jsonb, jsonb) to authenticated;

-- ---------- 7) TIEMPO REAL ----------
alter publication supabase_realtime add table public.empaques, public.lotes;
