const { createCategory, listCategories, updateCategory } = require('../repositories/category-repository');
const { safeGet, safeSet, safeDel } = require('../cache/cache-client');
const { KEYS, TTL } = require('../cache/cache-keys');

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function getCategories(activeOnly) {
  const cacheKey = KEYS.categoriesAll();
  const cached = await safeGet(cacheKey);
  if (cached) return cached;

  const categories = await listCategories(activeOnly);
  safeSet(cacheKey, TTL.CATEGORIES, categories);
  return categories;
}

async function addCategory({ name, description, icon }) {
  const category = await createCategory({
    name,
    slug: slugify(name),
    description: description || '',
    icon: icon || 'briefcase-outline',
  });
  safeDel(KEYS.categoriesAll());
  return category;
}

async function editCategory({ id, name, description, icon, active }) {
  const category = await updateCategory({
    id,
    name,
    slug: slugify(name),
    description: description || '',
    icon: icon || 'briefcase-outline',
    active,
  });
  safeDel(KEYS.categoriesAll());
  return category;
}

module.exports = {
  addCategory,
  editCategory,
  getCategories,
};
