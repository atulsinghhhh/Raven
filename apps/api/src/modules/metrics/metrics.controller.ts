import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { MetricsAuthGuard } from './metrics-auth.guard';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape target. Excluded from the public Swagger docs (it's
 * an operations surface, not part of the developer-facing API). The
 * target topology (infrastructure/k8s) keeps this off the public ingress
 * entirely by scraping pod-internally; Azure Container Apps has no
 * equivalent path-level exclusion, so MetricsAuthGuard is the actual
 * defense wherever this ends up reachable from the internet.
 */
@ApiExcludeController()
@Controller('metrics')
@UseGuards(MetricsAuthGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async getMetrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.getMetricsText());
  }
}
