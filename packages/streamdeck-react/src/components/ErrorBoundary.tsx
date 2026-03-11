import { Component, createElement, type ErrorInfo, type ReactNode } from "react";

// ── Error Boundary ──────────────────────────────────────────────────
//
// Class component (required by React for error boundaries — hooks
// can't catch render errors).
//
// When a component inside this boundary throws during render, the
// default fallback renders a red "Error" screen on the Stream Deck
// key.  This prevents a single broken action from crashing the
// entire plugin — other keys continue rendering normally.
//
// The optional onError callback allows plugin-level error reporting.

export interface ErrorBoundaryProps {
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[@fcannizzaro/streamdeck-react] Component error:", error);
    this.props.onError?.(error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error fallback
      return createElement(
        "div",
        {
          style: {
            display: "flex",
            width: "100%",
            height: "100%",
            backgroundColor: "#b71c1c",
            alignItems: "center",
            justifyContent: "center",
          },
        },
        createElement(
          "span",
          {
            style: {
              color: "white",
              fontSize: 14,
              fontWeight: 700,
            },
          },
          "Error",
        ),
      );
    }

    return this.props.children;
  }
}
