import { useState, useEffect, useCallback, useRef } from 'react'

// Manages browser notification permission and in-app reminder fallback.
// - Asks for permission once (clearly), never re-asks if denied.
// - Checks scheduled doses periodically and fires notifications when due.
// - Falls back to in-app banners if browser notifications are unavailable.
// - Prevents duplicate notifications for the same dose via a ref Set.

const NOTIFIED_KEY = 'rightdrop_notified_doses'

function loadNotified() {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

function saveNotified(set) {
  try {
    // Keep only the last 200 entries to avoid unbounded growth.
    const arr = [...set].slice(-200)
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(arr))
  } catch {
    // ignore
  }
}

export function useNotifications() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )
  const [inAppReminder, setInAppReminder] = useState(null)
  const notifiedRef = useRef(loadNotified())

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setPermission('unsupported')
      return 'unsupported'
    }
    if (Notification.permission === 'granted') {
      setPermission('granted')
      return 'granted'
    }
    if (Notification.permission === 'denied') {
      setPermission('denied')
      return 'denied'
    }
    const result = await Notification.requestPermission()
    setPermission(result)
    return result
  }, [])

  // Fire a notification for a due dose. dedupKey ensures we don't notify twice.
  const notifyDose = useCallback((dose, dedupKey) => {
    if (notifiedRef.current.has(dedupKey)) return
    notifiedRef.current.add(dedupKey)
    saveNotified(notifiedRef.current)

    const title = 'تذكير: قطرة العين'
    const body = `${dose.medicationName} — ${dose.dosage} — ${dose.eyeLabel} — الوقت: ${dose.timeLabel}`

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          tag: dedupKey, // browser deduplicates by tag too
          icon: '/vite.svg',
        })
      } catch {
        // If notification fails, fall back to in-app
        setInAppReminder({ title, body, dedupKey })
      }
    } else {
      // Browser notifications not available or not granted — in-app fallback
      setInAppReminder({ title, body, dedupKey })
    }
  }, [])

  const dismissInAppReminder = useCallback(() => setInAppReminder(null), [])

  // Periodically check doses for due status. Called by the patient today page
  // with the current list of due doses.
  const checkDueDoses = useCallback((dueDoses) => {
    if (!dueDoses || dueDoses.length === 0) return
    for (const d of dueDoses) {
      notifyDose(d, d.dedupKey)
    }
  }, [notifyDose])

  return {
    permission,
    requestPermission,
    checkDueDoses,
    inAppReminder,
    dismissInAppReminder,
  }
}
