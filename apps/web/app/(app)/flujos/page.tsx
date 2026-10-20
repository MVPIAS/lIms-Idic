"use client";

/**
 * /flujos · Diseñador de flujos del motor genérico.
 * Oculto de la interfaz (lib/motorFlujos.ts): quien llegue por un marcador o un
 * enlace antiguo ve «no disponible» y un camino de vuelta, nunca un error.
 */
import Link from "next/link";
import { MOTOR_FLUJOS_VISIBLE } from "@/lib/motorFlujos";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
import DisenadorFlujos from "./_components/DisenadorFlujos";

export default function FlujosPage() {
  if (MOTOR_FLUJOS_VISIBLE) return <DisenadorFlujos />;
  return (
    <div>
      <PageHeader titulo="Diseñador de flujos" migas={[{ label: "Inicio", href: "/inicio" }, { label: "Diseñador de flujos" }]} />
      <EmptyState
        icono="⛓"
        titulo="Esta pantalla no está disponible"
        texto={
          <>
            El avance de cada orden de trabajo se ve en su expediente, en la <b>Ruta de la OT</b>, y se calcula con lo que
            realmente se ha hecho: muestras, resultados, informes, firmas, entrega, cierre y factura.
          </>
        }
        accion={
          <div className="toolbar" style={{ justifyContent: "center", margin: 0 }}>
            <Link href={"/ot" as any} className="btn primary sm">Ir a Órdenes de trabajo</Link>
            <Link href={"/inicio" as any} className="btn outline sm">Ir a Mi bandeja</Link>
          </div>
        }
      />
    </div>
  );
}
