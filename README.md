# DCC Curve Composer

DCC is a browser-based curve, space, and atlas composer for authored color curves. It lets you edit channel curves, compose them across a normalized curve space, preview atlas output, and export PNG atlas data with provenance metadata.

The app is a local Vite/React workspace. It does not require a backend service or Gemini API key to run.

## Local Setup

```bash
npm ci
npm run dev
npm run lint
npm test
npm run build
```

## Curve Model Contract

The current curve model invariants are documented in [src/domain/curveModelContract.md](src/domain/curveModelContract.md).
