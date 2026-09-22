# Vaelith Platform — protótipo MVP

Protótipo funcional dos 7 pilares da Estrutura Consolidada do Produto (Preconstruction & Coordination, Planning, Resource, Cost & Procurement, Construction e Knowledge & AI Intelligence). Não é produção — é a base para validar o fluxo antes de investir em infraestrutura definitiva (banco de dados real, autenticação, BIM/IFC 3D — ver README, seção "O que ainda não está aqui").

## Como rodar

```bash
npm install
npm start
```

Acesse http://localhost:4000

Os dados ficam salvos em `data/db.json` (arquivo local — reinicia do zero se você apagar esse arquivo).

**Dependências de sistema para a detecção automática de mudanças:** além do Node, a Central de projetos precisa de `poppler-utils` (comando `pdftoppm`, para rasterizar PDF) e `python3` com `opencv-python` e `numpy` instalados no servidor (`pip install opencv-python numpy --break-system-packages`). Sem isso, o resto da plataforma funciona normalmente — só o botão "Detectar mudanças automaticamente" fica indisponível.

## O que está implementado

**Central de projetos (P0 — versionamento, comparação e detecção automática de mudanças)**
- Cada disciplina (Arquitetura, Elétrica, Hidráulica...) guarda um histórico de revisões — R00, R01, R02... — que nunca se sobrescrevem: toda nova revisão soma ao histórico.
- Comparador lado a lado de duas revisões quaisquer da mesma disciplina.
- Marcação manual: em imagens (PNG/JPG), clique sobre o desenho marca exatamente o ponto (x%, y%) onde algo mudou. Em PDF, um formulário de marcação (página + descrição) é usado, já que o navegador não permite capturar clique dentro de um `<iframe>` de PDF.
- **Detecção automática de mudanças (História 2.1/2.3 do Build Specification):** o botão "Detectar mudanças automaticamente" rasteriza as duas revisões (PDF vira PNG via `pdftoppm`), alinha-as finamente por correlação (ECC — cobre pequenas diferenças de translação/rotação entre plotagens) e calcula a diferença visual entre elas. As regiões com diferença relevante viram caixas candidatas sobre a imagem, cada uma com uma confiança heurística — o engenheiro confirma (gera o registro em "O que mudou", com origem `auto`) ou rejeita (nada é gravado) cada uma. Validado com plantas reais (AutoCAD/Stellantis): de 8 regiões candidatas encontradas entre duas revisões reais, 3 conferidas manualmente eram mudanças reais (mobília remanejada, marcação removida, data do carimbo) e 1 era falso positivo de antialiasing de texto — a confirmação humana existe exatamente para esse tipo de ruído.
- Toda marcação (manual ou confirmada a partir de sugestão automática) fica registrada em "O que mudou", associada à disciplina e à revisão exata.
- **Overlay multidisciplinar (História 2.2):** sobreponha a revisão de uma disciplina com a de outra (ex.: Elétrica × Hidráulica) numa mesma imagem, com opacidade ajustável e toggle para mostrar/esconder cada camada — útil mesmo sem detecção automática, só de olho no desenho.
- **Detecção de sobreposição entre disciplinas (História 3.1–3.3):** o botão "Detectar sobreposições" compara as máscaras de traço das duas disciplinas e aponta regiões onde as duas têm desenho na mesma área — candidato a interferência física (Hard Clash). A moldura da prancha é ignorada automaticamente (senão qualquer par de disciplinas do mesmo template "sobrepõe" 100% da página, o que não é sinal de nada). Confirmar uma sugestão cria a Incompatibilidade já preenchida (título, disciplinas envolvidas, severidade estimada pela confiança) — exatamente como confirmar uma mudança cria o elemento marcado; rejeitar não grava nada.
- **Coordination Report (Épico 4):** a cada obra, "Gerar relatório" resume disciplinas analisadas, incompatibilidades por severidade/tipo/origem (quantas vieram de detecção automática confirmada vs. registro manual) e a lista completa — com exportação em PDF.
- Este é o P0 revisado completo — Preconstruction + 2D Coordination V1 — descrito no Build Specification: upload → alinhamento/overlay → detecção → confirmação humana → Incompatibilidade → relatório.

**Cronograma e replanejamento**
- Importação de cronograma em `.xlsx`, `.csv` ou `.xml` (exportado do MS Project: Arquivo > Salvar como > XML). Leitura do `.mpp` binário nativo fica para uma fase seguinte — exige um parser dedicado (tipo MPXJ) que não compila em ambiente Node puro.
- Linha do tempo visual (planejado x atual) e tabela editável de tarefas.
- Replanejar uma tarefa cria uma nova revisão, preservando o histórico — nunca sobrescreve.
- Marcar uma edição como "mudança de projeto" dispara automaticamente um alerta na aba Compatibilização, exatamente como o PRD pede (nenhuma mudança sem gatilho de revisão).

