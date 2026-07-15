"use client";

import CrudTable from "@/components/CrudTable";

const num = (data: any) => ({
  ...data,
  limiteInf: data.limiteInf === "" || data.limiteInf == null ? undefined : Number(data.limiteInf),
  nominal: data.nominal === "" || data.nominal == null ? undefined : Number(data.nominal),
  limiteSup: data.limiteSup === "" || data.limiteSup == null ? undefined : Number(data.limiteSup),
});

export default function LimitesPage() {
  return (
    <CrudTable
      recurso="limites"
      titulo="Límites / Especificaciones"
      subtitulo="Rangos de aceptación (inf–nominal–sup) por analito y producto. Base del veredicto Cumple/No cumple."
      prepararCrear={num}
      columnas={[
        { campo: "producto", titulo: "Producto" },
        { campo: "limiteInf", titulo: "Lím. inf.", right: true },
        { campo: "nominal", titulo: "Nominal", right: true },
        { campo: "limiteSup", titulo: "Lím. sup.", right: true },
        { campo: "unidad", titulo: "Unidad", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
      ]}
      campos={[
        // analitoId es FK (uuid): por ahora se ingresa el id del analito a mano.
        { campo: "analitoId", label: "Analito (id)", requerido: true },
        { campo: "producto", label: "Producto" },
        { campo: "limiteInf", label: "Límite inferior", tipo: "number" },
        { campo: "nominal", label: "Nominal", tipo: "number" },
        { campo: "limiteSup", label: "Límite superior", tipo: "number" },
        { campo: "unidad", label: "Unidad" },
      ]}
    />
  );
}
