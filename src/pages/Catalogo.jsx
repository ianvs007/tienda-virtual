import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { bs, urlImagen } from '../lib/formato.js';

export default function Catalogo() {
  const [productos, setProductos] = useState(null);
  const [categorias, setCategorias] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/categorias')
      .then((r) => (r.ok ? r.json() : []))
      .then(setCategorias)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setProductos(null);
    fetch(filtro ? `/api/productos?categoria=${filtro}` : '/api/productos')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setProductos)
      .catch(() => setError(true));
  }, [filtro]);

  if (error)
    return <p className="py-10 text-center text-gray-500">El catálogo no está disponible ahora. Intenta de nuevo en unos minutos.</p>;

  return (
    <div>
      {categorias.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            onClick={() => setFiltro('')}
            className={`rounded-full px-4 py-1.5 text-sm ${
              filtro === '' ? 'bg-gray-900 text-white' : 'bg-white shadow hover:bg-gray-100'
            }`}
          >
            Todo
          </button>
          {categorias.map((c) => (
            <button
              key={c.id}
              onClick={() => setFiltro(String(c.id))}
              className={`rounded-full px-4 py-1.5 text-sm ${
                filtro === String(c.id) ? 'bg-gray-900 text-white' : 'bg-white shadow hover:bg-gray-100'
              }`}
            >
              {c.nombre}
            </button>
          ))}
        </div>
      )}

      {!productos ? (
        <p className="py-10 text-center text-gray-500">Cargando catálogo…</p>
      ) : productos.length === 0 ? (
        <p className="py-10 text-center text-gray-500">Pronto tendremos prendas disponibles.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {productos.map((p) => (
            <Link
              key={p.id}
              to={`/producto/${p.id}`}
              className="group overflow-hidden rounded-xl bg-white shadow transition hover:shadow-md"
            >
              <div className="relative aspect-square bg-gray-100">
                {p.imagen ? (
                  <img
                    src={urlImagen(p.imagen)}
                    alt={p.nombre}
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-4xl text-gray-300">👗</div>
                )}
                {p.stock_total === 0 && (
                  <span className="absolute top-2 left-2 rounded bg-gray-900/80 px-2 py-0.5 text-xs text-white">
                    Agotado
                  </span>
                )}
              </div>
              <div className="p-3">
                <h2 className="truncate text-sm font-medium">{p.nombre}</h2>
                <p className="font-bold">{bs(p.precio)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
