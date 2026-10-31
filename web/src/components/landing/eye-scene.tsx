"use client";

// The landing-page 3D figure: an eye printed in ~11,000 halftone dots. It is
// the "photo" inside the polaroids on the evidence board.
//
//   iris fibres   radial strands from the pupil to the rim; the dots get
//                 bigger towards the pupil, the shading trick of halftone print.
//                 They "breathe" as the pupil dilates and contracts
//   collarette    an inner ring printed in the accent colour (caution yellow)
//   rim           the outer edge of the iris
//   lens rings    two segmented rings orbiting in opposite directions
//   dust          sparse dots drifting in depth
//   scan pulse    an accent-coloured ring rippling outwards every few seconds,
//                 the same "scan" idea as the Verify page's laser
//
// Colours come from CSS variables (--ink, --signal, --muted, --paper,
// --alarm) read from the canvas's own element, so the polaroid can give its
// photo a fixed dark "film" palette whatever the page theme. They are re-read
// when the theme is toggled.
//
// Variants:
//   original  the clean eye (the sealed photo)
//   suspect   the same eye with two bands of dots sliced sideways and printed
//             in red, glitching a few times a second: the "edited region"
//
// Interaction: the eye turns towards the cursor, and the pupil contracts as
// the pointer approaches it (as if focusing).
//
// Performance: ONE draw call. Every dot is animated in a vertex shader on the
// GPU; positions never go back to the CPU. Halved on small screens.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useTheme } from "@/lib/client/theme";

const PUPIL_R = 0.42;
const IRIS_R = 1.35;

// 0 iris fibre, 1 collarette (accent), 2 orbiting lens ring, 3 dust, 4 rim, 5 catchlight
type Kind = 0 | 1 | 2 | 3 | 4 | 5;

