/**
 * `LiveStream.join()` calls the real `createRTCClient` and
 * `createChatClient` factories from `@corvidhq/rtc` and `@corvidhq/chat`,
 * and those packages have their own suites covering what a real
 * join/connect does over the network.
 *
 * What's under test here is only LiveStream's composition logic: which
 * credentials go where, what `isHost` reports, and whether `react()` and
 * `leave()` call through to the right underlying method. Both packages are
 * mocked, so nothing here sits waiting on a real WebRTC connection.
 */
import { createChatClient } from '@corvidhq/chat';
import { createRTCClient } from '@corvidhq/rtc';
import { LiveStream, joinLiveStream } from '../src/live/live-stream';
import type { LiveStreamCredentials } from '../src/live/types';

jest.mock('@corvidhq/rtc', () => ({
  createRTCClient: jest.fn(),
}));
jest.mock('@corvidhq/chat', () => ({
  createChatClient: jest.fn(),
}));

const mockCreateRTCClient = createRTCClient as jest.Mock;
const mockCreateChatClient = createChatClient as jest.Mock;

function fakeRoom() {
  return { roomId: 'stream_abc', leave: jest.fn() };
}

function fakeRtcClient(room: ReturnType<typeof fakeRoom>) {
  return { join: jest.fn().mockResolvedValue(room), leave: jest.fn() };
}

function fakeChatClient() {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    messages: { addReaction: jest.fn().mockResolvedValue({ reactions: [] }) },
  };
}

const RTC_ONLY_CREDENTIALS: LiveStreamCredentials = {
  streamId: 'stream_abc',
  role: 'VIEWER',
  rtc: { token: 'rtc-jwt', endpoint: 'ws://sfu.example' },
};

describe('LiveStream.join()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('joins the RTC room using the stream id, forwarding endpoint/iceServers/telemetryUrl as-is', async () => {
    const room = fakeRoom();
    const rtc = fakeRtcClient(room);
    mockCreateRTCClient.mockReturnValue(rtc);

    const credentials: LiveStreamCredentials = {
      streamId: 'stream_abc',
      role: 'HOST',
      rtc: { token: 'rtc-jwt', endpoint: 'ws://sfu.example', iceServers: [{ urls: 'stun:x' }], telemetryUrl: 'https://x' },
    };

    await LiveStream.join(credentials);

    expect(mockCreateRTCClient).toHaveBeenCalledWith({
      token: 'rtc-jwt',
      endpoint: 'ws://sfu.example',
      iceServers: [{ urls: 'stun:x' }],
      telemetryUrl: 'https://x',
    });
    expect(rtc.join).toHaveBeenCalledWith('stream_abc');
  });

  it('exposes the real Room and RTCClient, not wrappers', async () => {
    const room = fakeRoom();
    const rtc = fakeRtcClient(room);
    mockCreateRTCClient.mockReturnValue(rtc);

    const stream = await LiveStream.join(RTC_ONLY_CREDENTIALS);

    expect(stream.room).toBe(room);
    expect(stream.rtc).toBe(rtc);
  });

  it('never constructs a chat client when the credentials have no chat field', async () => {
    mockCreateRTCClient.mockReturnValue(fakeRtcClient(fakeRoom()));

    const stream = await LiveStream.join(RTC_ONLY_CREDENTIALS);

    expect(mockCreateChatClient).not.toHaveBeenCalled();
    expect(stream.chat).toBeUndefined();
  });

  it('connects chat to the conversation named in credentials.chat.conversations', async () => {
    mockCreateRTCClient.mockReturnValue(fakeRtcClient(fakeRoom()));
    const chat = fakeChatClient();
    mockCreateChatClient.mockReturnValue(chat);

    const credentials: LiveStreamCredentials = {
      ...RTC_ONLY_CREDENTIALS,
      chat: { token: 'chat-jwt', apiUrl: 'https://api.example', conversations: ['conv_xyz'] },
    };

    const stream = await LiveStream.join(credentials);

    expect(mockCreateChatClient).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'chat-jwt', apiUrl: 'https://api.example' }),
    );
    expect(chat.connect).toHaveBeenCalledWith({ room: 'conv_xyz' });
    expect(stream.chat).toBe(chat);
  });

  describe('isHost', () => {
    it.each([
      ['HOST', true],
      ['CO_HOST', true],
      ['VIEWER', false],
    ] as const)('role %s → isHost is %s', async (role, expected) => {
      mockCreateRTCClient.mockReturnValue(fakeRtcClient(fakeRoom()));

      const stream = await LiveStream.join({ ...RTC_ONLY_CREDENTIALS, role });

      expect(stream.isHost).toBe(expected);
    });
  });

  describe('react()', () => {
    it('adds a reaction to the stream\'s chatRootMessageId', async () => {
      mockCreateRTCClient.mockReturnValue(fakeRtcClient(fakeRoom()));
      const chat = fakeChatClient();
      mockCreateChatClient.mockReturnValue(chat);

      const stream = await LiveStream.join({
        ...RTC_ONLY_CREDENTIALS,
        chat: { token: 'chat-jwt', conversations: ['conv_xyz'] },
        chatRootMessageId: 'msg_root',
      });

      await stream.react('❤️');

      expect(chat.messages.addReaction).toHaveBeenCalledWith('msg_root', '❤️');
    });

    it('throws, rather than silently no-op-ing, when this instance has no chat credentials', async () => {
      mockCreateRTCClient.mockReturnValue(fakeRtcClient(fakeRoom()));

      const stream = await LiveStream.join(RTC_ONLY_CREDENTIALS);

      await expect(stream.react('❤️')).rejects.toThrow(/no chat credentials/);
    });

    it('throws when the stream has chat but no chatRootMessageId', async () => {
      mockCreateRTCClient.mockReturnValue(fakeRtcClient(fakeRoom()));
      mockCreateChatClient.mockReturnValue(fakeChatClient());

      const stream = await LiveStream.join({
        ...RTC_ONLY_CREDENTIALS,
        chat: { token: 'chat-jwt', conversations: ['conv_xyz'] },
        // chatRootMessageId omitted
      });

      await expect(stream.react('❤️')).rejects.toThrow(/chatRootMessageId/);
    });
  });

  describe('leave()', () => {
    it('leaves the RTC client and disconnects chat', async () => {
      const rtc = fakeRtcClient(fakeRoom());
      mockCreateRTCClient.mockReturnValue(rtc);
      const chat = fakeChatClient();
      mockCreateChatClient.mockReturnValue(chat);

      const stream = await LiveStream.join({
        ...RTC_ONLY_CREDENTIALS,
        chat: { token: 'chat-jwt', conversations: ['conv_xyz'] },
      });
      await stream.leave();

      expect(rtc.leave).toHaveBeenCalled();
      expect(chat.disconnect).toHaveBeenCalled();
    });

    it('leaves cleanly with no chat to disconnect', async () => {
      const rtc = fakeRtcClient(fakeRoom());
      mockCreateRTCClient.mockReturnValue(rtc);

      const stream = await LiveStream.join(RTC_ONLY_CREDENTIALS);

      await expect(stream.leave()).resolves.toBeUndefined();
      expect(rtc.leave).toHaveBeenCalled();
    });
  });

  describe('joinLiveStream (functional alias)', () => {
    it('is the same thing as LiveStream.join', async () => {
      mockCreateRTCClient.mockReturnValue(fakeRtcClient(fakeRoom()));

      const stream = await joinLiveStream(RTC_ONLY_CREDENTIALS);

      expect(stream).toBeInstanceOf(LiveStream);
    });
  });
});
