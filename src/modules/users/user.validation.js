function validateUpdateMe(body) {
  const errors = [];
  const value = {};

  if (body.fullName !== undefined) {
    const fullName = String(body.fullName).trim();

    if (fullName.length < 2) {
      errors.push("Full name must be at least 2 characters.");
    } else {
      value.fullName = fullName;
    }
  }

  if (Object.keys(value).length === 0) {
    errors.push("No valid fields provided for update.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    value,
  };
}

module.exports = {
  validateUpdateMe,
};