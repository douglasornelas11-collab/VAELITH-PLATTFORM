// Importador de cronograma — suporta os formatos que a engenharia realmente usa:
//  - MS Project XML (exportado de .mpp: Arquivo > Salvar Como > XML)
//  - Excel/CSV (planilha com colunas: Tarefa, Início, Término, Duração, Predecessora, Recurso, WBS)
// Leitura de .mpp binário nativo fica para uma fase futura (exige parser tipo MPXJ);
// por enquanto o caminho prático é exportar para XML do próprio MS Project, coberto abaixo.
const xlsx = require('xlsx');
const { DOMParser } = require('@xmldom/xmldom');

function parseMSProjectXML(buffer) {
  const xml = buffer.toString('utf-8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const taskNodes = Array.from(doc.getElementsByTagName('Task'));
  const tarefas = [];
  for (const node of taskNodes) {
    const get = (tag) => {
      const el = node.getElementsByTagName(tag)[0];
      return el && el.textContent ? el.textContent.trim() : '';
    };
    const uid = get('UID');
    const nome = get('Name');
    if (!nome || uid === '0') continue; // ignora o nó raiz do projeto
    tarefas.push({
      id: uid || String(tarefas.length + 1),
      wbs: get('WBS') || '',
      tarefa: nome,
      inicio: (get('Start') || '').slice(0, 10),
      termino: (get('Finish') || '').slice(0, 10),
      duracaoDias: parseDurationToDays(get('Duration')),
      predecessora: get('PredecessorLink') || '',
      recurso: get('ResourceNames') || '',
      percentConcluido: Number(get('PercentComplete') || 0)
    });
  }
  return tarefas;
}

function parseDurationToDays(pt) {
  // MS Project usa duração no formato ISO 8601 (PT..H). Aproximação: 8h = 1 dia útil.
  if (!pt) return null;
  const match = /PT([\d.]+)H/.exec(pt);
  if (match) return Math.round((parseFloat(match[1]) / 8) * 10) / 10;
  return null;
}

function parseSpreadsheet(buffer, filename) {
  // codepage 65001 = UTF-8 — sem isso, .csv com acentos (Instalação, Compatibilização...)
  // vem corrompido do parser (a biblioteca assume Latin-1 por padrão para CSV puro).
  // .xlsx não é afetado (a codificação já vem declarada dentro do próprio arquivo).
  const wb = xlsx.read(buffer, { type: 'buffer', cellDates: true, codepage: 65001 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  const norm = (obj, keys) => {
    for (const k of keys) {
      const found = Object.keys(obj).find((x) => x.toLowerCase().trim() === k);
      if (found) return obj[found];
    }
    return '';
  };
  const toISO = (v) => {
    if (!v) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const d = new Date(v);
    return isNaN(d) ? String(v) : d.toISOString().slice(0, 10);
  };
  return rows.map((row, i) => ({
    id: String(norm(row, ['id']) || i + 1),
    wbs: norm(row, ['wbs', 'eap']),
    tarefa: norm(row, ['tarefa', 'atividade', 'task', 'name', 'nome']),
    inicio: toISO(norm(row, ['início', 'inicio', 'start'])),
    termino: toISO(norm(row, ['término', 'termino', 'fim', 'finish', 'end'])),
    duracaoDias: Number(norm(row, ['duração', 'duracao', 'duration', 'dias'])) || null,
    predecessora: String(norm(row, ['predecessora', 'predecessor', 'depende de'])),
    recurso: String(norm(row, ['recurso', 'resource', 'especialidade'])),
    percentConcluido: Number(norm(row, ['% concluído', 'percent complete', 'conclusao'])) || 0
  })).filter((t) => t.tarefa);
}

function parseCronograma(buffer, filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xml')) {
    return { origem: 'MS Project XML', tarefas: parseMSProjectXML(buffer) };
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
    return { origem: 'Excel/CSV', tarefas: parseSpreadsheet(buffer, filename) };
  }
  throw new Error('Formato não suportado nesta fase. Use .xlsx, .csv ou .xml (exportado do MS Project).');
}

module.exports = { parseCronograma };
