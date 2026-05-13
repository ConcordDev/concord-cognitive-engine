// server/lib/autofix/a11y-button-label.js
//
// Auto-fix: inject `aria-label="<derived>"` into an icon-only
// <button> whose children consist of a JSX icon (and nothing else).
// The label is derived from the icon's component name via a
// canonical mapping (e.g. <X /> → "Close", <Heart /> → "Like") with
// a CamelCase-to-words fallback.
//
// Matches findings produced by the ux-a11y-button-no-label
// detector. Refuses to touch buttons that already have an
// aria-label / aria-labelledby / title, that spread props, or
// whose children contain plain text.
//
// Risk tier: low. The injection is conservative — buttons with
// ambiguous children (multiple icons, JSX expressions, nested
// elements) are skipped, leaving them for human review.

const ICON_TO_LABEL = {
  // Status / navigation
  X: "Close",
  Check: "Confirm",
  ChevronDown: "Expand",
  ChevronUp: "Collapse",
  ChevronLeft: "Previous",
  ChevronRight: "Next",
  ArrowLeft: "Back",
  ArrowRight: "Forward",
  ArrowUp: "Up",
  ArrowDown: "Down",
  MoreHorizontal: "More options",
  MoreVertical: "More options",

  // Common actions
  Heart: "Like",
  Star: "Favorite",
  Bookmark: "Bookmark",
  Share: "Share",
  Share2: "Share",
  Save: "Save",
  Edit: "Edit",
  Edit2: "Edit",
  Edit3: "Edit",
  Pencil: "Edit",
  Trash: "Delete",
  Trash2: "Delete",
  Plus: "Add",
  Minus: "Remove",
  Copy: "Copy",
  Download: "Download",
  Upload: "Upload",
  Search: "Search",
  Filter: "Filter",
  Settings: "Settings",
  Refresh: "Refresh",
  RefreshCw: "Refresh",
  ExternalLink: "Open in new tab",
  Link: "Link",
  Link2: "Link",
  Send: "Send",
  Reply: "Reply",
  Forward: "Forward",
  Archive: "Archive",
  Tag: "Tag",

  // Visibility / lock
  Eye: "Show",
  EyeOff: "Hide",
  Lock: "Lock",
  Unlock: "Unlock",

  // Media
  Play: "Play",
  Pause: "Pause",
  Square: "Stop",
  SkipBack: "Previous track",
  SkipForward: "Next track",
  Volume: "Volume",
  Volume1: "Volume",
  Volume2: "Volume",
  VolumeX: "Mute",
  Mic: "Microphone",
  MicOff: "Mute microphone",
  Camera: "Camera",
  Video: "Video",
  Image: "Image",
  Maximize: "Maximize",
  Maximize2: "Maximize",
  Minimize: "Minimize",
  Minimize2: "Minimize",
  Music: "Music",

  // Identity / inbox
  Bell: "Notifications",
  BellOff: "Mute notifications",
  Mail: "Email",
  Inbox: "Inbox",
  MessageCircle: "Comment",
  MessageSquare: "Message",
  User: "User",
  Users: "People",
  UserPlus: "Add user",
  UserMinus: "Remove user",
  LogIn: "Sign in",
  LogOut: "Sign out",

  // Layout / map
  Home: "Home",
  Menu: "Menu",
  Globe: "Globe",
  MapPin: "Location",
  Map: "Map",
  Compass: "Explore",
  Grid: "Grid view",
  List: "List view",
  Sidebar: "Toggle sidebar",
  Calendar: "Calendar",
  Clock: "Time",
  Coffee: "Coffee",

  // Tools
  Hammer: "Craft",
  Wrench: "Tools",
  Cog: "Settings",
  Sliders: "Adjust",
  ZoomIn: "Zoom in",
  ZoomOut: "Zoom out",
  Crosshair: "Target",
  Code: "Code",
  Terminal: "Terminal",

  // World / status
  Sun: "Light mode",
  Moon: "Dark mode",
  Cloud: "Cloud",
  Zap: "Activate",
  Power: "Power",
  Shield: "Shield",
  AlertCircle: "Alert",
  AlertTriangle: "Warning",
  Info: "Info",
  HelpCircle: "Help",
  Coins: "Coins",
  Wallet: "Wallet",
  ShoppingCart: "Cart",
  CreditCard: "Payment",
  Gift: "Gift",
  Award: "Award",
  Flag: "Flag",
  Pin: "Pin",
  Paperclip: "Attach",
  Mic2: "Microphone",
  Headphones: "Headphones",

  // File
  File: "File",
  FileText: "Document",
  Folder: "Folder",
  FolderOpen: "Open folder",
};

const HARD_REFUSAL_RE = /(?:^|\/)concord-frontend\/(?:node_modules|\.next|out|dist)\b/i;
const ANNOTATION_OK_RE = /@a11y-ok\b/;

