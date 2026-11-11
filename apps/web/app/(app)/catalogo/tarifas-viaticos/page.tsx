"use client";

import CrudTable, { activoBadge } from "../_components/CrudTable";
import { AYUDA_TARIFA, PERMISOS_TARIFA, migasTarifa, valorClp, vigencia } from "../_components/tarifas";

const grados = (_v: any, row: any) => (row.gradoDesde === row.gradoHasta ? `${row.gradoDesde}` : `${row.gradoDesde} al ${row.gradoHasta}`);
const monto = (v: any, row: any) => (row.moneda && row.moneda !== "CLP" ? `${row.moneda} ${Number(v).toLocaleString("es-CL")}` : valorClp(v));

/** Escala de viáticos por grado jerárquico (DCO-PG01-P05-IT01; valores que informa Finanzas por la orden del día). */
export default function TarifasViaticosPage() {
  return (
    <CrudTable
      titulo="Escala de viáticos"
      subtitulo={`Monto diario al 100 % por tramo de grado jerárquico, nacional o por país. El formulario de costeo propone el monto según el grado y aplica el % (100, 60, 40 o 20). ${AYUDA_TARIFA}`}
      endpoint="tarifas/viaticos"
      permisos={PERMISOS_TARIFA}
      permitirEliminar={false}
      migas={migasTarifa("Viáticos")}
      columnas={[
        { key: "ambito", label: "Ámbito" },
        { key: "pais", label: "País", render: (v) => v || "—" },
        { key: "gradoDesde", label: "Grados", render: grados },
        { key: "denominacion", label: "Denominación", editable: true },
        { key: "montoDiario", label: "Monto diario (100 %)", num: true, render: monto, editable: { tipo: "number" } },
        { key: "vigenteDesde", label: "Vigencia", render: vigencia },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "ambito", label: "Ámbito", tipo: "select", opciones: ["nacional", "extranjero"], requerido: true },
        { name: "pais", label: "País (solo extranjero)" },
        { name: "gradoDesde", label: "Grado desde", tipo: "number", requerido: true },
        { name: "gradoHasta", label: "Grado hasta", tipo: "number", requerido: true },
        { name: "denominacion", label: "Denominación (p. ej. CAP - ALF - SG1 - ECL)", span: 2 },
        { name: "montoDiario", label: "Monto diario al 100 %", tipo: "moneda", requerido: true },
        { name: "moneda", label: "Moneda", tipo: "select", opciones: ["CLP", "USD"] },
        { name: "vigenteDesde", label: "Vigente desde", tipo: "date", requerido: true },
        { name: "vigenteHasta", label: "Vigente hasta", tipo: "date" },
        { name: "activo", label: "Activa", tipo: "checkbox" },
      ]}
    />
  );
}
