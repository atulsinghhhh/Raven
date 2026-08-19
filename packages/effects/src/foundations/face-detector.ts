import { EffectsError } from '../errors';

/**
 * PLANNED — no face detection model ships in Phase 16. This module defines
 * the interface future beauty/AR/mask effects will target, so those
 * features can land later without another breaking API change. Calling
 * `createFaceDetector()` today returns a detector whose `isSupported()` is
 * always `false` and whose `detect()` always rejects — it is not a stub
 * that silently returns empty/fake results.
 */

export type FaceLandmarkName =
  | 'leftEye'
  | 'rightEye'
  | 'noseTip'
  | 'mouthLeft'
  | 'mouthRight'
  | 'leftEyebrow'
  | 'rightEyebrow'
  | 'jawline';

export interface FaceLandmark {
  name: FaceLandmarkName;
  x: number;
  y: number;
}

export interface FaceRegion {
  /** A stable id for this face across frames, once tracking exists. */
  id: string;
  /** Normalized [0,1] bounding box, so it's resolution-independent. */
  boundingBox: { x: number; y: number; width: number; height: number };
  landmarks: FaceLandmark[];
  confidence: number;
}

export interface FaceDetector {
  isSupported(): boolean;
  /** Runs detection on the current pipeline frame. Rejects with RAVEN_EFFECT_UNSUPPORTED until a real model ships. */
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
      'Face detection is planned but not implemented in this Raven Effects release. isSupported() reports this — check it before calling detect().',
    );
  }

  onFacesChanged(): () => void {
    return () => {};
  }
}

export function createFaceDetector(): FaceDetector {
  return new UnsupportedFaceDetector();
}