**Compatibilização de projetos**
- Checklist guiado com os pontos críticos clássicos (shafts, furos, cruzamento de dutos, compatibilização física entre ofícios). O cadastro, versionamento e comparação de disciplinas agora vivem na aba Projetos.
- Registro de incompatibilidade com fluxo de status: aberto → em análise → revisão de projeto → aprovado → fechado.
- Distingue os dois tipos do seu estudo de caso: compatibilização entre documentos de projeto e compatibilização física entre ofícios concorrentes (sequenciamento).
- **Incompatibilidade vinculada a uma atividade do cronograma:** ao registrar (manual ou a partir de uma sugestão automática), é possível apontar qual atividade do cronograma está envolvida. A lista de incompatibilidades mostra a atividade vinculada, o local dela e um selo de prazo — "começa em Nd" (amarelo se for em até 7 dias) ou "atrasada" (vermelho) — para priorizar o que precisa de decisão antes que a obra chegue naquele ponto.

**Planning Intelligence (Pilar 3 — cronograma como fonte de coordenação, não só de datas)**
- **Local por atividade:** cada tarefa do cronograma ganhou um campo "Local" (ex.: "Pav 2 - Sala 203") — é a base para cruzar atividades por onde elas realmente acontecem, não só por quando.
- **Sequenciamento espacial (Spatial & Sequence Coordination — capacidade restaurada da Estrutura Consolidada do Produto):** compatibilizar os *projetos* não basta — duas *atividades* de obra incompatíveis programadas no mesmo local e no mesmo período também geram retrabalho (pintura e instalação de vidro na mesma sala, forro fechado antes da inspeção das instalações, piso acabado com demolição concorrente...). O painel "Sequenciamento espacial" (aba Cronograma) cruza automaticamente pares de atividades que compartilham local e têm datas sobrepostas, usando uma biblioteca de regras determinísticas (pares de palavras-chave — a mesma filosofia de IA do resto do produto: sinal heurístico, nunca decisão automática) para estimar severidade e explicar o motivo. Qualquer par no mesmo local/período aparece mesmo sem regra específica, com severidade "média", para revisão manual.
- **"Registrar" gera a Incompatibilidade automaticamente:** cada conflito detectado tem um botão que cria a Incompatibilidade já preenchida (tipo físico/sequenciamento, severidade, motivo, origem `auto`) e vinculada às atividades envolvidas — mesma lógica de confirmação humana das outras detecções automáticas da plataforma.

**Mão de obra (Fase 2 — TCPO/PMBOK, dimensionamento bottom-up)**
- Biblioteca de produtividade (índices Hh/unidade), pré-carregada com valores citados no seu artigo e editável.
- Lançamento de itens de orçamento (BOQ): quantidade × índice = horas-homem, automático ou com índice manual.
- Cálculo do efetivo médio necessário = horas-homem ÷ janela real de execução (não a duração total da obra) — a janela é lida das tarefas do cronograma cujo campo "recurso" cita a especialidade.
- Registro simples de efetivo mobilizado por dia, comparado ao necessário (gap positivo/negativo).
- Visão de programa: soma a demanda de cada especialidade entre todas as obras cadastradas — a recomendação central do seu estudo (dimensionar pelo programa, não obra a obra isolada).
- **Conflito de recursos entre obras (Resource Intelligence — capacidade restaurada da Estrutura Consolidada do Produto):** quando a mesma especialidade é demandada por janelas de tempo que se sobrepõem em obras diferentes (ex.: pedreiro em duas obras ao mesmo tempo), a Visão de programa aponta o conflito automaticamente — período de cada obra, efetivo de cada uma e efetivo combinado — para decidir prioridade entre as obras antes que a disputa pelo mesmo time vire atraso.

**Compras (Cost & Procurement Intelligence — Pilar 5)**
- Pedido de compra com item/serviço, disciplina, especialidade, valor estimado, fornecedor e status (planejado → emitido → recebido).
- **Compras afetadas por mudança (capacidade restaurada da Estrutura Consolidada do Produto):** todo pedido ainda não recebido é checado contra as incompatibilidades abertas da obra — se a disciplina/especialidade do pedido bate com alguma incompatibilidade aberta, ele aparece marcado "em risco" com o motivo (qual incompatibilidade e por quê). Fechar a incompatibilidade tira o pedido do risco automaticamente. O risco é sempre calculado na leitura, nunca gravado como decisão automática — mesma regra de confirmação humana do resto da plataforma, aqui aplicada como alerta, não como bloqueio.

