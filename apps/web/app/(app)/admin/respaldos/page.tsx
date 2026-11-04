"use client";

/**
 * /admin/respaldos · Respaldos de la base de datos (contrato §4.8.4).
 * Estado verde/rojo, último respaldo, próximo programado, servicio, política de
 * retención e historial de ejecuciones (`respaldo_registro`). «Respaldar ahora»
 * deja una solicitud que el servicio de respaldo atiende en menos de un minuto.
 * API: /respaldos (permiso admin.respaldos). Guía y restauración: docs/RESPALDOS_Y_BI.md.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { AdminGuard, CabeceraAdmin, EstadoError, EstadoVacio, SkeletonLineas, useCarga, useConfirm, useToast } from "@/components/admin/ui";

interface Ejecucion {
  id: number;
  tipo: "programado" | "manual";
  resultado: "SOLICITADO" | "EN_CURSO" | "OK" | "ERROR";
  solicitadoAt: string;
  solicitadoPor: string | null;
  inicio: string | null;
  fin: string | null;
  duracionS: number | null;
  tamanoTexto: string | null;
  objetos: number | null;
  archivo: string | null;
  nivel: string | null;
  disponible: boolean;
  mensaje: string | null;
}
interface Panel {
  instalado: boolean;
  estado: { color: "verde" | "rojo"; titulo: string; motivos: string[]; servicioActivo: boolean };
  politica: { hora: string; retencionDiarios: number; retencionSemanales: number; retencionMensuales: number; horasAlerta: number; avisarFallo: boolean };
  proximo: string;
  servicio: { modo: string; latidoAt: string; activo: boolean; directorio: string | null; libreMb: number | null; servidor: string | null } | null;
  puedeSolicitar: boolean;
  ultimo: Ejecucion | null;
  ultimoOk: Ejecucion | null;
  pendiente: Ejecucion | null;
  historial: Ejecucion[];
}

const RESULTADO: Record<string, { texto: string; pill: string }> = {
  OK: { texto: "Correcto", pill: "green" },
  ERROR: { texto: "Falló", pill: "red" },
  EN_CURSO: { texto: "En curso", pill: "blue" },
  SOLICITADO: { texto: "Pedido", pill: "amber" },
};

const duracion = (s: number | null) => (s === null || s === undefined ? "—" : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);
const nivelTexto = (n: string | null) => (n ? n.replace("diario", "Diario").replace("+semanal", " + semanal").replace("+mensual", " + mensual") : "—");

export default function RespaldosPage() {
  return (
    <AdminGuard permiso="admin.respaldos">
      <Respaldos />
    </AdminGuard>
  );
}

function Respaldos() {
  const datos = useCarga(() => llamar<Panel>("GET", "/respaldos"));
  const { puede } = usePermisos();
  const toast = useToast();
  const confirmar = useConfirm();
  const [pidiendo, setPidiendo] = useState(false);
  const d = datos.data;

  // Se actualiza sola: cada 10 s mientras hay un respaldo pedido o en curso; si no, cada minuto.
  const pendiente = !!d?.pendiente;
  useEffect(() => {
    const t = setInterval(() => datos.recargar(true), pendiente ? 10_000 : 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendiente]);

  async function respaldarAhora() {
    const ok = await confirmar({
      titulo: "¿Hacer un respaldo ahora?",
      mensaje: "Se hará una copia completa de la base de datos además de la programada. El LIMS sigue funcionando con normalidad mientras tanto.",
      confirmar: "Respaldar ahora",
    });
    if (!ok) return;
    setPidiendo(true);
    try {
      const r = await llamar<{ mensaje: string }>("POST", "/respaldos/solicitar");
      toast.ok(r.mensaje);
      datos.recargar(true);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPidiendo(false);
    }
  }

  return (
    <div>
      <CabeceraAdmin
        icono="💾"
        titulo="Respaldos"
        subtitulo={<>Copias de seguridad automáticas de la base de datos del LIMS: cuándo se hizo la última, cuándo toca la próxima, cuántas se conservan
          y el resultado de cada una. Si un respaldo falla o se atrasa, los administradores reciben un aviso en «Mi bandeja» (y por correo si está configurado).</>}
        acciones={
          <>
            <button className="btn outline" onClick={() => datos.recargar()}>↻ Actualizar</button>
            {d?.servicio?.modo === "contenedor" && (
              <button className="btn primary" onClick={respaldarAhora} disabled={pidiendo || !d.puedeSolicitar}
                title={d.puedeSolicitar ? undefined : d.pendiente ? "Ya hay un respaldo pedido o en curso." : "El servicio de respaldo no responde."}>
                💾 Respaldar ahora
              </button>
            )}
          </>
        }
      />

      {datos.error ? (
        <EstadoError error={datos.error} onReintentar={() => datos.recargar()} recurso="el estado de los respaldos" />
      ) : !d ? (
        <div className="card"><SkeletonLineas n={6} /></div>
      ) : (
        <>
          {!d.instalado && (
            <div className="alert warn">
              Falta preparar la base de datos para registrar los respaldos (archivo <span className="codigo">align_brechas_6.sql</span>). Avise al administrador de la plataforma.
            </div>
          )}

          <div className="card" style={{ borderLeft: `6px solid ${d.estado.color === "verde" ? "var(--green, #1f8a5b)" : "var(--red, #c0392b)"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className={`pill ${d.estado.color === "verde" ? "green" : "red"}`} style={{ fontSize: 13 }} role="status">
                {d.estado.color === "verde" ? "● " : "▲ "}{d.estado.titulo}
              </span>
              {d.pendiente && (
                <span className="pill blue">
                  ⏳ Respaldo n.º {d.pendiente.id} {d.pendiente.resultado === "EN_CURSO" ? "en curso" : "pedido: empieza en menos de un minuto"}
                </span>
              )}
            </div>
            {d.estado.motivos.length > 0 ? (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
                {d.estado.motivos.map((m) => <li key={m}>{m}</li>)}
              </ul>
            ) : (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
                El último respaldo terminó bien, tiene menos de {d.politica.horasAlerta} horas y el servicio de respaldo está en marcha.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" style={{ marginBottom: 12 }}>
            <Tarjeta titulo="Último respaldo">
              {d.ultimo ? (
                <>
                  <Valor>{fechaHora(d.ultimo.fin ?? d.ultimo.inicio)}</Valor>
                  <div><span className={`pill ${RESULTADO[d.ultimo.resultado]?.pill ?? "gray"}`}>{RESULTADO[d.ultimo.resultado]?.texto ?? d.ultimo.resultado}</span></div>
                  <Detalle>{d.ultimo.tamanoTexto ?? "—"} · {duracion(d.ultimo.duracionS)} · {d.ultimo.tipo === "manual" ? "pedido a mano" : "programado"}</Detalle>
                  {d.ultimo.resultado === "ERROR" && d.ultimoOk && <Detalle>Último correcto: {fechaHora(d.ultimoOk.fin)}</Detalle>}
                </>
              ) : (
                <Detalle>Aún no se ha hecho ningún respaldo.</Detalle>
              )}
            </Tarjeta>
            <Tarjeta titulo="Próximo respaldo programado">
              <Valor>{fechaHora(d.proximo)}</Valor>
              <Detalle>Todos los días a las {d.politica.hora} (hora de Chile).</Detalle>
              {!d.estado.servicioActivo && <Detalle><b>Solo se hará si el servicio de respaldo está en marcha.</b></Detalle>}
            </Tarjeta>
            <Tarjeta titulo="Servicio de respaldo">
              {d.servicio ? (
                <>
                  <div><span className={`pill ${d.servicio.activo ? "green" : "red"}`}>{d.servicio.activo ? "En marcha" : "No responde"}</span></div>
                  <Detalle>
                    {d.servicio.modo === "contenedor" ? "Servicio automático del servidor" : "Tarea programada del servidor (on-premise)"} · última señal {fechaHora(d.servicio.latidoAt)}
                  </Detalle>
                  {d.servicio.libreMb !== null && <Detalle>Espacio libre para respaldos: {(d.servicio.libreMb / 1024).toFixed(1).replace(".", ",")} GB</Detalle>}
                  {d.servicio.directorio && <Detalle>Carpeta: <span className="codigo">{d.servicio.directorio}</span></Detalle>}
                </>
              ) : (
                <>
                  <div><span className="pill red">No instalado</span></div>
                  <Detalle>Este servidor no tiene en marcha el respaldo programado. Avise al administrador de la plataforma.</Detalle>
                </>
              )}
            </Tarjeta>
            <Tarjeta titulo="Política de retención">
              <Valor>{d.politica.retencionDiarios} diarios · {d.politica.retencionSemanales} semanales{d.politica.retencionMensuales ? ` · ${d.politica.retencionMensuales} mensuales` : ""}</Valor>
              <Detalle>
                Se conservan los {d.politica.retencionDiarios} últimos respaldos diarios
                {d.politica.retencionSemanales ? ` y el del domingo de las ${d.politica.retencionSemanales} últimas semanas` : ""}
                {d.politica.retencionMensuales ? ` y el del día 1 de los ${d.politica.retencionMensuales} últimos meses` : ""}; los más antiguos se borran solos.
              </Detalle>
              <Detalle>Estado en rojo y aviso tras {d.politica.horasAlerta} h sin respaldo correcto · avisos {d.politica.avisarFallo ? "activados" : "desactivados"}.</Detalle>
              {puede("catalogo.gestionar") && d.servicio?.modo !== "systemd" && (
                <Detalle><Link href={"/catalogo/parametros" as any}>Cambiar en Parámetros del sistema › Respaldos de la base de datos →</Link></Detalle>
              )}
            </Tarjeta>
          </div>

          <div className="card card--table">
            <div className="toolbar" style={{ padding: "10px 12px", margin: 0 }}>
              <b>Historial de respaldos</b>
              <span className="spacer" />
              <small style={{ color: "var(--muted)" }}>{d.historial.length} ejecución(es) · las 60 más recientes</small>
            </div>
            {d.historial.length === 0 ? (
              <EstadoVacio icono="💾" titulo="Sin respaldos registrados" texto="Cuando el servicio de respaldo haga el primero, aparecerá aquí con su fecha, tamaño, duración y resultado." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>N.º</th>
                      <th>Tipo</th>
                      <th>Inicio</th>
                      <th>Duración</th>
                      <th>Tamaño</th>
                      <th>Resultado</th>
                      <th>Archivo</th>
                      <th>Mensaje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.historial.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td>
                          {r.tipo === "manual" ? "Pedido a mano" : "Programado"}
                          {r.solicitadoPor && <small style={{ display: "block", color: "var(--muted)" }}>por {r.solicitadoPor}</small>}
                        </td>
                        <td>{fechaHora(r.inicio ?? r.solicitadoAt)}</td>
                        <td>{duracion(r.duracionS)}</td>
                        <td>{r.tamanoTexto ?? "—"}</td>
                        <td><span className={`pill ${RESULTADO[r.resultado]?.pill ?? "gray"}`}>{RESULTADO[r.resultado]?.texto ?? r.resultado}</span></td>
                        <td>
                          {r.archivo ? (
                            <>
                              <span className="codigo" style={{ fontSize: 11.5 }}>{r.archivo}</span>
                              <small style={{ display: "block", color: "var(--muted)" }}>{nivelTexto(r.nivel)} · {r.disponible ? "en disco" : "ya rotado (borrado por antigüedad)"}</small>
                            </>
                          ) : "—"}
                        </td>
                        <td style={{ maxWidth: 360, fontSize: 12.5 }}>{r.mensaje ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="alert info mt-4">
            <b>¿Cómo se recupera un respaldo?</b> La restauración la hace el administrador de la plataforma en el servidor, nunca desde esta
            pantalla: primero en una base de prueba para comprobarla y, solo ante una pérdida real de datos, sobre la base en uso (lo anterior
            se respalda antes de sobrescribirlo). Cada respaldo de la tabla es un archivo verificado; el paso a paso está en la guía{" "}
            <span className="codigo">docs/RESPALDOS_Y_BI.md</span>.
          </div>
        </>
      )}
    </div>
  );
}

function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="card h-full" style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>{titulo}</div>
      <div style={{ display: "grid", gap: 4 }}>{children}</div>
    </div>
  );
}
const Valor = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 17, fontWeight: 700 }}>{children}</div>;
const Detalle = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{children}</div>;
