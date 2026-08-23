import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { bs, urlImagen } from '../../lib/formato.js';

// Quita tildes y pasa a minúsculas para buscar sin importar acentos.
function norm(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export default function AdminProductos() {
  const [productos, setProductos] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [eliminando, setEliminando] = useState(false);
  const [eliminandoTodo, setEliminandoTodo] = useState(false);
  const [progreso, setProgreso] = useState(null); // { hechas, total }

  function cargar() {
    fetch('/api/admin/productos')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setProductos)
      .catch(() => setProductos([]));
  }
  useEffect(cargar, []);

  // Coincidencia por nombre (contiene, tolera tildes) o por código (iniciales).
  const q = norm(busqueda).trim();
  const filtrados = !q
    ? productos
    : (productos || []).filter(
        (p) => norm(p.nombre).includes(q) || (p.codigo || '').toLowerCase().startsWith(q)
      );

  function alternar(id) {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  function alternarTodos() {
    if (seleccionados.size === filtrados.length) setSeleccionados(new Set());
    else setSeleccionados(new Set(filtrados.map((p) => p.id)));
  }

  async function eliminarSeleccionadas() {
    const ids = [...seleccionados];
    if (
      !window.confirm(
        `¿Eliminar ${ids.length} prenda(s)? Las que tengan pedidos asociados no se pueden borrar y solo se ocultarán del catálogo.`
      )
    )
      return;
    setEliminando(true);
    setProgreso({ hechas: 0, total: ids.length });
    let borradas = 0;
    let ocultadas = 0;
    let fallidas = 0;
    // Se borra en lotes de 200: cada lote es una llamada rápida y entre lote y
    // lote se actualiza la barra de avance (con miles de prendas, una sola
    // llamada dejaría la pantalla minutos sin responder).
    const TAM_LOTE = 200;
    try {
      for (let i = 0; i < ids.length; i += TAM_LOTE) {
        const r = await fetch('/api/admin/productos/eliminar-lote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: ids.slice(i, i + TAM_LOTE) }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Error al eliminar');
        borradas += data.borradas;
        ocultadas += data.ocultadas;
        fallidas += data.fallidas;
        setProgreso({ hechas: Math.min(i + TAM_LOTE, ids.length), total: ids.length });
      }
    } catch {
      fallidas += ids.length - (borradas + ocultadas + fallidas);
    }
    setSeleccionados(new Set());
    setEliminando(false);
    setProgreso(null);
    window.alert(
      `Listo: ${borradas} eliminada(s)` +
        (ocultadas ? ` · ${ocultadas} con pedidos (solo ocultadas)` : '') +
        (fallidas ? ` · ${fallidas} con error` : '')
    );
    cargar();
  }

  async function eliminarTodas() {
    const confirmacion = window.prompt(
      'Esta accion elimina todas las prendas de la nube. Las prendas con pedidos solo se ocultaran. Escribe BORRAR TODO para continuar:'
    );
    if (confirmacion !== 'BORRAR TODO') return;
    if (!window.confirm('Ultima confirmacion: vaciar el catalogo completo de la nube ahora?')) return;

    setEliminandoTodo(true);
    try {
      const r = await fetch('/api/admin/productos/eliminar-todas', { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al vaciar el catalogo');
      window.alert(
        `Listo: ${data.borradas} eliminada(s)` +
          (data.ocultadas ? ` · ${data.ocultadas} con pedidos (solo ocultadas)` : '') +
          (data.fallidas ? ` · ${data.fallidas} con error` : '')
      );
      setSeleccionados(new Set());
      cargar();
    } catch (error) {
      window.alert(error.message || 'No se pudo vaciar el catalogo');
    } finally {
      setEliminandoTodo(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Prendas</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={eliminarTodas}
            disabled={eliminandoTodo || eliminando}
            className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {eliminandoTodo ? 'Vaciando…' : '🗑 Vaciar nube'}
          </button>
          <Link
            to="nuevo"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            + Nueva prenda
          </Link>
        </div>
      </div>

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="🔍 Buscar por nombre o código (ej: pant, 00042)…"
        className="mb-4 w-full rounded-lg border px-3 py-2 text-sm"
      />

      {!productos ? (
        <p className="py-10 text-center text-gray-500">Cargando…</p>
      ) : productos.length === 0 ? (
        <p className="py-10 text-center text-gray-500">
          Aún no hay prendas. Crea la primera con "+ Nueva prenda".
        </p>
      ) : filtrados.length === 0 ? (
        <p className="py-10 text-center text-gray-500">
          Ninguna prenda coincide con "{busqueda}".
        </p>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={filtrados.length > 0 && seleccionados.size === filtrados.length}
                onChange={alternarTodos}
              />
              Marcar todas ({filtrados.length})
            </label>
            {seleccionados.size > 0 && (
              <button
                onClick={eliminarSeleccionadas}
                disabled={eliminando}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {eliminando ? 'Eliminando…' : `🗑 Eliminar marcadas (${seleccionados.size})`}
              </button>
            )}
          </div>
          {progreso && (
            <div className="mb-3">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-red-500 transition-all"
                  style={{ width: `${Math.round((progreso.hechas / progreso.total) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-600">
                Eliminando {progreso.hechas} de {progreso.total} (
                {Math.round((progreso.hechas / progreso.total) * 100)}%) — no cierres esta página
              </p>
            </div>
          )}
          <ul className="space-y-2">
            {filtrados.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={seleccionados.has(p.id)}
                  onChange={() => alternar(p.id)}
                  className="h-4 w-4 shrink-0"
                />
                <Link
                  to={String(p.id)}
                  className="flex flex-1 items-center gap-3 rounded-xl bg-gray-100 p-3 shadow hover:shadow-md"
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {p.imagen ? (
                      <img src={urlImagen(p.imagen)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xl text-gray-300">👗</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {p.nombre}
                      {!p.activo && (
                        <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
                          Inactiva
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {p.codigo && <span className="mr-1 font-mono">{p.codigo} ·</span>}
                      {p.categoria || 'Sin categoría'} · Stock: {p.stock_total}
                    </p>
                  </div>
                  <span className="font-bold">{bs(p.precio)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
