import { Controller, Get, Module } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";

@ApiTags("health")
@Controller("health")
class HealthController {
  private prisma = new PrismaClient();

  @Get()
  async check() {
    let db = "ok";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "down";
    }
    return {
      status: db === "ok" ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      services: { database: db },
      version: "0.1.0",
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
