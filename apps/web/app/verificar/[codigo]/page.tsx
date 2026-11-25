import Verificacion from "../Verificacion";

/** Destino del QR del documento: /verificar/<código> (página pública, sin sesión). */
export default async function VerificarCodigoPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  return <Verificacion codigoInicial={decodeURIComponent(codigo ?? "").slice(0, 40)} />;
}
