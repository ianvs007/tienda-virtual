import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AdminLogin from './admin/Login.jsx';
import AdminLayout from './admin/Layout.jsx';
import AdminPedidos from './admin/Pedidos.jsx';
import AdminProductos from './admin/Productos.jsx';
import AdminProductoForm from './admin/ProductoForm.jsx';
import AdminAjustes from './admin/Ajustes.jsx';
import AdminSincronizar from './admin/Sincronizar.jsx';

export default function Admin() {
  // null = comprobando sesión · false = sin sesión · string = email conectado
  const [sesion, setSesion] = useState(null);

  useEffect(() => {
    fetch('/api/admin/yo')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSesion(d.email))
      .catch(() => setSesion(false));
  }, []);

  if (sesion === null)
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-500">
        Cargando…
      </div>
    );

  if (sesion === false) return <AdminLogin onIngreso={setSesion} />;

  return (
    <Routes>
      <Route element={<AdminLayout email={sesion} onSalir={() => setSesion(false)} />}>
        <Route index element={<Navigate to="/admin/pedidos" replace />} />
        <Route path="pedidos" element={<AdminPedidos />} />
        <Route path="productos" element={<AdminProductos />} />
        <Route path="productos/nuevo" element={<AdminProductoForm />} />
        <Route path="productos/:id" element={<AdminProductoForm />} />
        <Route path="sincronizar" element={<AdminSincronizar />} />
        <Route path="ajustes" element={<AdminAjustes />} />
        <Route path="*" element={<Navigate to="/admin/pedidos" replace />} />
      </Route>
    </Routes>
  );
}
