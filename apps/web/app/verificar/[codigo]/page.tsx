import Verificacion from "../Verificacion";

/** Destino del QR del documento: /verificar/<código> (página pública, sin sesión). */
export default function VerificarCodigoPage({ params }: { params: { codigo: string } }) {
  return <Verificacion codigoInicial={decodeURIComponent(params.codigo ?? "").slice(0, 40)} />;
}
