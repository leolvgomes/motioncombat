# STEEL SYNC — Motion Combat

Laboratório de movimento para um futuro jogo web de combate robótico controlado pelo corpo. A **fase 1** implementa captura da webcam, rastreamento corporal e diagnóstico em tempo real. Nenhum robô, golpe, calibração ou combate está implementado.

## Stack

| Tecnologia | Responsabilidade |
| --- | --- |
| React 19 + TypeScript estrito | Interface e contratos entre módulos |
| Vite 8 | Servidor local, importação sob demanda e build estático |
| Tailwind CSS 4 + CSS | Integração pelo plugin Vite e identidade visual |
| MediaPipe Tasks Vision 1.1.1 | Pose Landmarker Lite, uma pessoa, modo VIDEO |
| Zustand 5 | Configurações, estado da sessão e diagnóstico reduzido |
| Lucide React | Ícones vetoriais locais |
| Vitest 5 | Testes de filtros, enquadramento e ciclo da câmera |

Three.js, React Three Fiber, Drei e física ficam para fases posteriores. Não há backend, upload, gravação de vídeo, analytics ou persistência de landmarks.

## Requisitos

- Node.js **22.12+ na linha 22, ou 24+ LTS**, npm e uma webcam.
- Navegador desktop atualizado com câmera, Canvas 2D e WebAssembly. GPU/WebGL é tentado primeiro, com fallback para CPU.
- Acesso à internet na instalação para o registro npm e o modelo oficial do Google. Depois da preparação, todos os recursos do rastreamento são servidos localmente.
- Câmera exige uma origem segura: `localhost`, `127.0.0.1` ou HTTPS. Um endereço HTTP na rede local geralmente não permite a webcam.

Ambiente de build/testes verificado: Windows, Node 24.14.0 e npm 11.9.0. Compatibilidade de câmera e desempenho precisam de validação no hardware/navegador do jogador.

## Instalação e execução

Na pasta do projeto:

```sh
npm ci
npm run setup:tracking
npm run dev
```

Abra a URL exibida pelo Vite, normalmente **http://127.0.0.1:5173/**. Se a porta estiver ocupada, use a porta alternativa indicada no terminal. Não abra `index.html` diretamente.

`setup:tracking` copia os arquivos WASM da versão instalada do MediaPipe para `public/mediapipe/wasm/` e baixa o [Pose Landmarker Lite oficial](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task), aproximadamente 5,8 MB. Esses arquivos gerados e `node_modules` estão no `.gitignore`. O comando é reutilizável e preserva o modelo já baixado. Execute-o novamente após reinstalar/atualizar o MediaPipe. O primeiro uso não depende de CDN.

```sh
npm run typecheck   # Verificação TypeScript
npm test            # Todos os testes uma vez
npm run test:watch  # Testes em modo contínuo
npm run build       # Verificação TypeScript e produção em dist/
npm run preview     # Servir o build localmente
```

Execute `setup:tracking` **antes do build** para incluir o modelo e WASM em `dist/`. O build e a prévia são estáticos, sem backend.

## Como usar e revisar a fase 1

1. Abra o laboratório. A câmera permanece desligada e as métricas aparecem como `—`.
2. Selecione HD 720p ou o modo leve 480p antes da conexão. São resoluções solicitadas; a câmera pode negociar outra resolução, mostrada no diagnóstico.
3. Clique **Iniciar câmera** e permita o acesso no navegador. Nenhum áudio é solicitado.
4. Aguarde o carregamento do motor e modelo. É possível cancelar a conexão em qualquer etapa.
5. Fique de frente para a webcam, com ombros, cotovelos e punhos visíveis. Comece aproximadamente a 1,5–2 m, ajustando a distância ao campo de visão da câmera. Quadris podem estar junto à borda inferior; a câmera não precisa ver as pernas.
6. Mova os braços. Os pontos em ciano e os punhos em laranja devem acompanhar a imagem. Verifique os indicadores de confiança, visibilidade e enquadramento.
7. Teste **Exibir esqueleto**, **Espelhar vídeo**, **Guia de enquadramento** e tela cheia (quando suportada). Vídeo e overlay recebem o mesmo espelhamento e proporção.
8. Clique **Desligar câmera**. O indicador físico de uso da webcam deve apagar; imagem, pose e métricas são descartadas.

Também revise manualmente: negar a permissão; desconectar a câmera; fechar/ocultar a aba; cancelar durante o carregamento; iniciar novamente; sair do quadro e retornar; ocultar um braço; usar pouca luz; reduzir a largura da janela para 375 px. A câmera para ao ocultar a página e exige novo clique ao voltar, por privacidade e economia de recursos.

Se a permissão foi negada, libere-a nas configurações do site no navegador. Se a câmera estiver ocupada, feche o outro aplicativo. Se o modelo não carregar, execute `npm run setup:tracking`, reinicie o servidor e tente novamente.

## Funcionalidades implementadas

- Laboratório em português com interface industrial escura, detalhes em laranja/ciano e layout responsivo.
- Webcam apenas após interação, captura ideal 720p/30 FPS ou 480p/30 FPS, sem áudio.
- MediaPipe carregado sob demanda, uma pose, GPU com fallback para CPU, sem máscaras de segmentação.
- Overlay Canvas de nove referências prioritárias: nariz, dois ombros, dois cotovelos, dois punhos e dois quadris; oito conexões do tronco e braços.
- Validação de coordenadas, confiança e visibilidade; suavização temporal; reinicialização após perda prolongada; orientação básica de enquadramento.
- Estados separados para permissão, carregamento, início de vídeo, busca, detecção parcial, tracking e erro.
- Cancelamento seguro de operações assíncronas tardias; descarte de streams, listeners, timers e modelo ao interromper/sair/ocultar.
- Diagnóstico de frequência do loop de exibição, frequência de inferência, duração média de detecção, confiança e pontos visíveis. Valores são medidos; objetivos são identificados como alvos.
- Navegação por teclado, foco visível, link de salto, rótulos acessíveis, mensagens de status/erro e respeito a movimento reduzido.

