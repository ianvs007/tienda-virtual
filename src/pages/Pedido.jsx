import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bs, urlImagen } from '../lib/formato.js';

const ESTADOS = {
  pendiente_pago: { texto: 'Esperando tu pago', color: 'bg-amber-100 text-amber-800' },
  comprobante_subido: { texto: 'Comprobante en verificación', color: 'bg-blue-100 text-blue-800' },
  confirmado: { texto: 'Pago confirmado ✓', color: 'bg-green-100 text-green-800' },
  entregado: { texto: 'Entregado ✓', color: 'bg-green-100 text-green-800' },
  cancelado: { texto: 'Cancelado', color: 'bg-red-100 text-red-700' },
};

export default function Pedido() {
  const { codigo } = useParams();
  const [pedido, setPedido] = useState(null);
  const [error, setError] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [msjSubida, setMsjSubida] = useState('');
  const inputRef = useRef(null);

  function cargar() {
    fetch(`/api/pedidos/${codigo}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setPedido)
      .catch(() => setError(true));
  }
  useEffect(cargar, [codigo]);

  async function subirComprobante(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setSubiendo(true);
    setMsjSubida('');
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const r = await fetch(`/api/pedidos/${codigo}/comprobante`, { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo subir el comprobante');
      setMsjSubida('✓ Comprobante recibido. Verificaremos tu pago y te contactaremos por WhatsApp.');
      cargar();
    } catch (err) {
      setMsjSubida(err.message);
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  if (error)
    return (
      <div className="py-10 text-center text-gray-500">
        Pedido no encontrado. <Link to="/" className="underline">Volver al catálogo</Link>
      </div>
    );
  if (!pedido) return <p className="py-10 text-center text-gray-500">Cargando pedido…</p>;

  const estado = ESTADOS[pedido.estado] || ESTADOS.pendiente_pago;
  const esperandoPago = pedido.estado === 'pendiente_pago';
  const enVerificacion = pedido.estado === 'comprobante_subido';

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="rounded-xl bg-white p-4 shadow">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Tu pedido</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${estado.color}`}>
            {estado.texto}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Guarda este enlace para consultar tu pedido cuando quieras.
        </p>

        <ul className="mt-3 divide-y text-sm">
          {pedido.items.map((i, idx) => {
            const etiqueta = [i.talla, i.color].filter(Boolean).join(' · ');
            return (
              <li key={idx} className="flex items-center gap-3 py-2">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                  {i.imagen ? (
                    <img src={urlImagen(i.imagen)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xl text-gray-300">👗</div>
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{i.nombre}</p>
                  <p className="text-xs text-gray-500">
                    {etiqueta && `${etiqueta} · `}x{i.cantidad}
                  </p>
                </div>
                <span>{bs(i.precio_unit * i.cantidad)}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex justify-between border-t pt-2 font-bold">
          <span>Total</span>
          <span>{bs(pedido.total)}</span>
        </div>
      </div>

      {esperandoPago && (
        <div className="rounded-xl bg-white p-4 shadow text-center">
          <h2 className="font-bold">Paga escaneando este QR</h2>
          <p className="mt-1 text-sm text-gray-500">
            Desde la app de tu banco o billetera móvil, por el monto exacto de{' '}
            <strong>{bs(pedido.total)}</strong>.
          </p>
          {pedido.qr ? (
            <img
              src={urlImagen(pedido.qr)}
              alt="QR de cobro"
              className="mx-auto mt-3 w-64 max-w-full rounded-lg border"
            />
          ) : (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              El QR de cobro aún no está configurado. Contáctanos por WhatsApp para completar tu pago.
            </p>
          )}
        </div>
      )}

      {(esperandoPago || enVerificacion) && (
        <div className="rounded-xl bg-white p-4 shadow text-center">
          <h2 className="font-bold">
            {pedido.tiene_comprobante ? '¿Necesitas corregir tu comprobante?' : 'Ya pagaste: sube tu comprobante'}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Sube la captura o foto del comprobante de pago (JPG o PNG, máx. 5 MB).
          </p>
          <label className="mt-3 inline-block cursor-pointer rounded-xl bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700">
            {subiendo ? 'Subiendo…' : pedido.tiene_comprobante ? 'Subir de nuevo' : 'Subir comprobante'}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={subirComprobante}
              disabled={subiendo}
              className="hidden"
            />
          </label>
          {msjSubida && <p className="mt-2 text-sm text-gray-600">{msjSubida}</p>}
        </div>
      )}

      {pedido.estado === 'confirmado' && (
        <div className="rounded-xl bg-green-50 p-4 text-center text-sm text-green-800">
          Tu pago fue verificado. Nos contactaremos por WhatsApp para coordinar la entrega.
        </div>
      )}

      {pedido.whatsapp_tienda && (
        <a
          href={`https://wa.me/${pedido.whatsapp_tienda.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, consulto por mi pedido ${codigo}`)}`}
          target="_blank"
          rel="noreferrer"
          className="block rounded-xl bg-green-600 py-3 text-center font-medium text-white hover:bg-green-700"
        >
          💬 Escribir a la tienda por WhatsApp
        </a>
      )}
    </div>
  );
}
