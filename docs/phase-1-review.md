# Entrega para revisão — fase 1

Data: 23/10/2026. Escopo: fundação e motion tracking. Implementação preparada; aprovação da fase depende da revisão do usuário, incluindo testes com webcam real.

## Resultado das verificações

| Verificação executada | Resultado |
| --- | --- |
| Instalação npm | 64 pacotes adicionados; auditoria da instalação: 0 vulnerabilidades |
| `npm run setup:tracking` | Modelo oficial baixado (5,8 MB) e WASM local preparado |
| `npm run typecheck` | Aprovado, código de saída 0 |
| `npm test` | 37 testes aprovados em 3 arquivos |
| `npm run build` | Aprovado, código de saída 0; `dist/` inclui modelo e WASM |
| `npm run dev` | Vite iniciou sem erros, pronto em 667 ms; servidor encerrado após as verificações |
| Revisão estática independente | Nenhum problema acionável encontrado na integração e descarte |
| Requisições HTTP locais | Não confirmadas: acesso inicial bloqueado por sandbox e tentativa autorizada atingiu timeout |
| Inspeção visual e console do navegador | Não realizada: abertura da origem local recusada pela política/permissão do navegador |
| Webcam física / pessoa real / desempenho | Não aferidos nesta sessão |

Os testes usam doubles explícitos para câmera, vídeo, modelo e relógio. A aplicação não apresenta esses dados como leituras reais.

## Arquivos criados

O diretório estava vazio e sem repositório Git. Não houve remoção de arquivos, criação de branch, commit ou push.

```text
.gitignore
README.md
docs/phase-1-review.md
package.json
package-lock.json
index.html
tsconfig.json
tsconfig.app.json
tsconfig.node.json
vite.config.ts
scripts/setup-tracking.mjs
public/favicon.svg
src/main.tsx
src/app/App.tsx
src/app/ErrorBoundary.tsx
src/app/styles.css
src/app/styles/global.css
src/app/styles/layout.css
src/app/styles/camera.css
src/app/styles/diagnostics.css
src/app/styles/responsive.css
src/components/ui/BodyGuide.tsx
src/components/ui/Brand.tsx
src/components/ui/StatusBadge.tsx
src/components/ui/Toggle.tsx
src/engine/motion/pose-processor.ts
src/engine/motion/pose-processor.test.ts
src/features/camera/camera.ts
src/features/camera/camera.test.ts
src/features/camera/CameraPanel.tsx
src/features/motion-tracking/pose-backend.ts
src/features/motion-tracking/tracking-session.ts
src/features/motion-tracking/tracking-session.test.ts
src/features/motion-tracking/use-motion-tracking.ts
src/features/motion-tracking/draw-pose.ts
src/features/motion-tracking/DiagnosticsPanel.tsx
src/stores/lab-store.ts
src/types/motion.ts
```

Também foram gerados `node_modules/`, `public/mediapipe/`, `dist/` e arquivos de cache TypeScript, todos ignorados pelo Git.

## Revisão manual pendente

Execute `npm run dev` e abra a URL informada pelo servidor. Dependências e modelo já estão preparados neste diretório. Em uma nova cópia, siga os passos de instalação do README.

- [ ] Página inicial sem erros relevantes no console; câmera ainda desligada.
- [ ] Iniciar câmera só solicita permissão após o clique; cancelar funciona durante a inicialização.
- [ ] Autorizar e visualizar vídeo com pontos/conexões alinhados aos braços e tronco.
- [ ] Movimentos naturais são acompanhados e os indicadores mostram dados reais.
- [ ] Espelhamento, esqueleto, guia, resolução e tela cheia funcionam.
- [ ] Perda do corpo/oclusão reduz visibilidade e não mantém um esqueleto antigo visível.
- [ ] Negação de permissão, câmera ocupada/ausente e desconexão mostram mensagens úteis.
- [ ] Desligar/ocultar/sair libera a webcam; nova sessão pode ser iniciada.
- [ ] Layout confortável em desktop e janela estreita (375 px); navegação por teclado funciona.
- [ ] Frequências efetivas são aceitáveis no hardware de destino, também em 480p/CPU.

## Limitações para a aprovação

A inferência é síncrona na thread principal, limitada a 24 Hz. Não há Worker nesta fase. As metas de 60 FPS e 20–30 inferências por segundo não são garantias. Profundidade e enquadramento são estimativas monoculares. A validação visual, o uso real da webcam e a ausência de erros no console precisam ser confirmados manualmente antes de considerar todos os critérios de aceite verificados.

Nenhuma funcionalidade da fase 2 foi iniciada. A próxima fase e qualquer commit dependem de autorização explícita.

Mensagem de commit sugerida: `feat: implement webcam pose tracking laboratory`.
