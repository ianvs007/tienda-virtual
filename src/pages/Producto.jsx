import { useParams } from 'react-router-dom';

export default function Producto() {
  const { id } = useParams();
  return (
    <div className="py-10 text-center text-gray-500">
      Ficha del producto #{id} — se construye en la Fase 2.
    </div>
  );
}
