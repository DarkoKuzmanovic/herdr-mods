// Markdown, HTML and PDF file paths in terminal text, newest (lowest on screen) first, each once.
// Relative and ~ paths are kept as written; the machine resolves them (see main.js).
export function mdPaths(text) {
  const found = String(text ?? '').match(/(?<![\w.~/-])(?:~\/|\.{1,2}\/|\/)?[\w.@+~-]+(?:\/+[\w.@+~-]+)*\.(?:md|markdown|html?|pdf)(?![\w/-])/gi) ?? [];
  return [...new Set(found.map(p => p.replace(/\/{2,}/g, '/')).reverse())].slice(0, 200);
}

// Markdown opens in the editor; HTML and PDF go to whatever the system opens files with.
export const isMarkdown = path => /\.(?:md|markdown)$/i.test(path);

// "machine/t7" (another machine's terminal) or "t7" (this computer's).
export function splitAddress(terminal) {
  const at = String(terminal ?? '').lastIndexOf('/');
  return at < 0 ? { machine: null, address: terminal } : { machine: terminal.slice(0, at), address: terminal.slice(at + 1) };
}
