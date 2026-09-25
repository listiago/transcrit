import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, AudioLines, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Copy, ExternalLink, FileAudio, FileText, Globe2, Keyboard, LoaderCircle, LockKeyhole, Mic, Minus, MoreHorizontal, Search, Settings2, ShieldCheck, Sparkles, Square, Trash2, Upload, Volume2, X } from 'lucide-react';
import type { AppState, Settings, Transcript, TranscriptionResult } from './types';
import { useRecorder } from './useRecorder';

const formatTime = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
const shortcutLabel = (shortcut: string, mac = false) => shortcut.replace('CommandOrControl', mac ? '⌘' : 'Ctrl').replace('Alt', mac ? '⌥' : 'Alt').replace('Shift', mac ? '⇧' : 'Shift').replace('Space', 'Espaço').split('+');
const dateLabel = (date: string) => new Date(date).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
function Keys({ shortcut = 'CommandOrControl+Shift+Space', mac = false }: { shortcut?: string; mac?: boolean }) { return <span className="keys">{shortcutLabel(shortcut, mac).map((key, index) => <kbd key={index}>{key}</kbd>)}</span>; }
function Logo({ small = false }: { small?: boolean }) { return <span className={`logo ${small ? 'small' : ''}`} aria-hidden="true"><i /><i /><i /><i /></span>; }
function Wave({ active, level = 0 }: { active: boolean; level?: number }) {
  return <div className={`wave ${active ? 'active' : ''}`} aria-hidden="true">{Array.from({ length: 49 }, (_, i) => {
    const shape = Math.sin((i / 48) * Math.PI) ** 1.4;
    const height = active ? 6 + shape * (18 + level * 82) * (0.35 + (Math.sin(i * 2.1) + 1) / 3) : 4 + shape * (9 + ((i * 17) % 31));
    return <span key={i} style={{ height, animationDelay: `${i * -0.043}s` }} />;
  })}</div>;
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) { return <button type="button" className={`toggle ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}><span /></button>; }

export function App() {
  const [app, setApp] = useState<AppState | null>(null);
  const [page, setPage] = useState('record');
  const [history, setHistory] = useState<Transcript[]>([]);
  const [text, setText] = useState('');
  const [latest, setLatest] = useState<Transcript | null>(null);
  const [toast, setToast] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bridge = window.transcribe;
  const mac = app?.platform === 'darwin';
  const flash = (message: string) => { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3800); };
  const refreshHistory = async () => { try { if (bridge) setHistory(await bridge.getHistory()); } catch (error) { setNotice((error as Error).message); } };
  const run = async (action: () => Promise<unknown>, message?: string) => { try { await action(); if (message) flash(message); } catch (error) { setNotice((error as Error).message); } };
  useEffect(() => {
    if (!bridge) return;
    void bridge.getState().then(value => { setApp(value); if (value.keyStatus === 'unreadable') setPage('settings'); if (value.warning) setNotice(value.warning); }).catch(error => setNotice(error.message));
    void refreshHistory();
    return bridge.onNavigate(value => { if (['record', 'history', 'settings'].includes(value)) setPage(value); });
  }, []);
  const onResult = (result: TranscriptionResult) => {
    setText(result.item.text); setLatest(result.item); setPage('record'); void refreshHistory();
    if (result.warning) setNotice(result.warning);
    else if (result.delivery === 'pasted') flash('Texto inserido no seu aplicativo.');
    else if (result.delivery === 'copied') flash(`Texto copiado. Use ${mac ? '⌘ V' : 'Ctrl + V'} para colar.`);
    else flash('Sua transcrição está pronta.');
  };
  const recorder = useRecorder(app, onResult, () => { setPage('settings'); flash('Adicione sua chave OpenAI para começar.'); });
  const busy = ['starting', 'recording', 'processing'].includes(recorder.phase);
  const isRecording = recorder.phase === 'recording';
  const settings = app?.settings;
  const updateSettings = async (patch: Partial<Settings>) => { if (bridge) setApp(await bridge.saveSettings(patch)); };
  const totalWords = history.reduce((sum, item) => sum + item.text.trim().split(/\s+/).length, 0);
  const totalMinutes = Math.floor(history.reduce((sum, item) => sum + item.duration, 0) / 60);
  const transcribeFile = (file?: File) => { if (file) { setPage('record'); void recorder.importFile(file); } };
  const remove = async () => { if (!bridge || !deleteId) return; await run(async () => { if (deleteId === 'all') await bridge.clearHistory(); else await bridge.deleteHistory(deleteId); await refreshHistory(); setDeleteId(null); }, 'Histórico atualizado.'); };

  return <div className="app-shell">
    <aside className={`sidebar ${mac ? 'mac' : ''}`}>
      <div className="brand"><Logo /><span>transcribe<span className="brand-dot">.</span></span></div>
      <div className="workspace-caption">SEU ESPAÇO DE VOZ</div>
      <nav aria-label="Navegação principal">
        <button className={page === 'record' ? 'nav-item selected' : 'nav-item'} onClick={() => setPage('record')}><AudioLines size={19} />Transcrever{isRecording && <span className="record-dot" />}</button>
        <button className={page === 'history' ? 'nav-item selected' : 'nav-item'} onClick={() => setPage('history')}><Clock3 size={18} />Histórico{history.length > 0 && <span className="nav-count">{history.length}</span>}</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="shortcut-note"><Keyboard size={19} /><p>Uma ideia? É só falar.</p><Keys shortcut={settings?.shortcut} mac={mac} /><span>Seu atalho, em qualquer app.</span></div>
        <button className={page === 'settings' ? 'nav-item selected' : 'nav-item'} onClick={() => setPage('settings')}><Settings2 size={18} />Configurações</button>
        <div className="local-label"><span /><span>Feito para o seu dia a dia</span></div>
      </div>
    </aside>

    <div className="main-shell">
      <header className="titlebar"><div className="breadcrumb">Seu espaço <ChevronRight size={12} /><span>{page === 'record' ? 'Transcrever' : page === 'history' ? 'Histórico' : 'Configurações'}</span></div><div className="titlebar-right"><span className="version">v{app?.version || '1.0.0'}</span>{!mac && <div className="window-controls"><button aria-label="Minimizar" onClick={() => bridge?.minimize()}><Minus size={15} /></button><button aria-label="Fechar para a bandeja" onClick={() => bridge?.close()}><X size={16} /></button></div>}</div></header>
      <main className={`main-content ${page === 'record' ? 'record-page' : ''}`}>
        {!bridge && <div className="notice">Prévia da interface. Abra o aplicativo Transcribe para gravar, configurar sua chave e usar o atalho global.</div>}
        {notice && <div className="notice" role="alert"><span>{notice}</span><button aria-label="Dispensar aviso" onClick={() => setNotice('')}><X size={16} /></button></div>}
        {page === 'record' && <>
          <div className="page-heading"><div><div className="eyebrow"><span /> MENOS TECLAS. MAIS IDEIAS.</div><h1>Sua voz, em palavras<span>.</span></h1><p>Fale naturalmente. O Transcribe cuida do resto.</p></div><span className={`status-pill ${isRecording ? 'live' : ''}`}><span />{isRecording ? 'Gravando' : recorder.phase === 'processing' ? 'Transcrevendo' : 'Pronto para ouvir'}</span></div>
          {app && !app.hasKey && <button className="setup-banner" onClick={() => setPage('settings')}><span className="setup-icon"><Sparkles size={18} /></span><span><strong>Falta só um detalhe para começar</strong><small>Conecte sua chave OpenAI. Leva menos de um minuto.</small></span><ArrowRight size={19} /></button>}
          <section className={`record-card ${isRecording ? 'is-recording' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); transcribeFile(event.dataTransfer.files[0]); }}>
            <div className="card-top"><div className="tiny-label"><span className={isRecording ? 'record-dot' : 'muted-dot'} />{isRecording ? 'OUVINDO VOCÊ' : recorder.phase === 'processing' ? 'TRANSFORMANDO EM TEXTO' : 'SEU PRÓXIMO TEXTO COMEÇA AQUI'}</div><span className="time">{formatTime(recorder.seconds)}</span></div>
            <div className="record-center"><Wave active={isRecording} level={recorder.level} /><h2>{isRecording ? 'Pode falar. Estamos ouvindo.' : recorder.phase === 'processing' ? 'Dando forma às suas palavras…' : recorder.phase === 'starting' ? 'Conectando ao microfone…' : 'Tire sua ideia da cabeça.'}</h2><p>{isRecording ? 'Enter para concluir. Esc para cancelar.' : recorder.phase === 'processing' ? 'Seu texto estará pronto em instantes.' : 'Uma mensagem, uma nota, o começo de algo bom.'}</p>
              <button className={`record-button ${isRecording ? 'stop' : ''}`} disabled={recorder.phase === 'processing' || recorder.phase === 'starting' || !bridge} onClick={recorder.toggle}>{recorder.phase === 'processing' || recorder.phase === 'starting' ? <LoaderCircle className="spin" size={19} /> : isRecording ? <Square size={16} fill="currentColor" /> : <Mic size={19} />}<span>{isRecording ? 'Terminar gravação' : recorder.phase === 'processing' ? 'Transcrevendo' : recorder.phase === 'starting' ? 'Preparando' : 'Começar a falar'}</span></button>
              <div className="record-hint">{busy ? <button onClick={recorder.cancel} className="text-button">Cancelar</button> : <>ou use <Keys shortcut={settings?.shortcut} mac={mac} /></>}</div>
            </div>
            <div className="card-footer"><button className="microphone-chip" onClick={() => setPage('settings')}><Mic size={13} /><span>{settings?.microphoneId ? 'Microfone selecionado' : 'Microfone padrão'}</span><ChevronDown size={12} /></button><span><Globe2 size={13} />{settings?.language === 'auto' || !settings ? 'Idioma automático' : ({ pt: 'Português', en: 'Inglês', es: 'Espanhol', fr: 'Francês', de: 'Alemão', it: 'Italiano', ja: 'Japonês' } as Record<string, string>)[settings.language]}</span></div>
            {dragging && <div className="drop-overlay"><Upload size={30} /><strong>Solte seu áudio aqui</strong><span>Até 25 MB</span></div>}
          </section>
          {recorder.error && <div className="record-error" role="alert"><span>{recorder.error}</span><div>{recorder.retryAvailable && <button className="text-button" onClick={() => void recorder.retry()}>Tentar novamente</button>}<button className="text-button" onClick={() => setPage('settings')}>Configurações</button></div></div>}
          <div className="import-row"><span>Já tem um áudio pronto?</span><button className="text-button" disabled={busy || !bridge} onClick={() => fileInput.current?.click()}><Upload size={14} />Importar arquivo<ArrowRight size={13} /></button><span className="formats">MP3, M4A, WAV e mais · até 25 MB</span></div>
          <input ref={fileInput} className="visually-hidden" type="file" accept=".mp3,.mp4,.m4a,.wav,.webm,.mpeg,.mpga,.ogg,.flac" aria-label="Importar arquivo de áudio" onChange={event => { transcribeFile(event.target.files?.[0]); event.target.value = ''; }} />

          {text ? <section className="result-card"><div className="section-heading"><h3><span className="success-icon"><Check size={13} /></span>Sua transcrição</h3><span>{latest && dateLabel(latest.createdAt)}</span></div><textarea aria-label="Texto transcrito" value={text} onChange={event => setText(event.target.value)} /><div className="result-footer"><span>{text.trim() ? text.trim().split(/\s+/).length : 0} palavras · edite à vontade</span><div><button className="icon-button" aria-label="Salvar texto" title="Salvar como .txt" onClick={() => void run(() => bridge!.exportText(text))}><ArrowDownToLine size={17} /></button><button className="secondary-button compact" onClick={() => void run(() => bridge!.copy(text), 'Texto copiado.')}><Copy size={14} />Copiar texto</button></div></div></section> : <section className="how-it-works"><div className="section-heading"><h3>Do pensamento ao texto.</h3><span>Em qualquer lugar.</span></div><div className="steps"><div><span className="step-number">01</span><div><strong>Ative com um atalho</strong><p>Continue no app que já usa.</p></div></div><div><span className="step-number">02</span><div><strong>Fale do seu jeito</strong><p>Sem ditar a pontuação.</p></div></div><div><span className="step-number">03</span><div><strong>Pronto. Texto inserido.</strong><p>Suas palavras, no lugar certo.</p></div></div></div></section>}
          <div className="privacy-footer"><ShieldCheck size={13} /><span>Durante o ditado, trechos de áudio são enviados à OpenAI. Sua chave fica protegida neste dispositivo.</span></div>
        </>}

        {page === 'history' && <>
          <div className="page-heading"><div><div className="eyebrow">SUAS PALAVRAS, SEMPRE POR PERTO</div><h1>Histórico<span>.</span></h1><p>Reencontre aquela ideia. Continue de onde parou.</p></div><button className="icon-button" disabled={!history.length} title="Limpar histórico" aria-label="Limpar histórico" onClick={() => setDeleteId('all')}><Trash2 size={18} /></button></div>
          <div className="stats"><div><span>Transcrições</span><strong>{history.length.toString().padStart(2, '0')}</strong></div><div><span>Palavras registradas</span><strong>{totalWords.toLocaleString('pt-BR')}</strong></div><div><span>Minutos de voz</span><strong>{totalMinutes}<small> min</small></strong></div></div>
          <label className="search-field"><Search size={17} /><input placeholder="Buscar nas suas palavras…" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="history-list">{history.filter(item => item.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => <article className="history-item" key={item.id}><div className="history-item-top"><span className="history-type">{item.source === 'mic' ? <Mic size={14} /> : <FileAudio size={14} />}{item.source === 'mic' ? 'Ditado' : 'Arquivo de áudio'}</span><span>{dateLabel(item.createdAt)}{item.duration > 0 && ` · ${formatTime(item.duration)}`}</span></div><button className="history-text" onClick={() => { setText(item.text); setLatest(item); setPage('record'); }}>{item.text}</button><div className="history-actions"><button className="text-button" onClick={() => void run(() => bridge!.copy(item.text), 'Texto copiado.')}><Copy size={13} />Copiar</button><button className="icon-button" aria-label="Excluir transcrição" onClick={() => setDeleteId(item.id)}><Trash2 size={14} /></button></div></article>)}</div>
          {!history.length && <div className="empty-state"><span><Clock3 size={28} /></span><h2>Ainda é uma página em branco.</h2><p>Suas transcrições aparecerão aqui.<br />Que tal começar pela primeira ideia?</p><button className="secondary-button" onClick={() => setPage('record')}>Criar uma transcrição<ArrowRight size={15} /></button></div>}
          {history.length > 0 && !history.some(item => item.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <div className="empty-state"><Search size={28} /><h2>Nenhuma palavra encontrada.</h2><p>Tente uma busca diferente.</p></div>}
          <div className="privacy-footer"><LockKeyhole size={13} />Últimas 100 transcrições, criptografadas neste computador.</div>
        </>}

        {page === 'settings' && <SettingsPage app={app} busy={busy} onState={setApp} onSave={updateSettings} flash={flash} onError={setNotice} />}
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    {deleteId && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><span className="modal-icon"><Trash2 size={23} /></span><h2 id="delete-title">{deleteId === 'all' ? 'Limpar seu histórico?' : 'Excluir esta transcrição?'}</h2><p>Esta ação remove o texto salvo neste computador e não pode ser desfeita.</p><div><button className="secondary-button" onClick={() => setDeleteId(null)} autoFocus>Cancelar</button><button className="danger-button" onClick={() => void remove()}>Excluir</button></div></div></div>}
  </div>;
}

