import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/database/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { CreateRtcTokenDto } from './dto/create-rtc-token.dto';
import { RtcTokenSignerService } from './rtc-token-signer.service';
import { resolvePermissions, toPermissionsDto } from './rtc-token.claims';
import { buildIceServers, IceServer } from './turn-credential.util';
import { ProjectScope } from '../../shared/environment/environment.constants';
import { SIGNALING_PATH } from '../signaling/signaling.constants';

export interface IssuedRtcToken {
  id: string;
  token: string;
  /** Where the client SDK connects to run the call. A Raven-owned contract, not tied to whichever SFU sits behind it. */
  endpoint: string;
  roomId: string;
  roomName: string;
  participantIdentity: string;
  permissions: CreateRtcTokenDto['permissions'];
  /**
   * STUN and TURN servers for the client's WebRTC RTCConfiguration. TURN
   * credentials are minted fresh per token and share its lifetime, so no
   * client ever holds a permanent relay credential (spec §11).
   */
  iceServers: IceServer[];
  // Base URL for @ravenkash/rtc's telemetry. The SDK never hardcodes it; it
  // rides along in the same response as endpoint and iceServers.
  telemetryUrl: string;
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class RtcTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomsService: RoomsService,
    private readonly configService: ConfigService,
    private readonly signer: RtcTokenSignerService,
  ) {}

  async create(
    scope: ProjectScope,
    roomId: string,
    dto: CreateRtcTokenDto,
  ): Promise<IssuedRtcToken> {
    // Confirms the room exists and belongs to this project *and*
    // environment. The same check used everywhere else in here.
    const room = await this.roomsService.findOneForProject(roomId, scope);

    const ttlSeconds =
      dto.ttlSeconds ?? this.configService.get<number>('rtcToken.defaultTtlSeconds')!;

    const participant = await this.prisma.participant.upsert({
      where: { roomId_identity: { roomId, identity: dto.participantIdentity } },
      create: { roomId, identity: dto.participantIdentity, metadata: dto.metadata },
      update: { metadata: dto.metadata },
    });

    // Resolved once, right here, so the row we persist and the claims we
    // sign record exactly the same grant. Have each of them re-derive it
    // from the request's optional flags and you invite a drift between what
    // the dashboard shows and what the signaling layer enforces.
    const permissions = resolvePermissions(dto.permissions);

    // Row first, then sign with its id as the token's `jti`. Do it the other
    // way round and the credential and its record end up carrying different
    // identifiers, which is exactly what makes revocation and log
    // correlation awkward later. It would also change the shape of the `id`
    // this endpoint has always returned.
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const rtcToken = await this.prisma.rtcToken.create({
      data: {
        projectId: scope.projectId,
        roomId,
        participantId: participant.id,
        permissions: permissions as unknown as object,
        expiresAt,
      },
    });

    const signed = this.signer.sign({
      tokenId: rtcToken.id,
      projectId: scope.projectId,
      environment: scope.environment,
      roomId: room.id,
      roomName: room.name,
      participantIdentity: dto.participantIdentity,
      permissions,
      ttlSeconds,
    });

    const iceServers = buildIceServers({
      turnHost: this.configService.get<string>('turn.host')!,
      turnPort: this.configService.get<number>('turn.port')!,
      turnTlsPort: this.configService.get<number | undefined>('turn.tlsPort'),
      turnSecret: this.configService.get<string>('turn.secret')!,
      participantIdentity: dto.participantIdentity,
      ttlSeconds,
    });

    return {
      id: rtcToken.id,
      token: signed.token,
      endpoint: this.signalingEndpoint(),
      roomId: room.id,
      roomName: room.name,
      participantIdentity: dto.participantIdentity,
      permissions: toPermissionsDto(permissions),
      iceServers,
      telemetryUrl: this.configService.get<string>('publicUrl')!,
      expiresAt: signed.expiresAt,
      createdAt: rtcToken.createdAt,
    };
  }

  /**
   * The `endpoint` clients connect to: Raven's own signaling WebSocket.
   *
   * Derived from the API's public URL by default, so there's one address to
   * configure, not two. `ChatTokenService.chatUrl()` takes the same
   * approach. `RTC_SIGNALING_URL` overrides it for deployments that front
   * signaling on a separate hostname or ingress.
   *
   * Worth being clear about what this *isn't*: the address of an SFU.
   * Clients never learn which SFU serves their room. The signaling layer
   * allocates one and negotiates on their behalf, and that's what lets the
   * media plane be re-shaped, or replaced outright, without an SDK release.
   */
  private signalingEndpoint(): string {
    const configured = this.configService.get<string>('rtc.signalingUrl');
    if (configured) {
      return configured;
    }
    const publicUrl = this.configService.get<string>('publicUrl')!;
    const wsUrl = publicUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return `${wsUrl.replace(/\/$/, '')}${SIGNALING_PATH}`;
  }
}
