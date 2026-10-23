# Entrega para revisão — fase 3

Data: 23/10/2026. Versão: 0.3.0. Escopo: motion engine, calibração e primeiros gestos, incluindo correção da extensão frontal do robô apontada pelo usuário.

## Problema observado e correção

O usuário forneceu uma captura real com o braço estendido em direção à webcam. A fase 2 usava a projeção XY como direção principal e limitava a profundidade a uma contribuição de aproximadamente 17°. Quando o segmento encurtava na imagem, a direção Z também diminuía; alguns casos de sobreposição 2D voltavam ao repouso mesmo com coordenadas mundiais válidas.

O solver agora prioriza **direções XYZ completas** por cadeia, com confiança e geometria plausíveis. A alternativa XY continua disponível quando a estimativa mundial não é confiável. O punho pode avançar em +Z mesmo com ombro/cotovelo/punho quase coincidentes em XY. A orientação do ombro foi adaptada para evitar singularidades perto de UP e ±Z. A validação rejeita comprimentos aberrantes, proporções incoerentes e contradições fortes entre imagem e mundo.

Também foi corrigida a latência em detecção parcial: um braço oculto recebe retorno lento ao repouso, enquanto o braço ainda visível mantém sua interpolação rápida. Perder o outro braço não torna a extensão frontal lenta.

Isso corrige a restrição artificial do algoritmo. Não resolve a ausência de informação quando um punho esconde o cotovelo ou a confiança do MediaPipe cai. A reconstrução monocular continua sendo aproximada e não é tratada como medição precisa.

## Funcionalidades implementadas

- Calibração guiada, com confirmação geométrica de postura neutra e guarda.
- Postura neutra por 1,5 s, com ombros relaxados e punhos visíveis à frente da cintura; guarda por 1,2 s com punhos próximos ao rosto e cotovelos flexionados. A posição é compatível com enquadramento da cintura para cima.
- Validação de rosto, ombros, cotovelos, punhos, proporção e estabilidade; perdas, intervalos grandes ou movimento excessivo reiniciam o tempo da etapa.
- Cancelamento/recalibração e invalidação do perfil ao interromper a câmera ou trocar para demonstração.
- Posição relativa ao centro dos ombros, escala corporal, velocidades suavizadas, ângulo de cotovelo, extensão e disponibilidade de profundidade por braço.
- Socos retos esquerdo/direito com retração, velocidade predominante à frente, crescimento de extensão, deslocamento Z, dois frames coerentes e janela temporal de 60–350 ms.
- Cooldown de 500 ms por braço e retração obrigatória para novo soco. Manter o braço estendido não dispara repetidamente.
- Guarda com permanência de 150 ms; esquiva por inclinação lateral com permanência de 100 ms e histerese. Lados são anatômicos do jogador, independentes do espelhamento visual.
- Nenhum evento na demonstração, calibração, câmera inativa, amostra inválida ou profundidade insuficiente para o braço do soco.
- Painel de calibração, último gesto, postura, profundidade e extensão por braço; histórico limitado a seis eventos, sem persistência.
- Publicação de diagnóstico em cadência reduzida; reconhecimento semântico atualizado imediatamente. O rig continua lendo poses diretamente, independentemente da UI de gestos.
- Qualidade 3D Leve como padrão e memoização da cena para reduzir trabalho desnecessário. Não há aumento de FPS aferido no notebook do usuário.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Aprovado |
| `npm test` | **197 testes aprovados em 10 arquivos** |
| `npm run build` | Aprovado; recursos 3D continuam divididos em chunks, sem aviso acima de 500 kB |
| Retargeting | 52 testes, incluindo extensão frontal/traseira, projeção XY colapsada, espelhamento, limites, outliers e orientação contínua |
| Calibração + características | 37 testes, incluindo enquadramento com mãos à frente da cintura, estabilidade, recuperação e profundidade por braço |
| Gestos | 29 testes, incluindo trajetórias 3D a 24 Hz, cooldown, repetição, profundidade ausente/reaparecendo e falsos positivos |
| Integração real dos módulos | 4 testes: landmarks sintéticos → calibração → velocidade → um soco; gates de demo, sessão e cancelamento |
| Controlador do rig | 8 testes, incluindo resposta do braço visível durante perda da cadeia oposta |
| Regressões das fases 1/2 | Testes de câmera, filtros e projeção permanecem aprovados |
| Servidor local existente | Página e módulo transformado do painel da fase 3 retornaram HTTP 200 |
| Revisão estática independente | Nenhum bloqueador encontrado na integração e nos gates |
| Browser, console e webcam da fase 3 | Validação visual/real pendente |

