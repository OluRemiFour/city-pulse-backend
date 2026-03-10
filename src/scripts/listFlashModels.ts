import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

async function list() {
  try {
    console.log("Fetching models...");
    const models = await genai.models.list(); 
    for await (const m of models) {
      console.log(`- ${m.name} (${m.displayName})`);
    }
  } catch (err) {
    console.error("Error listing models:", err);
  }
}
list();
