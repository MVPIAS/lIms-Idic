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
import { useMemo } from "react";
import { useAlcance, describirAlcance, type ItemBandeja } from "@/lib/alcance";
import { usePermisos, PERFIL_INFO, type Perfil } from "@/lib/permisos";
import { EmptyState, SkeletonCards } from "@/components/ui/PageHeader";

interface Accion { href: string; titulo: string; desc: string; icono: string; perm?: string | string[] }

/** Accesos rápidos por perfil (se muestran solo los que el permiso permite). */
const ACCIONES: Record<Perfil, Accion[]> = {
  ANALISTA: [
    { href: "/captura", titulo: "Capturar resultados", desc: "Registra las mediciones de tus ensayos", icono: "✍", perm: "resultado.crear" },
    { href: "/ot", titulo: "Mis órdenes de trabajo", desc: "Lo que tienes asignado y su avance", icono: "🗂", perm: "ot.ver" },
    { href: "/captura-ot", titulo: "Captura por OT", desc: "Todos los ensayos de una OT en una pantalla", icono: "📈", perm: "resultado.crear" },
    { href: "/muestras", titulo: "Muestras", desc: "Busca una muestra y su estado", icono: "🧫", perm: "muestra.ver" },
    { href: "/qc", titulo: "Control de calidad", desc: "Blancos, estándares y duplicados", icono: "✔", perm: "resultado.ver" },
  ],
  REVISOR: [
    { href: "/captura-ot", titulo: "Revisar resultados", desc: "Resultados capturados pendientes de revisión", icono: "🔍", perm: ["resultado.revisar", "resultado.crear"] },
    { href: "/qc", titulo: "Control de calidad", desc: "Verifica los controles de cada OT", icono: "✔", perm: "resultado.ver" },
    { href: "/ot", titulo: "Órdenes de trabajo", desc: "Estado de las OT de tu laboratorio", icono: "🗂", perm: "ot.ver" },
  ],
  JEFE_LAB: [
    { href: "/captura-ot", titulo: "Revisar y aprobar", desc: "Resultados listos para tu aprobación", icono: "✅", perm: ["resultado.aprobar", "resultado.revisar"] },
    { href: "/ot", titulo: "Asignar trabajo", desc: "Distribuye las OT entre tus analistas", icono: "👥", perm: "ot.ver" },
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
    { href: "/informes", titulo: "Firmar informes", desc: "Informes listos para tu firma", icono: "✒", perm: ["certificado.firmar", "certificado.emitir"] },
    { href: "/dashboard", titulo: "Indicadores por laboratorio", desc: "Carga, plazos y resultados del departamento", icono: "📊" },
    { href: "/certificados", titulo: "Certificados", desc: "Certificados emitidos y firmados", icono: "📜", perm: "ot.ver" },
    { href: "/reportes", titulo: "Reportes", desc: "Exporta datos del departamento", icono: "📤", perm: "resultado.ver" },
  ],
  DIRECTOR: [
    { href: "/informes", titulo: "Firmar", desc: "Documentos que requieren la firma de la Dirección", icono: "✒", perm: ["certificado.firmar", "certificado.emitir"] },
    { href: "/dashboard", titulo: "Indicadores por laboratorio", desc: "Visión general del instituto", icono: "📊" },
    { href: "/reportes", titulo: "Reportes", desc: "Información para la toma de decisiones", icono: "📤", perm: "resultado.ver" },
    { href: "/cotizaciones", titulo: "Cotizaciones", desc: "Propuestas comerciales en curso", icono: "💲", perm: "cotizacion.ver" },
  ],
  COMERCIAL: [
    { href: "/cotizaciones/nueva", titulo: "Nueva cotización", desc: "Con costeo en vivo", icono: "＋", perm: "cotizacion.crear" },
    { href: "/cotizaciones", titulo: "Cotizaciones por vencer", desc: "Haz seguimiento antes de que caduquen", icono: "⏳", perm: "cotizacion.ver" },
    { href: "/clientes", titulo: "Clientes", desc: "Fichas, contactos y condiciones", icono: "🏢", perm: "cliente.ver" },
    { href: "/internaciones", titulo: "Internaciones", desc: "Solicitudes de internación en curso", icono: "🛃", perm: "cotizacion.ver" },
    { href: "/crm", titulo: "Oportunidades", desc: "Pipeline comercial", icono: "🎯", perm: "cotizacion.ver" },
  ],
  PLANIFICACION: [
    { href: "/ot/nueva", titulo: "Registrar OT", desc: "Abre una orden de trabajo", icono: "＋", perm: "ot.crear" },
    { href: "/ot", titulo: "Órdenes de trabajo", desc: "Distribución y plazos", icono: "🗂", perm: "ot.ver" },
    { href: "/ordenes-internas", titulo: "Órdenes internas", desc: "Derivaciones entre laboratorios", icono: "🔀", perm: "cotizacion.ver" },
    { href: "/muestras", titulo: "Muestras", desc: "Recepción y ubicación", icono: "🧫", perm: "muestra.ver" },
  ],
  FINANZAS: [
    { href: "/ot", titulo: "OT por facturar", desc: "Trabajos terminados sin factura", icono: "🧮", perm: "ot.ver" },
    { href: "/facturas", titulo: "Facturas", desc: "Emitidas, pagadas y anuladas", icono: "📄", perm: "factura.ver" },
    { href: "/pagos", titulo: "Pagos", desc: "Registra y concilia pagos", icono: "💵", perm: "factura.ver" },
    { href: "/notas-credito", titulo: "Notas de crédito", desc: "Ajustes sobre facturas", icono: "🧾", perm: "factura.ver" },
  ],
  ABASTECIMIENTO: [
    { href: "/consumibles", titulo: "Stock de consumibles", desc: "Lotes, vencimientos y bajo mínimo", icono: "🧴", perm: "catalogo.gestionar" },
    { href: "/ordenes-compra", titulo: "Órdenes de compra", desc: "Emitidas, en curso y recibidas", icono: "🛒", perm: "factura.ver" },
    { href: "/proveedores", titulo: "Proveedores", desc: "Fichas de proveedores", icono: "🚚", perm: "factura.ver" },
  ],
  CALIDAD: [
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

function TarjetaPendiente({ it }: { it: ItemBandeja }) {
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
  return it.ruta
    ? <Link href={it.ruta as any} className={cls}>{cuerpo}</Link>
    : <div className={cls}>{cuerpo}</div>;
}

export default function InicioPage() {
  const { cargando, alcance, bandeja, fuente, bandejaDisponible } = useAlcance();
  const { puede, listo, perfilJwt, usuario } = usePermisos();

  const perfil: Perfil = (alcance?.perfil as Perfil) ?? perfilJwt;
  const info = PERFIL_INFO[perfil] ?? { etiqueta: perfil, descripcion: "" };
  const nombre = primerNombre(alcance?.usuario?.nombre ?? usuario.nombre ?? usuario.username);

  const acciones = useMemo(() => {
    const propias = (ACCIONES[perfil] ?? []).filter((a) => puede(a.perm));
    if (propias.length >= 2) return propias;
    // Perfil sin accesos útiles (o desconocido): accesos genéricos por permiso.
    const vistos = new Set(propias.map((a) => a.href));
    const extra = GENERICAS.filter((a) => !vistos.has(a.href) && puede(a.perm));
    return [...propias, ...extra].slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil, listo, puede]);

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
            {pendientes.map((it) => <TarjetaPendiente key={it.clave} it={it} />)}
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
