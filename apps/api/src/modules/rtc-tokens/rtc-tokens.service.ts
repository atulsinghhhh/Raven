import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';
import { PrismaService } from '../../shared/database/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { CreateRtcTokenDto } from './dto/create-rtc-token.dto';
import { toLiveKitGrant } from './rtc-token-grant.mapper';
import { buildIceServers, IceServer } from './turn-credential.util';

export interface IssuedRtcToken {
  id: string;
  token: string;
  livekitUrl: string;
  roomId: string;
  roomName: string;
  participantIdentity: string;
  permissions: CreateRtcTokenDto['permissions'];
  /**
   * STUN + TURN servers for the client's WebRTC RTCConfiguration
   * (`rtcConfig.iceServers` on the LiveKit client). TURN creds are minted
   * fresh per token and share its lifetime.
   */
  iceServers: IceServer[];
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class RtcTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomsService: RoomsService,
    private readonly configService: ConfigService,
  ) {}

  async create(
    projectId: string,
    roomId: string,
    dto: CreateRtcTokenDto,
  ): Promise<IssuedRtcToken> {
    // Confirms the room exists and belongs to this project — same
    // cross-project check we use everywhere else here.
    const room = await this.roomsService.findOneForProject(roomId, projectId);

    const ttlSeconds =
      dto.ttlSeconds ?? this.configService.get<number>('rtcToken.defaultTtlSeconds')!;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const participant = await this.prisma.participant.upsert({
      where: { roomId_identity: { roomId, identity: dto.participantIdentity } },
      create: { roomId, identity: dto.participantIdentity, metadata: dto.metadata },
      update: { metadata: dto.metadata },
    });

    const rtcToken = await this.prisma.rtcToken.create({
      data: {
        projectId,
        roomId,
        participantId: participant.id,
        permissions: dto.permissions as unknown as object,
        expiresAt,
      },
    });

    const accessToken = new AccessToken(
      this.configService.get<string>('livekit.apiKey'),
      this.configService.get<string>('livekit.apiSecret'),
      {
        identity: dto.participantIdentity,
        ttl: ttlSeconds,
        metadata: dto.metadata,
        // Custom attributes, not part of LiveKit's own grant — lets our
        // signaling layer bind a connection to one project/room without
        // another DB round-trip on every WebSocket connect. LiveKit just
        // ignores attributes it doesn't know about.
        attributes: { ravenProjectId: projectId, ravenRoomId: room.id },
      },
    );
    accessToken.addGrant(toLiveKitGrant(room.name, dto.permissions));

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
      token: await accessToken.toJwt(),
      livekitUrl: this.configService.get<string>('livekit.url')!,
      roomId: room.id,
      roomName: room.name,
      participantIdentity: dto.participantIdentity,
      permissions: dto.permissions,
      iceServers,
      expiresAt,
      createdAt: rtcToken.createdAt,
    };
  }
}
