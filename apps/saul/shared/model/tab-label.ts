export function tabSite(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'chrome-extension:') return 'Extension';
    if (parsed.protocol === 'chrome:') return 'Chrome';
    if (parsed.protocol === 'about:') return 'Browser page';
    return parsed.hostname || 'Local file';
  } catch {
    return 'Local tab';
  }
}

export function tabLabel(title: string, url: string): string {
  let text = title;
  if (/[<&]/.test(title)) {
    // Template contents are inert. Only the extracted string reaches the live UI.
    const template = document.createElement('template');
    template.innerHTML = title;
    for (const node of template.content.querySelectorAll(
      'script, style, template, iframe, object, embed, noscript',
    ))
      node.remove();
    for (const image of template.content.querySelectorAll('img'))
      image.replaceWith(image.getAttribute('alt') || '');
    for (const block of template.content.querySelectorAll(
      'br, hr, div, p, li, dt, dd, tr, td, th, h1, h2, h3, h4, h5, h6, section, article, blockquote, pre',
    )) {
      block.prepend(' ');
      block.append(' ');
    }
    text = template.content.textContent || '';
  }
  return text.replace(/\s+/g, ' ').trim() || tabSite(url);
}
