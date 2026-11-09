-- =====================================================
-- VALLERY · Cambios v5: solo dos accesos (Rosainer y Vallery) e inventario inicial
-- Ejecutar DESPUÉS de supabase-schema.sql, v2, v3 y v4.
-- =====================================================

-- ---------- 1) ACCESOS: solo Rosainer y Vallery ----------
-- La cuenta "General" deja de tener acceso. Puedes borrarla en Authentication → Users.
create or replace function public.usuaria_actual()
returns text language plpgsql stable security definer set search_path = public as $$
declare v_nombre text;
begin
  v_nombre := case lower(coalesce(auth.jwt() ->> 'email', ''))
    when 'rosainernaz026@tuli.com' then 'Rosainer'
    when 'valleryraz029@tuli.com'   then 'Vallery'
    else null
  end;
  if v_nombre is null then
    raise exception 'Cuenta no autorizada';
  end if;
  return v_nombre;
end $$;

-- ---------- 2) INVENTARIO INICIAL / CONTEO FÍSICO ----------
-- Reemplaza las existencias por el conteo real. NO toca la caja ni las ventas.
-- p_productos: [{"id":"<uuid>","stocks":[3,0,2]}]  (un número por variante, en el mismo orden)
-- p_empaques:  [{"id":"bolsa_mediana","cantidad":10}]
create or replace function public.ajustar_inventario(p_productos jsonb, p_empaques jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p     jsonb;
  v_prod  public.productos%rowtype;
  v_vars  jsonb;
  v_i     int;
  v_stock int;
  v_e     jsonb;
  v_n     int;
begin
  perform public.usuaria_actual();   -- solo cuentas autorizadas

  for v_p in select * from jsonb_array_elements(coalesce(p_productos, '[]'::jsonb)) loop
    select * into v_prod from public.productos
     where id = (v_p->>'id')::uuid
     for update;
    if not found then
      raise exception 'Una prenda ya no existe';
    end if;
    if jsonb_array_length(v_p->'stocks') <> jsonb_array_length(v_prod.variantes) then
      raise exception 'Las variantes de % no coinciden', v_prod.nombre;
    end if;

    v_vars := v_prod.variantes;
    for v_i in 0 .. jsonb_array_length(v_vars) - 1 loop
      v_stock := (v_p->'stocks'->>v_i)::int;
      if v_stock is null or v_stock < 0 then
        raise exception 'Existencias inválidas para %', v_prod.nombre;
      end if;
      v_vars := jsonb_set(v_vars, array[v_i::text, 'stock'], to_jsonb(v_stock));
    end loop;

    update public.productos
       set variantes = v_vars, actualizado_en = now()
     where id = v_prod.id;
  end loop;

  for v_e in select * from jsonb_array_elements(coalesce(p_empaques, '[]'::jsonb)) loop
    v_n := (v_e->>'cantidad')::int;
    if v_n is null or v_n < 0 then
      raise exception 'Cantidad de empaque inválida';
    end if;
    update public.empaques set cantidad = v_n where id = v_e->>'id';
    if not found then
      raise exception 'Empaque no válido';
    end if;
  end loop;
end $$;

revoke execute on function public.ajustar_inventario(jsonb, jsonb) from public, anon;
grant  execute on function public.ajustar_inventario(jsonb, jsonb) to authenticated;
