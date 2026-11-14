"use client";

import { useEffect, useState } from "react";
import CrudTable from "@/components/CrudTable";
import { rut } from "@/lib/format";
import { llamar } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";
import Plantas from "./_components/Plantas";
import HistorialCliente from "./_components/HistorialCliente";
import { BloqueoCliente, ClientesMorosos } from "./_components/BloqueoCliente";

const badge = (v: any) => (
  <span className={`pill ${v ? "red" : "green"}`} title={v ? "Bloqueado por el Jefe DCO: no recibe cotizaciones" : undefined}>{v ? "bloqueado" : "activo"}</span>
);

/** «Días de crédito» llega como texto del formulario; la API lo espera entero (vacío = no se informa). */
const conDiasCredito = (d: any) => {
  const { diasCredito, ...resto } = d ?? {};
  const n = String(diasCredito ?? "").trim();
  return n === "" ? resto : { ...resto, diasCredito: Number(n) };
};
/**
 * Contrato 4.1.3 · al editar, dejar vacíos la lista propia o el descuento los
 * QUITA (el formulario omite las referencias vacías; aquí viajan como null).
 */
const alActualizar = (d: any) => {
  const r = conDiasCredito(d);
  return {
    ...r,
    listaPrecioId: r.listaPrecioId || null,
    descuentoEspecialPct: r.descuentoEspecialPct === "" || r.descuentoEspecialPct == null ? null : r.descuentoEspecialPct,
    condicionesEspeciales: String(r.condicionesEspeciales ?? "").trim() || null,
  };
};
const pct = (v: any) => `${String(Number(v)).replace(".", ",")} %`;

export default function ClientesPage() {
  const [plantasDe, setPlantasDe] = useState<{ id: string; razonSocial: string } | null>(null);
  const [historialDe, setHistorialDe] = useState<{ id: string; razonSocial: string } | null>(null);
  // Reunión 2: bloqueo de clientes con facturas impagas (Jefe del Departamento Comercial).
  const [bloqueoDe, setBloqueoDe] = useState<any | null>(null);
  const [verMorosos, setVerMorosos] = useState(false);
  const [version, setVersion] = useState(0);
  // «Bloquear / Desbloquear» solo a quien tiene cliente.bloquear (Jefe DCO): al resto la API
  // le responde 403, así que no se le ofrece (F073, F079).
  const { puede } = usePermisos();
  const puedeBloquear = puede("cliente.bloquear");
  // ?historial=<id>: abre el historial de ese cliente (enlace del aviso «Próxima acción» de Mi bandeja).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("historial");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    llamar<{ id: string; razonSocial: string }>("GET", `/clientes/${id}`)
      .then((c) => setHistorialDe({ id: c.id, razonSocial: c.razonSocial }))
      .catch(() => undefined);
  }, []);
  return (
    <>
    <div className="toolbar" style={{ justifyContent: "flex-end", marginBottom: -6 }}>
      <button type="button" className="btn outline sm" onClick={() => setVerMorosos(true)} title="Clientes con facturas impagas vencidas y clientes bloqueados">
        Morosos y bloqueados
      </button>
    </div>
    <CrudTable
      key={version}
      prepararCrear={conDiasCredito}
      prepararActualizar={alActualizar}
      accionesFila={(row) => (
        <>
          <button type="button" className="btn outline sm" onClick={() => setHistorialDe({ id: row.id, razonSocial: row.razonSocial })}
            title="Interacciones, cotizaciones, OT, correos y documentos del cliente">
            Historial
          </button>{" "}
          <button type="button" className="btn outline sm" onClick={() => setPlantasDe({ id: row.id, razonSocial: row.razonSocial })}
            title="Plantas o recintos del cliente">
            Plantas
          </button>
          {puedeBloquear && (
            <>
              {" "}
              <button type="button" className={`btn sm ${row.bloqueado ? "success" : "outline"}`} onClick={() => setBloqueoDe(row)}
                title={row.bloqueado ? `Bloqueado: ${row.motivoBloqueo ?? ""}` : "Bloquear por facturas impagas (Jefe DCO)"}>
                {row.bloqueado ? "Desbloquear" : "Bloquear"}
              </button>
            </>
          )}
        </>
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
        {
          campo: "listaPrecioId",
          titulo: "Condiciones especiales",
          // Contrato 4.1.3: lista de precios propia y descuento especial (se aplican al cotizarle).
          render: (_v, row) =>
            row?.listaPrecio || Number(row?.descuentoEspecialPct) > 0 || row?.condicionesEspeciales ? (
              <span style={{ fontSize: 12 }}>
                {row.listaPrecio && <span className="tag" title="Lista de precios propia: manda al cotizarle">{row.listaPrecio.codigo}</span>}
                {Number(row.descuentoEspecialPct) > 0 && <span className="pill blue" style={{ marginLeft: 4 }}>−{pct(row.descuentoEspecialPct)}</span>}
                {row.condicionesEspeciales && <span className="pill gray" style={{ marginLeft: 4 }} title={row.condicionesEspeciales}>condiciones</span>}
              </span>
            ) : (
              "—"
            ),
        },
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
        // Comuna: la exige la factura electrónica (Facturas › Exportar para facturación).
        { campo: "comuna", label: "Comuna", ayuda: "La pide la factura electrónica del cliente." },
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
        // Contrato 4.1.1 / 4.1.3: condiciones comerciales especiales del cliente.
        {
          campo: "listaPrecioId",
          label: "Lista de precios propia",
          tipo: "ref",
          refRecurso: "listas-precio",
          refLabel: (r: any) => `${r.codigo ?? ""} · ${r.nombre ?? ""}${r.especial ? " (especial de cliente)" : ""}`,
          ayuda: "Opcional. Al cotizarle, los precios de esta lista mandan sobre la lista general (si está vigente y tiene el ensayo). Déjela vacía para usar la lista general.",
        },
        {
          campo: "descuentoEspecialPct",
          label: "Descuento especial (%)",
          tipo: "number",
          ayuda: "Opcional, de 0 a 99,99. Se descuenta del precio de cada ensayo que se le cotice y queda indicado en la línea.",
        },
        {
          campo: "condicionesEspeciales",
          label: "Condiciones especiales (se precargan en su cotización)",
          tipo: "textarea",
          span: 3,
          ayuda: "Texto que se agrega a «Condiciones adicionales» al cotizarle (p. ej. pago a 60 días, entrega de muestras en planta). La forma de pago habitual también se precarga.",
        },
      ]}
    />
    {plantasDe && <Plantas cliente={plantasDe} onCerrar={() => setPlantasDe(null)} />}
    {historialDe && <HistorialCliente cliente={historialDe} onCerrar={() => setHistorialDe(null)} />}
    {verMorosos && <ClientesMorosos onCerrar={() => setVerMorosos(false)} onElegir={puedeBloquear ? (c) => { setVerMorosos(false); setBloqueoDe(c); } : undefined} />}
    {bloqueoDe && <BloqueoCliente cliente={bloqueoDe} onCerrar={() => setBloqueoDe(null)} onHecho={() => { setBloqueoDe(null); setVersion((v) => v + 1); }} />}
    </>
  );
}
