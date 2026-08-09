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
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
    scale: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
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
  orbGradient: [
    [0, '#1f2328'],
    [1, '#59636e'],
  ],
  idleColor: '#8c959f',
  recordingShadowColor: '#59636e',
};

const DARK_STYLE: WaveformStyle = {
  ...LIGHT_STYLE,
  orbGradient: [
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

  it('renders recording data as a closed radial orb', () => {
    const visualizer = new WaveformVisualizer(canvas, LIGHT_STYLE);

    visualizer.setRecording(true);
    visualizer.drawFrame(new Uint8Array([128, 150, 138, 106, 118, 145, 128, 111]));

    expect(context.arc).toHaveBeenCalled();
    expect(context.lineTo).toHaveBeenCalled();
    expect(context.closePath).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();
  });

  it('reads analyser data continuously while recording', () => {
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementationOnce((callback) => {
        callback(0);
        return 1;
      })
      .mockReturnValue(2);
    const analyser = {
      frequencyBinCount: 8,
      getByteTimeDomainData: vi.fn((data: Uint8Array) => data.fill(140)),
    } as unknown as AnalyserNode;
    const visualizer = new WaveformVisualizer(canvas, LIGHT_STYLE);

    visualizer.startLive(analyser);

    expect(analyser.getByteTimeDomainData).toHaveBeenCalledOnce();
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it('reuses the connected analyser across recording sessions', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const analyser = {
      frequencyBinCount: 8,
      getByteTimeDomainData: vi.fn(),
    } as unknown as AnalyserNode;
    const visualizer = new WaveformVisualizer(canvas, LIGHT_STYLE);

    visualizer.connectAnalyser(analyser);
    visualizer.start();
    visualizer.stop();
    visualizer.start();

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it('renders a stable recording ring when reduced motion is enabled', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const visualizer = new WaveformVisualizer(canvas, LIGHT_STYLE);

    visualizer.setRecording(true);
    visualizer.drawFrame(new Uint8Array([128, 160, 96, 150]));

    expect(context.arc).toHaveBeenCalledTimes(3);
    expect(context.lineTo).not.toHaveBeenCalled();
  });
});
