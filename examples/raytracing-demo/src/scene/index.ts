export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraParams {
  origin: Vec3;
  lookAt: Vec3;
  up: Vec3;
  fov: number;
  aperture: number;
  focusDistance: number;
}

export interface Sphere {
  center: Vec3;
  radius: number;
  materialIndex: number;
}

export interface Material {
  type: number; // 0: Lambertian, 1: Metal, 2: Dielectric
  albedo: Vec3;
  fuzz: number;
  refractionIndex: number;
}

export interface SceneData {
  spheres: Sphere[];
  materials: Material[];
  camera: CameraParams;
}

export interface RenderSettings {
  samplesPerFrame: number;
  maxBounces: number;
  width: number;
  height: number;
}

export function generateRandomScene(): SceneData {
  const spheres: Sphere[] = [
    { center: { x: 0, y: -1000, z: 0 }, radius: 1000, materialIndex: 0 },
  ];
  const materials: Material[] = [
    { type: 0, albedo: { x: 0.5, y: 0.5, z: 0.5 }, fuzz: 0, refractionIndex: 0 },
  ];

  let materialIndex = 1;

  for (let a = -11; a < 11; a++) {
    for (let b = -11; b < 11; b++) {
      const chooseMat = Math.random();
      const center = {
        x: a + 0.9 * Math.random(),
        y: 0.2,
        z: b + 0.9 * Math.random(),
      };

      const dist = Math.sqrt((center.x - 4) ** 2 + center.z ** 2);

      if (dist > 0.9) {
        if (chooseMat < 0.8) {
          materials.push({
            type: 0,
            albedo: {
              x: Math.random() * Math.random(),
              y: Math.random() * Math.random(),
              z: Math.random() * Math.random(),
            },
            fuzz: 0,
            refractionIndex: 0,
          });
        } else if (chooseMat < 0.95) {
          materials.push({
            type: 1,
            albedo: {
              x: 0.5 * (1 + Math.random()),
              y: 0.5 * (1 + Math.random()),
              z: 0.5 * (1 + Math.random()),
            },
            fuzz: 0.5 * Math.random(),
            refractionIndex: 0,
          });
        } else {
          materials.push({ type: 2, albedo: { x: 1, y: 1, z: 1 }, fuzz: 0, refractionIndex: 1.5 });
        }
        spheres.push({ center, radius: 0.2, materialIndex });
        materialIndex++;
      }
    }
  }

  materials.push({ type: 0, albedo: { x: 0.1, y: 0.2, z: 0.5 }, fuzz: 0, refractionIndex: 0 });
  spheres.push({ center: { x: -4, y: 1, z: 0 }, radius: 1, materialIndex: materialIndex++ });

  materials.push({ type: 2, albedo: { x: 1, y: 1, z: 1 }, fuzz: 0, refractionIndex: 1.5 });
  spheres.push({ center: { x: 0, y: 1, z: 0 }, radius: 1, materialIndex: materialIndex++ });

  materials.push({ type: 1, albedo: { x: 0.7, y: 0.6, z: 0.5 }, fuzz: 0, refractionIndex: 0 });
  spheres.push({ center: { x: 4, y: 1, z: 0 }, radius: 1, materialIndex: materialIndex });

  return {
    spheres,
    materials,
    camera: {
      origin: { x: 13, y: 2, z: 3 },
      lookAt: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      fov: 20,
      aperture: 0.1,
      focusDistance: 10,
    },
  };
}

export function generateGlassScene(): SceneData {
  return {
    spheres: [
      { center: { x: 0, y: -100.5, z: -1 }, radius: 100, materialIndex: 0 },
      { center: { x: -1.5, y: 0, z: 0 }, radius: 0.5, materialIndex: 1 },
      { center: { x: 0, y: 0, z: 0 }, radius: 0.5, materialIndex: 2 },
      { center: { x: 1.5, y: 0, z: 0 }, radius: 0.5, materialIndex: 1 },
      { center: { x: 0, y: 0.8, z: 0 }, radius: 0.3, materialIndex: 1 },
    ],
    materials: [
      { type: 0, albedo: { x: 0.8, y: 0.8, z: 0.8 }, fuzz: 0, refractionIndex: 0 },
      { type: 2, albedo: { x: 1, y: 1, z: 1 }, fuzz: 0, refractionIndex: 1.5 },
      { type: 2, albedo: { x: 1, y: 0.8, z: 0.8 }, fuzz: 0, refractionIndex: 1.5 },
    ],
    camera: {
      origin: { x: 0, y: 0.5, z: 3 },
      lookAt: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      fov: 40,
      aperture: 0,
      focusDistance: 3,
    },
  };
}

export const SCENE_DEFAULT: SceneData = {
  spheres: [
    { center: { x: 0, y: -1000, z: 0 }, radius: 1000, materialIndex: 0 },
    { center: { x: 0, y: 1, z: 0 }, radius: 1, materialIndex: 1 },
    { center: { x: -4, y: 1, z: 0 }, radius: 1, materialIndex: 2 },
    { center: { x: 4, y: 1, z: 0 }, radius: 1, materialIndex: 3 },
  ],
  materials: [
    { type: 0, albedo: { x: 0.5, y: 0.5, z: 0.5 }, fuzz: 0, refractionIndex: 0 },
    { type: 0, albedo: { x: 0.1, y: 0.2, z: 0.5 }, fuzz: 0, refractionIndex: 0 },
    { type: 2, albedo: { x: 1, y: 1, z: 1 }, fuzz: 0, refractionIndex: 1.5 },
    { type: 1, albedo: { x: 0.7, y: 0.6, z: 0.5 }, fuzz: 0.0, refractionIndex: 0 },
  ],
  camera: {
    origin: { x: 13, y: 2, z: 3 },
    lookAt: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    fov: 20,
    aperture: 0.1,
    focusDistance: 10,
  },
};
