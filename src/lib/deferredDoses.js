// Web storage for "لا، ما أخذتها" answers (see src/core/lateDose.js).
// Kept on this device only, per user. The mobile app will provide the same
// two functions on top of the phone's storage.

const storageKey = (userId) => `rightdrop_late_deferred_${userId}`

export function loadDeferred(userId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId)) || 'null')
  } catch {
    return null
  }
}

export function saveDeferred(userId, stored) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(stored))
  } catch {
    // Storage unavailable: the answer simply lasts until the page is closed.
  }
}
