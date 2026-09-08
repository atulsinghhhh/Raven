import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape target. Excluded from the public Swagger docs (it's
 * an operations surface, not part of the developer-facing API) and meant
 * to stay off the public ingress entirely: see infrastructure/k8s, where
 * this is scraped pod-internally, not exposed alongside /v1/*.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async getMetrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.getMetricsText());
  }
}
