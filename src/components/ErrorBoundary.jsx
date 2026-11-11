import { Component } from 'react'

// Catches an unexpected error while the app is drawing a screen and shows a
// message with a reload button, instead of leaving a white page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('RightDrop screen error:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
        <div role="alert" className="w-full max-w-md rounded-3xl border-2 border-rose-300 bg-white p-6 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">حدث خطأ غير متوقع</h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-700">
            تعذّر عرض هذه الصفحة. أعد تحميل الصفحة، وإذا تكرر الخطأ تواصل مع الدعم.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 w-full rounded-2xl bg-primary-700 px-4 py-4 text-xl font-bold text-white hover:bg-primary-800 active:scale-[0.98]"
          >
            إعادة تحميل الصفحة
          </button>
          <p dir="ltr" className="mt-4 break-words text-sm text-slate-500">
            {String(this.state.error?.message || this.state.error).slice(0, 200)}
          </p>
        </div>
      </div>
    )
  }
}
