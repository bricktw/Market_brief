// ---------------------------------------------------------------------------
// VitePress page frontmatter for generated briefs.
//
// Emits a minimal YAML block — title/date/session/tags + optional description.
// Keep this small: VitePress reads frontmatter as YAML, so anything risky
// (colons, leading `-`, embedded quotes) gets double-quoted defensively.
// ---------------------------------------------------------------------------

export type Session = "morning" | "evening";

export interface BriefFrontmatter {
  title: string;
  date: string;          // YYYY-MM-DD
  session: Session;
  tags: string[];
  description?: string;
}

function needsQuoting(s: string): boolean {
  return /[:#|>&!*%@`'"\n]/.test(s) || /^[\s-]/.test(s) || /\s$/.test(s);
}

function yaml(s: string): string {
  if (!needsQuoting(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderFrontmatter(fm: BriefFrontmatter): string {
  const lines = [
    "---",
    `title: ${yaml(fm.title)}`,
    `date: ${fm.date}`,
    `session: ${fm.session}`,
    `tags: [${fm.tags.map(yaml).join(", ")}]`,
  ];
  if (fm.description) lines.push(`description: ${yaml(fm.description)}`);
  lines.push("---");
  return lines.join("\n") + "\n";
}
