/// <reference types="@webgpu/types" />

export interface DeviceOptions {
  antialias?: boolean;
  alpha?: boolean;
  powerPreference?: GPUPowerPreference;
}

/**
 * Wraps the WebGPU GPUDevice and provides utilities
 */
export class Device {
  private gpuDevice: GPUDevice | null = null;
  private gpuContext: GPUCanvasContext | null = null;
  private canvasFormat: GPUTextureFormat | null = null;

  async initialize(
    canvas: HTMLCanvasElement,
    options: DeviceOptions = {}
  ): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: options.powerPreference ?? 'high-performance',
    });

    if (!adapter) {
      throw new Error('Failed to get GPU adapter');
    }

    this.gpuDevice = await adapter.requestDevice();
    this.gpuContext = canvas.getContext('webgpu');

    if (!this.gpuContext) {
      throw new Error('Failed to get WebGPU context');
    }

    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.gpuContext.configure({
      device: this.gpuDevice,
      format: this.canvasFormat,
      alphaMode: options.alpha ? 'premultiplied' : 'opaque',
    });
  }

  get gpu(): GPUDevice {
    if (!this.gpuDevice) {
      throw new Error('Device not initialized');
    }
    return this.gpuDevice;
  }

  get context(): GPUCanvasContext {
    if (!this.gpuContext) {
      throw new Error('Context not initialized');
    }
    return this.gpuContext;
  }

  get format(): GPUTextureFormat {
    if (!this.canvasFormat) {
      throw new Error('Device not initialized');
    }
    return this.canvasFormat;
  }
}
