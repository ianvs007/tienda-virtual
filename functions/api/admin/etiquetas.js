// GET /api/admin/etiquetas?q=02797 — resuelve una etiqueta física (código de
// UNIDAD del POS) a su(s) prenda(s), incluyendo inactivas. Responde:
//   { tipo: 'no_es_etiqueta' | 'ninguna' | 'etiqueta' | 'etiqueta_conflicto',
//     etiqueta, productos: [{ id, nombre, codigo, activo, disponible, global_id }] }
// El admin usa esto en el buscador de Prendas antes de filtrar por nombre/código.
import { buscarPorEtiqueta } from '../../lib/etiquetas.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const r = await buscarPorEtiqueta(env, q, { soloActivos: false });
  return Response.json(r);
}
