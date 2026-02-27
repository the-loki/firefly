import shaderCode from '../shaders/raytracing.wgsl?raw';
import type { SceneData, RenderSettings, Vec3, Sphere, Material, CameraParams } from '../scene';

export class Raytracer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;

  private computePipeline: GPUComputePipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;

  private uniformBuffer: GPUBuffer | null = null;
  private cameraBuffer: GPUBuffer | null = null;
  private sphereBuffer: GPUBuffer | null = null;
  private materialBuffer: GPUBuffer | null = null;
  private outputTexture: GPUTexture | null = null;
  private accumulationTexture: GPUTexture | null = null;

  private frameIndex = 0;
  private sampleCount = 0;
  private width: number;
  private height: number;

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    width: number,
    height: number
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.width = width;
    this.height = height;
  }

  async initialize(scene: SceneData): Promise<void> {
    const shaderModule = this.device.createShaderModule({ code: shaderCode });

    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    this.bindGroupLayout = this.computePipeline.getBindGroupLayout(0);
    this.createBuffers(scene);
    this.createTextures();
    this.createBindGroup();
  }

  private createBuffers(scene: SceneData): void {
    this.uniformBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const cameraData = this.buildCameraData(scene.camera);
    this.cameraBuffer = this.device.createBuffer({
      size: cameraData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraData);

    const sphereData = this.buildSphereData(scene.spheres);
    this.sphereBuffer = this.device.createBuffer({
      size: Math.max(sphereData.byteLength, 32),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    if (sphereData.byteLength > 0) this.device.queue.writeBuffer(this.sphereBuffer, 0, sphereData);

    const materialData = this.buildMaterialData(scene.materials);
    this.materialBuffer = this.device.createBuffer({
      size: Math.max(materialData.byteLength, 32),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    if (materialData.byteLength > 0) this.device.queue.writeBuffer(this.materialBuffer, 0, materialData);
  }

  private buildCameraData(camera: CameraParams): Float32Array {
    const aspectRatio = this.width / this.height;
    const theta = (camera.fov * Math.PI) / 180;
    const h = Math.tan(theta / 2);
    const viewportHeight = 2 * h;
    const viewportWidth = aspectRatio * viewportHeight;

    const w = this.normalize(this.subtract(camera.origin, camera.lookAt));
    const u = this.normalize(this.cross(camera.up, w));
    const v = this.cross(w, u);

    const horizontal = this.scale(u, viewportWidth * camera.focusDistance);
    const vertical = this.scale(v, viewportHeight * camera.focusDistance);
    const lowerLeftCorner = this.subtract(
      this.subtract(
        this.subtract(camera.origin, this.scale(horizontal, 0.5)),
        this.scale(vertical, 0.5)
      ),
      this.scale(w, camera.focusDistance)
    );

    const data = new Float32Array(32);
    let o = 0;
    data[o++] = camera.origin.x; data[o++] = camera.origin.y; data[o++] = camera.origin.z; o++;
    data[o++] = lowerLeftCorner.x; data[o++] = lowerLeftCorner.y; data[o++] = lowerLeftCorner.z; o++;
    data[o++] = horizontal.x; data[o++] = horizontal.y; data[o++] = horizontal.z; o++;
    data[o++] = vertical.x; data[o++] = vertical.y; data[o++] = vertical.z; o++;
    data[o++] = u.x; data[o++] = u.y; data[o++] = u.z; o++;
    data[o++] = v.x; data[o++] = v.y; data[o++] = v.z; o++;
    data[o++] = w.x; data[o++] = w.y; data[o++] = w.z;
    data[o++] = camera.aperture / 2;
    return data;
  }

  private buildSphereData(spheres: Sphere[]): Float32Array {
    const data = new Float32Array(spheres.length * 8);
    let o = 0;
    for (const s of spheres) {
      data[o++] = s.center.x; data[o++] = s.center.y; data[o++] = s.center.z;
      data[o++] = s.radius; data[o++] = s.materialIndex; o += 3;
    }
    return data;
  }

  private buildMaterialData(materials: Material[]): Float32Array {
    const data = new Float32Array(materials.length * 8);
    let o = 0;
    for (const m of materials) {
      data[o++] = m.albedo.x; data[o++] = m.albedo.y; data[o++] = m.albedo.z;
      data[o++] = m.type; data[o++] = m.fuzz; data[o++] = m.refractionIndex; o += 2;
    }
    return data;
  }

  private createTextures(): void {
    this.outputTexture = this.device.createTexture({
      size: [this.width, this.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.accumulationTexture = this.device.createTexture({
      size: [this.width, this.height],
      format: 'rgba32float',
      usage: GPUTextureUsage.STORAGE_BINDING,
    });
  }

  private createBindGroup(): void {
    if (!this.bindGroupLayout || !this.uniformBuffer || !this.cameraBuffer ||
        !this.sphereBuffer || !this.materialBuffer || !this.outputTexture || !this.accumulationTexture) {
      throw new Error('Resources not initialized');
    }
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.cameraBuffer } },
        { binding: 2, resource: { buffer: this.sphereBuffer } },
        { binding: 3, resource: { buffer: this.materialBuffer } },
        { binding: 4, resource: this.outputTexture.createView() },
        { binding: 5, resource: this.accumulationTexture.createView() },
      ],
    });
  }

  render(scene: SceneData, settings: RenderSettings): number {
    if (!this.computePipeline || !this.bindGroup) throw new Error('Pipeline not initialized');

    const uniformData = new Uint32Array([
      settings.width, settings.height, this.frameIndex, settings.maxBounces,
      scene.spheres.length, scene.materials.length, this.sampleCount, 0,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData);
    this.device.queue.writeBuffer(this.cameraBuffer!, 0, this.buildCameraData(scene.camera));

    const sphereData = this.buildSphereData(scene.spheres);
    if (sphereData.byteLength > 0) this.device.queue.writeBuffer(this.sphereBuffer!, 0, sphereData);

    const materialData = this.buildMaterialData(scene.materials);
    if (materialData.byteLength > 0) this.device.queue.writeBuffer(this.materialBuffer!, 0, materialData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.computePipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(settings.width / 8), Math.ceil(settings.height / 8));
    pass.end();

    encoder.copyTextureToTexture(
      { texture: this.outputTexture! },
      { texture: this.context.getCurrentTexture() },
      [settings.width, settings.height]
    );
    this.device.queue.submit([encoder.finish()]);

    this.frameIndex++;
    this.sampleCount += settings.samplesPerFrame;
    return this.sampleCount;
  }

  resetAccumulation(): void {
    this.frameIndex = 0;
    this.sampleCount = 0;
    this.accumulationTexture?.destroy();
    this.accumulationTexture = this.device.createTexture({
      size: [this.width, this.height],
      format: 'rgba32float',
      usage: GPUTextureUsage.STORAGE_BINDING,
    });
    this.createBindGroup();
  }

  updateScene(scene: SceneData): void {
    this.device.queue.writeBuffer(this.cameraBuffer!, 0, this.buildCameraData(scene.camera));
    const sphereData = this.buildSphereData(scene.spheres);
    if (sphereData.byteLength > 0) this.device.queue.writeBuffer(this.sphereBuffer!, 0, sphereData);
    const materialData = this.buildMaterialData(scene.materials);
    if (materialData.byteLength > 0) this.device.queue.writeBuffer(this.materialBuffer!, 0, materialData);
    this.resetAccumulation();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.outputTexture?.destroy();
    this.accumulationTexture?.destroy();
    this.createTextures();
    this.createBindGroup();
    this.resetAccumulation();
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
    this.cameraBuffer?.destroy();
    this.sphereBuffer?.destroy();
    this.materialBuffer?.destroy();
    this.outputTexture?.destroy();
    this.accumulationTexture?.destroy();
  }

  private normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  private subtract(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  private cross(a: Vec3, b: Vec3): Vec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }

  private scale(v: Vec3, s: number): Vec3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }
}
