import { useEffect, useRef, useState } from 'react';

// Sincronización de stock con el sistema local (offline), al cierre de caja.
// 1) Se sube el Excel de stock del sistema local → vista previa del resultado.
// 2) Al confirmar, el servidor RECALCULA y aplica: stock nuevo = stock Excel
//    − ventas en línea desde la última sincronización.
// 3) Se descarga el Excel de ventas en línea para registrarlo en el sistema local.
// Nota: 'xlsx' se importa dinámicamente para no inflar el bundle de la tienda pública.

// Acepta encabezados flexibles (codigo/código, stock/cantidad/existencias…).
const COLUMNAS = {
  codigo: ['codigo', 'code', 'cod'],
  talla: ['talla', 'size'],
  color: ['color'],
  stock: ['stock', 'cantidad', 'existencias', 'existencia'],
};

function norm(clave) {
  return String(clave || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

function mapearFilas(json) {
  return json.map((fila) => {
    const porClave = {};
    for (const [k, v] of Object.entries(fila)) porClave[norm(k)] = v;
    const buscar = (alias) => {
      for (const a of alias) if (porClave[a] !== undefined) return porClave[a];
      return '';
    };
    return {
      codigo: String(buscar(COLUMNAS.codigo) ?? '').trim(),
      talla: String(buscar(COLUMNAS.talla) ?? '').trim(),
      color: String(buscar(COLUMNAS.color) ?? '').trim(),
      stock: buscar(COLUMNAS.stock),
    };
  });
}

function fechaBonita(valor) {
  if (!valor || valor.startsWith('1970')) return 'nunca';
  return new Date(valor.replace(' ', 'T') + 'Z').toLocaleString('es-BO');
}

export default function AdminSincronizar() {
  const [info, setInfo] = useState(null); // { ultima_sincronizacion, ventas }
  const [filas, setFilas] = useState(null);
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [previa, setPrevia] = useState(null);
  const [reporte, setReporte] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const inputRef = useRef(null);

  function cargarInfo() {
    fetch('/api/admin/sincronizar/ventas')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setInfo)
      .catch(() => setInfo({ ultima_sincronizacion: null, ventas: [] }));
  }
  useEffect(cargarInfo, []);

  async function leerExcel(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setError('');
    setPrevia(null);
    setReporte(null);
    setFilas(null);
    setCargando(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await archivo.arrayBuffer());
      const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const mapeadas = mapearFilas(json).filter(
        (f) => f.codigo || f.talla || f.color || f.stock !== ''
      );
      if (!mapeadas.length)
        throw new Error(
          'No se encontraron filas con datos. El Excel debe tener encabezados: codigo, talla, color, stock.'
        );
      setFilas(mapeadas);
      setNombreArchivo(archivo.name);

      const r = await fetch('/api/admin/sincronizar/previsualizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filas: mapeadas }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo previsualizar');
      setPrevia(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function aplicar() {
    setCargando(true);
    setError('');
    try {
      const r = await fetch('/api/admin/sincronizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filas }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo aplicar la sincronización');
      setReporte(data);
      setPrevia(null);
      setFilas(null);
      cargarInfo();
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function descargarVentas() {
    if (!info?.ventas?.length) return;
    const XLSX = await import('xlsx');
    const filasXlsx = info.ventas.map((v) => ({
      codigo: v.codigo || '',
      nombre: v.nombre,
      talla: v.talla || '',
      color: v.color || '',
      cantidad: v.cantidad,
      precio_unit: v.precio_unit,
      estado: v.estado,
      pedido: (v.pedido_ref || '').toUpperCase(),
      fecha: v.creado_en,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasXlsx), 'ventas_en_linea');
    XLSX.writeFile(wb, `ventas-en-linea-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-4 shadow">
        <h1 className="text-lg font-bold">Sincronizar stock con la tienda física</h1>
        <p className="mt-1 text-sm text-gray-500">
          Última sincronización:{' '}
          <strong>{info ? fechaBonita(info.ultima_sincronizacion) : '…'}</strong>
          {info?.ventas?.length > 0 && (
            <>
              {' '}· <strong>{info.ventas.length}</strong> ítems vendidos en línea desde entonces
            </>
          )}
        </p>
        <p className="mt-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-800">
          Ritual de cierre de caja: ① exporta el Excel de stock en el sistema local (recién
          exportado, no uno viejo) → ② súbelo aquí y confirma → ③ descarga el Excel de ventas en
          línea y regístralo en el sistema local.
        </p>
      </div>

      <div className="rounded-xl bg-white p-4 shadow">
        <p className="text-sm font-medium">① Subir Excel de cierre de caja</p>
        <p className="mt-1 text-xs text-gray-500">
          Columnas esperadas: <code>codigo</code>, <code>talla</code>, <code>color</code>,{' '}
          <code>stock</code> (una fila por variante; talla/color opcionales si la prenda no tiene).
        </p>
        <label className="mt-3 inline-block cursor-pointer rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700">
          {cargando && !previa ? 'Procesando…' : 'Elegir archivo .xlsx'}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={leerExcel}
            disabled={cargando}
            className="hidden"
          />
        </label>
        {nombreArchivo && !reporte && (
          <span className="ml-3 text-sm text-gray-500">{nombreArchivo}</span>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {previa && (
        <div className="rounded-xl bg-white p-4 shadow">
          <p className="text-sm font-medium">
            ② Vista previa: {previa.filas} filas · {previa.cambios} con cambios ·{' '}
            <span className={previa.advertencias ? 'font-bold text-amber-700' : ''}>
              {previa.advertencias} advertencias
            </span>
          </p>
          <TablaDetalle detalle={previa.detalle} />
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={aplicar}
              disabled={cargando}
              className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {cargando ? 'Aplicando…' : '✓ Confirmar y aplicar'}
            </button>
            <button
              onClick={() => {
                setPrevia(null);
                setFilas(null);
                setNombreArchivo('');
              }}
              className="rounded-lg border px-4 py-2 text-gray-600 hover:bg-gray-50"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {reporte && (
        <div className="rounded-xl bg-green-50 p-4 shadow">
          <p className="text-sm font-medium text-green-800">
            ✓ Sincronización aplicada: {reporte.actualizadas} variantes actualizadas de{' '}
            {reporte.filas} filas
            {reporte.advertencias > 0 && ` · ${reporte.advertencias} advertencias (revisar abajo)`}
          </p>
          {reporte.advertencias > 0 && <TablaDetalle detalle={reporte.detalle.filter((r) => r.aviso)} />}
        </div>
      )}

      <div className="rounded-xl bg-white p-4 shadow">
        <p className="text-sm font-medium">③ Ventas en línea para el sistema local</p>
        <p className="mt-1 text-xs text-gray-500">
          Excel con lo vendido en la web desde la última sincronización, para que el stock del
          sistema local también baje.
        </p>
        <button
          onClick={descargarVentas}
          disabled={!info?.ventas?.length}
          className="mt-3 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          Descargar Excel de ventas en línea ({info?.ventas?.length ?? 0})
        </button>
      </div>
    </div>
  );
}

function TablaDetalle({ detalle }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-gray-500">
            <th className="py-1 pr-2">Código</th>
            <th className="py-1 pr-2">Prenda</th>
            <th className="py-1 pr-2">Variante</th>
            <th className="py-1 pr-2 text-right">Stock nube</th>
            <th className="py-1 pr-2 text-right">Stock Excel</th>
            <th className="py-1 pr-2 text-right">Vendidas web</th>
            <th className="py-1 text-right">Stock nuevo</th>
          </tr>
        </thead>
        <tbody>
          {detalle.map((r, i) => (
            <tr key={i} className={`border-b last:border-0 ${r.aviso ? 'bg-amber-50' : ''}`}>
              <td className="py-1 pr-2 font-mono text-xs">{r.codigo || '—'}</td>
              <td className="py-1 pr-2">
                {r.nombre || ''}
                {r.aviso && <p className="text-xs text-amber-700">{r.aviso}</p>}
              </td>
              <td className="py-1 pr-2">{[r.talla, r.color].filter(Boolean).join(' · ') || '—'}</td>
              <td className="py-1 pr-2 text-right">{r.stockActual ?? '—'}</td>
              <td className="py-1 pr-2 text-right">{r.stockExcel ?? '—'}</td>
              <td className="py-1 pr-2 text-right">{r.vendidas ?? '—'}</td>
              <td className="py-1 text-right font-medium">{r.stockNuevo ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
