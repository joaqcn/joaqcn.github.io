# Joaquin Castrillon — Portfolio

A scroll-driven 3D portfolio: a "neural cosmos" built with Three.js and TypeScript sits behind
regular, accessible HTML sections. Scrolling flies the camera along a spline through a network of
glowing nodes, with one beacon per section.

- **Stack:** Vite, TypeScript, Three.js (custom GLSL shaders, bloom post-processing)
- **Content:** plain HTML in `index.html`, so it stays readable, indexable and works without WebGL
- **Scene:** `src/scene/cosmos.ts`; scroll mapping and UI in `src/main.ts`
- Respects `prefers-reduced-motion`; lighter particle counts and pixel ratio on phones

```bash
npm install
npm run dev
npm run build
```
