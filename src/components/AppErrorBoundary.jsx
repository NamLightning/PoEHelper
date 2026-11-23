import { Component } from 'react'

export default class AppErrorBoundary extends Component {
  state = { error: null, componentStack: '', resetKey: 0 }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Application render failed:', error, info.componentStack)
    this.setState({ componentStack: info.componentStack || '' })
  }

  resetView = () => {
    this.setState((state) => ({
      error: null,
      componentStack: '',
      resetKey: state.resetKey + 1,
    }))
  }

  reloadApp = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.error) {
      return <div key={this.state.resetKey} className="contents">{this.props.children}</div>
    }

    return (
      <main className="grid min-h-screen place-items-center bg-[#10171c] px-6 py-10 text-[#dbe3e5]">
        <section role="alert" className="w-full max-w-2xl border border-[#75483d] bg-[#1a2329] p-6 shadow-2xl">
          <h1 className="text-xl font-semibold text-[#ffad91]">Something went wrong</h1>
          <p className="mt-2 text-sm text-[#c2cdd0]">
            The app could not render this view. The error details are shown below.
          </p>
          <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-words border border-[#354149] bg-[#11191f] p-3 text-xs text-[#ffbfaa]">
            {this.state.error.message || String(this.state.error)}
          </pre>
          {this.state.componentStack ? (
            <details className="mt-3 text-xs text-[#9baab0]">
              <summary className="cursor-pointer">Component stack</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{this.state.componentStack}</pre>
            </details>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.resetView}
              className="border border-[#46605c] bg-[#233633] px-4 py-2 text-sm text-[#75d9b7] hover:bg-[#2b4641]"
            >
              Reset view
            </button>
            <button
              type="button"
              onClick={this.reloadApp}
              className="border border-[#43515a] bg-[#202b32] px-4 py-2 text-sm text-[#dbe3e5] hover:bg-[#2b3941]"
            >
              Reload app
            </button>
          </div>
        </section>
      </main>
    )
  }
}
