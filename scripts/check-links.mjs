import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import GithubSlugger from 'github-slugger';

function plainText(tokens) {
  return tokens
    .map((token) => (token.tokens ? plainText(token.tokens) : (token.text ?? '')))
    .join('');
}

function parseMarkdown(source) {
  const links = [];
  const anchors = new Set();
  const slugger = new GithubSlugger();
  marked.walkTokens(marked.lexer(source), (token) => {
    if (token.type === 'link' || token.type === 'image') links.push(token.href);
    if (token.type === 'heading') anchors.add(slugger.slug(plainText(token.tokens)));
    if (token.type === 'html') {
      for (const match of token.raw.matchAll(/\b(?:id|name)=["']([^"']+)["']/g))
        anchors.add(match[1]);
    }
  });
  return { links, anchors };
}

/** Check local file targets and Markdown anchors; external URLs are deliberately offline. */
export async function checkLinks(root, files) {
  const failures = [];
  const documents = new Map();
  async function document(file) {
    if (!documents.has(file)) documents.set(file, parseMarkdown(await readFile(file, 'utf8')));
    return documents.get(file);
  }
  for (const file of files) {
    const source = path.resolve(root, file);
    for (const href of (await document(source)).links) {
      if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
      try {
        const hashIndex = href.indexOf('#');
        const targetPath = (hashIndex < 0 ? href : href.slice(0, hashIndex)).split('?')[0];
        const anchor = hashIndex < 0 ? '' : decodeURIComponent(href.slice(hashIndex + 1));
        const target = targetPath
          ? path.resolve(path.dirname(source), decodeURIComponent(targetPath))
          : source;
        const relative = path.relative(root, target);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          throw new Error('target escapes repository');
        const info = await stat(target);
        if (
          anchor &&
          info.isFile() &&
          /\.md$/i.test(target) &&
          !(await document(target)).anchors.has(anchor)
        ) {
          throw new Error(`missing heading #${anchor}`);
        }
      } catch (error) {
        failures.push(
          `${file}: ${href} (${error.code === 'ENOENT' ? 'missing target' : error.message})`,
        );
      }
    }
  }
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
      }).split('\0'),
    ),
  ].filter((file) => file.endsWith('.md'));
  // Tracked deletions are still listed until staged.
  const existing = [];
  for (const file of files) {
    try {
      await stat(path.join(root, file));
      existing.push(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const failures = await checkLinks(root, existing);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`Checked local links and headings in ${existing.length} Markdown files.`);
}
