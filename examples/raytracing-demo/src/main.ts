/**
 * Firefly Raytracing Demo
 * Real-time path tracing using WebGPU compute shaders
 */

import { Raytracer } from './raytracer';
import {
  SceneData,
  RenderSettings,
  SCENE_DEFAULT,
  generateRandomScene,
  generateGlassScene,
  CameraParams,
  Vec3,
} from './types';

interface AppElements {
  canvas: HTMLCanvasElement;
  errorDiv: HTMLDivElement;
  samplesSpan: HTMLElement;
  fpsSpan: HTMLElement;
  spfSlider: HTMLInputElement;
  spfValue: HTMLElement;
  bouncesSlider: HTMLInputElement;
  bouncesValue: HTMLElement;
  sceneSelect: HTMLSelectElement;
  animateCheckbox: HTMLInputElement;
  resetButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
}

class RaytracingApp {
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat | null = null;
  private raytracer: Raytracer | null = null;

  private isRunning = false;
  private animationId: number | null = null;
  private lastTime = 0;
  private frameCount = 0;
  private fps = 0;

  private settings: RenderSettings = {
    samplesPerFrame: 1,
    maxBounces: 8,
    width: 800,
    height: 600,
  };

  private currentScene: SceneData;
  private sceneType: string = 'default';
  private animateCamera = true;
  private cameraAngle = 0;

  private elements: AppElements;

  constructor() {
    this.elements = {
      canvas: document.getElementById('canvas') as HTMLCanvasElement,
      errorDiv: document.getElementById('error') as HTMLDivElement,
      samplesSpan: document.getElementById('samples') as HTMLElement,
      fpsSpan: document.getElementById('fps') as HTMLElement,
      spfSlider: document.getElementById('spf') as HTMLInputElement,
      spfValue: document.getElementById('spfValue') as HTMLElement,
      bouncesSlider: document.getElementById('bounces') as HTMLInputElement,
      bouncesValue: document.getElementById('bouncesValue') as HTMLElement,
      sceneSelect: document.getElementById('scene') as HTMLSelectElement,
      animateCheckbox: document.getElementById('animate') as HTMLInputElement,
      resetButton: document.getElementById('reset') as HTMLButtonElement,
      saveButton: document.getElementById('save') as HTMLButtonElement,
    };

    this.currentScene = SCENE_DEFAULT;
    this.setupEventListeners();
  }

  async initialize(): Promise<void> {
    // Check WebGPU support
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    // Get adapter
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      throw new Error('Failed to get GPU adapter');
    }

    // Get device
    this.device = await adapter.requestDevice();

    // Setup canvas context
    this.context = this.elements.canvas.getContext('webgpu');
    if (!this.context) {
      throw new Error('Failed to get WebGPU context');
    }

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    });

    // Initialize raytracer
    this.raytracer = new Raytracer(
      this.device,
      this.context,
      this.format,
      this.settings.width,
      this.settings.height
    );

    await this.raytracer.initialize(this.currentScene);

    console.log('Firefly Raytracing Demo initialized');
  }

  private setupEventListeners(): void {
    // Samples per frame slider
    this.elements.spfSlider.addEventListener('input', () => {
      this.settings.samplesPerFrame = parseInt(this.elements.spfSlider.value);
      this.elements.spfValue.textContent = this.elements.spfSlider.value;
    });

    // Max bounces slider
    this.elements.bouncesSlider.addEventListener('input', () => {
      this.settings.maxBounces = parseInt(this.elements.bouncesSlider.value);
      this.elements.bouncesValue.textContent = this.elements.bouncesSlider.value;
      this.raytracer?.resetAccumulation();
    });

    // Scene selection
    this.elements.sceneSelect.addEventListener('change', () => {
      this.sceneType = this.elements.sceneSelect.value;
      this.loadScene(this.sceneType);
    });

    // Animate checkbox
    this.elements.animateCheckbox.addEventListener('change', () => {
      this.animateCamera = this.elements.animateCheckbox.checked;
      if (!this.animateCamera) {
        this.raytracer?.resetAccumulation();
      }
    });

    // Reset button
    this.elements.resetButton.addEventListener('click', () => {
      this.raytracer?.resetAccumulation();
    });

    // Save button
    this.elements.saveButton.addEventListener('click', () => {
      this.saveImage();
    });

    // Window resize
    window.addEventListener('resize', () => {
      this.handleResize();
    });
  }

  private loadScene(type: string): void {
    switch (type) {
      case 'default':
        this.currentScene = SCENE_DEFAULT;
        break;
      case 'spheres':
        this.currentScene = generateRandomScene();
        break;
      case 'glass':
        this.currentScene = generateGlassScene();
        break;
    }

    this.raytracer?.updateScene(this.currentScene);
  }

  private animateCameraPosition(): void {
    if (!this.animateCamera) return;

    this.cameraAngle += 0.005;

    const radius = 13;
    const camera: CameraParams = {
      ...this.currentScene.camera,
      origin: {
        x: radius * Math.sin(this.cameraAngle),
        y: 2,
        z: radius * Math.cos(this.cameraAngle),
      },
      lookAt: { x: 0, y: 0, z: 0 },
    };

    this.currentScene = {
      ...this.currentScene,
      camera,
    };
  }

  private handleResize(): void {
    const container = this.elements.canvas.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.floor(rect.width) || 800;
    const height = Math.floor(rect.height) || 600;

    // Update canvas size
    this.elements.canvas.width = width;
    this.elements.canvas.height = height;

    this.settings.width = width;
    this.settings.height = height;

    this.raytracer?.resize(width, height);
  }

  start(): void {
    this.isRunning = true;
    this.lastTime = performance.now();
    this.render();
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private render = (): void => {
    if (!this.isRunning || !this.raytracer) return;

    // Animate camera
    this.animateCameraPosition();

    // Render frame
    const sampleCount = this.raytracer.render(this.currentScene, this.settings);

    // Update UI
    this.elements.samplesSpan.textContent = sampleCount.toString();

    // Calculate FPS
    this.frameCount++;
    const currentTime = performance.now();
    const elapsed = currentTime - this.lastTime;

    if (elapsed >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.elements.fpsSpan.textContent = this.fps.toString();
      this.frameCount = 0;
      this.lastTime = currentTime;
    }

    // Schedule next frame
    this.animationId = requestAnimationFrame(this.render);
  };

  private async saveImage(): Promise<void> {
    if (!this.device || !this.raytracer) return;

    // Create a canvas to draw the result
    const canvas = document.createElement('canvas');
    canvas.width = this.settings.width;
    canvas.height = this.settings.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    // Draw current canvas content
    ctx.drawImage(this.elements.canvas, 0, 0);

    // Create download link
    const link = document.createElement('a');
    link.download = `raytracing-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  showError(message: string): void {
    this.elements.errorDiv.style.display = 'block';
    this.elements.errorDiv.textContent = message;
    console.error(message);
  }
}

async function main() {
  const app = new RaytracingApp();

  try {
    await app.initialize();
    app.start();
  } catch (err) {
    app.showError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    console.error(err);
  }
}

main();
