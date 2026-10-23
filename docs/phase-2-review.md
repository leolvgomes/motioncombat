# Entrega para revisão — fase 2

Data: 23/10/2026. Versão: 0.2.0. Escopo: robô procedural 3D e espelhamento corporal. A fase 1 foi mantida e o usuário confirmou que o rastreamento dos braços funciona em sua webcam.

## Implementação

- Câmera e robô lado a lado; diagnósticos e configuração abaixo, com layout adaptado a telas estreitas.
- Robô original ATLAS-01, com aproximadamente 2,47 unidades de altura, seis geometrias e oito materiais compartilhados em cerca de 92 meshes. Sem modelos pagos, imagens, texturas ou fontes externas.
- Hierarquia de tronco, ombros, cotovelos, punhos e cabeça, com pernas independentes da captura. Interfaces do rig permitem substituição futura por um esqueleto GLB.
- Conversão das direções dos braços e inclinação do tronco em quaternions locais, corrigindo proporção do vídeo e espelhamento.
- Orientação estável dos ombros perto da posição com os braços levantados; cotovelos limitados a 150°, tronco a aproximadamente 20° e profundidade conservadora.
- Interpolação independente da frequência de renderização e retorno suave ao repouso após perda de dados. Somente a última pose é compartilhada com o renderizador; React não recebe updates por frame.
- Demonstração programada de 16 segundos, sem webcam ou landmarks fictícios; pausa e retomada sem avanço durante a pausa. Selecionar demo encerra a captura; iniciar câmera seleciona tracking.
- Vistas frontal/perspectiva, enquadramento automático, qualidade equilibrada/leve e FPS real da cena, separado do diagnóstico da webcam.
- Enquadramento calculado para a área de movimento completa e proporção do painel; testes incluem os punhos e os extremos da demonstração em telas estreitas.
- Tratamento isolado de erros 3D e perda de contexto WebGL; o painel da câmera continua disponível.
- Runtime 3D carregado por importação dinâmica, com Three core/renderer separados em chunks; sombras limitadas, sem pós-processamento ou física.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| Compatibilidade de dependências | React 19.3.1; R3F 9.8.2; Three 0.186.1; Drei 10.7.9 |
| Instalação npm | 125 pacotes auditados; 0 vulnerabilidades reportadas na instalação |
| `npm run typecheck` | Aprovado, saída 0 |
| `npm test` | **103 testes aprovados em 6 arquivos** |
| `npm run build` | Aprovado, saída 0, sem aviso de chunk acima de 500 kB |
| JavaScript minificado do robô | Aproximadamente 0,94 MB dividido em três chunks; aproximadamente 253 kB gzip somados |
| Geometrias do robô | Verificação em CPU confirmou limites finitos das seis geometrias |
| Projeção da câmera | 30 testes com Three real, ambas as vistas, proporções 0,55/0,68/0,8/1/16:9 e sequência completa da demo |
| Regressão dos ombros | Varredura próxima de UP reproduziu instabilidade anterior e passou após orientação estável |
| Servidor local existente | HEAD da página e leitura do módulo transformado `RobotCanvas.tsx`: HTTP 200 |
| `git diff --check` | Sem erros de whitespace; Git informou apenas normalização LF/CRLF |
| Inspeção visual/browser/console | Bloqueada pela política de acesso à origem local |

Não foi encerrado o servidor que já estava em execução na porta 5173. Uma tentativa de iniciar outro servidor com porta estrita foi corretamente recusada por porta ocupada; foi reutilizado o servidor existente para verificar os recursos HTTP. Nenhum navegador alternativo ou mecanismo indireto foi utilizado.

O usuário autorizou abrir a prévia nesta fase. Mesmo assim, a ferramenta recusou `http://127.0.0.1:5173` porque uma permissão salva ou política gerenciada nega essa origem. Aparência, iluminação, alinhamento visual do corpo/robô, interação no navegador, responsividade renderizada e desempenho com webcam **continuam pendentes de revisão manual**. Testes de matemática e build não substituem esses critérios.

## Arquivos modificados

```text
package.json
package-lock.json
vite.config.ts
README.md
src/app/App.tsx
src/app/styles.css
src/features/motion-tracking/use-motion-tracking.ts
```

## Arquivos criados

```text
docs/phase-2-review.md
src/app/styles/robot.css
src/types/robot.ts
src/stores/robot-store.ts
src/engine/motion/retarget.ts
src/engine/motion/retarget.test.ts
src/engine/motion/rig-controller.ts
src/engine/motion/rig-controller.test.ts
src/features/motion-tracking/pose-stream.ts
src/features/robot/RobotCanvas.tsx
src/features/robot/RobotModel.tsx
src/features/robot/RobotPanel.tsx
src/features/robot/robot-resources.ts
src/features/robot/camera-fit.ts
src/features/robot/camera-fit.test.ts
```

## Como executar e revisar

Dependências já estão instaladas neste diretório; o modelo da fase 1 foi preservado. Recarregue o servidor existente, normalmente em `http://127.0.0.1:5173`. Se ele não estiver ativo, execute `npm run dev`. Para uma instalação nova: `npm ci`, `npm run setup:tracking`, `npm run dev`.

- [ ] Sem iniciar a webcam, abrir **Demonstração**, observar elevação dos braços, flexão dos cotovelos, aceno e inclinação; pausar e continuar.
- [ ] Conferir proporções, luz, materiais e ausência de erros relevantes no console.
- [ ] Alternar vistas e qualidade; redimensionar para 375 px; confirmar que punhos não são cortados.
- [ ] Iniciar a câmera, levantar um braço por vez e comparar com o robô na vista frontal.
- [ ] Alternar espelhamento e verificar que o lado visível na imagem corresponde ao lado da vista frontal do robô.
- [ ] Flexionar cotovelos, levantar braços sobre a cabeça e inclinar o tronco lentamente; conferir estabilidade.
- [ ] Ocultar um braço e retornar; sair do quadro e retornar; verificar retorno suave e recuperação.
- [ ] Trocar para demo durante uma sessão e conferir que a webcam é liberada. Voltar à fonte do corpo e iniciar novamente.
- [ ] Comparar FPS 3D, Hz do tracking e fluidez real, também com 480p + qualidade Leve.
- [ ] Confirmar que os fluxos de permissão, cancelamento e desligamento da fase 1 continuam funcionando.

## Limites e próxima fase

A profundidade é aproximada e propositalmente limitada. Socos em direção à câmera ainda podem parecer estranhos; **não existe reconhecimento ou animação de ataque**. Não há calibração, bloqueio, colisão entre partes do robô, movimento completo dos punhos/dedos, adversário ou combate. As pernas usam uma base visual independente, sem IK dos pés.

O processamento síncrono do MediaPipe permanece na thread principal. Não foi medido o desempenho 3D no hardware do jogador. Qualidade Leve reduz DPR e remove sombras; não existe garantia de 60 FPS.

O desenvolvimento para aqui, no final da fase 2, para revisão. A próxima fase será calibração, velocidades e primeiros gestos, somente após autorização. Nenhuma branch, commit ou push foi feito.

Mensagem de commit sugerida, após autorização: `feat: add articulated robot and body motion mirroring`.
