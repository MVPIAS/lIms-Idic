"use client";

/**
 * /bi · Análisis e inteligencia de negocio (Metabase) · contrato §4.7.5 / §4.5.7 / §4.6.5.
 *
 * Metabase corre aparte, en el subdominio bi.<dominio> (Caddyfile), conectado a
 * la base del LIMS con un usuario de SOLO LECTURA (lims_lectura,
 * align_brechas_6.sql). Esta pantalla solo lo enlaza: la dirección la da la API
 * (GET /sistema/bi, variable URL_BI) y, si no está configurada, lo dice.
 * Guía de instalación y tableros: docs/RESPALDOS_Y_BI.md.
 */
import { useEffect, useState } from "react";
import RequierePermiso from "@/components/RequierePermiso";
import { llamar } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";

interface ConfigBi {
  configurado: boolean;
  url: string | null;
  /** Acceso temporal: solo llega al administrador del LIMS (BI_ACCESO_* en el servidor). */
  acceso?: { usuario: string; clave: string } | null;
}

const TABLEROS = [
  { titulo: "Órdenes de trabajo por estado y mes", texto: "Cuántas OT entran cada mes y en qué estado están, por laboratorio." },
  { titulo: "Plazos de las órdenes de trabajo", texto: "OT abiertas en plazo, por vencer, vencidas o sin fecha comprometida, y el cumplimiento del plazo de las cerradas por mes." },
  { titulo: "Resultados «No cumple» por laboratorio", texto: "Resultados aprobados que no cumplen la especificación, por laboratorio y mes, con su porcentaje." },
];

export default function BiPage() {
  return (
    <RequierePermiso perm="reporte.ver" titulo="Análisis e inteligencia de negocio">
      <Bi />
    </RequierePermiso>
  );
}

function Bi() {
  const [cfg, setCfg] = useState<ConfigBi | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lo técnico (variable del servidor, guía, vistas de la base) solo al administrador (F094).
  const { admin } = usePermisos();

  useEffect(() => {
    llamar<ConfigBi>("GET", "/sistema/bi")
      .then(setCfg)
      .catch((e) => setError(e?.message ?? "No se pudo consultar la configuración."));
  }, []);

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 className="page">📈 Análisis e inteligencia de negocio (Metabase)</h1>
      <p className="subtitle">
        Tableros, gráficos y preguntas libres sobre los datos del LIMS con Metabase. Se abre en otra pestaña y lee la base del
        laboratorio con un usuario de <b>solo lectura</b>: lo que haga allí no cambia ningún dato del LIMS.
      </p>

      {error ? (
        <div className="alert warn">No se pudo consultar la dirección de Metabase: {error}</div>
      ) : !cfg ? (
        <div className="card">Consultando la configuración…</div>
      ) : cfg.configurado && cfg.url ? (
        <div className="card" style={{ borderLeft: "4px solid var(--primary)" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontWeight: 700 }}>Metabase está disponible en este servidor</div>
              <small style={{ color: "var(--muted)" }}>
                Dirección: <span className="codigo">{cfg.url}</span>
              </small>
            </div>
            <a className="btn primary" href={cfg.url} target="_blank" rel="noopener noreferrer">
              Abrir Metabase en otra pestaña ↗
            </a>
          </div>
          {cfg.acceso ? (
            <AccesoTemporal acceso={cfg.acceso} />
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10, marginBottom: 0 }}>
              Metabase tiene su propio ingreso: use el usuario y la contraseña que le dio el administrador de Metabase (no son los del LIMS).
            </p>
          )}
        </div>
      ) : (
        admin ? (
          <div className="alert warn">
            <b>Metabase no está configurado en este servidor.</b> El administrador de la plataforma debe definir la dirección de Metabase
            en la variable <span className="codigo">URL_BI</span> (por ejemplo <span className="codigo">https://bi.&lt;dominio&gt;</span>) y
            reiniciar la API. Guía: <span className="codigo">docs/RESPALDOS_Y_BI.md</span>.
          </div>
        ) : (
          <div className="alert warn">
            <b>Los tableros de análisis aún no están habilitados en esta instalación.</b> Para usarlos, pida el acceso al
            administrador del sistema.
          </div>
        )
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Tableros iniciales (colección «LIMS IDIC»)</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {TABLEROS.map((t) => (
            <li key={t.titulo} style={{ marginBottom: 4 }}>
              <b>{t.titulo}</b> · {t.texto}
            </li>
          ))}
        </ul>
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8, marginBottom: 0 }}>
          Además puede crear sus propias preguntas sobre los datos del LIMS
          {admin && (
            <>
              {" "}y las vistas preparadas para el análisis (<span className="codigo">bi_ot_estado_mes</span>, <span className="codigo">bi_ot_plazos</span>,{" "}
              <span className="codigo">bi_ot_cumplimiento_mes</span>, <span className="codigo">bi_resultado_no_cumple_lab</span>)
            </>
          )}
          . Las contraseñas y secretos de los usuarios no son visibles desde Metabase.
        </p>
      </div>
    </div>
  );
}

/** Acceso temporal a Metabase, visible solo para el administrador del LIMS. */
function AccesoTemporal({ acceso }: { acceso: { usuario: string; clave: string } }) {
  const [ver, setVer] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const copiar = (texto: string, que: string) => {
    navigator.clipboard?.writeText(texto).then(() => {
      setCopiado(que);
      setTimeout(() => setCopiado(null), 1500);
    });
  };
  return (
    <div className="alert warn" style={{ marginTop: 10, marginBottom: 0 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Acceso temporal a Metabase (solo administrador)</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "6px 10px", alignItems: "center", fontSize: 13 }}>
        <span>Usuario</span>
        <span className="codigo">{acceso.usuario}</span>
        <button className="btn" type="button" onClick={() => copiar(acceso.usuario, "usuario")}>
          {copiado === "usuario" ? "Copiado" : "Copiar"}
        </button>
        <span>Contraseña</span>
        <span className="codigo">{ver ? acceso.clave : "•".repeat(Math.min(acceso.clave.length, 12))}</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button className="btn" type="button" onClick={() => setVer((v) => !v)}>
            {ver ? "Ocultar" : "Mostrar"}
          </button>
          <button className="btn" type="button" onClick={() => copiar(acceso.clave, "clave")}>
            {copiado === "clave" ? "Copiado" : "Copiar"}
          </button>
        </span>
      </div>
      <small style={{ display: "block", marginTop: 6 }}>
        Es el administrador de Metabase, no un usuario del LIMS. Se retirará cuando cada persona tenga su propio usuario.
      </small>
    </div>
  );
}
