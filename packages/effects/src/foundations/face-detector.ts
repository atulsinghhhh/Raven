import { EffectsError } from '../errors';

/**
 * PLANNED. No face detection model ships in Phase 16.
 *
 * What this module does is define the interface future beauty, AR and mask
 * effects will target, so those can land later without another breaking API
 * change.
 *
 * Call `createFaceDetector()` today and you get a detector whose
 * `isSupported()` is always `false` and whose `detect()` always rejects.
 * Not a stub that quietly hands back empty or invented results.
 */

export type FaceLandmarkName =
  'leftEye' | 'rightEye' | 'noseTip' | 'mouthLeft' | 'mouthRight' | 'leftEyebrow' | 'rightEyebrow' | 'jawline';

export interface FaceLandmark {
  name: FaceLandmarkName;
  x: number;
  y: number;
}

export interface FaceRegion {
  /** A stable id for this face across frames, once tracking exists. */
  id: string;
  /** Normalized [0,1] bounding box, so it doesn't care about resolution. */
  boundingBox: { x: number; y: number; width: number; height: number };
  landmarks: FaceLandmark[];
  confidence: number;
}

export interface FaceDetector {
  isSupported(): boolean;
  /** Runs detection on the current pipeline frame. Rejects with RAVEN_EFFECT_UNSUPPORTED until there's a real model. */
  detect(): Promise<FaceRegion[]>;
  onFacesChanged(handler: (faces: FaceRegion[]) => void): () => void;
}

class UnsupportedFaceDetector implements FaceDetector {
  isSupported(): boolean {
    return false;
  }

  async detect(): Promise<FaceRegion[]> {
    throw new EffectsError(
      'RAVEN_EFFECT_UNSUPPORTED',
      'Face detection is planned but not implemented in this Raven Effects release. isSupported() reports this; check it before calling detect().',
    );
  }

  onFacesChanged(): () => void {
    return () => {};
  }
}

export function createFaceDetector(): FaceDetector {
  return new UnsupportedFaceDetector();
}
