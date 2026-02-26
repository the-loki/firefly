import { Device } from './device.js';
import { Renderer } from './renderer.js';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  alpha?: boolean;
}

/**
 * The main Firefly Engine class
 * Manages the WebGPU device and rendering pipeline
 */
export class Engine {
  private device: Device | null = null;
  private renderer: Renderer | null = null;
  private isRunning = false;

  constructor(private options: EngineOptions) {}

  /**
   * Initialize the engine and WebGPU device
   */
  async initialize(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    this.device = new Device();
    await this.device.initialize(this.options.canvas, {
      antialias: this.options.antialias ?? true,
      alpha: this.options.alpha ?? false,
    });

    this.renderer = new Renderer(this.device);
    console.log('🔥 Firefly Engine initialized');
  }

  /**
   * Start the render loop
   */
  start(): void {
    if (!this.device || !this.renderer) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }

    this.isRunning = true;
    this.render();
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * Get the underlying WebGPU device
   */
  getDevice(): Device {
    if (!this.device) {
      throw new Error('Engine not initialized');
    }
    return this.device;
  }

  /**
   * Get the renderer
   */
  getRenderer(): Renderer {
    if (!this.renderer) {
      throw new Error('Engine not initialized');
    }
    return this.renderer;
  }

  private render = (): void => {
    if (!this.isRunning) return;

    this.renderer?.render();
    requestAnimationFrame(this.render);
  };

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    this.device = null;
    this.renderer = null;
  }
}
