/**
 * Audio orb visualizer.
 *
 * Draws a real-time layered voice orb on an HTML canvas element.
 * Reads byte time-domain data from an AnalyserNode or Uint8Array snapshot
 * and maps damped energy bands to translucent, independently moving ribbons.
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
const MAX_FRAME_DELTA_SECONDS = 0.05;

interface AudioMotion {
  energy: number;
  bass: number;
  mid: number;
  treble: number;
}

interface OrbGradients {
  aura: CanvasGradient;
  ribbon: CanvasGradient;
  core: CanvasGradient;
}

interface RibbonLayer {
  lobes: number;
  phaseOffset: number;
  direction: 1 | -1;
  speed: number;
  scale: number;
  opacity: number;
  band: keyof Pick<AudioMotion, 'bass' | 'mid' | 'treble'>;
}

const RIBBON_LAYERS: readonly RibbonLayer[] = [
  { lobes: 3, phaseOffset: 0, direction: 1, speed: 0.45, scale: 1, opacity: 0.28, band: 'bass' },
  {
    lobes: 4,
    phaseOffset: Math.PI * 0.37,
    direction: -1,
    speed: 0.62,
    scale: 0.94,
    opacity: 0.24,
    band: 'mid',
  },
  {
    lobes: 5,
    phaseOffset: Math.PI * 0.71,
    direction: 1,
    speed: 0.78,
    scale: 0.88,
    opacity: 0.2,
    band: 'treble',
  },
  {
    lobes: 6,
    phaseOffset: Math.PI * 1.13,
    direction: -1,
    speed: 0.95,
    scale: 0.82,
    opacity: 0.16,
    band: 'mid',
  },
];

export class WaveformVisualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private style: WaveformStyle;
  private animationFrame: number | null = null;
  private analyserSource: AnalyserNode | null = null;
  private dataArray: AnalyserByteData | null = null;
  private frequencyArray: AnalyserByteData | null = null;
  /** Cached logical (CSS-pixel) dimensions — refreshed by syncSize() */
  private logicalWidth = 0;
  private logicalHeight = 0;
  /** Cached gradients (recomputed when size or theme changes). */
  private cachedGradients: OrbGradients | null = null;
  private motion: AudioMotion = { energy: 0, bass: 0, mid: 0, treble: 0 };
  private phase = 0;
  private lastFrameTime: number | null = null;
  private isAnimating = false;
  /** Whether recording is active (toggles glow effect). */
  private isRecording = false;

  constructor(canvas: HTMLCanvasElement, style: WaveformStyle = DEFAULT_STYLE) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is required for the audio visualizer');
    this.ctx = context;
    this.style = style;
  }

  /**
   * Toggle recording visual state (enables glow on bars).
   */
  setRecording(active: boolean): void {
    this.isRecording = active;
    if (!active) {
      this.motion = { energy: 0, bass: 0, mid: 0, treble: 0 };
      this.phase = 0;
      this.lastFrameTime = null;
    }
  }

  /** Replace visual colors after a theme change. */
  setStyle(style: WaveformStyle): void {
    this.style = style;
    this.cachedGradients = null;
  }

  /** Attach the analyser that supplies live microphone samples. */
  connectAnalyser(analyser: AnalyserNode): void {
    this.analyserSource = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);
    this.frequencyArray = new Uint8Array(analyser.frequencyBinCount);
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
    this.isAnimating = false;
    this.lastFrameTime = null;
    this.analyserSource = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);
    this.frequencyArray = new Uint8Array(analyser.frequencyBinCount);

    if (this.prefersReducedMotion()) {
      analyser.getByteTimeDomainData(this.dataArray);
      this.readFrequencyData(analyser, this.frequencyArray);
      this.draw(this.dataArray, 1 / 60, true, this.frequencyArray);
      return;
    }

    this.isAnimating = true;
    const loop = (timestamp: number): void => {
      if (!this.isAnimating || !this.analyserSource || !this.dataArray || !this.frequencyArray)
        return;
      const deltaSeconds =
        this.lastFrameTime === null
          ? 1 / 60
          : Math.min(MAX_FRAME_DELTA_SECONDS, Math.max(0, (timestamp - this.lastFrameTime) / 1000));
      this.lastFrameTime = timestamp;
      this.analyserSource.getByteTimeDomainData(this.dataArray);
      this.readFrequencyData(this.analyserSource, this.frequencyArray);
      this.draw(this.dataArray, deltaSeconds, false, this.frequencyArray);
      this.animationFrame = requestAnimationFrame(loop);
    };

    this.animationFrame = requestAnimationFrame(loop);
  }

  /**
   * Draw a single frame from a Uint8Array snapshot.
   * Use this when you want manual control over rendering timing.
   */
  drawFrame(data: Uint8Array): void {
    this.draw(data, 1 / 60, this.prefersReducedMotion(), null);
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
    this.isAnimating = false;
    this.lastFrameTime = null;
    this.dataArray = null;
    this.frequencyArray = null;
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
    // Invalidate cached gradients so they rebuild at the new size.
    this.cachedGradients = null;
    if (!this.isAnimating) this.drawIdle();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Core draw routine. Renders time-domain data as a radial, audio-reactive orb.
   */
  private draw(
    data: Uint8Array,
    deltaSeconds: number,
    reducedMotion: boolean,
    frequencyData: Uint8Array | null,
  ): void {
    const width = this.logicalWidth || this.canvas.width;
    const height = this.logicalHeight || this.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const baseRadius = this.getBaseRadius(width, height);

    this.ctx.clearRect(0, 0, width, height);

    const targets = this.analyzeMotion(data, frequencyData);
    this.motion = {
      energy: this.damp(this.motion.energy, targets.energy, deltaSeconds, 18, 5),
      bass: this.damp(this.motion.bass, targets.bass, deltaSeconds, 14, 4),
      mid: this.damp(this.motion.mid, targets.mid, deltaSeconds, 12, 4),
      treble: this.damp(this.motion.treble, targets.treble, deltaSeconds, 10, 5),
    };
    const gradients = this.getGradients(centerX, centerY, baseRadius);

    if (reducedMotion) {
      this.drawStableOrb(centerX, centerY, baseRadius, gradients);
      return;
    }

    this.phase += deltaSeconds * (0.82 + this.motion.energy * 0.68);
    this.drawAura(centerX, centerY, baseRadius, gradients.aura);
    for (const layer of RIBBON_LAYERS) {
      this.drawRibbon(centerX, centerY, baseRadius, gradients.ribbon, layer);
    }
    this.drawCore(centerX, centerY, baseRadius, gradients.core);
    this.drawActivityRing(centerX, centerY, baseRadius);
    this.resetContextEffects();
  }

  private getGradients(centerX: number, centerY: number, radius: number): OrbGradients {
    if (this.cachedGradients) return this.cachedGradients;

    const aura = this.ctx.createRadialGradient(
      centerX,
      centerY,
      radius * 0.2,
      centerX,
      centerY,
      radius * 1.65,
    );
    aura.addColorStop(0, this.style.recordingShadowColor);
    aura.addColorStop(1, this.style.idleColor);

    const ribbon = this.ctx.createRadialGradient(
      centerX - radius * 0.24,
      centerY - radius * 0.3,
      radius * 0.06,
      centerX,
      centerY,
      radius * 1.2,
    );
    for (const [stop, color] of this.style.orbGradient) ribbon.addColorStop(stop, color);

    const core = this.ctx.createRadialGradient(
      centerX - radius * 0.12,
      centerY - radius * 0.16,
      0,
      centerX,
      centerY,
      radius * 0.62,
    );
    for (const [stop, color] of this.style.orbGradient) core.addColorStop(stop, color);

    this.cachedGradients = { aura, ribbon, core };
    return this.cachedGradients;
  }

  private drawAura(
    centerX: number,
    centerY: number,
    radius: number,
    gradient: CanvasGradient,
  ): void {
    const breath = Math.sin(this.phase * 1.35) * 0.025;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(
      centerX,
      centerY,
      radius * (1.25 + breath + this.motion.energy * 0.18),
      0,
      Math.PI * 2,
    );
    this.ctx.fillStyle = gradient;
    this.ctx.globalAlpha = 0.08 + this.motion.energy * 0.12;
    this.ctx.shadowBlur = 18 + this.motion.energy * 20;
    this.ctx.shadowColor = this.style.recordingShadowColor;
    this.ctx.fill();
    this.ctx.restore();
  }

  private drawRibbon(
    centerX: number,
    centerY: number,
    radius: number,
    gradient: CanvasGradient,
    layer: RibbonLayer,
  ): void {
    const bandEnergy = this.motion[layer.band];
    const opening = 0.16 + this.motion.energy * 0.17 + bandEnergy * 0.13;
    const rotation =
      layer.phaseOffset + layer.direction * this.phase * layer.speed * (1 + this.motion.mid * 0.5);

    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(rotation);
    this.ctx.beginPath();
    for (let index = 0; index < ORB_POINT_COUNT; index++) {
      const angle = (index / ORB_POINT_COUNT) * Math.PI * 2 - Math.PI / 2;
      const twist =
        Math.sin(angle * 2 - this.phase * layer.direction) * (0.18 + this.motion.mid * 0.2);
      const petal = 0.5 + Math.sin(angle * layer.lobes + twist + layer.phaseOffset) * 0.5;
      const ripple =
        Math.sin(angle * (layer.lobes + 2) - this.phase * 0.7) * this.motion.treble * 0.025;
      const pointRadius = radius * layer.scale * (0.68 + opening * petal + ripple);
      const x = Math.cos(angle) * pointRadius;
      const y = Math.sin(angle) * pointRadius;
      if (index === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.closePath();
    this.ctx.fillStyle = gradient;
    this.ctx.globalAlpha = layer.opacity + bandEnergy * 0.1;
    this.ctx.shadowBlur = this.isRecording ? 8 + this.motion.energy * 12 : 0;
    this.ctx.shadowColor = this.style.recordingShadowColor;
    this.ctx.fill();
    this.ctx.restore();
  }

  private drawCore(
    centerX: number,
    centerY: number,
    radius: number,
    gradient: CanvasGradient,
  ): void {
    const breath = Math.sin(this.phase * 1.35) * 0.018;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(
      centerX,
      centerY,
      radius * (0.43 + breath + this.motion.energy * 0.09),
      0,
      Math.PI * 2,
    );
    this.ctx.fillStyle = gradient;
    this.ctx.globalAlpha = 0.9;
    this.ctx.shadowBlur = 12 + this.motion.energy * 22;
    this.ctx.shadowColor = this.style.recordingShadowColor;
    this.ctx.fill();
    this.ctx.strokeStyle = this.style.recordingShadowColor;
    this.ctx.globalAlpha = 0.48;
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawActivityRing(centerX: number, centerY: number, radius: number): void {
    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(this.phase * 0.16);
    this.ctx.lineCap = 'round';
    this.ctx.setLineDash([1.5, 5]);
    this.ctx.strokeStyle = this.style.idleColor;
    this.ctx.lineWidth = 1;
    this.ctx.globalAlpha = 0.3;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, radius * 1.27, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.setLineDash([3, 4]);
    this.ctx.strokeStyle = this.style.recordingShadowColor;
    this.ctx.lineWidth = 1.8;
    this.ctx.globalAlpha = 0.55 + this.motion.treble * 0.35;
    this.ctx.beginPath();
    this.ctx.arc(
      0,
      0,
      radius * 1.27,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * (0.25 + this.motion.treble * 1.35),
    );
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawStableOrb(
    centerX: number,
    centerY: number,
    radius: number,
    gradients: OrbGradients,
  ): void {
    this.drawAura(centerX, centerY, radius, gradients.aura);
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, radius * (0.82 + this.motion.energy * 0.08), 0, Math.PI * 2);
    this.ctx.fillStyle = gradients.ribbon;
    this.ctx.globalAlpha = 0.62;
    this.ctx.fill();
    this.ctx.restore();
    this.drawCore(centerX, centerY, radius, gradients.core);
    this.drawActivityRing(centerX, centerY, radius);
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

  private analyzeMotion(data: Uint8Array, frequencyData: Uint8Array | null): AudioMotion {
    const energy = this.computeEnergy(data);
    if (frequencyData && frequencyData.length > 0) {
      return {
        energy,
        bass: this.averageBytes(frequencyData, 0, Math.ceil(frequencyData.length * 0.12)),
        mid: this.averageBytes(
          frequencyData,
          Math.ceil(frequencyData.length * 0.12),
          Math.ceil(frequencyData.length * 0.42),
        ),
        treble: this.averageBytes(
          frequencyData,
          Math.ceil(frequencyData.length * 0.42),
          frequencyData.length,
        ),
      };
    }
    if (data.length < 4) return { energy, bass: energy, mid: energy, treble: energy };

    const sampleCount = Math.min(128, data.length);
    const sampleStep = data.length / sampleCount;
    const binCount = Math.min(12, Math.max(1, Math.floor(sampleCount / 2) - 1));
    const magnitudes: number[] = [];
    for (let bin = 1; bin <= binCount; bin++) {
      let real = 0;
      let imaginary = 0;
      for (let index = 0; index < sampleCount; index++) {
        const sourceIndex = Math.min(data.length - 1, Math.floor(index * sampleStep));
        const sample = ((data[sourceIndex] ?? 128) - 128) / 128;
        const angle = (Math.PI * 2 * bin * index) / sampleCount;
        real += sample * Math.cos(angle);
        imaginary -= sample * Math.sin(angle);
      }
      magnitudes.push(Math.min(1, (Math.hypot(real, imaginary) / sampleCount) * 5));
    }

    const third = Math.max(1, Math.ceil(magnitudes.length / 3));
    return {
      energy,
      bass: this.average(magnitudes, 0, third),
      mid: this.average(magnitudes, third, third * 2),
      treble: this.average(magnitudes, third * 2, magnitudes.length),
    };
  }

  private average(values: readonly number[], start: number, end: number): number {
    const sliceEnd = Math.min(values.length, end);
    if (start >= sliceEnd) return 0;
    let sum = 0;
    for (let index = start; index < sliceEnd; index++) sum += values[index] ?? 0;
    return sum / (sliceEnd - start);
  }

  private averageBytes(values: Uint8Array, start: number, end: number): number {
    const sliceEnd = Math.min(values.length, end);
    if (start >= sliceEnd) return 0;
    let sum = 0;
    for (let index = start; index < sliceEnd; index++) sum += values[index] ?? 0;
    return sum / (sliceEnd - start) / 255;
  }

  private readFrequencyData(analyser: AnalyserNode, target: Uint8Array): void {
    analyser.getByteFrequencyData(target as AnalyserByteData);
  }

  private damp(
    current: number,
    target: number,
    deltaSeconds: number,
    attack: number,
    release: number,
  ): number {
    const rate = target > current ? attack : release;
    return current + (target - current) * (1 - Math.exp(-rate * deltaSeconds));
  }

  private prefersReducedMotion(): boolean {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  private getBaseRadius(width: number, height: number): number {
    return Math.max(18, Math.min(height * 0.22, width * 0.16, 42));
  }

  private resetContextEffects(): void {
    this.ctx.shadowBlur = 0;
    this.ctx.globalAlpha = 1;
  }
}
