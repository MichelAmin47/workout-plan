import { marked } from 'marked'
import DOMPurify from 'dompurify'

// breaks: true — single newlines in the coach's own text (e.g. between meal
// lines in a daily overview) become <br>, matching how the model actually
// writes them, instead of collapsing into a run-on paragraph.
marked.setOptions({ gfm: true, breaks: true })

// Deliberately tight allowlist matching what the coach actually uses (bold,
// lists, line breaks, inline code) plus links, degraded gracefully. Anything
// else the model might emit (headings, images, tables, blockquotes) gets its
// wrapping tag stripped by DOMPurify but its text content kept — no crash,
// no blown-out layout, just plainer text.
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'ul', 'ol', 'li', 'code', 'pre', 'a']
const ALLOWED_ATTR = ['href']

// The coach has no reason to produce links right now, but if it ever does,
// force them to open externally rather than navigating the WebView away
// from the app. Set post-sanitization (not via ALLOWED_ATTR) so these are
// always ours, never values the model could influence.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function renderCoachMarkdown(text) {
  const html = marked.parse(text ?? '')
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })
}
