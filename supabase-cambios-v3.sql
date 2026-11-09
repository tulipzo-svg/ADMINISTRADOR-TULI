-- =====================================================
-- VALLERY · Cambios v3: tandas numeradas, detalle y archivo Excel
-- Ejecutar DESPUÉS de supabase-schema.sql y supabase-cambios-v2.sql
-- =====================================================

-- ---------- 1) NÚMERO Y DETALLE DE LA TANDA ----------
alter table public.lotes add column if not exists numero int;
alter table public.lotes add column if not exists descripcion text not null default '';

-- Tandas que ya existían reciben número según su orden de creación
with n as (
  select id, row_number() over (order by creado_en, id) as rn
  from public.lotes where numero is null
)
update public.lotes l set numero = n.rn from n where l.id = n.id;

alter table public.lotes alter column numero set not null;
create unique index if not exists lotes_numero_key on public.lotes (numero);

-- ---------- 2) REGISTRAR TANDA (número automático, sin repetir) ----------
drop function if exists public.registrar_lote(text, numeric, jsonb, jsonb);

create or replace function public.registrar_lote(p_descripcion text, p_envio numeric, p_items jsonb, p_empaques jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_usuaria  text := public.usuaria_actual();
  v_desc     text := left(trim(coalesce(p_descripcion, '')), 60);
  v_numero   int;
  v_nombre   text;
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
  if v_envio < 0 then raise exception 'El envío no puede ser negativo'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La tanda no tiene prendas';
  end if;

  -- Evita que dos celulares creen el mismo número de tanda al mismo tiempo
  perform pg_advisory_xact_lock(hashtext('lotes'));
  select coalesce(max(numero), 0) + 1 into v_numero from public.lotes;
  v_nombre := 'Tanda ' || v_numero || case when v_desc <> '' then ' · ' || v_desc else '' end;

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

  insert into public.lotes (nombre, numero, descripcion, usuaria, costo_envio, items, empaques, total)
  values (v_nombre, v_numero, v_desc, v_usuaria, v_envio, v_lineas, v_empl,
          v_tot_pren + v_envio + v_tot_emp)
  returning id into v_id;

  -- Caja: prendas = mercancía; envío y empaques = gastos
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
  values (v_usuaria, 'registró ' || v_nombre || ' por $' ||
          to_char(v_tot_pren + v_envio + v_tot_emp, 'FM999990.00'));

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'nombre', v_nombre);
end $$;

revoke execute on function public.registrar_lote(text, numeric, jsonb, jsonb) from public, anon;
grant  execute on function public.registrar_lote(text, numeric, jsonb, jsonb) to authenticated;

-- ---------- 3) ARCHIVO EXCEL DE CADA TANDA (bucket privado) ----------
-- Se guarda como "<id de la tanda>.xlsx". Solo usuarias con sesión pueden verlo o subirlo.
insert into storage.buckets (id, name, public) values ('tandas', 'tandas', false)
on conflict (id) do nothing;

create policy "tandas_subir" on storage.objects for insert to authenticated with check (bucket_id = 'tandas');
create policy "tandas_leer"  on storage.objects for select to authenticated using (bucket_id = 'tandas');
