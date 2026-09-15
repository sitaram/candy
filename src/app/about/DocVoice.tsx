"use client";

import { I } from "../feed/Card";
import { useVoice } from "../feed/useVoice";
import { VoiceBoundary } from "../feed/VoiceBoundary";

/**
 * Header voice button for the design doc. One tap: the guide gives a one-minute summary of the
 * whole page, then it is a conversation about it. Same transport and hook as the card and search
 * voices; the server hands it the doc instead of a card.
 */
function Inner() {
  const voice = useVoice({});
  const on = voice.active;
  return (
    <span className="doc-voice">
      <button
        className={`act voice doc${on ? ` on ${voice.state}` : ""}`}
        style={{ "--lvl": voice.level } as React.CSSProperties}
        onClick={() => (on ? voice.stop() : void voice.start({ mode: "doc" }))}
        aria-label={on ? "End conversation" : "Hear a summary and talk about this page"}
        aria-pressed={on}
        title={on ? "End" : "Summarize and discuss, by voice"}>
        {on ? <span className="stop" aria-hidden /> : I.voice}
      </button>
      {on && (
        <button className={`act sub mute doc${voice.muted ? " off" : ""}`} onClick={voice.toggleMute} aria-label="Mute microphone" aria-pressed={voice.muted} title={voice.muted ? "Unmute" : "Mute"}>
          {voice.muted ? I.micOff : I.mic}
        </button>
      )}
      {voice.error && <span className="doc-voice-err" role="alert">{voice.error}</span>}
    </span>
  );
}

export function DocVoice() {
  return <VoiceBoundary where="about-header" fallback={null}><Inner /></VoiceBoundary>;
}
