import {
  compile,
  evaluate,
  tick,
  truthTable,
  initialInputs,
  initialState,
  serialize,
  traceCSV,
  EXAMPLES,
} from './core.js';
const $ = (id) => document.getElementById(id);
let circuit,
  inputs,
  state,
  trace = [],
  selected = null,
  fileRevision = 0;
function el(tag, text) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
}
function svg(tag, attrs, text) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
function showView(view) {
  for (const name of ['circuit', 'truth', 'netlist']) {
    $(name + '-view').hidden = name !== view;
    document
      .querySelector(`[data-view="${name}"]`)
      .setAttribute('aria-pressed', String(name === view));
  }
}
for (const button of document.querySelectorAll('[data-view]'))
  button.addEventListener('click', () => showView(button.dataset.view));
function status(text) {
  $('status').textContent = text;
}
function load(source) {
  const candidate = compile(source);
  fileRevision++;
  circuit = candidate;
  inputs = initialInputs(circuit);
  state = initialState(circuit);
  trace = [];
  selected = null;
  $('title').textContent = circuit.name;
  $('editor').value = JSON.stringify(serialize(circuit), null, 2);
  render();
  showView('circuit');
  status(
    `Validated ${circuit.nodes.length} nodes · ${circuit.inputs.length} inputs · ${circuit.registers.length} registers.`,
  );
}
function inspect(id, values) {
  selected = id;
  for (const node of $('graph').querySelectorAll('.node'))
    node.classList.toggle('selected', node.dataset.node === id);
  const n = circuit.nodes.find((n) => n.id === id),
    fanout = circuit.nodes
      .filter((node) => (node.inputs || []).includes(id))
      .map((node) => node.id);
  $('inspector').textContent =
    `${id} / ${n.type.toUpperCase()} = ${values[id]} · inputs: ${(n.inputs || []).map((dep) => `${dep}=${values[dep]}`).join(', ') || 'none'} · drives: ${fanout.join(', ') || 'output only'}${n.type === 'dff' ? ` · next sampled D = ${values[n.inputs[0]]}` : ''}`;
}
function graph(values) {
  const groups = new Map(),
    positions = new Map();
  for (const node of circuit.nodes) {
    const level = circuit.levels[node.id];
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(node);
  }
  const width = Math.max(700, (Math.max(...groups.keys()) + 1) * 170 + 50),
    height = Math.max(330, Math.max(...[...groups.values()].map((g) => g.length)) * 76 + 80);
  for (const [level, nodes] of groups)
    nodes.forEach((n, i) => positions.set(n.id, { x: 30 + level * 170, y: 40 + i * 76 }));
  const canvas = $('graph');
  canvas.setAttribute('width', width);
  canvas.setAttribute('height', height);
  canvas.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const frag = document.createDocumentFragment();
  for (const n of circuit.nodes)
    for (const [index, dep] of (n.inputs || []).entries()) {
      const a = positions.get(dep),
        b = positions.get(n.id),
        startX = a.x + 110,
        startY = a.y + 23,
        endX = b.x,
        endY = b.y + 12 + index * 10;
      const path = svg('path', {
        d: `M ${startX} ${startY} C ${startX + 35} ${startY}, ${endX - 35} ${endY}, ${endX} ${endY}`,
        fill: 'none',
        stroke: values[dep] ? '#26885f' : '#b0bdb6',
        'stroke-width': values[dep] ? 2 : 1,
        'stroke-dasharray': n.type === 'dff' ? '4 4' : 'none',
        class: 'wire',
      });
      path.append(svg('title', {}, `${dep} → ${n.id} input ${index + 1}: ${values[dep]}`));
      frag.append(path);
    }
  for (const n of circuit.nodes) {
    const p = positions.get(n.id),
      group = svg('g', {
        class: 'node',
        'data-node': n.id,
        role: 'button',
        tabindex: 0,
        'aria-label': `Inspect ${n.id}, ${n.type}, value ${values[n.id]}`,
      });
    group.append(
      svg('rect', {
        x: p.x,
        y: p.y,
        width: 110,
        height: 46,
        rx: n.type === 'dff' ? 2 : 8,
        fill: values[n.id] ? '#e1f1e7' : '#ffffff',
        stroke: values[n.id] ? '#26885f' : '#a7b5ac',
      }),
      svg('text', { x: p.x + 10, y: p.y + 18 }, n.id),
      svg('text', { x: p.x + 10, y: p.y + 34, class: 'kind' }, n.type.toUpperCase()),
      svg('text', { x: p.x + 93, y: p.y + 27 }, values[n.id]),
    );
    group.addEventListener('click', () => inspect(n.id, values));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        inspect(n.id, values);
      }
    });
    frag.append(group);
  }
  canvas.replaceChildren(frag);
  if (selected) inspect(selected, values);
  else $('inspector').textContent = 'Select a node to inspect its value and connections.';
}
function wave() {
  const rows = trace.slice(-32),
    canvas = $('wave'),
    left = 100,
    cell = 33,
    width = Math.max(700, left + Math.max(1, rows.length) * cell + 20),
    height = circuit.outputs.length * 44 + 40;
  canvas.setAttribute('width', width);
  canvas.setAttribute('height', height);
  const frag = document.createDocumentFragment();
  rows.forEach((row, i) => {
    frag.append(
      svg('text', { x: left + i * cell + 12, y: 16 }, trace.length - rows.length + i + 1),
      svg('line', {
        x1: left + i * cell,
        y1: 22,
        x2: left + i * cell,
        y2: height,
        stroke: '#dce4df',
      }),
    );
  });
  circuit.outputs.forEach((id, lane) => {
    const y = 35 + lane * 44;
    frag.append(svg('text', { x: 14, y: y + 12 }, id));
    if (!rows.length) return;
    let previous = rows[0].before[id],
      path = `M ${left} ${y + (previous ? 0 : 20)}`;
    for (let i = 0; i < rows.length; i++) {
      const value = rows[i].after[id],
        x = left + i * cell;
      path += ` L ${x} ${y + (previous ? 0 : 20)} L ${x} ${y + (value ? 0 : 20)} L ${x + cell} ${y + (value ? 0 : 20)}`;
      previous = value;
    }
    frag.append(svg('path', { d: path, fill: 'none', stroke: '#26885f', 'stroke-width': 2 }));
  });
  canvas.replaceChildren(frag);
  $('trace-info').textContent = trace.length
    ? `Showing the last ${rows.length} of ${trace.length} sampled edges. CSV retains the complete trace (limit 256). Waveforms show outputs immediately after each edge.`
    : 'No clock edges yet. Input changes alone are not clock samples.';
}
function truth() {
  const table = truthTable(circuit, state),
    header = el('tr');
  for (const text of [
    ...circuit.inputs.map((id) => `in:${id}`),
    ...circuit.outputs.map((id) => `out:${id}`),
    ...circuit.registers.map((id) => `next:${id}`),
  ])
    header.append(el('th', text));
  $('truth-head').replaceChildren(header);
  $('truth-body').replaceChildren(
    ...table.rows.map((row) => {
      const tr = el('tr');
      for (const value of [
        ...circuit.inputs.map((id) => row.inputs[id]),
        ...circuit.outputs.map((id) => row.outputs[id]),
        ...circuit.registers.map((id) => row.nextState[id]),
      ])
        tr.append(el('td', value));
      return tr;
    }),
  );
  $('truth-state').textContent = circuit.registers.length
    ? `Registers fixed at ${Object.entries(state)
        .map(([id, v]) => `${id}=${v}`)
        .join(
          ', ',
        )}. “next” columns show what one edge would sample; the table does not advance the clock.`
    : 'Combinational truth table over every input assignment.';
}
function render() {
  const focusedInput = document.activeElement?.getAttribute('data-input');
  const current = evaluate(circuit, inputs, state);
  $('inputs').replaceChildren(
    ...circuit.inputs.map((id) => {
      const button = el('button', `${id} / ${inputs[id]}`);
      button.dataset.input = id;
      button.setAttribute('aria-label', `Toggle input ${id}`);
      button.setAttribute('aria-pressed', String(inputs[id] === 1));
      button.addEventListener('click', () => {
        fileRevision++;
        inputs[id] = 1 - inputs[id];
        render();
        status(`Input ${id} is ${inputs[id]}; registers unchanged.`);
      });
      return button;
    }),
  );
  if (focusedInput)
    [...$('inputs').children]
      .find((button) => button.dataset.input === focusedInput)
      ?.focus({ preventScroll: true });
  if (!circuit.inputs.length) $('inputs').append(el('p', 'No external inputs.'));
  $('outputs').replaceChildren(
    ...circuit.outputs.map((id) => {
      const bit = el('div');
      bit.className = `bit ${current.outputs[id] ? 'high' : ''}`;
      bit.append(el('small', id), el('span', current.outputs[id]));
      return bit;
    }),
  );
  $('edge').textContent = trace.length;
  $('tick').disabled = $('eight').disabled = !circuit.registers.length || trace.length >= 256;
  $('undo').disabled = !trace.length;
  $('csv').disabled = !trace.length;
  graph(current.values);
  wave();
  truth();
}
function step(count) {
  fileRevision++;
  for (let i = 0; i < count && trace.length < 256; i++) {
    const edge = tick(circuit, inputs, state);
    trace.push(edge);
    state = edge.state;
  }
  render();
  status(
    trace.length >= 256
      ? 'Trace reached 256 edges. Export, undo, or reset before continuing.'
      : `Sampled edge ${trace.length}; all registers updated together.`,
  );
}
$('tick').addEventListener('click', () => step(1));
$('eight').addEventListener('click', () => step(8));
$('undo').addEventListener('click', () => {
  fileRevision++;
  const edge = trace.pop();
  state = { ...edge.beforeState };
  inputs = { ...edge.inputs };
  render();
  status('Undid one clock edge and restored its sampled inputs.');
});
$('reset').addEventListener('click', () => {
  fileRevision++;
  state = initialState(circuit);
  inputs = initialInputs(circuit);
  trace = [];
  render();
  status('Restored initial register values and zeroed external inputs.');
});
$('example').addEventListener('change', () => load(EXAMPLES[$('example').value]));
$('apply').addEventListener('click', () => {
  try {
    load(JSON.parse($('editor').value));
  } catch (e) {
    status(`Netlist rejected: ${e.message}`);
  }
});
$('editor').addEventListener('input', () => fileRevision++);
function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('save').addEventListener('click', () =>
  download('circuit-netlist.json', JSON.stringify(serialize(circuit), null, 2)),
);
$('csv').addEventListener('click', () =>
  download('circuit-trace.csv', traceCSV(circuit, trace), 'text/csv;charset=utf-8'),
);
$('truth-export').addEventListener('click', () =>
  download(
    'circuit-truth-table.json',
    JSON.stringify({ circuit: serialize(circuit), ...truthTable(circuit, state) }, null, 2),
  ),
);
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (!file) return;
  const ticket = ++fileRevision;
  try {
    if (file.size > 30000) throw Error('Netlists must be at most 30 KB.');
    const candidate = JSON.parse(await file.text());
    if (ticket === fileRevision) load(candidate);
  } catch (e) {
    if (ticket === fileRevision) status(`Netlist rejected: ${e.message}`);
  } finally {
    $('file').value = '';
  }
});
load(EXAMPLES.adder);
