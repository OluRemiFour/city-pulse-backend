import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY ?? "",
});

console.log("Client:", client);
console.log("Models:", client.models);
if (client.models) {
    console.log("GenerateContent type:", typeof client.models.generateContent);
}
