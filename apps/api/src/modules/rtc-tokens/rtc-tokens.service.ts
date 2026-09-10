import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotFoundError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { PrismaService } from '../../shared/database/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { CreateRtcTokenDto } from './dto/create-rtc-token.dto';
import { UsageAllowanceService } from '../usage/usage-allowance.service';
import { RtcTokenRevocationService } from './rtc-token-revocation.service';
import { RtcTokenSignerService } from './rtc-token-signer.service';
import { resolvePermissions, toPermissionsDto } from './rtc-token.claims';
import { buildIceServers, IceServer } from './turn-credential.util';
import { ProjectScope } from '../../shared/environment/environment.constants';
import { SIGNALING_PATH } from '../signaling/signaling.constants';

export interface IssuedRtcToken {
  id: string;
  token: string;
  /** Where the client SDK connects to run the call. A Livqeno-owned contract, not tied to whichever SFU sits behind it. */
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

export interface RevokedRtcToken {
  id: string;
  revoked: true;
  /**
   * The token's own expiry, unchanged. Echoed back because it is when the
   * revocation record itself lapses — after this instant the token is
   * refused for having expired rather than for having been revoked, and
   * the two are separate codes on the wire.
   */
  expiresAt: Date;
}

@Injectable()
export class RtcTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomsService: RoomsService,
    private readonly configService: ConfigService,
    private readonly signer: RtcTokenSignerService,
    private readonly usageAllowances: UsageAllowanceService,
    private readonly revocations: RtcTokenRevocationService,
  ) {}

  async create(scope: ProjectScope, roomId: string, dto: CreateRtcTokenDto): Promise<IssuedRtcToken> {
    // Confirms the room exists and belongs to this project *and*
    // environment. The same check used everywhere else in here.
    const room = await this.roomsService.findOneForProject(roomId, scope);

    // Refuse before signing anything. The signaling layer checks again at
    // join (message-router.service.ts) — that is the check that actually
    // protects the media plane, since a token minted a minute ago is still
    // valid — but failing here means a developer whose minutes are gone
    // gets a 403 from the endpoint their backend already handles errors
    // from, instead of a WebSocket close their client has to interpret.
    await this.usageAllowances.assertProjectWithinAllowance(scope.projectId);

    const ttlSeconds = dto.ttlSeconds ?? this.configService.get<number>('rtcToken.defaultTtlSeconds')!;

    const participant = await this.upsertParticipant(roomId, dto.participantIdentity, dto.metadata);

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
   * Revokes a minted token before it expires.
   *
   * Scoped through the room, not just `rtc_tokens.projectId`, so the same
   * project-and-environment rule that governs every other room-scoped
   * endpoint governs this one: a production key cannot revoke a
   * development token, and no key can revoke another project's. A token
   * that does not match resolves to the same "not found" as one that never
   * existed, so this endpoint never confirms the existence of a token id
   * belonging to somebody else.
   *
   * ## What revocation does and does not do
   *
   * It stops the token being used to *establish* anything new: the next
   * signaling connect and the next telemetry POST are refused with
   * `TOKEN_REVOKED`. It does **not** tear down a session already running
   * on that token. Authorization is checked when a connection is
   * established, and an established connection is not re-authorized
   * per-frame, so a participant who joined a moment before revocation
   * stays in the call until they leave, the token expires and their client
   * fails to renew, or an operator closes the room
   * (`DELETE /v1/rooms/:id`), which is the control that does cut live
   * sessions.
   *
   * That boundary is deliberate rather than incidental — see
   * docs/rtc/tokens.md — and it is why a short TTL matters more than
   * revocation does for containing a leaked token.
   */
  async revoke(scope: ProjectScope, roomId: string, tokenId: string): Promise<RevokedRtcToken> {
    // Establishes the room belongs to this project *and* environment
    // before anything is looked up under it.
    await this.roomsService.findOneForProject(roomId, scope);

    const token = await this.prisma.rtcToken.findFirst({
      where: { id: tokenId, roomId, projectId: scope.projectId },
      select: { id: true, expiresAt: true },
    });
    if (!token) {
      throw new NotFoundError('RTC token', RavenErrorCode.NOT_FOUND);
    }

    await this.revocations.revoke(token.id, token.expiresAt);

    return { id: token.id, revoked: true, expiresAt: token.expiresAt };
  }

  /**
   * The `endpoint` clients connect to: Livqeno's own signaling WebSocket.
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
  /**
   * The participant row a token is issued against, created if this is the
   * identity's first token in this room.
   *
   * A plain `upsert` is one statement but not an atomic one: it looks the
   * row up, finds nothing, and inserts, and two requests for the same
   * identity can both reach the insert. One then loses on
   * `participants_roomId_identity_key` and Prisma surfaces it as an error
   * rather than retrying, which reached callers as a 500. Minting several
   * credentials for one identity at once is ordinary — a host re-mints on
   * two devices, a backend retries — so this treats the collision as what
   * it is: the row now exists, which was the goal.
   */
  private async upsertParticipant(roomId: string, identity: string, metadata: CreateRtcTokenDto['metadata']) {
    const where = { roomId_identity: { roomId, identity } };
    try {
      return await this.prisma.participant.upsert({
        where,
        create: { roomId, identity, metadata },
        update: { metadata },
      });
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') {
        throw err;
      }
      return this.prisma.participant.update({ where, data: { metadata } });
    }
  }

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
