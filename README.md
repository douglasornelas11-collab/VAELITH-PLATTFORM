# Vaelith Platform — protótipo MVP

Protótipo funcional da Fase 1 do PRD (compatibilização de projetos, planejamento/replanejamento de cronograma e dashboard de desvios). Não é produção — é a base para validar o fluxo antes de investir em infraestrutura definitiva (ver seção "Arquitetura técnica" do PRD para a versão com PostgreSQL, etc.).

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

**Mão de obra (Fase 2 — TCPO/PMBOK, dimensionamento bottom-up)**
- Biblioteca de produtividade (índices Hh/unidade), pré-carregada com valores citados no seu artigo e editável.
- Lançamento de itens de orçamento (BOQ): quantidade × índice = horas-homem, automático ou com índice manual.
- Cálculo do efetivo médio necessário = horas-homem ÷ janela real de execução (não a duração total da obra) — a janela é lida das tarefas do cronograma cujo campo "recurso" cita a especialidade.
- Registro simples de efetivo mobilizado por dia, comparado ao necessário (gap positivo/negativo).
- Visão de programa: soma a demanda de cada especialidade entre todas as obras cadastradas — a recomendação central do seu estudo (dimensionar pelo programa, não obra a obra isolada).

**Dashboard**
- Dias de desvio acumulado, incompatibilidades abertas/fechadas.
- Distribuição por status e por tipo.

## O que ainda não está aqui (próximos passos do roadmap)

- Localização estruturada (Obra → Pavimento → Ambiente → Elemento) — hoje overlay e detecção comparam disciplinas inteiras, não uma área específica.
- Scope/Cost Intelligence, Bid Readiness, Ready to Build, Risk Engine, Decision Engine — pilares 1 (parte) e 3–7 da Estrutura Consolidada, fora do V1.
- Diário de obra estruturado e fornecedores — Construction Intelligence.
- Clash detection real em BIM/IFC (hoje só 2D) — Coordination Engine 3D.
- Banco de dados real (Postgres), autenticação, múltiplos usuários — hoje é single-user, arquivo local.
- DWG/DXF como entrada — hoje só PDF e imagem.

## Notas de calibração da detecção automática

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
