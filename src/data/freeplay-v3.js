// 版3までのフリープレイ（最初から町がある地図）。古いセーブを読み込むためだけに残す
import { GOODS } from './goods.js';

const NAMES = ['琥珀', '翠', '白砂', '蜜', '紅', '黄金', '月影', '星砂', '桂', '藍', '朱', '銀泉', '柘榴', '沈香', '瑠璃', '茜'];
const SUFFIX = ['京', '泉', '浜', '村', '町', '港', '原', '丘', '谷', '宿'];
const PRODUCE = [
  { wheat: 10 }, { rice: 10 }, { millet: 8 }, { dates: 7 }, { grapes: 7, honey: 1 }, { cane: 9 },
  { honey: 3, dates: 2 }, { rawsugar: 4 }, { salt: 6 }, { silk: 2.2 }, { spice: 2.4 }, { tea: 3 }, { pottery: 2.4 },
];

function rng(seed) {
  let t = 0;
  for (const c of String(seed)) t = Math.imul(t ^ c.charCodeAt(0), 2654435761) >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateFreeplayV3(seed) {
  const r = rng(`free:${seed}`);
  const n = 7 + Math.floor(r() * 3);
  const cities = [];
  const used = new Set();
  // 町をほどよく離して置く
  for (let tries = 0; cities.length < n && tries < 2000; tries++) {
    const x = 80 + r() * 840;
    const y = 70 + r() * 460;
    if (cities.some((c) => Math.hypot(c.x - x, c.y - y) < 190)) continue;
    let name;
    do name = NAMES[Math.floor(r() * NAMES.length)] + SUFFIX[Math.floor(r() * SUFFIX.length)]; while (used.has(name));
    used.add(name);
    cities.push({ id: `c${cities.length}`, name, x: Math.round(x), y: Math.round(y) });
  }
  // 砂漠は東側か西側のどちらか
  const desertEast = r() < 0.5;
  const isDesert = (c) => (desertEast ? c.x > 650 : c.x < 350) && r() < 0.7;
  cities.forEach((c, i) => {
    c.pop = i === 0 ? 3200 : Math.round(300 + r() * 1100);
    const p1 = PRODUCE[Math.floor(r() * PRODUCE.length)];
    const p2 = r() < 0.5 ? PRODUCE[Math.floor(r() * 4)] : {};
    c.produces = { ...p2, ...p1 };
    if (isDesert(c)) { c.tags = ['desert']; c.produces.dates = (c.produces.dates || 0) + 4; }
  });
  // 道: 最小全域木 + 近い町どうしを少し追加
  const edges = [];
  const key = (a, b) => [a, b].sort().join('-');
  const have = new Set();
  const inTree = new Set([cities[0].id]);
  while (inTree.size < cities.length) {
    let best = null;
    for (const a of cities) if (inTree.has(a.id)) for (const b of cities) if (!inTree.has(b.id)) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (!best || d < best.d) best = { a, b, d };
    }
    inTree.add(best.b.id);
    edges.push({ a: best.a.id, b: best.b.id });
    have.add(key(best.a.id, best.b.id));
  }
  for (const a of cities) {
    const near = cities.filter((b) => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[1];
    if (near && !have.has(key(a.id, near.id)) && r() < 0.6) { edges.push({ a: a.id, b: near.id }); have.add(key(a.id, near.id)); }
  }
  for (const e of edges) {
    const A = cities.find((c) => c.id === e.a);
    const B = cities.find((c) => c.id === e.b);
    const desert = A.tags?.includes('desert') || B.tags?.includes('desert');
    e.kind = desert ? 'desert' : r() < 0.3 ? 'road' : 'trail';
    if (desert && r() < 0.6) e.danger = 1 + Math.floor(r() * 2);
  }
  const goods = [...new Set(['wheat', 'dates', 'honey', 'rawsugar', 'whitesugar', 'sweets', 'cane', 'salt', ...cities.flatMap((c) => Object.keys(c.produces))])].filter((g) => GOODS[g]);
  const capital = cities[0];
  return {
    id: 'free', no: '∞', title: `フリープレイ（${seed}）`,
    intro: `見知らぬ土地。${capital.name}の人口を6000に育て、一族の資産を15000銀にし、交易所を開いて人口700に育てよ。地図はシードごとに変わる。進め方の例: ①近くの町と小さく売り買いして相場を覚える（advice）→ ②儲かる往復を定期便にして資金を作る → ③${capital.name}に足りない食べ物と住居の品を運ぶ便を足す → ④資金ができたら道の近くに交易所を開き（sites）、食べ物を届けて育てる。`,
    goods,
    start: { silver: 900, merchants: [{ name: 'ハサン', portrait: 'merchant-1', city: capital.id }, { name: 'ライラ', portrait: 'merchant-2', city: capital.id }] },
    cities,
    shapes: [{ kind: 'desert', points: desertEast ? [[650, 0], [1000, 0], [1000, 600], [650, 600]] : [[0, 0], [350, 0], [350, 600], [0, 600]] }],
    decor: ['dunes', 'mountain', 'palm', 'field', 'forest', 'cane-field'],
    decorCount: 30,
    edges,
    goals: [{ type: 'cityPop', city: capital.id, pop: 6000 }, { type: 'networth', amount: 15000 }, { type: 'postTier', tier: 2, pop: 700 }],
    deadline: 1080, rankS: 0.5,
    transports: ['donkey', 'camel', 'cart'],
    buildings: ['mill', 'confectionery', 'winery', 'malthouse', 'road'],
    techs: { refinery: { from: 0 }, caravanserai: { from: 0 }, wheel: { from: 30 } },
    events: true, contracts: true, bandits: true, newsDaysPerHop: 4,
    maxMerchants: 6, branches: true,
    freeSeed: seed,
  };
}
