const { test } = require('node:test');
const assert = require('node:assert/strict');
const { showOverlay, positionOverlay } = require('../electron/overlay-window.cjs');
const { shapeOverlay } = require('../electron/overlay-window.cjs');

const area = { x: 0, y: 0, width: 1920, height: 1080 };
test('native hit region leaves unused space clickable and updates only on expansion changes', () => {
  const calls = [];
  const window = { setShape: rectangles => calls.push(rectangles) };
  shapeOverlay(window, false); shapeOverlay(window, false);
  assert.equal(calls.length, 1);
  const hit = (x, y) => calls.at(-1).some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  assert.equal(hit(20, 36), false); assert.equal(hit(122, 86), false); assert.equal(hit(122, 36), true);
  shapeOverlay(window, true); shapeOverlay(window, true);
  assert.equal(calls.length, 2);
  assert.equal(hit(27, 36), true); assert.equal(hit(217, 36), true); assert.equal(hit(122, 86), true);
});
test('updating or dragging a visible card never re-shows, raises or reloads the captured view', () => {
  let bounds = { x: 1656, y: 490, width: 244, height: 100 };
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
  assert.deepEqual(bounds, { x: 1420, y: 400, width: 244, height: 100 });
  showOverlay(window, area, true, { right: 1664, top: 400 });
});
