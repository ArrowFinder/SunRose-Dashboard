import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err.message || "Unknown error" };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("SunRose render error:", err, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="layout" style={{ maxWidth: "520px", padding: "2rem" }}>
          <h1>Something went wrong</h1>
          <p className="muted" style={{ marginTop: "0.5rem" }}>
            The app hit an error while loading. Try a normal refresh (Cmd+R) or clear this site’s
            data for localhost / GitHub Pages, then open <code>#/login</code> again.
          </p>
          <pre
            style={{
              marginTop: "1rem",
              padding: "0.75rem",
              background: "var(--surface, #f4f4f5)",
              borderRadius: "6px",
              fontSize: "0.85rem",
              overflow: "auto",
            }}
          >
            {this.state.message}
          </pre>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: "1rem" }}
            onClick={() => window.location.assign(`${window.location.pathname}${window.location.search}#/login`)}
          >
            Go to login
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
