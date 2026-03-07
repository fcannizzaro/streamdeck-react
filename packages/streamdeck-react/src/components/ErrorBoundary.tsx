import {
  Component,
  createElement,
  type ErrorInfo,
  type ReactNode,
} from "react";

export interface ErrorBoundaryProps {
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
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
