"use client";

/**
 * /admin · Inicio de Administración. Tarjetas de acceso a cada área con sus
 * cifras (unidades, usuarios, roles, reglas de firma…). Cada cifra se carga por
 * separado: si un servicio aún no existe en el backend, su tarjeta lo indica sin
 * afectar a las demás.
 */

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import {
  TIPOS_UNIDAD, adminApi, esNoDisponible, leerAcceso, mockActivo, puede, type Acceso,
} from "@/lib/admin";
import { BannerEjemplo, Skeleton, SinAcceso } from "@/components/admin/ui";

type Cifra = { valor: ReactNode; detalle?: ReactNode } | "cargando" | "no-disponible" | "error";

interface Tarjeta {
  href: string;
  titulo: string;
  icono: string;
  color: string;
  texto: string;
  permiso: string;
  cargar?: () => Promise<{ valor: ReactNode; detalle?: ReactNode }>;
}

const TARJETAS: Tarjeta[] = [
  {
    href: "/admin/estructura", titulo: "Estructura", icono: "🏛", color: "#12343f", permiso: "admin.estructura",
    texto: "Organigrama del IDIC: Dirección, departamentos, secciones, laboratorios, sucursales y delegación. Jefes titulares y subrogantes.",
    cargar: async () => {
      const us = (await adminApi.unidades()).filter((u) => u.activo !== false);
      const por = (t: string) => us.filter((u) => u.tipo === t).length;
      return {
        valor: us.length,
        detalle: TIPOS_UNIDAD.filter((t) => por(t.value) > 0 && ["DEPARTAMENTO", "LABORATORIO", "SUCURSAL"].includes(t.value))
          .map((t) => `${por(t.value)} ${t.plural}`).join(" · ") || "unidades activas",
      };
    },
  },
  {
    href: "/admin/usuarios", titulo: "Usuarios", icono: "👥", color: "#008c9e", permiso: "admin.usuarios",
    texto: "Personas con acceso al LIMS, sus roles y en qué unidad los ejercen. Subrogancias con fecha, activar/desactivar y contraseñas.",
    cargar: async () => {
      const us = await adminApi.usuarios();
      const activos = us.filter((u) => u.activo).length;
      return { valor: activos, detalle: `activos de ${us.length} registrados` };
    },
  },
  {
    href: "/admin/roles", titulo: "Roles y permisos", icono: "🔑", color: "#7057c8", permiso: "admin.roles",
    texto: "Qué puede hacer cada rol: matriz de permisos por módulo, comparación entre roles y alcance (unidad, dependientes o todo IDIC).",
    cargar: async () => {
      const rs = await adminApi.roles();
      return { valor: rs.length, detalle: "roles definidos" };
    },
  },
  {
    href: "/admin/firmas", titulo: "Matriz de firmas", icono: "✍", color: "#b87300", permiso: "admin.firmas",
    texto: "Quién revisa, aprueba, firma y oficializa cada tipo de documento, con excepciones por unidad y un simulador para probarlo.",
    cargar: async () => {
      const fs = await adminApi.firmas();
      const tipos = new Set(fs.filter((f) => !f.unidadId).map((f) => f.tipoDocumento)).size;
      const exc = new Set(fs.filter((f) => f.unidadId).map((f) => `${f.tipoDocumento}|${f.unidadId}`)).size;
      return { valor: tipos, detalle: `tipos de documento · ${exc} excepción(es)` };
    },
  },
  {
    href: "/catalogo/parametros", titulo: "Parámetros", icono: "🎛", color: "#1f8a5b", permiso: "catalogo.gestionar",
    texto: "Listas de negocio editables sin programar: tipo de cliente, forma de pago, prioridad, líneas de costeo, tipo de inspección.",
    cargar: async () => {
      if (mockActivo()) return { valor: "—", detalle: "no incluido en el modo ejemplo" };
      const r = await api.list("parametros", { limit: 1 });
      return { valor: r?.meta?.total ?? (Array.isArray(r) ? (r as any[]).length : "—"), detalle: "valores configurados" };
    },
  },
  {
    href: "/config-correo", titulo: "Correo", icono: "✉", color: "#2b65d9", permiso: "admin.usuarios",
    texto: "Servidor de correo interno (SMTP) usado para notificaciones y envío de informes.",
    cargar: async () => {
      if (mockActivo()) return { valor: "—", detalle: "no incluido en el modo ejemplo" };
      const c: any = await api.getRaw("config/correo");
      const cfg = c?.data ?? c;
      return {
        valor: cfg?.host ? (cfg.activo ? "Activo" : "Inactivo") : "Sin configurar",
        detalle: cfg?.host ? `${cfg.host}:${cfg.puerto ?? ""}` : "define el servidor SMTP",
      };
    },
  },
];

