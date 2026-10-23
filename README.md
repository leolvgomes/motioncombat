# STEEL SYNC — Motion Combat

Laboratório de movimento para um futuro jogo web de combate robótico controlado pelo corpo. As **fases 1 e 2** implementam webcam, rastreamento corporal e um robô 3D procedural que acompanha braços e tronco. Também há uma demonstração do rig sem câmera. Calibração, reconhecimento de golpes e combate ainda não estão implementados.

## Stack

| Tecnologia | Responsabilidade |
| --- | --- |
| React 19 + TypeScript estrito | Interface e contratos entre módulos |
| Vite 8 | Servidor local, importação sob demanda e build estático |
| Tailwind CSS 4 + CSS | Integração pelo plugin Vite e identidade visual |
| MediaPipe Tasks Vision 1.1.1 | Pose Landmarker Lite, uma pessoa, modo VIDEO |
| Three.js 0.186 + React Three Fiber 9 | Cena WebGL, robô articulado e loop de renderização |
| Drei 10 | Grade de referência da plataforma de teste |
| Zustand 5 | Configurações, estado da sessão e diagnóstico reduzido |
| Lucide React | Ícones vetoriais locais |
| Vitest 5 | Filtros, câmera, conversão de pose, projeção e controle do rig |

Não há física, backend, upload, gravação de vídeo, analytics ou persistência de landmarks. A plataforma de teste 3D não implementa arena ou combate.

## Requisitos

- Node.js **22.12+ na linha 22, ou 24+ LTS**, npm e uma webcam.
- Navegador desktop atualizado com câmera, Canvas 2D, WebAssembly e **WebGL 2** para a cena. O tracking tenta GPU, com fallback para CPU; esse fallback não substitui a necessidade de WebGL 2 para desenhar o robô.
- Acesso à internet na instalação para o registro npm e o modelo oficial do Google. Depois da preparação, todos os recursos do rastreamento são servidos localmente.
- Câmera exige uma origem segura: `localhost`, `127.0.0.1` ou HTTPS. Um endereço HTTP na rede local geralmente não permite a webcam.

Ambiente de build/testes verificado: Windows, Node 24.14.0 e npm 11.9.0. O usuário confirmou o funcionamento do rastreamento dos braços na fase 1. O espelhamento 3D e seu desempenho precisam de validação visual no hardware/navegador do jogador.

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

## Como usar e revisar

1. Abra o laboratório. A câmera permanece desligada e as métricas aparecem como `—`.
2. Selecione HD 720p ou o modo leve 480p antes da conexão. São resoluções solicitadas; a câmera pode negociar outra resolução, mostrada no diagnóstico.
3. Clique **Iniciar câmera** e permita o acesso no navegador. Nenhum áudio é solicitado.
4. Aguarde o carregamento do motor e modelo. É possível cancelar a conexão em qualquer etapa.
5. Fique de frente para a webcam, com ombros, cotovelos e punhos visíveis. Comece aproximadamente a 1,5–2 m, ajustando a distância ao campo de visão da câmera. Quadris podem estar junto à borda inferior; a câmera não precisa ver as pernas.
6. Mova braços e tronco devagar. Compare vídeo, pontos e articulações do robô. Comece com movimentos laterais e flexões dos cotovelos; socos ainda não são interpretados como ataques.
7. Teste **Exibir esqueleto**, **Espelhar vídeo**, **Guia de enquadramento** e tela cheia (quando suportada). Vídeo, overlay e mapeamento do robô respeitam o mesmo modo de espelhamento. Com espelhamento ligado, o braço à esquerda da imagem move o braço à esquerda da vista frontal do robô.
8. Clique **Desligar câmera**. O indicador físico de uso da webcam deve apagar; imagem, pose e métricas são descartadas.
9. Selecione **Demonstração** no painel do robô. O rig levanta os braços, acena e inclina o tronco em uma sequência de 16 segundos. Esse modo desliga qualquer sessão de webcam e é identificado como movimento programado. **Pausar/Continuar** controla a demonstração.
10. Alterne **Frontal/Perspectiva** e experimente a qualidade **Leve** (DPR 1, sem sombras), ou **Equilibrada** (DPR até 1,5, sombras limitadas). O enquadramento se adapta à proporção do painel. Para voltar ao corpo, escolha **Seus movimentos** e inicie a câmera; o botão da câmera também seleciona essa fonte.

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
- Robô metálico original, com hierarquia de tronco, ombros, cotovelos, punhos, cabeça e pernas. Seis geometrias e oito materiais compartilhados entre aproximadamente 92 meshes; sem GLB, texturas ou fontes externas.
- Conversão de landmarks em quaternions locais, compensando a rotação do tronco, proporção do vídeo e espelhamento. Limites conservadores reduzem poses extremas e profundidade instável.
- Interpolação de rotações no loop 3D, retorno gradual ao repouso após perda de confiança e pernas com movimento de base independente da câmera.
- Demonstração sem landmarks fictícios, troca explícita de fonte, pausa, duas vistas e duas opções de qualidade. FPS da cena é medido separadamente do loop da câmera.
- Erro de renderização isolado do painel da câmera, fallback para WebGL indisponível e reabertura após perda de contexto gráfico.

