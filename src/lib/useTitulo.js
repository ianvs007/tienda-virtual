import { useEffect } from 'react';

// Título de la pestaña por página. Al salir de la página se restaura el
// título anterior (el nombre de la tienda que pone Layout).
export function useTitulo(titulo) {
  useEffect(() => {
    if (!titulo) return;
    const anterior = document.title;
    document.title = `${titulo} | ${anterior}`;
    return () => {
      document.title = anterior;
    };
  }, [titulo]);
}
