/**
 * Audio orb visualizer.
 *
 * Draws a real-time radial voice orb on an HTML canvas element.
 * Reads byte time-domain data from an AnalyserNode or Uint8Array snapshot
 * and maps its energy to a smooth, organic circular shape.
 *
 * SRP: This module's only job is drawing audio data on a canvas.
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

import type { AnalyserByteData } from '../types';

/** Visual style configuration for the audio orb. */
export interface WaveformStyle {
  /** Orb fill gradient stops. */
  orbGradient: ReadonlyArray<readonly [number, string]>;
  /** Idle ring color. */
  idleColor: string;
  /** Recording glow and outline color. */
  recordingShadowColor: string;
}

/** Default style — neutral light-theme fallbacks. */
const DEFAULT_STYLE: Readonly<WaveformStyle> = {
  orbGradient: [
    [0, '#1f2328'],
    [1, '#59636e'],
  ],
  idleColor: '#8c959f',
  recordingShadowColor: '#59636e',
};

const ORB_POINT_COUNT = 96;

export class WaveformVisualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private style: WaveformStyle;
  private animationFrame: number | null = null;
  private analyserSource: AnalyserNode | null = null;
  private dataArray: AnalyserByteData | null = null;
  /** Cached logical (CSS-pixel) dimensions — refreshed by syncSize() */
  private logicalWidth = 0;
  private logicalHeight = 0;
  /** Cached gradient (recomputed when size changes) */
  private cachedGradient: CanvasGradient | null = null;
  /** Previous radial points used for attack/release smoothing. */
  private previousRadii: number[] = [];
  private smoothedEnergy = 0;
  private phase = 0;
  private readonly reduceMotion: boolean;
  /** Whether recording is active (toggles glow effect). */
  private isRecording = false;

  constructor(canvas: HTMLCanvasElement, style: WaveformStyle = DEFAULT_STYLE) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is required for the audio visualizer');
    this.ctx = context;
    this.style = style;
    this.reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Toggle recording visual state (enables glow on bars).
   */
  setRecording(active: boolean): void {
    this.isRecording = active;
    if (!active) {
      this.previousRadii = [];
      this.smoothedEnergy = 0;
      this.phase = 0;
    }
  }

  /** Replace visual colors after a theme change. */
  setStyle(style: WaveformStyle): void {
    this.style = style;
    this.cachedGradient = null;
  }

  /** Attach the analyser that supplies live microphone samples. */
  connectAnalyser(analyser: AnalyserNode): void {
    this.analyserSource = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);
  }

  /** Start drawing from the connected analyser. */
  start(): void {
    if (!this.analyserSource) return;
    this.startLive(this.analyserSource);
  }

  /**
   * Start continuous animation from an AnalyserNode.
   * The analyser provides fresh time-domain data every frame.
   */
  startLive(analyser: AnalyserNode): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.analyserSource = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);

    if (this.reduceMotion) {
      analyser.getByteTimeDomainData(this.dataArray);
      this.draw(this.dataArray);
      return;
    }

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
  drawFrame(data: Uint8Array): void {
    this.draw(data);
  }

  /**
   * Draw the idle state as a quiet set of concentric rings.
   */
  drawIdle(): void {
    const width = this.logicalWidth || this.canvas.width;
    const height = this.logicalHeight || this.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = this.getBaseRadius(width, height);

    this.ctx.clearRect(0, 0, width, height);
    this.drawAmbientRings(centerX, centerY, radius);
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = this.style.idleColor;
    this.ctx.globalAlpha = 0.1;
    this.ctx.fill();
    this.ctx.strokeStyle = this.style.idleColor;
    this.ctx.lineWidth = 1.25;
    this.ctx.globalAlpha = 0.65;
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
    this.dataArray = null;
  }

  /**
   * Match the canvas internal resolution to its display size.
   * Call after the canvas is added to the DOM and on window resize.
   */
  syncSize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    // Reset transform before applying DPR scaling (idempotent across resizes).
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.logicalWidth = rect.width;
    this.logicalHeight = rect.height;
    // Invalidate cached gradient so it rebuilds at the new size.
    this.cachedGradient = null;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Core draw routine. Renders time-domain data as a radial, audio-reactive orb.
   */
  private draw(data: Uint8Array): void {
    const width = this.logicalWidth || this.canvas.width;
    const height = this.logicalHeight || this.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const baseRadius = this.getBaseRadius(width, height);

    this.ctx.clearRect(0, 0, width, height);

    const targetEnergy = this.computeEnergy(data);
    const smoothing = targetEnergy > this.smoothedEnergy ? 0.28 : 0.1;
    this.smoothedEnergy += (targetEnergy - this.smoothedEnergy) * smoothing;

    this.drawAmbientRings(centerX, centerY, baseRadius);

    if (!this.cachedGradient) {
      const grad = this.ctx.createRadialGradient(
        centerX - baseRadius * 0.25,
        centerY - baseRadius * 0.3,
        baseRadius * 0.08,
        centerX,
        centerY,
        baseRadius * 1.45,
      );
      for (const [stop, color] of this.style.orbGradient) {
        grad.addColorStop(stop, color);
      }
      this.cachedGradient = grad;
    }
    this.ctx.fillStyle = this.cachedGradient;
    this.ctx.strokeStyle = this.style.recordingShadowColor;
    this.ctx.lineWidth = 1.5;
    this.ctx.lineJoin = 'round';
    this.ctx.lineCap = 'round';
    this.ctx.globalAlpha = 0.92;
    if (this.isRecording) {
      this.ctx.shadowBlur = 14 + this.smoothedEnergy * 18;
      this.ctx.shadowColor = this.style.recordingShadowColor;
    }

    if (this.reduceMotion) {
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, baseRadius + this.smoothedEnergy * 4, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
      this.resetContextEffects();
      return;
    }

    this.phase += 0.012 + this.smoothedEnergy * 0.008;
    for (let index = 0; index < ORB_POINT_COUNT; index++) {
      const angle = (index / ORB_POINT_COUNT) * Math.PI * 2 - Math.PI / 2;
      const sampleIndex = Math.floor((index / ORB_POINT_COUNT) * data.length);
      const sample = data[sampleIndex] ?? 128;
      const localAmplitude = Math.abs(sample - 128) / 128;
      const organicMotion =
        Math.sin(angle * 3 + this.phase) * 0.55 +
        Math.sin(angle * 5 - this.phase * 1.7) * 0.3 +
        Math.sin(angle * 7 + this.phase * 0.8) * 0.15;
      const targetRadius =
        baseRadius +
        this.smoothedEnergy * 6 +
        localAmplitude * (7 + this.smoothedEnergy * 10) +
        organicMotion * (1.2 + this.smoothedEnergy * 3.5);
      const previous = this.previousRadii[index];
      const radius = previous === undefined ? targetRadius : previous * 0.72 + targetRadius * 0.28;
      this.previousRadii[index] = radius;

      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      if (index === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    this.resetContextEffects();
  }

  private drawAmbientRings(centerX: number, centerY: number, radius: number): void {
    this.ctx.strokeStyle = this.style.idleColor;
    this.ctx.lineWidth = 1;
    for (const [offset, alpha] of [
      [12, 0.22],
      [22, 0.1],
    ] as const) {
      this.ctx.globalAlpha = alpha;
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius + offset, 0, Math.PI * 2);
      this.ctx.stroke();
    }
    this.ctx.globalAlpha = 1;
  }

  private computeEnergy(data: Uint8Array): number {
    if (data.length === 0) return 0;
    let sumSquares = 0;
    for (const value of data) {
      const normalized = (value - 128) / 128;
      sumSquares += normalized * normalized;
    }
    return Math.min(1, Math.sqrt(sumSquares / data.length) * 3.5);
  }

  private getBaseRadius(width: number, height: number): number {
    return Math.max(18, Math.min(height * 0.22, width * 0.16, 42));
  }

  private resetContextEffects(): void {
    this.ctx.shadowBlur = 0;
    this.ctx.globalAlpha = 1;
  }
}
