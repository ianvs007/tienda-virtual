import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { urlImagen } from '../../lib/formato.js';

// Alta y edición de una prenda: datos, tallas/colores con stock, y fotos.
export default function AdminProductoForm() {
  const { id } = useParams(); // undefined = nueva
  const navigate = useNavigate();
  const esNueva = !id;

  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [precio, setPrecio] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [activo, setActivo] = useState(true);
  const [variantes, setVariantes] = useState([{ talla: '', color: '', stock: 0 }]);
  const [imagenes, setImagenes] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [nuevaCat, setNuevaCat] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const inputFoto = useRef(null);

  useEffect(() => {
    fetch('/api/admin/categorias')
      .then((r) => (r.ok ? r.json() : []))
      .then(setCategorias)
      .catch(() => {});
    if (!esNueva) {
      fetch(`/api/admin/productos/${id}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((p) => {
          setNombre(p.nombre);
          setCodigo(p.codigo || '');
          setDescripcion(p.descripcion || '');
          setPrecio(String(p.precio));
          setCategoriaId(p.categoria_id ? String(p.categoria_id) : '');
          setActivo(Boolean(p.activo));
          setVariantes(p.variantes.length ? p.variantes : [{ talla: '', color: '', stock: 0 }]);
          setImagenes(p.imagenes);
        })
        .catch(() => setError('No se pudo cargar la prenda'));
    }
  }, [id, esNueva]);

  function setVar(i, campo, valor) {
    setVariantes((prev) => prev.map((v, idx) => (idx === i ? { ...v, [campo]: valor } : v)));
  }

  async function crearCategoria() {
    const nombre = nuevaCat.trim();
    if (!nombre) return;
    const r = await fetch('/api/admin/categorias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre }),
    });
    const data = await r.json();
    if (r.ok) {
      setCategorias((prev) => [...prev, { id: data.id, nombre }]);
      setCategoriaId(String(data.id));
      setNuevaCat('');
    } else setError(data.error || 'No se pudo crear la categoría');
  }

  async function guardar(e) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const cuerpo = {
      nombre,
      codigo,
      descripcion,
      precio: Number(precio),
      categoria_id: categoriaId || null,
      activo,
      stock: variantes.reduce((acc, v) => acc + (Number(v.stock) || 0), 0),
      variantes: variantes.map((v) => ({ ...v, stock: Number(v.stock) })),
    };
    try {
      const r = await fetch(esNueva ? '/api/productos' : `/api/admin/productos/${id}`, {
        method: esNueva ? 'POST' : 'PUT',
        headers,
        body: JSON.stringify(cuerpo),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo guardar');
      if (esNueva) navigate(`/admin/productos/${data.id}`, { replace: true });
      else navigate('/admin/productos');
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function subirFoto(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setSubiendoFoto(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const r = await fetch(`/api/admin/productos/${id}/imagenes`, { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo subir la foto');
      setImagenes((prev) => [...prev, { id: data.id, r2_key: data.r2_key }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubiendoFoto(false);
      if (inputFoto.current) inputFoto.current.value = '';
    }
  }

  async function quitarFoto(imageId) {
    const r = await fetch(`/api/admin/productos/${id}/imagenes`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId }),
    });
    if (r.ok) setImagenes((prev) => prev.filter((i) => i.id !== imageId));
  }

  return (
    <form onSubmit={guardar} className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{esNueva ? 'Nueva prenda' : 'Editar prenda'}</h1>
        <Link to="/admin/productos" className="text-sm text-gray-500 underline">
          ← Volver
        </Link>
      </div>

      <div className="rounded-xl bg-white p-4 shadow">
        <label className="block text-sm font-medium">Nombre</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          placeholder="Ej: Vestido floral verano"
          className="mt-1 w-full rounded-lg border px-3 py-2"
        />

        <label className="mt-3 block text-sm font-medium">
          Código del sistema local <span className="font-normal text-gray-400">(opcional)</span>
        </label>
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="Ej: POL-001 — para sincronizar el stock con la tienda física"
          className="mt-1 w-full rounded-lg border px-3 py-2"
        />

        <label className="mt-3 block text-sm font-medium">Descripción</label>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={3}
          placeholder="Tela, corte, detalles…"
          className="mt-1 w-full rounded-lg border px-3 py-2"
        />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium">Precio (Bs)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Categoría</label>
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            >
              <option value="">Sin categoría</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <div className="mt-1 flex gap-1">
              <input
                value={nuevaCat}
                onChange={(e) => setNuevaCat(e.target.value)}
                placeholder="Nueva categoría…"
                className="w-full rounded-lg border px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={crearCategoria}
                className="rounded-lg bg-gray-200 px-2 text-xs hover:bg-gray-300"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {!esNueva && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Visible en el catálogo
          </label>
        )}
      </div>

      <div className="rounded-xl bg-white p-4 shadow">
        <p className="text-sm font-medium">Tallas / colores y stock</p>
        {variantes.map((v, i) => (
          <div key={v.id ?? `n${i}`} className="mt-2 flex gap-2">
            <input
              value={v.talla}
              onChange={(e) => setVar(i, 'talla', e.target.value)}
              placeholder="Talla (S, M…)"
              className="w-1/3 rounded-lg border px-2 py-1.5 text-sm"
            />
            <input
              value={v.color}
              onChange={(e) => setVar(i, 'color', e.target.value)}
              placeholder="Color"
              className="w-1/3 rounded-lg border px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              min="0"
              value={v.stock}
              onChange={(e) => setVar(i, 'stock', e.target.value)}
              placeholder="Stock"
              className="w-1/4 rounded-lg border px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => setVariantes((prev) => prev.filter((_, idx) => idx !== i))}
              disabled={variantes.length === 1}
              className="text-gray-400 hover:text-red-600 disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setVariantes((prev) => [...prev, { talla: '', color: '', stock: 0 }])}
          className="mt-2 text-sm text-gray-600 underline"
        >
          + Agregar talla/color
        </button>
      </div>

      <div className="rounded-xl bg-white p-4 shadow">
        <p className="text-sm font-medium">Fotos</p>
        {esNueva ? (
          <p className="mt-1 text-sm text-gray-500">Guarda la prenda primero y luego sube sus fotos.</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              {imagenes.map((img) => (
                <div key={img.id} className="relative h-24 w-24 overflow-hidden rounded-lg border">
                  <img src={urlImagen(img.r2_key)} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => quitarFoto(img.id)}
                    className="absolute top-0.5 right-0.5 rounded-full bg-black/60 px-1.5 text-xs text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed text-2xl text-gray-400 hover:border-gray-600">
                {subiendoFoto ? '…' : '+'}
                <input
                  ref={inputFoto}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={subirFoto}
                  disabled={subiendoFoto}
                  className="hidden"
                />
              </label>
            </div>
            <p className="mt-1 text-xs text-gray-400">La primera foto es la portada del catálogo.</p>
          </>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <button
        disabled={guardando}
        className="w-full rounded-xl bg-gray-900 py-3 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {guardando ? 'Guardando…' : esNueva ? 'Crear prenda' : 'Guardar cambios'}
      </button>
    </form>
  );
}
