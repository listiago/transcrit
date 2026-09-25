# Contribuir com o Transcribe

Obrigado por ajudar a melhorar o aplicativo. A interface deve continuar simples, com o ditado acessível pelo minicard e pelo atalho global.

## Relatar um problema

Abra uma [Issue](https://github.com/listiago/transcrit/issues) com:

- versão do Transcribe, sistema operacional e arquitetura;
- passos para reproduzir, comportamento esperado e observado;
- mensagem de erro ou captura de tela, após remover informações pessoais.

Não publique chaves de API, áudios pessoais, transcrições, arquivos do perfil nem dados da sua conta. Vulnerabilidades devem seguir [SECURITY.md](SECURITY.md).

## Enviar uma alteração

1. Faça um fork e crie uma branch para sua alteração.
2. Siga o [guia de desenvolvimento](docs/DEVELOPMENT.md).
3. Execute `npm test` e `npm run build`. Para mudanças de gravação, foco, atalhos ou janelas, execute também os testes de integração aplicáveis em uma sessão gráfica.
4. Abra um pull request explicando o problema, a alteração, a validação e em quais sistemas você testou.

Evite incluir instaladores, arquivos de `test-results/` ou dados locais. Mantenha as dependências e o `package-lock.json` consistentes. As contribuições ao projeto são distribuídas sob a licença MIT do repositório.
