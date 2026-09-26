# Desenvolvimento

## Ambiente

Use Node.js 24 e npm no Windows ou macOS. As versões resolvidas estão no `package-lock.json`.

```sh
npm ci
npm run dev
```

`npm run dev:web` mostra apenas a interface no navegador. Credenciais, microfone do aplicativo, atalhos e inserção dependem do Electron.

## Validação

```sh
npm test
npm run build
```

Os testes unitários verificam áudio PCM/WAV, silêncio, fila ordenada, contexto, repetição parcial, cancelamento, layout entre monitores, criptografia e captura temporária de Enter/Esc. Não usam uma chave real nem fazem chamadas à API.

Os testes de integração abaixo exigem uma sessão gráfica, usam atalhos reais e podem mover o mouse. Encerre outras instâncias do Transcribe antes de executá-los. Os testes de mouse e inserção nativa foram preparados para Windows.

```sh
node scripts/test-storage-persistence.mjs
npm run test:e2e
npm run test:reopen
npm run test:mouse
npm run test:startup
```

Eles usam perfis isolados, áudio sintético e API simulada. `test:e2e` verifica o fluxo de ditado, foco, teclas e recuperação de erros. `test:reopen` cobre fechar/reabrir e cancelamento durante a preparação. `test:mouse` usa cliques nativos e um aplicativo de destino em outro processo, sem o depurador da interface: são seis ciclos, incluindo reaberturas por atalho. `TRANSCRIBE_TEST_EXECUTABLE` permite apontar para um executável instalado. Resultados locais ficam em `test-results/`, ignorado pelo Git.

O teste **opcional** `node scripts/validate-live.mjs --synthetic-audio` usa a chave já salva e faz chamadas reais com áudio sintético no Windows. Ele gera cobrança na API. Não faz parte da validação padrão nem do GitHub Actions.

## Gerar instaladores

Execute em cada sistema correspondente:

```sh
# Windows x64
npm run dist:win -- --publish never

# macOS: Apple Silicon e Intel, DMG e ZIP
npm run dist:mac -- --publish never
```

Os arquivos ficam em `release/`. O Windows não gera pacotes macOS. Nenhum perfil, chave ou histórico local deve ser incluído no pacote; o conteúdo é definido por `build.files` no `package.json`.

O Windows é distribuído sem Authenticode. Os pacotes Mac recebem assinatura ad hoc para a integridade local do bundle, sem identidade Developer ID e sem notarização. Isso não elimina os avisos de segurança do sistema. Para uma futura distribuição assinada, configure certificados e credenciais nos secrets do CI, altere `build.win.signExecutable` e substitua `build.mac.identity`. Nunca adicione certificados ou senhas ao repositório.

## Publicar uma versão

O workflow `CI` valida testes e frontend em Windows e macOS em pushes e pull requests. O workflow `Build and release` compila instaladores nos respectivos sistemas, verifica o conteúdo dos pacotes e publica somente depois de ambos concluírem.

1. Atualize a versão em `package.json` e `package-lock.json`.
2. Adicione `docs/releases/v<VERSÃO>.md` com as notas e atualize os links do README.
3. Envie as alterações para `main`.
4. Execute **Actions → Build and release → Run workflow**, em `main`, com **Publish a GitHub Release** marcado. Alternativamente, envie uma tag `v<VERSÃO>` que corresponda à versão do pacote.

Sem a opção de publicar, a execução manual apenas gera artefatos. A publicação cria primeiro um rascunho, envia os cinco instaladores/arquivos e `SHA256SUMS.txt`, e só então torna a versão pública. Não substitua arquivos de uma versão já publicada: faça uma nova versão. O token de escrita fica restrito ao job de publicação.

## Arquitetura

| Arquivo | Responsabilidade |
| --- | --- |
| `electron/main.cjs` | Janelas, bandeja, atalhos, permissões e IPC |
| `electron/core.cjs` | Validação e chamadas à API de transcrição |
| `electron/preload.cjs` | Ponte mínima com isolamento de contexto e sandbox |
| `electron/store.cjs` | Chave e histórico criptografados, escrita atômica |
| `electron/native.cjs`, `electron/native/windows.ps1` | Campo de destino e colagem nativa |
| `electron/session-controls.cjs`, `electron/keyboard-guard.cjs` | Captura temporária de Enter/Esc e soltura de teclas |
| `src/useRecorder.ts`, `public/pcm-worklet.js`, `src/audio-segments.mjs` | PCM contínuo, segmentação WAV, medidor e cancelamento |
| `electron/dictation-session.cjs` | Fila sequencial e repetição só dos trechos pendentes |
| `src/App.tsx` | Configurações, transcrições e histórico |
| `src/Overlay.tsx`, `electron/overlay-window.cjs` | Minicard, estados e arraste sem tomar foco |

O modelo configurado é `gpt-transcribe`, no endpoint `https://api.openai.com/v1/audio/transcriptions`. Trechos com limite de 10 segundos são enviados durante o ditado, em sequência e com contexto recente. O card não exibe uma prévia; o texto completo é inserido uma vez no final. Não existe um servidor intermediário nem uma sessão Realtime.

No Windows, reabrir o card renova seu documento para evitar o estado de entrada do mouse que impedia cliques após ocultar/exibir uma janela transparente. A gravação continua na janela principal, e o card recupera o estado atual sem tomar foco.
