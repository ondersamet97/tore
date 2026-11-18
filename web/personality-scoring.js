// Scoring for the personality test page (/kisilik). Pure functions: no DOM, no storage, no
// network. IPIP scoring (https://ipip.ori.org/newScoringInstructions.htm): five response
// options scored 1-5; a minus-keyed item is reversed (5-1); a scale score is the sum of its
// items. Scores are raw sums. There are no norms, so nothing here ranks a person.
export const RESPONSES = [1, 2, 3, 4, 5];
export function validResponse(value) { return Number.isInteger(value) && value >= 1 && value <= 5; }
export function itemScore(key, response) {
  if (!validResponse(response)) return null;
  if (key === '+') return response;
  if (key === '-') return 6 - response;
  return null;
}
// The order statements are shown in: one item from each facet in turn (N1, E1, O1, A1, C1,
// N2, …), four rounds. The IPIP prescribes no item order; this one is töre's own and is not
// Johnson's item numbering.
export function administrationOrder(items, domains) {
  const byFacet = new Map();
  for (const item of items) { if (!byFacet.has(item.facet)) byFacet.set(item.facet, []); byFacet.get(item.facet).push(item.id); }
  const rounds = Math.max(0, ...[...byFacet.values()].map(list => list.length));
  const facetsPerDomain = Math.max(0, ...domains.map(domain => domain.facets.length));
  const order = [];
  for (let round = 0; round < rounds; round++) {
    for (let f = 0; f < facetsPerDomain; f++) {
      for (const domain of domains) {
        const id = (byFacet.get(domain.facets[f]) || [])[round];
        if (id) order.push(id);
      }
    }
  }
  return order;
}
// answers: { itemId: 1..5 }. A facet or domain with an unanswered item has raw: null; nothing
// is estimated or filled in.
export function score(items, facets, domains, answers) {
  const facetOut = {}, domainOut = {}, missing = [];
  for (const facet of facets) facetOut[facet.id] = { raw: 0, answered: 0, items: 0 };
  for (const item of items) {
    const facet = facetOut[item.facet];
    facet.items += 1;
    const value = itemScore(item.key, Object.prototype.hasOwnProperty.call(answers, item.id) ? answers[item.id] : undefined);
    if (value === null) { missing.push(item.id); continue; }
    facet.raw += value; facet.answered += 1;
  }
  for (const facet of Object.values(facetOut)) {
    facet.min = facet.items; facet.max = facet.items * 5; facet.complete = facet.answered === facet.items;
    if (!facet.complete) facet.raw = null;
  }
  for (const domain of domains) {
    const parts = domain.facets.map(id => facetOut[id]);
    const complete = parts.every(part => part.complete);
    domainOut[domain.id] = {
      raw: complete ? parts.reduce((sum, part) => sum + part.raw, 0) : null,
      answered: parts.reduce((sum, part) => sum + part.answered, 0),
      items: parts.reduce((sum, part) => sum + part.items, 0),
      min: parts.reduce((sum, part) => sum + part.min, 0),
      max: parts.reduce((sum, part) => sum + part.max, 0),
      complete
    };
  }
  return { total: items.length, answered: items.length - missing.length, complete: missing.length === 0, missing, facets: facetOut, domains: domainOut };
}
// Where a raw score sits between the lowest and highest possible value, 0..1.
export function position(raw, range) {
  if (raw === null || range.max === range.min) return 0;
  return Math.min(1, Math.max(0, (raw - range.min) / (range.max - range.min)));
}
