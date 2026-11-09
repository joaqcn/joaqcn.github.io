import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const AMBER = new THREE.Color('#f0a35e')
const TEAL = new THREE.Color('#3fb6b2')
const ROSE = new THREE.Color('#d8607a')
const PALE = new THREE.Color('#e9e2d6')

/** One camera waypoint per page section, in order. */
const WAYPOINTS = [
  new THREE.Vector3(0, 0, 30),
  new THREE.Vector3(6, 2, -10),
  new THREE.Vector3(-8, -2, -52),
  new THREE.Vector3(8, 4, -96),
  new THREE.Vector3(-6, 0, -142),
  new THREE.Vector3(6, -3, -188),
  new THREE.Vector3(0, 1, -228),
]

const BEACON_COLORS = [AMBER, TEAL, AMBER, ROSE, TEAL, AMBER, TEAL]

const pointsVertex = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.65 + 0.35 * sin(uTime * (0.6 + aSeed * 1.4) + aSeed * 40.0);
    gl_PointSize = max(aSize * uPixelRatio * tw * (60.0 / -mv.z), 1.0);
    vAlpha = tw * (1.0 - smoothstep(70.0, 150.0, -mv.z)) * smoothstep(0.5, 4.0, -mv.z);
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }
`

const pointsFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = pow(smoothstep(0.5, 0.0, d), 2.2);
    gl_FragColor = vec4(vColor * (1.0 + a), a * vAlpha);
  }
`

const lineVertex = /* glsl */ `
  attribute float aT;
  attribute float aSeed;
  varying float vT;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vT = aT;
    vSeed = aSeed;
    vFade = (1.0 - smoothstep(35.0, 100.0, -mv.z)) * smoothstep(0.5, 5.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

const lineFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uBase;
  uniform vec3 uPulse;
  varying float vT;
  varying float vSeed;
  varying float vFade;
  void main() {
    float head = fract(uTime * (0.07 + vSeed * 0.1) + vSeed * 7.0);
    float pulse = smoothstep(0.14, 0.0, abs(vT - head)) * step(0.4, vSeed);
    vec3 col = mix(uBase, uPulse, pulse);
    float alpha = (0.07 + pulse * 0.85) * vFade;
    gl_FragColor = vec4(col, alpha);
  }
`

const fresnelVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const fresnelFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float f = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.4);
    float breathe = 0.85 + 0.15 * sin(uTime * 1.3);
    gl_FragColor = vec4(uColor * (0.25 + f * 1.8) * breathe, 0.35 + f * 0.65);
  }
