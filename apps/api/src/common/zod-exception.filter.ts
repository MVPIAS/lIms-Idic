import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import { Response } from "express";
import { ZodError } from "zod";

/**
 * Convierte cualquier ZodError (lanzado por Schema.parse() en los controladores)
 * en una respuesta HTTP 400 limpia con la lista de issues, en lugar de dejar que
 * Nest lo trate como un error no controlado y responda 500 (fuga de stack trace).
 *
 * Registrar globalmente en main.ts:  app.useGlobalFilters(new ZodExceptionFilter());
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const issues = exception.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
      code: i.code,
    }));

    res.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      error: "Bad Request",
      message: "Validación fallida",
      issues,
    });
  }
}
