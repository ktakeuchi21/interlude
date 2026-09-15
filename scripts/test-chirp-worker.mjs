import { build } from "esbuild";
import { Miniflare } from "miniflare";
import assert from "node:assert/strict";

// Exercise the real OAuth and audio adapters in workerd, with synthetic keys
// and an in-process transport. No credentials, storage or external API is used.
const result = await build({ stdin: { contents: `
import { googleAccessToken, synthesizeChirp, SYNTHESIS_URL } from "./lib/google-tts";
import { waveHeader } from "./lib/audio";
import { GOOGLE_PROJECT_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL } from "./lib/google-project";
export default { async fetch() {
  try {
    const keys = await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);
    const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8",keys.privateKey));
    const encode = bytes => btoa(String.fromCharCode(...bytes));
    const secret = JSON.stringify({type:"service_account",project_id:GOOGLE_PROJECT_ID,client_email:GOOGLE_SERVICE_ACCOUNT_EMAIL,token_uri:"https://oauth2.googleapis.com/token",private_key:"-----BEGIN PRIVATE KEY-----\\n"+encode(der)+"\\n-----END PRIVATE KEY-----\\n"});
    let calls = 0;
    const transport = async (url, options) => {
      const request = new Request(url,options); calls++;
      if(request.redirect!=="manual") throw new Error("Credentials must not follow redirects");
      if(url==="https://oauth2.googleapis.com/token") return Response.json({access_token:"SYNTHETIC_TEST_TOKEN",token_type:"Bearer"});
      if(url!==SYNTHESIS_URL) throw new Error("Unexpected destination");
      const wav = new Uint8Array(144); wav.set(waveHeader(100));
      return Response.json({audioContent:encode(wav)});
    };
    const token = await googleAccessToken(secret,transport);
    const pcm = await synthesizeChirp(token,"An explicit runtime test.","Charon",transport);
    return Response.json({calls,bytes:pcm.length});
  } catch(error) { return Response.json({error:error.message},{status:500}); }
}};
`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, format: "esm", platform: "browser", write: false });
const mf = new Miniflare({ modules: true, script: result.outputFiles[0].text });
try {
  const response = await mf.dispatchFetch("http://localhost");
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.deepEqual(data, { calls: 2, bytes: 100 });
  console.log("Chirp OAuth and PCM adapters passed in workerd using synthetic data.");
} finally { await mf.dispose(); }
