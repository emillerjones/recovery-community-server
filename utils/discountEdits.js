// Apply one Owner action to the saved page, never to another item's draft.
export function applyDiscountEdit(saved, edit) {
  const content = structuredClone(saved);
  function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
  function reorder(items, ids) {
    if (!Array.isArray(ids) || ids.length !== items.length || new Set(ids).size !== items.length || ids.some(id => !items.some(item => item.id === id))) {
      fail("The order must include each saved item exactly once.");
    }
    return ids.map(id => items.find(item => item.id === id));
  }
  if (edit.action === "reorder-categories") {
    content.categories = reorder(content.categories, edit.ids);
    return content;
  }
  const index = content.categories.findIndex(category => category.id === edit.categoryId);
  if (edit.action === "save-category") {
    const category = { id: edit.categoryId, title: edit.category?.title, description: edit.category?.description,
      icon: edit.category?.icon, brands: index < 0 ? [] : content.categories[index].brands };
    if (index < 0) content.categories.push(category);
    else content.categories[index] = category;
    return content;
  }
  if (index < 0) fail("Save this category before editing its brands.", 404);
  const category = content.categories[index];
  if (edit.action === "delete-category") {
    if (content.categories.length <= 1) fail("Keep at least one category.");
    content.categories.splice(index, 1);
  } else if (edit.action === "save-brand") {
    if (!edit.brand || typeof edit.brand.id !== "string") fail("A brand is required.");
    const brandIndex = category.brands.findIndex(brand => brand.id === edit.brand.id);
    if (brandIndex < 0) category.brands.push(edit.brand);
    else category.brands[brandIndex] = edit.brand;
  } else if (edit.action === "delete-brand") {
    const brandIndex = category.brands.findIndex(brand => brand.id === edit.brandId);
    if (brandIndex < 0) fail("This brand no longer exists.", 404);
    category.brands.splice(brandIndex, 1);
  } else if (edit.action === "reorder-brands") {
    category.brands = reorder(category.brands, edit.ids);
  } else fail("Unknown discount editing action.");
  return content;
}
