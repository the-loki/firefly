import { Engine } from '@firefly/webgpu-engine';

async function main() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const errorDiv = document.getElementById('error') as HTMLDivElement;

  try {
    const engine = new Engine({
      canvas,
      antialias: true,
      alpha: false,
    });

    await engine.initialize();
    engine.start();

    console.log('✅ Firefly demo running');
  } catch (err) {
    errorDiv.style.display = 'block';
    errorDiv.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(err);
  }
}

main();
