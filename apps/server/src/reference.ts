import type { TaskTarget } from '@expertise-sharing/shared';

/**
 * Fallback reference-image generator, used only when the expert client fails
 * to capture its own render. The primary path is a WebGL snapshot rendered in
 * the expert's browser with all editing helpers hidden (see
 * apps/web/src/scene.ts `captureReference`).
 */
export function renderReferencePlaceholder(target: TaskTarget): string {
  const intensity = target.light.intensity.toFixed(2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
  <rect width="640" height="360" fill="#232323"/>
  <text x="320" y="170" text-anchor="middle" fill="#aaaaaa" font-family="sans-serif" font-size="18" font-weight="bold">Reference image placeholder</text>
  <text x="320" y="198" text-anchor="middle" fill="#777777" font-family="sans-serif" font-size="13">Offscreen render arrives in build step 3</text>
  <text x="320" y="220" text-anchor="middle" fill="#555555" font-family="monospace" font-size="11">stored target: intensity ${intensity}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