**Construção (Construction Intelligence — Pilar 6)**
- **RDO simplificado:** um registro por dia, com atividade vinculada do cronograma, % concluído real, efetivo presente e ocorrências (chuva, falta de material, retrabalho...). Diferente das detecções automáticas, o RDO é o dado primário — ele grava direto e atualiza o % concluído real da tarefa vinculada no cronograma.
- **Planejado x real:** compara, para cada atividade com datas definidas, o % que o cronograma linear esperaria até hoje contra o % real relatado nos RDOs, e sinaliza atividades atrasadas (prazo vencido e ainda não concluídas) ou com desvio relevante — é o "resultado real da obra" que faltava para o cronograma deixar de ser só planejamento.

**Dashboard**
- Dias de desvio acumulado, incompatibilidades abertas/fechadas.
- Distribuição por status e por tipo.
- **Base de conhecimento (Knowledge & AI — Pilar 7):** agregado de TODAS as obras cadastradas — cruza os motivos de incompatibilidade que vieram da biblioteca de regras de sequenciamento (texto estável entre obras, diferente de descrição digitada à mão) e aponta quais padrões se repetiram mais de uma vez ou em mais de uma obra, com a severidade mais comum. Também mostra a taxa de confirmação automática (quanto do histórico veio de detecção confirmada vs. registro manual) e a taxa de fechamento — os dois indicadores de "confiabilidade é o produto" da Estrutura Consolidada.

## O que ainda não está aqui (próximos passos do roadmap)

Os 7 pilares da Estrutura Consolidada do Produto agora têm uma primeira versão real e testada no protótipo (Preconstruction/Coordination, Planning, Resource, Cost & Procurement, Construction, Knowledge & AI). O que falta é profundidade dentro de cada um, e a infraestrutura de produção:

- Localização estruturada (Obra → Pavimento → Ambiente → Elemento) — hoje overlay/detecção comparam disciplinas inteiras ou usam um campo de texto livre ("Local"), não uma hierarquia real navegável.
- Bid Readiness, Ready to Build, Risk Engine, Decision Engine como telas dedicadas — hoje os sinais que os alimentariam (incompatibilidades, desvios, riscos de compra) já existem espalhados pelas abas, mas não consolidados numa "tela de decisão" única.
- Fornecedores como entidade própria (hoje "fornecedor" é só um campo de texto no pedido de compra) e RDO com anexo de fotos.
- Clash detection real em BIM/IFC (hoje só 2D) — Coordination Engine 3D.
- Banco de dados real (Postgres), autenticação, múltiplos usuários — hoje é single-user, arquivo local.
- DWG/DXF como entrada — hoje só PDF e imagem.
- Biblioteca de regras de sequenciamento e a Base de conhecimento ainda são pequenas e determinísticas (poucas regras, comparação exata de texto) — crescer isso com mais obras reais é o que prova (ou derruba) a promessa de "aprender com o histórico".

## Notas de calibração

- **Importação de cronograma (.csv):** corrigido um bug real encontrado durante o teste do Planning Intelligence — nomes de tarefa com acento (ex.: "Instalação") vinham corrompidos ("InstalaÃ§Ã£o") porque o parser assumia Latin-1 por padrão para CSV puro. Corrigido forçando UTF-8 na leitura. `.xlsx` nunca foi afetado (a codificação já vem declarada dentro do próprio arquivo).

- **Diff entre revisões** (`diffEngine.py`): testado com 2 PDFs reais (AutoCAD, mesma prancha, R02→R03). Como vêm do mesmo arquivo CAD, já nascem pixel-alinhados — o alinhamento fino (ECC) é o plano B para PDFs escaneados ou plotados de forma diferente. 8 regiões candidatas encontradas; 3/4 conferidas manualmente eram mudanças reais, 1 falso positivo de antialiasing de texto.
- **Sobreposição entre disciplinas** (`overlapEngine.py`): a moldura da prancha (borda do template) é descartada antes do cálculo — sem isso, qualquer par de disciplinas do mesmo template "sobrepõe" a página inteira, o que não é um candidato útil. Também descarta regiões maiores que 50% da página pelo mesmo motivo. Validado com desenhos sintéticos de conteúdo realmente diferente (traços horizontais x verticais cruzando parcialmente): a região de cruzamento real foi localizada com precisão.
- Os dois motores são heurísticos (limiares de diferença/densidade de traço, não interpretação de geometria) — a confiança reportada é só um sinal para priorizar revisão, nunca uma decisão automática. É por isso que confirmar/rejeitar existe em todo lugar onde o sistema sugere algo.

## Estrutura

```
server.js              servidor Express + todas as rotas de API
db.js                   "banco de dados" em arquivo JSON
cronogramaParser.js      leitura de .xlsx/.csv/.xml (MS Project)
diffEngine.py            motor de detecção automática de mudanças entre revisões (Python + OpenCV)
overlapEngine.py         motor de sobreposição entre disciplinas diferentes (Python + OpenCV)
public/                 frontend (HTML/CSS/JS puro, sem build)
data/db.json             dados (criado automaticamente)
uploads/                arquivos enviados
uploads/render/          PDFs rasterizados em PNG, gerados sob demanda (cache)
```
