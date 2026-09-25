const MAX_AUDIO_BYTES = 25 * 1000 * 1000;
const MODEL = 'gpt-transcribe';
const DEFAULT_SETTINGS = { language: 'auto', autoPaste: true, keepHistory: true, microphoneId: '', shortcut: 'CommandOrControl+Shift+Space', launchAtLogin: false };
const LANGUAGES = ['auto', 'pt', 'en', 'es', 'fr', 'de', 'it', 'ja'];
const SHORTCUTS = ['CommandOrControl+Shift+Space', 'CommandOrControl+Alt+Space', 'Alt+Shift+D'];
const MIME_TYPES = { webm: 'audio/webm', wav: 'audio/wav', mp3: 'audio/mpeg', mp4: 'audio/mp4', m4a: 'audio/mp4', mpeg: 'audio/mpeg', mpga: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac' };

function validateAudio(input) {
  if (!input || !(input.bytes instanceof ArrayBuffer || ArrayBuffer.isView(input.bytes))) throw new Error('O áudio recebido é inválido.');
  const bytes = Buffer.from(input.bytes instanceof ArrayBuffer ? input.bytes : new Uint8Array(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength));
  if (bytes.length < 100) throw new Error('A gravação ficou muito curta. Tente falar por mais tempo.');
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error('O áudio deve ter até 25 MB. Escolha um arquivo menor.');
  const extension = String(input.name || 'gravacao.webm').split('.').pop().toLowerCase();
  if (!MIME_TYPES[extension]) throw new Error('Este formato não é compatível. Use MP3, M4A, WAV ou WebM.');
  return { bytes, name: `audio.${extension}`, mime: MIME_TYPES[extension], duration: Math.max(0, Math.min(Number(input.duration) || 0, 86400)), source: input.source === 'file' ? 'file' : 'mic' };
}
function validateSettings(input) {
  if (!input || typeof input !== 'object') throw new Error('Configurações inválidas.');
  const result = {};
  for (const key of ['autoPaste', 'keepHistory', 'launchAtLogin']) if (key in input) { if (typeof input[key] !== 'boolean') throw new Error('Configuração inválida.'); result[key] = input[key]; }
  if ('language' in input) { if (!LANGUAGES.includes(input.language)) throw new Error('Idioma inválido.'); result.language = input.language; }
  if ('shortcut' in input) { if (!SHORTCUTS.includes(input.shortcut)) throw new Error('Atalho inválido.'); result.shortcut = input.shortcut; }
  if ('microphoneId' in input) { if (typeof input.microphoneId !== 'string' || input.microphoneId.length > 256) throw new Error('Microfone inválido.'); result.microphoneId = input.microphoneId; }
  return result;
}
function apiError(status, data) {
  if (status === 401) return 'A chave OpenAI não foi aceita. Confira sua chave nas configurações.';
  if (status === 403) return 'Esta chave não tem permissão para transcrever áudio. Confira as permissões do projeto OpenAI.';
  if (status === 429) return data?.error?.code === 'insufficient_quota' ? 'Sua conta OpenAI está sem créditos disponíveis. Confira o saldo e o limite de uso.' : 'O limite de solicitações foi atingido. Aguarde um pouco e tente novamente.';
  if (status === 413) return 'O arquivo excede o tamanho permitido. Use um áudio menor.';
  if (status === 404) return 'O modelo de transcrição não está disponível para esta conta. Confira o acesso ao modelo na OpenAI.';
  if (status >= 500) return 'A OpenAI está temporariamente indisponível. Seu áudio pode ser enviado novamente.';
  return 'Não foi possível transcrever este áudio. Verifique se o arquivo contém uma gravação válida.';
}
function noSpeechError() {
  return Object.assign(new Error('Nenhuma fala foi identificada. Tente gravar novamente mais perto do microfone.'), { code: 'no_speech', retryable: false });
}
async function transcribeAudio(audio, key, settings, signal, fetcher = fetch, context = '', { allowEmpty = false } = {}) {
  const form = new FormData();
  form.append('file', new Blob([audio.bytes], { type: audio.mime }), audio.name);
  form.append('model', MODEL);
  form.append('response_format', 'json');
  if (settings.language !== 'auto') form.append('language', settings.language);
  if (context) form.append('prompt', context.slice(-1500));
  let response;
  try {
    response = await fetcher('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal });
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error(signal.reason?.name === 'TimeoutError' ? 'A transcrição demorou demais. Tente novamente.' : 'Transcrição cancelada.'), { code: signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled' });
    throw Object.assign(new Error('Sem conexão com a OpenAI. Confira sua internet e tente novamente.'), { code: 'network' });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(apiError(response.status, data)), { code: response.status === 429 && data?.error?.code === 'insufficient_quota' ? 'quota' : 'api_error', httpStatus: response.status });
  if (typeof data?.text !== 'string') throw Object.assign(new Error('A OpenAI retornou uma resposta incompleta. Tente novamente.'), { code: 'invalid_response' });
  if (!data.text.trim() && !allowEmpty) throw noSpeechError();
  return data.text.trim();
}
module.exports = { MAX_AUDIO_BYTES, MODEL, DEFAULT_SETTINGS, validateAudio, validateSettings, apiError, transcribeAudio, noSpeechError };
