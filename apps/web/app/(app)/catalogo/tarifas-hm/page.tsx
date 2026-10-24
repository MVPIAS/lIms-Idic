"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";
import { AYUDA_TARIFA, PERMISOS_TARIFA, migasTarifa, valorClp, vigencia } from "../_components/tarifas";

/** Tarifa de la hora máquina por equipo (Sistema Comercial: hrsmaquina, códigos EQ###). */
export default function TarifasHmPage() {
  return (
    <CrudTable
      titulo="Tarifas de horas máquina (HM)"
      subtitulo={`Valor de la hora de uso de cada equipo, por su código del Sistema Comercial (EQ###) y, si ya está registrado, el equipo de «Equipos y calibración». ${AYUDA_TARIFA}`}
      endpoint="tarifas/hm"
      permisos={PERMISOS_TARIFA}
      permitirEliminar={false}
      migas={migasTarifa("Horas máquina")}
      columnas={[
        { key: "codigo", label: "Código", render: codigoCell },
        { key: "descripcion", label: "Descripción", editable: true },
        { key: "equipoId", label: "Equipo", render: (_v, row) => (row.equipo ? [row.equipo.codigo, row.equipo.nombre].filter(Boolean).join(" · ") : "—") },
        { key: "valorHoraClp", label: "Valor hora (CLP)", num: true, render: valorClp, editable: { tipo: "number" } },
        { key: "vigenteDesde", label: "Vigencia", render: vigencia },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "codigo", label: "Código (EQ###)" },
        { name: "descripcion", label: "Descripción (p. ej. HPLC)", span: 2 },
        { name: "equipoId", label: "Equipo (opcional)", tipo: "select", opcionesEndpoint: "equipos?limit=500", span: 2 },
        { name: "valorHoraClp", label: "Valor hora (CLP)", tipo: "moneda", requerido: true },
        { name: "vigenteDesde", label: "Vigente desde", tipo: "date", requerido: true },
        { name: "vigenteHasta", label: "Vigente hasta", tipo: "date" },
        { name: "activo", label: "Activa", tipo: "checkbox" },
      ]}
    />
  );
}
