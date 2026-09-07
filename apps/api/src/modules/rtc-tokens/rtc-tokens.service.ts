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
  /** Where the client SDK connects to run the call — a Raven-owned contract, not tied to whatever SFU sits behind it. */
  endpoint: string;
  roomId: string;
  roomName: string;
  participantIdentity: string;
  permissions: CreateRtcTokenDto['permissions'];
  /**
   * STUN + TURN servers for the client's WebRTC RTCConfiguration. TURN
   * creds are minted fresh per token and share its lifetime, so a client
   * never holds a permanent relay credential (spec §11).
   */
  iceServers: IceServer[];
  // Base URL for @corvidhq/rtc's telemetry — the SDK never hardcodes this,
  // it just rides along in the same response as endpoint/iceServers.
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
    // environment — the same check we use everywhere else here.
    const room = await this.roomsService.findOneForProject(roomId, scope);

    const ttlSeconds =
      dto.ttlSeconds ?? this.configService.get<number>('rtcToken.defaultTtlSeconds')!;

    const participant = await this.prisma.participant.upsert({
      where: { roomId_identity: { roomId, identity: dto.participantIdentity } },
      create: { roomId, identity: dto.participantIdentity, metadata: dto.metadata },
      update: { metadata: dto.metadata },
    });

    // Resolved once, here, so the row we persist and the claims we sign
    // record exactly the same grant — rather than each re-deriving it from
    // the request's optional flags and risking a drift between what the
    // dashboard shows and what the signaling layer enforces.
    const permissions = resolvePermissions(dto.permissions);

    // Row first, then sign with its id as the token's `jti`. The other
    // order would mean the credential and its record carry different
    // identifiers, which is what makes revocation and log correlation
    // awkward later — and it would change the shape of the `id` this
    // endpoint has always returned.
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
   * Derived from the API's public URL by default so there's one address to
   * configure rather than two — the same approach `ChatTokenService.chatUrl()`
   * takes. `RTC_SIGNALING_URL` overrides it for deployments that front
   * signaling on a separate hostname or ingress.
   *
   * Note what this is *not*: the address of an SFU. Clients never learn
   * which SFU serves their room — the signaling layer allocates one and
   * negotiates on their behalf, which is what allows the media plane to be
   * re-shaped (or replaced) without an SDK release.
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
