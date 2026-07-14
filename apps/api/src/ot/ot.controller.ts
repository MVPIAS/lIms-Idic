import { Controller, Get, Param, Req, UseGuards, ParseUUIDPipe } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("ot")
export class OtController {
  private prisma = new PrismaClient();

  @Get()
  async listar(@Req() req: any) {
    return this.prisma.ordenTrabajo.findMany({
      // OrdenTrabajo tiene tenant_id: solo se listan las OT del tenant del usuario.
      where: { ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      take: 50,
      orderBy: { createdAt: "desc" },
      include: { cliente: true },
    });
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    // findFirst con tenant compuesto: si la OT es de otro tenant, no se revela (null).
    return this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      include: { cliente: true },
    });
  }
}
