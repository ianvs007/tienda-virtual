import { useEffect, useState } from 'react';

// Pantalla de ingreso. Si el panel nunca se configuró, ofrece crear el admin inicial.
export default function AdminLogin({ onIngreso }) {
  const [modo, setModo] = useState('login'); // 'login' | 'setup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetch('/api/admin/setup')
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => d.necesitaSetup && setModo('setup'))
      .catch(() => {});
  }, []);

  async function enviar(e) {
    e.preventDefault();
    setError('');
    if (modo === 'setup' && password !== confirmar) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch(`/api/admin/${modo === 'setup' ? 'setup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo ingresar');
      onIngreso(data.email);
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 px-4">
      <form onSubmit={enviar} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-center text-xl font-bold">
          {modo === 'setup' ? 'Configura tu panel' : 'Panel de administración'}
        </h1>
        {modo === 'setup' && (
          <p className="mt-1 text-center text-sm text-gray-500">
            Primera vez: crea el usuario dueño de la tienda.
          </p>
        )}

        <label className="mt-5 block text-sm font-medium">Correo</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mt-1 w-full rounded-lg border px-3 py-2"
        />

        <label className="mt-3 block text-sm font-medium">Contraseña</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="mt-1 w-full rounded-lg border px-3 py-2"
        />

        {modo === 'setup' && (
          <>
            <label className="mt-3 block text-sm font-medium">Repite la contraseña</label>
            <input
              type="password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              required
              minLength={8}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </>
        )}

        {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <button
          disabled={enviando}
          className="mt-5 w-full rounded-xl bg-gray-900 py-2.5 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {enviando ? 'Un momento…' : modo === 'setup' ? 'Crear y entrar' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
