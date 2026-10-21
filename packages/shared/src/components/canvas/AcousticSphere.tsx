'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';

export interface AcousticSphereProps {
  state?: 'idle' | 'speaking' | 'listening' | 'thinking';
  audioLevel?: number; // 0.0 to 1.0
  size?: number;
  className?: string;
  theme?: 'light' | 'dark';
  interactive?: boolean;
}

function checkWebGLSupport(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function subscribeReducedMotion(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function AcousticSphere({
  state = 'idle',
  audioLevel = 0,
  size = 280,
  className = '',
  theme = 'light',
  interactive = true,
}: AcousticSphereProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasWebGL, setHasWebGL] = useState<boolean>(checkWebGLSupport);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, () => false);

  // References to keep updated values accessible in animation loop without recreation
  const stateRef = useRef(state);
  const audioLevelRef = useRef(audioLevel);
  const themeRef = useRef(theme);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    if (!hasWebGL || reducedMotion || !containerRef.current) return;

    const container = containerRef.current;
    const width = Math.max(container.clientWidth || size, 1);
    const height = Math.max(container.clientHeight || size, 1);

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.z = 4.8;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      container.appendChild(renderer.domElement);
    } catch (e) {
      console.warn('WebGL initialization failed, falling back:', e);
      setTimeout(() => setHasWebGL(false), 0);
      return;
    }

    // 2. Geometries & Materials
    // Base geometry for wireframe sphere
    const detail = 3;
    const radius = 1.35;
    const baseGeometry = new THREE.IcosahedronGeometry(radius, detail);
    const positionAttr = baseGeometry.attributes.position;
    const originalPositions = new Float32Array(positionAttr.array);

    // Colors matching our academic palette
    const isDark = themeRef.current === 'dark';
    const primaryColor = isDark ? 0x2dd4bf : 0x0f5b4a; // teal vs deep evergreen
    const accentColor = isDark ? 0x38bdf8 : 0x0d9488;  // sky vs teal
    const innerColor = isDark ? 0x0f766e : 0x115e59;   // deep jewel

    // Wireframe Outer Mesh
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: primaryColor,
      wireframe: true,
      transparent: true,
      opacity: isDark ? 0.45 : 0.65,
    });
    const wireframeMesh = new THREE.Mesh(baseGeometry, wireframeMaterial);
    scene.add(wireframeMesh);

    // Particle Cloud at vertices
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', positionAttr);
    const particleMaterial = new THREE.PointsMaterial({
      color: accentColor,
      size: 0.055,
      transparent: true,
      opacity: isDark ? 0.85 : 0.9,
    });
    const particleCloud = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particleCloud);

    // Inner Core Sphere (gentle glow)
    const coreGeometry = new THREE.SphereGeometry(0.85, 24, 24);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: innerColor,
      transparent: true,
      opacity: isDark ? 0.25 : 0.15,
      wireframe: false,
    });
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    scene.add(coreMesh);

    // Outer Harmonic Rings (Acoustic resonance circles)
    const ringGeometry = new THREE.RingGeometry(1.65, 1.68, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: accentColor,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    });
    const ringMesh1 = new THREE.Mesh(ringGeometry, ringMaterial);
    ringMesh1.rotation.x = Math.PI / 3;
    scene.add(ringMesh1);

    const ringMesh2 = new THREE.Mesh(ringGeometry, ringMaterial);
    ringMesh2.rotation.y = Math.PI / 4;
    ringMesh2.rotation.z = Math.PI / 6;
    scene.add(ringMesh2);

    // 3. Mouse Tilt Interaction
    let mouseX = 0;
    let mouseY = 0;
    let targetRotationX = 0;
    let targetRotationY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      if (!interactive) return;
      const rect = container.getBoundingClientRect();
      mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetRotationY = mouseX * 0.4;
      targetRotationX = -mouseY * 0.4;
    };

    if (interactive) {
      container.addEventListener('pointermove', handleMouseMove);
    }

    // 4. Animation Loop
    let animationFrameId: number | null = null;
    let isVisible = true;
    const startTime = performance.now();

    const animate = (currentTime: number = performance.now()) => {
      animationFrameId = null;
      if (document.hidden || !isVisible) return;

      const elapsedTime = (currentTime - startTime) * 0.001;
      const currentState = stateRef.current;
      const currentLevel = audioLevelRef.current;
      const currentTheme = themeRef.current;

      // Update material colors if theme changed
      const darkNow = currentTheme === 'dark';
      wireframeMaterial.color.setHex(darkNow ? 0xa9c9ff : 0x3558e8);
      particleMaterial.color.setHex(darkNow ? 0xc8f3e4 : 0x527de0);
      coreMaterial.color.setHex(darkNow ? 0x42699e : 0x35518a);

      // Dynamic oscillation parameters based on state
      let speed = 0.8;
      let waveAmp = 0.08;
      let waveFreq = 2.0;

      if (currentState === 'speaking') {
        speed = 2.4;
        waveAmp = 0.18 + Math.sin(elapsedTime * 6) * 0.08;
        waveFreq = 3.5;
      } else if (currentState === 'listening') {
        speed = 1.6;
        waveAmp = 0.08 + currentLevel * 0.35;
        waveFreq = 3.0 + currentLevel * 4.0;
      } else if (currentState === 'thinking') {
        speed = 3.2;
        waveAmp = 0.12;
        waveFreq = 4.5;
      }

      // Smooth mouse rotation damping
      wireframeMesh.rotation.y += (targetRotationY - wireframeMesh.rotation.y) * 0.05 + 0.003 * speed;
      wireframeMesh.rotation.x += (targetRotationX - wireframeMesh.rotation.x) * 0.05 + 0.002 * speed;
      particleCloud.rotation.copy(wireframeMesh.rotation);

      // Rotate acoustic orbital rings
      ringMesh1.rotation.z += 0.006 * speed;
      ringMesh2.rotation.x += 0.004 * speed;

      // Pulse inner core scale
      const coreScale = 0.85 + Math.sin(elapsedTime * 2 * speed) * (currentState === 'speaking' ? 0.15 : 0.05);
      coreMesh.scale.set(coreScale, coreScale, coreScale);

      // Harmonic vertex displacement on icosahedron
      const positions = positionAttr.array as Float32Array;
      const vertexCount = positions.length / 3;

      for (let i = 0; i < vertexCount; i++) {
        const i3 = i * 3;
        const ox = originalPositions[i3];
        const oy = originalPositions[i3 + 1];
        const oz = originalPositions[i3 + 2];

        // Spherical harmonics wave calculation
        const distance = Math.sqrt(ox * ox + oy * oy + oz * oz);
        const nx = ox / distance;
        const ny = oy / distance;
        const nz = oz / distance;

        const wave =
          Math.sin(nx * waveFreq + elapsedTime * speed * 2) *
          Math.cos(ny * waveFreq + elapsedTime * speed * 1.5) *
          Math.sin(nz * waveFreq + elapsedTime * speed);

        const displacement = 1 + wave * waveAmp;

        positions[i3] = ox * displacement;
        positions[i3 + 1] = oy * displacement;
        positions[i3 + 2] = oz * displacement;
      }

      positionAttr.needsUpdate = true;
      particleGeometry.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    const startAnimation = () => {
      if (!document.hidden && isVisible && animationFrameId === null) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };
    const handleVisibility = () => {
      if (document.hidden && animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      } else {
        startAnimation();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      if (!isVisible && animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      } else {
        startAnimation();
      }
    });
    intersectionObserver.observe(container);
    startAnimation();

    // 5. Responsive Resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = Math.max(entry.contentRect.width || size, 1);
        const newHeight = Math.max(entry.contentRect.height || size, 1);
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(newWidth, newHeight);
      }
    });
    resizeObserver.observe(container);

    // 6. Cleanup
    return () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      document.removeEventListener('visibilitychange', handleVisibility);
      intersectionObserver.disconnect();
      if (interactive) {
        container.removeEventListener('pointermove', handleMouseMove);
      }
      resizeObserver.disconnect();
      baseGeometry.dispose();
      particleGeometry.dispose();
      coreGeometry.dispose();
      ringGeometry.dispose();
      wireframeMaterial.dispose();
      particleMaterial.dispose();
      coreMaterial.dispose();
      ringMaterial.dispose();
      renderer.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [hasWebGL, reducedMotion, size, interactive]);

  // Static Fallback for Reduced Motion, Unsupported WebGL, or High Accessibility Needs
  if (hasWebGL === false || reducedMotion) {
    const isDark = theme === 'dark';
    return (
      <div
        className={`relative flex items-center justify-center rounded-full ${className}`}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`Acoustic voice resonance indicator (${state} state)`}
      >
        {/* Static concentric acoustic rings */}
        <div
          className={`absolute inset-0 rounded-full border ${
            isDark ? 'border-teal-500/20 bg-teal-950/20' : 'border-emerald-700/20 bg-emerald-50/40'
          }`}
        />
        <div
          className={`absolute inset-4 rounded-full border border-dashed ${
            isDark ? 'border-teal-400/30' : 'border-emerald-700/30'
          }`}
        />
        <div
          className={`absolute inset-10 rounded-full border ${
            isDark ? 'border-teal-400/40' : 'border-emerald-700/40'
          }`}
        />
        <div
          className={`h-20 w-20 rounded-full flex items-center justify-center font-mono text-xs font-semibold uppercase tracking-wider ${
            isDark ? 'bg-teal-500/20 text-teal-300' : 'bg-emerald-800 text-white'
          }`}
        >
          {state}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Acoustic 3D voice visualization showing examiner state: ${state}`}
    />
  );
}

export default AcousticSphere;
