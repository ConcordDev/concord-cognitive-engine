/**
 * CrossRef author-name normalisation.
 *
 * Crossref records from Chinese journals not infrequently carry the
 * author's given/family fields swapped (the record stores
 * given='Liu', family='Yuting' for the author Liu Yuting). Joined
 * literally, the Library display reads fine but every citation style
 * inverts it to "Yuting, L.". Bounded repair: when the GIVEN token is
 * itself a very common Chinese surname and the FAMILY token is not,
 * the fields are swapped back before joining. Both conditions must
 * hold, so correctly-recorded names (either order, any origin) are
 * never touched. Kept pure so the domain and the tests share it.
 */

export const CJK_SURNAMES = new Set([
  "Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou",
  "Xu", "Sun", "Hu", "Zhu", "Gao", "Lin", "He", "Guo", "Ma", "Luo",
  "Liang", "Song", "Zheng", "Xie", "Han", "Tang", "Feng", "Yu", "Dong", "Xiao",
  "Cheng", "Cao", "Yuan", "Deng", "Fu", "Shen", "Zeng", "Peng", "Lu", "Jiang",
  "Cai", "Jia", "Ding", "Wei", "Xue", "Ye", "Yan", "Pan", "Du", "Dai",
]);

export function crossrefAuthorName(a) {
  const given = String(a?.given || "").trim();
  const family = String(a?.family || "").trim();
  if (given && family && !given.includes(" ") && !family.includes(" ")
      && CJK_SURNAMES.has(given) && !CJK_SURNAMES.has(family)) {
    return `${family} ${given}`;
  }
  return [given, family].filter(Boolean).join(" ") || a?.name || "Unknown";
}
