import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closetItemEditInput } from './closet-item-edit';

describe('closet item edit', () => {
  it('sends brand and cost and leaves wear history off the body', () => {
    const r = closetItemEditInput('itm_1', {
      name: ' Shoes ', brand: ' New ', color: ' black ', category: 'shoes', cost: '40',
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.input, {
      id: 'itm_1', name: 'Shoes', brand: 'New', color: 'black', category: 'shoes', cost: 40,
    });
    assert.equal('timesWorn' in r.input, false);
    assert.equal('lastWorn' in r.input, false);
    assert.equal('laundryStatus' in r.input, false);
  });

  it('a blank cost is not sent as zero', () => {
    const r = closetItemEditInput('itm_1', {
      name: 'Shoes', brand: '', color: '', category: 'shoes', cost: '  ',
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal('cost' in r.input, false);
    assert.equal(r.input.brand, '');
  });

  it('refuses an empty name and a cost that is not a number', () => {
    assert.equal(closetItemEditInput('itm_1', {
      name: '  ', brand: 'A', color: '', category: 'top', cost: '10',
    }).ok, false);
    const bad = closetItemEditInput('itm_1', {
      name: 'Tee', brand: '', color: '', category: 'top', cost: 'nope',
    });
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.match(bad.error, /number/);
  });
});
