export const fields = ["title", "note"];

export function validateDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 2 || typeof value.title !== "string" ||
      value.title.length < 1 || value.title.length > 200 || typeof value.note !== "string" || value.note.length > 2000) {
    throw new TypeError("A document needs only a nonempty title (up to 200 characters) and note (up to 2000 characters)");
  }
  return value;
}

export function validateChangedFields(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2 ||
      new Set(value).size !== value.length || value.some(field => !fields.includes(field))) {
    throw new TypeError("changed_fields must identify unique editable fields");
  }
  return value;
}

export function changedFields(base, draft) {
  validateDocument(base); validateDocument(draft);
  return fields.filter(field => draft[field] !== base[field]);
}

// The reconciliation policy is deliberately explicit: only local dirty fields
// overwrite the latest document. This is not automatic same-field conflict merge.
export function mergeChangedFields(latest, draft, dirty) {
  validateDocument(latest); validateDocument(draft); validateChangedFields(dirty);
  return Object.fromEntries(fields.map(field => [field, dirty.includes(field) ? draft[field] : latest[field]]));
}
