"use client";

/**
 * «Mi bandeja» · pantalla de inicio según el perfil.
 *
 *  · Saludo + perfil + alcance en palabras («Ves LCC y LTX»).
 *  · Tarjetas de trabajo pendiente (GET /me/bandeja) con cantidad y severidad.
 *  · Accesos rápidos según el perfil, filtrados por permiso.
 *
 * Si /me/alcance o /me/bandeja no existen todavía (404) o fallan, la pantalla
 * NO se rompe: el perfil se deduce de los roles del JWT y se muestran accesos
 * rápidos genéricos según los permisos.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { toast } from "@/components/ui/feedback";
import { useAlcance, describirAlcance, type ItemBandeja } from "@/lib/alcance";
import { usePermisos, infoPerfil, esSoloMuestreo, type Perfil } from "@/lib/permisos";
import { EmptyState, SkeletonCards } from "@/components/ui/PageHeader";
import AvisosBandeja from "@/components/avisos/AvisosBandeja";
import { fechaDia } from "@/lib/format";

interface Accion { href: string; titulo: string; desc: string; icono: string; perm?: string | string[] }

/** Accesos rápidos por perfil (se muestran solo los que el permiso permite). */
const ACCIONES: Record<Perfil, Accion[]> = {
  ANALISTA: [
    { href: "/captura-ot", titulo: "Capturar resultados", desc: "Registra las mediciones de tus ensayos", icono: "✍", perm: "resultado.crear" },
    { href: "/ot?mias=1&estado=abiertas", titulo: "Mis órdenes de trabajo", desc: "Lo que tienes asignado y su avance", icono: "🗂", perm: "ot.ver" },
    { href: "/captura-ot?estado=pendiente,devuelto&asignados=1", titulo: "Captura por OT", desc: "Todos los ensayos de una OT en una pantalla", icono: "📈", perm: "resultado.crear" },
    { href: "/muestras", titulo: "Muestras recibidas", desc: "Busca una muestra recibida en una OT y su estado", icono: "🧫", perm: "muestra.ver" },
    { href: "/qc", titulo: "Control de calidad", desc: "Blancos, estándares y duplicados", icono: "✔", perm: "resultado.ver" },
  ],
  REVISOR: [
    { href: "/captura-ot?estado=capturado", titulo: "Revisar resultados", desc: "Resultados capturados pendientes de revisión", icono: "🔍", perm: ["resultado.revisar", "resultado.crear"] },
    { href: "/qc", titulo: "Control de calidad", desc: "Verifica los controles de cada OT", icono: "✔", perm: "resultado.ver" },
    { href: "/ot", titulo: "Órdenes de trabajo", desc: "Estado de las OT de tu laboratorio", icono: "🗂", perm: "ot.ver" },
  ],
  JEFE_LAB: [
    { href: "/captura-ot?estado=revisado_n1", titulo: "Revisar y aprobar", desc: "Resultados listos para tu aprobación", icono: "✅", perm: ["resultado.aprobar", "resultado.revisar"] },
    { href: "/ot?sinAsignar=1&estado=abiertas", titulo: "Asignar trabajo", desc: "Distribuye las OT entre tus analistas", icono: "👥", perm: "ot.asignar" },
    { href: "/qc", titulo: "Control de calidad", desc: "Controles aprobados y pendientes", icono: "✔", perm: "resultado.ver" },
    { href: "/equipos", titulo: "Equipos y calibración", desc: "Vencimientos y estado de equipos", icono: "⚙", perm: "equipo.ver" },
    { href: "/informes", titulo: "Emitir informe", desc: "Genera el informe de una OT terminada", icono: "🖨", perm: "certificado.emitir" },
  ],
  JEFE_SECCION: [
    { href: "/captura-ot", titulo: "Revisar y aprobar", desc: "Resultados de los laboratorios de la sección", icono: "✅", perm: ["resultado.aprobar", "resultado.revisar"] },
    { href: "/ot", titulo: "Órdenes de trabajo", desc: "Avance por laboratorio", icono: "🗂", perm: "ot.ver" },
    { href: "/dashboard", titulo: "Indicadores", desc: "Resumen de la sección", icono: "📊" },
  ],
  JEFE_DEPTO: [
    { href: "/informes/por-firmar", titulo: "Firmar informes", desc: "Informes listos para tu firma", icono: "✒", perm: "documento.firmar" },
    { href: "/dashboard", titulo: "Indicadores por laboratorio", desc: "Carga, plazos y resultados del departamento", icono: "📊" },
    { href: "/certificados", titulo: "Certificados", desc: "Firma, entrega y anulación de informes", icono: "📜", perm: "ot.ver" },
    { href: "/reportes", titulo: "Reportes", desc: "Exporta datos del departamento", icono: "📤", perm: "resultado.ver" },
  ],
  DIRECTOR: [
    { href: "/informes/por-firmar", titulo: "Firmar", desc: "Documentos que requieren la firma de la Dirección", icono: "✒", perm: "documento.firmar" },
    { href: "/dashboard", titulo: "Indicadores por laboratorio", desc: "Visión general del instituto", icono: "📊" },
    { href: "/reportes", titulo: "Reportes", desc: "Información para la toma de decisiones", icono: "📤", perm: "resultado.ver" },
    { href: "/cotizaciones", titulo: "Cotizaciones", desc: "Propuestas comerciales en curso", icono: "💲", perm: "cotizacion.ver" },
  ],
  COMERCIAL: [
    { href: "/cotizaciones/nueva", titulo: "Nueva cotización", desc: "Con costeo en vivo", icono: "＋", perm: "cotizacion.crear" },
    { href: "/cotizaciones?porVencer=1", titulo: "Cotizaciones por vencer", desc: "Haz seguimiento antes de que caduquen", icono: "⏳", perm: "cotizacion.ver" },
    { href: "/clientes", titulo: "Clientes", desc: "Fichas, contactos y condiciones", icono: "🏢", perm: "cliente.ver" },
    { href: "/bpch/internaciones", titulo: "Internaciones", desc: "Solicitudes de internación en curso", icono: "🛃", perm: "bpch.internacion.ver" },
    { href: "/crm", titulo: "Oportunidades", desc: "Pipeline comercial", icono: "🎯", perm: "cotizacion.ver" },
  ],
  PLANIFICACION: [
    { href: "/ot/nueva", titulo: "Registrar OT", desc: "Abre una orden de trabajo", icono: "＋", perm: "ot.crear" },
    { href: "/ot", titulo: "Órdenes de trabajo", desc: "Distribución y plazos", icono: "🗂", perm: "ot.ver" },
    { href: "/ordenes-internas", titulo: "Órdenes internas", desc: "Derivaciones entre laboratorios", icono: "🔀", perm: "ot.ver" },
    { href: "/muestras", titulo: "Muestras recibidas", desc: "Recepción y ubicación", icono: "🧫", perm: "muestra.ver" },
  ],
  FINANZAS: [
    { href: "/ot", titulo: "OT por facturar", desc: "Trabajos terminados sin factura", icono: "🧮", perm: "ot.ver" },
    { href: "/facturas", titulo: "Facturas", desc: "Emitidas, pagadas y anuladas", icono: "📄", perm: "factura.ver" },
    { href: "/pagos", titulo: "Pagos", desc: "Registra y concilia pagos", icono: "💵", perm: "factura.ver" },
    { href: "/notas-credito", titulo: "Notas de crédito", desc: "Ajustes sobre facturas", icono: "🧾", perm: "factura.ver" },
  ],
  ABASTECIMIENTO: [
    { href: "/consumibles", titulo: "Stock de consumibles", desc: "Lotes, vencimientos y bajo mínimo", icono: "🧴", perm: "consumible.gestionar" },
    { href: "/ordenes-compra", titulo: "Órdenes de compra", desc: "Emitidas, en curso y recibidas", icono: "🛒", perm: "compra.ver" },
    { href: "/proveedores", titulo: "Proveedores", desc: "Fichas de proveedores", icono: "🚚", perm: "compra.ver" },
  ],
  CALIDAD: [
    { href: "/no-conformidades", titulo: "No conformidades", desc: "Tratamiento, plazos y cierre", icono: "⚠", perm: "nc.ver" },
    { href: "/qc", titulo: "Control de calidad", desc: "Controles por OT", icono: "✔", perm: "resultado.ver" },
    { href: "/spc", titulo: "Control estadístico", desc: "Cartas de control y tendencias", icono: "📉", perm: "resultado.ver" },
    { href: "/equipos", titulo: "Equipos y calibración", desc: "Calibraciones vencidas o próximas", icono: "⚙", perm: "equipo.ver" },
    { href: "/custodia", titulo: "Cadena de custodia", desc: "Trazabilidad de las muestras", icono: "🔗", perm: "muestra.ver" },
  ],
  ADMIN: [
    { href: "/admin/usuarios", titulo: "Usuarios sin rol", desc: "Asigna un rol a las cuentas nuevas", icono: "👥", perm: "admin.usuarios" },
    { href: "/admin/estructura", titulo: "Estructura", desc: "Departamentos, secciones y laboratorios", icono: "🏛", perm: ["admin.estructura", "admin.usuarios"] },
    { href: "/admin/roles", titulo: "Roles y permisos", desc: "Qué puede hacer cada rol", icono: "🔑", perm: ["admin.roles", "admin.usuarios"] },
    { href: "/catalogo/parametros", titulo: "Parámetros", desc: "Listas y combos del sistema", icono: "🎛", perm: "catalogo.gestionar" },
    { href: "/catalogo", titulo: "Tablas maestras", desc: "Catálogo de productos y análisis", icono: "🗃", perm: "catalogo.gestionar" },
  ],
  LECTOR: [
    { href: "/reportes", titulo: "Reportes", desc: "Consulta y exporta información", icono: "📊", perm: "resultado.ver" },
    { href: "/documentos", titulo: "Documentos", desc: "Busca informes y certificados", icono: "🗄", perm: "ot.ver" },
    { href: "/saec/verificar", titulo: "Verificar certificado", desc: "Comprueba la autenticidad de un certificado", icono: "🔎" },
  ],
};

