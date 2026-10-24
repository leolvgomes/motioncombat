# STEEL SYNC — Motion Combat

Laboratório de movimento para um futuro jogo web de combate robótico controlado pelo corpo. As **fases 1 a 4** implementam webcam, rastreamento corporal, robô 3D procedural, calibração, reconhecimento inicial de gestos e animações híbridas de socos retos. Há demonstração do rig e dos ataques sem câmera. Arena, adversário e combate ainda não estão implementados.

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
| Vitest 5 | Filtros, câmera, rig, calibração, gestos, clips, transições e integração |

Não há física, backend, upload, gravação de vídeo, analytics ou persistência de landmarks. A plataforma de teste 3D não implementa arena ou combate.

## Requisitos

- Node.js **22.12+ na linha 22, ou 24+ LTS**, npm e uma webcam.
- Navegador desktop atualizado com câmera, Canvas 2D, WebAssembly e **WebGL 2** para a cena. O tracking tenta GPU, com fallback para CPU; esse fallback não substitui a necessidade de WebGL 2 para desenhar o robô.
- Acesso à internet na instalação para o registro npm e o modelo oficial do Google. Depois da preparação, todos os recursos do rastreamento são servidos localmente.
- Câmera exige uma origem segura: `localhost`, `127.0.0.1` ou HTTPS. Um endereço HTTP na rede local geralmente não permite a webcam.

