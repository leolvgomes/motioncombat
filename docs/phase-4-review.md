# Entrega para revisão — fase 4

Data: 23/10/2026. Versão: 0.4.0. Escopo: animações híbridas dos socos retos, sobre o espelhamento e os gestos da fase 3. Nenhuma dependência nova.

## Comportamento implementado

- Socos esquerdo/direito reconhecidos pela câmera acionam clips procedurais próprios. O lado anatômico do jogador é convertido para o lado do robô usando o mesmo espelhamento do rig.
- O clip controla ombro, cotovelo e punho do braço que ataca. A contribuição do tronco é limitada a 25% do peso do braço. O braço oposto e a cabeça continuam com as rotações locais do acompanhamento corporal.
- Preparação, extensão e recolhimento têm pesos graduais. Ao terminar, o robô acompanha a pose **atual**, sem voltar a uma fotografia da postura anterior ao ataque.
- Estados visuais separados dos gestos: `IDLE`, `TRACKING`, `GUARD`, `DODGE`, `PUNCH_LEFT`, `PUNCH_RIGHT` e `RETURNING`. Guarda e esquiva seguem o corpo, sem animações adicionais.
- Prioridade: um ataque aceito prevalece sobre postura de guarda/esquiva. Novos ataques durante ataque/retorno são consumidos e descartados, sem fila ou combos.
- Interromper a câmera, perder a fonte geral, recalibrar, trocar de fonte/espelho ou desativar as animações fecha imediatamente a janela técnica e desfaz o peso em 180 ms. Uma perda breve entre frames também invalida pulsos pendentes.
- Pulsos têm sequência e geração; eventos repetidos, antigos, anteriores à montagem da cena ou sem calibração/fonte válida não iniciam animações. Eventos de postura não sobrescrevem o pulso de ataque.
- Duração padrão de 550 ms, ajustável de 0,75× a 1,35×; amplitude de 0,6× a 1,3×. As opções são capturadas no início do ataque: um slider não muda o golpe em curso.
- Janela técnica de 130 ms a 210 ms, escalada pela duração, com início inclusivo e fim exclusivo. Ela é metadado do clip aplicado naquele frame; **não existe hitbox, acerto ou dano nesta fase**.
- Painel de estado/fase/progresso, identificação do braço controlado, ajustes e diagnóstico recolhível. O painel da cena também informa o ataque ou retorno.
- Demonstração explícita de guarda e socos alternados, além da exploração de articulações existente. A pausa congela pose e relógio; a sequência não requer câmera nem produz gestos no motion engine.

## Arquitetura e custo do loop

`GestureEngine` continua responsável somente pelo reconhecimento. `combat-motion-runtime` publica pulsos por `animation-signals`; o `HybridAnimationController` recebe o pulso e as rotações base do `RigController`. A saída é aplicada diretamente ao rig no loop 3D, sem suavização adicional que atrase a janela em relação ao clip.

Cada ataque prepara opções e keyframes uma vez. O sampler reutiliza sua saída, pesos, tuplas e quaternion temporário; o controlador também reutiliza rotações e snapshot. A UI recebe uma cópia do diagnóstico em até 8 Hz e nas mudanças de estado/fase/janela. Nenhum landmark ou transformação do rig passa por estado React a cada frame.

Os clips dependem apenas dos contratos de articulação e Three.js. O controlador não conhece MediaPipe, componentes React, câmera ou regras de dano. A estrutura permite ligar hitboxes e futuros estados de combate em outra fase.

## Verificações

| Verificação | Resultado |
| --- | --- |
| TypeScript estrito (`npm run typecheck` e etapa do build) | Aprovado |
| `npm test` | **279 testes aprovados em 13 arquivos** |
| `npm run build` | Aprovado, sem aviso de chunk acima de 500 kB |
| Clips e sampler | 35 testes: cinemática, direção frontal, máscara, continuidade, parâmetros, janela e reutilização |
| Controlador híbrido | 42 testes: prioridade, espelho, cancelamento, retorno à base atual, pausa, fonte e proteção contra replay |
| Integração de captura/reconhecimento/animação | 6 testes; inclui um único ataque a partir de landmarks e invalidação durante perda entre frames |
| Ponte de pulsos | 2 testes: posturas não sobrescrevem socos; reset e sequência |
| Rig e câmera 3D | 9 e 30 testes; projeção nas duas vistas inclui clips nos extremos de duração/amplitude |
| Regressões das fases anteriores | Aprovadas dentro da suíte completa |
| Servidor local existente | Página, painel e controlador transformados retornaram HTTP 200 |
| Revisão estática independente | Nenhuma regressão concreta restante encontrada nos clips, máscaras e integração |
| `git diff --check` | Aprovado |

Os testes usam entradas sintéticas somente no ambiente de teste; elas não alimentam a câmera da aplicação. Respostas HTTP 200 confirmam o serviço e a transformação dos módulos, não sua renderização no navegador.

