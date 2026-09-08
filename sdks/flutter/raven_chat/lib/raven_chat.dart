/// Raven Chat for Flutter — real-time messaging.
///
/// ```dart
/// final chat = RavenChat(token: token, apiUrl: apiUrl);
/// await chat.connect('room_123');
///
/// chat.messages.listen((message) => print('${message.senderId}: ${message.text}'));
/// await chat.send('Hello everyone!');
/// ```
///
/// Talks to the same Raven Chat service as the web and React Native
/// SDKs, over the same protocol — there is no mobile-specific backend.
/// Durable history, presence, typing, reactions, read receipts and
/// threads all behave identically across platforms.
///
/// Independent of `raven_rtc`: a messaging app never pulls in a WebRTC
/// stack, and a video app never pulls in a message store. Use both
/// together for a call with a chat panel.
library;

export 'src/chat_client.dart' show RavenChat;
export 'src/errors.dart' show RavenChatErrorCode, RavenChatException;
export 'src/models.dart'
    show
        RavenAttachment,
        RavenChatConnectionState,
        RavenMessage,
        RavenMessagePage,
        RavenMessageType,
        RavenPresence,
        RavenPresenceStatus,
        RavenReaction,
        RavenReactionEvent,
        RavenReadState,
        RavenTypingEvent;

// Deliberately not exported: the WebSocket channel, the REST client, the
// frame vocabulary, and the backoff policy. A developer using Raven Chat
// should never need to know a WebSocket is involved.
