/** @type {const} */
const themeColors = {
  // SmartSquash brand palette — dark: matches smartsquash.github.io, light: bright variant
  primary:    { light: '#00b360', dark: '#00ff88' },  // neon green
  secondary:  { light: '#00a0cc', dark: '#00c8ff' },  // cyan
  accent:     { light: '#6b1fd4', dark: '#7b2fff' },  // purple
  background: { light: '#f0f8f4', dark: '#080c14' },  // deep navy / light mint
  surface:    { light: '#ffffff', dark: '#0d1420' },   // card dark / white
  foreground: { light: '#080c14', dark: '#e8f0fe' },  // near-black / light blue-white
  muted:      { light: '#4a6070', dark: '#8a9ab5' },  // blue-gray muted
  border:     { light: '#c8e8d8', dark: '#1a2535' },  // subtle green-tinted / dark border
  success:    { light: '#00b360', dark: '#00ff88' },  // neon green
  warning:    { light: '#D97706', dark: '#FBBF24' },  // amber
  error:      { light: '#DC2626', dark: '#F87171' },  // red
};

module.exports = { themeColors };
