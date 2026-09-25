import { useEffect, useRef, useState } from 'react';
import type { AppState, AudioInput, Phase, TranscriptionResult } from './types';
import { AudioSegments } from './audio-segments.mjs';

export function useRecorder(app: AppState | null, onResult: (result: TranscriptionResult) => void, onNeedsKey: () => void) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0), [level, setLevel] = useState(0);
  const [error, setError] = useState(''), [retryAvailable, setRetryAvailable] = useState(false);
  const current = useRef({ app, onResult, onNeedsKey }); current.current = { app, onResult, onNeedsKey };
  const status = useRef<Phase>('idle'), generation = useRef(0);
  const stream = useRef<MediaStream | null>(null), context = useRef<AudioContext | null>(null);
  const worklet = useRef<AudioWorkletNode | null>(null), segments = useRef<AudioSegments | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pendingAudio = useRef<AudioInput | null>(null), pendingSession = useRef<{ id: string; duration: number } | null>(null);
  const uploads = useRef<Promise<void>>(Promise.resolve()), uploadError = useRef('');
  const startedAt = useRef(0), flushed = useRef<(() => void) | null>(null);
  const updatePhase = (value: Phase) => { status.current = value; setPhase(value); };
  const cleanup = () => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream.current = null;
    worklet.current?.disconnect(); worklet.current = null;
    void context.current?.close().catch(() => {}); context.current = null; setLevel(0);
  };
  const notify = (value: string, message = '') => { void window.transcribe?.setRecordingState(value, message).catch(() => {}); };
  const fail = (message: string) => { cleanup(); setError(message); updatePhase('error'); notify('error', message); };
  const complete = (result: TranscriptionResult) => { current.current.onResult(result); pendingAudio.current = null; pendingSession.current = null; setRetryAvailable(false); updatePhase('idle'); };
  const send = async (audio: AudioInput, id: number) => {
    pendingAudio.current = audio; setRetryAvailable(false); setError(''); updatePhase('processing'); notify('processing');
    try { const result = await window.transcribe!.transcribe(audio); if (id === generation.current) complete(result); }
    catch (cause) { if (id === generation.current) { setRetryAvailable((cause as Error & { retryable?: boolean }).retryable !== false); fail((cause as Error).message); } }
  };
  const finish = async (id: number, retry = false) => {
    const session = pendingSession.current; if (!session) return;
    setRetryAvailable(false); setError(''); updatePhase('processing'); notify('processing');
    try {
      await uploads.current;
      if (id !== generation.current) return;
      if (uploadError.current) throw new Error(uploadError.current);
      const result = await window.transcribe!.finishDictation(session.id, session.duration, retry);
      if (id === generation.current) complete(result);
    } catch (cause) { if (id === generation.current) { setRetryAvailable(!uploadError.current && (cause as Error & { retryable?: boolean }).retryable !== false); fail((cause as Error).message); } }
  };
  const stop = async () => {
    if (status.current !== 'recording') return;
    const id = generation.current;
    updatePhase('processing'); notify('processing'); clearInterval(timer.current);
    if (pendingSession.current) pendingSession.current.duration = (performance.now() - startedAt.current) / 1000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        flushed.current = resolve;
        timeout = setTimeout(() => reject(new Error('A captura de áudio foi interrompida. Grave novamente.')), 3000);
        worklet.current?.port.postMessage('flush');
      });
      if (id !== generation.current) return;
      segments.current?.flush(); cleanup(); await finish(id);
    } catch (cause) { if (id === generation.current) fail((cause as Error).message); }
    finally { clearTimeout(timeout); if (id === generation.current) flushed.current = null; }
  };
  const start = async () => {
    if (['starting', 'recording', 'processing'].includes(status.current)) return;
    if (!current.current.app?.hasKey) { current.current.onNeedsKey(); return; }
    const id = ++generation.current;
    pendingAudio.current = null; pendingSession.current = null; uploads.current = Promise.resolve(); uploadError.current = '';
    setRetryAvailable(false); setError(''); setSeconds(0); updatePhase('starting');
    try {
      const sessionId = await window.transcribe!.beginRecording();
      if (id !== generation.current) return;
      pendingSession.current = { id: sessionId, duration: 0 };
      const allowed = await window.transcribe!.microphonePermission();
      if (id !== generation.current) return;
      if (!allowed) throw new Error('Permita o acesso ao microfone nas configurações de privacidade do sistema.');
      const microphoneId = current.current.app?.settings.microphoneId;
      const capture = await navigator.mediaDevices.getUserMedia({ audio: { ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (id !== generation.current) { capture.getTracks().forEach(track => track.stop()); return; }
      stream.current = capture;
      const audioContext = new AudioContext({ sampleRate: 24000 }); context.current = audioContext;
      await audioContext.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).href);
      await audioContext.resume();
      if (id !== generation.current) { void audioContext.close().catch(() => {}); return; }
      let sequence = 0;
      segments.current = new AudioSegments(audioContext.sampleRate, (bytes, duration) => {
        const input = { id: sessionId, sequence: sequence++, bytes, duration };
        uploads.current = uploads.current.then(async () => {
          if (id !== generation.current || uploadError.current) return;
          await window.transcribe!.appendSegment(input);
        }).catch(cause => { if (id !== generation.current) return; uploadError.current = (cause as Error).message; void actions.current.stop(); });
      });
      const node = new AudioWorkletNode(audioContext, 'pcm-capture'); worklet.current = node;
      node.port.onmessage = event => {
        if (id !== generation.current) return;
        if (event.data.stopped) { flushed.current?.(); return; }
        if (event.data.pcm) setLevel(Math.min((segments.current?.push(event.data.pcm) || 0) * 5, 1));
      };
      node.onprocessorerror = () => { if (id === generation.current) { ++generation.current; void window.transcribe?.cancel(); fail('A captura foi interrompida. Confira seu microfone e tente novamente.'); } };
      audioContext.createMediaStreamSource(capture).connect(node); node.connect(audioContext.destination);
      capture.getAudioTracks()[0].onended = () => { void actions.current.stop(); };
      startedAt.current = performance.now(); updatePhase('recording'); notify('recording');
      timer.current = setInterval(() => { const elapsed = (performance.now() - startedAt.current) / 1000; setSeconds(elapsed); if (elapsed >= 600) void actions.current.stop(); }, 100);
    } catch (cause) {
      if (id !== generation.current) return;
      const name = (cause as Error).name;
      fail(name === 'NotAllowedError' ? 'O acesso ao microfone foi negado. Permita o acesso nas configurações do sistema.' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'Microfone não encontrado. Conecte um microfone ou selecione outro nas configurações.' : name === 'NotReadableError' ? 'Não foi possível acessar o microfone. Confira se ele está disponível.' : (cause as Error).message || 'Não foi possível iniciar a gravação.');
    }
  };
  const cancel = async () => {
    if (window.transcribe && !await window.transcribe.cancel().catch(() => true)) return;
    ++generation.current; flushed.current?.(); cleanup(); segments.current = null;
    pendingAudio.current = null; pendingSession.current = null; setRetryAvailable(false); setError(''); updatePhase('idle'); setSeconds(0);
  };
  const retry = () => {
    if (status.current !== 'error') return;
    return pendingSession.current ? finish(++generation.current, true) : pendingAudio.current ? send(pendingAudio.current, ++generation.current) : undefined;
  };
  const toggle = () => { if (status.current === 'recording') void stop(); else if (status.current === 'starting') void cancel(); else void start(); };
  const actions = useRef({ toggle, cancel, stop, retry }); actions.current = { toggle, cancel, stop, retry };
  useEffect(() => {
    const unsubscribe = window.transcribe?.onToggle(() => actions.current.toggle());
    const unsubscribeAction = window.transcribe?.onRecordingAction(action => { if (action === 'finish') void actions.current.stop(); else if (action === 'retry') void actions.current.retry(); else void actions.current.cancel(); });
    return () => { unsubscribe?.(); unsubscribeAction?.(); void actions.current.cancel(); };
  }, []);
  const importFile = async (file: File) => {
    if (['starting', 'recording', 'processing'].includes(status.current)) return;
    if (!current.current.app?.hasKey) { current.current.onNeedsKey(); return; }
    if (file.size > 25_000_000) { fail('Escolha um arquivo de até 25 MB.'); return; }
    const id = ++generation.current; pendingSession.current = null;
    setSeconds(0); updatePhase('processing');
    try { const bytes = await file.arrayBuffer(); if (id === generation.current) await send({ bytes, name: file.name, duration: 0, source: 'file' }, id); }
    catch { if (id === generation.current) fail('Não foi possível ler este arquivo.'); }
  };
  return { phase, seconds, level, error, retryAvailable, toggle, cancel, importFile, retry };
}
