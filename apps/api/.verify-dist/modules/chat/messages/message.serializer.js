"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toMessageView = toMessageView;
exports.toAttachmentView = toAttachmentView;
exports.summarizeReactions = summarizeReactions;
function toMessageView(message, conversation, options = {}) {
    const deleted = message.deletedAt !== null;
    return {
        id: message.publicId,
        roomId: conversation.publicId,
        conversationId: conversation.publicId,
        senderId: message.senderId,
        type: message.type.toLowerCase(),
        text: deleted ? null : message.content,
        replyTo: options.replyToPublicId ?? null,
        threadRootId: options.threadRootPublicId ?? null,
        clientMessageId: message.clientMessageId,
        metadata: deleted ? null : (message.metadata ?? null),
        attachment: deleted ? null : toAttachmentView(message.attachments?.[0]),
        reactions: deleted ? [] : summarizeReactions(message.reactions ?? []),
        edited: message.editedAt !== null,
        deleted,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
        editedAt: message.editedAt?.toISOString() ?? null,
        deletedAt: message.deletedAt?.toISOString() ?? null,
    };
}
function toAttachmentView(attachment) {
    if (!attachment) {
        return null;
    }
    return {
        id: attachment.publicId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.sizeBytes,
        storageKey: attachment.storageKey,
        status: attachment.status.toLowerCase(),
    };
}
function summarizeReactions(reactions) {
    const byEmoji = new Map();
    for (const reaction of reactions) {
        const users = byEmoji.get(reaction.emoji);
        if (users) {
            users.push(reaction.userId);
        }
        else {
            byEmoji.set(reaction.emoji, [reaction.userId]);
        }
    }
    return Array.from(byEmoji.entries())
        .map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }))
        .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}
//# sourceMappingURL=message.serializer.js.map