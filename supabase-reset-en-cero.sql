-- =====================================================
-- VALLERY · Dejar la base de datos en cero
-- ⚠️ BORRA: ventas, tandas (lotes), caja, actividad, tasas, recordatorios y notas.
-- ✅ CONSERVA: el catálogo (nombres, precios, fotos) y las cuentas de acceso.
-- Pon las existencias de prendas y empaques en cero para cargar el inventario real
-- con el botón "Inventario inicial".
-- Ejecutar UNA SOLA VEZ, después de supabase-cambios-v5.sql, y solo si quieres borrar los datos de prueba.
-- Nota: los Excel de tandas quedan en Storage → tandas, pero ya no se usan.
--       Puedes borrarlos desde el panel de Supabase si quieres.
-- =====================================================

begin;

delete from public.ventas;
delete from public.movimientos;
delete from public.lotes;
delete from public.actividad;
delete from public.tasas;
delete from public.recordatorios;
delete from public.notas;

update public.empaques set cantidad = 0;

update public.productos p
   set variantes = (
     select coalesce(jsonb_agg(jsonb_set(v, '{stock}', '0'::jsonb)), '[]'::jsonb)
       from jsonb_array_elements(p.variantes) v
   ),
   actualizado_en = now();

commit;
