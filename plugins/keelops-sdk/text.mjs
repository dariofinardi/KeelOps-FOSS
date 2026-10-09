/** Text utilities shared by the plugins. */

/** Descriptions are rich text (HTML): outside panels, only plain text goes out. */
export function stripHtml(text) {
  return String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
