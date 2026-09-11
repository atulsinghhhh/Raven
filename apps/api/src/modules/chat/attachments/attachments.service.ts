import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Attachment, AttachmentStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { generateId } from '../../../shared/utils/crypto.util';
import { toJsonInput } from '../json.util';
import { ChatActor, resolveSubjectId } from '../auth/chat-actor.interface';
import { ChatError } from '../chat-error';
import { ChatErrorCode } from '../chat.constants';
import { assertScope } from '../chat-permissions';
import { ConversationsService } from '../conversations/conversations.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { S3PresignConfig, presignS3Url } from './s3-presign.util';

export interface AttachmentUploadTicket {
  id: string;
  roomId: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  status: string;
  /** Short-lived, single-object PUT URL. The API never proxies the bytes. */
  uploadUrl: string;
  uploadMethod: 'PUT';
  /** Header the client must send so the signed content-type condition holds. */
  uploadHeaders: Record<string, string>;
  expiresAt: string;
}

/**
 * Attachment metadata and signed URLs (spec §30).
 *
 * The bytes never touch this API or the WebSocket. The flow: client asks for
 * a ticket, uploads straight to object storage with a short-lived signed
 * PUT, tells us it finished, then references the attachment id when it
 * sends a message. Storage credentials stay server-side the whole way, and
 * the browser only ever holds a URL that expires and addresses exactly one
 * key.
 *
 * With no bucket configured, every method here fails with a clear
 * ATTACHMENTS_NOT_CONFIGURED instead of half-working. Attachments are
 * optional infrastructure, and pretending otherwise is worse than saying so.
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly conversations: ConversationsService,
  ) {}

  isConfigured(): boolean {
    const storage = this.storageConfig();
    return Boolean(storage.bucket && storage.endpoint && storage.accessKeyId && storage.secretAccessKey);
  }

  async createUploadTicket(
    actor: ChatActor,
    roomReference: string,
    dto: CreateAttachmentDto,
  ): Promise<AttachmentUploadTicket> {
    const storage = this.requireStorage();
    const { conversation, scopes } = await this.conversations.authorize(actor, roomReference);
    this.conversations.assertWritable(conversation);
    assertScope(scopes, 'chat:send', 'Uploading an attachment');

    const uploaderId = resolveSubjectId(actor, dto.uploaderId);
    if (!uploaderId) {
      throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'An uploader identity is required');
    }

    const maxBytes = this.configService.get<number>('storage.maxAttachmentBytes')!;
    if (dto.size > maxBytes) {
      throw new ChatError(
        ChatErrorCode.ATTACHMENT_TOO_LARGE,
        `Attachment is ${dto.size} bytes — the limit is ${maxBytes}`,
      );
    }

    // Key layout is project/conversation/random. Never the user-supplied
    // filename, which would let a caller traverse into, or overwrite,
    // another tenant's objects. We keep the original name as metadata and
    // hand it back at download time instead.
    const storageKey = `chat/${actor.projectId}/${conversation.id}/${randomBytes(16).toString('hex')}`;
    const ttl = this.configService.get<number>('storage.uploadUrlTtlSeconds')!;

    const attachment = await this.prisma.attachment.create({
      data: {
        publicId: generateId('att'),
        projectId: actor.projectId,
        conversationId: conversation.id,
        uploaderId,
        filename: sanitizeFilename(dto.filename),
        mimeType: dto.mimeType,
        sizeBytes: dto.size,
        storageKey,
        metadata: toJsonInput(dto.metadata),
      },
    });

    const uploadUrl = presignS3Url({
      ...storage,
      method: 'PUT',
      key: storageKey,
      expiresInSeconds: ttl,
      contentType: dto.mimeType,
    });

    return {
      ...this.toTicketBase(attachment, conversation.publicId),
      uploadUrl,
      uploadMethod: 'PUT',
      uploadHeaders: { 'content-type': dto.mimeType },
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  /**
   * Marks an upload complete.
   *
   * Trusting the client here is a deliberate, bounded choice. Verifying
   * would mean a HEAD against object storage on every single upload, and
   * the worst case of a false "complete" is a message pointing at a key with
   * no bytes behind it. Visible straight away, and scoped to that one user's
   * own attachment.
   */
  async complete(actor: ChatActor, attachmentPublicId: string): Promise<Attachment> {
    const attachment = await this.loadForActor(actor, attachmentPublicId);

    const uploaderId = resolveSubjectId(actor, null);
    if (actor.kind === 'client' && attachment.uploaderId !== uploaderId) {
      throw new ChatError(ChatErrorCode.PERMISSION_DENIED, 'That attachment was uploaded by someone else');
    }

    return this.prisma.attachment.update({
      where: { id: attachment.id },
      data: { status: AttachmentStatus.UPLOADED, uploadedAt: new Date() },
    });
  }

  /**
   * A short-lived signed GET. Access gets checked here, on Livqeno's side. The
   * object itself stays private in the bucket, so a leaked URL grants one
   * file for a few minutes, not the whole bucket forever.
   */
  async createDownloadUrl(actor: ChatActor, attachmentPublicId: string): Promise<{ url: string; expiresAt: string }> {
    const storage = this.requireStorage();
    const attachment = await this.loadForActor(actor, attachmentPublicId);

    if (attachment.status !== AttachmentStatus.UPLOADED) {
      throw new ChatError(ChatErrorCode.ATTACHMENT_NOT_FOUND, 'That attachment has not finished uploading');
    }

    const ttl = this.configService.get<number>('storage.downloadUrlTtlSeconds')!;
    return {
      url: presignS3Url({ ...storage, method: 'GET', key: attachment.storageKey, expiresInSeconds: ttl }),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  /** Resolves an `att_...` id and confirms the caller may see its conversation. */
  private async loadForActor(actor: ChatActor, attachmentPublicId: string): Promise<Attachment> {
    const attachment = await this.prisma.attachment.findUnique({ where: { publicId: attachmentPublicId } });
    if (!attachment || attachment.projectId !== actor.projectId) {
      throw new ChatError(ChatErrorCode.ATTACHMENT_NOT_FOUND, `Attachment "${attachmentPublicId}" not found`);
    }

    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: attachment.conversationId },
    });
    // A membership check, not just project ownership. Being in the project
    // isn't the same as being in the conversation.
    const { scopes } = await this.conversations.authorize(actor, conversation.publicId);
    assertScope(scopes, 'chat:read', 'Accessing an attachment');

    return attachment;
  }

  private toTicketBase(attachment: Attachment, roomPublicId: string) {
    return {
      id: attachment.publicId,
      roomId: roomPublicId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.sizeBytes,
      storageKey: attachment.storageKey,
      status: attachment.status.toLowerCase(),
    };
  }

  private storageConfig() {
    return {
      endpoint: this.configService.get<string>('storage.endpoint'),
      region: this.configService.get<string>('storage.region')!,
      bucket: this.configService.get<string>('storage.bucket'),
      accessKeyId: this.configService.get<string>('storage.accessKeyId'),
      secretAccessKey: this.configService.get<string>('storage.secretAccessKey'),
      forcePathStyle: this.configService.get<boolean>('storage.forcePathStyle')!,
    };
  }

  private requireStorage(): S3PresignConfig {
    const storage = this.storageConfig();
    if (!storage.bucket || !storage.endpoint || !storage.accessKeyId || !storage.secretAccessKey) {
      throw new ChatError(
        ChatErrorCode.ATTACHMENTS_NOT_CONFIGURED,
        'Attachments are not enabled — set STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY (see docs/chat/attachments.md)',
      );
    }
    return storage as S3PresignConfig;
  }
}

/**
 * Filenames only ever go back out in a Content-Disposition header or a UI
 * label, never into a storage key. Stripping path separators and control
 * characters here means a hostile name can't turn into a header injection
 * downstream either.
 */
function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .replace(/[\\/]/g, '_')
    // CR/LF specifically: those are what turn into a header-injection payload.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 255)
    .trim();
  return cleaned || 'file';
}
