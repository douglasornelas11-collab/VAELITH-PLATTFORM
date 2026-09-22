// Banco de dados simples baseado em arquivo JSON — suficiente para o protótipo MVP.
// Em produção isso vira PostgreSQL (ver arquitetura no PRD).
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function defaultData() {
  return {
    obras: [
      { id: 'obra-1', nome: 'Obra Demonstração', tipo: 'Corporativa', criadaEm: new Date().toISOString() }
    ],
    cronogramas: {},        // obraId -> { revisoes: [ {id, criadaEm, origem, tarefas: [...] } ] }
    // Central de projetos (P0): cada disciplina de uma obra guarda um histórico de revisões
    // de arquivo — nunca sobrescreve a anterior. obraId -> [ {id, nome, revisoes: [
    //   {id, codigo (R00, R01...), arquivoNome, arquivoUrl, tipoArquivo, criadaEm, notasDeMudanca}
    // ]} ]
    disciplinas: {},
    // Elementos marcados manualmente pelo usuário ao comparar duas revisões — a "marcação de
    // alteração" do P0. obraId -> [ {id, disciplinaId, revisaoId, pagina, xPct, yPct, descricao, criadoEm} ]
    elementos: {},
    incompatibilidades: {}, // obraId -> [ {...} ]
    checklistPadrao: [
      'Shafts e passagens de tubulação por estrutura',
      'Furos em lajes e vigas',
      'Nível de forro x luminárias x ar-condicionado',
      'Cruzamento de dutos hidráulicos e elétricos',
      'Interferência entre estrutura metálica e instalações',
      'Compatibilização física entre ofícios concorrentes (sequenciamento)'
    ],
    // Módulo de mão de obra (Fase 2 do PRD) — índices aproximados citados no seu
    // próprio estudo (TCPO/SINAPI), editáveis pelo usuário.
    bibliotecaProdutividade: [
      { id: 'ip-1', especialidade: 'pedreiro', servico: 'Revestimento cerâmico/porcelanato', unidade: 'm²', indiceHhPorUnidade: 0.65, fonte: 'TCPO' },
      { id: 'ip-2', especialidade: 'pedreiro', servico: 'Alvenaria e emboço', unidade: 'm²', indiceHhPorUnidade: 0.55, fonte: 'TCPO' },
      { id: 'ip-3', especialidade: 'pintor', servico: 'Pintura', unidade: 'm²', indiceHhPorUnidade: 0.35, fonte: 'Estimativa geral' },
      { id: 'ip-4', especialidade: 'ajudante', servico: 'Demolição e remoção', unidade: 'm²', indiceHhPorUnidade: 0.35, fonte: 'Estimativa geral' },
      { id: 'ip-5', especialidade: 'gesseiro', servico: 'Forro de gesso', unidade: 'm²', indiceHhPorUnidade: 0.45, fonte: 'Estimativa geral' },
      { id: 'ip-6', especialidade: 'serralheiro', servico: 'Esquadrias e vidros', unidade: 'un', indiceHhPorUnidade: 2.5, fonte: 'Estimativa geral' },
      { id: 'ip-7', especialidade: 'encanador', servico: 'Instalações hidrossanitárias', unidade: 'un', indiceHhPorUnidade: 3.0, fonte: 'Estimativa geral' },
      { id: 'ip-8', especialidade: 'marceneiro', servico: 'Marcenaria/mobiliário', unidade: 'un', indiceHhPorUnidade: 2.0, fonte: 'Estimativa geral' }
    ],
    orcamentos: {},     // obraId -> [ {id, especialidade, servico, unidade, quantidade, indiceUsado, horasHomem} ]
    efetivoDiario: {}   // obraId -> [ {id, especialidade, data, quantidade} ]
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    save(defaultData());
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  // Migração leve: preenche chaves novas que um db.json antigo não teria.
  const defaults = defaultData();
  let mudou = false;
  for (const key of Object.keys(defaults)) {
    if (!(key in data)) { data[key] = defaults[key]; mudou = true; }
  }
  if (!('elementos' in data)) { data.elementos = {}; mudou = true; }
  // Migração de estrutura: disciplinas antigas (arquivo único, sem versionamento) viram
  // disciplinas com uma revisão R00 — nunca perde dado de uma versão anterior do protótipo.
  for (const obraId of Object.keys(data.disciplinas || {})) {
    data.disciplinas[obraId] = (data.disciplinas[obraId] || []).map((d) => {
      if (d.revisoes) return d; // já está no formato novo
      mudou = true;
      return {
        id: d.id,
        nome: d.nome,
        revisoes: d.arquivoUrl ? [{
          id: 'rev-' + d.id,
          codigo: 'R00',
          arquivoNome: d.arquivoNome,
          arquivoUrl: d.arquivoUrl,
          tipoArquivo: (d.arquivoNome || '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'imagem',
          criadaEm: d.uploadEm || new Date().toISOString(),
          notasDeMudanca: ''
        }] : []
      };
    });
  }
  if (mudou) save(data);
  return data;
}

function save(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { load, save };
