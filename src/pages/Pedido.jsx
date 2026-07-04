import { useParams } from 'react-router-dom';

export default function Pedido() {
  const { codigo } = useParams();
  return (
    <div className="py-10 text-center text-gray-500">
      Estado del pedido {codigo} — se construye en la Fase 3.
    </div>
  );
}
