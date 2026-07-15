"use client";

import CrudTable from "@/components/CrudTable";

const num = (data: any) => ({
  ...data,
  monto: data.monto === "" || data.monto == null ? undefined : Number(data.monto),
});

export default function PagosPage() {
  return (
    <CrudTable
      recurso="pagos"
      titulo="Pagos"
      subtitulo="Abonos recibidos contra facturas. Reducen el saldo pendiente."
      prepararCrear={num}
      columnas={[
        { campo: "facturaId", titulo: "Factura (id)", render: (v) => (v ? <span className="tag">{String(v).slice(0, 8)}…</span> : "—") },
        { campo: "monto", titulo: "Monto", right: true },
        { campo: "medio", titulo: "Medio" },
        { campo: "referencia", titulo: "Referencia", render: (v) => (v ? <span className="codigo">{v}</span> : "—") },
      ]}
      campos={[
        // facturaId es FK (uuid): por ahora se ingresa el id de la factura a mano.
        { campo: "facturaId", label: "Factura (id)", requerido: true },
        { campo: "monto", label: "Monto", tipo: "number", requerido: true },
        { campo: "medio", label: "Medio de pago" },
        { campo: "referencia", label: "Referencia" },
      ]}
    />
  );
}