/** B-070: accesos de la Sección Muestreo (cae en el perfil COMERCIAL pero no cotiza). */
const ACCIONES_MUESTREO: Accion[] = [
  { href: "/ot?estado=abiertas", titulo: "OT por muestrear", desc: "Abra la OT y registre el muestreo en su pestaña «Muestreo»", icono: "🧪", perm: "ot.ver" },
  { href: "/muestras", titulo: "Muestras recibidas", desc: "Muestras entregadas a los laboratorios", icono: "🧫", perm: "muestra.ver" },
];

/** Accesos genéricos (respaldo): los primeros que el permiso permita. */
const GENERICAS: Accion[] = [
  ...ACCIONES.ANALISTA.slice(0, 2),
  ...ACCIONES.COMERCIAL.slice(0, 2),
  ACCIONES.JEFE_LAB[0],
  ACCIONES.FINANZAS[1],
  ACCIONES.ABASTECIMIENTO[0],
  ACCIONES.CALIDAD[0],
  ACCIONES.ADMIN[0],
  ACCIONES.LECTOR[0],
  { href: "/dashboard", titulo: "Panel de indicadores", desc: "Resumen general del sistema", icono: "📊" },
];

function saludoHora(): string {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

function primerNombre(n?: string): string {
  if (!n) return "";
  const limpio = n.trim().split(/\s+/);
  return limpio[0] ?? "";
}

/**
 * B-042 (EP-00 6.2, manual por rol): «Avisar →» en las tarjetas de plazos. Avisa
 * ahora a los responsables de las OT vencidas o por vencer de su alcance
 * (POST /avisos/plazos, permiso ot.seguimiento), además del aviso diario.
 */
function BotonAvisar({ clave }: { clave: string }) {
  const [ocupado, setOcupado] = useState(false);
  async function avisar() {
    setOcupado(true);
    try {
      const r = await llamar<{ vencidas: number; porVencer: number; personas: number }>("POST", "/avisos/plazos", {});
      toast.ok(
        r.personas
          ? `Aviso enviado a ${r.personas} persona(s): ${r.vencidas} OT vencida(s) y ${r.porVencer} por vencer.`
          : "No hay a quién avisar: las OT de su alcance ya fueron avisadas hoy o no tienen responsable.",
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <button type="button" className="btn outline sm" style={{ marginTop: 8 }} disabled={ocupado} onClick={avisar}
      aria-label={clave === "ot_vencidas" ? "Avisar a los responsables de las OT vencidas" : "Avisar a los responsables de las OT por vencer"}>
      {ocupado ? "Avisando…" : "Avisar →"}
    </button>
  );
}

function TarjetaPendiente({ it, puedeAvisar }: { it: ItemBandeja; puedeAvisar?: boolean }) {
  const avisar = puedeAvisar && it.cantidad > 0 && ["ot_por_vencer", "ot_vencidas"].includes(it.clave);
  const cls = `bandeja-item ${it.cantidad === 0 ? "cero" : it.severidad}`;
  const cuerpo = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="bandeja-num">{it.cantidad.toLocaleString("es-CL")}</div>
        {it.severidad === "alta" && it.cantidad > 0 && <span className="pill red">urgente</span>}
        {it.severidad === "warn" && it.cantidad > 0 && <span className="pill amber">atención</span>}
      </div>
      <div className="bandeja-tit">{it.titulo}</div>
      {it.descripcion && <div className="bandeja-desc">{it.descripcion}</div>}
      {it.ruta && <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 6, fontWeight: 600 }}>Ver detalle →</div>}
    </>
  );
  // Con su lista («lo que le toca»): la tarjeta no es un enlace (habría enlaces anidados);
  // cada fila lleva a su OT, documento u oficio y «Ver todo» abre la lista completa.
  if (it.elementos?.length)
    return (
      <div className={cls}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="bandeja-num">{it.cantidad.toLocaleString("es-CL")}</div>
          {it.severidad === "alta" && <span className="pill red">urgente</span>}
          {it.severidad === "warn" && <span className="pill amber">atención</span>}
        </div>
        <div className="bandeja-tit">{it.titulo}</div>
        {it.descripcion && <div className="bandeja-desc">{it.descripcion}</div>}
        <ul className="bandeja-lista" aria-label={`Lo que le toca: ${it.titulo}`}>
          {it.elementos.map((e) => (
            <li key={e.id}>
              <Link href={e.ruta as any}>
                <b>{e.texto}</b>
                {e.detalle ? <span>{e.detalle}</span> : <span />}
                {e.fecha ? <time dateTime={e.fecha}>{fechaDia(e.fecha)}</time> : null}
              </Link>
            </li>
          ))}
        </ul>
        {it.ruta && (
          <Link href={it.ruta as any} className="bandeja-ver">
            {it.cantidad > it.elementos.length ? `Ver los ${it.cantidad.toLocaleString("es-CL")} →` : "Ver lista →"}
          </Link>
        )}
        {avisar && <BotonAvisar clave={it.clave} />}
      </div>
    );
  if (avisar)
    return (
      <div className={cls}>
        {it.ruta ? <Link href={it.ruta as any} style={{ color: "inherit", textDecoration: "none", display: "block" }}>{cuerpo}</Link> : cuerpo}
        <BotonAvisar clave={it.clave} />
      </div>
    );
  return it.ruta
    ? <Link href={it.ruta as any} className={cls}>{cuerpo}</Link>
    : <div className={cls}>{cuerpo}</div>;
}

