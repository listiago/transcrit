import { useEffect, useRef, useState } from 'react';
import { GripVertical, LoaderCircle, Mic, RotateCcw, Settings2, Square, X } from 'lucide-react';
import type { OverlayState } from './types';

export function Overlay() {
  const [state, setState] = useState<OverlayState>({ status: 'idle', message: '', preview: '', pending: 0, previewError: '', retryable: false });
  const [error, setError] = useState('');
  const [bands, setBands] = useState<number[]>(Array(8).fill(0));
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let received = false;
    const off = window.transcribe?.onOverlay(value => { received = true; setState(value); });
    void window.transcribe?.getOverlayState().then(value => { if (!received) setState(value); });
    return off;
  }, []);
  useEffect(() => setError(''), [state.status]);
  useEffect(() => window.transcribe?.onMeter(setBands), []);
  useEffect(() => { if (state.status !== 'recording') setBands(Array(8).fill(0)); }, [state.status]);
  const action = (value: 'start' | 'finish' | 'retry') => { void window.transcribe?.recordingAction(value).catch(cause => setError(cause.message)); };
  const recording = state.status === 'recording', starting = state.status === 'starting';
  const working = ['processing', 'inserting'].includes(state.status);
  const failed = state.status === 'error';
  const needsSettings = failed && state.errorAction === 'settings';
  const openSettings = () => { void window.transcribe?.openSettings().catch(cause => setError(cause.message)); };
  const label = recording || starting ? 'Parar e inserir texto' : needsSettings ? 'Abrir configurações' : failed && state.retryable ? 'Tentar novamente' : 'Iniciar ditado';
  const tip = error || (failed ? `${state.message} Clique para ${needsSettings ? 'abrir as configurações' : state.retryable ? 'tentar novamente' : 'gravar novamente'}.` : recording ? 'Parar e inserir texto · Enter' : starting ? 'Abrindo microfone · Esc cancela' : working ? 'Transcrevendo e inserindo…' : state.message.startsWith('Texto pronto. Cole') ? state.message : 'Iniciar ditado');
  const wave = (reverse = false) => <span className={`voice-spectrum ${reverse ? 'reverse' : ''}`} aria-hidden="true">{bands.map((value, index) => <i key={index} style={{ height: 3 + value * 27, opacity: 0.35 + value * 0.65 }} />)}</span>;
  return <div className="overlay-stage"><div className={`dictation-overlay compact ${state.status} ${recording || starting ? 'expanded' : ''} ${failed || error ? 'has-error' : ''}`} role="region" aria-label="Controles do ditado">
    <button className="overlay-drag" aria-label="Mover card" title="Arraste para mover" onPointerDown={event => { event.preventDefault(); drag.current = { x: event.screenX, y: event.screenY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => {
      if (!(event.buttons & 1)) { drag.current = null; return; }
      if (!drag.current) return;
      const dx = event.screenX - drag.current.x, dy = event.screenY - drag.current.y;
      drag.current = { x: event.screenX, y: event.screenY };
      if (dx || dy) void window.transcribe?.moveOverlay(dx, dy).catch(cause => setError(cause.message));
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}><GripVertical size={16} /></button>
    {wave(true)}
    <button className={`overlay-mic ${recording ? 'listening' : ''}`} aria-label={working ? 'Transcrevendo ditado' : label} title={tip} disabled={working} onPointerDown={event => event.preventDefault()} onClick={() => needsSettings ? openSettings() : action(recording || starting ? 'finish' : failed && state.retryable ? 'retry' : 'start')}>
      {working || starting ? <LoaderCircle className="spin" size={19} /> : recording ? <Square size={15} fill="currentColor" /> : needsSettings ? <Settings2 size={19} /> : failed && state.retryable ? <RotateCcw size={19} /> : <Mic size={20} />}
    </button>
    {wave()}
    <button className="overlay-close" aria-label="Fechar card" title="Fechar · Esc cancela o ditado" disabled={state.status === 'inserting'} onPointerDown={event => event.preventDefault()} onClick={() => void window.transcribe?.dismissOverlay().catch(cause => setError(cause.message))}><X size={15} /></button>
    <span className="visually-hidden" role={failed || error ? 'alert' : 'status'}>{tip}</span>
  </div>{(recording || starting) && <div className="overlay-shortcuts" aria-label="Atalhos do ditado">
    <button aria-label="Concluir ditado (Enter)" onPointerDown={event => event.preventDefault()} onClick={() => action('finish')}><kbd>Enter</kbd> concluir</button>
    <span aria-hidden="true" />
    <button aria-label="Cancelar ditado (Esc)" onPointerDown={event => event.preventDefault()} onClick={() => void window.transcribe?.recordingAction('cancel').catch(cause => setError(cause.message))}><kbd>Esc</kbd> cancelar</button>
  </div>}</div>;
}
