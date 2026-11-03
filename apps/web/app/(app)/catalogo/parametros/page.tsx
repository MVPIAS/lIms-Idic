"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";
import PorcentajesTasa from "@/components/parametros/PorcentajesTasa";
import ParametrosOperacion from "@/components/parametros/ParametrosOperacion";

/**
 * Parámetros del sistema (§5). Pantalla de gestión de la maestra genérica
 * `parametro_sistema`: los combos de negocio que antes estaban hardcodeados
 * (tipo de cliente, forma de pago, prioridad, tipo de línea de costeo, tipo de
 * inspección) se agregan, editan o desactivan aquí, sin tocar código.
 *
 * «Categoría» ofrece las listas registradas en la API (LISTAS_PARAMETROS de
 * parametro-configurable.ts, GET parametros/listas): las que admiten opciones
 * nuevas. Al editar, la categoría se muestra sin poder cambiarse, sea cual sea.
 *
 * Debajo, «Parámetros de la operación» (valor de las reglas de la entrega R1,
 * con motivo e historial) y los porcentajes de la tasa de internación. En la
 * tabla de combos esos parámetros solo cambian etiqueta y orden.
 */
interface ListaParametro {
  categoria: string;
  nombre: string;
  alta: boolean;
  noDesactivables: string[];
}

export default function ParametrosPage() {
  const [listas, setListas] = useState<ListaParametro[]>([]);
  useEffect(() => {
    api.getRaw<ListaParametro[]>("parametros/listas").then((r) => setListas(Array.isArray(r) ? r : [])).catch(() => setListas([]));
  }, []);
  // «Medio de envío (medio_envio)»: nombre legible y el código que usan los manuales.
  const etiquetas = Object.fromEntries(listas.map((l) => [l.categoria, `${l.nombre} (${l.categoria})`]));
  const conAlta = listas.filter((l) => l.alta).map((l) => l.categoria);
  return (
    <>
    <CrudTable
      titulo="Parámetros del sistema"
      subtitulo="Listas de opciones editables: agrega, modifica o desactiva valores (tipo de cliente, forma de pago, medio de envío, toma de muestra, cargos de costo, clases ONU…) sin intervención técnica. El valor de las reglas de la operación (cotización, encuestas, recepción, captura, Metrología) y los porcentajes de la tasa de internación se cambian, con motivo, en los recuadros al final de esta página."
      endpoint="parametros"
      accionesExtra={
        <>
          <a href="#parametros-operacion" className="btn outline sm">Parámetros de la operación ↓</a>
          <a href="#porcentajes-tasa" className="btn outline sm">Porcentajes de la tasa ↓</a>
        </>
      }
      columnas={[
        { key: "categoria", label: "Categoría", render: (v) => etiquetas[v] ?? v },
        { key: "codigo", label: "Código", render: codigoCell },
        { key: "etiqueta", label: "Etiqueta", editable: true },
        { key: "orden", label: "Orden", num: true, editable: { tipo: "number" } },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "categoria", label: "Categoría", requerido: true, tipo: "select", opciones: conAlta, etiquetasOpciones: etiquetas, soloLecturaEnEdicion: true },
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
