/**
 * Agenda (§4.5.9) · avisos a los participantes, reglas PURAS probadas en
 * avisos-agenda.spec.ts: a quién avisar al invitar, cambiar o anular un evento
 * y cómo se describe el evento en el aviso. El envío lo hace AvisosService
 * (aviso en «Mi bandeja» y correo si el parámetro de avisos lo pide).
 */

export interface DatosAviso {
  titulo: string;
  fecha: string;
  todoDia: boolean;
  horaInicio?: string | null;
  horaFin?: string | null;
  lugar?: string | null;
  recurrencia: string;
  intervalo?: number | null;
  diasSemana?: number[] | null;
  repetirHasta?: string | null;
  repeticiones?: number | null;
  recursos?: string[];
}

const h = (x?: string | null) => (x ?? "").slice(0, 5);

/** «Reunión X» el 2026-11-05 de 09:00 a 10:00 en Sala 1 (se repite). */
export function describirEvento(e: DatosAviso): string {
  const cuando = e.todoDia ? "(día completo)" : `de ${h(e.horaInicio)} a ${h(e.horaFin)}`;
  return `«${e.titulo}» el ${e.fecha} ${cuando}${e.lugar ? ` en ${e.lugar}` : ""}${e.recurrencia !== "NINGUNA" ? " (se repite)" : ""}`;
}

/**
 * Personas a avisar al guardar un evento: las recién invitadas, las que se
 * quitaron y las que siguen (con el organizador si no es quien edita). Quien
 * hace el cambio nunca se avisa a sí mismo.
 */
export function destinatariosCambio(p: {
  antes: string[];
  despues: string[];
  organizadorId: string | null;
  actorId: string | null;
}): { invitados: string[]; quitados: string[]; siguen: string[] } {
  const fuera = (x: string) => x !== p.actorId;
  const antes = new Set(p.antes);
  const despues = new Set(p.despues);
  const siguen = new Set(p.despues.filter((x) => antes.has(x)));
  if (p.organizadorId) siguen.add(p.organizadorId);
  return {
    invitados: [...despues].filter((x) => !antes.has(x) && x !== p.organizadorId && fuera(x)),
    quitados: [...antes].filter((x) => !despues.has(x) && x !== p.organizadorId && fuera(x)),
    siguen: [...siguen].filter(fuera),
  };
}

/** ¿Cambió algo que importe a quien participa (cuándo, dónde, qué o con qué recursos)? */
export function cambioRelevante(a: DatosAviso, b: DatosAviso): boolean {
  const clave = (e: DatosAviso) =>
    JSON.stringify([
      e.titulo,
      e.fecha,
      e.todoDia,
      e.todoDia ? null : h(e.horaInicio),
      e.todoDia ? null : h(e.horaFin),
      e.lugar ?? null,
      e.recurrencia,
      e.recurrencia === "NINGUNA" ? null : [e.intervalo ?? 1, [...(e.diasSemana ?? [])].sort(), e.repetirHasta ?? null, e.repeticiones ?? null],
      [...(e.recursos ?? [])].sort(),
    ]);
  return clave(a) !== clave(b);
}
