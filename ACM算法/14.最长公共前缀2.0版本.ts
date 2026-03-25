function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  if (strs.length === 1) return strs[0];
  let prefix = strs[0];
  for (const str of strs) {
    while (str.indexOf(prefix) !== 0) {
      prefix = prefix.slice(0, prefix.length - 1)
      if(prefix === '') return ''
    }
  }
  return prefix
}

console.log(longestCommonPrefix(["flower", "flow", "flight"]));
