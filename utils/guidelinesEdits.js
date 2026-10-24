import { GUIDELINES_ICONS, GUIDELINES_PAGE_FIELDS } from "#utils/guidelinesContent";

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail(`${label} must contain 1 to ${max} characters.`);
  return value.trim();
}
export function validateGuidelines(content) {
  if (!content || !Array.isArray(content.items) || content.items.length < 1 || content.items.length > 50) fail("Keep between 1 and 50 guidelines.");
  const page = Object.fromEntries(GUIDELINES_PAGE_FIELDS.map(field => [field.key, text(content.page?.[field.key], field.label, field.maxLength)]));
  const ids = new Set();
  const items = content.items.map(item => {
    const id = text(item?.id, "Guideline ID", 80);
    if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) fail("Every guideline needs a unique simple ID.");
    ids.add(id);
    if (!GUIDELINES_ICONS.includes(item.icon)) fail("Choose a supported guideline icon.");
    return { id, icon: item.icon, title: text(item.title, "Guideline title", 240), text: text(item.text, "Guideline explanation", 6000) };
  });
  return { page, items };
}
export function applyGuidelinesEdit(saved, edit) {
  const content = structuredClone(saved);
  if (edit.action === "save-page") content.page = edit.page;
  else if (edit.action === "save-item") {
    if (!edit.item || typeof edit.item.id !== "string") fail("A guideline is required.");
    const index = content.items.findIndex(item => item.id === edit.item.id);
    if (index < 0) content.items.push(edit.item);
    else content.items[index] = edit.item;
  } else if (edit.action === "delete-item") {
    const index = content.items.findIndex(item => item.id === edit.itemId);
    if (index < 0) fail("This guideline no longer exists.", 404);
    if (content.items.length === 1) fail("Keep at least one guideline.");
    content.items.splice(index, 1);
  } else if (edit.action === "reorder-items") {
    const ids = edit.ids;
    if (!Array.isArray(ids) || ids.length !== content.items.length || new Set(ids).size !== ids.length || ids.some(id => !content.items.some(item => item.id === id))) fail("Include each saved guideline exactly once in the order.");
    content.items = ids.map(id => content.items.find(item => item.id === id));
  } else fail("Unknown Guidelines editing action.");
  return content;
}
