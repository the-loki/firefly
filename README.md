# Firefly 🌟

A modern WebGPU rendering engine built with Turborepo.

## Structure

```
firefly/
├── packages/
│   └── webgpu-engine/     # Core WebGPU rendering engine
├── examples/
│   └── webgpu-demo/       # Demo application
└── turbo.json             # Turborepo configuration
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- A browser that supports WebGPU (Chrome 113+, Edge 113+, Firefox Nightly)

### Installation

```bash
pnpm install
```

### Development

```bash
# Build all packages
pnpm build

# Run the demo
cd examples/webgpu-demo
pnpm dev
```

## Packages

### @firefly/webgpu-engine

A lightweight WebGPU rendering engine providing:

- **Engine** - Main entry point for initialization and render loop
- **Device** - WebGPU device and context management
- **Renderer** - Render pipeline and drawing operations

### @firefly/webgpu-demo

Example application demonstrating the engine capabilities.

## License

MIT
