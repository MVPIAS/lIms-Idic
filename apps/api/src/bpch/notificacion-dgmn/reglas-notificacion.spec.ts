import { DESTINATARIOS_DGMN, erroresNotificacion, faltantesNotificacion } from "./reglas-notificacion";

describe("EP-10 10.15 · notificación a DGMN", () => {
  it("destinatarios fijos de la distribución", () => {
    expect(DESTINATARIOS_DGMN).toHaveLength(3);
    expect(DESTINATARIOS_DGMN[0]).toMatch(/DCAE/);
  });

  it("bloquea el cierre mientras un incumplimiento oficial no esté notificado", () => {
    expect(faltantesNotificacion([{ numero: "X/II", estado: "oficial", notificado: false }])[0]).toMatch(/X\/II/);
    expect(faltantesNotificacion([{ numero: "X/II", estado: "oficial", notificado: true }])).toEqual([]);
    // En firma o anulado: aún no hay nada que notificar (lo exige la emisión/firma).
    expect(faltantesNotificacion([{ numero: "X/II", estado: "en_firma", notificado: false }])).toEqual([]);
    expect(faltantesNotificacion([{ numero: "X/II", estado: "anulado", notificado: false }])).toEqual([]);
  });

  const base = {
    documento: { estado: "oficial", tipo: "INFORME_INCUMPLIMIENTO" },
    yaNotificado: false,
    medio: "correo",
    fechaEnvio: "2026-10-20",
    hoy: "2026-10-22",
    copiaInternador: true,
  };
  it("acepta una notificación completa", () => {
    expect(erroresNotificacion(base)).toEqual([]);
    expect(erroresNotificacion({ ...base, medio: "oficina_partes", oficioNumero: "Of. 123" })).toEqual([]);
  });
  it("exige incumplimiento oficial, no repetido, medio, fecha no futura, copia y oficio en oficina de partes", () => {
    expect(erroresNotificacion({ ...base, documento: { estado: "oficial", tipo: "CERTIFICADO_CONFORMIDAD" } })[0]).toMatch(/no es un Informe/);
    expect(erroresNotificacion({ ...base, documento: null })).toHaveLength(1);
    expect(erroresNotificacion({ ...base, documento: { estado: "en_firma", tipo: "INFORME_INCUMPLIMIENTO" } })[0]).toMatch(/aún no es oficial/);
    expect(erroresNotificacion({ ...base, yaNotificado: true })[0]).toMatch(/ya está registrada/);
    expect(erroresNotificacion({ ...base, medio: "fax" })[0]).toMatch(/medio/);
    expect(erroresNotificacion({ ...base, fechaEnvio: "2026-10-23" })[0]).toMatch(/futura/);
    expect(erroresNotificacion({ ...base, copiaInternador: undefined })[0]).toMatch(/copia al internador/);
    expect(erroresNotificacion({ ...base, medio: "oficina_partes" })[0]).toMatch(/oficio/);
  });
});
