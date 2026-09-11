export const TAM_LOTE = 20;
const campos = ['borradas', 'ocultadas', 'yaOcultadas', 'inexistentes', 'fallidas'];

export async function leerJson(respuesta) {
  const referencia = respuesta.headers.get('cf-ray');
  const contexto = `HTTP ${respuesta.status}${referencia ? ` · referencia ${referencia}` : ''}`;
  let datos;
  try { datos = JSON.parse(await respuesta.text()); }
  catch { throw new Error(`Respuesta no JSON (${contexto}). No se pudo confirmar el resultado de esta petición.`); }
  if (!respuesta.ok) {
    throw new Error(`${datos?.error || 'Error del servidor'} (${contexto}${datos?.referencia ? ` · diagnóstico ${datos.referencia}` : ''}).`);
  }
  return datos;
}

export async function cargarCatalogo(fetchImpl = fetch) {
  const datos = await leerJson(await fetchImpl('/api/admin/productos'));
  if (!Array.isArray(datos)) throw new Error('La respuesta del catálogo no es una lista válida.');
  return datos;
}

export async function eliminarLotes(ids, { fetchImpl = fetch, onProgreso = () => {} } = {}) {
  const unicos = [...new Set(ids)];
  const resumen = Object.fromEntries(campos.map(c => [c, 0]));
  let hechas = 0;
  onProgreso({ hechas, total: unicos.length });
  for (let i = 0; i < unicos.length; i += TAM_LOTE) {
    const lote = unicos.slice(i, i + TAM_LOTE);
    try {
      const datos = await leerJson(await fetchImpl('/api/admin/productos/eliminar-lote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: lote }),
      }));
      if (!datos?.ok || campos.some(c => !Number.isSafeInteger(datos[c]) || datos[c] < 0) ||
          campos.reduce((n, c) => n + datos[c], 0) !== lote.length || datos.fallidas) {
        throw new Error('El servidor no confirmó todos los resultados del lote.');
      }
      for (const c of campos) resumen[c] += datos[c];
      hechas += lote.length;
      onProgreso({ hechas, total: unicos.length });
    } catch (causa) {
      const error = new Error(`${causa.message} Confirmados: ${hechas} de ${unicos.length}. El lote actual puede haberse aplicado; reintentarlo no duplica el borrado.`);
      error.pendientes = unicos.slice(i);
      error.resumen = { ...resumen };
      throw error;
    }
  }
  return resumen;
}

export function describirResultado(r) {
  return `Listo: ${r.borradas} eliminada(s), ${r.ocultadas} ocultada(s) por pedidos, ${r.yaOcultadas} ya ocultada(s) y ${r.inexistentes} ya inexistente(s).`;
}
