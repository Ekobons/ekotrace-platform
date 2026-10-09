import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchVehicleType, splitQuantity } from '../src/lib/vehicleMatch.js';

const codes = [
  'veh:cars_by_size:average-car:petrol', 'veh:cars_by_size:average-car:diesel', 'veh:cars_by_size:average-car:unknown', 'veh:cars_by_size:average-car:hybrid',
  'veh:cars_by_size:average-car:battery-electric-vehicle', 'veh:cars_by_size:small-car:petrol', 'veh:cars_by_size:medium-car:plug-in-hybrid-electric-vehicle',
  'veh:cars_by_size:average-car:cng', 'veh:cars_by_segment:dual-purpose-4x4:diesel', 'veh:cars_by_segment:executive:petrol',
  'veh:vans:average-up-to-3-5-tonnes:diesel', 'veh:vans:class-iii-1-74-to-3-5-tonnes:diesel', 'veh:vans:average-up-to-3-5-tonnes:unknown',
  'veh:hgv:rigid-17-tonnes:average-laden', 'veh:hgv:rigid-7-5-tonnes-17-tonnes:100-laden', 'veh:hgv:all-hgvs:average-laden', 'veh:hgv:articulated-33t:average-laden',
  'veh:hgv_refrigerated:rigid-3-5-7-5-tonnes:average-laden', 'veh:motorbikes:average:any', 'mach:lpg', 'mach:diesel', 'mach:electric',
];
const types = codes.map((code, id) => ({ id: id + 1, code, name: code }));
const m = (s: string) => matchVehicleType(s, types)?.type.code ?? null;

test('everyday names read as DESNZ vehicle types', () => {
  assert.equal(m('car petrol'), 'veh:cars_by_size:average-car:petrol');
  assert.equal(m('Petrol Car'), 'veh:cars_by_size:average-car:petrol');
  assert.equal(m('small car petrol'), 'veh:cars_by_size:small-car:petrol');
  assert.equal(m('car'), 'veh:cars_by_size:average-car:unknown');
  assert.equal(m('Tesla model 3'), 'veh:cars_by_size:average-car:battery-electric-vehicle');
  assert.equal(m('medium plug-in hybrid'), 'veh:cars_by_size:medium-car:plug-in-hybrid-electric-vehicle');
  assert.equal(m('SUV diesel'), 'veh:cars_by_segment:dual-purpose-4x4:diesel');
  assert.equal(m('Land Cruiser diesel'), 'veh:cars_by_segment:dual-purpose-4x4:diesel');
  assert.equal(m('small car CNG'), 'veh:cars_by_size:average-car:cng', 'no small CNG car in DESNZ: average used');
  assert.equal(m('pickup diesel'), 'veh:vans:average-up-to-3-5-tonnes:diesel');
  assert.equal(m('van class 3 diesel'), 'veh:vans:class-iii-1-74-to-3-5-tonnes:diesel');
  assert.equal(m('tipper 18t'), 'veh:hgv:rigid-17-tonnes:average-laden');
  assert.equal(m('Refuse truck 12 ton full'), 'veh:hgv:rigid-7-5-tonnes-17-tonnes:100-laden');
  assert.equal(m('truck'), 'veh:hgv:all-hgvs:average-laden');
  assert.equal(m('articulated 40 t'), 'veh:hgv:articulated-33t:average-laden');
  assert.equal(m('refrigerated truck 7t'), 'veh:hgv_refrigerated:rigid-3-5-7-5-tonnes:average-laden');
  assert.equal(m('motorcycle'), 'veh:motorbikes:average:any');
  assert.equal(m('forklift LPG'), 'mach:lpg');
  assert.equal(m('wheel loader'), 'mach:diesel');
  assert.equal(m('electric forklift'), 'mach:electric');
  assert.equal(m('veh:hgv:all-hgvs:average-laden'), 'veh:hgv:all-hgvs:average-laden', 'exact type name');
  assert.equal(m('Spaceship'), null);
  assert.equal(m(''), null);
  assert.deepEqual(matchVehicleType('car', types)!.assumed, ['fuel unknown', 'average size']);
});

test('quantity with its unit in one cell', () => {
  assert.deepEqual(splitQuantity('34km'), { qty: 34, unit: 'km' });
  assert.deepEqual(splitQuantity('1,200 L'), { qty: 1200, unit: 'L' });
  assert.deepEqual(splitQuantity('250'), { qty: 250, unit: '' });
  assert.deepEqual(splitQuantity('abc'), { qty: null, unit: '' });
});
