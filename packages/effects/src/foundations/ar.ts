import { EffectsError } from '../errors';
import type { FaceDetector } from './face-detector';

/**
 * PLANNED. No AR tracking or rendering ships in Phase 16.
 *
 * Face masks, stickers and overlays all depend on FaceDetector, which is
 * itself planned (see face-detector.ts). So all this module does today is
 * define the Effect → Tracking → Anchor → Transform → Render extension
 * point (§18). When it does land, Livqeno ships its own placeholder example
 * assets. Never third-party proprietary art.
 */

export interface AnchorTransform {
  x: number;
  y: number;
  scale: number;
  rotationRadians: number;
}

export interface ARAnchor {
  id: string;
  landmarkTarget: string;
  transform: AnchorTransform;
}

export interface ARAsset {
  id: string;
  /** Livqeno-owned placeholder art only. security.ts has the size, type and dimension limits every asset must clear. */
  image: ImageBitmap | HTMLImageElement;
}

export interface AROverlay {
  isSupported(): boolean;
  attach(asset: ARAsset, anchor: Omit<ARAnchor, 'transform'>): ARAnchor;
  detach(anchorId: string): void;
}

class UnsupportedAROverlay implements AROverlay {
  constructor(private readonly faceDetector: FaceDetector) {}

  isSupported(): boolean {
    return this.faceDetector.isSupported();
  }

  attach(): ARAnchor {
    throw new EffectsError(
      'RAVEN_EFFECT_UNSUPPORTED',
      'AR overlays are planned but not implemented in this Livqeno Effects release; they require face tracking, which this release does not ship.',
    );
  }

  detach(): void {
    // Nothing is ever attached by this implementation.
  }
}

export function createAROverlay(faceDetector: FaceDetector): AROverlay {
  return new UnsupportedAROverlay(faceDetector);
}
