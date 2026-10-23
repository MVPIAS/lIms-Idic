"use client";

import { useState } from "react";
import CrudTable from "@/components/CrudTable";
import { rut } from "@/lib/format";
import Plantas from "./_components/Plantas";

const badge = (v: any) => (
  <span className={`pill ${v ? "red" : "green"}`}>{v ? "bloqueado" : "activo"}</span>
);

/** «Días de crédito» llega como texto del formulario; la API lo espera entero (vacío = no se informa). */
const conDiasCredito = (d: any) => {
  const { diasCredito, ...resto } = d ?? {};
  const n = String(diasCredito ?? "").trim();
  return n === "" ? resto : { ...resto, diasCredito: Number(n) };
};

export default function ClientesPage() {
  const [plantasDe, setPlantasDe] = useState<{ id: string; razonSocial: string } | null>(null);
  return (
    <>
    <CrudTable
      prepararCrear={conDiasCredito}
      accionesFila={(row) => (
        <button type="button" className="btn outline sm" onClick={() => setPlantasDe({ id: row.id, razonSocial: row.razonSocial })}
          title="Plantas o recintos del cliente">
          Plantas
        </button>
      )}
      recurso="clientes"
      titulo="Clientes"
      subtitulo="Instituciones y empresas que solicitan ensayos. El flujo comercial arranca aquí."
      columnas={[
        { campo: "rut", titulo: "RUT", render: (v) => <span className="codigo">{rut(v)}</span> },
        { campo: "razonSocial", titulo: "Razón social" },
        {
          campo: "tipo",
          titulo: "Tipo",
          // Etiqueta de la lista vigente; un tipo antiguo (anterior a R2) se marca
          // para reclasificarlo al editar la ficha o al cotizar.
          render: (v, row) =>
            v ? (
              <>
                {row?.tipoEtiqueta ?? v}
                {row && row.tipoVigente === false && <span className="pill amber" style={{ marginLeft: 6 }}>tipo antiguo</span>}
              </>
            ) : (
              <span className="pill amber">sin tipo</span>
            ),
        },
        { campo: "ciudad", titulo: "Ciudad" },
        { campo: "telefono", titulo: "Teléfono" },
        { campo: "bloqueado", titulo: "Estado", render: badge },
      ]}
      campos={[
        { campo: "rut", label: "RUT", tipo: "rut", requerido: true },
        { campo: "razonSocial", label: "Razón social", requerido: true },
        // Tipo de cliente: leído de la maestra editable de parámetros de negocio
        // (§5), no hardcodeado. Gestionable en /catalogo/parametros → tipo_cliente.
        // Comercial R2: lista única (Ley 17.798, Ejército, …, Interlaboratorio); los
        // valores antiguos quedan inactivos y no se ofrecen (ver docs/COMERCIAL_RONDA2.md).
        { campo: "tipo", label: "Tipo de cliente", tipo: "select", requerido: true, opcionesEndpoint: "parametros?categoria=tipo_cliente&activo=true&limit=100" },
        // EP-00 0.1 (recorrido MP-02, D02-16): giro, dirección, forma de pago habitual y contacto principal.
        { campo: "giro", label: "Giro", requerido: true },
        { campo: "direccion", label: "Dirección", requerido: true, span: 2 },
        { campo: "ciudad", label: "Ciudad" },
        { campo: "region", label: "Región" },
        { campo: "telefono", label: "Teléfono", tipo: "telefono" },
        { campo: "email", label: "Email", tipo: "email" },
        { campo: "formaPagoHabitual", label: "Forma de pago habitual", tipo: "select", opcionesEndpoint: "parametros?categoria=forma_pago&activo=true&limit=50" },
        { campo: "diasCredito", label: "Días de crédito", tipo: "entero", ayuda: "Plazo de pago de sus facturas. Por defecto, 30." },
        { campo: "contactoNombre", label: "Contacto principal · nombre" },
        { campo: "contactoCargo", label: "Contacto principal · cargo" },
        { campo: "contactoEmail", label: "Contacto principal · correo", tipo: "email" },
        { campo: "contactoTelefono", label: "Contacto principal · teléfono", tipo: "telefono" },
      ]}
    />
    {plantasDe && <Plantas cliente={plantasDe} onCerrar={() => setPlantasDe(null)} />}
    </>
  );
}
