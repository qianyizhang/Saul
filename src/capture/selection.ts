import { nanoid } from 'nanoid';
import type { SelectionSnapshot, ResolvedContext, ContextPolicy } from '../types';

const PREFIX_SUFFIX_LENGTH = 80;

/**
 * Capture selection and compute durable TextQuote anchor & context
 */
export function captureSelection(): {
  snapshot: SelectionSnapshot;
  range: Range;
} | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = range.toString().trim();

  if (!text || text.length === 0) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }

  const { prefix, suffix } = extractPrefixSuffix(range);
  const domPath = computeDomPath(range.commonAncestorContainer);

  const snapshot: SelectionSnapshot = {
    id: nanoid(),
    text,
    page: {
      url: window.location.href,
      canonicalUrl: getCanonicalUrl(),
      title: document.title || window.location.hostname,
      favicon: getFaviconUrl(),
    },
    anchor: {
      exact: text,
      prefix,
      suffix,
      domPath,
    },
    viewport: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    capturedAt: Date.now(),
  };

  return { snapshot, range };
}

/**
 * Build resolved context from current selection and DOM per ContextPolicy
 */
export function buildResolvedContext(
  snapshot: SelectionSnapshot,
  range: Range,
  policy: ContextPolicy
): ResolvedContext {
  let paragraph: string | undefined;
  let heading: string | undefined;
  let surroundingText: string | undefined;

  if (policy.includeContainingParagraph) {
    paragraph = extractContainingParagraph(range);
  }

  if (policy.includeContainingHeading) {
    heading = extractPrecedingHeading(range);
  }

  if (policy.surroundingCharacters) {
    surroundingText = `${snapshot.anchor.prefix} [${snapshot.text}] ${snapshot.anchor.suffix}`;
  }

  return {
    selection: snapshot.text,
    paragraph,
    heading,
    surroundingText,
    pageTitle: policy.includePageMetadata ? snapshot.page.title : '',
    pageUrl: policy.includePageMetadata ? snapshot.page.url : '',
  };
}

function extractPrefixSuffix(range: Range): { prefix: string; suffix: string } {
  let prefix = '';
  let suffix = '';

  try {
    const container = range.commonAncestorContainer;
    const parentBlock = getClosestBlockElement(container) || document.body;
    const blockText = parentBlock.textContent || '';
    const selectedText = range.toString();

    const index = blockText.indexOf(selectedText);
    if (index !== -1) {
      prefix = blockText.slice(Math.max(0, index - PREFIX_SUFFIX_LENGTH), index).trim();
      suffix = blockText.slice(index + selectedText.length, index + selectedText.length + PREFIX_SUFFIX_LENGTH).trim();
    }
  } catch {
    // Fallback gracefully
  }

  return { prefix, suffix };
}

function extractContainingParagraph(range: Range): string | undefined {
  try {
    const container = range.commonAncestorContainer;
    const block = getClosestBlockElement(container);
    if (block) {
      const text = block.textContent?.trim();
      if (text && text.length < 2000) {
        return text;
      }
    }
  } catch {
    // Fallback gracefully
  }
  return undefined;
}

function extractPrecedingHeading(range: Range): string | undefined {
  try {
    let current: Node | null = range.commonAncestorContainer;
    while (current && current !== document.body) {
      let prev = current.previousSibling;
      while (prev) {
        if (prev.nodeType === Node.ELEMENT_NODE) {
          const el = prev as HTMLElement;
          if (/^H[1-6]$/i.test(el.tagName)) {
            return el.textContent?.trim();
          }
          const nestedHeading = el.querySelector('h1, h2, h3, h4, h5, h6');
          if (nestedHeading) {
            return nestedHeading.textContent?.trim();
          }
        }
        prev = prev.previousSibling;
      }
      current = current.parentNode;
    }
  } catch {
    // Fallback gracefully
  }
  return undefined;
}

function getClosestBlockElement(node: Node): HTMLElement | null {
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  const blockTags = new Set([
    'P', 'DIV', 'ARTICLE', 'SECTION', 'BLOCKQUOTE', 'LI', 'TD', 'TH', 'MAIN', 'ASIDE'
  ]);

  while (current && current !== document.body) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement;
      if (blockTags.has(el.tagName)) {
        return el;
      }
    }
    current = current.parentNode;
  }
  return null;
}

function computeDomPath(node: Node): string {
  const parts: string[] = [];
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;

  while (current && current !== document.body && current !== document.documentElement) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement;
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector += `#${el.id}`;
        parts.unshift(selector);
        break;
      } else {
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(el) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }
      }
      parts.unshift(selector);
    }
    current = current.parentNode;
  }

  return parts.join(' > ');
}

function getCanonicalUrl(): string | undefined {
  const link = document.querySelector('link[rel="canonical"]');
  return link?.getAttribute('href') || undefined;
}

function getFaviconUrl(): string | undefined {
  const link = document.querySelector('link[rel~="icon"]');
  return link?.getAttribute('href') || undefined;
}
