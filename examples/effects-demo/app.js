// Raven Effects demo — built entirely on @corvidhq/effects. No
// @corvidhq/rtc/signaling involved: this demonstrates the pipeline itself
// against a real getUserMedia() track, which is exactly what
// LocalTrack.attachEffects() does internally once it's wired to a room.
import { effects } from '@corvidhq/effects';

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $('log');
  el.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
  el.scrollTop = el.scrollHeight;
};

const FILTERS = {
  original: (pipeline) => {},
  warm: (pipeline) => pipeline.applyPreset(effects.presets.warm),
  cool: (pipeline) => pipeline.applyPreset(effects.presets.cool),
  cinematic: (pipeline) => pipeline.applyPreset(effects.presets.cinematic),
  vivid: (pipeline) => pipeline.applyPreset(effects.presets.vivid),
  vintage: (pipeline) => pipeline.applyPreset(effects.presets.vintage),
  beauty: (pipeline) => pipeline.add(effects.beauty.smooth({ amount: 0.5 })),
  blur: (pipeline) => pipeline.add(effects.filters.blur({ radius: 10 })),
};

async function main() {
  const caps = effects.detectCapabilities();
  log(`Capabilities: webgl2=${caps.webgl2} captureStream=${caps.captureStream} recommendedEngine=${caps.recommendedEngine}`);

  let cameraTrack;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    [cameraTrack] = stream.getVideoTracks();
    $('originalVideo').srcObject = stream;
  } catch (error) {
    $('status').textContent = `Camera access failed: ${error.message}`;
    log(`getUserMedia failed: ${error.message}`);
    return;
  }

  const pipeline = effects.createPipeline();

  pipeline.on('error', (error) => {
    log(`pipeline error: ${error.code} — ${error.message}`);
    $('status').textContent = `Effect unsupported here (${error.code}) — showing the original camera track.`;
  });

  pipeline.on('stats', (stats) => {
    $('stats').textContent =
      `engine=${stats.engine} fps=${stats.fps.toFixed(1)} avgFrameTime=${stats.averageFrameTimeMs.toFixed(2)}ms ` +
      `dropped=${stats.droppedFrames} frames=${stats.framesProcessed}`;
  });

  const processedTrack = await pipeline.attachToTrack(cameraTrack);
  $('processedVideo').srcObject = new MediaStream([processedTrack]);

  $('status').textContent = `Running on engine: ${pipeline.engineKind}`;
  log(`Pipeline attached — engine: ${pipeline.engineKind}`);

  const buttons = document.querySelectorAll('#filters button');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.filter;
      pipeline.clear();
      FILTERS[key](pipeline);
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      log(`Filter selected: ${key} (${pipeline.effects.length} effect(s) active)`);
    });
  });
}

main();
