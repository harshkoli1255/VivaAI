export * from './lib/api';
export * from './lib/utils';
export * from './lib/speech';
export * from './store';

// UI Components
export * from './components/ui/Button';
export * from './components/ui/Card';
export * from './components/ui/Badge';
export * from './components/ui/Modal';
export * from './components/ui/Navbar';

// Canvas & 3D Components
export { default as AcousticSphere } from './components/canvas/AcousticSphere';
export { default as AcousticVisualizer } from './components/canvas/AcousticVisualizer';
export { default as FacultyCohortVisualizer } from './components/canvas/FacultyCohortVisualizer';

// Providers
export * from './components/providers/ThemeProvider';
export * from './components/providers/ToastProvider';

// Dashboard & Interview Components
export { default as AudioTranscriptPlayer } from './components/dashboard/AudioTranscriptPlayer';
export { default as ScoreRadarChart } from './components/dashboard/ScoreRadarChart';
export * from './components/interview/CountdownRing';
export * from './components/interview/LiveCaptions';
export * from './components/interview/MicCheck';
export * from './components/interview/CodeScratchpad';
export { default as VoiceOrb } from './components/interview/VoiceOrb';
