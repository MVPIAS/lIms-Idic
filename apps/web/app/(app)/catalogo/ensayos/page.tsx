"use client";

import Link from "next/link";
import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";
import { clp as precio } from "@/lib/format";

export default function EnsayosPage() {
  return (
    <CrudTable
      titulo="Ensayos"
      subtitulo="Eje Análisis · nivel 1. Ensayo comercial/técnico con precio; puede asociarse a una Familia."
      endpoint="cat/ensayos"
      // Reunión 2 (Comercial): ficha de ensayo consultable y editable, con PDF estándar.
      accionesFila={(row) => (
        <Link href={`/catalogo/ensayos/${row.id}/ficha` as any} className="btn outline sm" title="Recursos del ensayo: personal, equipos, vehículos, insumos y otros gastos">
          Ficha
        </Link>
      )}
      columnas={[
        { key: "codigo", label: "Código", render: codigoCell },
        { key: "nombre", label: "Nombre", editable: true },
        { key: "precio", label: "Precio", num: true, render: precio, editable: { tipo: "number" } },
        { key: "familia", label: "Familia", render: (_v, row) => row.familia?.nombre ?? "—" },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "codigo", label: "Código", requerido: true },
        { name: "nombre", label: "Nombre", requerido: true, span: 2 },
        { name: "precio", label: "Precio", tipo: "moneda" },
        { name: "familiaId", label: "Familia (opcional)", tipo: "select", opcionesEndpoint: "cat/familias?limit=500" },
        { name: "agrupado", label: "Agrupado" },
        { name: "objetivo", label: "Objetivo", tipo: "textarea", span: 3 },
        { name: "instruccionTrabajo", label: "Instrucción de trabajo", tipo: "textarea", span: 3 },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
