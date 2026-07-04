import { createContext, useContext, useEffect, useState } from 'react';

// Carrito de compras: vive en el navegador del cliente (localStorage),
// no requiere cuenta ni servidor.
const CartContext = createContext(null);

const CLAVE = 'tienda-virtual-carrito';

function leerCarrito() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE)) || [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(leerCarrito);

  useEffect(() => {
    localStorage.setItem(CLAVE, JSON.stringify(items));
  }, [items]);

  // item: { productId, variantId, nombre, talla, color, precio, imagen, cantidad }
  function agregar(item) {
    setItems((prev) => {
      const idx = prev.findIndex(
        (i) => i.productId === item.productId && i.variantId === item.variantId
      );
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + item.cantidad };
        return copia;
      }
      return [...prev, item];
    });
  }

  function cambiarCantidad(productId, variantId, cantidad) {
    setItems((prev) =>
      cantidad <= 0
        ? prev.filter((i) => !(i.productId === productId && i.variantId === variantId))
        : prev.map((i) =>
            i.productId === productId && i.variantId === variantId ? { ...i, cantidad } : i
          )
    );
  }

  function quitar(productId, variantId) {
    cambiarCantidad(productId, variantId, 0);
  }

  function vaciar() {
    setItems([]);
  }

  const totalItems = items.reduce((s, i) => s + i.cantidad, 0);
  const totalBs = items.reduce((s, i) => s + i.cantidad * i.precio, 0);

  return (
    <CartContext.Provider
      value={{ items, agregar, cambiarCantidad, quitar, vaciar, totalItems, totalBs }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
