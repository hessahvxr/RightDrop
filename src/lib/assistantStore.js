// Where the assistant conversation lives: on this device only, for this
// browser session only (sessionStorage). It is never saved to the database.
// It is erased by "محادثة جديدة", on sign-out, and when the tab is closed.
// The mobile app will provide the same functions on top of in-memory state.

const PREFIX = 'rightdrop_assistant_'
const MAX_STORED = 60

export function loadConversation(userId) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PREFIX + userId) || '[]')
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

export function saveConversation(userId, messages) {
  try {
    sessionStorage.setItem(PREFIX + userId, JSON.stringify(messages.slice(-MAX_STORED)))
  } catch {
    // Storage unavailable: the conversation simply lasts until the page is left.
  }
}

export function clearConversation(userId) {
  try {
    sessionStorage.removeItem(PREFIX + userId)
  } catch {
    // ignore
  }
}

// Used on sign-out so nothing is left for the next person on this device.
export function clearAllConversations() {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(PREFIX)) sessionStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}
