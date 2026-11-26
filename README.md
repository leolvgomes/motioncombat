# STEEL SYNC — Motion Combat

Jogo web de combate robótico controlado pelo corpo. As **fases 1 a 5** implementam webcam, rastreamento corporal, robôs 3D procedurais, calibração, gestos, animações híbridas e uma partida local contra IA, com arena, hitboxes, vida, defesa, rounds e resultado. A **fase 6** acrescenta polimento: faíscas e anéis de impacto, tremor de câmera, som procedural, narração para leitores de tela, atalhos de teclado e sugestão de qualidade por FPS. A **fase 7** acrescenta ganchos, uppercuts e combos, personalização do robô, três cenários, carreira com ranking local e replays de movimento. A **fase 8** trata desempenho e precisão: rastreamento em segundo plano, ritmo da cena conforme a GPU, filtro adaptativo e aferição guiada. A **fase 9** trata o impacto visual: desgaste e fumaça conforme a vida cai, reação diferente para cada golpe, queda no nocaute com câmera lenta, o golpe especial Sobrecarga e brilho cinematográfico opcional. A **fase 10** traz conteúdo para um jogador: quatro adversários com estilos próprios, três dificuldades, um circuito de quatro lutas, treino guiado e demonstrações sempre diferentes. O laboratório de movimento continua disponível; uma demonstração IA × IA permite observar o combate sem câmera.

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
| Web Audio API | Sons de combate sintetizados no navegador, sem arquivos de áudio |
| Vitest 5 | Câmera, rig, gestos, animações, geometria de contato, regras, efeitos, áudio e integração |

Não há motor de física, backend, upload, gravação de vídeo, analytics ou persistência automática de landmarks. A aferição guiada mantém posições de articulações na memória e só gera um arquivo se você clicar em baixar. O combate usa passos fixos e volumes geométricos simples; não necessita de Rapier. O `localStorage` do navegador guarda preferências, perfil do robô, histórico de partidas e até três replays com as rotações dos robôs. Nada é enviado.

## Requisitos

- Node.js **22.12+ na linha 22, ou 24+ LTS**, npm e uma webcam.
- Navegador desktop atualizado com câmera, Canvas 2D, WebAssembly e **WebGL 2** para a cena. O tracking tenta GPU, com fallback para CPU; esse fallback não substitui a necessidade de WebGL 2 para desenhar o robô.
- Acesso à internet na instalação para o registro npm e o modelo oficial do Google. Depois da preparação, todos os recursos do rastreamento são servidos localmente.
- Câmera exige uma origem segura: `localhost`, `127.0.0.1` ou HTTPS. Um endereço HTTP na rede local geralmente não permite a webcam.