As poses sintéticas existem somente nos testes. A interface não usa esses dados para simular a câmera nem apresenta resultados programados como detecções reais.

A captura enviada pelo usuário confirma a renderização da fase 2 e mostra aproximadamente 23 FPS 3D naquele instante; isso não foi usado como benchmark completo. Não foi medido o FPS após as mudanças desta fase.

A permissão salva/política de navegador que bloqueou a origem local na fase anterior permanece um limite de verificação. Não houve nova tentativa de contornar esse bloqueio por outra superfície, CDP ou navegador indireto. A revisão visual da correção frontal e dos novos controles será feita pelo usuário.

## Arquivos modificados

```text
README.md
package.json
package-lock.json
src/app/App.tsx
src/app/styles.css
src/engine/motion/retarget.ts
src/engine/motion/retarget.test.ts
src/engine/motion/rig-controller.ts
src/engine/motion/rig-controller.test.ts
src/features/motion-tracking/use-motion-tracking.ts
src/features/robot/RobotCanvas.tsx
src/stores/robot-store.ts
```

## Arquivos criados

```text
docs/phase-3-review.md
src/types/combat-motion.ts
src/stores/combat-motion-store.ts
src/engine/motion/calibration.ts
src/engine/motion/calibration.test.ts
src/engine/motion/motion-features.ts
src/engine/motion/motion-features.test.ts
src/engine/gestures/gesture-engine.ts
src/engine/gestures/gesture-engine.test.ts
src/features/motion-tracking/combat-motion-runtime.ts
src/features/motion-tracking/combat-motion-runtime.test.ts
src/features/motion-tracking/CombatMotionPanel.tsx
src/app/styles/motion-engine.css
```

## Roteiro de revisão real

Recarregue a página do servidor existente em `http://127.0.0.1:5173/`. Se necessário, execute `npm run dev`. Dependências e modelo local da fase 1 foram preservados; não há novas dependências nesta fase.

1. Sem calibrar, na vista **Perspectiva**, estenda um braço lentamente para a frente. Observe o avanço do punho no eixo de profundidade. O robô ainda usa espelhamento, sem animação automática de soco.
2. Clique em **Calibrar movimentos**. Mantenha os punhos visíveis à frente da cintura e os ombros relaxados; depois mantenha a guarda próxima ao rosto. Acompanhe as instruções e o progresso.
3. Assuma a guarda, faça um soco reto de cada vez e retorne à guarda. Confirme o lado anatômico exibido e um único evento por extensão.
4. Mantenha um punho estendido: não deve gerar novos socos continuamente. Movimentos laterais ou lentos não devem ser classificados automaticamente como socos retos.
5. Teste guarda e inclinações do tronco. Caso o enquadramento esconda os quadris, a inclinação utiliza a linha dos ombros como aproximação.
6. Oculte um braço, retorne ao enquadramento e repita. A recuperação não deve inventar um soco; o braço visível deve continuar responsivo.
7. Confirme o indicador 3D de cada braço. Se a leitura for **Extensão 2D · soco indisponível**, melhore visibilidade/iluminação; o sistema não deve produzir um soco frontal usando apenas XY.
8. Cancele/recalibre; troque para demonstração; interrompa/reinicie a câmera. O perfil e os eventos antigos devem ser descartados. A demonstração não deve gerar gestos.
9. Compare a fluidez em Leve e Equilibrada e, se necessário, reduza a câmera para 480p. Verifique layout e console em uma janela estreita.

## Limitações e próxima fase

- Confiança dos landmarks e oclusão podem impedir o reconhecimento frontal, mesmo após a correção geométrica. A interface informa profundidade por braço.
- Um alcance rápido à frente pode compartilhar a geometria de um soco. Heurísticas não inferem intenção e os limiares precisarão de validação com diferentes usuários.
- A confiança exibida é a confiança mínima dos dados utilizados, não a probabilidade de que a classificação esteja correta.
- Inferência continua síncrona na thread principal; Worker e otimizações mais amplas continuam pendentes. Não há promessa de 60 FPS.
- Não há hook, uppercut, combos, estado de ataque, blending de animações próprias, hitboxes, arena, dano ou IA. Gestos apenas atualizam o diagnóstico.

O desenvolvimento para no final da fase 3 para revisão. A fase 4 implementará animações híbridas, somente após autorização. Nenhuma branch, commit ou push foi feito.

Commit sugerido, após autorização: `feat: add calibrated motion gestures and forward arm tracking`.
