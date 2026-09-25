// Enter and Escape belong to Transcribe only for the duration of a dictation.
// Keep them captured through delivery and until the physical keys are released.
class SessionControls {
  constructor(shortcuts, waitForRelease, onFinish, onCancel) {
    this.shortcuts = shortcuts;
    this.waitForRelease = waitForRelease;
    this.onFinish = onFinish;
    this.onCancel = onCancel;
    this.phase = 'idle';
    this.owned = [];
    this.releasing = null;
    this.finishRequested = false;
  }
  arm() {
    if (this.phase !== 'idle') throw new Error('Aguarde o ditado anterior terminar e solte Enter e Esc.');
    try {
      for (const [key, action] of [['Enter', () => this.finish()], ['Escape', () => this.cancel()]]) {
        if (!this.shortcuts.register(key, action)) throw new Error(`A tecla ${key === 'Escape' ? 'Esc' : key} está em uso por outro aplicativo. Libere-a antes de iniciar o ditado.`);
        this.owned.push(key);
      }
      this.phase = 'starting';
    } catch (error) { this.unregister(); throw error; }
  }
  setPhase(phase) {
    if (!this.owned.length || this.releasing) return;
    this.phase = phase;
    if (phase === 'recording' && this.finishRequested) this.finish();
  }
  finish() {
    if (this.phase === 'starting') { this.finishRequested = true; return; }
    if (this.phase !== 'recording') return;
    this.finishRequested = false;
    this.phase = 'processing';
    this.onFinish();
  }
  cancel() {
    if (!['starting', 'recording', 'processing'].includes(this.phase)) return;
    this.phase = 'cancelling';
    this.onCancel();
  }
  unregister() {
    for (const key of this.owned) this.shortcuts.unregister(key);
    this.owned = [];
    this.phase = 'idle';
    this.finishRequested = false;
  }
  release() {
    if (this.releasing) return this.releasing;
    if (!this.owned.length) return Promise.resolve();
    this.phase = 'releasing';
    this.releasing = (async () => {
      try { while (!await this.waitForRelease()) { /* A held key must not repeat into the destination. */ } }
      finally { this.unregister(); this.releasing = null; }
    })();
    return this.releasing;
  }
}
module.exports = { SessionControls };