Ambiente de build/testes: Windows, Node 24.14.0 e npm 11.9.0. A fase 3 removeu a restrição artificial de profundidade identificada pelo usuário; a fase 4 acrescentou clips próprios de soco. Fluidez, gestos, balanceamento e resposta visual do combate precisam de revisão no hardware do jogador.

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
npm run evaluate:trials -- arquivo.json  # Comparar variantes sobre uma aferição baixada
```

Execute `setup:tracking` **antes do build** para incluir o modelo e WASM em `dist/`. O build e a prévia são estáticos, sem backend.

## Jogar na arena

1. A aplicação abre na visão **Arena**, com câmera desligada. Para conhecer a partida sem webcam, escolha **Assistir demonstração**: os dois robôs são controlados pela IA, com fonte programada explicitamente identificada. Esse modo troca a fonte de movimento e interrompe a câmera.
2. Para jogar, clique **Iniciar câmera** no painel de captura e conclua a calibração de postura neutra/guarda no painel **Do movimento ao gesto**. O botão de combate fica disponível somente com câmera, calibração e pose atual válidas.
3. Inicie o combate e aguarde a contagem. Assuma a guarda, faça socos retos, ganchos ou uppercuts e retorne à guarda entre os golpes. Não há tecla ou botão para atacar. Guarda reduz o dano; inclinar o tronco desloca o robô para esquivar. A aproximação do adversário é automática.
4. Acompanhe vida, tempo e placar no HUD. O adversário sinaliza o tipo e o lado do golpe antes de atacar. Um soco precisa alcançar os volumes do corpo/cabeça durante a janela ativa; ataques fora de alcance não descontam vida.
5. A partida tem até três rounds de 45 segundos. Duas vitórias encerram antes do terceiro; nocaute encerra o round, e o tempo compara a vida restante. Empates são possíveis. A vida é restaurada no início de cada round; estatísticas acumulam na partida.
6. **Pausar**, sair do enquadramento, recalibrar, trocar o espelho, ocultar a página ou abrir o laboratório interrompe a partida. Ela requer **Retomar** após recuperar uma fonte válida; nenhum ataque antigo fica enfileirado. A página oculta também desliga a câmera, exigindo novo início e calibração.
7. Após o resultado, inicie outra partida ou volte à preparação. A demonstração utiliza as mesmas regras de contato, dano e rounds, com dois controladores programados.
8. Em **Som e efeitos**, abaixo da arena, ligue/desligue o som, ajuste o volume e escolha se quer faíscas de impacto e tremor de câmera. As preferências ficam salvas neste navegador. O áudio só começa após um clique (iniciar, retomar ou ligar o som), conforme a política dos navegadores.
9. Atalhos de teclado na arena: **P** pausa ou retoma; **M** liga ou desliga o som. Eles não funcionam enquanto o foco estiver em um campo, seletor ou controle deslizante, e não existe atalho de ataque.
10. Se a arena ficar abaixo de 42 FPS por alguns segundos na qualidade Equilibrada, aparece uma sugestão para usar a qualidade Leve. A troca nunca é automática.

11. Conecte golpes na ordem certa, com até 1,5 s entre eles, para completar combos com dano extra. A lista está em **Carreira**. Bloqueio, esquiva, erro, pausa ou levar um golpe quebram a sequência.
12. Em **Garagem**, escolha nome, blindagem, luzes, cabeça, ombreiras e cenário. São mudanças visuais: alcance, dano e áreas de contato não mudam. O cenário também pode ser trocado abaixo da arena.
13. Ao fim de uma partida, use **Ver replay** ou abra **Carreira**. O replay tem pausa (**P**), linha do tempo e velocidades de 0,25× a 2×. Uma partida em andamento ou pausada nunca é interrompida por um replay.
14. **Carreira** mostra estatísticas, ranking das 10 melhores partidas e replays. Somente partidas com webcam entram nas estatísticas; as demonstrações geram apenas replays.
15. Abaixo da arena, escolha o tipo de luta. **Luta rápida**: escolha um dos quatro adversários (KESTREL-3, BASALTO-9, MAGNA-X e VULCAN-07) e a dificuldade. **Circuito**: quatro lutas em sequência até o campeão; vitória avança, empate repete a luta e derrota encerra o circuito. **Treino guiado**: um robô de treino que só ataca nas etapas de defesa; cada etapa avança quando a câmera reconhece o golpe ou a defesa, e uma etapa sem reconhecimento por 35 s é pulada sozinha. O treino não tem relógio, não tira integridade e não entra na carreira.
16. A dificuldade muda o aviso antes de cada golpe, as pausas e as sequências do adversário e o dano que ele causa. Fácil vale menos pontos no ranking; Difícil vale mais.

A arena, o laboratório e a garagem alternam a cena 3D; somente um canvas 3D fica montado. Captura e calibração continuam montadas ao trocar de visão. Os ajustes de duração/amplitude do laboratório não alteram as regras balanceadas da partida.

## Laboratório e revisão do tracking

1. Selecione **Laboratório**. A câmera permanece desligada até sua interação, e métricas indisponíveis aparecem como `—`.
2. Selecione HD 720p ou o modo leve 480p antes da conexão. São resoluções solicitadas; a câmera pode negociar outra resolução, mostrada no diagnóstico.
3. Clique **Iniciar câmera** e permita o acesso no navegador. Nenhum áudio é solicitado.
4. Aguarde o carregamento do motor e modelo. É possível cancelar a conexão em qualquer etapa.
5. Fique de frente para a webcam, com ombros, cotovelos e punhos visíveis. Comece aproximadamente a 1,5–2 m, ajustando a distância ao campo de visão da câmera. Quadris podem estar junto à borda inferior; a câmera não precisa ver as pernas.
6. Mova braços e tronco devagar. Compare vídeo, pontos e articulações do robô. Na vista **Perspectiva**, teste uma extensão à frente para observar a profundidade. Antes da calibração, o robô usa apenas espelhamento.
7. Teste **Exibir esqueleto**, **Espelhar vídeo**, **Guia de enquadramento** e tela cheia (quando suportada). Vídeo, overlay e mapeamento do robô respeitam o mesmo modo de espelhamento. Com espelhamento ligado, o braço à esquerda da imagem move o braço à esquerda da vista frontal do robô.
8. Clique **Desligar câmera**. O indicador físico de uso da webcam deve apagar; imagem, pose e métricas são descartadas.
9. Selecione **Demonstração** no painel do robô. Esse modo desliga qualquer sessão de webcam e é identificado como movimento programado. Em **Controle de animação → Rotina de demonstração**, escolha **Explorar articulações** (sequência de 16 segundos) ou **Sequência de golpes** (socos, ganchos e uppercuts alternados). **Pausar/Continuar** congela/retoma a pose e o relógio da demonstração.
10. Alterne **Frontal/Perspectiva** e experimente a qualidade **Leve** (DPR 1, sem sombras), ou **Equilibrada** (DPR até 1,5, sombras limitadas). O enquadramento se adapta à proporção do painel. Para voltar ao corpo, escolha **Seus movimentos** e inicie a câmera; o botão da câmera também seleciona essa fonte.
11. Com a câmera ativa, no painel **Do movimento ao gesto**, clique em **Calibrar movimentos**. Relaxe os ombros e mantenha os punhos visíveis à frente da cintura por aproximadamente 1,5 s. Depois mantenha os dois punhos próximos ao rosto, com cotovelos flexionados, por aproximadamente 1,2 s. Perda de visibilidade ou movimentos excessivos reiniciam o tempo da etapa. É possível cancelar ou recalibrar.
12. Após a calibração, assuma a guarda, estenda um punho à frente de cada vez e retorne à guarda entre os socos. Observe o último gesto e o alcance **de cada braço**: um soco conta a partir de 80%. Incline o tronco lateralmente para testar esquivas. Os nomes esquerdo/direito referem-se ao lado anatômico do jogador, independentemente do espelhamento da tela.
13. Para um **gancho**, abra o punho além do ombro e cruze até o centro, na altura do peito ao rosto, com o cotovelo dobrado. Para um **uppercut**, desça o punho abaixo da linha dos ombros e suba com o cotovelo dobrado. A outra mão fica parada na guarda. Se notar golpes indevidos, desative **Ganchos e uppercuts**. Toda nova sessão de câmera exige nova calibração.
14. Com **Animações de golpe** habilitadas, cada golpe reconhecido pode assumir temporariamente o braço correspondente do robô, com preparação, extensão e recolhimento. O braço oposto segue o corpo. O painel de animação informa o lado **do robô**; o painel de gestos informa o lado **do jogador**. O espelhamento pode trocar esses lados.
15. Ajuste **Duração do golpe** e **Amplitude** para o próximo soco, ou desative as animações para comparar com o espelhamento direto. Um golpe deve terminar antes do próximo: gestos recebidos durante ataque/retorno são descartados, sem fila. **Diagnóstico da transição** exibe o peso e a janela temporal; ela não calcula acerto ou dano.

16. Em **Aferição guiada**, com câmera e calibração prontas, siga os avisos na tela. Ao final, veja acertos, golpes perdidos, confusões e golpes indevidos. O arquivo pode ser baixado para ajustar os limiares com movimentos reais.
17. Em **Desempenho**, ao lado do diagnóstico, use **Medir por 15 s** na arena e no laboratório. O painel mostra a GPU usada pelo navegador e avisa quando ela é integrada.

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
- Reconhecimento heurístico de socos retos esquerdo/direito, guarda e inclinação lateral. O alcance do soco é reconstruído pelo encurtamento do braço na imagem e pelos comprimentos calibrados, sem exigir profundidade; retração, janela temporal, cooldown e histerese limitam falsos positivos e repetição.
- Histórico limitado aos últimos seis gestos, sem persistência. Demo, calibração e câmera inativa não geram eventos de combate.
- Clips procedurais próprios de soco esquerdo/direito, com máscara do braço e pequena contribuição do tronco. O braço oposto e a cabeça continuam recebendo suas rotações do acompanhamento corporal.
- Máquina de estados visuais independente do reconhecimento: repouso, espelhamento, guarda, esquiva, socos e retorno após interrupção. Guarda e esquiva mantêm a pose corporal, sem clips adicionais.
- Entrada e saída graduais, retorno à pose atual, parâmetros fixados no início do golpe e janela técnica sincronizada com o tempo do clip. A perda da fonte, recalibração, troca de espelho/fonte ou desativação fecha imediatamente a janela e desfaz a animação suavemente.
- Comparação entre animação e espelhamento direto, parâmetros de duração/amplitude, demonstração de socos e diagnóstico de transição.
- Arena industrial original com dois robôs: ATLAS-01 (ciano) e VULCAN-07 (cobre/laranja), câmera responsiva e qualidade Leve/Equilibrada.
- Adversário com máquina de estados: aproximação, espera, guarda, preparação visível, ataque, recuo e reação a dano. O HUD avisa a preparação e o lado do soco antes da extensão.
- Contato geométrico dos punhos com corpo/cabeça, uma resolução por ataque, guarda com dano reduzido e esquiva lateral.
- Vida, atordoamento breve, contagem inicial, rounds por nocaute/tempo, placar, vitória/derrota/empate e estatísticas da partida.
- Transição de 350 ms da pose atual para vitória/derrota. Após encerrar a partida, somente essa finalização visual avança; placar, dano, IA e relógio permanecem congelados.
- Pausa persistente na perda de tracking ou troca de visão, recuperação explícita e descarte de ataques durante pausa/contagem.
- Demonstração IA × IA identificada, sem fabricar landmarks ou indicadores de câmera.
- Eventos de apresentação emitidos pelo motor (contagem, início de round, golpe, preparação, contato com posição, fim de round e de partida). Som, efeitos e narração consomem esses eventos; nenhum deles altera regras.
- Faíscas no ponto real de contato, com cores distintas para acerto e bloqueio, anel de impacto voltado para a câmera e ênfase no nocaute. Esquivas e golpes fora de alcance não geram faíscas.
- Tremor de câmera proporcional ao impacto, mais forte quando o jogador é atingido. Pausa congela faíscas e tremor junto com a cena.
- Sons sintetizados para contagem, início, deslocamento do soco, acerto, bloqueio, esquiva, nocaute, sino de round, vitória, derrota e empate; aviso sonoro da preparação do adversário somente na partida com webcam. Leve diferença de timbre entre os robôs e limite de vozes simultâneas.
- Narração em região `aria-live` para início de rounds, contatos com integridade restante, fim de round e resultado. O aviso visual de impacto deixou de ser anunciado em duplicidade.
- Integridade crítica (≤ 25) destacada também por texto, não apenas por cor; o medidor informa o valor em texto acessível.
- Respeito a movimento reduzido: tremor desligado e faíscas reduzidas pela metade, com aviso no painel.
- Ganchos e uppercuts opcionais, reconhecidos pela trajetória do punho, com exigência de velocidade, cotovelo dobrado e outra mão parada e erguida. Clips próprios, dano, duração e avanço diferentes do soco reto.
- Seis combos com bônus de dano, contador de acertos seguidos, aviso visual, som e narração. A IA usa todos os golpes, sempre anunciados, encadeia ataques e se protege após contatos repetidos.
- Garagem com prévia 3D: nome, seis blindagens, seis luzes, três cabeças e três ombreiras. As cores são aplicadas aos materiais existentes, sem recriar geometria.
- Três cenários originais: Fundição, Porto noturno e Cânion, com luzes, cores e objetos próprios e o mesmo ringue.
- Carreira local: até 200 partidas com webcam, estatísticas, pontuação e ranking das 10 melhores.
- Rastreamento em Worker ou na página. A escolha automática usa o Worker em GPU dedicada e a página em GPU integrada; se o Worker falhar ao iniciar, a página assume.
- Modelo aquecido durante o carregamento, para a compilação de shaders não travar os primeiros segundos.
- Limite de quadros da cena e redução automática quando a pose chega atrasada no modo em segundo plano.
- Filtro adaptativo: movimentos rápidos e contínuos têm menos atraso; tremor e detecções isoladas fora do lugar mantêm o filtro completo.
- Aferição guiada, medição de desempenho de 15 s, identificação da GPU e avaliação offline de variantes sobre a mesma gravação.
- Replays a partir das rotações dos robôs, com linha do tempo, velocidade, sons, efeitos e narração. Os três mais recentes ficam salvos; demonstrações saem primeiro.

## Arquitetura

```text
scripts/setup-tracking.mjs          # Prepara WASM e modelo local
src/
├── app/                           # Shell, estilos por área e error boundary
├── components/ui/                 # Marca, toggles, status e guia ilustrativo
├── features/
│   ├── camera/                     # Acesso à webcam e painel
│   ├── motion-tracking/            # MediaPipe, sessão, overlay e stream de pose
│   ├── robot/                      # Modelo, recursos e laboratório do rig
│   ├── arena/                      # Cena do ringue, dois rigs, câmera e efeitos de impacto
│   ├── customization/              # Catálogo visual, garagem e prévia 3D
│   ├── career/                     # Estatísticas, ranking, replays e lista de combos
│   ├── replay/                     # Controles de reprodução
│   ├── trials/                     # Aferição guiada e medição de desempenho
│   ├── audio/                      # Sintetizador Web Audio e mapeamento evento → som
│   └── combat/                     # Ponte de captura/partida, HUD, controles, narração e sugestão de qualidade
├── engine/
│   ├── motion/                    # Filtros, retargeting, calibração e velocidades
│   ├── gestures/                  # Reconhecimento geométrico e temporal, sem animação
│   ├── animation/                 # Clips de golpe e controlador de blending/estados
│   ├── combat/                    # Simulação, IA, combos, geometria de contato e eventos
│   ├── career/                    # Registro, pontuação, ranking e validação do histórico
│   ├── replay/                    # Gravação, reprodução e formato salvo
│   └── effects/                   # Partículas, anéis e tremor de câmera, sem Three.js
├── stores/                        # Configurações, perfil, carreira, replays e snapshots da UI
└── types/                         # Landmarks, rig, clips e contratos de combate
public/mediapipe/                   # Recursos gerados, ignorados pelo Git
```

`PoseBackend` isola o MediaPipe. `TrackingSession` controla câmera, modelo e agendadores. `PoseProcessor` não conhece React, câmera ou o motor de inferência. `pose-stream` disponibiliza apenas a última amostra, sem uma fila nem assinaturas React por frame.

`retargetPose` converte essa amostra em `RigPose`; `RigController` seleciona a fonte, verifica sua idade e interpola quaternions reutilizados. O renderizador aplica as rotações diretamente aos grupos do `RobotRig`. Os segmentos dos braços apontam para -Y local; o robô olha para +Z e sua esquerda anatômica fica em +X. Ombros herdam tronco, cotovelos herdam ombros e punhos herdam cotovelos. O adaptador de grupos permite substituir o modelo por um GLB com esqueleto no futuro.

`MotionCalibrator` e `MotionFeatureExtractor` são módulos puros que recebem poses tipadas. `GestureEngine` recebe somente características normalizadas e contexto da calibração. `combat-motion-runtime` conecta esses módulos às amostras reais e publica snapshots para a interface; eventos semânticos são publicados imediatamente, enquanto métricas usam a cadência reduzida do diagnóstico.

`animation-signals` conserva somente o último pulso de ataque, com sequência e geração da sessão. Eventos de postura não sobrescrevem esse pulso. No laboratório, `HybridAnimationController` recebe rotações base, contexto e pulso; sua saída é aplicada ao rig no mesmo frame. Clips não conhecem MediaPipe, React ou regras de dano.

Um ataque tem prioridade sobre guarda/esquiva e bloqueia novos ataques até terminar. Pulsos repetidos, anteriores à montagem da cena, com mais de 250 ms, sem calibração ou fonte válida não iniciam animação. Parar a câmera, recalibrar e trocar para demonstração invalidam a geração. Desativar a camada não enfileira golpes para quando ela for reativada.

Na arena, `MatchRuntime` recebe a captura real, verifica a fonte e entrega `CombatInput` ao `CombatEngine`. O motor controla o tempo dos clips, IA, contato, vida e rounds. `FighterFrame` contém as mesmas transformações usadas para calcular os contatos e desenhar os robôs. `ArenaCanvas` não decide dano; o HUD recebe somente cópias dos snapshots, sem transformar a simulação em estado React.

O `CombatEngine` acumula eventos de apresentação em uma fila limitada a 64 itens; `MatchRuntime.subscribe` os entrega, em ordem, após cada passo. Uma falha em um ouvinte é registrada e não interrompe a simulação. Os módulos de `engine/effects` são puros e testáveis; `ArenaCanvas` apenas os desenha com um `InstancedMesh` de 64 faíscas (uma chamada de desenho) e quatro anéis reaproveitados. `CombatAudio` cria o `AudioContext` somente em um gesto do usuário e o suspende ao ocultar a página ou sair da arena.

`ReplayRecorder` amostra o estado da partida a cada 1/24 s, sem tempo de pausa ou contagem, em inteiros de 16 bits. `ReplayPlayer` interpola esses quadros e expõe os mesmos `fighters` e `snapshot` de uma partida; por isso arena, HUD, som e efeitos não sabem a diferença. `MatchRuntime` alterna entre a simulação e o replay, e nunca grava carreira ou replay durante a reprodução. Dados salvos são validados campo a campo; entradas inválidas são descartadas.

`pose-backend` escolhe onde a inferência roda. `worker-backend` envia um quadro reduzido por vez, com tempo limite, e nunca enfileira. `FrameLimiter` conduz os canvases sob demanda, e `FramePacer` reduz ou devolve quadros conforme o atraso medido. `TrialRunner` conduz o roteiro da aferição; `evaluateRecording` reprocessa a gravação pela cadeia real de filtros e gestos, sem câmera.

### Frequências e processamento

- A inferência tem agendador próprio, com teto de **24 Hz** na página e cerca de **30 Hz** no Worker, e ignora o mesmo frame de vídeo decodificado. Só há um frame em análise por vez; não há fila.
- O overlay é desenhado por `requestAnimationFrame` em Canvas. Landmarks são guardados em refs, sem renderizações React a cada frame.
- O diagnóstico é publicado aproximadamente a cada **250 ms**, independentemente do vídeo.
- A suavização usa constante temporal de **80 ms**, que cai até **28 ms** quando dois deslocamentos seguidos concordam em direção e velocidade. Confiança/visibilidade atuais não são atrasadas pelo filtro.
- Depois de **400 ms** de ausência, filtros antigos são reinicializados. Landmarks sem confiança não desenham conexões. Não há pose antiga mantida como se fosse uma detecção atual.
- `renderFps` mede a frequência do loop `requestAnimationFrame`, não FPS de uma cena 3D ou taxa da webcam. `inferenceMs` inclui detecção e processamento dos landmarks; não mede latência ponta a ponta.
- `sceneFps` mede os frames do renderizador 3D e é publicado a cada 500 ms. O controlador calcula novos alvos na frequência de captura; a demonstração é amostrada em até 24 Hz. O loop 3D aplica as rotações com referências e quaternions reutilizados, sem estado React por frame.
- O rig prioriza direções XYZ completas das coordenadas mundiais quando confiança e geometria são plausíveis. Proporções, comprimentos amplos e coerência da projeção rejeitam estimativas aberrantes. Se os dados forem rejeitados, a alternativa usa XY corrigido pela proporção do vídeo. O tronco inclina até aproximadamente 20° e os cotovelos flexionam até 150°. Rotação fina dos punhos não é inferida.
- A interpolação base usa constante temporal de 55 ms para cadeias visíveis e 200 ms no repouso/perda daquela cadeia. A perda de um braço não torna o outro braço lento. Dados com mais de 400 ms são ignorados. A camada de ataques atua depois desses filtros, sem atraso adicional entre a pose do clip e sua janela técnica.
- A cena 3D é um módulo separado; Three core, renderer e componentes são divididos em chunks. Não há pós-processamento, HDR externo, partículas ou física. Materiais/geometrias são reutilizados e liberados ao desmontar a cena.
- A preferência por movimento reduzido remove a oscilação decorativa das pernas e desacelera a demonstração. A resposta funcional ao corpo continua disponível.
- A qualidade inicial é Leve para reduzir o custo de sombras e resolução; Equilibrada continua disponível. A cena memoizada evita propagar atualizações do diagnóstico pela árvore 3D. Não foi medida uma melhora de FPS no dispositivo do jogador.
- Velocidade é calculada em unidades corporais por segundo, com suavização de 70 ms, validação de intervalo e reinicialização após ausência. A recuperação de profundidade inicia uma nova referência, sem inventar velocidade Z.
- Socos retos exigem retração anterior e alcance de 80% em até 400 ms, sem depender de profundidade. Intervalo entre golpes do mesmo braço: 350 ms, com nova retração obrigatória. Ganchos e uppercuts avaliam os últimos 380 ms da trajetória do punho; guarda usa permanência de 150 ms e esquiva de 100 ms, com limiares diferentes de entrada/saída.
- Um clip de soco reto dura **550 ms**, o gancho **680 ms** e o uppercut **780 ms**, escalável de 0,75× a 1,35×. No soco reto, a máscara aumenta gradualmente até o impacto em 130 ms; a janela técnica vai de 130 ms (inclusivo) a 210 ms (exclusivo), escalada pela duração. O recolhimento leva o peso a zero sobre o tracking atual. Interrupções desfazem o peso em **180 ms** e fecham a janela imediatamente. Os tempos são editáveis em `combat-clips.ts`; não são estimativas da webcam.
- Keyframes e opções são preparados uma vez por ataque. O sampler, a saída do controlador e os quaternions são reutilizados no loop; a UI recebe snapshots a cada 125 ms e nas mudanças de estado/fase/janela, sem estado React por frame.
- O combate usa simulação fixa a 60 Hz, separada da inferência. O tempo acumulado por frame é limitado para evitar recuperação longa ao voltar de uma aba parada. Frames de ataque e volumes de contato são calculados juntos; a busca varrida do punho reduz a chance de atravessar o alvo entre amostras. Pausa não avança relógio, IA ou dano.

### Testes e validação

Os testes unitários exercitam validação de landmarks, filtros em taxas diferentes, perdas individuais/globais, enquadramento, confiança, coordenadas mundiais, erros de câmera, descarte, cancelamento durante inicialização, reinícios concorrentes, desconexão, página oculta, timeout, frames repetidos e limites de agendamento. A fase 2 acrescenta testes de orientação por cinemática direta, espelhamento, proporção, profundidade, limites articulares, perda de sinal, interpolação independente de FPS, pausa e projeção da câmera. Streams, vídeo e relógio são doubles de teste; esses resultados não equivalem a um teste com webcam física.

A verificação da fase 4 inclui a cadeia de landmarks sintéticos → calibração → velocidades → gesto → pulso → rig → animação, com um único ataque e retorno ao tracking atual. Também cobre cinemática dos clips, máscaras, espelhamento, prioridade, cancelamento, pausa, duração, amplitude, repetição, eventos antigos e enquadramento das duas vistas. As poses de teste nunca alimentam a câmera da aplicação. Os resultados executados estão no [relatório da fase 4](docs/phase-4-review.md).

Os testes da fase 5 verificam a geometria de contato, regras, IA, pausa/recuperação, rounds e a ponte entre captura e partida. O inventário das alterações e os resultados executados constam no [relatório da fase 5](docs/phase-5-review.md).

A fase 6 acrescenta testes da coerência dos eventos com as estatísticas de uma partida completa, partículas, anéis, tremor, mapeamento e síntese de som com um duplo do Web Audio, narração, sugestão de qualidade e preferências salvas. Veja o [relatório da fase 6](docs/phase-6-review.md).

A fase 7 acrescenta testes de combos, clips e contato dos novos golpes, reconhecimento de ganchos e uppercuts com casos de falso positivo, gravação/reprodução/validação de replays, carreira, perfil e catálogo visual. A arena, os cenários, a garagem, a carreira e o replay também foram conferidos no Chrome. Veja o [relatório da fase 7](docs/phase-7-review.md).

A fase 8 acrescenta testes do Worker, do agendamento, do ritmo da cena, do filtro adaptativo, da aferição e da avaliação offline. Veja o [relatório da fase 8](docs/phase-8-review.md).

A fase 9 acrescenta testes da Sobrecarga, do soco duplo, da reação por golpe, dos efeitos de dano e da câmera lenta. Veja o [relatório da fase 9](docs/phase-9-review.md).

A fase 10 acrescenta testes dos estilos de IA, das dificuldades, do modo de treino no motor, do circuito, do treino guiado, da variação das demonstrações e da leitura de dados salvos antes da fase. Veja o [relatório da fase 10](docs/phase-10-review.md).

A resposta de ganchos e uppercuts com webcam permanece **pendente de revisão real**. A demonstração é identificada como programada e não preenche os indicadores da webcam com dados artificiais. O [relatório da fase 3](docs/phase-3-review.md) preserva o histórico da correção frontal.

## Limitações atuais

- Não há multiplayer online, que exigiria um servidor. Carreira, circuito, ranking e replays existem só neste navegador e podem ser apagados com os dados do site. Não há fila de golpes nem ataques simultâneos do mesmo robô. Na arena os dois lutadores podem atacar ao mesmo tempo; a resolução considera o contato de cada um.
- Hitboxes são aproximações geométricas de cabeça/corpo e punhos, sem física de contato entre peças ou IK para alcançar um alvo. A IA e o balanceamento são iniciais; os limiares de ganchos e uppercuts são iniciais.
- Efeitos e sons são procedurais e simples: não há pós-processamento, bloom, câmera lenta, trilha musical ou locução gravada. Os sons foram verificados com um duplo do Web Audio, não por audição; timbre e volume precisam de revisão real.
- A narração acessível cobre eventos da partida, mas o jogo continua exigindo movimento corporal visível pela câmera; não há modo alternativo de controle.
- A inferência disputa a GPU com a cena 3D. Em GPU integrada, o Worker deixa a página mais lisa, mas atrasa a pose; por isso o modo automático mantém a página. Sem câmera real, as medições desta entrega usaram um vídeo desenhado.
- As medidas do corpo usam x e y normalizados sem corrigir a proporção do vídeo, o que estica a vertical em 1,78× em 16:9. Os limiares atuais foram ajustados nessa métrica; a correção só deve entrar após comparação com uma aferição real.
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
- Não há testes automatizados de ponta a ponta no navegador nem aferição real dos novos gestos nesta entrega. No modo na página, câmera/CPU e renderização compartilham a thread principal; use 480p e qualidade Leve se houver lentidão.

## Roadmap e autorização

1. **Fundação e motion tracking:** implementada; funcionamento dos braços confirmado pelo usuário.
2. **Robô 3D e espelhamento:** implementada; aparência confirmada pelo usuário, limitação frontal tratada na fase 3.
3. **Motion engine e gestos:** implementada; calibração, guarda, esquivas, socos e correção frontal.
4. **Animações híbridas:** implementada; clips, máscaras e transições suaves.
5. **Arena e combate:** implementada; IA, contato, vida, defesa, rounds e resultados.
6. **Polimento:** implementada; efeitos de impacto, som procedural, acessibilidade e sugestão de qualidade.
7. **Expansões:** implementada; combos avançados, personalização, cenários, carreira, ranking local e replays. O multiplayer online fica para uma fase própria, com backend.
8. **Desempenho e precisão:** implementada; socos retos ajustados com a aferição de 26/11/2026. Cruzado e uppercut aguardam nova aferição com os nomes novos.
9. **Impacto visual:** implementada; desgaste, nocaute com câmera lenta, Sobrecarga e brilho opcional.
10. **Conteúdo para um jogador:** implementação atual para revisão.
11. **Online:** backend, contas, ranking global e multiplayer. Ainda não autorizada.

O desenvolvimento está interrompido na fase 10 para revisão antes do commit. Sugestão de commit: `feat: add opponents, difficulty, circuit and guided training`.

## Referências técnicas

- [Pose Landmarker para Web — Google AI Edge](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [Vite — requisitos e execução](https://vite.dev/guide/)
- [Tailwind CSS — integração com Vite](https://tailwindcss.com/docs/installation/using-vite)
- [React Three Fiber — compatibilidade com React e instalação](https://r3f.docs.pmnd.rs/)
- [Three.js — quaternions e interpolação](https://threejs.org/docs/pages/Quaternion.html)
- [React Three Fiber — cuidados com desempenho](https://r3f.docs.pmnd.rs/advanced/pitfalls)

Código e modelo MediaPipe são recursos externos do Google; consulte a documentação e as licenças correspondentes antes de redistribuir uma versão pública.
