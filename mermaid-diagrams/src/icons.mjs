// Original 16px stroke icons, rendered with currentColor.
export const ICONS = {
  source: '<path d="M9 7 4 12l5 5M15 7l5 5-5 5"/>',
  diagram: '<rect x="3.5" y="4" width="7" height="5" rx="1.5"/><rect x="13.5" y="15" width="7" height="5" rx="1.5"/><path d="M7 9v3.5a2 2 0 0 0 2 2h4.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 5.5V5a1.5 1.5 0 0 0-1.5-1.5H6A2.5 2.5 0 0 0 3.5 6v8A1.5 1.5 0 0 0 5 15.5h.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4M8.5 11h5M11 8.5v5"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4M8.5 11h5"/>',
  fit: '<path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5V9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15M15 20h3.5a1.5 1.5 0 0 0 1.5-1.5V15"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/>'
};
export function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}
