const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 600, height: 300, title: 'Destino externo de teste' });
  await window.loadURL('data:text/html,<textarea autofocus aria-label="Destino externo" style="width:95%;height:200px"></textarea>');
});
app.on('window-all-closed', () => app.quit());
