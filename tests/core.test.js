import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compile,
  evaluate,
  tick,
  truthTable,
  initialState,
  initialInputs,
  serialize,
  traceCSV,
  EXAMPLES,
} from '../core.js';
test('full adder truth table matches integer addition for all eight inputs', () => {
  const c = compile(EXAMPLES.adder),
    table = truthTable(c);
  assert.equal(table.rows.length, 8);
  for (const row of table.rows) {
    const sum = Object.values(row.inputs).reduce((a, b) => a + b, 0);
    assert.equal(row.outputs.sum, sum % 2);
    assert.equal(row.outputs.carry, Math.floor(sum / 2));
  }
});
test('flip-flops sample simultaneously rather than cascading on one edge', () => {
  const c = compile(EXAMPLES.shift),
    before = initialState(c),
    first = tick(c, { data: 1 }, before);
  assert.deepEqual(first.state, { q0: 1, q1: 0, q2: 0 });
  const second = tick(c, { data: 0 }, first.state);
  assert.deepEqual(second.state, { q0: 0, q1: 1, q2: 0 });
  const third = tick(c, { data: 0 }, second.state);
  assert.deepEqual(third.state, { q0: 0, q1: 0, q2: 1 });
  assert.deepEqual(before, { q0: 0, q1: 0, q2: 0 });
});
test('enabled counter wraps modulo eight and holds when disabled', () => {
  const c = compile(EXAMPLES.counter);
  let state = initialState(c);
  for (let i = 1; i <= 64; i++) {
    state = tick(c, { enable: 1 }, state).state;
    assert.equal(state.q0 + 2 * state.q1 + 4 * state.q2, i % 8);
    assert.deepEqual(tick(c, { enable: 0 }, state).state, state);
  }
});
test('clock reset values and input changes are distinct from register sampling', () => {
  const c = compile({
    name: 'Hold',
    nodes: [
      { id: 'd', type: 'input' },
      { id: 'q', type: 'dff', inputs: ['d'], initial: 1 },
    ],
    outputs: ['q'],
  });
  assert.equal(evaluate(c, { d: 0 }).outputs.q, 1);
  assert.equal(tick(c, { d: 0 }, initialState(c)).after.q, 0);
  assert.deepEqual(initialInputs(c), { d: 0 });
});
test('combinational cycle reports its path while registered feedback is legal', () => {
  assert.throws(
    () =>
      compile({
        name: 'Loop',
        nodes: [
          { id: 'a', type: 'not', inputs: ['b'] },
          { id: 'b', type: 'not', inputs: ['a'] },
        ],
        outputs: ['a'],
      }),
    /a → b → a/,
  );
  const c = compile({
    name: 'Toggle',
    nodes: [
      { id: 'q', type: 'dff', inputs: ['n'], initial: 0 },
      { id: 'n', type: 'not', inputs: ['q'] },
    ],
    outputs: ['q'],
  });
  assert.equal(tick(c, {}, initialState(c)).state.q, 1);
});
test('all gate operations and mux argument order are explicit', () => {
  for (let bits = 0; bits < 8; bits++) {
    const a = (bits >> 2) & 1,
      b = (bits >> 1) & 1,
      s = bits & 1;
    const c = compile({
      name: 'Gates',
      nodes: [
        { id: 'a', type: 'input' },
        { id: 'b', type: 'input' },
        { id: 's', type: 'input' },
        { id: 'and', type: 'and', inputs: ['a', 'b'] },
        { id: 'or', type: 'or', inputs: ['a', 'b'] },
        { id: 'xor', type: 'xor', inputs: ['a', 'b'] },
        { id: 'not', type: 'not', inputs: ['a'] },
        { id: 'mux', type: 'mux', inputs: ['s', 'a', 'b'] },
        { id: 'one', type: 'const', value: 1 },
      ],
      outputs: ['and', 'or', 'xor', 'not', 'mux', 'one'],
    });
    assert.deepEqual(evaluate(c, { a, b, s }).outputs, {
      and: a & b,
      or: a | b,
      xor: a ^ b,
      not: 1 - a,
      mux: s ? b : a,
      one: 1,
    });
  }
});
test('declaration order does not alter evaluation or register semantics', () => {
  for (const example of Object.values(EXAMPLES)) {
    const a = compile(example),
      b = compile({ ...example, nodes: [...example.nodes].reverse() }),
      inputs = initialInputs(a),
      state = initialState(a);
    assert.deepEqual(evaluate(a, inputs, state).outputs, evaluate(b, inputs, state).outputs);
    assert.deepEqual(tick(a, inputs, state).state, tick(b, inputs, state).state);
  }
});
test('state-conditioned truth tables report next state without advancing registers', () => {
  const c = compile(EXAMPLES.counter),
    state = { q0: 1, q1: 1, q2: 0 },
    table = truthTable(c, state);
  assert.deepEqual(table.rows[0].nextState, state);
  assert.deepEqual(table.rows[1].nextState, { q0: 0, q1: 0, q2: 1 });
  assert.deepEqual(table.rows[1].outputs, { q2: 0, q1: 1, q0: 1 });
  assert.deepEqual(state, { q0: 1, q1: 1, q2: 0 });
});
test('malformed netlists, arities, references, IDs, and vectors are rejected', () => {
  for (const bad of [
    { ...EXAMPLES.adder, extra: 1 },
    { ...EXAMPLES.adder, outputs: ['missing'] },
    { ...EXAMPLES.adder, nodes: [{ id: 'x', type: 'not', inputs: [] }] },
    { ...EXAMPLES.adder, nodes: [{ id: 'x', type: 'not', inputs: ['absent'] }] },
    {
      ...EXAMPLES.adder,
      nodes: [
        { id: 'x', type: 'input' },
        { id: 'x', type: 'input' },
      ],
    },
    { ...EXAMPLES.adder, nodes: [{ id: '__proto__', type: 'input' }] },
    { ...EXAMPLES.adder, nodes: [{ id: 'x', type: 'const', value: 2 }] },
  ])
    assert.throws(() => compile(bad));
  const c = compile(EXAMPLES.shift);
  for (const values of [{}, { data: true }, { data: 0, extra: 0 }])
    assert.throws(() => evaluate(c, values));
  assert.throws(() => evaluate(c, { data: 0 }, { q0: 0, q1: 0, q2: 2 }));
});
test('random acyclic circuits match an independent recursive Boolean evaluator', () => {
  let seed = 712;
  const rand = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let trial = 0; trial < 120; trial++) {
    const nodes = [
      { id: 'a', type: 'input' },
      { id: 'b', type: 'input' },
      { id: 'c', type: 'input' },
    ];
    for (let i = 0; i < 15; i++) {
      const type = ['and', 'or', 'xor', 'not', 'mux'][rand(5)],
        arity = type === 'not' ? 1 : type === 'mux' ? 3 : 2;
      nodes.push({
        id: `n${i}`,
        type,
        inputs: Array.from({ length: arity }, () => nodes[rand(nodes.length)].id),
      });
    }
    const c = compile({ name: 'Generated', nodes, outputs: ['n14', 'n13'] });
    for (const row of truthTable(c).rows) {
      function ref(id) {
        const n = nodes.find((n) => n.id === id);
        if (n.type === 'input') return !!row.inputs[id];
        const a = n.inputs.map(ref);
        if (n.type === 'and') return a[0] && a[1];
        if (n.type === 'or') return a[0] || a[1];
        if (n.type === 'xor') return a[0] !== a[1];
        if (n.type === 'not') return !a[0];
        return a[0] ? a[2] : a[1];
      }
      for (const id of c.outputs) assert.equal(row.outputs[id], Number(ref(id)));
    }
  }
});
test('serialization and traces preserve source immutability and sampled values', () => {
  const source = structuredClone(EXAMPLES.shift),
    c = compile(source),
    trace = [tick(c, { data: 1 }, initialState(c))];
  assert.deepEqual(serialize(c), source);
  assert.deepEqual(source, EXAMPLES.shift);
  const csv = traceCSV(c, trace);
  assert.ok(csv.includes('"before:q0"'));
  assert.ok(csv.includes('"1","1","0","0","0","1","0","0","1","0","0"'));
  assert.throws(() => traceCSV(c, Array(257).fill(trace[0])));
});
