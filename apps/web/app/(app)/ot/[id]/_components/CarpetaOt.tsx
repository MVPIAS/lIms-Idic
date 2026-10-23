"use client";

/**
 * «Carpeta de Trabajo» de la OT (EP-05 9.3, LVM-PG01-IT05; contrato §4.6.2;
 * BL-175, frente r4c): todo lo que documenta la OT, con versiones — informes y
 * certificados (también devueltos y anulados), oficios, formularios
 * especializados (HCP, planillas, disparos) y sus adjuntos, muestreos, órdenes
 * internas, fotos, costos reales, documentos no-informe y envíos. Con la OT
 * cerrada, «Archivar → fin» registra quién, cuándo y dónde queda la carpeta.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { llamar } from "@/lib/laboratorio";
import { fechaDia, fechaHora, clp } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import { ESTADO_DOC, abrirPdf } from "@/lib/documentos";
import { ESTADO_OFICIO } from "@/lib/oficios";

export default function CarpetaOt({ otId }: { otId: string }) {
  const [c, setC] = useState<any>(null);
  const [error, setError] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setC(await llamar("GET", `/ot/${otId}/carpeta`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!c) return <p className="subtitle" style={{ margin: 0 }}>Cargando la carpeta…</p>;
  const s = c.secciones;
  const seccion = (titulo: string, n: number, cuerpo: React.ReactNode) => (
    <section style={{ marginBottom: 12 }} aria-label={titulo}>
      <h3 style={{ fontSize: 12.5, margin: "0 0 4px" }}>{titulo} <span style={{ fontWeight: 400, color: "var(--muted)" }}>({n})</span></h3>
      {n === 0 ? <p className="subtitle" style={{ margin: 0, fontSize: 12 }}>Nada registrado.</p> : cuerpo}
    </section>
  );
  const total = Object.values(s).reduce((a: number, x: any) => a + (x?.length ?? 0), 0);

  return (
    <div>
      <div className={`alert ${c.archivada ? "success" : "info"}`} style={{ marginTop: 0 }}>
        {c.archivada ? (
          <>Carpeta archivada el {fechaHora(c.archivada.at)}{c.archivada.ubicacion ? ` en ${c.archivada.ubicacion}` : ""}.</>
        ) : (
          <>Carpeta de Trabajo de la OT {c.ot.codigo}: {total} registro(s). {c.faltaParaArchivar ?? "Lista para archivar."}</>
        )}
      </div>

      {seccion(
        "Informes y certificados (todas las versiones)",
        s.documentos.length,
        <table className="data">
          <thead><tr><th>Número</th><th>Documento</th><th>Versión</th><th>Estado</th><th>Oficial</th><th>Entregado</th><th /></tr></thead>
          <tbody>
            {s.documentos.map((d: any) => {
              const e = ESTADO_DOC[d.estado] ?? { texto: d.estado, pill: "gray" };
              return (
                <tr key={d.id}>
                  <td className="codigo">{d.numero}</td>
                  <td>{d.plantilla ?? d.tipoDocumento ?? "—"}</td>
                  <td>{d.version}</td>
                  <td><span className={`pill ${e.pill}`}>{e.texto}</span></td>
                  <td>{d.oficialAt ? fechaDia(d.oficialAt) : "—"}</td>
                  <td>{d.entregadoAt ? fechaDia(d.entregadoAt) : "—"}</td>
                  <td style={{ textAlign: "right" }}><button type="button" className="btn ghost sm" onClick={() => abrirPdf(d.id, d.numero).catch((x) => toast.error(x.message))}>PDF</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>,
      )}
      {seccion(
        "Oficios conductores",
        s.oficios.length,
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {s.oficios.map((o: any) => (
            <li key={o.id}>
              <Link href={`/oficios/${o.id}` as any} style={{ color: "var(--accent)" }}>{o.numero ?? "(borrador)"}</Link> · {ESTADO_OFICIO[o.estado]?.texto ?? o.estado} · {o.materia}
              {o.despachoNumero ? ` · despacho Nº ${o.despachoNumero}` : ""}
            </li>
          ))}
        </ul>,
      )}
      {seccion(
        "Formularios del trabajo (HCP, planillas, disparos…)",
        s.formularios.length,
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {s.formularios.map((f: any) => <li key={f.id}>{f.variante}{f.clave ? ` · ${f.clave}` : ""} · {f.estado} · versión {f.version} · {fechaHora(f.updatedAt)}</li>)}
        </ul>,
      )}
      {seccion("Adjuntos de los formularios", s.adjuntos.length, <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{s.adjuntos.map((a: any) => <li key={a.id}>{a.nombre} · {a.variante} · {fechaDia(a.createdAt)}</li>)}</ul>)}
      {seccion(
        "Documentos no-informe (cartas, oficios en papel, copias)",
        s.registros.length,
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {s.registros.map((r: any) => (
            <li key={r.id} style={r.anuladoAt ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
              {r.tipo} Nº {r.numero}{r.version > 1 ? ` · v${r.version}` : ""} · {r.copias} copia(s) · {fechaDia(r.fecha)}{r.archivoNombre ? ` · ${r.archivoNombre}` : ""}
              {r.anuladoAt ? ` · anulado: ${r.motivoAnulacion}` : ""}
            </li>
          ))}
        </ul>,
      )}
      {seccion("Muestreos", s.muestreos.length, <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{s.muestreos.map((m: any) => <li key={m.numero}>Nº {m.numero} · {m.estado} · {fechaDia(m.createdAt)}</li>)}</ul>)}
      {seccion(
        "Órdenes internas",
        s.ordenes.length,
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {s.ordenes.map((o: any) => <li key={o.id}><Link href={`/ordenes-internas/${o.id}` as any} style={{ color: "var(--accent)" }}>{o.numero}</Link> · {o.estado}</li>)}
        </ul>,
      )}
      {seccion("Fotos del anexo", s.fotos.length, <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{s.fotos.map((f: any) => <li key={f.id}>{f.nombre ?? "foto"}{f.pie ? ` · ${f.pie}` : ""}</li>)}</ul>)}
      {seccion(
        "Planillas de costos reales",
        s.costos.length,
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {s.costos.map((k: any, i: number) => <li key={i}>{k.unidad ?? "—"} · {k.estado} · {clp(k.total)}{k.cerradaAt ? ` · cerrada ${fechaDia(k.cerradaAt)}` : ""}</li>)}
        </ul>,
      )}
      {seccion(
        "Envíos al cliente",
        s.envios.length,
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {s.envios.map((e: any, i: number) => <li key={i}>{fechaDia(e.fecha)} · {e.medio} · {e.destinatario}: {(e.documentos ?? []).map((x: any) => x.numero).join(", ")}</li>)}
        </ul>,
      )}

      {c.puedoArchivar && (
        <div className="toolbar" style={{ marginBottom: 0, alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0, minWidth: 260 }}>
            <label htmlFor="carpeta-ubic">Ubicación física de la carpeta</label>
            <input id="carpeta-ubic" value={ubicacion} maxLength={200} onChange={(e) => setUbicacion(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true);
              try {
                setC(await llamar("POST", `/ot/${otId}/carpeta/archivar`, ubicacion.trim() ? { ubicacion: ubicacion.trim() } : {}));
                toast.ok("Carpeta de Trabajo archivada.");
              } catch (e: any) {
                toast.error(e.message);
              } finally {
                setOcupado(false);
              }
            }}
          >
            Archivar → fin
          </button>
        </div>
      )}
    </div>
  );
}
