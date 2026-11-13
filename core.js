const ARITY = { not: 1, and: 2, or: 2, xor: 2, mux: 3, dff: 1, input: 0, const: 0 };
const own = (o, k) => Object.hasOwn(o, k);
function bit(value) {
  if (value !== 0 && value !== 1) throw Error('Logic values must be numeric 0 or 1.');
  return value;
}
export function compile(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 3 ||
    !['name', 'nodes', 'outputs'].every((k) => own(input, k))
  )
    throw Error('Circuit needs name, nodes, and outputs only.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80)
    throw Error('Circuit name must contain 1–80 characters.');
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > 64)
    throw Error('Use 1–64 nodes.');
  const nodes = input.nodes.map((n) => structuredClone(n)),
    byId = new Map();
  for (const n of nodes) {
    if (
      !n ||
      typeof n !== 'object' ||
      Array.isArray(n) ||
      typeof n.id !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(n.id) ||
      byId.has(n.id)
    )
      throw Error('Node IDs must be unique identifiers, 1–24 characters.');
    if (!own(ARITY, n.type)) throw Error(`${n.id}: unknown node type.`);
    const fields = [
      'id',
      'type',
      ...(ARITY[n.type] ? ['inputs'] : []),
      ...(['const', 'dff'].includes(n.type) ? [n.type === 'const' ? 'value' : 'initial'] : []),
    ];
    if (Object.keys(n).length !== fields.length || Object.keys(n).some((k) => !fields.includes(k)))
      throw Error(`${n.id}: unexpected or missing node fields.`);
    if (ARITY[n.type] && (!Array.isArray(n.inputs) || n.inputs.length !== ARITY[n.type]))
      throw Error(`${n.id}: ${n.type} needs ${ARITY[n.type]} inputs.`);
    if (n.type === 'const') bit(n.value);
    if (n.type === 'dff') bit(n.initial);
    byId.set(n.id, n);
  }
  for (const n of nodes)
    for (const id of n.inputs || [])
      if (typeof id !== 'string' || !byId.has(id))
        throw Error(`${n.id}: unknown input ${String(id)}.`);
  const inputs = nodes.filter((n) => n.type === 'input').map((n) => n.id),
    registers = nodes.filter((n) => n.type === 'dff').map((n) => n.id);
  if (inputs.length > 8 || registers.length > 16)
    throw Error('Use at most eight inputs and sixteen registers.');
  if (
    !Array.isArray(input.outputs) ||
    input.outputs.length < 1 ||
    input.outputs.length > 8 ||
    new Set(input.outputs).size !== input.outputs.length ||
    input.outputs.some((id) => !byId.has(id))
  )
    throw Error('Choose 1–8 unique existing output nodes.');
  const order = [],
    visited = new Set(),
    visiting = new Set(),
    stack = [],
    levels = {};
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const path = [...stack.slice(stack.indexOf(id)), id];
      throw Error(`Combinational cycle: ${path.join(' → ')}`);
    }
    const n = byId.get(id);
    visiting.add(id);
    stack.push(id);
    if (n.type !== 'dff') for (const dep of n.inputs || []) visit(dep);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    order.push(id);
    levels[id] =
      n.type === 'dff' || !n.inputs ? 0 : 1 + Math.max(...n.inputs.map((dep) => levels[dep]));
  }
  for (const n of nodes) visit(n.id);
  return {
    name: input.name.trim(),
    nodes,
    outputs: [...input.outputs],
    inputs,
    registers,
    order,
    levels,
  };
}
function vector(ids, values, label) {
  if (
    !values ||
    typeof values !== 'object' ||
    Array.isArray(values) ||
    Object.keys(values).length !== ids.length ||
    ids.some((id) => !own(values, id))
  )
    throw Error(`${label} must contain exactly: ${ids.join(', ') || '(none)'}.`);
  for (const value of Object.values(values)) bit(value);
}
export function initialState(circuit) {
  return Object.fromEntries(
    circuit.nodes.filter((n) => n.type === 'dff').map((n) => [n.id, n.initial]),
  );
}
export function initialInputs(circuit) {
  return Object.fromEntries(circuit.inputs.map((id) => [id, 0]));
}
export function evaluate(circuit, inputs = initialInputs(circuit), state = initialState(circuit)) {
  vector(circuit.inputs, inputs, 'Inputs');
  vector(circuit.registers, state, 'State');
  const byId = new Map(circuit.nodes.map((n) => [n.id, n])),
    values = {};
  for (const id of circuit.order) {
    const n = byId.get(id),
      args = (n.inputs || []).map((dep) => values[dep]);
    switch (n.type) {
      case 'input':
        values[id] = inputs[id];
        break;
      case 'const':
        values[id] = n.value;
        break;
      case 'dff':
        values[id] = state[id];
        break;
      case 'not':
        values[id] = 1 - args[0];
        break;
      case 'and':
        values[id] = args[0] & args[1];
        break;
      case 'or':
        values[id] = args[0] | args[1];
        break;
      case 'xor':
        values[id] = args[0] ^ args[1];
        break;
      case 'mux':
        values[id] = args[0] ? args[2] : args[1];
        break;
    }
  }
  return { values, outputs: Object.fromEntries(circuit.outputs.map((id) => [id, values[id]])) };
}
export function tick(circuit, inputs, state) {
  const before = evaluate(circuit, inputs, state),
    next = Object.fromEntries(
      circuit.nodes.filter((n) => n.type === 'dff').map((n) => [n.id, before.values[n.inputs[0]]]),
    ),
    after = evaluate(circuit, inputs, next);
  return {
    inputs: { ...inputs },
    beforeState: { ...state },
    state: next,
    before: before.outputs,
    after: after.outputs,
    values: after.values,
  };
}
export function truthTable(circuit, state = initialState(circuit)) {
  vector(circuit.registers, state, 'State');
  const rows = [];
  for (let bits = 0; bits < 2 ** circuit.inputs.length; bits++) {
    const inputs = Object.fromEntries(
        circuit.inputs.map((id, i) => [id, (bits >> (circuit.inputs.length - 1 - i)) & 1]),
      ),
      evaluated = evaluate(circuit, inputs, state),
      next = Object.fromEntries(
        circuit.nodes
          .filter((n) => n.type === 'dff')
          .map((n) => [n.id, evaluated.values[n.inputs[0]]]),
      );
    rows.push({ inputs, outputs: evaluated.outputs, nextState: next });
  }
  return { state: { ...state }, rows };
}
export function serialize(circuit) {
  return {
    name: circuit.name,
    nodes: structuredClone(circuit.nodes),
    outputs: [...circuit.outputs],
  };
}
export function traceCSV(circuit, trace) {
  if (!Array.isArray(trace) || trace.length > 256)
    throw Error('Trace is limited to 256 clock edges.');
  const header = [
    'edge',
    ...circuit.inputs.map((id) => `in:${id}`),
    ...circuit.registers.map((id) => `before:${id}`),
    ...circuit.registers.map((id) => `after:${id}`),
    ...circuit.outputs.map((id) => `out:${id}`),
  ];
  const rows = trace.map((row, i) => [
    i + 1,
    ...circuit.inputs.map((id) => row.inputs[id]),
    ...circuit.registers.map((id) => row.beforeState[id]),
    ...circuit.registers.map((id) => row.state[id]),
    ...circuit.outputs.map((id) => row.after[id]),
  ]);
  return (
    [header, ...rows]
      .map((row) => row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(','))
      .join('\r\n') + '\r\n'
  );
}
export const EXAMPLES = {
  adder: {
    name: 'One-bit full adder',
    nodes: [
      { id: 'a', type: 'input' },
      { id: 'b', type: 'input' },
      { id: 'cin', type: 'input' },
      { id: 'axb', type: 'xor', inputs: ['a', 'b'] },
      { id: 'sum', type: 'xor', inputs: ['axb', 'cin'] },
      { id: 'ab', type: 'and', inputs: ['a', 'b'] },
      { id: 'xc', type: 'and', inputs: ['axb', 'cin'] },
      { id: 'carry', type: 'or', inputs: ['ab', 'xc'] },
    ],
    outputs: ['sum', 'carry'],
  },
  shift: {
    name: 'Three-stage shift register',
    nodes: [
      { id: 'data', type: 'input' },
      { id: 'q0', type: 'dff', inputs: ['data'], initial: 0 },
      { id: 'q1', type: 'dff', inputs: ['q0'], initial: 0 },
      { id: 'q2', type: 'dff', inputs: ['q1'], initial: 0 },
    ],
    outputs: ['q0', 'q1', 'q2'],
  },
  counter: {
    name: 'Enabled three-bit counter',
    nodes: [
      { id: 'enable', type: 'input' },
      { id: 'q0', type: 'dff', inputs: ['next0'], initial: 0 },
      { id: 'q1', type: 'dff', inputs: ['next1'], initial: 0 },
      { id: 'q2', type: 'dff', inputs: ['next2'], initial: 0 },
      { id: 'next0', type: 'xor', inputs: ['q0', 'enable'] },
      { id: 'toggle1', type: 'and', inputs: ['q0', 'enable'] },
      { id: 'next1', type: 'xor', inputs: ['q1', 'toggle1'] },
      { id: 'both', type: 'and', inputs: ['q0', 'q1'] },
      { id: 'toggle2', type: 'and', inputs: ['both', 'enable'] },
      { id: 'next2', type: 'xor', inputs: ['q2', 'toggle2'] },
    ],
    outputs: ['q2', 'q1', 'q0'],
  },
};
