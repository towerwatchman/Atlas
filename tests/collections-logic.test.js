import { groupGamesByCollection, UNCATEGORIZED_ID } from '../src/hooks/useCollections.js';
import { buildCollectionMenuItems } from '../src/components/collections/collectionMenu.js';
import { filterGamesWithState } from '../src/hooks/useFilters.js';

let fail = 0;
const check = (name, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

const games = [1,2,3,4].map((n) => ({ record_id: n, title: `G${n}`, hasInstalledVersion: true }));
const collections = [{ id: 1, name: 'Alpha', color: '#fff' }, { id: 2, name: 'Beta', color: null }];
// g1 -> Alpha; g2 -> Alpha+Beta; g3,g4 -> nothing
const map = new Map([[1, [1]], [2, [1, 2]]]);

const groups = groupGamesByCollection(games, collections, map);
check('every collection gets a group', groups.filter((g) => g.id !== UNCATEGORIZED_ID).length === 2);
check('multi-collection title appears in both', 
  groups[0].games.length === 2 && groups[1].games.length === 1);
check('uncategorized derived and last',
  groups[groups.length - 1].id === UNCATEGORIZED_ID && groups[groups.length - 1].games.length === 2);

const noneUncategorized = groupGamesByCollection([games[0]], collections, map);
check('uncategorized omitted when empty',
  !noneUncategorized.some((g) => g.id === UNCATEGORIZED_ID));

// Menu: g2 is in both, so Add to should offer only "+ New Collection"
const m2 = buildCollectionMenuItems({ recordId: 2, collections, memberOf: [1, 2] });
check('add-to omits collections already joined', m2[0].submenu.length === 1);
check('add-to always offers New Collection', m2[0].submenu[0].label === '+ New Collection');
check('remove-from lists both', m2[1].label === 'Remove from' && m2[1].submenu.length === 2);

// g3 is in nothing: no "Remove from" at all
const m3 = buildCollectionMenuItems({ recordId: 3, collections, memberOf: [] });
check('no remove-from when uncategorized', m3.length === 1);
check("add-to offers both plus separator plus new", m3[0].submenu.length === 4);

// Filter
const inAlpha = filterGamesWithState(games, { collectionIds: ['1'], installState: 'all', includeUninstalled: true }, { collectionIdsByRecord: map });
check('filter to a collection', inAlpha.length === 2);
const unc = filterGamesWithState(games, { collectionIds: ['uncategorized'], installState: 'all', includeUninstalled: true }, { collectionIdsByRecord: map });
check('filter to uncategorized', unc.length === 2 && unc.every((g) => g.record_id > 2));
const noFilter = filterGamesWithState(games, { installState: 'all', includeUninstalled: true }, { collectionIdsByRecord: map });
check('empty collectionIds = no constraint', noFilter.length === 4);

import { test, expect } from "vitest"
test("collections logic", () => { expect(fail).toBe(0) })