Não foi realizada inspeção visual automática, leitura do console do navegador ou medição de FPS com webcam nesta fase. A permissão salva/política do navegador bloqueou a origem local anteriormente, inclusive após autorização do usuário. Não houve tentativa de contornar esse bloqueio. A revisão real abaixo permanece pendente.

## Arquivos modificados

```text
README.md
package.json
package-lock.json
src/app/App.tsx
src/app/styles.css
src/app/styles/robot.css
src/engine/motion/rig-controller.ts
src/engine/motion/rig-controller.test.ts
src/features/motion-tracking/combat-motion-runtime.ts
src/features/motion-tracking/combat-motion-runtime.test.ts
src/features/robot/RobotCanvas.tsx
src/features/robot/RobotPanel.tsx
src/features/robot/camera-fit.test.ts
```

## Arquivos criados

```text
docs/phase-4-review.md
src/types/animation.ts
src/engine/animation/combat-clips.ts
src/engine/animation/combat-clips.test.ts
src/engine/animation/hybrid-controller.ts
src/engine/animation/hybrid-controller.test.ts
src/features/robot/animation-signals.ts
src/features/robot/animation-signals.test.ts
src/features/robot/HybridAnimationPanel.tsx
src/stores/animation-store.ts
src/app/styles/hybrid-animation.css
```

## Como executar e revisar

O servidor existente atende `http://127.0.0.1:5173/`; recarregue a página. Para iniciar outra sessão de desenvolvimento, execute `npm run dev` e abra a URL exibida pelo Vite. A instalação completa, o modelo local e os comandos de build/testes estão no README.

1. Sem iniciar a câmera, selecione **Demonstração**. Em **Controle de animação → Rotina de demonstração**, selecione **Sequência de socos**. Após aproximadamente um segundo, o robô alterna socos a partir da guarda. Confirme a indicação de fonte programada.
2. Confira **Frontal/Perspectiva**. O braço deve avançar no eixo de profundidade e recolher sem saltos. Alterne duração e amplitude; as mudanças afetam o próximo golpe. Compare os extremos dos sliders.
3. Pause durante um golpe: pose, progresso e fase devem parar. Continue: a animação deve retomar daquele ponto. Troque a rotina para **Explorar articulações** e confirme o retorno à demonstração anterior.
4. Volte para **Seus movimentos**, inicie a câmera e calibre postura neutra/guarda. Antes de concluir a calibração, movimentos não devem gerar clips de ataque.
5. Faça um soco reto por vez e retorne à guarda. Confira o lado do jogador no painel de gestos e o lado do robô no painel de animação. Com espelhamento, os lados anatômicos são trocados no modelo.
6. Durante um soco, mova o braço oposto: suas articulações devem continuar seguindo o corpo. Retorne à guarda ou mude de postura durante o recolhimento; o robô deve convergir para a pose atual.
7. Segure um punho estendido: não deve repetir golpes. Faça uma segunda extensão enquanto um clip ainda está em curso: ela não deve ficar enfileirada para disparar depois. A camada reconhecedora pode registrar o gesto mesmo se o controlador visual estiver ocupado.
8. Desative **Animações de soco** para comparar o acompanhamento contínuo. Ao reativar, nenhum gesto antigo deve disparar. Repita com recalibração, troca de espelho/fonte, perda do enquadramento e câmera desligada.
9. Abra **Diagnóstico da transição**. A janela deve estar ativa somente durante a extensão, e fechar imediatamente após uma interrupção. Ela não demonstra colisão ou dano.
10. Confira teclado, foco, janela estreita, qualidade Leve/Equilibrada e console. Anote FPS 3D e taxa de inferência reais para orientar a fase de otimização.

## Limitações e próxima fase

- Reconhecimento continua heurístico e monocular. A animação não recupera landmarks ocultos nem aumenta a confiança de uma detecção; um falso positivo também pode acionar um clip.
- Um ataque já aceito pode terminar com visibilidade parcial enquanto a fonte geral permanecer válida. Perda global/cancelamento da sessão interrompem a camada e invalidam pulsos pendentes.
- Os clips são poses articulares procedurais, sem colisão entre as peças ou IK para alinhar o punho a um alvo. A resposta e a amplitude precisam de revisão visual no dispositivo do jogador.
- Não há hook, uppercut, especial, combo, ataques simultâneos, inimigo, arena, hitboxes, dano, rounds ou condição de vitória/derrota.
- Tracking permanece síncrono na thread principal. Os testes de tempo são determinísticos, não um benchmark de latência/FPS real. A meta de 60 FPS não foi aferida nesta entrega.

O desenvolvimento para ao final da fase 4. A fase 5 exige nova autorização. Nenhuma branch, commit ou push foi feito pelo agente.

Commit sugerido, após autorização: `feat: blend authored punches with live body tracking`.
