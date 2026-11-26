# Entrega para revisão — fase 10

Data: 26/11/2026. Versão: 0.10.0. Escopo: conteúdo para um jogador. Nenhuma dependência nova.

## O que entrou

- **Quatro adversários com estilo próprio.** Todos têm o mesmo corpo, alcance, vida e golpes; só as decisões mudam.
  - **KESTREL-3 (Veloz):** quase só socos retos, pausas curtas, recua bastante.
  - **BASALTO-9 (Muralha):** fica muito na guarda, se fecha quando apanha e usa mais uppercuts.
  - **MAGNA-X (Pressão):** quase não se defende e encadeia até quatro golpes.
  - **VULCAN-07 (Equilibrado):** o comportamento de sempre, sem mudança.
- Cada adversário tem cores, cabeça e ombreiras próprias, e uma dica antes da luta.
- **Três dificuldades:**
  - **Fácil:** aviso 35% mais longo, mais pausas, metade das sequências e 75% do dano.
  - **Normal:** o ritmo de sempre.
  - **Difícil:** aviso 18% mais curto (nunca abaixo de 0,42 s), menos pausas, mais sequências e 115% do dano.
  - A pontuação do ranking pelo resultado vale ×0,8 no Fácil e ×1,25 no Difícil.
- **Circuito:** KESTREL-3 → BASALTO-9 → MAGNA-X → VULCAN-07 (final), na dificuldade escolhida.
  - Vitória avança, empate repete a luta e derrota encerra o circuito.
  - Títulos e a melhor campanha ficam salvos neste navegador.
- **Treino guiado** com um robô de treino (SPARRING), em 8 etapas: guarda, soco reto com cada mão, cruzado, uppercut, bloqueio, esquiva, combo Um-dois e Sobrecarga.
  - Cada etapa só avança com o evento real da partida: o golpe reconhecido, o bloqueio, a esquiva, o combo ou o especial.
  - O robô de treino só ataca nas etapas de defesa, com aviso de quase 1 s.
  - Na etapa da Sobrecarga, o medidor fica cheio.
  - Sem relógio, sem perda de integridade, sem replay e sem registro na carreira.
  - Uma etapa sem reconhecimento por 35 s é pulada sozinha, porque você joga longe do mouse. Também há o botão **Pular etapa**.
  - Com cruzado e uppercut desligados no laboratório, essas duas etapas saem do treino.
- **Demonstrações variadas:** cada uma tem semente própria, sorteia o adversário e o estilo do robô da esquerda.
- **Carreira e replays:** cada partida guarda adversário e dificuldade; o ranking mostra os dois.
  - Partidas e replays de antes desta fase abrem como VULCAN-07 no Normal.
- O início sem as mãos (fazer a guarda para começar) vale para os três tipos de luta.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | **577 testes aprovados** (25 novos nesta fase) |
| TypeScript estrito e `npm run build` | Aprovados |
| Chrome, build de produção | Escolha de modo, adversários, dificuldade, circuito e treino na tela; MAGNA-X e o robô de treino com a aparência certa; demonstração contra BASALTO-9 sorteada; sem erros no console |

**Não verificado:**
- O treino e o circuito com webcam real (sem câmera aqui, não dá para iniciá-los).
- O equilíbrio das dificuldades e dos estilos contra uma pessoa.

## Roteiro de revisão manual

1. Ligue a câmera, calibre e escolha **Treino guiado**. Faça as 8 etapas e anote qual demorou ou foi pulada.
2. **Luta rápida** contra cada adversário no Normal: os estilos são perceptíveis?
3. Experimente Fácil e Difícil contra o mesmo adversário.
4. Comece o **Circuito** e confira a mensagem depois de cada luta. Saia e volte à página: o circuito continua onde parou.
5. Veja duas demonstrações seguidas: adversário e luta devem mudar.
6. Na **Carreira**, confira a coluna Adversário no ranking.

## Limitações

- O equilíbrio dos estilos e das dificuldades veio de simulação IA × IA e de testes; precisa das suas lutas para ajustar.
- As etapas de cruzado e uppercut dependem do reconhecimento ainda não aferido com os nomes novos; por isso existe o pulo automático.
- O robô de treino ataca só com socos retos.
- Circuito e treino ficam neste navegador e somem ao apagar os dados do site.

Commit sugerido: `feat: add opponents, difficulty, circuit and guided training`.
