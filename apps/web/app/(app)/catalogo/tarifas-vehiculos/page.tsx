"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";
import { AYUDA_TARIFA, PERMISOS_TARIFA, migasTarifa, valorClp, vigencia } from "../_components/tarifas";

/** Costo por kilómetro por categoría de vehículo (DCO-PG01-P05-IT01: reposición, mantenciones, combustible y seguros). */
export default function TarifasVehiculosPage() {
  return (
    <CrudTable
      titulo="Costo por kilómetro de vehículos"
      subtitulo={`Costo neto por km recorrido de cada categoría de vehículo, para costear traslados y trabajos en terreno. ${AYUDA_TARIFA}`}
      endpoint="tarifas/vehiculos"
      permisos={PERMISOS_TARIFA}
      permitirEliminar={false}
      migas={migasTarifa("Vehículos")}
      columnas={[
        { key: "categoria", label: "Categoría", render: codigoCell },
        { key: "descripcion", label: "Descripción", editable: true },
        { key: "costoKmClp", label: "Costo por km (CLP)", num: true, render: valorClp, editable: { tipo: "number" } },
        { key: "vigenteDesde", label: "Vigencia", render: vigencia },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "categoria", label: "Categoría (p. ej. Camioneta)", requerido: true },
        { name: "descripcion", label: "Descripción", span: 2 },
        { name: "costoKmClp", label: "Costo por km (CLP)", tipo: "moneda", requerido: true },
        { name: "vigenteDesde", label: "Vigente desde", tipo: "date", requerido: true },
        { name: "vigenteHasta", label: "Vigente hasta", tipo: "date" },
        { name: "activo", label: "Activa", tipo: "checkbox" },
      ]}
    />
  );
}
