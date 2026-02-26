/**
 * WebGPU Raytracer
 * Implements path tracing using compute shaders
 */

import type { SceneData, RenderSettings, Vec3, Sphere, Material } from './types';

// Compute shader for ray tracing
const RAYTRACING_SHADER = /* wgsl */`
struct Uniforms {
  width: u32,
  height: u32,
  frameIndex: u32,
  maxBounces: u32,
  numSpheres: u32,
  numMaterials: u32,
  sampleCount: u32,
  padding: u32,
}

struct CameraData {
  origin: vec3f,
  padding1: f32,
  lowerLeftCorner: vec3f,
  padding2: f32,
  horizontal: vec3f,
  padding3: f32,
  vertical: vec3f,
  padding4: f32,
  u: vec3f,
  padding5: f32,
  v: vec3f,
  padding6: f32,
  w: vec3f,
  lensRadius: f32,
}

struct SphereData {
  center: vec3f,
  radius: f32,
  materialIndex: u32,
  padding1: u32,
  padding2: u32,
  padding3: u32,
}

struct MaterialData {
  albedo: vec3f,
  materialType: u32, // 0: Lambertian, 1: Metal, 2: Dielectric
  fuzz: f32,
  refractionIndex: f32,
  padding1: u32,
  padding2: u32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<uniform> camera: CameraData;
@group(0) @binding(2) var<storage, read> spheres: array<SphereData>;
@group(0) @binding(3) var<storage, read> materials: array<MaterialData>;
@group(0) @binding(4) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(5) var accumulationTex: texture_storage_2d<rgba32float, read_write>;

// PCG random number generator
fn pcg_hash(input: u32) -> u32 {
  var state = input * 747796405u + 2891336453u;
  var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

var<private> rngState: u32;

fn rand() -> f32 {
  rngState = pcg_hash(rngState);
  return f32(rngState) / f32(0xffffffffu);
}

fn rand_in_unit_sphere() -> vec3f {
  loop {
    let p = vec3f(rand() * 2.0 - 1.0, rand() * 2.0 - 1.0, rand() * 2.0 - 1.0);
    if (dot(p, p) < 1.0) {
      return p;
    }
  }
  return vec3f(0.0);
}

fn rand_unit_vector() -> vec3f {
  return normalize(rand_in_unit_sphere());
}

fn rand_in_unit_disk() -> vec3f {
  loop {
    let p = vec3f(rand() * 2.0 - 1.0, rand() * 2.0 - 1.0, 0.0);
    if (dot(p, p) < 1.0) {
      return p;
    }
  }
  return vec3f(0.0);
}

fn near_zero(v: vec3f) -> bool {
  let s = 1e-8;
  return (abs(v.x) < s) && (abs(v.y) < s) && (abs(v.z) < s);
}

fn reflect(v: vec3f, n: vec3f) -> vec3f {
  return v - 2.0 * dot(v, n) * n;
}

fn refract(uv: vec3f, n: vec3f, etai_over_etat: f32) -> vec3f {
  let cos_theta = min(dot(-uv, n), 1.0);
  let r_out_perp = etai_over_etat * (uv + cos_theta * n);
  let r_out_parallel = -sqrt(abs(1.0 - dot(r_out_perp, r_out_perp))) * n;
  return r_out_perp + r_out_parallel;
}

fn reflectance(cosine: f32, ref_idx: f32) -> f32 {
  var r0 = (1.0 - ref_idx) / (1.0 + ref_idx);
  r0 = r0 * r0;
  return r0 + (1.0 - r0) * pow((1.0 - cosine), 5.0);
}

struct HitRecord {
  t: f32,
  p: vec3f,
  normal: vec3f,
  frontFace: bool,
  materialIndex: u32,
}

fn hitSphere(sphere: SphereData, rayOrigin: vec3f, rayDir: vec3f, tMin: f32, tMax: f32) -> f32 {
  let oc = rayOrigin - sphere.center;
  let a = dot(rayDir, rayDir);
  let halfB = dot(oc, rayDir);
  let c = dot(oc, oc) - sphere.radius * sphere.radius;
  let discriminant = halfB * halfB - a * c;

  if (discriminant < 0.0) {
    return -1.0;
  }

  let sqrtd = sqrt(discriminant);

  var root = (-halfB - sqrtd) / a;
  if (root < tMin || root > tMax) {
    root = (-halfB + sqrtd) / a;
    if (root < tMin || root > tMax) {
      return -1.0;
    }
  }

  return root;
}

fn closestHit(rayOrigin: vec3f, rayDir: vec3f, tMin: f32, tMax: f32) -> HitRecord {
  var closestSoFar = tMax;
  var hitAnything = false;
  var rec: HitRecord;

  for (var i = 0u; i < uniforms.numSpheres; i++) {
    let t = hitSphere(spheres[i], rayOrigin, rayDir, tMin, closestSoFar);
    if (t > 0.0) {
      closestSoFar = t;
      hitAnything = true;
      rec.t = t;
      rec.p = rayOrigin + t * rayDir;
      rec.normal = (rec.p - spheres[i].center) / spheres[i].radius;
      rec.materialIndex = spheres[i].materialIndex;

      let frontFace = dot(rayDir, rec.normal) < 0.0;
      rec.normal = select(-rec.normal, rec.normal, frontFace);
      rec.frontFace = frontFace;
    }
  }

  if (!hitAnything) {
    rec.t = -1.0;
  }

  return rec;
}

fn scatter(material: MaterialData, rayDir: vec3f, rec: HitRecord) -> vec3f {
  // Return scattered direction, or zero if no scatter
  let isLambertian = material.materialType == 0u;
  let isMetal = material.materialType == 1u;
  let isDielectric = material.materialType == 2u;

  if (isLambertian) {
    var scatterDir = rec.normal + rand_unit_vector();
    if (near_zero(scatterDir)) {
      scatterDir = rec.normal;
    }
    return scatterDir;
  } else if (isMetal) {
    let reflected = reflect(rayDir, rec.normal);
    return reflected + material.fuzz * rand_in_unit_sphere();
  } else if (isDielectric) {
    let refractionRatio = select(material.refractionIndex, 1.0 / material.refractionIndex, rec.frontFace);

    let unitDir = normalize(rayDir);
    let cosTheta = min(dot(-unitDir, rec.normal), 1.0);
    let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

    let cannotRefract = refractionRatio * sinTheta > 1.0;

    var direction: vec3f;

    if (cannotRefract || reflectance(cosTheta, refractionRatio) > rand()) {
      direction = reflect(unitDir, rec.normal);
    } else {
      direction = refract(unitDir, rec.normal, refractionRatio);
    }

    return direction;
  }

  return vec3f(0.0);
}

fn rayColor(rayOrigin: vec3f, rayDir: vec3f, depth: u32) -> vec3f {
  var currentOrigin = rayOrigin;
  var currentDir = rayDir;
  var throughput = vec3f(1.0, 1.0, 1.0);

  for (var i = 0u; i < depth; i++) {
    let rec = closestHit(currentOrigin, currentDir, 0.001, 1e30);

    if (rec.t < 0.0) {
      // Miss - return sky color
      let unitDir = normalize(currentDir);
      let t = 0.5 * (unitDir.y + 1.0);
      let skyColor = (1.0 - t) * vec3f(1.0, 1.0, 1.0) + t * vec3f(0.5, 0.7, 1.0);
      return throughput * skyColor;
    }

    let material = materials[rec.materialIndex];

    if (material.materialType == 0u) {
      // Lambertian - always scatter
      var scatterDir = rec.normal + rand_unit_vector();
      if (near_zero(scatterDir)) {
        scatterDir = rec.normal;
      }
      throughput *= material.albedo;
      currentOrigin = rec.p;
      currentDir = scatterDir;
    } else if (material.materialType == 1u) {
      // Metal
      let reflected = reflect(currentDir, rec.normal);
      let scattered = reflected + material.fuzz * rand_in_unit_sphere();

      if (dot(scattered, rec.normal) <= 0.0) {
        return vec3f(0.0);
      }

      throughput *= material.albedo;
      currentOrigin = rec.p;
      currentDir = scattered;
    } else if (material.materialType == 2u) {
      // Dielectric
      let refractionRatio = select(material.refractionIndex, 1.0 / material.refractionIndex, rec.frontFace);

      let unitDir = normalize(currentDir);
      let cosTheta = min(dot(-unitDir, rec.normal), 1.0);
      let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

      let cannotRefract = refractionRatio * sinTheta > 1.0;

      var direction: vec3f;

      if (cannotRefract || reflectance(cosTheta, refractionRatio) > rand()) {
        direction = reflect(unitDir, rec.normal);
      } else {
        direction = refract(unitDir, rec.normal, refractionRatio);
      }

      throughput *= material.albedo;
      currentOrigin = rec.p;
      currentDir = direction;
    }
  }

  return vec3f(0.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) globalId: vec3u) {
  let pixel = vec2i(globalId.xy);

  if (pixel.x >= i32(uniforms.width) || pixel.y >= i32(uniforms.height)) {
    return;
  }

  // Initialize RNG with unique seed per pixel and frame
  rngState = pcg_hash(u32(pixel.x) + u32(pixel.y) * uniforms.width + uniforms.frameIndex * uniforms.width * uniforms.height);

  // Get previous accumulated color
  let prevColor = textureLoad(accumulationTex, pixel);
  var accumulatedColor = prevColor.rgb;
  var sampleCount = uniforms.sampleCount;

  // Generate camera ray with depth of field
  let rd = camera.lensRadius * rand_in_unit_disk();
  let offset = camera.u * rd.x + camera.v * rd.y;

  // Trace samples
  for (var s = 0u; s < 1u; s++) {
    let u = (f32(pixel.x) + rand()) / f32(uniforms.width);
    let v = (f32(pixel.y) + rand()) / f32(uniforms.height);

    let rayDir = camera.lowerLeftCorner + u * camera.horizontal + v * camera.vertical - camera.origin - offset;
    let rayOrigin = camera.origin + offset;

    let color = rayColor(rayOrigin, rayDir, uniforms.maxBounces);

    accumulatedColor += color;
    sampleCount += 1u;
  }

  // Store accumulated color
  textureStore(accumulationTex, pixel, vec4f(accumulatedColor, 1.0));

  // Output averaged color with gamma correction
  let avgColor = accumulatedColor / f32(sampleCount);

  // Gamma correction (gamma 2.0)
  let gammaColor = pow(clamp(avgColor, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));

  textureStore(outputTex, pixel, vec4f(gammaColor, 1.0));
}
`;

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
    // Create compute pipeline
    const shaderModule = this.device.createShaderModule({
      code: RAYTRACING_SHADER,
    });

    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });

    this.bindGroupLayout = this.computePipeline.getBindGroupLayout(0);

    // Create buffers
    this.createBuffers(scene);

    // Create textures
    this.createTextures();

    // Create bind group
    this.createBindGroup();
  }

  private createBuffers(scene: SceneData): void {
    // Uniform buffer
    this.uniformBuffer = this.device.createBuffer({
      size: 32, // 8 u32s
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Camera buffer - align to 16 bytes for each vec3
    const cameraData = this.createCameraData(scene.camera);
    this.cameraBuffer = this.device.createBuffer({
      size: cameraData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraData.buffer as ArrayBuffer, cameraData.byteOffset, cameraData.byteLength);

    // Sphere buffer
    const sphereData = this.createSphereData(scene.spheres);
    this.sphereBuffer = this.device.createBuffer({
      size: Math.max(sphereData.byteLength, 32),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    if (sphereData.byteLength > 0) {
      this.device.queue.writeBuffer(this.sphereBuffer, 0, sphereData.buffer as ArrayBuffer, sphereData.byteOffset, sphereData.byteLength);
    }

    // Material buffer
    const materialData = this.createMaterialData(scene.materials);
    this.materialBuffer = this.device.createBuffer({
      size: Math.max(materialData.byteLength, 32),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    if (materialData.byteLength > 0) {
      this.device.queue.writeBuffer(this.materialBuffer, 0, materialData.buffer as ArrayBuffer, materialData.byteOffset, materialData.byteLength);
    }
  }

  private createCameraData(camera: typeof import('./types').SCENE_DEFAULT.camera): Float32Array {
    const aspectRatio = this.width / this.height;
    const theta = (camera.fov * Math.PI) / 180;
    const h = Math.tan(theta / 2);
    const viewportHeight = 2 * h;
    const viewportWidth = aspectRatio * viewportHeight;

    // Calculate camera basis vectors
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

    // Layout: origin (vec3 + pad), lowerLeftCorner (vec3 + pad), horizontal (vec3 + pad),
    // vertical (vec3 + pad), u (vec3 + pad), v (vec3 + pad), w (vec3 + pad), lensRadius (f32)
    const data = new Float32Array(31);
    let offset = 0;

    // origin
    data[offset++] = camera.origin.x;
    data[offset++] = camera.origin.y;
    data[offset++] = camera.origin.z;
    offset++; // padding

    // lowerLeftCorner
    data[offset++] = lowerLeftCorner.x;
    data[offset++] = lowerLeftCorner.y;
    data[offset++] = lowerLeftCorner.z;
    offset++; // padding

    // horizontal
    data[offset++] = horizontal.x;
    data[offset++] = horizontal.y;
    data[offset++] = horizontal.z;
    offset++; // padding

    // vertical
    data[offset++] = vertical.x;
    data[offset++] = vertical.y;
    data[offset++] = vertical.z;
    offset++; // padding

    // u
    data[offset++] = u.x;
    data[offset++] = u.y;
    data[offset++] = u.z;
    offset++; // padding

    // v
    data[offset++] = v.x;
    data[offset++] = v.y;
    data[offset++] = v.z;
    offset++; // padding

    // w
    data[offset++] = w.x;
    data[offset++] = w.y;
    data[offset++] = w.z;

    // lensRadius
    data[offset++] = camera.aperture / 2;

    return data;
  }

  private createSphereData(spheres: Sphere[]): Float32Array {
    // Each sphere: center (vec3 + pad), radius (f32), materialIndex (u32), 3 paddings
    const data = new Float32Array(spheres.length * 8);
    let offset = 0;

    for (const sphere of spheres) {
      data[offset++] = sphere.center.x;
      data[offset++] = sphere.center.y;
      data[offset++] = sphere.center.z;
      data[offset++] = sphere.radius;
      data[offset++] = sphere.materialIndex;
      offset += 3; // padding
    }

    return data;
  }

  private createMaterialData(materials: Material[]): Float32Array {
    // Each material: albedo (vec3), materialType (u32), fuzz (f32), refractionIndex (f32), 2 paddings
    const data = new Float32Array(materials.length * 8);
    let offset = 0;

    for (const mat of materials) {
      data[offset++] = mat.albedo.x;
      data[offset++] = mat.albedo.y;
      data[offset++] = mat.albedo.z;
      data[offset++] = mat.type;
      data[offset++] = mat.fuzz;
      data[offset++] = mat.refractionIndex;
      offset += 2; // padding
    }

    return data;
  }

  private createTextures(): void {
    // Output texture for display
    this.outputTexture = this.device.createTexture({
      size: [this.width, this.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    // Accumulation texture for progressive rendering
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
    if (!this.computePipeline || !this.bindGroup) {
      throw new Error('Pipeline not initialized');
    }

    // Update uniform buffer
    const uniformData = new Uint32Array([
      settings.width,
      settings.height,
      this.frameIndex,
      settings.maxBounces,
      scene.spheres.length,
      scene.materials.length,
      this.sampleCount,
      0, // padding
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData.buffer as ArrayBuffer, uniformData.byteOffset, uniformData.byteLength);

    // Update camera buffer
    const cameraData = this.createCameraData(scene.camera);
    this.device.queue.writeBuffer(this.cameraBuffer!, 0, cameraData.buffer as ArrayBuffer, cameraData.byteOffset, cameraData.byteLength);

    // Update sphere buffer
    const sphereData = this.createSphereData(scene.spheres);
    if (sphereData.byteLength > 0) {
      this.device.queue.writeBuffer(this.sphereBuffer!, 0, sphereData.buffer as ArrayBuffer, sphereData.byteOffset, sphereData.byteLength);
    }

    // Update material buffer
    const materialData = this.createMaterialData(scene.materials);
    if (materialData.byteLength > 0) {
      this.device.queue.writeBuffer(this.materialBuffer!, 0, materialData.buffer as ArrayBuffer, materialData.byteOffset, materialData.byteLength);
    }

    const commandEncoder = this.device.createCommandEncoder();

    // Compute pass
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.bindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(settings.width / 8),
      Math.ceil(settings.height / 8)
    );
    computePass.end();

    // Copy output texture to canvas
    const canvasTexture = this.context.getCurrentTexture();
    commandEncoder.copyTextureToTexture(
      { texture: this.outputTexture! },
      { texture: canvasTexture },
      [settings.width, settings.height]
    );

    this.device.queue.submit([commandEncoder.finish()]);

    this.frameIndex++;
    this.sampleCount += settings.samplesPerFrame;

    return this.sampleCount;
  }

  resetAccumulation(): void {
    this.frameIndex = 0;
    this.sampleCount = 0;

    // Clear accumulation texture
    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.clearBuffer(this.accumulationTexture!.createView() as any);
    this.device.queue.submit([commandEncoder.finish()]);

    // Recreate accumulation texture to clear it
    this.accumulationTexture?.destroy();
    this.accumulationTexture = this.device.createTexture({
      size: [this.width, this.height],
      format: 'rgba32float',
      usage: GPUTextureUsage.STORAGE_BINDING,
    });

    // Recreate bind group with new accumulation texture
    this.createBindGroup();
  }

  updateScene(scene: SceneData): void {
    // Update buffers
    const cameraData = this.createCameraData(scene.camera);
    this.device.queue.writeBuffer(this.cameraBuffer!, 0, cameraData.buffer as ArrayBuffer, cameraData.byteOffset, cameraData.byteLength);

    const sphereData = this.createSphereData(scene.spheres);
    if (sphereData.byteLength > 0) {
      this.device.queue.writeBuffer(this.sphereBuffer!, 0, sphereData.buffer as ArrayBuffer, sphereData.byteOffset, sphereData.byteLength);
    }

    const materialData = this.createMaterialData(scene.materials);
    if (materialData.byteLength > 0) {
      this.device.queue.writeBuffer(this.materialBuffer!, 0, materialData.buffer as ArrayBuffer, materialData.byteOffset, materialData.byteLength);
    }

    // Reset accumulation when scene changes
    this.resetAccumulation();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    // Recreate textures
    this.outputTexture?.destroy();
    this.accumulationTexture?.destroy();

    this.createTextures();
    this.createBindGroup();

    // Reset accumulation
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
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  private scale(v: Vec3, s: number): Vec3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }
}