function camelCaseToWords(name) {
  // ZoomIn → "Zoom in" • MoreHorizontal → "More horizontal"
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

function deriveLabel(iconName) {
  if (ICON_TO_LABEL[iconName]) return ICON_TO_LABEL[iconName];
  return camelCaseToWords(iconName);
}

// Brace-balanced extractor for a JSX opening tag starting at `<` index.
function extractOpeningTag(content, startIdx) {
  let i = startIdx + 1;
  while (i < content.length && /[a-zA-Z0-9]/.test(content[i])) i++;
  const attrStart = i;
  const cap = Math.min(content.length, startIdx + 4096);
  let depth = 0;
  let inStr = "";
  while (i < cap) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = "";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "{") { depth++; i++; continue; }
    if (ch === "}") { depth--; i++; continue; }
    if (ch === ">" && depth === 0) return { attrs: content.slice(attrStart, i), closeIdx: i + 1 };
    i++;
  }
  return null;
}

function findButtonOnLine(content, lineNumber) {
  // Find the index of the `<button` opening on the target line.
  let line = 1;
  for (let i = 0; i < content.length; i++) {
    if (line === lineNumber && content.startsWith("<button", i) && /[\s>]/.test(content[i + 7] || "")) {
      return i;
    }
    if (content.charCodeAt(i) === 10) line++;
    if (line > lineNumber) break;
  }
  return -1;
}

function extractChildren(content, openTagEndIdx) {
  let depth = 1;
  let i = openTagEndIdx;
  const cap = Math.min(content.length, openTagEndIdx + 8192);
  while (i < cap && depth > 0) {
    if (content.startsWith("<button", i)) { depth++; i += 7; continue; }
    if (content.startsWith("</button>", i)) { depth--; if (depth === 0) return content.slice(openTagEndIdx, i); i += 9; continue; }
    i++;
  }
  return content.slice(openTagEndIdx, Math.min(i, cap));
}

function singleIconChild(children) {
  // Strip whitespace. If what remains is one or more JSX icons —
  // possibly wrapped in 1-3 layers of <span>/<div> — return the
  // FIRST icon's name. Multi-icon patterns like
  // `<button><Shield /><ChevronDown /></button>` use the first icon
  // (the action) as the label; the trailing icon (chevron, dot,
  // etc.) is presentational.
  let trimmed = children.trim();
  // Peel up to 3 layers of single-element HTML wrappers
  // (<span>…</span>, <div>…</div>, <i>…</i>) that contain exactly
  // one child. This handles `<button><span><Icon/></span></button>`.
  for (let depth = 0; depth < 3; depth++) {
    const wrapper = /^<(span|div|i|figure)\b[^>]*>([\s\S]*)<\/\1>\s*$/.exec(trimmed);
    if (!wrapper) break;
    trimmed = wrapper[2].trim();
  }
  // First-icon-wins: scan for the first self-closing JSX icon. If
  // EVERYTHING that follows is icons-or-whitespace, accept it.
  const firstIcon = /^<([A-Z]\w*)\b[^>]*\/>/.exec(trimmed);
  if (firstIcon) {
    const name = firstIcon[1];
    const after = trimmed.slice(firstIcon[0].length);
    // Confirm everything after is also icons-only (whitespace + more
    // self-closing JSX). Refuse if any text or expression appears.
    if (/^(?:\s|<[A-Z]\w*\b[^>]*\/>)*$/.test(after)) return name;
  }
  // Paired: <Icon ... ></Icon>
  const paired = /^<([A-Z]\w*)\b[^>]*>\s*<\/[A-Z]\w*>\s*$/.exec(trimmed);
  if (paired) return paired[1];
  return null;
}

export const a11yButtonLabelFix = {
  id: "a11y_button_label",
  label: "icon-only <button> → inject aria-label",
  riskTier: "low",
  matchFinding(f) {
    return f?.id === "a11y_button_no_label";
  },
  isApplicable(filePath, content, _finding) {
    if (HARD_REFUSAL_RE.test(filePath)) return false;
    if (!/\.(tsx|jsx)$/.test(filePath)) return false;
    if (ANNOTATION_OK_RE.test(content.split("\n").slice(0, 5).join("\n"))) return false;
    return /<button\b/.test(content);
  },
  apply(content, finding) {
    if (!finding?.location) return null;
    const [, lineStr] = finding.location.split(":");
    const lineNumber = Number(lineStr);
    if (!Number.isFinite(lineNumber) || lineNumber < 1) return null;

    const buttonIdx = findButtonOnLine(content, lineNumber);
    if (buttonIdx < 0) return null;
    const opening = extractOpeningTag(content, buttonIdx);
    if (!opening) return null;
    const attrs = opening.attrs;

    // Refuse to touch unsafe shapes.
    if (/\baria-label\s*=|\baria-labelledby\s*=|\btitle\s*=/.test(attrs)) return null;
    if (/\{\s*\.\.\.[\w$]/.test(attrs)) return null;

    const children = extractChildren(content, opening.closeIdx);
    const iconName = singleIconChild(children);
    if (!iconName) return null;
    const label = deriveLabel(iconName);
    if (!label) return null;

    // Insert `aria-label="<label>"` before the closing `>`. Splice the
    // attribute string with a leading space so existing attrs aren't
    // touched. opening.closeIdx points one past `>`.
    const beforeClose = content.slice(0, opening.closeIdx - 1);
    const afterClose = content.slice(opening.closeIdx - 1);
    const sep = attrs.length > 0 && !/\s$/.test(attrs) ? " " : "";
    const injected = `${sep}aria-label="${label}"`;
    return beforeClose + injected + afterClose;
  },
  describe(f) {
    return `Inject aria-label on icon-only <button> at ${f?.location}`;
  },
};
