// Raising the dictation bar must never activate it: the destination keeps focus.
function raiseOverlay(window) {
  if (window.isDestroyed()) return;
  window.setAlwaysOnTop(true, 'screen-saver');
  window.moveTop();
}

function overlayBounds(workArea, _docked, anchor) {
  const width = 136, height = 72;
  const x = anchor ? anchor.right - width : workArea.x + workArea.width - width - 20;
  const y = anchor ? anchor.top : workArea.y + (workArea.height - height) / 2;
  return { width, height, x: Math.round(Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width))), y: Math.round(Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height))) };
}
function showOverlay(window, workArea, docked = false, anchor) {
  positionOverlay(window, workArea, docked, anchor);
  if (!window.isVisible()) {
    window.setIgnoreMouseEvents(false);
    window.showInactive();
    raiseOverlay(window);
  }
}
function positionOverlay(window, workArea, docked, anchor) {
  const next = overlayBounds(workArea, docked, anchor), current = window.getBounds();
  // Updating the recording state must not reset native input/visibility. While
  // dragging, move only: never show, raise or reload the view holding capture.
  if (current.width !== next.width || current.height !== next.height) window.setBounds(next);
  else if (current.x !== next.x || current.y !== next.y) window.setPosition(next.x, next.y);
}
module.exports = { raiseOverlay, showOverlay, positionOverlay, overlayBounds };
