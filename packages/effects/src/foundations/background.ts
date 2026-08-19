import { EffectsError } from '../errors';

/**
 * PLANNED — no segmentation model ships in Phase 16. Real background
 * blur/replacement needs Camera → Segmentation → Foreground/Background →
 * Composite → RTC (Phase 16 §17); segmentation is the missing piece, so
 * this module only defines the extension point a future engine will
 * implement. `createBackgroundProcessor()` always reports unsupported —
 * it does not composite a fake background or silently no-op as if it
 * worked.
 */

export type BackgroundMode = 'blur' | 'replace';

export interface BackgroundProcessorConfig {
  mode: BackgroundMode;
  /** 0..1, only meaningful for `mode: 'blur'`. */
  blurAmount?: number;
  /** An image element/bitmap to composite behind the foreground, only for `mode: 'replace'`. */
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
      'Background blur/replacement is planned but not implemented in this Raven Effects release — it requires a segmentation model this release does not ship.',
    );
  }
}

export function createBackgroundProcessor(): BackgroundProcessor {
  return new UnsupportedBackgroundProcessor();
}
