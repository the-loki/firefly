import type { Device } from './device.js';

/**
 * Handles rendering operations
 */
export class Renderer {
  private pipeline: GPURenderPipeline | null = null;

  constructor(private device: Device) {}

  /**
   * Initialize the rendering pipeline
   */
  initializePipeline(): void {
    const gpu = this.device.gpu;

    const shaderCode = `
      @vertex
      fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
        var pos = array<vec2f, 3>(
          vec2f(0.0, 0.5),
          vec2f(-0.5, -0.5),
          vec2f(0.5, -0.5)
        );
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment
      fn fragmentMain() -> @location(0) vec4f {
        return vec4f(1.0, 0.5, 0.0, 1.0); // Orange color
      }
    `;

    const shaderModule = gpu.createShaderModule({ code: shaderCode });

    this.pipeline = gpu.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: this.device.format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
  }

  /**
   * Perform a single render pass
   */
  render(): void {
    if (!this.pipeline) {
      this.initializePipeline();
    }

    const gpu = this.device.gpu;
    const context = this.device.context;

    const commandEncoder = gpu.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.pipeline!);
    renderPass.draw(3);
    renderPass.end();

    gpu.queue.submit([commandEncoder.finish()]);
  }
}
