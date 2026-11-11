import { estadoRespaldos, horaValida, politicaDe, proximoRespaldo, servicioActivo, tamanoLegible, POLITICA_DEFECTO } from "./respaldos.reglas";
import { accesoBi, urlBi } from "./bi.reglas";
import { fechaHoraChile } from "../common/fecha-chile";

const H = 3_600_000;

describe("respaldos · política", () => {
  it("sin filas ni servicio rige la política por defecto (02:00, 14 diarios, 8 semanales, 26 h)", () => {
    expect(politicaDe([])).toEqual(POLITICA_DEFECTO);
  });

  it("toma los parámetros y descarta valores fuera de rango", () => {
    const p = politicaDe([
      { codigo: "hora", valor: "23" },
      { codigo: "retencion_diarios", valor: "7" },
      { codigo: "retencion_semanales", valor: "999" },
      { codigo: "horas_alerta", valor: "48" },
      { codigo: "avisar_fallo", valor: "no" },
    ]);
    expect(p).toMatchObject({ hora: "23:00", retencionDiarios: 7, retencionSemanales: 8, horasAlerta: 48, avisarFallo: false });
  });

  it("lo que reporta el servicio manda sobre los parámetros (es lo que aplica de verdad)", () => {
    const p = politicaDe([{ codigo: "hora", valor: "3" }], { detalle: { hora: "02:15", retencion_diarios: 7, retencion_semanales: 4, retencion_mensuales: 12 } });
    expect(p).toMatchObject({ hora: "02:15", retencionDiarios: 7, retencionSemanales: 4, retencionMensuales: 12 });
  });

  it("horaValida normaliza «H:MM» y rechaza lo que no es una hora", () => {
    expect(horaValida("2:00")).toBe("02:00");
    expect(horaValida("24:00")).toBeNull();
    expect(horaValida("dos")).toBeNull();
  });
});

describe("respaldos · próximo programado (hora de Chile)", () => {
  it("si la hora de hoy aún no llega, es hoy; si ya pasó, mañana", () => {
    // 03-11-2026 01:00 en Chile (verano, UTC−3) = 04:00Z
    const antes = new Date("2026-11-03T04:00:00Z");
    expect(fechaHoraChile(proximoRespaldo(antes, "02:00"))).toContain("03-11-2026 02:00");
    // 03-11-2026 10:00 en Chile
    const despues = new Date("2026-11-03T13:00:00Z");
    expect(fechaHoraChile(proximoRespaldo(despues, "02:00"))).toContain("04-11-2026 02:00");
  });

  it("respeta el horario de invierno (UTC−4)", () => {
    const julio = new Date("2026-07-10T12:00:00Z");
    expect(proximoRespaldo(julio, "02:00").toISOString()).toBe("2026-07-11T06:00:00.000Z");
  });
});

describe("respaldos · semáforo", () => {
  const ahora = new Date("2026-11-03T15:00:00Z");
  const servicio = { modo: "contenedor", latidoAt: new Date(ahora.getTime() - 60_000) };
  const ok = { resultado: "OK", fin: new Date(ahora.getTime() - 10 * H) };

  it("verde: último correcto y reciente, servicio en marcha", () => {
    const e = estadoRespaldos({ ultimoTerminado: ok, ultimoOk: ok, servicio, ahora, horasAlerta: 26 });
    expect(e.color).toBe("verde");
    expect(e.motivos).toEqual([]);
  });

  it("rojo si el último falló, con su mensaje", () => {
    const e = estadoRespaldos({ ultimoTerminado: { resultado: "ERROR", mensaje: "pg_dump falló" }, ultimoOk: ok, servicio, ahora, horasAlerta: 26 });
    expect(e.color).toBe("rojo");
    expect(e.motivos[0]).toBe("El último respaldo falló: pg_dump falló");
  });

  it("rojo si el último correcto tiene más de las horas de alerta", () => {
    const viejo = { resultado: "OK", fin: new Date(ahora.getTime() - 27 * H) };
    const e = estadoRespaldos({ ultimoTerminado: viejo, ultimoOk: viejo, servicio, ahora, horasAlerta: 26 });
    expect(e.color).toBe("rojo");
    expect(e.motivos).toEqual(["El último respaldo correcto tiene más de 26 horas (27 h)."]);
  });

  it("rojo si no hay servicio instalado ni respaldos", () => {
    const e = estadoRespaldos({ ultimoTerminado: null, ultimoOk: null, servicio: null, ahora, horasAlerta: 26 });
    expect(e.color).toBe("rojo");
    expect(e.servicioActivo).toBe(false);
    expect(e.motivos).toHaveLength(2);
  });

  it("el servicio en contenedor se da por detenido sin latido en 5 minutos; el de systemd, en las horas de alerta", () => {
    expect(servicioActivo({ modo: "contenedor", latidoAt: new Date(ahora.getTime() - 6 * 60_000) }, ahora, 26)).toBe(false);
    expect(servicioActivo({ modo: "systemd", latidoAt: new Date(ahora.getTime() - 20 * H) }, ahora, 26)).toBe(true);
    expect(servicioActivo({ modo: "systemd", latidoAt: new Date(ahora.getTime() - 30 * H) }, ahora, 26)).toBe(false);
  });
});

describe("respaldos · tamaño legible y URL del BI", () => {
  it("tamaño con coma decimal", () => {
    expect(tamanoLegible(512)).toBe("512 B");
    expect(tamanoLegible(5 * 1024 * 1024 + 300 * 1024)).toBe("5,3 MB");
    expect(tamanoLegible(null)).toBe("—");
  });

  it("URL_BI: solo http(s), sin barra final y sin credenciales", () => {
    expect(urlBi("https://bi.lims.example.cl/")).toBe("https://bi.lims.example.cl");
    expect(urlBi("")).toBeNull();
    expect(urlBi("javascript:alert(1)")).toBeNull();
    expect(urlBi("https://usuario:clave@bi.example.cl")).toBeNull();
    expect(urlBi("no es una url")).toBeNull();
  });
});

describe("BI · acceso temporal a Metabase", () => {
  it("solo lo recibe el administrador del LIMS", () => {
    expect(accesoBi("admin-bi@x", "secreto", { roles: ["SUPERADMIN"] })).toEqual({ usuario: "admin-bi@x", clave: "secreto" });
    expect(accesoBi("admin-bi@x", "secreto", { roles: ["ADMIN"] })).not.toBeNull();
    expect(accesoBi("admin-bi@x", "secreto", { roles: ["ANALISTA"], permisos: ["admin.usuarios"] })).not.toBeNull();
    expect(accesoBi("admin-bi@x", "secreto", { roles: ["JEFE_LAB"], permisos: ["reporte.ver"] })).toBeNull();
    expect(accesoBi("admin-bi@x", "secreto", null)).toBeNull();
  });
  it("sin variables no hay acceso", () => {
    expect(accesoBi("", "secreto", { roles: ["SUPERADMIN"] })).toBeNull();
    expect(accesoBi("admin-bi@x", undefined, { roles: ["SUPERADMIN"] })).toBeNull();
  });
});
