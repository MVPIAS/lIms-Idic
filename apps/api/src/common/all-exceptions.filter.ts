import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Response } from "express";

/**
 * Filtro global de último recurso. Garantiza que:
 *  - Las HttpException (400/401/403/404…) se devuelven tal cual.
 *  - Cualquier error NO controlado (incluidos errores de Prisma/DB) se registra
 *    en el log del servidor pero NUNCA expone stack trace ni detalle interno al
 *    cliente en producción: responde un 500 genérico.
 *
 * Se registra DESPUÉS del ZodExceptionFilter (que ya captura ZodError → 400).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("AllExceptionsFilter");
  private readonly isProd = process.env.NODE_ENV === "production";

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === "string" ? { statusCode: status, message: body } : body);
      return;
    }

    // Error no controlado: log completo en servidor, mensaje genérico al cliente.
    this.logger.error(
      exception instanceof Error ? exception.stack ?? exception.message : String(exception),
    );

    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    res.status(status).json({
      statusCode: status,
      error: "Internal Server Error",
      message: this.isProd
        ? "Error interno del servidor"
        : exception instanceof Error
          ? exception.message
          : "Error desconocido",
    });
  }
}
