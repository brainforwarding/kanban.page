'use strict';
/* Output. The fingerprint line is the point: picking the wrong board is not a
   local mistake, because the relay broadcasts to every watching device in about
   a second. Every mutating command says which board it fetched and what that
   board looks like before it says what it did. */

const ops = require('./ops.js');

/** Exit codes: a small stable taxonomy, not one per HTTP status. */
const EXIT = {
  ok: 0,
  usage: 2,
  credential: 3,
  'not-found': 4,
  gone: 5,
  contention: 6,
  'outcome-unknown': 7,
  transport: 8,
  protocol: 9,
};

function fingerprint(name, st, ver) {
  const stages = st.columns
    .map(c => `${c.name.toUpperCase()} ${ops.live(st).filter(t => t.columnId === c.id).length}`)
    .join(' / ');
  return `${name} · ${stages} · ver ${ver}`;
}

function summaryLine(s) {
  const bits = [s.verb, s.stage ? s.stage.toUpperCase() : '', s.title].filter(Boolean);
  let line = '  ' + bits.join('  ');
  if (s.from) line = `  ${s.verb}  ${s.from.toUpperCase()} → ${s.stage.toUpperCase()}  ${s.title}`;
  if (s.project) line += `  · ${s.project}`;
  return line;
}

function card(st, t) {
  const p = ops.projectName(st, t);
  return [
    t.id.slice(0, 6),
    t.flag ? '★' : ' ',
    t.title,
    p ? `· ${p}` : '',
    t.archivedAt ? '⊘' : '',
  ].filter(Boolean).join('  ');
}

function list(st, { stage, project, all } = {}) {
  const out = [];
  const pool = (all ? st.tasks : ops.live(st));
  for (const c of st.columns) {
    if (stage && c.name.toLowerCase() !== stage.toLowerCase()) continue;
    let cards = pool.filter(t => t.columnId === c.id && !t.archivedAt)
      .sort((a, b) => a.order - b.order);
    if (project) cards = cards.filter(t => (ops.projectName(st, t) || '').toLowerCase() === project.toLowerCase());
    out.push(`${c.name.toUpperCase()}  ${cards.length}`);
    for (const t of cards) out.push('  ' + card(st, t));
    out.push('');
  }
  if (all) {
    const arch = st.tasks.filter(t => t.archivedAt);
    if (arch.length) {
      out.push(`ARCHIVE  ${arch.length}`);
      for (const t of arch) out.push('  ' + card(st, t));
    }
  }
  return out.join('\n').trimEnd();
}

function show(st, t) {
  const lines = [
    `${t.title}`,
    `id       ${t.id}`,
    `stage    ${t.archivedAt ? 'archive (from ' + ops.colName(st, t.archivedFrom) + ')' : ops.colName(st, t.columnId)}`,
    `project  ${ops.projectName(st, t) || '—'}`,
    `flag     ${t.flag ? 'yes' : 'no'}`,
  ];
  if (t.session) lines.push(`session  ${t.session}`);
  if (t.notes) lines.push('', t.notes);
  return lines.join('\n');
}

module.exports = { EXIT, fingerprint, summaryLine, list, show, card };
