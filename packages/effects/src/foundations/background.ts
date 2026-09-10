import { EffectsError } from '../errors';

/**
 * PLANNED. No segmentation model ships in Phase 16.
 *
 * Real background blur or replacement needs Camera → Segmentation →
 * Foreground/Background → Composite → RTC (Phase 16 §17), and segmentation
 * is the missing piece. So this module only defines the extension point a
 * future engine will implement.
 *
 * `createBackgroundProcessor()` always reports unsupported. It does not
 * composite a fake background, and it does not quietly no-op as though it
 * had worked.
 */

export type BackgroundMode = 'blur' | 'replace';

export interface BackgroundProcessorConfig {
  mode: BackgroundMode;
  /** 0..1, only meaningful for `mode: 'blur'`. */
  blurAmount?: number;
  /** An image element or bitmap to composite behind the foreground. `mode: 'replace'` only. */
  replacementImage?: ImageBitmap | HTMLImageElement;
}

export interface BackgroundProcessor {
  isSupported(): boolean;
  configure(config: BackgroundProcessorConfig): void;
}

class UnsupportedBackgroundProcessor implements BackgroundProcessor {
  isSupported(): boolean {
    return false;
  }

  configure(): void {
    throw new EffectsError(
      'RAVEN_EFFECT_UNSUPPORTED',
      'Background blur/replacement is planned but not implemented in this Livqeno Effects release; it requires a segmentation model this release does not ship.',
    );
  }
}

export function createBackgroundProcessor(): BackgroundProcessor {
  return new UnsupportedBackgroundProcessor();
}
