/**
 * Traditional-Chinese research translation adapted to the S2 reading task.
 *
 * Source: Klepsch, Schmitz, & Seufert (2017), Table 3, second version of the
 * naive-rating questionnaire. The construct labels are kept for scoring and
 * exports, but are not shown to participants.
 * https://doi.org/10.3389/fpsyg.2017.01997
 */
export const COGNITIVE_LOAD_ITEMS = [
  { id: 'intrinsic1', construct: 'intrinsic', text: '剛才閱讀時，我需要同時在腦中處理很多資訊。' },
  { id: 'intrinsic2', construct: 'intrinsic', text: '剛才的閱讀任務很複雜。' },
  { id: 'germane1', construct: 'germane', text: '我有努力不只理解個別字句，也理解文章的整體脈絡。' },
  { id: 'germane2', construct: 'germane', text: '閱讀時，我力求正確理解文章的所有內容。' },
  { id: 'germane3', construct: 'germane', text: '剛才的閱讀介面包含一些有助於我理解文章的元素。' },
  { id: 'extraneous1', construct: 'extraneous', text: '剛才閱讀時，要找出重要資訊讓我感到吃力。' },
  { id: 'extraneous2', construct: 'extraneous', text: '剛才閱讀介面的呈現方式不利於我理解文章。' },
  { id: 'extraneous3', construct: 'extraneous', text: '剛才閱讀時，我難以辨認並連結文章中的重要資訊。' },
] as const;

export type CognitiveLoadItemId = typeof COGNITIVE_LOAD_ITEMS[number]['id'];
export type CognitiveLoadRatings = Record<CognitiveLoadItemId, number>;

export const COGNITIVE_LOAD_GROUPS = {
  intrinsic: ['intrinsic1', 'intrinsic2'],
  germane: ['germane1', 'germane2', 'germane3'],
  extraneous: ['extraneous1', 'extraneous2', 'extraneous3'],
} as const satisfies Record<string, readonly CognitiveLoadItemId[]>;

export function validCognitiveLoadRatings(value: unknown): value is CognitiveLoadRatings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ratings = value as Record<string, unknown>;
  return COGNITIVE_LOAD_ITEMS.every(
    item => Number.isInteger(ratings[item.id]) && Number(ratings[item.id]) >= 1 && Number(ratings[item.id]) <= 7
  );
}

const mean = (ratings: CognitiveLoadRatings, ids: readonly CognitiveLoadItemId[]) =>
  ids.reduce((total, id) => total + ratings[id], 0) / ids.length;

export function cognitiveLoadMeans(ratings: CognitiveLoadRatings) {
  return {
    intrinsicMean: mean(ratings, COGNITIVE_LOAD_GROUPS.intrinsic),
    germaneMean: mean(ratings, COGNITIVE_LOAD_GROUPS.germane),
    extraneousMean: mean(ratings, COGNITIVE_LOAD_GROUPS.extraneous),
  };
}
