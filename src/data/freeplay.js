// フリープレイ: シードから地図とシナリオを生成する
// 版4（開拓と糖度の版）: 市場のある町はない。集落・野の需要施設・一族の館だけがあり、最初の交易所を自分で置く
import { GOODS } from './goods.js';

const NAMES = ['麦生', '稲穂', '黍野', '棗原', '葡萄沢', '蜜蜂', '甘蔗', '塩見', '茶山', '陶谷', '香草', '桑原', '白砂', '月影', '星砂', '藍染', '朱鷺', '柘榴', '沈香', '瑠璃'];
// 集落が作る品（1つ目が主、2つ目は少し）。量は人口から決める（町のない土地では、作りすぎると値が底まで落ちる）
const FOODS_GREEN = [['wheat'], ['rice'], ['grapes'], ['wheat', 'grapes'], ['cane'], ['rice', 'cane']];
const FOODS_DRY = [['dates'], ['millet'], ['dates', 'millet'], ['salt']];
const FOODS_HILL = [['honey', 'grapes'], ['tea'], ['pottery'], ['spice'], ['honey']];
// 食べ物は、その集落の糖の必要量の1.8〜2.2倍（s1 の町と同じくらい。1種類で食べられるのは必要量の半分までなので、残りが運び出せる）。食べ物でない品は人口に比べて少し
function rates(goods, pop, r) {
  const out = {};
  goods.forEach((g, i) => {
    const share = i === 0 ? 1 : 0.55;
    const food = GOODS[g].kind !== 'goods';
    const v = food ? (pop / 1000) * 10 * (1.8 + r() * 0.4) / GOODS[g].glu : (pop / 1000) * 5;
    out[g] = Math.max(0.3, Math.round(v * share * 10) / 10);
  });
  return out;
}
const FAMILIES = [
  { id: 'hasan', name: 'ハサン家' },
  { id: 'zahra', name: 'ザフラ家' },
  { id: 'kaya', name: 'カヤ家' },
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

export function generateFreeplay(seed) {
  const r = rng(`free4:${seed}`);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const desertEast = r() < 0.5;
  const inDesert = (x) => (desertEast ? x > 660 : x < 340);
  const used = new Set();
  const name = () => { let n; do n = pick(NAMES); while (used.has(n) && used.size < NAMES.length); used.add(n); return `${n}の集落`; };
  const hamlets = [];
  const wilds = [];
  const far = (x, y, list, d) => list.every((o) => Math.hypot(o.x - x, o.y - y) >= d);
  const foodsAt = (x, y) => (inDesert(x) ? pick(FOODS_DRY) : y < 140 || y > 470 ? (r() < 0.6 ? pick(FOODS_HILL) : pick(FOODS_GREEN)) : r() < 0.25 ? pick(FOODS_HILL) : pick(FOODS_GREEN));

  // 一族の館: 地図の3つの地域に1つずつ（緑・砂漠のふち・丘）
  const cols = desertEast ? [180, 520, 820] : [820, 480, 180];
  const families = FAMILIES.map((f, i) => {
    const x = cols[i] + Math.round((r() - 0.5) * 80);
    const y = 160 + Math.round(r() * 280);
    const text = inDesert(x) ? '砂漠のふちに館がある。なつめやしとキビの土地。' : Math.abs(x - (desertEast ? 660 : 340)) < 160 ? '砂漠に近い草原に館がある。' : '緑の土地に館がある。麦や米がよく育つ。';
    return { ...f, x, y, text };
  });
  // どの館のそばにも、違う食べ物の集落を2つと、野の需要施設を1つ（序盤がからっぽにならないように）
  for (const f of families) {
    // 集落（人口300未満）の段階で食べる品（麦・米・キビ・なつめやし・サトウキビ）にする
    const staple = inDesert(f.x) ? [['dates'], ['millet']] : [pick([['wheat'], ['rice']]), pick([['dates'], ['millet']])];
    for (let k = 0; k < 2; k++) {
      for (let t = 0; t < 60; t++) {
        const a = r() * Math.PI * 2;
        const d = 45 + r() * 35;
        const x = Math.round(f.x + Math.cos(a) * d);
        const y = Math.round(f.y + Math.sin(a) * d * 0.8);
        if (x < 60 || x > 940 || y < 60 || y > 540 || !far(x, y, hamlets, 55)) continue;
        const pop = 260 + Math.round(r() * 160);
        hamlets.push({ name: name(), x, y, pop, foods: rates(staple[k], pop, r) });
        break;
      }
    }
    // 野の需要施設は、2つ目の集落のすぐそば（3マスほど）。2つ目の交易所で両方を圏に入れられる
    const h2 = hamlets[hamlets.length - 1];
    for (let t = 0; h2 && t < 60; t++) {
      const a = r() * Math.PI * 2;
      const x = Math.round(h2.x + Math.cos(a) * 19);
      const y = Math.round(h2.y + Math.sin(a) * 19);
      if (x < 60 || x > 940 || y < 60 || y > 540) continue;
      wilds.push({ type: inDesert(f.x) ? 'inn' : pick(['shrine', 'inn']), x, y });
      break;
    }
  }
  // 残りの集落と野の需要施設を、地図のあちこちに
  for (let t = 0; hamlets.length < 18 && t < 3000; t++) {
    const x = 60 + Math.round(r() * 880);
    const y = 60 + Math.round(r() * 480);
    if (!far(x, y, hamlets, 60) || !far(x, y, families, 50)) continue;
    const pop = 120 + Math.round(r() * 260);
    hamlets.push({ name: name(), x, y, pop, foods: rates(foodsAt(x, y), pop, r) });
  }
  for (let t = 0; wilds.length < 7 && t < 3000; t++) {
    const x = 60 + Math.round(r() * 880);
    const y = 60 + Math.round(r() * 480);
    if (!far(x, y, [...hamlets, ...wilds], 45) || !far(x, y, families, 60)) continue;
    wilds.push({ type: wilds.length >= 5 ? 'manor' : pick(['shrine', 'inn', 'manor']), x, y });
  }
  const goods = ['wheat', 'rice', 'millet', 'dates', 'grapes', 'honey', 'cane', 'rawsugar', 'molasses', 'whitesugar', 'sweets', 'salt', 'tea', 'pottery', 'spice', 'teacake', 'spicesugar'].filter((g) => GOODS[g]);
  return {
    id: 'free', no: '∞', title: `フリープレイ（${seed}）`,
    intro: `市場のある町がひとつもない土地。集落と古い建物が点々とあるだけ。交易所を開いて集落を町に育て、人口3000の交易所を1つと、人口300以上の交易所を4つ作り、一族の資産を15000銀にせよ。地図はシードごとに変わる。進め方の例: ①違う食べ物を作る集落のそばに交易所を2つ置き、食べ物を運び合う（食卓が2種類になると糖度が上がり、家が建つ）→ ②往復を定期便にし、交易所どうしを小道で結ぶ → ③交易所を「市場」に格上げして、まわりの集落を圏に入れる → ④サトウキビから粗糖を作り、技術で白糖と菓子を開く。`,
    goods,
    start: { silver: 1500, merchants: [{ name: 'ハサン', portrait: 'merchant-1' }, { name: 'ライラ', portrait: 'merchant-2' }] },
    cities: [],
    edges: [],
    pioneer: { families, hamlets, wilds, rivalPosts: [8, 170, 360] },
    shapes: [{ kind: 'desert', points: desertEast ? [[660, 0], [1000, 0], [1000, 600], [660, 600]] : [[0, 0], [340, 0], [340, 600], [0, 600]] }],
    decor: ['dunes', 'mountain', 'palm', 'field', 'forest', 'cane-field'],
    decorCount: 30,
    goals: [{ type: 'postTier', tier: 3, pop: 3000 }, { type: 'posts', count: 4, pop: 300 }, { type: 'networth', amount: 15000 }],
    deadline: 1080, rankS: 0.5,
    transports: ['donkey', 'camel', 'cart'],
    buildings: ['mill', 'confectionery', 'road'],
    techs: { whiterefining: { from: 60 }, confection: { from: 120 }, teaceremony: { from: 200 }, spicesugar: { from: 300 }, refinery: { from: 90 }, caravanserai: { from: 0 }, wheel: { from: 60 } },
    maxPosts: 8, maxPaths: 14,
    rivals: [{ name: 'サルマン商会', silver: 800, skill: 0.85, merchants: [{ transport: 'donkey' }, { transport: 'donkey', wait: 3 }] }],
    events: true, contracts: true, bandits: true, newsDaysPerHop: 4,
    maxMerchants: 6, branches: true,
    freeSeed: seed,
  };
}