function SettingsPage({ app, busy, onState, onSave, flash, onError }: { app: AppState | null; busy: boolean; onState: (state: AppState) => void; onSave: (patch: Partial<Settings>) => Promise<void>; flash: (message: string) => void; onError: (message: string) => void }) {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const bridge = window.transcribe;
  const settings = app?.settings;
  const action = async (fn: () => Promise<unknown>, message?: string) => { try { await fn(); if (message) flash(message); } catch (error) { onError((error as Error).message); } };
  useEffect(() => { void navigator.mediaDevices?.enumerateDevices().then(values => setDevices(values.filter(value => value.kind === 'audioinput'))).catch(() => {}); }, []);
  const refreshDevices = async () => {
    setLoadingDevices(true);
    await action(async () => {
      if (!await bridge?.microphonePermission()) throw new Error('Permita acesso ao microfone nas configurações do sistema.');
      const capture = await navigator.mediaDevices.getUserMedia({ audio: true });
      try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput')); }
      finally { capture.getTracks().forEach(track => track.stop()); }
    });
    setLoadingDevices(false);
  };
  const saveKey = async () => { if (!bridge) return; setSaving(true); await action(async () => { onState(await bridge.saveKey(key)); setKey(''); }, 'Chave salva com segurança. Tudo pronto para falar.'); setSaving(false); };
  const save = (patch: Partial<Settings>) => void action(() => onSave(patch));
  return <>
    <div className="page-heading"><div><div className="eyebrow">DO SEU JEITO</div><h1>Os detalhes, simples<span>.</span></h1><p>Configure uma vez. Depois, é só falar.</p></div></div>
    <section className="settings-card"><div className="settings-section-heading"><span className="settings-icon"><LockKeyhole size={19} /></span><div><h2>Conexão com a OpenAI</h2><p>Sua conta, sua chave. Você só paga pelo que usar.</p></div>{app?.keyStatus === 'ready' && <span className="connected"><Check size={12} />Chave salva</span>}</div>{app?.keyStatus === 'unreadable' && <div className="notice" role="alert">Não foi possível abrir a chave salva no cofre deste computador. Cole sua chave novamente abaixo e clique em Salvar chave.</div>}<label className="field-label" htmlFor="api-key">Chave de API</label><div className="key-input-row"><input id="api-key" type="password" autoComplete="off" spellCheck={false} placeholder={app?.keyStatus === 'ready' ? 'Uma chave já está protegida neste dispositivo' : 'sk-…'} value={key} onChange={event => setKey(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && key && !saving && !busy) void saveKey(); }} /><button className="primary-button" disabled={!key.trim() || saving || busy || !bridge} onClick={() => void saveKey()}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Salvar chave</button></div><div className="key-help"><span><ShieldCheck size={13} />Protegida pelo cofre do {app?.platform === 'darwin' ? 'macOS' : 'Windows'}.</span><button className="text-button" disabled={!bridge} onClick={() => void action(() => bridge!.openExternal('keys'))}>Obter minha chave<ExternalLink size={12} /></button></div>{app?.hasKey && <div className="connection-actions"><button className="text-button" disabled={testing || busy || app.keyStatus !== 'ready'} onClick={async () => { setTesting(true); await action(() => bridge!.testKey(), 'Conexão confirmada. Modelo disponível para sua conta.'); setTesting(false); }}>{testing && <LoaderCircle className="spin" size={12} />}{testing ? 'Verificando…' : 'Testar conexão'}</button><button className="text-button muted" disabled={busy} onClick={() => void action(async () => onState(await bridge!.removeKey()), 'Chave removida deste dispositivo.')}>Remover chave</button></div>}<div className="settings-footnote">É necessária uma chave com acesso à API de áudio e saldo na OpenAI. A assinatura do ChatGPT não inclui esse uso.<button className="text-button" disabled={!bridge} onClick={() => void action(() => bridge!.openExternal('billing'))}>Ver meu saldo<ExternalLink size={11} /></button></div></section>
    <section className="settings-card"><div className="settings-section-heading"><span className="settings-icon"><Mic size={19} /></span><div><h2>Voz e gravação</h2><p>Um bom ponto de partida para as suas ideias.</p></div></div><div className="setting-row"><div><strong>Microfone</strong><p>Escolha de onde vem a sua voz.</p></div><div className="device-controls"><select aria-label="Microfone" disabled={busy || !app} value={settings?.microphoneId || ''} onChange={event => save({ microphoneId: event.target.value })}><option value="">Padrão do sistema</option>{devices.filter(device => device.deviceId !== 'default' && device.deviceId !== 'communications' && device.deviceId).map((device, i) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Microfone ${i + 1}`}</option>)}</select><button className="icon-button" title="Atualizar microfones" aria-label="Atualizar microfones" disabled={busy || loadingDevices || !bridge} onClick={() => void refreshDevices()}>{loadingDevices ? <LoaderCircle className="spin" size={15} /> : <Volume2 size={16} />}</button></div></div><div className="setting-row"><div><strong>Idioma da fala</strong><p>Automático funciona com vários idiomas.</p></div><select aria-label="Idioma da fala" disabled={!app || busy} value={settings?.language || 'auto'} onChange={event => save({ language: event.target.value })}><option value="auto">Detectar automaticamente</option><option value="pt">Português</option><option value="en">Inglês</option><option value="es">Espanhol</option><option value="fr">Francês</option><option value="de">Alemão</option><option value="it">Italiano</option><option value="ja">Japonês</option></select></div><div className="setting-row"><div><strong>Atalho global</strong><p>Atalho para começar. Enter conclui e Esc cancela.</p></div><select aria-label="Atalho global" disabled={!app || busy} value={settings?.shortcut} onChange={event => save({ shortcut: event.target.value })}>{['CommandOrControl+Shift+Space', 'CommandOrControl+Alt+Space', 'Alt+Shift+D'].map(shortcut => <option value={shortcut} key={shortcut}>{shortcutLabel(shortcut, app?.platform === 'darwin').join(' + ')}</option>)}</select></div></section>
    <section className="settings-card preferences"><div className="setting-row"><div><strong>Inserir texto automaticamente</strong><p>Pelo atalho ou pela barra, insira no campo que está em foco.</p></div><Toggle label="Inserir texto automaticamente" checked={settings?.autoPaste ?? true} onChange={() => app && save({ autoPaste: !settings?.autoPaste })} /></div>{app?.platform === 'darwin' && <div className="mac-permission"><p>No macOS, a inserção precisa da permissão de Acessibilidade.</p><button className="text-button" onClick={() => void action(() => bridge!.accessibility())}>Permitir inserção<ExternalLink size={12} /></button></div>}<div className="setting-row"><div><strong>Guardar histórico neste dispositivo</strong><p>Salve até 100 transcrições. Desativar não apaga as anteriores.</p></div><Toggle label="Guardar histórico neste dispositivo" checked={settings?.keepHistory ?? true} onChange={() => app && save({ keepHistory: !settings?.keepHistory })} /></div><div className="setting-row"><div><strong>Abrir ao ligar o computador</strong><p>Disponível na bandeja, sempre que você precisar.</p></div><Toggle label="Abrir ao ligar o computador" checked={settings?.launchAtLogin ?? false} onChange={() => app && save({ launchAtLogin: !settings?.launchAtLogin })} /></div></section>
    <div className="settings-bottom"><Logo small /><span>Transcribe {app?.version || '1.0.0'}<small>Um pouco menos de teclado. Um pouco mais de você.</small></span><button className="text-button" disabled={!bridge} onClick={() => void action(() => bridge!.openExternal('microphone'))}><CircleHelp size={14} />Permissões do microfone</button></div>
  </>;
}
