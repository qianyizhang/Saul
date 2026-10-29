import { Fragment, type ReactNode } from 'react';
import { Lexer, type Token, type Tokens } from 'marked';
import { sourceUrl } from '../digest/html';

// Tokenize Markdown, then render React nodes. Raw HTML and images never enter the DOM.
export function ActionText({ text }: { text: string }) {
  function render(tokens: Token[], depth = 0): ReactNode {
    if (depth > 20) return tokens.map((t) => t.raw).join('');
    return tokens.map((token, i) => {
      const nested =
        'tokens' in token && token.tokens
          ? render(token.tokens, depth + 1)
          : 'text' in token
            ? String(token.text)
            : token.raw;
      switch (token.type) {
        case 'space':
          return null;
        case 'paragraph':
          return <p key={i}>{nested}</p>;
        case 'heading':
          return <h3 key={i}>{nested}</h3>;
        case 'strong':
          return <strong key={i}>{nested}</strong>;
        case 'em':
          return <em key={i}>{nested}</em>;
        case 'del':
          return <del key={i}>{nested}</del>;
        case 'codespan':
          return <code key={i}>{token.text}</code>;
        case 'code':
          return (
            <pre key={i}>
              <code>{token.text}</code>
            </pre>
          );
        case 'blockquote':
          return <blockquote key={i}>{nested}</blockquote>;
        case 'br':
          return <br key={i} />;
        case 'hr':
          return <hr key={i} />;
        case 'list': {
          const rows = (token.items as Tokens.ListItem[]).map((item, j) => (
            <li key={j}>{render(item.tokens, depth + 1)}</li>
          ));
          return token.ordered ? <ol key={i}>{rows}</ol> : <ul key={i}>{rows}</ul>;
        }
        case 'link':
          return sourceUrl(token.href) ? (
            <a key={i} href={sourceUrl(token.href)} target="_blank" rel="noreferrer">
              {nested}
            </a>
          ) : (
            <Fragment key={i}>{nested}</Fragment>
          );
        case 'text':
          return <Fragment key={i}>{nested}</Fragment>;
        default:
          return <Fragment key={i}>{token.raw}</Fragment>;
      }
    });
  }
  return <div className="action-answer saul-reading">{render(Lexer.lex(text))}</div>;
}
