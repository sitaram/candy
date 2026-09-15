"use client";
import { Component, type ReactNode } from "react";
import { log } from "@/lib/voice/trace";

/**
 * A render error anywhere in the voice UI (button cluster, status, search voice controls) is traced and
 * replaced by the fallback; the feed underneath keeps working. Without this, one bad prop in a voice
 * component takes down the whole route ("Application error").
 */
export class VoiceBoundary extends Component<{ children: ReactNode; fallback?: ReactNode; where: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: { componentStack?: string }) {
    log(`render.throw ${this.props.where}`, { msg: error.message, stack: (error.stack ?? "").split("\n").slice(0, 4).join(" | "), component: (info.componentStack ?? "").split("\n").slice(0, 4).join(" | ") });
    console.error(`[voice] render error in ${this.props.where}`, error);
  }
  render() { return this.state.failed ? (this.props.fallback ?? null) : this.props.children; }
}
