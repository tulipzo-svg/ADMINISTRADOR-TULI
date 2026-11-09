-- =====================================================
-- VALLERY · Cambios v6: perfil de cada usuaria (foto, emoji, color, frase, pantalla, modo privado)
-- Ejecutar DESPUÉS de v2, v3, v4 y v5.
-- La foto de perfil se guarda en Storage → fotos → perfiles/ (usa las reglas que ya existen).
-- =====================================================

create table if not exists public.perfiles (
  usuaria        text primary key,
  foto_url       text,
  emoji          text not null default '🌷' check (char_length(emoji) between 1 and 8),
  color          text not null default '#A0022E' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  frase          text not null default '' check (char_length(frase) <= 60),
  pantalla       text not null default 'inicio'
                   check (pantalla in ('inicio','venta','inventario','compras','caja','notas','analitica')),
  ocultar_montos boolean not null default false,
  actualizado_en timestamptz not null default now()
);

alter table public.perfiles enable row level security;

-- Todas ven los perfiles (para mostrar la foto de cada una);
-- cada una solo puede crear o cambiar SU propio perfil.
create policy "perfiles_leer"   on public.perfiles for select to authenticated using (true);
create policy "perfiles_crear"  on public.perfiles for insert to authenticated with check (usuaria = public.usuaria_actual());
create policy "perfiles_editar" on public.perfiles for update to authenticated
  using (usuaria = public.usuaria_actual()) with check (usuaria = public.usuaria_actual());

-- Tiempo real para ver el cambio de foto al instante en el otro celular
alter publication supabase_realtime add table public.perfiles;
