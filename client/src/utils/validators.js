// Client-side validation mirrors the server rules for fast feedback.
// The server validates everything again; these checks are a convenience, not a security control.

export const validateName = (value) => {
  const v = value.trim();
  if (!v) return 'Enter your full name';
  if (v.length < 2) return 'Name must be at least 2 characters';
  if (v.length > 50) return 'Name must be at most 50 characters';
  return '';
};

export const validateUsername = (value) => {
  const v = value.trim();
  if (!v) return 'Choose a username';
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(v)) return 'Use 3-20 letters, numbers or underscores';
  return '';
};

export const validateEmail = (value) => {
  const v = value.trim();
  if (!v) return 'Enter your email address';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address';
  return '';
};

export const passwordChecks = (value) => [
  { label: 'At least 8 characters', ok: value.length >= 8 },
  { label: 'Contains a letter', ok: /[A-Za-z]/.test(value) },
  { label: 'Contains a number', ok: /[0-9]/.test(value) },
];

export const validatePassword = (value) => {
  if (!value) return 'Create a password';
  if (value.length > 72) return 'Password must be at most 72 characters';
  const failed = passwordChecks(value).find((check) => !check.ok);
  return failed ? `Password needs: ${failed.label.toLowerCase()}` : '';
};

export const validateConfirm = (password, confirm) => {
  if (!confirm) return 'Confirm your password';
  if (password !== confirm) return 'Passwords do not match';
  return '';
};
