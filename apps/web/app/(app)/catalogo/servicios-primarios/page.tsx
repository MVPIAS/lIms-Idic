"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";
import { AYUDA_TARIFA, PERMISOS_TARIFA, migasTarifa, valorClp, vigencia } from "../_components/tarifas";

/** Precio de los servicios primarios (Sistema Comercial: lps_primaria). */
export default function ServiciosPrimariosPage() {
  return (
    <CrudTable
      titulo="Servicios primarios"
      subtitulo={`Precio de los servicios primarios por código, con su centro de costo. ${AYUDA_TARIFA}`}
      endpoint="tarifas/servicios-primarios"
      permisos={PERMISOS_TARIFA}
      permitirEliminar={false}
      migas={migasTarifa("Servicios primarios")}
      columnas={[
        { key: "codigo", label: "Código", render: codigoCell },
        { key: "descripcion", label: "Descripción", editable: true },
        { key: "precioClp", label: "Precio (CLP)", num: true, render: valorClp, editable: { tipo: "number" } },
        { key: "centroCostoId", label: "Centro de costo", render: (_v, row) => (row.centroCosto ? `${row.centroCosto.codigo} · ${row.centroCosto.nombre}` : "—") },
        { key: "vigenteDesde", label: "Vigencia", render: vigencia },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "codigo", label: "Código", requerido: true },
        { name: "descripcion", label: "Descripción", tipo: "textarea", span: 3 },
        { name: "precioClp", label: "Precio (CLP)", tipo: "moneda" },
        { name: "centroCostoId", label: "Centro de costo", tipo: "select", opcionesEndpoint: "centros-costo?limit=100", span: 2 },
        { name: "vigenteDesde", label: "Vigente desde", tipo: "date", requerido: true },
        { name: "vigenteHasta", label: "Vigente hasta", tipo: "date" },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
