"use client";

/**
 * BPCH · SAEC › Certificación de armas › expediente de la OT (EP-11, camino A).
 * Pasos numerados del procedimiento de la Delegación Nº 11, un formulario por
 * paso con su botón «Verbo → siguiente», el estado de cada arma (una arma = una
 * muestra de la OT) y los documentos: acta, etiquetas, certificados por arma y
 * guía de entrega. La revisión y aprobación de resultados es la del flujo
 * general (Captura y revisión por OT). API: /d11/ot/:id.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader, Skeleton } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { toast } from "@/components/ui/feedback";
import { abrirDocumento } from "@/lib/bpchProcesos";
import { pedir, type Accion, type ExpedienteD11 } from "@/lib/d11";
import { Acta, Llegada, Programacion } from "./_components/Recepcion";
import RegistroArmas from "./_components/RegistroArmas";
import Clasificacion from "./_components/Clasificacion";
import EnsayosArma from "./_components/EnsayosArma";
import { Acunacion, Certificados, Revision } from "./_components/Certificados";
import Entrega from "./_components/Entrega";

export default function ExpedienteD11Page() {
  return (
    <RequierePermiso perm="arma.ver" titulo="Certificación de armas">
      <Expediente />
    </RequierePermiso>
  );
}

function Expediente() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<ExpedienteD11 | null>(null);
  const [error, setError] = useState("");
  const [paso, setPaso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await pedir<ExpedienteD11>("GET", `/d11/ot/${id}`);
      setD(r);
      setError("");
      return r;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [id]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Ejecuta una acción del expediente; si devuelve el expediente lo usa, si no, recarga. */
  const accion: Accion = useCallback(
    async (metodo, ruta, cuerpo, okTexto) => {
      try {
        const r = await pedir<any>(metodo, ruta, cuerpo);
        const exp = r?.avance ? r : r?.expediente?.avance ? r.expediente : null;
        if (exp) setD(exp);
        else await cargar();
        toast.ok(okTexto);
        return r ?? {};
      } catch (e: any) {
        toast.error(e.message);
        return null;
      }
    },
    [cargar],
  );

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!d) return <div style={{ display: "grid", gap: 10 }} aria-busy="true"><Skeleton h={22} w="40%" /><Skeleton h={240} /></div>;

  const actual = d.avance.pasos[d.avance.actual - 1];
  const elegido = paso ?? actual.clave;
  const abierta = d.ot.abierta;
  const verEtiquetas = () => abrirDocumento(`/d11/ot/${d.ot.id}/etiquetas`).catch((e) => toast.error(e.message));

  return (
    <div>
      <PageHeader
        icono="🎯"
        titulo={<>Armas · OT <span className="codigo">{d.ot.codigo}</span></>}
        subtitulo={
          <>
            {d.ot.cliente ?? "Sin importador"}
            {d.ot.resolucion ? <> · Resolución DGMN <b>{d.ot.resolucion}</b></> : null}
            {d.internacion ? <> · expediente {d.internacion.numero}</> : null}
            {" · "}{d.armas.length} arma(s) registrada(s){d.segunResolucion != null ? ` de ${d.segunResolucion} según resolución` : ""}
          </>
        }
        migas={[{ label: "BPCH · SAEC" }, { label: "Certificación de armas", href: "/saec/ot" }, { label: d.ot.codigo }]}
        acciones={
          <>
            <span className={`pill ${abierta ? "teal" : "gray"}`}>{d.ot.estado}</span>
            {d.armas.length > 0 && <button type="button" className="btn outline sm" onClick={verEtiquetas}>Etiquetas</button>}
            <Link href={`/ot/${d.ot.id}` as any} className="btn outline sm">Ficha de la OT</Link>
          </>
        }
      />

      <section className={`siguiente-paso${d.avance.completo ? " cerrada" : ""}`} aria-label="Siguiente paso del expediente">
        <div className="sp-fila">
          <div className="sp-texto">
            {d.avance.completo ? (
              <div><b>Todas las armas certificadas o con su destino y entregadas.</b> Cierre la OT en su ficha (Informe y cierre).</div>
            ) : (
              <>
                <div><span className="sp-etq">Siguiente paso</span> {d.avance.actual}. {actual.titulo} · <b>{actual.boton}</b></div>
                <div className="sp-quien"><span className="sp-etq">Le toca a</span> {actual.leToca} · {actual.detalle}</div>
              </>
            )}
          </div>
          {!d.avance.completo && elegido !== actual.clave && (
            <button type="button" className="btn primary sm" onClick={() => setPaso(actual.clave)}>Ir al paso {d.avance.actual}</button>
          )}
        </div>
      </section>

      <div className="expgrid">
        <nav className="stepper" aria-label="Pasos de la certificación de armas">
          {d.avance.pasos.map((p, i) => (
            <button
              key={p.clave}
              type="button"
              className={`step ${p.estado === "hecho" ? "done" : i + 1 === d.avance.actual && !d.avance.completo ? "now" : ""} ${elegido === p.clave ? "active" : ""}`}
              style={{ width: "100%", textAlign: "left", border: 0, background: elegido === p.clave ? undefined : "transparent", font: "inherit" }}
              aria-current={elegido === p.clave ? "step" : undefined}
              aria-label={`Paso ${i + 1}: ${p.titulo} · ${p.estado === "hecho" ? "hecho" : p.estado === "en_curso" ? "en curso" : "pendiente"} · le toca a ${p.leToca}`}
              onClick={() => setPaso(p.clave)}
            >
              <span className="dot" aria-hidden>{p.estado === "hecho" ? "✓" : i + 1}</span>
              <span className="txt">
                {p.titulo}
                <small>{p.estado === "hecho" ? "Hecho" : p.estado === "en_curso" ? "En curso" : "Pendiente"} · {p.detalle}</small>
                <span className="rolechip">{p.leToca}</span>
              </span>
            </button>
          ))}
        </nav>

        <div>
          {!abierta && <div className="alert info">La OT está {d.ot.estado}: el expediente queda en consulta.</div>}
          {elegido === "programacion" && <Programacion d={d} accion={accion} />}
          {elegido === "llegada" && <Llegada d={d} accion={accion} />}
          {elegido === "acta" && <Acta d={d} accion={accion} />}
          {elegido === "registro" && <RegistroArmas d={d} accion={accion} onEtiquetas={verEtiquetas} />}
          {elegido === "clasificacion" && <Clasificacion d={d} accion={accion} />}
          {elegido === "ensayos" && <EnsayosArma d={d} onCambio={cargar} />}
          {elegido === "revision" && <Revision d={d} />}
          {elegido === "acunacion" && <Acunacion d={d} accion={accion} />}
          {elegido === "certificados" && <Certificados d={d} accion={accion} />}
          {elegido === "entrega" && <Entrega d={d} accion={accion} />}
        </div>
      </div>
    </div>
  );
}
