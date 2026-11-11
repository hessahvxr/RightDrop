// Map common Supabase auth error messages to friendly Arabic text.
export function translateAuthError(message) {
  if (!message) return 'حدث خطأ غير متوقع. حاول مرة أخرى.'
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'هذا البريد الإلكتروني مسجل بالفعل. سجّل الدخول بدلاً من ذلك.'
  }
  if (m.includes('password should be at least')) {
    return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'
  }
  if (m.includes('unable to validate email address') || m.includes('invalid email')) {
    return 'البريد الإلكتروني غير صالح.'
  }
  if (m.includes('email not confirmed')) {
    return 'لم يتم تأكيد البريد الإلكتروني بعد.'
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.'
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.'
  }
  return message
}

// Simple validation helpers used by the sign-up / sign-in forms.
export function validateEmail(email) {
  if (!email || !email.trim()) return 'البريد الإلكتروني مطلوب.'
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!re.test(email.trim())) return 'البريد الإلكتروني غير صالح.'
  return null
}

export function validatePassword(password) {
  if (!password) return 'كلمة المرور مطلوبة.'
  if (password.length < 6) return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'
  return null
}

export function validateName(name) {
  if (!name || !name.trim()) return 'الاسم الكامل مطلوب.'
  if (name.trim().length < 3) return 'الاسم يجب أن يكون 3 أحرف على الأقل.'
  return null
}
