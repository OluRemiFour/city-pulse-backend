import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

async function test() {
  try {
    const response = await (genai as any).generate({
      model: "gemini-1.5-flash",
      contents: [{ role: 'user', parts: [{ text: "Hello, say hi." }] }],
      config: { maxOutputTokens: 10 }
    });
    console.log("SUCCESS:", response.text);
  } catch (err: any) {
    console.log("ERROR:", err.message);
  }
}

test();
