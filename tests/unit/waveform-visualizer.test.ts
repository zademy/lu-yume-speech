/**
 * Waveform visualizer style contract.
 * Verifies injected monochrome colors and runtime theme refresh.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WaveformVisualizer, type WaveformStyle } from '../../src/audio/waveform-visualizer';

function createContext(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    fillStyle: '',
    globalAlpha: 1,
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    setTransform: vi.fn(),
    scale: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    shadowBlur: 0,
    shadowColor: '',
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

const LIGHT_STYLE: WaveformStyle = {
  barGradient: [
    [0, '#1f2328'],
    [1, '#59636e'],
  ],
  barWidth: 3,
  barGap: 2,
  minBarHeight: 2,
  barRadius: 2,
  idleColor: '#8c959f',
  recordingShadowColor: '#59636e',
};

const DARK_STYLE: WaveformStyle = {
  ...LIGHT_STYLE,
  barGradient: [
    [0, '#f0f6fc'],
    [1, '#9198a1'],
  ],
  idleColor: '#6e7681',
  recordingShadowColor: '#9198a1',
};

describe('WaveformVisualizer styles', () => {
  let canvas: HTMLCanvasElement;
  let context: CanvasRenderingContext2D;

  beforeEach(() => {
    context = createContext();
    canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 40;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
  });

  it('uses the injected idle color', () => {
    const visualizer = new WaveformVisualizer(canvas, LIGHT_STYLE);

    visualizer.drawIdle();

    expect(context.fillStyle).toBe('#8c959f');
  });

  it('replaces colors when the theme changes', () => {
    const visualizer = new WaveformVisualizer(canvas, LIGHT_STYLE);

    visualizer.setStyle(DARK_STYLE);
    visualizer.drawIdle();

    expect(context.fillStyle).toBe('#6e7681');
  });

  it('uses the injected recording shadow', () => {
    const visualizer = new WaveformVisualizer(canvas, DARK_STYLE);

    visualizer.setRecording(true);
    visualizer.drawFrame(new Uint8Array([128, 150, 128, 106]));

    expect(context.shadowColor).toBe('#9198a1');
  });
});
