// Test-only Node inspector: no renderer debugger or Chromium automation flags.
// The caller must spawn an isolated profile. Never connect to the user's app.
export function connectMainInspector(child) {
  return new Promise((resolve, reject) => {
    let output = '', socket, serial = 0;
    const pending = new Map();
    const timeout = setTimeout(() => { child.stderr.off('data', receive); socket?.close(); reject(new Error('Inspector do processo de teste indisponível.')); }, 15000);
    const evaluate = expression => new Promise((done, fail) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); fail(new Error('Tempo limite do inspector de teste.')); }, 15000);
      pending.set(id, { done, fail, timer });
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    const receive = chunk => {
      output += chunk.toString();
      const address = output.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-z0-9-]+/i)?.[0];
      if (!address || socket) return;
      socket = new WebSocket(address);
      socket.addEventListener('open', () => {
        clearTimeout(timeout); child.stderr.off('data', receive);
        resolve({ evaluate, close: () => socket.close() });
      });
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data), request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id); clearTimeout(request.timer);
        if (message.error || message.result?.exceptionDetails) request.fail(new Error('Falha no inspector de teste: ' + JSON.stringify(message.error || message.result.exceptionDetails)));
        else request.done(message.result?.result?.value);
      });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Falha de conexão ao inspector local do teste.')); });
    };
    child.stderr.on('data', receive);
  });
}
