"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";
import { AYUDA_TARIFA, PERMISOS_TARIFA, migasTarifa, valorClp, vigencia } from "../_components/tarifas";

/** Tarifa de la hora hombre por categoría (Sistema Comercial: hrshombre). */
export default function TarifasHhPage() {
  return (
    <CrudTable
      titulo="Tarifas de horas hombre (HH)"
      subtitulo={`Valor de la hora hombre por categoría de personal (A, B, C…). ${AYUDA_TARIFA}`}
      endpoint="tarifas/hh"
      permisos={PERMISOS_TARIFA}
      permitirEliminar={false}
      migas={migasTarifa("Horas hombre")}
      columnas={[
        { key: "categoria", label: "Categoría", render: codigoCell },
        { key: "descripcion", label: "Descripción", editable: true },
        { key: "valorHoraClp", label: "Valor hora (CLP)", num: true, render: valorClp, editable: { tipo: "number" } },
        { key: "vigenteDesde", label: "Vigencia", render: vigencia },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "categoria", label: "Categoría", requerido: true },
        { name: "descripcion", label: "Descripción (p. ej. Profesional senior)", span: 2 },
        { name: "valorHoraClp", label: "Valor hora (CLP)", tipo: "moneda", requerido: true },
        { name: "vigenteDesde", label: "Vigente desde", tipo: "date", requerido: true },
        { name: "vigenteHasta", label: "Vigente hasta", tipo: "date" },
        { name: "activo", label: "Activa", tipo: "checkbox" },
      ]}
    />
  );
}
