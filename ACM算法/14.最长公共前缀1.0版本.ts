function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  const strsSord = strs.toSorted();
  const a = strsSord[0];
  const b = strsSord.at(-1)!;
  let res = "";
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) {
      res += a[i];
    } else {
      break;
    }
  }
  return res;
}

console.log(longestCommonPrefix(["flower", "flow", "flight"]));
