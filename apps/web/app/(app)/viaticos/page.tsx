"use client";

import CrudTable from "@/components/CrudTable";

const num = (data: any) => ({
  ...data,
  dias: data.dias === "" || data.dias == null ? undefined : Number(data.dias),
  monto: data.monto === "" || data.monto == null ? undefined : Number(data.monto),
});

export default function ViaticosPage() {
  return (
    <CrudTable
      recurso="viaticos"
      titulo="Viáticos"
      subtitulo="Gastos de comisión de servicio de funcionarios, opcionalmente ligados a una OT."
      prepararCrear={num}
      columnas={[
        { campo: "funcionario", titulo: "Funcionario" },
        { campo: "destino", titulo: "Destino" },
        { campo: "dias", titulo: "Días", right: true },
        { campo: "tipo", titulo: "Tipo", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { campo: "monto", titulo: "Monto", right: true },
      ]}
      campos={[
        { campo: "funcionario", label: "Funcionario", requerido: true },
        { campo: "destino", label: "Destino" },
        { campo: "dias", label: "Días", tipo: "number" },
        { campo: "tipo", label: "Tipo" },
        { campo: "monto", label: "Monto", tipo: "number", requerido: true },
        // otId es FK (uuid) opcional: id de la orden de trabajo asociada.
        { campo: "otId", label: "OT (id)" },
      ]}
    />
  );
}
