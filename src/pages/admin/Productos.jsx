import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { bs, urlImagen } from '../../lib/formato.js';

export default function AdminProductos() {
  const [productos, setProductos] = useState(null);

  useEffect(() => {
    fetch('/api/admin/productos')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setProductos)
      .catch(() => setProductos([]));
  }, []);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Prendas</h1>
        <Link
          to="nuevo"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          + Nueva prenda
        </Link>
      </div>

      {!productos ? (
        <p className="py-10 text-center text-gray-500">Cargando…</p>
      ) : productos.length === 0 ? (
        <p className="py-10 text-center text-gray-500">
          Aún no hay prendas. Crea la primera con "+ Nueva prenda".
        </p>
      ) : (
        <ul className="space-y-2">
          {productos.map((p) => (
            <li key={p.id}>
              <Link
                to={String(p.id)}
                className="flex items-center gap-3 rounded-xl bg-white p-3 shadow hover:shadow-md"
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
                    {p.categoria || 'Sin categoría'} · Stock: {p.stock_total}
                  </p>
                </div>
                <span className="font-bold">{bs(p.precio)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
