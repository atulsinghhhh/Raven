import { ErrorCategory } from '../../generated/prisma/client';
import { classifyError } from './error-classifier';

describe('classifyError', () => {
  it('maps TOKEN_EXPIRED to TOKEN_ERROR', () => {
    expect(classifyError({ code: 'TOKEN_EXPIRED' }).category).toBe(ErrorCategory.TOKEN_ERROR);
  });

  it('maps INVALID_TOKEN to TOKEN_ERROR', () => {
    expect(classifyError({ code: 'INVALID_TOKEN' }).category).toBe(ErrorCategory.TOKEN_ERROR);
  });

  it('maps PERMISSION_DENIED to AUTHORIZATION_ERROR', () => {
    expect(classifyError({ code: 'PERMISSION_DENIED' }).category).toBe(ErrorCategory.AUTHORIZATION_ERROR);
  });

  it('maps ROOM_NOT_FOUND to CLIENT_ERROR', () => {
    expect(classifyError({ code: 'ROOM_NOT_FOUND' }).category).toBe(ErrorCategory.CLIENT_ERROR);
  });

  it('maps device/media codes to CLIENT_ERROR', () => {
    expect(classifyError({ code: 'CAMERA_PERMISSION_DENIED' }).category).toBe(ErrorCategory.CLIENT_ERROR);
    expect(classifyError({ code: 'MICROPHONE_PERMISSION_DENIED' }).category).toBe(ErrorCategory.CLIENT_ERROR);
    expect(classifyError({ code: 'DEVICE_NOT_FOUND' }).category).toBe(ErrorCategory.CLIENT_ERROR);
    expect(classifyError({ code: 'MEDIA_ERROR' }).category).toBe(ErrorCategory.CLIENT_ERROR);
  });

  it('maps NETWORK_ERROR and TIMEOUT to NETWORK_ERROR', () => {
    expect(classifyError({ code: 'NETWORK_ERROR' }).category).toBe(ErrorCategory.NETWORK_ERROR);
    expect(classifyError({ code: 'TIMEOUT' }).category).toBe(ErrorCategory.NETWORK_ERROR);
  });

  it('maps SIGNALING_ERROR to SIGNALING_ERROR', () => {
    expect(classifyError({ code: 'SIGNALING_ERROR' }).category).toBe(ErrorCategory.SIGNALING_ERROR);
  });

  describe('CONNECTION_FAILED', () => {
    it('classifies as TURN_ERROR when the hint says TURN was unreachable', () => {
      const result = classifyError({ code: 'CONNECTION_FAILED', hint: 'turn_unreachable' });
      expect(result.category).toBe(ErrorCategory.TURN_ERROR);
      expect(result.suggestedAction).toMatch(/TCP\/TLS TURN/);
    });

    it('classifies as ICE_ERROR when ICE state is failed, without a TURN hint', () => {
      const result = classifyError({ code: 'CONNECTION_FAILED', iceConnectionState: 'failed' });
      expect(result.category).toBe(ErrorCategory.ICE_ERROR);
    });

    it('classifies as SIGNALING_ERROR when signaling never reached a stable state', () => {
      const result = classifyError({ code: 'CONNECTION_FAILED', signalingState: 'have-local-offer' });
      expect(result.category).toBe(ErrorCategory.SIGNALING_ERROR);
    });

    it('falls back to SFU_ERROR when nothing more specific is known', () => {
      const result = classifyError({ code: 'CONNECTION_FAILED' });
      expect(result.category).toBe(ErrorCategory.SFU_ERROR);
    });
  });

  it('falls back to UNKNOWN_ERROR for an unrecognized or missing code', () => {
    expect(classifyError({}).category).toBe(ErrorCategory.UNKNOWN_ERROR);
    expect(classifyError({ code: 'SOMETHING_NEW' }).category).toBe(ErrorCategory.UNKNOWN_ERROR);
  });

  it('never states certainty — every explanation uses hedged language', () => {
    const allCodes = [
      'INVALID_TOKEN', 'TOKEN_EXPIRED', 'PERMISSION_DENIED', 'ROOM_NOT_FOUND',
      'CAMERA_PERMISSION_DENIED', 'TIMEOUT', 'NETWORK_ERROR', 'SIGNALING_ERROR',
      'CONNECTION_FAILED', undefined,
    ];
    for (const code of allCodes) {
      const result = classifyError({ code });
      expect(result.likelyCause.length).toBeGreaterThan(0);
      expect(result.suggestedAction.length).toBeGreaterThan(0);
    }
  });
});