## Arquitetura

```text
scripts/setup-tracking.mjs          # Prepara WASM e modelo local
src/
├── app/                           # Shell, estilos por área e error boundary
├── components/ui/                 # Marca, toggles, status e guia ilustrativo
├── features/
│   ├── camera/                     # Acesso à webcam e painel
│   └── motion-tracking/            # Backend MediaPipe, sessão, overlay e diagnóstico
├── engine/motion/                 # Processador puro de landmarks e testes
├── stores/                        # Configurações e diagnóstico Zustand
└── types/motion.ts                # Contratos de pose independentes do MediaPipe
public/mediapipe/                   # Recursos gerados, ignorados pelo Git
```

`PoseBackend` isola o MediaPipe. `TrackingSession` controla câmera, modelo e agendadores. `PoseProcessor` não conhece React, câmera ou o motor de inferência. `PoseFrame` e `ProcessedPose` preservam coordenadas normalizadas e mundiais para uma futura integração com o rig, sem antecipar lógica de animação/combate.

### Frequências e processamento

- A inferência tem agendador próprio com teto de **24 Hz** e ignora o mesmo frame de vídeo decodificado. O intervalo inclui o tempo da inferência; não há fila de frames acumulados.
- O overlay é desenhado por `requestAnimationFrame` em Canvas. Landmarks são guardados em refs, sem renderizações React a cada frame.
- O diagnóstico é publicado aproximadamente a cada **250 ms**, independentemente do vídeo.
- Suavização exponencial usa constante temporal de **80 ms**, independente da taxa de captura. Confiança/visibilidade atuais não são atrasadas pelo filtro.
- Depois de **400 ms** de ausência, filtros antigos são reinicializados. Landmarks sem confiança não desenham conexões. Não há pose antiga mantida como se fosse uma detecção atual.
- `renderFps` mede a frequência do loop `requestAnimationFrame`, não FPS de uma cena 3D ou taxa da webcam. `inferenceMs` inclui detecção e processamento dos landmarks; não mede latência ponta a ponta.

### Testes e validação

Os testes unitários exercitam validação de landmarks, filtros em taxas diferentes, perdas individuais/globais, enquadramento, confiança, coordenadas mundiais, erros de câmera, descarte, cancelamento durante inicialização, reinícios concorrentes, desconexão, página oculta, timeout, frames repetidos e limites de agendamento. Streams, vídeo e relógio são doubles de teste; esses resultados não equivalem a um teste com webcam física.

A instalação, `typecheck`, testes e build foram executados com sucesso. A abertura do navegador para QA foi bloqueada pela permissão da origem local nesta sessão. Portanto, rastreamento com pessoa real, alinhamento visual, responsividade renderizada, mensagens no console do navegador e desempenho em hardware real permanecem **pendentes de revisão manual**. Não há dados simulados na interface para substituir essa validação.

## Limitações atuais

- Apenas fase 1: sem robô 3D, calibração, reconhecimento de golpes, controle de combate ou IA.
- A inferência `detectForVideo` é síncrona e ocorre na thread principal. O teto de frequência e o modelo Lite reduzem o custo, mas podem ocorrer pausas durante carregamento ou em CPUs fracas. Não há Worker implementado. O contrato do backend preserva uma fronteira para futura migração, que exigirá um protocolo assíncrono e transferência de frames.
- 60 FPS de exibição e 20–30 inferências/s são objetivos, não resultados garantidos ou comprovados nesta máquina.
- O filtro reduz tremores, adicionando atraso visual. Inferência usa uma única imagem monocular; profundidade e inclinação são aproximadas.
- Enquadramento é uma heurística relativa à largura dos ombros e à visibilidade; não mede distância em metros nem identifica iluminação ruim diretamente.
- Ocultação, baixa luz, roupas, campo de visão e múltiplas pessoas podem prejudicar a pose. O laboratório rastreia uma pessoa e não valida identidade.
- Resolução é uma preferência; dispositivos podem fornecer outra. A CPU de fallback pode reduzir a frequência efetiva.
- O modelo e as alternativas SIMD/não-SIMD WASM ampliam `dist/` (aproximadamente 46 MB sem compressão); cada navegador carrega apenas o runtime selecionado.
- Não há testes de ponta a ponta ou aferição com câmera real nesta entrega.

## Roadmap e autorização

1. **Fundação e motion tracking:** implementação atual, aguardando revisão e validação manual.
2. **Robô 3D e espelhamento:** cena, robô procedural articulado e rig.
3. **Motion engine e gestos:** calibração, velocidades, guarda e primeiros golpes.
4. **Animações híbridas:** máquina de estados e blending.
5. **Arena e combate:** adversário, hitboxes, dano e rounds.
6. **Polimento:** efeitos, som, acessibilidade e otimização.
7. **Expansões:** somente mediante autorização futura.

O desenvolvimento está interrompido ao final da fase 1. Nenhum repositório/branch, commit ou push foi criado. Sugestão de commit, após autorização: `feat: implement webcam pose tracking laboratory`.

## Referências técnicas

- [Pose Landmarker para Web — Google AI Edge](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [Vite — requisitos e execução](https://vite.dev/guide/)
- [Tailwind CSS — integração com Vite](https://tailwindcss.com/docs/installation/using-vite)

Código e modelo MediaPipe são recursos externos do Google; consulte a documentação e as licenças correspondentes antes de redistribuir uma versão pública.
