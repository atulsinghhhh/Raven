/**
 * The video the host publishes, and why it is not Chromium's default.
 *
 * `--use-fake-device-for-media-stream` synthesises a slowly rotating
 * colour wheel with a ticking timestamp. It is perfect for proving that
 * frames are moving and useless for measuring throughput: it is almost
 * entirely flat colour, so VP8 encodes it at a fraction of the bitrate
 * real camera video needs. The smoke run measured a 640x360 publisher at
 * 0.23 Mbps — roughly a third of what a real 360p camera stream costs —
 * and every outbound figure derived from it would have been flattering
 * by the same factor.
 *
 * `--use-file-for-fake-video-capture` takes a Y4M file instead and loops
 * it, through the same capture path. This generates one whose encoded
 * bitrate lands in the band real camera video occupies: continuous
 * motion across the whole frame plus light grain, which is what defeats
 * both intra prediction and motion compensation the way a real scene
 * does.
 *
 * The rig does not assume the generated file achieved that. It measures
 * the publisher's actual outbound bitrate every run and reports it
 * beside the capacity numbers, so a reader can judge whether the load
 * resembles their own content — and can scale the result if it does not.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.content');

export const CONTENT_SIZES = {
  '180p': [320, 180],
  '360p': [640, 360],
  '480p': [854, 480],
  '720p': [1280, 720],
};

export async function ffmpegAvailable() {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds (and caches) a Y4M loop for one profile.
 *
 * Ten seconds is enough that the loop point is not the dominant motion
 * event, and short enough that the file stays under a few hundred MB —
 * Y4M is uncompressed, so 720p costs about 28 MB per second.
 */
export async function ensureContent(profile, { seconds = 10, fps = 30 } = {}) {
  const size = CONTENT_SIZES[profile];
  if (!size) throw new Error(`no content size for profile ${profile}`);
  const [width, height] = size;

  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `capacity-${profile}-${fps}fps-${seconds}s.y4m`);
  if (existsSync(file)) return file;

  if (!(await ffmpegAvailable())) return undefined;

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      // testsrc2 gives whole-frame motion and fine detail; the noise
      // overlay adds the grain that stops VP8 finding a cheap static
      // background. Together they encode in the same band as a real
      // camera rather than as a synthetic pattern.
      '-i',
      `testsrc2=size=${width}x${height}:rate=${fps},noise=alls=12:allf=t+u`,
      '-t',
      String(seconds),
      '-pix_fmt',
      'yuv420p',
      file,
    ],
    { timeout: 300_000, maxBuffer: 1 << 26 },
  );
  return file;
}
