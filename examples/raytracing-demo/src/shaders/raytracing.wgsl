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

fn rayColor(rayOrigin: vec3f, rayDir: vec3f, depth: u32) -> vec3f {
  var currentOrigin = rayOrigin;
  var currentDir = rayDir;
  var throughput = vec3f(1.0, 1.0, 1.0);

  for (var i = 0u; i < depth; i++) {
    let rec = closestHit(currentOrigin, currentDir, 0.001, 1e30);

    if (rec.t < 0.0) {
      let unitDir = normalize(currentDir);
      let t = 0.5 * (unitDir.y + 1.0);
      let skyColor = (1.0 - t) * vec3f(1.0, 1.0, 1.0) + t * vec3f(0.5, 0.7, 1.0);
      return throughput * skyColor;
    }

    let material = materials[rec.materialIndex];

    if (material.materialType == 0u) {
      var scatterDir = rec.normal + rand_unit_vector();
      if (near_zero(scatterDir)) {
        scatterDir = rec.normal;
      }
      throughput *= material.albedo;
      currentOrigin = rec.p;
      currentDir = scatterDir;
    } else if (material.materialType == 1u) {
      let reflected = reflect(currentDir, rec.normal);
      let scattered = reflected + material.fuzz * rand_in_unit_sphere();

      if (dot(scattered, rec.normal) <= 0.0) {
        return vec3f(0.0);
      }

      throughput *= material.albedo;
      currentOrigin = rec.p;
      currentDir = scattered;
    } else if (material.materialType == 2u) {
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

  rngState = pcg_hash(u32(pixel.x) + u32(pixel.y) * uniforms.width + uniforms.frameIndex * uniforms.width * uniforms.height);

  let prevColor = textureLoad(accumulationTex, pixel);
  var accumulatedColor = prevColor.rgb;
  var sampleCount = uniforms.sampleCount;

  let rd = camera.lensRadius * rand_in_unit_disk();
  let offset = camera.u * rd.x + camera.v * rd.y;

  for (var s = 0u; s < 1u; s++) {
    let u = (f32(pixel.x) + rand()) / f32(uniforms.width);
    let v = (f32(pixel.y) + rand()) / f32(uniforms.height);

    let rayDir = camera.lowerLeftCorner + u * camera.horizontal + v * camera.vertical - camera.origin - offset;
    let rayOrigin = camera.origin + offset;

    let color = rayColor(rayOrigin, rayDir, uniforms.maxBounces);

    accumulatedColor += color;
    sampleCount += 1u;
  }

  textureStore(accumulationTex, pixel, vec4f(accumulatedColor, 1.0));

  let avgColor = accumulatedColor / f32(sampleCount);
  let gammaColor = pow(clamp(avgColor, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));

  textureStore(outputTex, pixel, vec4f(gammaColor, 1.0));
}
