// Country names from ISO codes through the browser's own Intl data: no lists to maintain, no flag emoji.
const names = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

export function countryName(code: string): string {
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

// Every assigned ISO 3166-1 alpha-2 code the browser knows a name for, sorted by name.
export const COUNTRIES: { code: string; name: string }[] = (() => {
  const out: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++)
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = countryName(code);
      if (name && name !== code && !/unknown/i.test(name)) out.push({ code, name });
    }
  return out.sort((x, y) => x.name.localeCompare(y.name));
})();
