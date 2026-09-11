import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { bs, urlImagen } from '../../lib/formato.js';
import { cargarCatalogo, eliminarLotes, describirResultado } from '../../lib/eliminarProductos.js';

// Quita tildes y pasa a minúsculas para buscar sin importar acentos.
function norm(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// ¿El término es una etiqueta física (1 a 5 dígitos)? Misma regla estricta que
// la nube (functions/lib/codigo.js::normalizarEtiqueta).
function esEtiqueta(texto) {
  return /^\d{1,5}$/.test((texto || '').trim());
}

export default function AdminProductos() {
  const [productos, setProductos] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [etiqueta, setEtiqueta] = useState(null); // respuesta de /api/admin/etiquetas
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [eliminando, setEliminando] = useState(false);
  const [pendientes, setPendientes] = useState([]);
  const [progreso, setProgreso] = useState(null); // { hechas, total }

  function cargar() {
    setErrorCarga('');
    cargarCatalogo()
      .then(setProductos)
      .catch(error => setErrorCarga(error.message));
  }
  useEffect(cargar, []);

  // Etiqueta física primero: si el término son dígitos, se consulta la nube
  // (product_etiquetas) antes de filtrar por nombre/código de modelo.
  useEffect(() => {
    const termino = busqueda.trim();
    if (!esEtiqueta(termino)) {
      setEtiqueta(null);
      return;
    }
    let vigente = true;
    const t = setTimeout(() => {
      fetch(`/api/admin/etiquetas?q=${encodeURIComponent(termino)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((r) => vigente && setEtiqueta(r))
        .catch(() => vigente && setEtiqueta(null));
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [busqueda]);

  // Coincidencia por nombre (contiene, tolera tildes) o por código (iniciales).
  const q = norm(busqueda).trim();
  const etiquetaResuelta =
    etiqueta && (etiqueta.tipo === 'etiqueta' || etiqueta.tipo === 'etiqueta_conflicto') ? etiqueta : null;
  const idsEtiqueta = new Set((etiquetaResuelta?.productos || []).map((p) => p.id));
  const filtrados = !q
    ? productos
    : etiquetaResuelta
      ? (productos || []).filter((p) => idsEtiqueta.has(p.id))
      : (productos || []).filter(
          (p) => norm(p.nombre).includes(q) || (p.codigo || '').toLowerCase().startsWith(q)
        );
  const disponiblePorId = new Map((etiquetaResuelta?.productos || []).map((p) => [p.id, p.disponible]));

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

  async function eliminarPorLotes(ids) {
    setPendientes([]);
    try {
      return await eliminarLotes(ids, { onProgreso: setProgreso });
    } catch (error) {
      setPendientes(error.pendientes || ids);
      throw error;
    } finally {
      setProgreso(null);
    }
  }

  async function reintentarPendientes() {
    if (!window.confirm('¿Reintentar únicamente los productos pendientes de confirmar?')) return;
    setEliminando(true);
    try {
      window.alert(describirResultado(await eliminarPorLotes(pendientes)));
      setSeleccionados(new Set());
    } catch (error) {
      window.alert(error.message);
    } finally {
      cargar();
      setEliminando(false);
    }
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
    try {
      const resultado = await eliminarPorLotes(ids);
      setSeleccionados(new Set());
      window.alert(describirResultado(resultado));
      cargar();
    } catch (error) {
      window.alert(error.message || 'No se pudo eliminar');
      cargar();
    } finally {
      setEliminando(false);
    }
  }

  // "Vaciar nube" se retiró el 11/09/2026: era temporal para las pruebas y un
  // vaciado a mitad de una sesión de sync dejaba la nube incoherente. El POS es
  // la autoridad: `finalizar` desactiva lo que no llega en cada snapshot.

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Prendas</h1>
        <div className="flex items-center gap-2">
          <Link
            to="nuevo"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            + Nueva prenda
          </Link>
        </div>
      </div>

      {pendientes.length > 0 && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p>Quedan {pendientes.length} productos pendientes de confirmar. Algunos pueden haberse procesado.</p>
          <button onClick={reintentarPendientes} disabled={eliminando}
            className="mt-2 rounded border px-3 py-2 disabled:opacity-50">
            Reintentar pendientes
          </button>
        </div>
      )}

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="🔍 Buscar por etiqueta física, código o nombre (ej: 02797, 00042, pant)…"
        className="mb-2 w-full rounded-lg border px-3 py-2 text-sm"
      />

      {/* Resolución de etiqueta física (código de UNIDAD del POS ≠ código de modelo) */}
      {etiquetaResuelta?.tipo === 'etiqueta' && (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          🏷 Etiqueta <span className="font-mono font-semibold">{etiquetaResuelta.etiqueta}</span> →{' '}
          <span className="font-semibold">{etiquetaResuelta.productos[0].nombre}</span>
          {etiquetaResuelta.productos[0].codigo && (
            <>
              {' '}
              (código de modelo <span className="font-mono">{etiquetaResuelta.productos[0].codigo}</span>)
            </>
          )}
          {' · '}
          {etiquetaResuelta.productos[0].disponible ? 'unidad disponible' : 'unidad VENDIDA según el POS'}
          {!etiquetaResuelta.productos[0].activo && ' · prenda inactiva'}
        </p>
      )}
      {etiquetaResuelta?.tipo === 'etiqueta_conflicto' && (
        <p className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
          ⚠ Conflicto: la etiqueta <span className="font-mono font-semibold">{etiquetaResuelta.etiqueta}</span>{' '}
          está en {etiquetaResuelta.productos.length} prendas del POS. No se elige ninguna: repara las etiquetas
          duplicadas en el POS (Etiquetado → sanear códigos) y vuelve a sincronizar.
        </p>
      )}
      {etiqueta?.tipo === 'ninguna' && (
        <p className="mb-3 text-xs text-gray-500">
          Ninguna etiqueta física <span className="font-mono">{etiqueta.etiqueta}</span> registrada; se busca por
          código de modelo y nombre.
        </p>
      )}

      {errorCarga ? (
        <p className="py-4 text-red-700" role="alert">No se pudo actualizar el catálogo: {errorCarga}
          <button onClick={cargar} className="ml-2 underline">Reintentar carga</button>
        </p>
      ) : !productos ? (
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
                      {etiquetaResuelta && idsEtiqueta.has(p.id) && (
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 font-mono ${
                            disponiblePorId.get(p.id) ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          🏷 {etiquetaResuelta.etiqueta}
                          {disponiblePorId.get(p.id) ? '' : ' vendida'}
                        </span>
                      )}
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