## Arquitetura

```text
scripts/setup-tracking.mjs          # Prepara WASM e modelo local
src/
├── app/                           # Shell, estilos por área e error boundary
├── components/ui/                 # Marca, toggles, status e guia ilustrativo
├── features/
│   ├── camera/                     # Acesso à webcam e painel
│   ├── motion-tracking/            # MediaPipe, sessão, overlay e stream de pose
│   └── robot/                      # Modelo, recursos, enquadramento, cena e painel
├── engine/motion/                 # Filtros, retargeting, controlador do rig e testes
├── stores/                        # Configurações da câmera/robô e diagnóstico reduzido
└── types/                         # Contratos de landmarks e rotações do rig
public/mediapipe/                   # Recursos gerados, ignorados pelo Git
```

`PoseBackend` isola o MediaPipe. `TrackingSession` controla câmera, modelo e agendadores. `PoseProcessor` não conhece React, câmera ou o motor de inferência. `pose-stream` disponibiliza apenas a última amostra, sem uma fila nem assinaturas React por frame.

`retargetPose` converte essa amostra em `RigPose`; `RigController` seleciona a fonte, verifica sua idade e interpola quaternions reutilizados. O renderizador aplica as rotações diretamente aos grupos do `RobotRig`. Os segmentos dos braços apontam para -Y local; o robô olha para +Z e sua esquerda anatômica fica em +X. Ombros herdam tronco, cotovelos herdam ombros e punhos herdam cotovelos. O adaptador de grupos permite substituir o modelo por um GLB com esqueleto no futuro, ainda sem implementar lógica de combate.

### Frequências e processamento

- A inferência tem agendador próprio com teto de **24 Hz** e ignora o mesmo frame de vídeo decodificado. O intervalo inclui o tempo da inferência; não há fila de frames acumulados.
- O overlay é desenhado por `requestAnimationFrame` em Canvas. Landmarks são guardados em refs, sem renderizações React a cada frame.
- O diagnóstico é publicado aproximadamente a cada **250 ms**, independentemente do vídeo.
- Suavização exponencial usa constante temporal de **80 ms**, independente da taxa de captura. Confiança/visibilidade atuais não são atrasadas pelo filtro.
- Depois de **400 ms** de ausência, filtros antigos são reinicializados. Landmarks sem confiança não desenham conexões. Não há pose antiga mantida como se fosse uma detecção atual.
- `renderFps` mede a frequência do loop `requestAnimationFrame`, não FPS de uma cena 3D ou taxa da webcam. `inferenceMs` inclui detecção e processamento dos landmarks; não mede latência ponta a ponta.
- `sceneFps` mede os frames do renderizador 3D e é publicado a cada 500 ms. O controlador calcula novos alvos na frequência de captura; a demonstração é amostrada em até 24 Hz. O loop 3D aplica as rotações com referências e quaternions reutilizados, sem estado React por frame.
- O tracking é projetado principalmente no plano da câmera, corrigido pela proporção do vídeo. A profundidade mundial só acrescenta uma contribuição limitada; o tronco inclina até aproximadamente 20° e os cotovelos flexionam até 150°. Rotação fina dos punhos e giro axial dos ombros não são inferidos.
- A interpolação usa constante temporal de 55 ms para tracking válido e 200 ms no repouso/perda/visibilidade parcial. Dados com mais de 400 ms são ignorados. São filtros de acompanhamento, não uma máquina de estados de golpes.
- A cena 3D é um módulo separado; Three core, renderer e componentes são divididos em chunks. Não há pós-processamento, HDR externo, partículas ou física. Materiais/geometrias são reutilizados e liberados ao desmontar a cena.
- A preferência por movimento reduzido remove a oscilação decorativa das pernas e desacelera a demonstração. A resposta funcional ao corpo continua disponível.

### Testes e validação

