// 技術の購入・独占・使用許可（E2）
import { TECHS, LICENSE_RATE } from '../data/techs.js';
import { emit } from './events.js';
import { GOODS } from '../data/goods.js';

// ---------- 技術で開く品と作り方（版4 H3） ----------
// シナリオにある技術のうち、kind（goods・recipes・buildings・producers）に name を含むもの
function unlockTech(world, kind, name) {
  for (const id of Object.keys(world.scenario.techs || {})) if (TECHS[id]?.unlocks?.[kind]?.includes(name)) return id;
  return null;
}
// その品は、まだだれも技術を買っていないので、どの町でも求められない
export function goodLocked(world, good) {
  const id = unlockTech(world, 'goods', good);
  return !!id && !world.techs?.[id];
}
// プレイヤーが使えるか（技術が要らないか、自分が持っているか、使用料を払った）
function usable(world, kind, name) {
  const id = unlockTech(world, kind, name);
  return !id || world.techs?.[id] === 'player' || world.techs?.[id] === 'licensed';
}
export const recipeUsable = (world, name) => usable(world, 'recipes', name);
export const buildingUsable = (world, type) => usable(world, 'buildings', type);
export const producerUsable = (world, type) => usable(world, 'producers', type);
// 使えないときの、要る技術の名前
export function neededTech(world, kind, name) {
  const id = unlockTech(world, kind, name);
  return id && !usable(world, kind, name) ? TECHS[id].name : null;
}

// そのシナリオで、今日買える技術（from 日目から）
export function techList(world) {
  const defs = world.scenario.techs || {};
  return Object.entries(defs).map(([id, d]) => {
    const t = TECHS[id];
    const owner = world.techs?.[id] || null; // 'player' | 'rival' | 'licensed'
    const price = owner === 'rival' ? Math.round(t.cost * LICENSE_RATE) : t.cost;
    return { id, ...t, from: d.from || 0, available: world.day >= (d.from || 0), owner, price };
  });
}

// 品が開いたことを知らせる（だれが買っても需要は開く）
function announceGoods(world, id, who) {
  const goods = TECHS[id].unlocks?.goods || [];
  if (!goods.length || world.goodsOpened?.[id]) return;
  world.goodsOpened = { ...(world.goodsOpened || {}), [id]: who };
  emit(world, { type: 'newGood', big: true, rare: true, text: `新しい品「${goods.map((g) => GOODS[g].name).join('・')}」が、町で求められるようになった！${who === 'rival' ? '（作るには使用料が要る）' : ''}` });
}

function applyTech(world, id, who) {
  announceGoods(world, id, who);
  if (who === 'rival') {
    for (const r of world.rivals) if (id === 'refinery' && r.workshop) r.workshop.inputPerDay = Math.round(r.workshop.inputPerDay * 1.33);
    return;
  }
  const mods = world.player.mods;
  if (id === 'relay') world.scenario = { ...world.scenario, infoNetwork: { every: 15 } };
  if (id === 'carrack' && !world.allowedTransports.includes('carrack')) world.allowedTransports.push('carrack');
  if (id === 'refinery') mods.batchBonus = (mods.batchBonus || 0) + 1;
  if (id === 'caravanserai') mods.provision = (mods.provision ?? 1) * 0.7;
  if (id === 'wheel') {
    mods.cartCap = 1.2;
    for (const m of world.player.merchants) m.cartCap = 1.2;
  }
}

export function buyTech(world, id) {
  const t = techList(world).find((x) => x.id === id);
  if (!t || t.legacy) return { ok: false, error: 'その技術はこのシナリオにない' };
  if (!t.available) return { ok: false, error: `${t.name}は${t.from}日目から買える` };
  if (t.owner === 'player' || t.owner === 'licensed') return { ok: false, error: 'もう持っている' };
  if (world.player.silver < t.price) return { ok: false, error: `銀が足りない（${t.price}必要）` };
  world.player.silver -= t.price;
  world.techs = world.techs || {};
  if (t.owner === 'rival') {
    world.techs[id] = 'licensed';
    for (const r of world.rivals) r.silver += t.price / world.rivals.length;
    emit(world, { type: 'tech', big: true, text: `${t.name}の使用料を払った（${t.price}銀はライバルの手に）。${t.text}` });
  } else {
    world.techs[id] = 'player';
    emit(world, { type: 'tech', big: true, text: `${t.name}を手に入れた！${t.text}${world.rivals.length ? '。ライバルが使うなら使用料が入る' : ''}` });
  }
  applyTech(world, id, 'player');
  return { ok: true, cost: t.price };
}

// ライバルも技術を買う: 買えるようになってから一定日数後。先にプレイヤーが持っていれば使用料を払う
export function rivalTechs(world) {
  if (!world.rivals.length) return;
  world.rivalTech = world.rivalTech || {};
  for (const t of techList(world)) {
    if (t.id !== 'refinery' && t.id !== 'wheel' && !TECHS[t.id].unlocks) continue;
    // 町のないシナリオでは、ライバルも始めは貧しいので遅めに買う
    if (world.rivalTech[t.id] || world.day < t.from + (world.scenario.pioneer ? 80 : 45)) continue;
    world.rivalTech[t.id] = true;
    world.techs = world.techs || {};
    const name = world.rivals[0].name;
    if (t.owner === 'player' || t.owner === 'licensed') {
      if (t.owner === 'player') {
        const fee = Math.round(t.cost * LICENSE_RATE);
        world.player.silver += fee;
        emit(world, { type: 'tech', big: true, text: `${name}が${t.name}の使用料 ${fee}銀を払ってきた！（独占の儲け）` });
      }
    } else {
      world.techs[t.id] = 'rival';
      emit(world, { type: 'tech', bad: true, text: `${name}が${t.name}を独占した！使うには使用料（${Math.round(t.cost * LICENSE_RATE)}銀）がかかる` });
    }
    applyTech(world, t.id, 'rival');
  }
}
