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

import type { AnalyserByteData } from '../types';

/** Visual style configuration for the waveform. */
export interface WaveformStyle {
  /** Bar fill — single color or linear gradient stops */
  barGradient: ReadonlyArray<readonly [number, string]>;
  /** Width of each bar in pixels (logical — DPR is handled separately) */
  barWidth: number;
  /** Gap between bars in pixels */
  barGap: number;
  /** Minimum bar height in pixels (so silence still shows a dot) */
  minBarHeight: number;
  /** Outer corner radius for bars */
  barRadius: number;
  /** Idle line color */
  idleColor: string;
  /** Recording shadow color */
  recordingShadowColor: string;
}

/** Default style — neutral light-theme fallbacks. */
const DEFAULT_STYLE: Readonly<WaveformStyle> = {
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
  /** Temporal smoothing — previous frame bar heights for interpolation */
  private prevBarHeights: number[] = [];
  /** Whether recording is active (toggles glow effect) */
  private isRecording = false;

  constructor(canvas: HTMLCanvasElement, style: WaveformStyle = DEFAULT_STYLE) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.style = style;
  }

  /**
   * Toggle recording visual state (enables glow on bars).
   */
  setRecording(active: boolean): void {
    this.isRecording = active;
    if (!active) this.prevBarHeights = [];
  }

  /** Replace visual colors after a theme change. */
  setStyle(style: WaveformStyle): void {
    this.style = style;
    this.cachedGradient = null;
  }

  /**
   * Start continuous animation from an AnalyserNode.
   * The analyser provides fresh time-domain data every frame.
   */
  startLive(analyser: AnalyserNode): void {
    this.analyserSource = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);

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
   * Draw the idle state — small dotted bars in the center to suggest readiness.
   */
  drawIdle(): void {
    const width = this.logicalWidth || this.canvas.width;
    const height = this.logicalHeight || this.canvas.height;
    const midY = height / 2;

    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = this.style.idleColor;
    this.ctx.globalAlpha = 0.5;

    const step = this.style.barWidth + this.style.barGap;
    const dotR = Math.max(1, this.style.barWidth / 2);
    for (let x = step / 2; x < width; x += step) {
      this.ctx.beginPath();
      this.ctx.arc(x, midY, dotR, 0, Math.PI * 2);
      this.ctx.fill();
    }
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
   * Core draw routine. Renders time-domain data as mirrored gradient bars.
   * The bars are computed by averaging the absolute deviation from silence
   * (128) across N equal-width buckets, producing a stable visual rhythm
   * regardless of FFT bin count.
   */
  private draw(data: Uint8Array): void {
    const width = this.logicalWidth || this.canvas.width;
    const height = this.logicalHeight || this.canvas.height;
    const midY = height / 2;

    // Clear previous frame
    this.ctx.clearRect(0, 0, width, height);

    const { barWidth, barGap, minBarHeight, barRadius } = this.style;
    const step = barWidth + barGap;
    const barCount = Math.max(1, Math.floor(width / step));
    const samplesPerBar = Math.max(1, Math.floor(data.length / barCount));

    // Build / reuse the vertical gradient.
    if (!this.cachedGradient) {
      const grad = this.ctx.createLinearGradient(0, 0, width, 0);
      for (const [stop, color] of this.style.barGradient) {
        grad.addColorStop(stop, color);
      }
      this.cachedGradient = grad;
    }
    this.ctx.fillStyle = this.cachedGradient;

    // Neutral glow effect when recording.
    if (this.isRecording) {
      this.ctx.shadowBlur = 6;
      this.ctx.shadowColor = this.style.recordingShadowColor;
    } else {
      this.ctx.shadowBlur = 0;
    }

    for (let i = 0; i < barCount; i++) {
      // Average deviation from 128 (silence) for this bar's samples.
      let sum = 0;
      const startIdx = i * samplesPerBar;
      const endIdx = Math.min(startIdx + samplesPerBar, data.length);
      for (let j = startIdx; j < endIdx; j++) {
        const value = data[j];
        if (value !== undefined) sum += Math.abs(value - 128);
      }
      const avg = sum / (endIdx - startIdx); // 0–127
      // Non-linear easing so quiet input still shows visible motion.
      const norm = Math.pow(avg / 128, 0.85);
      const rawBarH = Math.max(minBarHeight, norm * height * 0.95);

      // Temporal smoothing — interpolate from previous frame to reduce jitter
      const prev = this.prevBarHeights[i];
      const barH = prev !== undefined ? prev * 0.6 + rawBarH * 0.4 : rawBarH;
      this.prevBarHeights[i] = barH;

      const x = i * step + barGap / 2;
      const y = midY - barH / 2;

      this.roundedRect(x, y, barWidth, barH, barRadius);
      this.ctx.fill();
    }

    // Reset shadow after drawing
    this.ctx.shadowBlur = 0;
  }

  /**
   * Path a rounded rectangle (compat: not all environments expose roundRect).
   */
  private roundedRect(x: number, y: number, w: number, h: number, r: number): void {
    const radius = Math.min(r, w / 2, h / 2);
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + w - radius, y);
    this.ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    this.ctx.lineTo(x + w, y + h - radius);
    this.ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    this.ctx.lineTo(x + radius, y + h);
    this.ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.quadraticCurveTo(x, y, x + radius, y);
    this.ctx.closePath();
  }
}