/** Builds every dot's starting position and per-dot attributes. */
function buildParticles(density: number) {
  const pos: number[] = [];
  const size: number[] = [];
  const seed: number[] = [];
  const kind: number[] = [];
  const speed: number[] = [];
  const add = (x: number, y: number, z: number, s: number, k: Kind, sp = 0) => {
    pos.push(x, y, z);
    size.push(s);
    seed.push(Math.random());
    kind.push(k);
    speed.push(sp);
  };

  // Iris fibres: wavy radial strands.
  const fibres = Math.round(220 * density);
  for (let f = 0; f < fibres; f++) {
    const a0 = (f / fibres) * Math.PI * 2 + (Math.random() - 0.5) * 0.03;
    const wave = (Math.random() - 0.5) * 0.25;
    const points = 24;
    for (let i = 0; i < points; i++) {
      const t = i / (points - 1);
      const r = PUPIL_R + (IRIS_R - PUPIL_R) * t + (Math.random() - 0.5) * 0.02;
      const a = a0 + Math.sin(t * Math.PI) * wave * 0.35;
      add(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 0.06, 0.8 + Math.random() * 0.8, 0);
    }
  }
  // Collarette: the inner ring, printed in the accent colour.
  for (let i = 0; i < 900 * density; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.74 + (Math.random() - 0.5) * 0.06;
    add(Math.cos(a) * r, Math.sin(a) * r, 0.02, 1 + Math.random() * 0.8, 1);
  }
  // Rim: the outer edge of the iris.
  for (let i = 0; i < 900 * density; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = IRIS_R + 0.03 + Math.abs(Math.random() - 0.5) * 0.07;
    add(Math.cos(a) * r, Math.sin(a) * r, 0, 0.9 + Math.random() * 0.7, 4);
  }
  // Two segmented lens rings, turning in opposite directions.
  for (const [r, sp, n] of [
    [1.8, 0.12, 1100],
    [2.12, -0.07, 1300],
  ] as const) {
    for (let i = 0; i < n * density; i++) {
      const a = Math.random() * Math.PI * 2;
      if (Math.sin(a * 6) > 0.8) continue; // gaps, like the segments of a lens barrel
      const rr = r + (Math.random() - 0.5) * 0.02;
      add(Math.cos(a) * rr, Math.sin(a) * rr, (Math.random() - 0.5) * 0.04, 0.8 + Math.random() * 0.8, 2, sp);
    }
  }
  // Catchlight: a few big paper-coloured dots on the pupil, the glint that
  // makes it read as an eye.
  for (let i = 0; i < 5; i++) {
    add(-0.14 + (Math.random() - 0.5) * 0.04, 0.15 + (Math.random() - 0.5) * 0.04, 0.06, 4 + Math.random() * 3, 5);
  }
  // Depth dust in a loose shell.
  for (let i = 0; i < 900 * density; i++) {
    const r = 2.4 + Math.random() * 1.8;
    const a = Math.random() * Math.PI * 2;
    add(Math.cos(a) * r, Math.sin(a) * r * 0.8, (Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.8, 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
  geometry.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
  geometry.setAttribute("aSpeed", new THREE.Float32BufferAttribute(speed, 1));
  return geometry;
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uDilate;
  uniform float uPixelRatio;
  uniform float uScale;
  uniform vec3 uInk;
  uniform vec3 uAccent;
  uniform vec3 uMuted;
  uniform vec3 uPaper;
  uniform vec3 uAlarm;
  uniform float uTamper;
  attribute float aSize;
  attribute float aSeed;
  attribute float aKind;
  attribute float aSpeed;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    float r = length(p.xy);
    float sizeMul = 1.0;
    vAlpha = 1.0;

    if (aKind < 0.5) {
      // Iris fibres stretch between the (moving) pupil edge and the rim.
      float t = clamp((r - ${PUPIL_R.toFixed(2)}) / ${(IRIS_R - PUPIL_R).toFixed(2)}, 0.0, 1.0);
      float newR = mix(${PUPIL_R.toFixed(2)} * uDilate, ${IRIS_R.toFixed(2)}, t);
      p.xy *= newR / max(r, 1e-4);
      p.z += sin(uTime * 1.3 + aSeed * 6.283) * 0.02;
      sizeMul = mix(1.45, 0.6, t); // halftone shading: bigger dots near the pupil
      vColor = uInk;
    } else if (aKind < 1.5) {
      vColor = uAccent;
    } else if (aKind < 2.5) {
      float a = uTime * aSpeed;
      p.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * p.xy;
      vColor = mix(uInk, uMuted, 0.35);
    } else if (aKind < 3.5) {
      p += 0.12 * vec3(sin(uTime * 0.21 + aSeed * 10.0), cos(uTime * 0.17 + aSeed * 7.0), sin(uTime * 0.13 + aSeed * 3.0));
      vColor = uMuted;
      vAlpha = 0.55;
    } else if (aKind < 4.5) {
      vColor = uInk;
    } else {
      vColor = uPaper; // catchlight
    }

    // Suspect variant: two horizontal bands are cut and shifted sideways (by
    // an amount that jumps ~4 times a second) and printed in red.
    if (uTamper > 0.5) {
      float band = step(0.08, p.y) * step(p.y, 0.55);
      float band2 = step(-0.95, p.y) * step(p.y, -0.74);
      float jit = fract(sin(floor(uTime * 4.0) * 12.9898) * 43758.5453);
      p.x += band * (0.28 + jit * 0.14) - band2 * (0.16 + jit * 0.1);
      vColor = mix(vColor, uAlarm, max(band, band2));
    }

    // Scan pulse: an accent ring sweeping outwards every ~4.5 s.
    float pulseR = mix(0.35, 2.4, fract(uTime * 0.22));
    float pulse = smoothstep(0.1, 0.0, abs(length(p.xy) - pulseR)) * step(aKind, 2.5);
    vColor = mix(vColor, uAccent, pulse);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * sizeMul * uPixelRatio * uScale * (1.0 + pulse * 0.9) * (15.0 / -mv.z);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // A crisp printed dot with a hair of anti-aliasing: halftone, not glow.
    float d = length(gl_PointCoord - 0.5);
    float a = 1.0 - smoothstep(0.38, 0.5, d);
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

/** Reads a colour CSS variable (e.g. --ink) as seen by `el` into a THREE.Color. */
function cssColor(el: Element, name: string): THREE.Color {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return new THREE.Color(value || "#000000");
}

export type EyeVariant = "original" | "suspect";

type Pointer = { x: number; y: number; active: boolean };

function Eye({ pointer, animate, variant }: { pointer: React.RefObject<Pointer>; animate: boolean; variant: EyeVariant }) {
  const group = useRef<THREE.Group>(null);
  const pupil = useRef<THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>>(null);
  // Per-frame updates go through refs (refs are meant to be mutated; the
  // memoised material itself must not be, per React's rules).
  const points = useRef<THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>>(null);
  const { size, viewport, gl, invalidate } = useThree();
  const theme = useTheme();

  // The outer lens ring is ~4.3 units across: fit it inside the plate.
  const scale = Math.min(viewport.width, viewport.height) / 4.7;

  const geometry = useMemo(() => buildParticles(size.width < 420 ? 0.55 : 1), [size.width]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: 2.0 }, // a frozen frame still shows a pulse mid-way
          uDilate: { value: 1 },
          uPixelRatio: { value: gl.getPixelRatio() },
          uScale: { value: scale },
          uInk: { value: new THREE.Color() },
          uAccent: { value: new THREE.Color() },
          uMuted: { value: new THREE.Color() },
          uPaper: { value: new THREE.Color() },
          uAlarm: { value: new THREE.Color() },
          uTamper: { value: variant === "suspect" ? 1 : 0 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [gl, scale, variant],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  // All shader updates happen in the frame callback below. When the theme
  // changes we only request a frame; the frame then re-inks the eye once.
  // (Also needed when the loop is paused for reduced motion.)
  const inkedFor = useRef<string | null>(null);
  useEffect(() => {
    invalidate();
  }, [theme, material, invalidate]);

  useFrame((state, delta) => {
    const uniforms = points.current?.material.uniforms;
    if (!uniforms) return;

    const inkKey = `${theme}|${material.uuid}`;
    if (inkedFor.current !== inkKey) {
      const el = gl.domElement;
      uniforms.uInk.value.copy(cssColor(el, "--ink"));
      uniforms.uAccent.value.copy(cssColor(el, "--signal"));
      uniforms.uMuted.value.copy(cssColor(el, "--muted"));
      uniforms.uPaper.value.copy(cssColor(el, "--paper"));
      uniforms.uAlarm.value.copy(cssColor(el, "--alarm"));
      pupil.current?.material.color.copy(cssColor(el, "--ink"));
      inkedFor.current = inkKey;
    }

    if (!animate) return;
    const g = group.current;
    if (!g) return;
    const p = pointer.current;
    const t = state.clock.elapsedTime;
    uniforms.uTime.value = t;

    // Without a mouse (phones), the eye slowly looks around on its own.
    const tx = p.active ? p.x : Math.sin(t * 0.35) * 0.5;
    const ty = p.active ? p.y : Math.cos(t * 0.27) * 0.3;

    // Ease towards the pointer (frame-rate independent damping).
    const k = 1 - Math.exp(-delta * 3);
    g.rotation.y += (tx * 0.55 - g.rotation.y) * k;
    g.rotation.x += (-ty * 0.4 - g.rotation.x) * k;

    // Pupil: breathes gently, and contracts as the pointer nears it.
    const focus = p.active ? Math.max(0, 1 - Math.hypot(p.x, p.y) * 1.2) : 0;
    const target = 1.08 + Math.sin(t * 0.6) * 0.06 - focus * 0.32;
    const dil = uniforms.uDilate.value + (target - uniforms.uDilate.value) * k;
    uniforms.uDilate.value = dil;
    pupil.current?.scale.setScalar(dil);
  });

  return (
    <group scale={scale}>
      <group ref={group}>
        {/* Pupil: a solid ink disc under the dots (the catchlight is dots) */}
        <mesh ref={pupil} position={[0, 0, -0.01]}>
          <circleGeometry args={[PUPIL_R * 0.98, 64]} />
          <meshBasicMaterial />
        </mesh>
        <points ref={points} geometry={geometry} material={material} />
      </group>
    </group>
  );
}

export default function EyeScene({ animate, variant = "original" }: { animate: boolean; variant?: EyeVariant }) {
  const pointer = useRef<Pointer>({ x: 0, y: 0, active: false });
  const host = useRef<HTMLDivElement>(null);
  const visible = useRef(true);

  // Track the mouse anywhere on the page, relative to the eye's own centre, so
  // it looks at the cursor even when the cursor is over the headline.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !host.current) return;
      const r = host.current.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      pointer.current = {
        x: clamp((e.clientX - cx) / (window.innerWidth / 2)),
        y: clamp(-(e.clientY - cy) / (window.innerHeight / 2)),
        active: true,
      };
    };
    const onLeave = () => (pointer.current = { ...pointer.current, active: false });
    window.addEventListener("pointermove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  // Stop rendering when the figure is scrolled out of view (saves battery).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => (visible.current = entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={host} className="absolute inset-0">
      <Canvas
        camera={{ position: [0, 0, 4.4], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        // Reduced motion: draw still frames on demand instead of an animation loop.
        frameloop={animate ? "always" : "demand"}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <VisibilityPause visible={visible} animate={animate} />
        <Eye pointer={pointer} animate={animate} variant={variant} />
      </Canvas>
    </div>
  );
}

/**
 * Stops the render loop while the canvas is scrolled off-screen and restarts
 * it when it comes back. Does nothing with reduced motion, where the loop is
 * already "demand" (still frames only).
 */
function VisibilityPause({ visible, animate }: { visible: React.RefObject<boolean>; animate: boolean }) {
  const setFrameloop = useThree((s) => s.setFrameloop);
  useEffect(() => {
    if (!animate) return;
    let current: "always" | "never" = "always";
    const id = setInterval(() => {
      const wanted = visible.current ? "always" : "never";
      if (wanted !== current) {
        setFrameloop(wanted);
        current = wanted;
      }
    }, 250);
    return () => clearInterval(id);
  }, [animate, setFrameloop, visible]);
  return null;
}
