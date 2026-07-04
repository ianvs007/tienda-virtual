import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Catalogo from './pages/Catalogo.jsx';
import Producto from './pages/Producto.jsx';
import Carrito from './pages/Carrito.jsx';
import Checkout from './pages/Checkout.jsx';
import Pedido from './pages/Pedido.jsx';
import Admin from './pages/Admin.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Catalogo />} />
        <Route path="/producto/:id" element={<Producto />} />
        <Route path="/carrito" element={<Carrito />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/pedido/:codigo" element={<Pedido />} />
      </Route>
      <Route path="/admin/*" element={<Admin />} />
    </Routes>
  );
}
