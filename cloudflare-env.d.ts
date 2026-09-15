declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    GOOGLE_TTS_SERVICE_ACCOUNT_JSON?: string;
  }
}
