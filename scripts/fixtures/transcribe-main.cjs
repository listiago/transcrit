// Fake API only. No changes to Electron/Chromium input, rendering or focus flags.
globalThis.fetch = async () => new Response('{"text":"Texto de teste inserido."}');
require('../../electron/main.cjs');
