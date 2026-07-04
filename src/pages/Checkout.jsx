import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../contexts/CartContext.jsx';
import { bs } from '../lib/formato.js';

const ENTREGAS = [
  { id: 'local', nombre: 'Envío local', detalle: 'Delivery en la ciudad' },
  { id: 'nacional', nombre: 'Envío nacional', detalle: 'A otras ciudades de Bolivia' },
  { id: 'recojo', nombre: 'Recojo en tienda', detalle: 'Pasas a recoger tu compra' },
];

export default function Checkout() {
  const { items, totalBs, vaciar } = useCart();
  const navigate = useNavigate();

  const [ajustes, setAjustes] = useState({});
  const [nombre, setNombre] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [tipoEntrega, setTipoEntrega] = useState('local');
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/ajustes')
      .then((r) => (r.ok ? r.json() : {}))
      .then(setAjustes)
      .catch(() => {});
  }, []);

  if (items.length === 0)
    return (
      <div className="py-14 text-center text-gray-500">
        <p>No hay nada que pagar: tu carrito está vacío.</p>
        <Link to="/" className="mt-3 inline-block rounded-lg bg-gray-900 px-4 py-2 text-white">
          Ver catálogo
        </Link>
      </div>
    );

  const envio =
    tipoEntrega === 'local'
      ? Number(ajustes.costo_envio_local) || 0
      : tipoEntrega === 'nacional'
        ? Number(ajustes.costo_envio_nacional) || 0
        : 0;
  const total = totalBs + envio;

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const r = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre,
          whatsapp,
          tipo_entrega: tipoEntrega,
          direccion,
          ciudad,
          items: items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            cantidad: i.cantidad,
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo crear el pedido');
      vaciar();
      navigate(`/pedido/${data.codigo}`);
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-xl font-bold">Datos de entrega</h1>

      <form onSubmit={enviar} className="space-y-4">
        <div className="rounded-xl bg-white p-4 shadow">
          <label className="block text-sm font-medium">Tu nombre</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            minLength={2}
            placeholder="Nombre y apellido"
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />

          <label className="mt-4 block text-sm font-medium">Tu WhatsApp</label>
          <input
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            required
            type="tel"
            placeholder="Ej: 70000000"
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
          <p className="mt-1 text-xs text-gray-500">
            Por este número coordinamos la entrega de tu pedido.
          </p>
        </div>

        <div className="rounded-xl bg-white p-4 shadow">
          <p className="mb-2 text-sm font-medium">¿Cómo recibirás tu pedido?</p>
          <div className="space-y-2">
            {ENTREGAS.map((e) => (
              <label
                key={e.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                  tipoEntrega === e.id ? 'border-gray-900 bg-gray-50' : 'border-gray-200'
                }`}
              >
                <input
                  type="radio"
                  name="entrega"
                  checked={tipoEntrega === e.id}
                  onChange={() => setTipoEntrega(e.id)}
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{e.nombre}</span>
                  <span className="block text-xs text-gray-500">{e.detalle}</span>
                </span>
              </label>
            ))}
          </div>

          {tipoEntrega !== 'recojo' && (
            <>
              <label className="mt-4 block text-sm font-medium">Dirección de entrega</label>
              <input
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                required
                placeholder="Calle, número, referencia"
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </>
          )}
          {tipoEntrega === 'nacional' && (
            <>
              <label className="mt-3 block text-sm font-medium">Ciudad de destino</label>
              <input
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
                required
                placeholder="Ej: Santa Cruz"
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </>
          )}
        </div>

        <div className="rounded-xl bg-white p-4 shadow text-sm">
          <div className="flex justify-between">
            <span>Prendas ({items.reduce((s, i) => s + i.cantidad, 0)})</span>
            <span>{bs(totalBs)}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>Envío</span>
            <span>{envio > 0 ? bs(envio) : tipoEntrega === 'recojo' ? 'Gratis' : 'A coordinar'}</span>
          </div>
          <div className="mt-2 flex justify-between border-t pt-2 text-base font-bold">
            <span>Total a pagar</span>
            <span>{bs(total)}</span>
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-xl bg-gray-900 py-3 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {enviando ? 'Creando pedido…' : 'Continuar al pago con QR'}
        </button>
      </form>
    </div>
  );
}
