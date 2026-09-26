const { test } = require('node:test');
const assert = require('node:assert/strict');
const { showOverlay, positionOverlay } = require('../electron/overlay-window.cjs');

const area = { x: 0, y: 0, width: 1920, height: 1080 };
test('updating or dragging a visible card never re-shows, raises or reloads the captured view', () => {
  let bounds = { x: 1764, y: 504, width: 136, height: 72 };
  const window = {
    getBounds: () => bounds, isVisible: () => true,
    setPosition: (x, y) => { bounds = { ...bounds, x, y }; },
    setBounds: () => assert.fail('Card must not resize while dragging'),
    setIgnoreMouseEvents: () => assert.fail('Do not reset input on state updates'),
    showInactive: () => assert.fail('Do not show an already visible card'),
    setAlwaysOnTop: () => assert.fail('Do not reset stacking during drag'),
    webContents: { reload: () => assert.fail('Keep the document and pointer capture') }
  };
  showOverlay(window, area);
  positionOverlay(window, area, false, { right: 1664, top: 400 });
  assert.deepEqual(bounds, { x: 1528, y: 400, width: 136, height: 72 });
  showOverlay(window, area, true, { right: 1664, top: 400 });
});
