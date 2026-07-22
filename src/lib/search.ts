export function normalizeAssetSearch(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[ａ-ｚ０-９]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "");
}
