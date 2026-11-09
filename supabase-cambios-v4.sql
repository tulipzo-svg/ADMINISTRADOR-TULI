-- =====================================================
-- VALLERY · Cambios v4: capital de afuera, tasa BCV, recordatorios y notas
-- Ejecutar DESPUÉS de supabase-schema.sql, supabase-cambios-v2.sql y supabase-cambios-v3.sql
-- =====================================================

-- ---------- 1) CAPITAL DE AFUERA (entra a la caja, NO es ganancia) ----------
alter table public.movimientos drop constraint if exists movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check
  check (tipo in ('gasto','mercancia','retiro','capital'));

create or replace function public.registrar_movimiento(p_tipo text, p_concepto text, p_monto numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_usuaria text := public.usuaria_actual();
  v_id      uuid;
  v_txt     text;
begin
  if p_tipo not in ('gasto','mercancia','retiro','capital') then
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
              when 'capital'   then 'inyectó capital de afuera por $'
              else 'registró un gasto por $'
            end) || to_char(p_monto, 'FM999990.00');

  insert into public.actividad (usuaria, texto) values (v_usuaria, v_txt);
  return v_id;
end $$;

revoke execute on function public.registrar_movimiento(text, text, numeric) from public, anon;
grant  execute on function public.registrar_movimiento(text, text, numeric) to authenticated;

-- ---------- 2) TASA BCV (una por día; se registra a mano cada día) ----------
create table if not exists public.tasas (
  fecha     date primary key,
  valor     numeric(14,4) not null check (valor > 0),
  usuaria   text not null default public.usuaria_actual(),
  creado_en timestamptz not null default now()
);

alter table public.tasas enable row level security;
create policy "tasas_leer"    on public.tasas for select to authenticated using (true);
create policy "tasas_guardar" on public.tasas for insert to authenticated with check (usuaria = public.usuaria_actual());
create policy "tasas_editar"  on public.tasas for update to authenticated using (true) with check (true);

-- ---------- 3) RECORDATORIOS DE COBROS Y PAGOS ----------
create table if not exists public.recordatorios (
  id        uuid primary key default gen_random_uuid(),
  usuaria   text not null default public.usuaria_actual(),
  tipo      text not null check (tipo in ('cobro','pago','otro')),
  texto     text not null check (char_length(texto) between 1 and 200),
  monto     numeric(10,2) check (monto is null or monto >= 0),
  hecho     boolean not null default false,
  creado_en timestamptz not null default now()
);

alter table public.recordatorios enable row level security;
create policy "recordatorios_leer"   on public.recordatorios for select to authenticated using (true);
create policy "recordatorios_crear"  on public.recordatorios for insert to authenticated with check (usuaria = public.usuaria_actual());
create policy "recordatorios_editar" on public.recordatorios for update to authenticated using (true) with check (true);
create policy "recordatorios_borrar" on public.recordatorios for delete to authenticated using (true);

-- ---------- 4) NOTAS RÁPIDAS ----------
create table if not exists public.notas (
  id        uuid primary key default gen_random_uuid(),
  usuaria   text not null default public.usuaria_actual(),
  texto     text not null check (char_length(texto) between 1 and 300),
  hecha     boolean not null default false,
  creado_en timestamptz not null default now()
);

alter table public.notas enable row level security;
create policy "notas_leer"   on public.notas for select to authenticated using (true);
create policy "notas_crear"  on public.notas for insert to authenticated with check (usuaria = public.usuaria_actual());
create policy "notas_editar" on public.notas for update to authenticated using (true) with check (true);
create policy "notas_borrar" on public.notas for delete to authenticated using (true);

-- ---------- 5) TIEMPO REAL para las tablas nuevas ----------
-- Si aparece "already member of publication", ignóralo.
alter publication supabase_realtime add table public.tasas, public.recordatorios, public.notas;
