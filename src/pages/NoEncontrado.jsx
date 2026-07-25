import { Link } from 'react-router-dom';

export default function NoEncontrado() {
  return (
    <div className="py-16 text-center">
      <p className="text-6xl font-bold text-gray-300">404</p>
      <h1 className="mt-2 text-xl font-semibold">Página no encontrada</h1>
      <p className="mt-2 text-sm text-gray-500">
        La dirección que buscas no existe o ya no está disponible.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-lg bg-gray-900 px-4 py-2 text-white hover:bg-gray-700"
      >
        Volver al catálogo
      </Link>
    </div>
  );
}
