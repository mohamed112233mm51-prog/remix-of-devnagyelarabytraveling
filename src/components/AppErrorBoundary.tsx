import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ padding: 24, margin: 12 }} role="alert">
          <h3 style={{ marginTop: 0 }}>تعذر تحميل هذا الجزء مؤقتًا</h3>
          <p style={{ color: "var(--text3)", marginBottom: 16 }}>حدث خطأ غير متوقع. يمكنك إعادة المحاولة بدون فقدان بيانات النظام.</p>
          <button className="btn btn-gold" onClick={() => this.setState({ error: null })}>إعادة المحاولة</button>
        </div>
      );
    }

    return this.props.children;
  }
}