`

interface Beacon {
  group: THREE.Group
  wire: THREE.LineSegments
  ring: THREE.Mesh
  speed: number
}

export interface Cosmos {
  dispose: () => void
}

/**
 * Builds the fixed WebGL backdrop. `getProgress` returns 0..1 along the camera path.
 * Returns null when WebGL is unavailable so the caller can fall back to CSS.
 */
export function initCosmos(host: HTMLElement, getProgress: () => number): Cosmos | null {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const isMobile = window.matchMedia('(max-width: 720px)').matches

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  } catch {
    return null
  }

  const pixelRatio = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2)
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  // the composer renders in linear space, so give the clear colour in linear space too
  renderer.setClearColor(new THREE.Color().setRGB(0.0004, 0.0005, 0.001, THREE.LinearSRGBColorSpace), 1)
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400)
  const path = new THREE.CatmullRomCurve3(WAYPOINTS, false, 'catmullrom', 0.5)

  const timeUniform = { value: 0 }
  const pixelUniform = { value: pixelRatio }

  // --- deterministic RNG so the layout is the same on every load ---
  let seed = 1337
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }

  // --- background stars ---
  const starCount = isMobile ? 1400 : 3600
  const starPos = new Float32Array(starCount * 3)
  const starCol = new Float32Array(starCount * 3)
  const starSize = new Float32Array(starCount)
  const starSeed = new Float32Array(starCount)
  for (let i = 0; i < starCount; i++) {
    const p = path.getPointAt(Math.min(1, rand() * 1.08))
    const r = 25 + rand() * 90
    const a = rand() * Math.PI * 2
    starPos.set([p.x + Math.cos(a) * r, p.y + (rand() - 0.5) * 120, p.z + Math.sin(a) * r], i * 3)
    const c = PALE.clone().lerp(rand() > 0.6 ? AMBER : TEAL, rand() * 0.5)
    starCol.set([c.r, c.g, c.b], i * 3)
    starSize[i] = 0.5 + rand() * 1.1
    starSeed[i] = rand()
  }
  scene.add(makePoints(starPos, starCol, starSize, starSeed, timeUniform, pixelUniform))

  // --- neural nodes scattered around the flight path ---
  const nodeCount = isMobile ? 190 : 420
  const nodes: THREE.Vector3[] = []
  const nodePos = new Float32Array(nodeCount * 3)
  const nodeCol = new Float32Array(nodeCount * 3)
  const nodeSize = new Float32Array(nodeCount)
  const nodeSeed = new Float32Array(nodeCount)
  const palette = [AMBER, TEAL, TEAL, PALE, ROSE]
  for (let i = 0; i < nodeCount; i++) {
    const center = path.getPointAt(Math.min(1, rand() * 1.08))
    const r = 5 + Math.pow(rand(), 0.8) * 24
    const a = rand() * Math.PI * 2
    const v = new THREE.Vector3(
      center.x + Math.cos(a) * r,
      center.y + Math.sin(a) * r * 0.7,
      center.z + (rand() - 0.5) * 14,
    )
    nodes.push(v)
    nodePos.set([v.x, v.y, v.z], i * 3)
    const c = palette[Math.floor(rand() * palette.length)]
    nodeCol.set([c.r, c.g, c.b], i * 3)
    nodeSize[i] = 1.4 + rand() * 2.4
    nodeSeed[i] = rand()
  }
  scene.add(makePoints(nodePos, nodeCol, nodeSize, nodeSeed, timeUniform, pixelUniform))

  // --- synapses: connect each node to its nearest neighbours ---
  const linePos: number[] = []
  const lineT: number[] = []
  const lineSeed: number[] = []
  const seen = new Set<number>()
  for (let i = 0; i < nodeCount; i++) {
    const near = nodes
      .map((n, j) => ({ j, d: n.distanceToSquared(nodes[i]) }))
      .filter(({ j, d }) => j !== i && d < 15 * 15)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
    for (const { j } of near) {
      const key = Math.min(i, j) * nodeCount + Math.max(i, j)
      if (seen.has(key)) continue
      seen.add(key)
      const s = rand()
      linePos.push(nodes[i].x, nodes[i].y, nodes[i].z, nodes[j].x, nodes[j].y, nodes[j].z)
      lineT.push(0, 1)
      lineSeed.push(s, s)
    }
  }
  const lineGeo = new THREE.BufferGeometry()
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3))
  lineGeo.setAttribute('aT', new THREE.Float32BufferAttribute(lineT, 1))
  lineGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(lineSeed, 1))
  const lineMat = new THREE.ShaderMaterial({
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
    uniforms: {
      uTime: timeUniform,
      uBase: { value: TEAL.clone().multiplyScalar(0.8) },
      uPulse: { value: AMBER },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  scene.add(new THREE.LineSegments(lineGeo, lineMat))

  // --- one beacon per section, off to the right of the reading column ---
  const beacons: Beacon[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const geometries: THREE.BufferGeometry[] = [
    new THREE.IcosahedronGeometry(2.8, 1),
    new THREE.TorusKnotGeometry(1.8, 0.55, 120, 14),
    new THREE.DodecahedronGeometry(2.6, 0),
    new THREE.OctahedronGeometry(2.8, 1),
    new THREE.IcosahedronGeometry(2.6, 2),
    new THREE.DodecahedronGeometry(2.6, 1),
    new THREE.IcosahedronGeometry(3.0, 1),
  ]
  const sideOffset = isMobile ? 1.5 : 4.5
  WAYPOINTS.forEach((_, i) => {
    const t = i / (WAYPOINTS.length - 1)
    const p = path.getPointAt(t)
    const tangent = path.getTangentAt(t)
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize()
    const color = BEACON_COLORS[i]

    const group = new THREE.Group()
    group.position.copy(p).addScaledVector(tangent, 15).addScaledVector(right, sideOffset)
    group.position.y += isMobile ? 4 : 0.5

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 40, 28),
      new THREE.ShaderMaterial({
        vertexShader: fresnelVertex,
        fragmentShader: fresnelFragment,
        uniforms: { uColor: { value: color }, uTime: timeUniform },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometries[i]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending }),
    )
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(4.2, 0.02, 8, 120),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending }),
    )
    ring.rotation.x = Math.PI / 2.6
    group.add(core, wire, ring)
    scene.add(group)
    beacons.push({ group, wire, ring, speed: 0.12 + (i % 3) * 0.05 })
  })

  // --- post-processing ---
  const composer = new EffectComposer(renderer)
  composer.setPixelRatio(pixelRatio)
  composer.setSize(window.innerWidth, window.innerHeight)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    isMobile ? 0.3 : 0.4,
    0.4,
    0.55,
  )
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  // --- input + resize ---
  const pointer = new THREE.Vector2()
  const pointerSmooth = new THREE.Vector2()
  const onPointer = (e: PointerEvent) => {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1)
  }
  const onResize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    composer.setSize(w, h)
  }
  if (!reduceMotion) window.addEventListener('pointermove', onPointer, { passive: true })
  window.addEventListener('resize', onResize)

  // --- loop ---
  let last = performance.now()
  let current = getProgress()
  let raf = 0
  const camPos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const right = new THREE.Vector3()

  const frame = () => {
    raf = requestAnimationFrame(frame)
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    if (!reduceMotion) timeUniform.value += dt

    const target = getProgress()
    current = reduceMotion ? target : current + (target - current) * Math.min(1, dt * 3.2)

    path.getPointAt(current, camPos)
    path.getTangentAt(current, tangent)
    right.crossVectors(tangent, up).normalize()

    pointerSmooth.lerp(pointer, Math.min(1, dt * 2.5))
    camera.position
      .copy(camPos)
      .addScaledVector(right, pointerSmooth.x * 1.4)
      .addScaledVector(up, -pointerSmooth.y * 0.9)
    look.copy(camPos).addScaledVector(tangent, 12)
    camera.lookAt(look)

    if (!reduceMotion) {
      for (const b of beacons) {
        b.wire.rotation.y += dt * b.speed
        b.wire.rotation.x += dt * b.speed * 0.4
        b.ring.rotation.z += dt * b.speed * 0.6
      }
    }
    // beacons only materialise as the camera approaches them
    for (const b of beacons) {
      const d = b.group.position.distanceTo(camera.position)
      const k = THREE.MathUtils.clamp((62 - d) / 24, 0, 1)
      b.group.scale.setScalar(k * k * (3 - 2 * k) * (isMobile ? 0.6 : 1))
      b.group.visible = k > 0.001
    }

    composer.render()
  }
  frame()

  return {
    dispose() {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('resize', onResize)
      composer.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

function makePoints(
  positions: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  seeds: Float32Array,
  time: { value: number },
  pixelRatio: { value: number },
): THREE.Points {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  const mat = new THREE.ShaderMaterial({
    vertexShader: pointsVertex,
    fragmentShader: pointsFragment,
    uniforms: { uTime: time, uPixelRatio: pixelRatio },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  return points
}
