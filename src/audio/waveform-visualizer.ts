/**
 * Waveform visualizer.
 *
 * Draws a real-time audio waveform on an HTML canvas element.
 * Reads byte time-domain data from an AnalyserNode or Uint8Array snapshot
 * and renders a centered oscilloscope-style wave.
 *
 * SRP: This module's only job is drawing waveform data on a canvas.
 * DIP: It accepts raw data (Uint8Array), not the AudioAnalyzer itself.
 * OCP: New visual styles can be added without changing the data source.
 *
 * Usage:
 * ```ts
 * const viz = new WaveformVisualizer(canvas);
 * viz.start();  // begins animation loop
 * viz.stop();   // pauses drawing
 * viz.drawFrame(analyserNode);  // or manual single-frame draw
 * ```
 */

/** Visual style configuration for the waveform. */
export interface WaveformStyle {
  /** Stroke color of the waveform line */
  lineColor: string;
  /** Width of the waveform line in pixels */
  lineWidth: number;
  /** Background fill color */
  backgroundColor: string;
  /** Alpha (0–1) for the gradient glow effect */
  glowAlpha: number;
}

/** Default style matching the app's orange accent. */
const DEFAULT_STYLE: Readonly<WaveformStyle> = {
  lineColor: '#f97316',
  lineWidth: 2,
  backgroundColor: 'transparent',
  glowAlpha: 0.15,
};

export class WaveformVisualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly style: WaveformStyle;
  private animationFrame: number | null = null;
  private analyserSource: AnalyserNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;

  constructor(canvas: HTMLCanvasElement, style: WaveformStyle = DEFAULT_STYLE) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.style = style;
  }

  /**
   * Start continuous animation from an AnalyserNode.
   * The analyser provides fresh time-domain data every frame.
   */
  startLive(analyser: AnalyserNode): void {
    this.analyserSource = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;

    const loop = (): void => {
      if (!this.analyserSource || !this.dataArray) return;
      this.analyserSource.getByteTimeDomainData(this.dataArray);
      this.draw(this.dataArray);
      this.animationFrame = requestAnimationFrame(loop);
    };

    this.animationFrame = requestAnimationFrame(loop);
  }

  /**
   * Draw a single frame from a Uint8Array snapshot.
   * Use this when you want manual control over rendering timing.
   */
  drawFrame(data: Uint8Array<ArrayBuffer>): void {
    this.draw(data);
  }

  /**
   * Draw the idle state — a flat line in the center.
   */
  drawIdle(): void {
    const { width, height } = this.canvas;
    const midY = height / 2;

    this.ctx.clearRect(0, 0, width, height);
    this.ctx.strokeStyle = this.style.lineColor;
    this.ctx.lineWidth = 1;
    this.ctx.globalAlpha = 0.3;
    this.ctx.beginPath();
    this.ctx.moveTo(0, midY);
    this.ctx.lineTo(width, midY);
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
  }

  /**
   * Stop the animation loop.
   */
  stop(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.analyserSource = null;
    this.dataArray = null;
  }

  /**
   * Match the canvas internal resolution to its display size.
   * Call after the canvas is added to the DOM and on window resize.
   */
  syncSize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Core draw routine. Renders time-domain data as a centered waveform.
   */
  private draw(data: Uint8Array<ArrayBuffer>): void {
    const { width, height } = this.canvas;

    // Clear previous frame
    this.ctx.clearRect(0, 0, width, height);

    // Glow effect — broader, semi-transparent stroke underneath
    this.ctx.strokeStyle = this.style.lineColor;
    this.ctx.lineWidth = this.style.lineWidth * 3;
    this.ctx.globalAlpha = this.style.glowAlpha;
    this.drawPath(data, width, height);
    this.ctx.stroke();

    // Main waveform line
    this.ctx.lineWidth = this.style.lineWidth;
    this.ctx.globalAlpha = 1;
    this.drawPath(data, width, height);
    this.ctx.stroke();
  }

  /**
   * Trace the waveform path. Does NOT stroke — caller controls the stroke style.
   */
  private drawPath(data: Uint8Array<ArrayBuffer>, width: number, height: number): void {
    this.ctx.beginPath();

    const sliceWidth = width / data.length;
    let x = 0;

    for (let i = 0; i < data.length; i++) {
      // Map 0–255 to canvas height (128 = center/silence)
      const v = data[i] / 128.0;
      const y = (v * height) / 2;

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }
  }
}
