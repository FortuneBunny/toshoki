// 商人の才能（E1）: 雇うときに候補3人の中から選ぶ。どれも小さな得意分野
export const TALENTS = {
  swift: { name: '健脚', text: '陸の移動が1割5分速い' },
  haggler: { name: '値切り上手', text: '買値が5%安い' },
  appraiser: { name: '目利き', text: '売値が4%高い' },
  desert: { name: '砂漠の民', text: '砂漠で食料を半分しか食べない。砂嵐でも遅れにくい' },
  sailor: { name: '船乗り', text: '船の移動が1割5分速い' },
  strong: { name: '腕っぷし', text: '護衛2人分の強さで盗賊と戦う' },
  sweettooth: { name: '甘党', text: '甘味の売値が8%高い' },
};
export const TALENT_IDS = Object.keys(TALENTS);
