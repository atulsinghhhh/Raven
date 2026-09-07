import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Project } from '../../generated/prisma/client';
import { RtcServerRegistryService } from '../rtc-servers/rtc-server-registry.service';
import { checkSfuHttp, checkStunBinding } from '../health/dependency-checks.util';
import { ConnectionsService } from './connections.service';

export interface ProjectDiagnostics {
  project: { id: string; name: string };
  api: 'up';
  authentication: 'ok';
  dependencies: {
    signaling: 'up' | 'down';
    sfu: 'up' | 'down';
    turn: 'up' | 'down';
  };
  connections: {
    active: number;
  };
}

/**
 * Backs both `raven diagnostics` and the dashboard's Diagnostics view —
 * a project-scoped, authenticated superset of the public `/health` (Phase
 * 9 spec §22/§27). `api`/`authentication` are trivially 'up'/'ok' here:
 * reaching this method at all already proves both.
 */
@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly connectionsService: ConnectionsService,
    private readonly rtcServers: RtcServerRegistryService,
  ) {}

  /**
   * Whether RTC can actually serve a call right now.
   *
   * Two things have to hold, and both are checked: the fleet has a
   * healthy node registered, and that node answers from this process.
   * Registry state alone would report "up" for a node sitting behind a
   * broken route; a bare probe would need an address the registry exists
   * to remove.
   */
  private async probeRtcFleet(): Promise<boolean> {
    const server = await this.rtcServers.pickHealthyForProbe();
    if (!server) {
      return false;
    }
    return checkSfuHttp(server.internalUrl);
  }

  async getDiagnostics(project: Project): Promise<ProjectDiagnostics> {
    const [sfu, turn, active] = await Promise.all([
      this.probeRtcFleet().catch(() => false),
      checkStunBinding(
        this.configService.get<string>('turn.internalHost')!,
        this.configService.get<number>('turn.port')!,
      ).catch(() => false),
      this.connectionsService.findActive(project.id),
    ]);

    return {
      project: { id: project.id, name: project.name },
      api: 'up',
      authentication: 'ok',
      dependencies: {
        // The Raven WS signaling gateway (Phase 3) shares this API
        // process, so it's "up" whenever this request is being served.
        signaling: 'up',
        sfu: sfu ? 'up' : 'down',
        turn: turn ? 'up' : 'down',
      },
      connections: { active: active.length },
    };
  }
}
