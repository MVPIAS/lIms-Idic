/**
 * Lector del cuerpo JSON para las rutas que llama el software de armas del BPCH
 * (/api/v1/integracion/bpch/*). Se instala en main.ts ANTES de los lectores de
 * Nest, solo para ese prefijo, porque:
 *   · la firma HMAC (X-BPCH-Signature) se calcula sobre el cuerpo CRUDO, que el
 *     lector estándar descarta: aquí se guarda en `req.rawBody`;
 *   · el acta de finalización viaja en base64 (hasta 15 MB de PDF ≈ 20 MB), muy
 *     por encima del tope de 100 kB del lector estándar, que sigue igual para el
 *     resto de la API.
 * Marca `req._body = true`, así el lector de Nest no vuelve a leer el flujo.
 */
export const PREFIJO_BPCH = "/api/v1/integracion/bpch";
export const MAX_BYTES_CUERPO_BPCH = 40 * 1024 * 1024;

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on: (ev: string, fn: (...a: any[]) => void) => unknown;
  body?: unknown;
  rawBody?: Buffer;
  _body?: boolean;
};
type Res = { statusCode: number; setHeader: (k: string, v: string) => void; end: (s?: string) => void };

function responder(res: Res, codigo: number, error: string) {
  res.statusCode = codigo;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ codigo, error }));
}

export function cuerpoCrudoBpch(max = MAX_BYTES_CUERPO_BPCH) {
  return (req: Req, res: Res, next: (e?: unknown) => void) => {
    if (req.method !== "POST") return next();
    const tipo = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!tipo.startsWith("application/json")) return responder(res, 415, "Se espera Content-Type: application/json.");
    const declarado = Number(req.headers["content-length"]);
    if (Number.isFinite(declarado) && declarado > max) return responder(res, 413, "El cuerpo supera el tamaño permitido.");
    const partes: Buffer[] = [];
    let total = 0;
    let cortado = false;
    req.on("data", (c: Buffer) => {
      if (cortado) return;
      total += c.length;
      if (total > max) {
        cortado = true;
        responder(res, 413, "El cuerpo supera el tamaño permitido.");
        return;
      }
      partes.push(c);
    });
    req.on("error", (e: unknown) => {
      if (!cortado) next(e);
    });
    req.on("end", () => {
      if (cortado) return;
      const crudo = Buffer.concat(partes);
      req.rawBody = crudo;
      req._body = true;
      if (!crudo.length) {
        req.body = {};
        return next();
      }
      try {
        req.body = JSON.parse(crudo.toString("utf8"));
      } catch {
        return responder(res, 400, "El cuerpo no es un JSON válido.");
      }
      next();
    });
  };
}
