/**
 * Contacto principal del cliente (B-038 · MP-00 D00-12, MP-01 D01-10, MP-04
 * D04-13, MP-05 D05-13/D05-18).
 *
 * La ficha del cliente guarda «Contacto principal» (nombre, cargo, correo,
 * teléfono) y la tabla `contacto` guarda los contactos que ofrece la
 * cotización como solicitante. Antes no se hablaban: la cotización decía «El
 * cliente no tiene contactos» y el informe salía sin solicitante. Regla:
 *   · al guardar la ficha con contacto principal, ese contacto existe en
 *     Contactos (se crea o se actualiza el del mismo nombre) y es el único
 *     principal;
 *   · al marcar un contacto como principal en Contactos, los demás dejan de
 *     serlo y la ficha del cliente toma sus datos.
 */
export function mismoNombre(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (x: string | null | undefined) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return n(a) !== "" && n(a) === n(b);
}

/** La ficha del cliente → Contactos (crea o actualiza el principal). */
export async function contactoPrincipalDesdeFicha(db: any, clienteId: string): Promise<void> {
  const [c] = await db.$queryRawUnsafe(
    `SELECT contacto_nombre AS nombre, contacto_cargo AS cargo, contacto_email AS email, contacto_telefono AS telefono
       FROM cliente WHERE id = $1::uuid`,
    clienteId,
  );
  if (!c || !String(c.nombre ?? "").trim()) return;
  const contactos: { id: string; nombre: string }[] = await db.$queryRawUnsafe(
    `SELECT id, nombre FROM contacto WHERE cliente_id = $1::uuid AND deleted_at IS NULL ORDER BY created_at`,
    clienteId,
  );
  let id = contactos.find((x) => mismoNombre(x.nombre, c.nombre))?.id;
  if (id) {
    await db.$executeRawUnsafe(
      `UPDATE contacto SET cargo = COALESCE(NULLIF($2, ''), cargo), email = COALESCE(NULLIF($3, '')::citext, email),
              telefono = COALESCE(NULLIF($4, ''), telefono), activo = true
        WHERE id = $1::uuid`,
      id, c.cargo ?? "", c.email ?? "", c.telefono ?? "",
    );
  } else {
    const [n] = await db.$queryRawUnsafe(
      `INSERT INTO contacto (cliente_id, nombre, cargo, email, telefono, principal, es_principal, activo)
       VALUES ($1::uuid, $2, NULLIF($3, ''), NULLIF($4, '')::citext, NULLIF($5, ''), true, true, true) RETURNING id`,
      clienteId, String(c.nombre).trim().slice(0, 160), c.cargo ?? "", c.email ?? "", c.telefono ?? "",
    );
    id = n.id;
  }
  await unicoPrincipal(db, clienteId, id!);
}

/** Deja `contactoId` como único principal del cliente. */
export async function unicoPrincipal(db: any, clienteId: string, contactoId: string): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE contacto SET principal = (id = $2::uuid), es_principal = (id = $2::uuid)
      WHERE cliente_id = $1::uuid AND deleted_at IS NULL
        AND (COALESCE(principal, false) <> (id = $2::uuid) OR COALESCE(es_principal, false) <> (id = $2::uuid))`,
    clienteId, contactoId,
  );
}

/** Contactos → la ficha: el contacto marcado como principal pasa a la ficha del cliente. */
export async function fichaDesdeContactoPrincipal(db: any, contactoId: string): Promise<void> {
  const [ct] = await db.$queryRawUnsafe(`SELECT cliente_id AS "clienteId" FROM contacto WHERE id = $1::uuid`, contactoId);
  if (!ct) return;
  await unicoPrincipal(db, ct.clienteId, contactoId);
  await db.$executeRawUnsafe(
    `UPDATE cliente cl SET contacto_nombre = ct.nombre, contacto_cargo = ct.cargo, contacto_email = ct.email::text, contacto_telefono = ct.telefono
       FROM contacto ct WHERE ct.id = $1::uuid AND cl.id = ct.cliente_id`,
    contactoId,
  );
}
