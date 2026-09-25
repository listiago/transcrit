const shownOverlays = new WeakSet();

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
  const reopening = process.platform === 'win32' && !window.isVisible() && shownOverlays.has(window);
  window.setBounds(overlayBounds(workArea, docked, anchor));
  window.setIgnoreMouseEvents(false);
  window.showInactive();
  // On Windows a transparent, non-activating window can keep stale input state
  // after hide/show. A fresh document restores mouse input without activating
  // the native window. Recording lives in the separate main window; the card
  // fetches its current state again when it mounts.
  if (reopening) window.webContents.reload();
  shownOverlays.add(window);
  // showInactive restores a hidden native window without activating it. Reapply
  // the z-order afterwards so maximized/fullscreen windows cannot cover the bar.
  raiseOverlay(window);
}
module.exports = { raiseOverlay, showOverlay, overlayBounds };
