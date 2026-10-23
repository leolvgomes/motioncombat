import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Erro no laboratório:', error, info.componentStack) }
  render() {
    if (this.state.failed) return <main className="fatal-error"><h1>Não foi possível abrir o laboratório.</h1><p>Recarregue a página para iniciar uma nova sessão.</p><button className="primary-button" onClick={() => window.location.reload()}>Recarregar</button></main>
    return this.props.children
  }
}
