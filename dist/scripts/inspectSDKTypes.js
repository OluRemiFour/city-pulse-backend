import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";
const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY ?? "",
});
function inspect(obj, name) {
    console.log(`--- Inspecting ${name} ---`);
    if (!obj) {
        console.log(`${name} is null/undefined`);
        return;
    }
    const props = Object.getOwnPropertyNames(obj);
    for (const p of props) {
        try {
            console.log(`  ${p}: ${typeof obj[p]}`);
        }
        catch (e) {
            console.log(`  ${p}: <error accessing>`);
        }
    }
    const proto = Object.getPrototypeOf(obj);
    if (proto && proto !== Object.prototype) {
        inspect(proto, `${name}.prototype`);
    }
}
inspect(client, "client");
if (client.models) {
    inspect(client.models, "client.models");
}
