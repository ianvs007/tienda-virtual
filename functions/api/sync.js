// POST /api/sync — sincronización directa de stock desde el POS (sin Excel).
// Endpoint machine-to-machine: NO pasa por el middleware de /api/admin, se
// autentica con el token de settings.sync_token (Bearer).
// Body: { filas: [{ codigo, nombre, talla, color, stock, precio }] }.
// 1) Las filas cuyo código NO existe en la web se CREAN como prenda nueva
//    (misma lógica que la importación de catálogo): así el mismo clic sirve
//    para la carga inicial y para subir prendas nuevas creadas en el POS.
// 2) El resto sigue el flujo de sincronización de stock (functions/api/admin/
//    sincronizar/index.js), más las ventas en línea capturadas ANTES de
//    aplicar, para que el POS las descuente localmente.
import {
  calcularSincronizacion,
  validarTokenSync,
  ventasEnLineaDesde,
  ventasParaPOS,
} from '../lib/sincronizar.js';
import { sentenciaLogStock } from '../lib/stockLog.js';
import { aplicarImportacionCatalogo } from '../lib/catalogo.js';
import { jsonSync, preflightSync } from '../lib/cors.js';

const MAX_FILAS = 5000;

// Preflight CORS: el POS es una app local (otro origen) y el navegador lo
// exige antes del POST con Authorization.
export function onRequestOptions() {
  return preflightSync();
}

export async function onRequestPost({ env, request }) {
  const rechazo = await validarTokenSync(env, request);
  if (rechazo) return rechazo;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonSync({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const filas = Array.isArray(body.filas) ? body.filas : [];
  if (filas.length === 0 || filas.length > MAX_FILAS)
    return jsonSync({ error: 'El cuerpo no tiene filas válidas (1 a 5000)' }, { status: 400 });

  // El POS trocea el inventario para mostrar avance; solo el ÚLTIMO lote llega
  // con finalizar: true. Mientras tanto NO se toca settings.ultima_sincronizacion:
  // así todos los lotes calculan con la misma ventana de ventas [desde, ahora)
  // y las ventas en línea se capturan una sola vez, al final.
  const finalizar = body.finalizar !== false;

  // 1) Crear las prendas que aún no existen en la web (omite las existentes
  //    sin tocarlas; solo crea filas con nombre y precio válidos).
  const importacion = await aplicarImportacionCatalogo(env, filas);
  const avisosImportacion = importacion.detalle.filter(
    (d) => d.aviso && !d.aviso.startsWith('Código ya existe')
  );

  // 2) Sincronizar stock de TODO (las recién creadas quedan igual: su stock
  //    inicial ya es el del POS y no tienen ventas en línea).
  const { desde, resultado } = await calcularSincronizacion(env, filas);

  // Las ventas se capturan solo en el lote final y ANTES de aplicar: usan la
  // misma ventana [desde, ahora) con la que se calculó el stock, así el POS
  // descuenta exactamente lo que la nube ya descontó.
  const ventas = finalizar ? ventasParaPOS(await ventasEnLineaDesde(env, desde)) : [];

  const cambios = resultado.filter((r) => r.varianteId && r.stockNuevo !== r.stockActual);
  const sentencias = cambios.map((r) =>
    env.DB.prepare('UPDATE product_variants SET stock = ? WHERE id = ?').bind(
      r.stockNuevo,
      r.varianteId
    )
  );
  // Auditoría: cada variante ajustada por la sincronización.
  for (const r of cambios) {
    sentencias.push(
      sentenciaLogStock(env, {
        variantId: r.varianteId,
        codigo: r.codigo,
        nombre: r.nombre || '',
        talla: r.talla,
        color: r.color,
        anterior: r.stockActual,
        nuevo: r.stockNuevo,
        origen: 'sincronizacion',
      })
    );
  }
  if (finalizar) {
    sentencias.push(
      env.DB.prepare(
        `UPDATE settings SET valor = datetime('now') WHERE clave = 'ultima_sincronizacion'`
      )
    );
  }
  // Un lote intermedio sin cambios dejaría el batch vacío y D1 lanza (1101).
  if (sentencias.length > 0) await env.DB.batch(sentencias);

  return jsonSync({
    ok: true,
    filas: resultado.length,
    creadas: importacion.creadas,
    avisosImportacion,
    actualizadas: cambios.length,
    advertencias: resultado.filter((r) => r.aviso).length,
    // Problemas graves de códigos (el POS los muestra en rojo y los resuelve):
    duplicados: resultado.filter((r) => r.duplicado),
    cruces: resultado.filter((r) => r.cruce),
    detalle: resultado,
    ultima_sincronizacion: desde,
    ventas,
  });
}
