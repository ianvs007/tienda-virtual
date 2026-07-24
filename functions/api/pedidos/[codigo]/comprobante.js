// POST /api/pedidos/:codigo/comprobante — el cliente sube la foto de su pago.
// La imagen va a R2 (carpeta privada "comprobantes/") y el pedido pasa a "comprobante_subido".
import { excedeLimite } from '../../../lib/limite.js';

const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function onRequestPost({ env, params, request }) {
  const codigo = String(params.codigo || '');
  if (!/^[a-f0-9]{32}$/.test(codigo))
    return Response.json({ error: 'Código inválido' }, { status: 400 });

  const pedido = await env.DB.prepare(
    'SELECT id, estado, comprobante_r2_key FROM orders WHERE codigo = ?'
  )
    .bind(codigo)
    .first();
  if (!pedido) return Response.json({ error: 'Pedido no encontrado' }, { status: 404 });
  if (!['pendiente_pago', 'comprobante_subido'].includes(pedido.estado))
    return Response.json({ error: 'Este pedido ya fue procesado' }, { status: 409 });

  // Freno básico contra subidas masivas.
  if (await excedeLimite(env, request, 'comprobante', 30))
    return Response.json(
      { error: 'Demasiados intentos seguidos. Espera un rato e intenta de nuevo.' },
      { status: 429 }
    );

  let archivo;
  try {
    archivo = (await request.formData()).get('archivo');
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  if (!archivo || typeof archivo === 'string')
    return Response.json({ error: 'Adjunta la foto del comprobante' }, { status: 400 });
  const ext = TIPOS[archivo.type];
  if (!ext)
    return Response.json({ error: 'Solo se aceptan imágenes JPG, PNG o WebP' }, { status: 400 });
  if (archivo.size > MAX_BYTES)
    return Response.json({ error: 'La imagen no debe superar 5 MB' }, { status: 400 });

  const key = `comprobantes/${codigo}-${Date.now()}.${ext}`;
  await env.FOTOS.put(key, archivo.stream(), {
    httpMetadata: { contentType: archivo.type },
  });

  await env.DB.prepare(
    `UPDATE orders SET comprobante_r2_key = ?, estado = 'comprobante_subido' WHERE codigo = ?`
  )
    .bind(key, codigo)
    .run();

  // Si re-subió el comprobante, borra la foto anterior para no acumular basura en R2.
  if (pedido.comprobante_r2_key && pedido.comprobante_r2_key !== key)
    await env.FOTOS.delete(pedido.comprobante_r2_key);

  return Response.json({ ok: true, estado: 'comprobante_subido' });
}
