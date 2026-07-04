import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function Catalogo() {
  const [productos, setProductos] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/productos')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setProductos)
      .catch(() => setError(true));
  }, []);

  if (error)
    return (
      <p className="py-10 text-center text-gray-500">
        El catálogo aún no está disponible. (La base de datos se conecta al desplegar en
        Cloudflare.)
      </p>
    );

  if (!productos) return <p className="py-10 text-center text-gray-500">Cargando catálogo…</p>;

  if (productos.length === 0)
    return <p className="py-10 text-center text-gray-500">Pronto tendremos prendas disponibles.</p>;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {productos.map((p) => (
        <Link
          key={p.id}
          to={`/producto/${p.id}`}
          className="rounded-xl bg-white p-3 shadow transition hover:shadow-md"
        >
          <div className="mb-2 aspect-square rounded-lg bg-gray-100" />
          <h2 className="text-sm font-medium">{p.nombre}</h2>
          <p className="font-bold">Bs {p.precio}</p>
        </Link>
      ))}
    </div>
  );
}
