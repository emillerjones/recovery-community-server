// Apply one action to saved content. Other browser drafts never enter this call.
export function applyResourceEdit(saved, edit) {
  const content = structuredClone(saved);
  function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
  function reorder(items, ids) {
    if (!Array.isArray(ids) || ids.length !== items.length || new Set(ids).size !== items.length || ids.some(id => !items.some(item => item.id === id))) {
      fail("The order must include each saved item exactly once.");
    }
    return ids.map(id => items.find(item => item.id === id));
  }
  if (edit.action === "save-page-text") {
    content.hero = edit.pageText?.hero;
    content.learnIntro = edit.pageText?.learnIntro;
    content.supportIntro = edit.pageText?.supportIntro;
    return content;
  }
  if (edit.action === "reorder-categories") {
    content.categories = reorder(content.categories, edit.ids);
    return content;
  }
  const index = content.categories.findIndex(category => category.id === edit.categoryId);
  if (edit.action === "save-category") {
    const category = { id: edit.categoryId, title: edit.category?.title, section: "learn", links: index < 0 ? [] : content.categories[index].links };
    if (index < 0) content.categories.push(category);
    else content.categories[index] = category;
    return content;
  }
  if (index < 0) fail("Save this category before editing its resources.", 404);
  const category = content.categories[index];
  if (edit.action === "delete-category") content.categories.splice(index, 1);
  else if (edit.action === "save-resource") {
    if (!edit.resource || typeof edit.resource.id !== "string") fail("A resource is required.");
    const resourceIndex = category.links.findIndex(link => link.id === edit.resource.id);
    if (resourceIndex < 0) category.links.push(edit.resource);
    else category.links[resourceIndex] = edit.resource;
  } else if (edit.action === "delete-resource") {
    const resourceIndex = category.links.findIndex(link => link.id === edit.resourceId);
    if (resourceIndex < 0) fail("This resource no longer exists.", 404);
    category.links.splice(resourceIndex, 1);
  } else if (edit.action === "reorder-resources") category.links = reorder(category.links, edit.ids);
  else fail("Unknown Resources editing action.");
  return content;
}
