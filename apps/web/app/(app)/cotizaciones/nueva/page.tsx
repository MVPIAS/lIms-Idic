"use client";

/**
 * Nueva Cotización · Módulo Comercial LIMS IDIC (Comercial rondas 1 y 2, oct-2026)
 * -----------------------------------------------------------------------------
 * La cotización nace ABIERTA. Sus líneas son ensayos del catálogo (código EN)
 * valorizados por su ficha de costos; ya no se agregan HH/HM a mano, no hay
 * descuento ni «Tipo cotización» (Extensión/Comprensión). La validez se calcula
 * sola según la IT DCO-PG01-P01-IT02. IVA exento (ADM/imprimir.php:337).
 * El formulario vive en _components/CotizacionForm.tsx (se reutiliza al editar).
 */

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import CotizacionForm from "../_components/CotizacionForm";

export default function NuevaCotizacionPage() {
  return (
    <Suspense fallback={null}>
      <NuevaCotizacion />
    </Suspense>
  );
}

function NuevaCotizacion() {
  const router = useRouter();
  // «Crear cotización →» del CRM: ?oportunidad=<id>&cliente=<id> (EP-00 0.3).
  const sp = useSearchParams();
  const oportunidadId = sp.get("oportunidad") ?? undefined;
  const clienteInicialId = sp.get("cliente") ?? undefined;
  // Reunión 10: pre-cotización (valores referenciales, sin ensayos ni muestras; no genera OT).
  const precot = sp.get("tipo") === "precotizacion";
  return (
    <div>
      <Link href={"/cotizaciones" as any} className="subtitle" style={{ display: "inline-block", color: "var(--accent)", textDecoration: "none" }}>
        ← Cotizaciones
      </Link>
      <h1 className="page">{precot ? "Nueva pre-cotización" : "Nueva Cotización"}</h1>
      {precot ? (
        <p className="subtitle">
          Entrega <b>valores referenciales</b> (por ejemplo, para un proyecto del Ejército): sin ensayos ni muestras, y <b>no genera OT</b>. Lleva su propio número (PC-AAAA-NNNN); puede reemplazarse por una nueva versión y, cuando el cliente avance, se emite desde ella la cotización formal.
        </p>
      ) : (
        <p className="subtitle">
          Nace <b>Abierta</b>, con su número correlativo. Después, en su ficha: consulta al laboratorio (fechas y costo), V°B°, firma del Jefe DCO, envío al cliente y aceptación, que genera la OT.
        </p>
      )}
      {oportunidadId && <div className="alert info">Cotización desde una oportunidad del CRM: al guardarla queda enlazada y la oportunidad pasa a «Propuesta».</div>}
      <CotizacionForm
        modo="crear"
        precotizacion={precot}
        oportunidadId={oportunidadId}
        clienteInicialId={clienteInicialId}
        onGuardado={(c) => router.push(`/cotizaciones/${c?.id ?? ""}` as any)}
        onCancelar={() => router.push("/cotizaciones" as any)}
      />
    </div>
  );
}
