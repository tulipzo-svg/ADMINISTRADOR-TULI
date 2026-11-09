-- =====================================================
-- VALLERY · Base de datos y seguridad en Supabase
-- Pegar TODO el archivo en: Supabase → SQL Editor → Run
-- =====================================================

-- ---------- 1) TABLAS ----------
create table if not exists public.productos (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null check (char_length(nombre) between 1 and 80),
  categoria     text not null default 'General' check (char_length(categoria) between 1 and 40),
  precio        numeric(10,2) not null check (precio >= 0),
  costo         numeric(10,2) not null default 0 check (costo >= 0),
  destacado     boolean not null default false,
  foto_url      text,
  variantes     jsonb not null default '[]'::jsonb,   -- [{"talla":"M","color":"Negro","stock":3}]
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.ventas (
  id           uuid primary key default gen_random_uuid(),
  usuaria      text not null,
  items        jsonb not null,
  total        numeric(10,2) not null,
  costo_total  numeric(10,2) not null,
  creado_en    timestamptz not null default now()
);

create table if not exists public.movimientos (
  id        uuid primary key default gen_random_uuid(),
  usuaria   text not null,
  tipo      text not null check (tipo in ('gasto','mercancia','retiro')),
  concepto  text not null check (char_length(concepto) between 1 and 200),
  monto     numeric(10,2) not null check (monto > 0),
  creado_en timestamptz not null default now()
);

create table if not exists public.actividad (
  id        uuid primary key default gen_random_uuid(),
  usuaria   text not null,
  texto     text not null,
  creado_en timestamptz not null default now()
);

-- ---------- 2) IDENTIDAD DE LA USUARIA (decidida en el servidor) ----------
-- El nombre sale del correo con el que inició sesión, no de lo que envía el navegador.
create or replace function public.usuaria_actual()
returns text language plpgsql stable security definer set search_path = public as $$
declare v_nombre text;
begin
  v_nombre := case lower(coalesce(auth.jwt() ->> 'email', ''))
    when 'rosainernaz026@tuli.com' then 'Rosainer'
    when 'valeriraz029@tuli.com'   then 'Valeri'
    when 'tulipzoo019@tuli.com'    then 'General'
    else null
  end;
  if v_nombre is null then
    raise exception 'Cuenta no autorizada';
  end if;
  return v_nombre;
end $$;

-- ---------- 3) SEGURIDAD DE FILAS (RLS) ----------
alter table public.productos   enable row level security;
alter table public.ventas      enable row level security;
alter table public.movimientos enable row level security;
alter table public.actividad   enable row level security;

-- Productos: cualquiera con sesión iniciada puede leer y administrar el catálogo.
create policy "productos_leer"    on public.productos for select to authenticated using (true);
create policy "productos_crear"   on public.productos for insert to authenticated with check (true);
create policy "productos_editar"  on public.productos for update to authenticated using (true) with check (true);
create policy "productos_borrar"  on public.productos for delete to authenticated using (true);

-- Ventas, movimientos y actividad: solo lectura directa.
-- NO hay políticas de insert/update/delete: solo se escriben con las funciones de abajo.
create policy "ventas_leer"       on public.ventas      for select to authenticated using (true);
create policy "movimientos_leer"  on public.movimientos for select to authenticated using (true);
create policy "actividad_leer"    on public.actividad   for select to authenticated using (true);

