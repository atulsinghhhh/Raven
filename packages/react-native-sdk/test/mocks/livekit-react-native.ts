/** Records what the SDK asks of the native layer, without any native layer. */
export const __calls = {
  registerGlobals: 0,
  startAudioSession: 0,
  stopAudioSession: 0,
  selectedOutputs: [] as string[],
};

export function registerGlobals(): void {
  __calls.registerGlobals += 1;
}

export const AudioSession = {
  startAudioSession: jest.fn(async () => {
    __calls.startAudioSession += 1;
  }),
  stopAudioSession: jest.fn(async () => {
    __calls.stopAudioSession += 1;
  }),
  selectAudioOutput: jest.fn(async (deviceId: string) => {
    __calls.selectedOutputs.push(deviceId);
  }),
  getAudioOutputs: jest.fn(async () => ['speaker', 'earpiece']),
  showAudioRoutePicker: jest.fn(async () => undefined),
  configureAudio: jest.fn(async () => undefined),
};

export function __resetCalls(): void {
  __calls.registerGlobals = 0;
  __calls.startAudioSession = 0;
  __calls.stopAudioSession = 0;
  __calls.selectedOutputs = [];
}