export default function AdminInicio() {
  const [acceso, setAcceso] = useState<Acceso | null>(null);
  const [cifras, setCifras] = useState<Record<string, Cifra>>({});

  useEffect(() => {
    const a = leerAcceso();
    setAcceso(a);
    TARJETAS.forEach((t) => {
      if (!t.cargar || !puede(a, t.permiso)) return;
      setCifras((c) => ({ ...c, [t.href]: "cargando" }));
      t.cargar()
        .then((v) => setCifras((c) => ({ ...c, [t.href]: v })))
        .catch((e) => setCifras((c) => ({ ...c, [t.href]: esNoDisponible(e) || (e as any)?.message?.includes("404") ? "no-disponible" : "error" })));
    });
  }, []);

  if (!acceso) return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>;
  const alguno = TARJETAS.some((t) => t.permiso.startsWith("admin.") && puede(acceso, t.permiso));
  if (!alguno) return <SinAcceso permiso="admin.*" />;

  return (
    <div>
      <h1 className="page">Administración</h1>
      <p className="subtitle">
        Configura quién es quién en el IDIC, qué puede hacer cada persona y quién firma cada documento.
        Elige un área para empezar.
      </p>
      <BannerEjemplo />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {TARJETAS.map((t) => {
          const permitido = puede(acceso, t.permiso);
          const c = cifras[t.href];
          const cuerpo = (
            <div className={`card h-full flex flex-col transition-shadow ${permitido ? "hover:shadow-lg" : "opacity-60"}`}
              style={{ marginBottom: 0, borderTop: `4px solid ${t.color}` }}>
              <div className="flex items-center gap-3 mb-2">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-xl"
                  style={{ background: `${t.color}18` }} aria-hidden>{t.icono}</span>
                <div className="font-bold text-[15px] flex-1">{t.titulo}</div>
                {!permitido && <span className="pill gray">🔒 Sin acceso</span>}
              </div>
              <div className="text-[12.5px] text-[var(--muted)] flex-1">{t.texto}</div>
              <div className="mt-3 pt-3 border-t border-[var(--line)] min-h-[52px] flex items-end gap-2">
                {!permitido ? (
                  <span className="text-[12px] text-[var(--muted)]">Requiere <span className="codigo">{t.permiso}</span></span>
                ) : c === "cargando" || c === undefined ? (
                  <><Skeleton className="h-7 w-14" /><Skeleton className="h-4 w-32" /></>
                ) : c === "no-disponible" ? (
                  <span className="pill amber">🚧 Servicio no disponible aún</span>
                ) : c === "error" ? (
                  <span className="pill red">No se pudo obtener la cifra</span>
                ) : (
                  <>
                    <span className="text-[24px] font-bold leading-none" style={{ color: t.color }}>{c.valor}</span>
                    <span className="text-[12px] text-[var(--muted)] pb-[2px]">{c.detalle}</span>
                  </>
                )}
                {permitido && <span className="ml-auto text-[12px] font-semibold" style={{ color: t.color }}>Abrir →</span>}
              </div>
            </div>
          );
          return permitido ? (
            <Link key={t.href} href={t.href as any} className="no-underline text-inherit block">{cuerpo}</Link>
          ) : (
            <div key={t.href} aria-disabled>{cuerpo}</div>
          );
        })}
      </div>

      <div className="alert info mt-4">
        <b>¿Cómo se relaciona todo?</b> Cada persona recibe uno o más <b>roles</b>; cada rol se ejerce en una
        <b> unidad</b> de la estructura (p. ej. «Analista · LCC») y eso define qué ve. La <b>matriz de firmas</b> usa
        esos mismos roles y la estructura para saber quién firma cada documento.
      </div>
    </div>
  );
}
