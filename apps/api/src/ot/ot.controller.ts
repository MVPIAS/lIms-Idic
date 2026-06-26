import { Controller, Get, Param, UseGuards, ParseUUIDPipe } from "@nestjs/common";
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
  async listar() {
    return this.prisma.ordenTrabajo.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
      include: { cliente: true },
    });
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.ordenTrabajo.findUnique({
      where: { id },
      include: { cliente: true },
    });
  }
}
