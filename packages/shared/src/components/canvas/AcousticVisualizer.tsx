'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import type { AcousticSphereProps } from './AcousticSphere';

// Lazy-load the Three.js canvas component to keep initial bundle size lean
const AcousticSphereLazy = dynamic(() => import('./AcousticSphere'), {
  ssr: false,
  loading: () => (
    <div
      className="relative flex items-center justify-center rounded-full animate-pulse bg-emerald-900/5 dark:bg-teal-950/20 border border-emerald-900/10 dark:border-teal-500/20"
      style={{ width: 280, height: 280 }}
      aria-label="Loading acoustic resonance model..."
      role="status"
    >
      <div className="h-16 w-16 rounded-full border border-dashed border-emerald-700/30 dark:border-teal-400/30 animate-spin" />
    </div>
  ),
});

export function AcousticVisualizer(props: AcousticSphereProps) {
  return <AcousticSphereLazy {...props} />;
}

export default AcousticVisualizer;
