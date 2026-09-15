export const CHIRP_VOICES = ["Charon", "Kore"] as const;
export type ChirpVoice = typeof CHIRP_VOICES[number];
export const CHIRP_LIMIT = 900_000;
export const CHIRP_WINDOW = 32 * 86400_000;
export const CHIRP_SAMPLE = "Welcome to Interlude. A few quiet minutes can be enough to understand one useful idea. When you evaluate an AI product, start with the person using it. What are they trying to do, and how will you know that your product helped?";
export type ChirpAudio = { id: string; voice: ChirpVoice; kind: "sample" | "pilot" | "lesson"; lesson_key: string | null; object_key: string | null; bytes: number | null; duration: number | null };
export type ChirpState = { configured: boolean; voice: ChirpVoice | null; used: number; monthUsed: number; month: string; limit: number; held: number; previews: ChirpAudio[]; pending?: ChirpAudio[] };
export const narrationAvailable = (state: { chirp: ChirpState }) => state.chirp.configured && !!state.chirp.voice && !state.chirp.held && state.chirp.used < state.chirp.limit;
