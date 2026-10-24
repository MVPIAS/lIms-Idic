"use client";

/**
 * lista-parametro.ts · Listas de las pantallas que viven en «Parámetros del
 * sistema» (tabla `parametro_sistema`), leídas de UN sitio (frente f5):
 *
 *   · `moneda`      → CLP y USD (la API rechaza otras: apps/api/src/common/moneda.ts).
 *   · `medio_envio` → medios del envío al cliente, la entrega de documentos, el
 *                     envío de la cotización y la entrega de Metrología
 *                     (apps/api/src/common/medios-envio.ts).
 *
 * `opciones` = filas activas (lo que se ofrece); `texto(codigo)` etiqueta
 * también las inactivas, para que un valor ya guardado (p. ej. «fax» o una
 * moneda histórica) se siga leyendo. Una lectura por categoría y página.
 */
import { useEffect, useState } from "react";
import { api } from "./api";

export interface OpcionParametro {
  codigo: string;
  etiqueta: string;
  activo: boolean;
  valor?: string | null;
}

const cache = new Map<string, Promise<OpcionParametro[]>>();
/** Filas ya leídas por categoría, para los textos que se arman fuera de un componente. */
const leidas = new Map<string, OpcionParametro[]>();

/** Texto de un código si su categoría ya se leyó (si no, undefined). */
export function etiquetaLeida(categoria: string, codigo: string): string | undefined {
  return leidas.get(categoria)?.find((f) => f.codigo === codigo)?.etiqueta;
}

/** «Entrega en mano» → «entrega en mano» (para una frase); respeta siglas («FAX…»). */
export function enFrase(etiqueta: string): string {
  return etiqueta.length > 1 && etiqueta[1] === etiqueta[1].toLowerCase() ? etiqueta[0].toLowerCase() + etiqueta.slice(1) : etiqueta;
}

/** Todas las filas de la categoría (activas e inactivas), en su orden. */
export function cargarListaParametro(categoria: string): Promise<OpcionParametro[]> {
  let p = cache.get(categoria);
  if (!p) {
    p = api
      .getRaw<any>(`parametros?categoria=${encodeURIComponent(categoria)}&limit=100`)
      .then((r) =>
        ((r?.data ?? r ?? []) as any[]).map((x) => ({ codigo: String(x.codigo), etiqueta: String(x.etiqueta ?? x.codigo), activo: x.activo !== false, valor: x.valor ?? null })),
      )
      .then((filas) => {
        leidas.set(categoria, filas);
        return filas;
      })
      .catch((e) => {
        cache.delete(categoria);
        throw e;
      });
    cache.set(categoria, p);
  }
  return p;
}

export function useListaParametro(categoria: string) {
  const [filas, setFilas] = useState<OpcionParametro[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    cargarListaParametro(categoria)
      .then((f) => vivo && setFilas(f))
      .catch((e) => vivo && (setFilas([]), setError(e?.message ?? "No se pudo leer la lista")));
    return () => {
      vivo = false;
    };
  }, [categoria]);
  const todas = filas ?? [];
  return {
    cargado: filas !== null,
    error,
    /** Valores que se ofrecen (activos). */
    opciones: todas.filter((f) => f.activo),
    /** Texto de un código guardado; si ya no está en la lista, el propio código. */
    texto: (codigo?: string | null, porDefecto = "—") => (codigo ? todas.find((f) => f.codigo === codigo)?.etiqueta ?? codigo : porDefecto),
    /** ¿El código está entre los que se ofrecen hoy? */
    vigente: (codigo?: string | null) => !!codigo && todas.some((f) => f.activo && f.codigo === codigo),
  };
}

/**
 * Medios de envío y de entrega (frente f5): la lista de «Parámetros del sistema ›
 * medio_envio», sin listas propias en cada pantalla. `texto` da la etiqueta de un
 * código guardado (también de uno inactivo, como «fax»).
 */
export function useMediosEnvio() {
  return useListaParametro("medio_envio");
}
