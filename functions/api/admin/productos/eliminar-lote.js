// Operación acotada e idempotente. El middleware /admin exige sesión.
export const MAX_IDS = 20;

export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Solicitud inválida' }, { status: 400 }); }
  if (!Array.isArray(body?.ids) || !body.ids.length || body.ids.length > MAX_IDS ||
      body.ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return Response.json({ error: `Envía entre 1 y ${MAX_IDS} ids enteros positivos por lote.` }, { status: 400 });
  }
  const ids = [...new Set(body.ids)];
  const marcas = ids.map(() => '?').join(',');
  // También protege referencias a una variante, aunque el product_id del ítem difiera.
  const protegido = `EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = products.id)
    OR EXISTS (SELECT 1 FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id
               WHERE v.product_id = products.id)`;
  try {
    // D1 batch ejecuta estas consultas en una transacción: no hay clasificación
    // fuera de la transacción ni borrados parciales dentro de este lote.
    const [existentes, protegidas, ocultadas, borradas] = await env.DB.batch([
      env.DB.prepare(`SELECT id FROM products WHERE id IN (${marcas})`).bind(...ids),
      env.DB.prepare(`SELECT id FROM products WHERE id IN (${marcas}) AND (${protegido})`).bind(...ids),
      env.DB.prepare(`UPDATE products SET activo = 0 WHERE id IN (${marcas}) AND activo != 0 AND (${protegido})`).bind(...ids),
      env.DB.prepare(`DELETE FROM products WHERE id IN (${marcas}) AND NOT (${protegido})`).bind(...ids),
    ]);
    const nOcultadas = Number(ocultadas.meta?.changes || 0);
    return Response.json({
      ok: true, borradas: Number(borradas.meta?.changes || 0),
      ocultadas: nOcultadas,
      yaOcultadas: protegidas.results.length - nOcultadas,
      inexistentes: ids.length - existentes.results.length,
      fallidas: 0,
    });
  } catch (error) {
    const referencia = crypto.randomUUID();
    console.error('Error al eliminar lote', { referencia, error });
    return Response.json({
      error: 'No se pudo completar el lote. Reintenta los pendientes.',
      referencia,
    }, { status: 500 });
  }
}
