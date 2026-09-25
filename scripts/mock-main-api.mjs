// Connect only to the isolated test process's Node inspector. Unlike
// electron.launch(), this does not add Chromium flags that change mouse input.
export function mockMainApi(process) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Inspector do processo de teste indisponível.')), 15000);
    let output = '', connected = false;
    const receive = chunk => {
      output += chunk.toString();
      const address = output.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-z0-9-]+/i)?.[0];
      if (!address || connected) return;
      connected = true;
      const socket = new WebSocket(address);
      socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'globalThis.fetch = async () => new Response(JSON.stringify({ text: "Texto de teste inserido." }))' } })));
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timeout); socket.close(); process.stderr.off('data', receive);
        if (message.error || message.result?.exceptionDetails) reject(new Error('Não foi possível simular a API no processo de teste.'));
        else resolve();
      });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Falha de conexão ao inspector local do teste.')); });
    };
    process.stderr.on('data', receive);
  });
}