export default function InicioPage() {
  const { cargando, alcance, bandeja, fuente, bandejaDisponible } = useAlcance();
  const { puede, listo, perfilJwt, usuario, roles } = usePermisos();

  const perfil: Perfil = (alcance?.perfil as Perfil) ?? perfilJwt;
  const info = infoPerfil(perfil, roles);
  const nombre = primerNombre(alcance?.usuario?.nombre ?? usuario.nombre ?? usuario.username);

  const acciones = useMemo(() => {
    const propias = (perfil === "COMERCIAL" && esSoloMuestreo(roles) ? ACCIONES_MUESTREO : ACCIONES[perfil] ?? []).filter((a) => puede(a.perm));
    if (propias.length >= 2) return propias;
    // Perfil sin accesos útiles (o desconocido): accesos genéricos por permiso.
    const vistos = new Set(propias.map((a) => a.href));
    const extra = GENERICAS.filter((a) => !vistos.has(a.href) && puede(a.perm));
    return [...propias, ...extra].slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil, listo, puede, roles]);

  // Pendientes: primero lo urgente, luego lo que tiene cantidad.
  const orden: Record<string, number> = { alta: 0, warn: 1, info: 2 };
  const pendientes = [...bandeja].sort(
    (a, b) => (b.cantidad > 0 ? 1 : 0) - (a.cantidad > 0 ? 1 : 0) || orden[a.severidad] - orden[b.severidad],
  );
  const totalPendiente = pendientes.reduce((s, x) => s + x.cantidad, 0);

  return (
    <div>
      <div className="saludo">
        <div>
          <h1>{saludoHora()}{nombre ? `, ${nombre}` : ""}</h1>
          <p>{cargando ? "Cargando tu información…" : describirAlcance(alcance)}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className="chip" title={info.descripcion}>{info.etiqueta}</span>
          {!cargando && bandejaDisponible && (
            <p style={{ marginTop: 6 }}>
              {totalPendiente === 0 ? "Sin pendientes por ahora" : `${totalPendiente.toLocaleString("es-CL")} pendiente(s) en total`}
            </p>
          )}
        </div>
      </div>

      {info.descripcion && (
        <p className="subtitle" style={{ marginTop: -4 }}>
          <b>Tu perfil:</b> {info.descripcion}
        </p>
      )}

      <AvisosBandeja />

      <div className="card">
        <h2>Lo que tienes pendiente</h2>
        {cargando ? (
          <SkeletonCards n={4} />
        ) : !bandejaDisponible ? (
          <div className="alert info" style={{ marginBottom: 0 }}>
            Tu bandeja de pendientes todavía no está disponible en este servidor. Mientras tanto, usa los
            accesos rápidos de abajo para ir directo a tu trabajo.
          </div>
        ) : pendientes.length === 0 ? (
          <EmptyState compacto icono="🎉" titulo="¡Todo al día!" texto="No tienes trabajo pendiente asignado en este momento." />
        ) : (
          <div className="bandeja" style={{ marginBottom: 0 }}>
            {pendientes.map((it) => <TarjetaPendiente key={it.clave} it={it} puedeAvisar={puede("ot.seguimiento")} />)}
          </div>
        )}
      </div>

      <div className="card">
        <h2>
          Accesos rápidos
          <span className="right">{fuente === "jwt" && !cargando ? "según tus permisos" : `para ${info.etiqueta.toLowerCase()}`}</span>
        </h2>
        {!listo ? (
          <SkeletonCards n={3} alto={56} />
        ) : acciones.length === 0 ? (
          <EmptyState compacto icono="🔒" titulo="Sin accesos asignados"
            texto="Tu cuenta aún no tiene permisos. Pide a la administración del sistema que te asigne un rol." />
        ) : (
          <div className="acciones-rapidas">
            {acciones.map((a) => (
              <Link key={a.href + a.titulo} href={a.href as any} className="accion-rapida">
                <span className="ar-ico" aria-hidden>{a.icono}</span>
                <span>
                  <b>{a.titulo}</b>
                  <small>{a.desc}</small>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {alcance && alcance.roles.length > 0 && fuente === "api" && (
        <p className="subtitle">
          Roles asignados:{" "}
          {alcance.roles.map((r, i) => (
            <span key={`${r.codigo}-${i}`} className="pill gray" style={{ marginRight: 4 }}>
              {r.nombre ?? r.codigo}{r.unidad?.codigo ? ` · ${r.unidad.codigo}` : typeof r.unidad === "string" ? ` · ${r.unidad}` : ""}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
