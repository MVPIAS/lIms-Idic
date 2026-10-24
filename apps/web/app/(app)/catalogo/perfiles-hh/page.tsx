"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";
import { PERMISOS_TARIFA, migasTarifa } from "../_components/tarifas";
import { pct } from "@/lib/format";

/** Ajuste de la hora hombre por perfil: civil, militar (Sistema Comercial: phh_hh). */
export default function PerfilesHhPage() {
  return (
    <CrudTable
      titulo="Perfiles de horas hombre"
      subtitulo="Ajuste porcentual sobre el valor base de la hora hombre según el perfil del personal (civil, militar). No se borran: se desactivan."
      endpoint="tarifas/hh-perfiles"
      permisos={PERMISOS_TARIFA}
      permitirEliminar={false}
      migas={migasTarifa("Perfiles HH")}
      columnas={[
        { key: "perfil", label: "Perfil", render: codigoCell },
        { key: "ajustePct", label: "Ajuste", num: true, render: (v) => (v == null ? "—" : pct(v)), editable: { tipo: "number" } },
        { key: "descripcion", label: "Descripción", editable: true },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "perfil", label: "Perfil", requerido: true },
        { name: "ajustePct", label: "Ajuste (%)", tipo: "number" },
        { name: "descripcion", label: "Descripción", tipo: "textarea", span: 3 },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
