import test from 'node:test';
import assert from 'node:assert/strict';
import { defineMatch, createMatchbox } from '../dist/src/index.js';

test('definition is inert and frozen', () => {
  let calls = 0;
  const match = defineMatch({ name:'clock', input:{parse:x=>x}, run:()=>{calls++;return 3}, verify:x=>x===3 });
  assert.equal(calls, 0);
  assert.equal(Object.isFrozen(match), true);
});

test('definition rejects missing verifier, parser, name', () => {
  assert.throws(() => defineMatch({name:'clock',input:{parse:x=>x},run:()=>1}), /verify/);
  assert.throws(() => defineMatch({name:'clock',run:()=>1,verify:()=>true}), /input.parse/);
  assert.throws(() => defineMatch({name:'',input:{parse:x=>x},run:()=>1,verify:()=>true}), /name/);
});

test('registration is explicit and duplicates fail', () => {
  const match = defineMatch({name:'clock', input:{parse:x=>x},run:()=>1,verify:()=>true});
  assert.throws(() => createMatchbox({matches:[match,match],recorder:{createPending:async()=>{},settle:async()=>{}}, dependencies:{}}), /Duplicate/);
});

test('durable recorder is mandatory', () => {
  assert.throws(() => createMatchbox({matches:[],dependencies:{}}), /durable recorder/);
});