-- ---------- 4) FUNCIONES SEGURAS ----------
-- Venta: valida existencias, descuenta stock y registra todo en una sola transacción.
-- Si dos celulares venden la última prenda al mismo tiempo, solo una lo logra (FOR UPDATE).
create or replace function public.registrar_venta(p_items jsonb)
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
  v_id      uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta está vacía';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item->>'cantidad')::int;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad inválida';
    end if;

    select * into v_prod from public.productos
     where id = (v_item->>'producto_id')::uuid
     for update;
    if not found then
      raise exception 'Una prenda ya no existe';
    end if;

    v_idx := null;
    for i in 0 .. coalesce(jsonb_array_length(v_prod.variantes), 0) - 1 loop
      if v_prod.variantes->i->>'talla' = v_item->>'talla'
         and v_prod.variantes->i->>'color' = v_item->>'color' then
        v_idx := i;
        exit;
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
    update public.productos
       set variantes = v_prod.variantes, actualizado_en = now()
     where id = v_prod.id;

    v_total := v_total + v_prod.precio * v_cant;
    v_costo := v_costo + v_prod.costo * v_cant;
    v_lineas := v_lineas || jsonb_build_object(
      'producto_id', v_prod.id, 'nombre', v_prod.nombre,
      'talla', v_item->>'talla', 'color', v_item->>'color',
      'cantidad', v_cant, 'precio', v_prod.precio, 'costo', v_prod.costo);
  end loop;

  insert into public.ventas (usuaria, items, total, costo_total)
  values (v_usuaria, v_lineas, v_total, v_costo)
  returning id into v_id;

  insert into public.actividad (usuaria, texto)
  values (v_usuaria, 'registró una venta por $' || to_char(v_total, 'FM999990.00'));

  return v_id;
end $$;

-- Gastos, compras de mercancía y retiros.
create or replace function public.registrar_movimiento(p_tipo text, p_concepto text, p_monto numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_usuaria text := public.usuaria_actual();
  v_id      uuid;
  v_txt     text;
begin
  if p_tipo not in ('gasto','mercancia','retiro') then
    raise exception 'Tipo de movimiento inválido';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor que cero';
  end if;
  if char_length(trim(coalesce(p_concepto, ''))) = 0 then
    raise exception 'Escribe un concepto';
  end if;

  insert into public.movimientos (usuaria, tipo, concepto, monto)
  values (v_usuaria, p_tipo, left(trim(p_concepto), 200), round(p_monto, 2))
  returning id into v_id;

  v_txt := (case p_tipo
              when 'retiro'    then 'hizo un retiro de $'
              when 'mercancia' then 'registró una compra de mercancía por $'
              else 'registró un gasto por $'
            end) || to_char(p_monto, 'FM999990.00');

  insert into public.actividad (usuaria, texto) values (v_usuaria, v_txt);
  return v_id;
end $$;

-- Solo usuarias autenticadas pueden llamar a estas funciones.
revoke execute on function public.usuaria_actual() from public, anon;
revoke execute on function public.registrar_venta(jsonb) from public, anon;
revoke execute on function public.registrar_movimiento(text, text, numeric) from public, anon;
grant  execute on function public.registrar_venta(jsonb) to authenticated;
grant  execute on function public.registrar_movimiento(text, text, numeric) to authenticated;

-- ---------- 5) TIEMPO REAL (para ver cambios de la otra celular al instante) ----------
-- Si aparece el error "already member of publication", ignóralo.
alter publication supabase_realtime add table public.productos, public.ventas, public.movimientos, public.actividad;

-- ---------- 6) FOTOS ----------
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true)
on conflict (id) do nothing;

create policy "fotos_subir"   on storage.objects for insert to authenticated with check (bucket_id = 'fotos');
create policy "fotos_editar"  on storage.objects for update to authenticated using (bucket_id = 'fotos');
create policy "fotos_borrar"  on storage.objects for delete to authenticated using (bucket_id = 'fotos');

-- =====================================================
-- PASOS EN EL PANEL DE SUPABASE (no van en este archivo):
-- 1) Authentication → Providers → Email: DESACTIVA "Allow new users to sign up".
--    Así nadie puede crear una cuenta desde la app.
-- 2) Authentication → Users → "Add user" → crea las 3 cuentas con su correo y contraseña.
--    Marca "Auto Confirm User".
-- 3) Settings → API: copia la "Project URL" y la clave "anon public" al inicio de index.html.
--    NUNCA pongas la clave "service_role" en la app.
-- =====================================================
