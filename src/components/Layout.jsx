import { Link, Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 bg-white shadow">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-xl font-bold tracking-tight">
            Tienda Virtual
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/" className="hover:underline">
              Catálogo
            </Link>
            <Link
              to="/carrito"
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-white hover:bg-gray-700"
            >
              🛒 Carrito
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="mt-10 border-t bg-white py-6 text-center text-sm text-gray-500">
        Compra fácil: elige tus prendas, paga con QR y coordinamos tu entrega por WhatsApp.
      </footer>
    </div>
  );
}