Os testes unitários exercitam validação de landmarks, filtros em taxas diferentes, perdas individuais/globais, enquadramento, confiança, coordenadas mundiais, erros de câmera, descarte, cancelamento durante inicialização, reinícios concorrentes, desconexão, página oculta, timeout, frames repetidos e limites de agendamento. A fase 2 acrescenta testes de orientação por cinemática direta, espelhamento, proporção, profundidade, limites articulares, perda de sinal, interpolação independente de FPS, pausa e projeção da câmera. Streams, vídeo e relógio são doubles de teste; esses resultados não equivalem a um teste com webcam física.

A instalação, `typecheck`, testes e build foram executados com sucesso. O usuário confirmou o tracking da fase 1. Na fase 2, mesmo após autorização explícita para abrir a prévia, a política do navegador bloqueou a origem local por uma permissão salva. Aparência renderizada, correspondência corpo/robô, responsividade visual, console e desempenho 3D permanecem **pendentes de revisão manual**. A demonstração é identificada como programada e não preenche os indicadores da webcam com dados artificiais. Veja o [relatório da fase 2](docs/phase-2-review.md).

## Limitações atuais

- Fases 1 e 2: sem calibração, reconhecimento de golpes, animações próprias de ataque, controle de combate ou IA. A estranheza dos socos em direção à câmera pode persistir; não há medição monocular precisa de profundidade.
- A inferência `detectForVideo` é síncrona e ocorre na thread principal. O teto de frequência e o modelo Lite reduzem o custo, mas podem ocorrer pausas durante carregamento ou em CPUs fracas. Não há Worker implementado. O contrato do backend preserva uma fronteira para futura migração, que exigirá um protocolo assíncrono e transferência de frames.
- 60 FPS de exibição e 20–30 inferências/s são objetivos, não resultados garantidos ou comprovados nesta máquina.
- O filtro reduz tremores, adicionando atraso visual. Inferência usa uma única imagem monocular; profundidade e inclinação são aproximadas.
- Enquadramento é uma heurística relativa à largura dos ombros e à visibilidade; não mede distância em metros nem identifica iluminação ruim diretamente.
- Ocultação, baixa luz, roupas, campo de visão e múltiplas pessoas podem prejudicar a pose. O laboratório rastreia uma pessoa e não valida identidade.
- Resolução é uma preferência; dispositivos podem fornecer outra. A CPU de fallback pode reduzir a frequência efetiva.
- O modelo e as alternativas SIMD/não-SIMD WASM ampliam `dist/` (aproximadamente 47 MB sem compressão); cada navegador carrega apenas o runtime selecionado. O runtime 3D adiciona aproximadamente 0,94 MB de JavaScript minificado, dividido em chunks.
- O rig aproxima a silhueta e a flexão dos braços; não resolve colisões entre as partes do robô, não estima pegadas ou dedos, nem compensa completamente rotações fora do plano. Mantenha-se de frente para melhores resultados.
- Não há testes de ponta a ponta ou aferição visual do robô nesta entrega. Câmera/CPU e renderização compartilham a thread principal; use 480p e qualidade Leve se houver lentidão.

## Roadmap e autorização

1. **Fundação e motion tracking:** implementada; funcionamento dos braços confirmado pelo usuário.
2. **Robô 3D e espelhamento:** implementação atual, aguardando revisão visual do usuário.
3. **Motion engine e gestos:** calibração, velocidades, guarda e primeiros golpes.
4. **Animações híbridas:** máquina de estados e blending.
5. **Arena e combate:** adversário, hitboxes, dano e rounds.
6. **Polimento:** efeitos, som, acessibilidade e otimização.
7. **Expansões:** somente mediante autorização futura.

O desenvolvimento está interrompido ao final da fase 2. Nenhuma branch, commit ou push foi feito pelo agente. O repositório existente foi preservado. Sugestão de commit, após autorização: `feat: add articulated robot and body motion mirroring`.

## Referências técnicas

- [Pose Landmarker para Web — Google AI Edge](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [Vite — requisitos e execução](https://vite.dev/guide/)
- [Tailwind CSS — integração com Vite](https://tailwindcss.com/docs/installation/using-vite)
- [React Three Fiber — compatibilidade com React e instalação](https://r3f.docs.pmnd.rs/)
- [Three.js — quaternions e interpolação](https://threejs.org/docs/pages/Quaternion.html)
- [React Three Fiber — cuidados com desempenho](https://r3f.docs.pmnd.rs/advanced/pitfalls)

Código e modelo MediaPipe são recursos externos do Google; consulte a documentação e as licenças correspondentes antes de redistribuir uma versão pública.
