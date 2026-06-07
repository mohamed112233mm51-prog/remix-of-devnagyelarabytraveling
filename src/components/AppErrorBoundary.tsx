import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  name?: string;
};

type State = {
  error: Error | null;
  info: ErrorInfo | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[AppErrorBoundary:${this.props.name || "App"}]`, error, errorInfo);
    this.setState({ info: errorInfo });
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <div className="card" style={{ padding: 20, margin: 12, direction: "rtl" }} role="alert">
          <h3 style={{ marginTop: 0, color: "#b91c1c" }}>تعذر تحميل هذا الجزء</h3>
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: "#7f1d1d" }}>المكون: {this.props.name || "App"}</div>
            <div style={{ fontWeight: 700, marginBottom: 6, color: "#7f1d1d" }}>{err.name}: {err.message}</div>
            {err.stack && (
              <pre style={{ fontSize: 11, color: "#475569", whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto", margin: 0, direction: "ltr", textAlign: "left" }}>{err.stack}</pre>
            )}
            {this.state.info?.componentStack && (
              <pre style={{ fontSize: 11, color: "#64748b", whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", marginTop: 8, direction: "ltr", textAlign: "left" }}>{this.state.info.componentStack}</pre>
            )}
          </div>
          <button className="btn btn-gold" onClick={() => this.setState({ error: null, info: null })}>إعادة المحاولة</button>
        </div>
      );
    }

    return this.props.children;
  }
}