Ambiente de build/testes verificado: Windows, Node 24.14.0 e npm 11.9.0. A captura fornecida pelo usuário identificou dificuldade em socos frontais; a fase 3 removeu a restrição artificial de profundidade do solver. A fase 4 acrescenta animações após o reconhecimento. Fluidez, gestos e resposta visual precisam de revisão com webcam no hardware do jogador.

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
6. Mova braços e tronco devagar. Compare vídeo, pontos e articulações do robô. Na vista **Perspectiva**, teste uma extensão à frente para observar a profundidade. Antes da calibração, o robô usa apenas espelhamento.
7. Teste **Exibir esqueleto**, **Espelhar vídeo**, **Guia de enquadramento** e tela cheia (quando suportada). Vídeo, overlay e mapeamento do robô respeitam o mesmo modo de espelhamento. Com espelhamento ligado, o braço à esquerda da imagem move o braço à esquerda da vista frontal do robô.
8. Clique **Desligar câmera**. O indicador físico de uso da webcam deve apagar; imagem, pose e métricas são descartadas.
9. Selecione **Demonstração** no painel do robô. Esse modo desliga qualquer sessão de webcam e é identificado como movimento programado. Em **Controle de animação → Rotina de demonstração**, escolha **Explorar articulações** (sequência de 16 segundos) ou **Sequência de socos** (guarda e golpes alternados). **Pausar/Continuar** congela/retoma a pose e o relógio da demonstração.
10. Alterne **Frontal/Perspectiva** e experimente a qualidade **Leve** (DPR 1, sem sombras), ou **Equilibrada** (DPR até 1,5, sombras limitadas). O enquadramento se adapta à proporção do painel. Para voltar ao corpo, escolha **Seus movimentos** e inicie a câmera; o botão da câmera também seleciona essa fonte.
11. Com a câmera ativa, no painel **Do movimento ao gesto**, clique em **Calibrar movimentos**. Relaxe os ombros e mantenha os punhos visíveis à frente da cintura por aproximadamente 1,5 s. Depois mantenha os dois punhos próximos ao rosto, com cotovelos flexionados, por aproximadamente 1,2 s. Perda de visibilidade ou movimentos excessivos reiniciam o tempo da etapa. É possível cancelar ou recalibrar.
12. Após a calibração, assuma a guarda, estenda um punho à frente de cada vez e retorne à guarda entre os socos. Observe o último gesto, as extensões e a confiança da profundidade **de cada braço**. Incline o tronco lateralmente para testar esquivas. Os nomes esquerdo/direito referem-se ao lado anatômico do jogador, independentemente do espelhamento da tela.
13. Se aparecer **Extensão 2D · soco indisponível**, o braço não tem profundidade suficientemente confiável. Guarda e inclinações podem continuar sendo analisadas, mas o sistema não inventa um soco frontal a partir de uma trajetória apenas lateral. Reenquadre-se e mantenha punhos/cotovelos visíveis. Toda nova sessão de câmera exige nova calibração.
14. Com **Animações de soco** habilitadas, cada soco reconhecido pode assumir temporariamente o braço correspondente do robô, com preparação, extensão e recolhimento. O braço oposto segue o corpo. O painel de animação informa o lado **do robô**; o painel de gestos informa o lado **do jogador**. O espelhamento pode trocar esses lados.
15. Ajuste **Duração do golpe** e **Amplitude** para o próximo soco, ou desative as animações para comparar com o espelhamento direto. Um golpe deve terminar antes do próximo: gestos recebidos durante ataque/retorno são descartados, sem fila ou combos. **Diagnóstico da transição** exibe o peso e a janela temporal; ela não calcula acerto ou dano.

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
- Vetores 3D mundiais completos para braços confiáveis, inclusive quando ombro, cotovelo e punho se sobrepõem na projeção 2D; alternativa planar para dados 3D rejeitados. A antiga limitação de profundidade foi removida.
- Interpolação de rotações no loop 3D, retorno gradual ao repouso após perda de confiança e pernas com movimento de base independente da câmera.
- Demonstração sem landmarks fictícios, troca explícita de fonte, pausa, duas vistas e duas opções de qualidade. FPS da cena é medido separadamente do loop da câmera.
- Erro de renderização isolado do painel da câmera, fallback para WebGL indisponível e reabertura após perda de contexto gráfico.
- Calibração guiada em duas etapas, com validação de confiança, proporções, estabilidade e postura; nenhuma detecção de gesto antes de concluir as duas etapas.
- Posições relativas ao tronco, velocidades normalizadas por largura dos ombros, ângulo do cotovelo, extensão do braço e disponibilidade de profundidade por cadeia.
- Reconhecimento heurístico de socos retos esquerdo/direito, guarda e inclinação lateral. Retração, velocidade, extensão, janela temporal, dois frames coerentes, cooldown e histerese limitam falsos positivos e repetição.
- Histórico limitado aos últimos seis gestos, sem persistência. Demo, calibração e câmera inativa não geram eventos de combate.
- Clips procedurais próprios de soco esquerdo/direito, com máscara do braço e pequena contribuição do tronco. O braço oposto e a cabeça continuam recebendo suas rotações do acompanhamento corporal.
- Máquina de estados visuais independente do reconhecimento: repouso, espelhamento, guarda, esquiva, socos e retorno após interrupção. Guarda e esquiva mantêm a pose corporal, sem clips adicionais.
- Entrada e saída graduais, retorno à pose atual, parâmetros fixados no início do golpe e janela técnica sincronizada com o tempo do clip. A perda da fonte, recalibração, troca de espelho/fonte ou desativação fecha imediatamente a janela e desfaz a animação suavemente.
- Comparação entre animação e espelhamento direto, parâmetros de duração/amplitude, demonstração de socos e diagnóstico de transição.

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
├── engine/
│   ├── motion/                    # Filtros, retargeting, calibração e velocidades
│   ├── gestures/                  # Reconhecimento geométrico e temporal, sem animação
│   └── animation/                 # Clips de soco e controlador de blending/estados
├── stores/                        # Configurações da câmera/robô/animação e diagnóstico
└── types/                         # Landmarks, rotações, gestos e contratos de clips
public/mediapipe/                   # Recursos gerados, ignorados pelo Git
```

`PoseBackend` isola o MediaPipe. `TrackingSession` controla câmera, modelo e agendadores. `PoseProcessor` não conhece React, câmera ou o motor de inferência. `pose-stream` disponibiliza apenas a última amostra, sem uma fila nem assinaturas React por frame.

`retargetPose` converte essa amostra em `RigPose`; `RigController` seleciona a fonte, verifica sua idade e interpola quaternions reutilizados. O renderizador aplica as rotações diretamente aos grupos do `RobotRig`. Os segmentos dos braços apontam para -Y local; o robô olha para +Z e sua esquerda anatômica fica em +X. Ombros herdam tronco, cotovelos herdam ombros e punhos herdam cotovelos. O adaptador de grupos permite substituir o modelo por um GLB com esqueleto no futuro, ainda sem implementar lógica de combate.

`MotionCalibrator` e `MotionFeatureExtractor` são módulos puros que recebem poses tipadas. `GestureEngine` recebe somente características normalizadas e contexto da calibração. `combat-motion-runtime` conecta esses módulos às amostras reais e publica snapshots para a interface; eventos semânticos são publicados imediatamente, enquanto métricas usam a cadência reduzida do diagnóstico.

`animation-signals` conserva somente o último pulso de soco, com sequência e geração da sessão. Eventos de postura não sobrescrevem esse pulso. `HybridAnimationController` recebe as rotações base do `RigController`, o contexto e o pulso; sua saída é aplicada ao rig no mesmo frame. Clips não conhecem MediaPipe, React ou regras de dano. A separação permite trocar o rig ou acrescentar hitboxes posteriormente.

Um ataque tem prioridade sobre guarda/esquiva e bloqueia novos ataques até terminar. Pulsos repetidos, anteriores à montagem da cena, com mais de 250 ms, sem calibração ou fonte válida não iniciam animação. Parar a câmera, recalibrar e trocar para demonstração invalidam a geração. Desativar a camada não enfileira golpes para quando ela for reativada.

### Frequências e processamento

- A inferência tem agendador próprio com teto de **24 Hz** e ignora o mesmo frame de vídeo decodificado. O intervalo inclui o tempo da inferência; não há fila de frames acumulados.
- O overlay é desenhado por `requestAnimationFrame` em Canvas. Landmarks são guardados em refs, sem renderizações React a cada frame.
- O diagnóstico é publicado aproximadamente a cada **250 ms**, independentemente do vídeo.
- Suavização exponencial usa constante temporal de **80 ms**, independente da taxa de captura. Confiança/visibilidade atuais não são atrasadas pelo filtro.
- Depois de **400 ms** de ausência, filtros antigos são reinicializados. Landmarks sem confiança não desenham conexões. Não há pose antiga mantida como se fosse uma detecção atual.
- `renderFps` mede a frequência do loop `requestAnimationFrame`, não FPS de uma cena 3D ou taxa da webcam. `inferenceMs` inclui detecção e processamento dos landmarks; não mede latência ponta a ponta.
- `sceneFps` mede os frames do renderizador 3D e é publicado a cada 500 ms. O controlador calcula novos alvos na frequência de captura; a demonstração é amostrada em até 24 Hz. O loop 3D aplica as rotações com referências e quaternions reutilizados, sem estado React por frame.
- O rig prioriza direções XYZ completas das coordenadas mundiais quando confiança e geometria são plausíveis. Proporções, comprimentos amplos e coerência da projeção rejeitam estimativas aberrantes. Se os dados forem rejeitados, a alternativa usa XY corrigido pela proporção do vídeo. O tronco inclina até aproximadamente 20° e os cotovelos flexionam até 150°. Rotação fina dos punhos não é inferida.
- A interpolação base usa constante temporal de 55 ms para cadeias visíveis e 200 ms no repouso/perda daquela cadeia. A perda de um braço não torna o outro braço lento. Dados com mais de 400 ms são ignorados. A camada de ataques atua depois desses filtros, sem atraso adicional entre a pose do clip e sua janela técnica.
- A cena 3D é um módulo separado; Three core, renderer e componentes são divididos em chunks. Não há pós-processamento, HDR externo, partículas ou física. Materiais/geometrias são reutilizados e liberados ao desmontar a cena.
- A preferência por movimento reduzido remove a oscilação decorativa das pernas e desacelera a demonstração. A resposta funcional ao corpo continua disponível.
- A qualidade inicial é Leve para reduzir o custo de sombras e resolução; Equilibrada continua disponível. A cena memoizada evita propagar atualizações do diagnóstico pela árvore 3D. Não foi medida uma melhora de FPS no dispositivo do jogador.
- Velocidade é calculada em unidades corporais por segundo, com suavização de 70 ms, validação de intervalo e reinicialização após ausência. A recuperação de profundidade inicia uma nova referência, sem inventar velocidade Z.
- Socos exigem profundidade confiável no próprio braço, retração anterior, extensão crescente e velocidade predominante para a frente. Intervalo entre socos do mesmo braço: 500 ms, com nova retração obrigatória. A janela aceita trajetórias de 60–350 ms; guarda usa permanência de 150 ms e esquiva de 100 ms, com limiares diferentes de entrada/saída.
- Um clip padrão dura **550 ms**, escalável de 0,75× a 1,35×. A máscara aumenta gradualmente até o impacto em 130 ms; a janela técnica vai de 130 ms (inclusivo) a 210 ms (exclusivo), escalada pela duração. O recolhimento leva o peso a zero sobre o tracking atual. Interrupções desfazem o peso em **180 ms** e fecham a janela imediatamente. Os tempos são editáveis em `combat-clips.ts`; não são estimativas da webcam.
- Keyframes e opções são preparados uma vez por ataque. O sampler, a saída do controlador e os quaternions são reutilizados no loop; a UI recebe snapshots a cada 125 ms e nas mudanças de estado/fase/janela, sem estado React por frame.

### Testes e validação

Os testes unitários exercitam validação de landmarks, filtros em taxas diferentes, perdas individuais/globais, enquadramento, confiança, coordenadas mundiais, erros de câmera, descarte, cancelamento durante inicialização, reinícios concorrentes, desconexão, página oculta, timeout, frames repetidos e limites de agendamento. A fase 2 acrescenta testes de orientação por cinemática direta, espelhamento, proporção, profundidade, limites articulares, perda de sinal, interpolação independente de FPS, pausa e projeção da câmera. Streams, vídeo e relógio são doubles de teste; esses resultados não equivalem a um teste com webcam física.

A verificação da fase 4 inclui a cadeia de landmarks sintéticos → calibração → velocidades → gesto → pulso → rig → animação, com um único ataque e retorno ao tracking atual. Também cobre cinemática dos clips, máscaras, espelhamento, prioridade, cancelamento, pausa, duração, amplitude, repetição, eventos antigos e enquadramento das duas vistas. As poses de teste nunca alimentam a câmera da aplicação. Os resultados executados estão no [relatório da fase 4](docs/phase-4-review.md).

A prévia automática continua indisponível por uma permissão salva/política do navegador que bloqueou a origem local anteriormente, inclusive após autorização do usuário. Nesta fase não houve nova tentativa de contornar esse bloqueio. A aparência das animações, a resposta com webcam e o desempenho permanecem **pendentes de revisão real**. A demonstração é identificada como programada e não preenche os indicadores da webcam com dados artificiais. O [relatório da fase 3](docs/phase-3-review.md) preserva o histórico da correção frontal.

## Limitações atuais

- Fases 1 a 4: sem hooks/uppercuts/combos, arena, hitboxes, dano, rounds ou IA. A janela técnica é apenas um marcador temporal; não representa colisão ou acerto. Não há múltiplos ataques simultâneos nem fila de golpes.
- A inferência `detectForVideo` é síncrona e ocorre na thread principal. O teto de frequência e o modelo Lite reduzem o custo, mas podem ocorrer pausas durante carregamento ou em CPUs fracas. Não há Worker implementado. O contrato do backend preserva uma fronteira para futura migração, que exigirá um protocolo assíncrono e transferência de frames.
- 60 FPS de exibição e 20–30 inferências/s são objetivos, não resultados garantidos ou comprovados nesta máquina.
- O filtro reduz tremores, adicionando atraso visual. Inferência usa uma única imagem monocular; profundidade e inclinação são aproximadas.
- Um punho à frente pode esconder o cotovelo. Sem confiança suficiente, o sistema não reconstrói esse braço à força; ele volta suavemente ao repouso até a detecção se recuperar. A correção do solver remove a restrição artificial, mas não resolve oclusão física nem garante precisão de profundidade.
- Alcances rápidos à frente podem compartilhar a geometria de um soco; heurísticas não inferem intenção. Limiares iniciais podem precisar de ajuste com pessoas, velocidades e câmeras diferentes. Confiança exibida é a menor confiança dos dados envolvidos, não uma probabilidade validada de acerto.
- Um falso positivo do reconhecimento também pode acionar o clip. A animação não reconstrói uma trajetória 3D ausente e não amplia a confiança do gesto. Com oclusão parcial, um ataque já aceito pode terminar enquanto a fonte geral continuar válida; perda global, cancelamento da sessão ou recalibração interrompem-no.
- Enquadramento é uma heurística relativa à largura dos ombros e à visibilidade; não mede distância em metros nem identifica iluminação ruim diretamente.
- Ocultação, baixa luz, roupas, campo de visão e múltiplas pessoas podem prejudicar a pose. O laboratório rastreia uma pessoa e não valida identidade.
- Resolução é uma preferência; dispositivos podem fornecer outra. A CPU de fallback pode reduzir a frequência efetiva.
- O modelo e as alternativas SIMD/não-SIMD WASM ampliam `dist/` (aproximadamente 47 MB sem compressão); cada navegador carrega apenas o runtime selecionado. O runtime 3D adiciona aproximadamente 0,94 MB de JavaScript minificado, dividido em chunks.
- O rig aproxima a silhueta e a flexão dos braços; não resolve colisões entre as partes do robô, não estima pegadas ou dedos, nem compensa completamente rotações fora do plano. Mantenha-se de frente para melhores resultados.
- Não há testes de ponta a ponta no navegador nem aferição real dos gestos nesta entrega. Câmera/CPU e renderização compartilham a thread principal; use 480p e qualidade Leve se houver lentidão.

## Roadmap e autorização

1. **Fundação e motion tracking:** implementada; funcionamento dos braços confirmado pelo usuário.
2. **Robô 3D e espelhamento:** implementada; aparência confirmada pelo usuário, limitação frontal tratada na fase 3.
3. **Motion engine e gestos:** implementada; calibração, guarda, esquivas, socos e correção frontal.
4. **Animações híbridas:** implementação atual para revisão; clips, máscaras e transições suaves.
5. **Arena e combate:** adversário, hitboxes, dano e rounds.
6. **Polimento:** efeitos, som, acessibilidade e otimização.
7. **Expansões:** somente mediante autorização futura.

O desenvolvimento está interrompido ao final da fase 4 para revisão. A fase 5 exige nova autorização. Nenhuma branch, commit ou push foi feito pelo agente. Sugestão de commit, após autorização: `feat: blend authored punches with live body tracking`.

## Referências técnicas

- [Pose Landmarker para Web — Google AI Edge](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [Vite — requisitos e execução](https://vite.dev/guide/)
- [Tailwind CSS — integração com Vite](https://tailwindcss.com/docs/installation/using-vite)
- [React Three Fiber — compatibilidade com React e instalação](https://r3f.docs.pmnd.rs/)
- [Three.js — quaternions e interpolação](https://threejs.org/docs/pages/Quaternion.html)
- [React Three Fiber — cuidados com desempenho](https://r3f.docs.pmnd.rs/advanced/pitfalls)

Código e modelo MediaPipe são recursos externos do Google; consulte a documentação e as licenças correspondentes antes de redistribuir uma versão pública.
