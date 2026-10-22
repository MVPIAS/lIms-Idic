"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";
import PorcentajesTasa from "@/components/parametros/PorcentajesTasa";
import ParametrosOperacion from "@/components/parametros/ParametrosOperacion";

/**
 * Parámetros del sistema (§5). Pantalla de gestión de la maestra genérica
 * `parametro_sistema`: los combos de negocio que antes estaban hardcodeados
 * (tipo de cliente, forma de pago, prioridad, tipo de línea de costeo, tipo de
 * inspección) se agregan, editan o desactivan aquí, sin tocar código.
 *
 * Las categorías conocidas se ofrecen como select; el campo admite escribir una
 * nueva categoría si en el futuro se centraliza otro combo.
 *
 * Debajo, «Parámetros de la operación» (valor de las reglas de la entrega R1,
 * con motivo e historial) y los porcentajes de la tasa de internación. En la
 * tabla de combos esos parámetros solo cambian etiqueta y orden.
 */
const CATEGORIAS = [
  "tipo_cliente",
  "forma_pago",
  "prioridad",
  "tipo_linea_costeo",
  "tipo_inspeccion",
];

export default function ParametrosPage() {
  return (
    <>
    <CrudTable
      titulo="Parámetros del sistema"
      subtitulo="Combos de negocio editables: agrega, modifica o desactiva valores (tipo de cliente, forma de pago, prioridad, líneas de costeo, tipo de inspección) sin intervención técnica. El valor de las reglas de la operación (cotización, encuestas, recepción, captura, Metrología) y los porcentajes de la tasa de internación se cambian, con motivo, en los recuadros al final de esta página."
      endpoint="parametros"
      columnas={[
        { key: "categoria", label: "Categoría" },
        { key: "codigo", label: "Código", render: codigoCell },
        { key: "etiqueta", label: "Etiqueta", editable: true },
        { key: "orden", label: "Orden", num: true, editable: { tipo: "number" } },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "categoria", label: "Categoría", requerido: true, tipo: "select", opciones: CATEGORIAS },
        { name: "codigo", label: "Código (valor interno)", requerido: true },
        { name: "etiqueta", label: "Etiqueta (texto visible)", requerido: true, span: 2 },
        { name: "orden", label: "Orden", tipo: "entero" },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
    {/* Reglas de la operación (R1): valor tipado, con motivo e historial. */}
    <ParametrosOperacion />
    {/* Porcentajes de la tasa de internación (bpch_tasa): valor con motivo e historial. */}
    <PorcentajesTasa />
    </>
  );
}
